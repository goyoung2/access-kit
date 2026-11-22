import {z} from 'zod';
import type {Env} from './types';
import {atomicMutation,activeOperator} from './atomic-mutation';
import {randomToken,sha256Base64Url} from './crypto';
import {parseRosterInput,rosterItem} from './roster-input';
import type {RosterItem} from './roster-input';
import {catalogAvailable} from './membership-catalog';
import {serviceRosterAuthority} from './service-authority';

const id=z.string().trim().min(1).max(128);
const context=z.object({realm:z.string().trim().min(1).max(64),seasonId:id,organizationId:id});
const selected=z.object({id,revision:z.number().int().positive()});
const importInput=context.extend({text:z.string().min(1).max(2_000_000)});
export const rosterAction=z.discriminatedUnion('action',[
 context.extend(rosterItem.shape).extend({action:z.literal('create')}),
 context.extend(rosterItem.shape).extend(selected.shape).extend({action:z.literal('update')}),
 selected.extend({action:z.literal('delete')}),selected.extend({action:z.literal('restore')}),
 importInput.extend({action:z.literal('preview')}),
 importInput.extend({action:z.literal('import'),fingerprint:z.string().min(1).max(128)}),
]);
type RosterContext=z.infer<typeof context>;
type Transaction=ReturnType<typeof atomicMutation>;
type RosterRow={readonly id:string;readonly realm:string;readonly game_uid:string;readonly nickname:string;readonly season_id:string;readonly organization_id:string;readonly status:'active'|'deleted';readonly revision:number;readonly updated_at:number;readonly linked_user_id:string|null;readonly member_status:string|null};
export class RosterError extends Error {constructor(message:string,readonly status:400|403|409){super(message);}}
const authority=`${activeOperator} OR EXISTS(SELECT 1 FROM member_managers mm JOIN users u ON u.id=mm.user_id WHERE mm.user_id=? AND mm.organization_id=? AND u.status='active' AND ${catalogAvailable('organization','mm.organization_id')})`;
export const rosterSelect=`SELECT r.*,g.user_id AS linked_user_id,m.status AS member_status FROM roster_entries r LEFT JOIN game_accounts g ON g.realm=r.realm AND g.game_uid=r.game_uid LEFT JOIN common_members m ON m.user_id=g.user_id`;
const selectRows=rosterSelect;
function authorityFor(actor:string,c:RosterContext,serviceId?:string){return serviceId?serviceRosterAuthority(actor,serviceId,c.organizationId):{sql:authority,values:[actor,actor,c.organizationId]};}
function contextAccessSql(sql:string){return `SELECT (${sql}) AS allowed,
 EXISTS(SELECT 1 FROM member_seasons s,member_organizations o WHERE s.id=? AND s.status IN ('draft','active') AND o.id=? AND ${catalogAvailable('season','s.id')} AND ${catalogAvailable('organization','o.id')}) AS valid`;
}
function contextGuard(actor:string,c:RosterContext,serviceId?:string){const rule=authorityFor(actor,c,serviceId);return {sql:`(${rule.sql}) AND EXISTS(SELECT 1 FROM member_seasons s WHERE s.id=? AND s.status IN ('draft','active') AND ${catalogAvailable('season','s.id')}) AND EXISTS(SELECT 1 FROM member_organizations o WHERE o.id=? AND ${catalogAvailable('organization','o.id')})`,values:[...rule.values,c.seasonId,c.organizationId]};}

export async function rosterRows(env:Env,actor:string){
 return (await env.DB.prepare(`${selectRows} WHERE (${activeOperator} OR EXISTS(SELECT 1 FROM member_managers mm JOIN users u ON u.id=mm.user_id WHERE mm.user_id=? AND mm.organization_id=r.organization_id AND u.status='active' AND ${catalogAvailable('organization','mm.organization_id')})) ORDER BY r.nickname,r.game_uid`).bind(actor,actor).all<RosterRow>()).results;
}

async function authorize(env:Env,actor:string,c:RosterContext,serviceId?:string){
 const rule=authorityFor(actor,c,serviceId);
 const access=await env.DB.prepare(contextAccessSql(rule.sql))
  .bind(...rule.values,c.seasonId,c.organizationId).first<{allowed:number;valid:number}>();
 checkAccess(access);
}
function checkAccess(access:{readonly allowed:number;readonly valid:number}|null):asserts access is {readonly allowed:number;readonly valid:number}{
 if(!access?.allowed)throw new RosterError('담당 소속의 명부만 관리할 수 있습니다.',403);
 if(!access.valid)throw new RosterError('준비 중 또는 진행 중인 시즌과 등록된 소속을 선택하세요.',409);
}
function guardContext(tx:Transaction,actor:string,c:RosterContext,serviceId?:string){
 const rule=contextGuard(actor,c,serviceId);tx.require(rule.sql,...rule.values);
}
function guardRow(tx:Transaction,row:RosterRow){
 tx.require('EXISTS(SELECT 1 FROM roster_entries WHERE id=? AND revision=? AND organization_id=? AND status=?)',row.id,row.revision,row.organization_id,row.status);
}
async function readEntry(env:Env,entryId:string){return env.DB.prepare(`${selectRows} WHERE r.id=?`).bind(entryId).first<RosterRow>();}
function audit(env:Env,tx:Transaction,actor:string,action:string,detail:unknown){tx.add(env.DB.prepare('INSERT INTO auth_events VALUES(?,?,NULL,?,?,?)').bind('evt_'+randomToken(10),actor,'roster.'+action,JSON.stringify(detail),Date.now()));}
function syncMembership(env:Env,tx:Transaction,actor:string,c:RosterContext,item:RosterItem,status:'active'|'deleted'){
 const now=Date.now();
 if(status==='active'){
  tx.add(env.DB.prepare('UPDATE game_accounts SET nickname=? WHERE realm=? AND game_uid=?').bind(item.nickname,c.realm,item.gameUid));
  tx.add(env.DB.prepare(`INSERT INTO season_memberships(user_id,season_id,organization_id,status,updated_at,updated_by)
   SELECT g.user_id,?,?,'active',?,? FROM game_accounts g JOIN common_members m ON m.user_id=g.user_id JOIN users u ON u.id=g.user_id
   WHERE g.realm=? AND g.game_uid=? AND m.status IN ('approved','suspended')
   ON CONFLICT(user_id,season_id) DO UPDATE SET organization_id=excluded.organization_id,status='active',updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(c.seasonId,c.organizationId,now,actor,c.realm,item.gameUid));
 }else tx.add(env.DB.prepare(`UPDATE season_memberships SET status='inactive',updated_at=?,updated_by=? WHERE season_id=? AND organization_id=? AND user_id IN(SELECT user_id FROM game_accounts WHERE realm=? AND game_uid=?)`).bind(now,actor,c.seasonId,c.organizationId,c.realm,item.gameUid));
}
function writeEntry(env:Env,tx:Transaction,actor:string,c:RosterContext,item:RosterItem,old:RosterRow|null,status:'active'|'deleted'){
 const entryId=old?.id||'rst_'+randomToken(18);
 if(old){
  guardRow(tx,old);
  if(old.realm!==c.realm||old.game_uid!==item.gameUid){
   if(old.linked_user_id)throw new RosterError('이미 로그인 계정에 연결된 UID·권역은 바꿀 수 없습니다. 닉네임과 소속은 수정할 수 있습니다.',409);
   tx.require('NOT EXISTS(SELECT 1 FROM game_accounts WHERE realm=? AND game_uid=?)',old.realm,old.game_uid);
  }
  tx.add(env.DB.prepare('UPDATE roster_entries SET realm=?,game_uid=?,nickname=?,organization_id=?,status=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=?').bind(c.realm,item.gameUid,item.nickname,c.organizationId,status,Date.now(),actor,entryId));
 }else{
  tx.require('NOT EXISTS(SELECT 1 FROM roster_entries WHERE realm=? AND game_uid=? AND season_id=?)',c.realm,item.gameUid,c.seasonId);
  tx.add(env.DB.prepare('INSERT INTO roster_entries VALUES(?,?,?,?,?,?,?,1,?,?)').bind(entryId,c.realm,item.gameUid,item.nickname,c.seasonId,c.organizationId,status,Date.now(),actor));
 }
 syncMembership(env,tx,actor,c,item,status);return entryId;
}
async function preview(env:Env,actor:string,c:RosterContext,text:string,serviceId?:string){
 const input=parseRosterInput(text);
 const rule=authorityFor(actor,c,serviceId);
 const snapshot=await env.DB.prepare(`WITH access AS (${contextAccessSql(rule.sql)})
  SELECT allowed,valid,CASE WHEN allowed AND valid THEN (
   SELECT json_group_array(json_object('game_uid',r.game_uid,'nickname',r.nickname,'organization_id',r.organization_id,'status',r.status,'revision',r.revision))
   FROM json_each(?) j CROSS JOIN roster_entries r
   WHERE r.realm=? AND r.game_uid=CAST(j.value AS TEXT) AND r.season_id=?
  ) ELSE '[]' END AS current FROM access`)
  .bind(...rule.values,c.seasonId,c.organizationId,JSON.stringify(input.items.map(item=>item.gameUid)),c.realm,c.seasonId)
  .first<{allowed:number;valid:number;current:string}>();
 checkAccess(snapshot);
 // This JSON is generated by the fixed projection above, not supplied by the caller.
 const current:readonly Pick<RosterRow,'game_uid'|'nickname'|'organization_id'|'status'|'revision'>[]=JSON.parse(snapshot.current);
 const byUid=new Map(current.map(row=>[row.game_uid,row]));
 const items=input.items.map(item=>{
  const old=byUid.get(item.gameUid);
  let kind:'add'|'update'|'unchanged'|'conflict'='add',message='';
  if(old){
   if(old.organization_id!==c.organizationId){kind='conflict';message='같은 시즌의 다른 소속에 등록된 UID입니다. 개별 수정으로 소속을 확인하세요.';}
   else if(old.status==='deleted'){kind='conflict';message='삭제된 항목입니다. 명부에서 먼저 복구하세요.';}
   else kind=old.nickname===item.nickname?'unchanged':'update';
  }
  return {...item,kind,message,revision:old?.revision??null};
 });
 const counts={add:0,update:0,unchanged:0,conflict:0};for(const item of items)counts[item.kind]++;
 const ready=!input.errors.length&&!counts.conflict;
 const fingerprint=await sha256Base64Url(JSON.stringify({context:c,items}));
 return {items,errors:input.errors,duplicateCount:input.duplicateCount,counts,ready,fingerprint};
}

export async function mutateRoster(env:Env,actor:string,action:z.infer<typeof rosterAction>,serviceId?:string){
 if(action.action==='preview'||action.action==='import'){
  const c=context.parse(action),result=await preview(env,actor,c,action.text,serviceId);
  if(action.action==='preview')return result;
  if(!result.ready)throw new RosterError('오류·충돌을 수정하고 미리보기를 다시 확인하세요.',409);
  if(action.fingerprint!==result.fingerprint)throw new RosterError('미리보기 이후 명부가 바뀌었습니다. 다시 미리보기를 실행하세요.',409);
  const tx=atomicMutation(env);
  // Set-based writes keep large imports in one bounded batch without thousands of result objects.
  const rows=JSON.stringify(result.items),now=Date.now();
  const rule=contextGuard(actor,c,serviceId);
  tx.require(`${rule.sql} AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN roster_entries r ON r.realm=? AND r.season_id=? AND r.game_uid=CAST(json_extract(j.value,'$.gameUid') AS TEXT)
   WHERE (json_extract(j.value,'$.revision') IS NULL AND r.id IS NOT NULL)
   OR (json_extract(j.value,'$.revision') IS NOT NULL AND (r.id IS NULL OR r.revision<>json_extract(j.value,'$.revision') OR r.status<>'active' OR r.organization_id<>?)))`,...rule.values,rows,c.realm,c.seasonId,c.organizationId);
  const changed=result.items.filter(item=>item.kind==='add'||item.kind==='update');
  if(changed.length){
  const changes=JSON.stringify(changed);
  tx.add(env.DB.prepare(`INSERT INTO roster_entries(id,realm,game_uid,nickname,season_id,organization_id,status,revision,updated_at,updated_by)
   SELECT 'rst_'||lower(hex(randomblob(16))),?,json_extract(value,'$.gameUid'),json_extract(value,'$.nickname'),?,?,'active',1,?,? FROM json_each(?)
   WHERE 1
   ON CONFLICT(realm,game_uid,season_id) DO UPDATE SET nickname=excluded.nickname,revision=roster_entries.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(c.realm,c.seasonId,c.organizationId,now,actor,changes));
  // Iterate the changed input first, then use the existing unique UID and user indexes.
  tx.add(env.DB.prepare(`WITH changed_accounts AS MATERIALIZED (
   SELECT g.user_id,json_extract(j.value,'$.nickname') AS nickname FROM json_each(?) j CROSS JOIN game_accounts g
   WHERE g.realm=? AND g.game_uid=CAST(json_extract(j.value,'$.gameUid') AS TEXT)
  ) UPDATE game_accounts SET nickname=changed_accounts.nickname FROM changed_accounts WHERE game_accounts.user_id=changed_accounts.user_id`).bind(changes,c.realm));
  tx.add(env.DB.prepare(`INSERT INTO season_memberships(user_id,season_id,organization_id,status,updated_at,updated_by)
   SELECT g.user_id,?,?,'active',?,? FROM json_each(?) j CROSS JOIN game_accounts g CROSS JOIN common_members m
   WHERE g.realm=? AND g.game_uid=CAST(json_extract(j.value,'$.gameUid') AS TEXT) AND m.user_id=g.user_id
   ON CONFLICT(user_id,season_id) DO UPDATE SET organization_id=excluded.organization_id,status='active',updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(c.seasonId,c.organizationId,now,actor,changes,c.realm));
  }
  audit(env,tx,actor,'import',{...c,counts:result.counts});await tx.commit();return {ok:true,counts:result.counts};
 }
 let old:RosterRow|null=null;
 if(action.action!=='create'){
  old=await readEntry(env,action.id);if(!old)throw new RosterError('명부 항목을 찾지 못했습니다.',409);
  await authorize(env,actor,{realm:old.realm,seasonId:old.season_id,organizationId:old.organization_id},serviceId);
  if(old.revision!==action.revision)throw new RosterError('다른 관리자가 변경했습니다. 새로고침 후 다시 시도하세요.',409);
 }
 let c:RosterContext,item:RosterItem,status:'active'|'deleted';
 switch(action.action){
  case 'create':case 'update':
   c=context.parse(action);item=rosterItem.parse(action);status='active';
   if(old&&(old.status==='deleted'||old.season_id!==c.seasonId))throw new RosterError('삭제된 항목은 먼저 복구하세요. 다른 시즌에는 새 항목을 추가하세요.',409);
   break;
  case 'delete':case 'restore':
   if(!old)throw new RosterError('명부 항목을 찾지 못했습니다.',409);
   c={realm:old.realm,seasonId:old.season_id,organizationId:old.organization_id};item={nickname:old.nickname,gameUid:old.game_uid};status=action.action==='delete'?'deleted':'active';
   if(old.status===status)throw new RosterError('이미 변경된 항목입니다. 목록을 새로고침하세요.',409);
   break;
 }
 await authorize(env,actor,c,serviceId);const tx=atomicMutation(env);guardContext(tx,actor,c,serviceId);
 if(!old&&await env.DB.prepare('SELECT id FROM roster_entries WHERE realm=? AND game_uid=? AND season_id=?').bind(c.realm,item.gameUid,c.seasonId).first())throw new RosterError('이 UID는 해당 시즌에 이미 등록되어 있습니다. 기존 항목을 수정하거나 삭제 목록에서 복구하세요.',409);
 if(old)guardContext(tx,actor,{realm:old.realm,seasonId:old.season_id,organizationId:old.organization_id},serviceId);
 const entryId=writeEntry(env,tx,actor,c,item,old,status);
 audit(env,tx,actor,action.action,{id:entryId,...c,nickname:item.nickname,gameUid:item.gameUid,status});await tx.commit();
 return {ok:true,entry:await readEntry(env,entryId)};
}
