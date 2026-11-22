import type {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {developerIdentity} from './developer-identity';
import {availableRosters,usableRosterSql} from './access-rosters';
import {atomicMutation,activeOperator} from './atomic-mutation';
import {randomToken,sha256Base64Url} from './crypto';
import {parseRosterInput,rosterItem} from './roster-input';
import {managesService,serviceManagementSql,boundRosterManagementSql} from './service-authority';

const id=z.string().min(1).max(192),revision=z.number().int().positive();
const selection=z.object({rosterId:id,revision});
const privateItem=rosterItem.extend({gameUid:rosterItem.shape.gameUid.transform(value=>value.replace(/^0+(?=\d)/,''))});
export const actionInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),name:z.string().trim().min(1).max(80)}),
 selection.extend({action:z.literal('rename'),name:z.string().trim().min(1).max(80)}),
 selection.extend({action:z.literal('delete')}),selection.extend({action:z.literal('restore')}),
 z.object({action:z.literal('default'),rosterId:id}),
 selection.extend(privateItem.shape).extend({action:z.literal('entry'),entryId:id.optional(),entryRevision:revision.optional()}),
 selection.extend({action:z.literal('remove-entry'),entryId:id,entryRevision:revision}),
 selection.extend({action:z.literal('restore-entry'),entryId:id,entryRevision:revision}),
 selection.extend({action:z.literal('preview'),text:z.string().min(1).max(2_000_000)}),
 selection.extend({action:z.literal('import'),text:z.string().min(1).max(2_000_000),fingerprint:z.string().min(1)}),
]);
type Actor={readonly user:string;readonly admin:boolean;readonly serviceId?:string};
type Roster={readonly id:string;readonly name:string;readonly owner_user_id:string|null;readonly organization_id:string|null;readonly status:'active'|'deleted';readonly revision:number};
type Entry={readonly id:string;readonly game_uid:string;readonly nickname:string;readonly status:'active'|'deleted';readonly revision:number};
export class DeveloperRosterError extends Error {constructor(message:string,readonly status:403|404|409){super(message);}}
const activeDeveloper=`${activeOperator} OR EXISTS(SELECT 1 FROM developers d JOIN users u ON u.id=d.user_id WHERE d.user_id=? AND d.status='active' AND u.status='active')`;
const ownerGuard=`EXISTS(SELECT 1 FROM access_rosters WHERE id=? AND organization_id IS NULL AND (owner_user_id=? OR ${activeOperator}))`;
async function owned(env:Env,actor:Actor,rosterId:string){
 const roster=await env.DB.prepare('SELECT * FROM access_rosters WHERE id=?').bind(rosterId).first<Roster>();
 if(!roster)throw new DeveloperRosterError('명부를 찾을 수 없습니다.',404);
 if(actor.serviceId){
  if(!await managesService(env,actor.user,actor.serviceId)||!await env.DB.prepare('SELECT 1 FROM application_rosters WHERE client_id=? AND roster_id=?').bind(actor.serviceId,rosterId).first())throw new DeveloperRosterError('이 서비스의 연결 명부만 관리할 수 있습니다.',403);
 }else if(roster.organization_id||(!actor.admin&&roster.owner_user_id!==actor.user))throw new DeveloperRosterError('자신이 만든 명부만 조회·수정할 수 있습니다. 공유 명부는 중앙 관리자가 관리합니다.',403);
 if(roster.organization_id)throw new DeveloperRosterError('공유 명부는 서비스 명부 화면에서 관리하세요.',403);
 return roster;
}
async function entries(env:Env,rosterId:string){return (await env.DB.prepare('SELECT id,game_uid,nickname,status,revision FROM access_roster_entries WHERE roster_id=? ORDER BY nickname,game_uid').bind(rosterId).all<Entry>()).results;}

export function registerDeveloperRosters(app:Hono<{Bindings:Env}>){
 app.get('/developer/rosters',async c=>{
  const actor=await developerIdentity(c);if(!actor||actor.serviceOnly)return c.json({error:'DEVELOPER_REQUIRED'},403);
  return c.json({rosters:await availableRosters(c.env,actor.user,actor.admin),admin:actor.admin});
 });
 app.get('/developer/rosters/:id',async c=>{
  const actor=await developerIdentity(c);if(!actor||actor.serviceOnly)return c.json({error:'DEVELOPER_REQUIRED'},403);
  const roster=await owned(c.env,actor,c.req.param('id'));return c.json({roster,entries:await entries(c.env,roster.id)});
 });
 app.post('/developer/rosters',async c=>{
  if(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('X-Access-Kit-Action')!=='1')return c.json({error:'ORIGIN_DENIED'},403);
  const actor=await developerIdentity(c);if(!actor||actor.serviceOnly)return c.json({error:'DEVELOPER_REQUIRED'},403);
  return c.json(await mutatePrivateRoster(c.env,actor,actionInput.parse(await c.req.json())));
 });
}


export async function mutatePrivateRoster(env:Env,actor:Actor,action:z.infer<typeof actionInput>){
 const now=Date.now(),tx=atomicMutation(env);
  if(actor.serviceId){
   if(['create','default','rename','delete','restore'].includes(action.action))throw new DeveloperRosterError('연결 명부의 회원만 관리할 수 있습니다.',403);
   tx.require(serviceManagementSql,actor.serviceId,actor.user,actor.user);
   tx.require(boundRosterManagementSql,actor.serviceId,actor.user);
  }else tx.require(activeDeveloper,actor.user,actor.user);
  const audit=(name:string,detail:unknown)=>tx.add(env.DB.prepare('INSERT INTO auth_events VALUES(?,?,NULL,?,?,?)').bind('evt_'+randomToken(18),actor.user,'developer.roster.'+name,JSON.stringify(detail),now));
  if(action.action==='create'){
   const rosterId='roster_'+randomToken(18);tx.add(env.DB.prepare("INSERT INTO access_rosters VALUES(?,?,?,NULL,'active',1,?,?)").bind(rosterId,action.name,actor.user,now,now));audit('create',{rosterId});await tx.commit();return {rosterId};
  }
  if(action.action==='default'){
   if(!actor.admin)throw new DeveloperRosterError('ADMIN_REQUIRED',403);
   tx.require(activeOperator,actor.user);tx.require(`EXISTS(SELECT 1 FROM access_rosters r WHERE r.id=? AND r.owner_user_id IS NULL AND ${usableRosterSql})`,action.rosterId);
   tx.add(env.DB.prepare('INSERT INTO default_access_roster VALUES(1,?) ON CONFLICT(id) DO UPDATE SET roster_id=excluded.roster_id').bind(action.rosterId));audit('default',{rosterId:action.rosterId});await tx.commit();return {ok:true};
  }
  const roster=await owned(env,actor,action.rosterId);
  if(roster.revision!==action.revision)throw new DeveloperRosterError('명부가 변경되었습니다. 새로고침 후 다시 확인하세요.',409);
  if(actor.serviceId)tx.require('EXISTS(SELECT 1 FROM application_rosters WHERE client_id=? AND roster_id=?)',actor.serviceId,roster.id);
  else tx.require(ownerGuard,roster.id,actor.user,actor.user);
  tx.require('EXISTS(SELECT 1 FROM access_rosters WHERE id=? AND revision=? AND status=?)',roster.id,roster.revision,roster.status);
  if(action.action==='rename'||action.action==='delete'||action.action==='restore'){
   const name=action.action==='rename'?action.name:roster.name,status=action.action==='delete'?'deleted':action.action==='restore'?'active':roster.status;
   tx.add(env.DB.prepare('UPDATE access_rosters SET name=?,status=?,revision=revision+1,updated_at=? WHERE id=?').bind(name,status,now,roster.id));audit(action.action,{rosterId:roster.id});await tx.commit();return {ok:true};
  }
  if(roster.status!=='active')throw new DeveloperRosterError('삭제한 명부를 먼저 복구하세요.',409);
  if(action.action==='preview'||action.action==='import'){
   const parsed=parseRosterInput(action.text,true),current=await entries(env,roster.id),byUid=new Map(current.map(e=>[e.game_uid,e]));
   const items=parsed.items.map(item=>{const old=byUid.get(item.gameUid);return {...item,kind:!old?'add':old.status==='deleted'?'conflict':old.nickname===item.nickname?'unchanged':'update'};});
   const counts={add:0,update:0,unchanged:0,conflict:0};for(const item of items){switch(item.kind){case 'add':counts.add++;break;case 'update':counts.update++;break;case 'unchanged':counts.unchanged++;break;case 'conflict':counts.conflict++;break;}}
   const fingerprint=await sha256Base64Url(JSON.stringify({rosterId:roster.id,revision:roster.revision,items})),ready=!parsed.errors.length&&!counts.conflict;
   if(action.action==='preview')return {items,counts,errors:parsed.errors,duplicateCount:parsed.duplicateCount,ready,fingerprint};
   if(!ready||action.fingerprint!==fingerprint)throw new DeveloperRosterError('오류·삭제 항목을 확인하고 미리보기를 다시 실행하세요.',409);
   const changed=JSON.stringify(items.filter(item=>item.kind==='add'||item.kind==='update'));
   tx.add(env.DB.prepare(`INSERT INTO access_roster_entries SELECT 'pre_'||lower(hex(randomblob(16))),?,json_extract(value,'$.gameUid'),json_extract(value,'$.nickname'),'active',1,?,? FROM json_each(?) WHERE 1
    ON CONFLICT(roster_id,game_uid) DO UPDATE SET nickname=excluded.nickname,revision=access_roster_entries.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(roster.id,now,actor.user,changed));
   tx.add(env.DB.prepare('UPDATE access_rosters SET revision=revision+1,updated_at=? WHERE id=?').bind(now,roster.id));audit('import',{rosterId:roster.id,counts});await tx.commit();return {ok:true,counts};
  }
  if(action.action==='entry'){
   if(action.entryId){
    if(!action.entryRevision)throw new DeveloperRosterError('수정할 명부 행을 다시 확인하세요.',409);
    tx.require("EXISTS(SELECT 1 FROM access_roster_entries WHERE id=? AND roster_id=? AND revision=? AND status='active')",action.entryId,roster.id,action.entryRevision);
    tx.add(env.DB.prepare('UPDATE access_roster_entries SET game_uid=?,nickname=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND roster_id=?').bind(action.gameUid,action.nickname,now,actor.user,action.entryId,roster.id));
   }else tx.add(env.DB.prepare("INSERT INTO access_roster_entries VALUES(?,?,?,?,'active',1,?,?)").bind('pre_'+randomToken(18),roster.id,action.gameUid,action.nickname,now,actor.user));
  }else{
   tx.require('EXISTS(SELECT 1 FROM access_roster_entries WHERE id=? AND roster_id=? AND revision=? AND status=?)',action.entryId,roster.id,action.entryRevision,action.action==='remove-entry'?'active':'deleted');
   tx.add(env.DB.prepare('UPDATE access_roster_entries SET status=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND roster_id=?').bind(action.action==='remove-entry'?'deleted':'active',now,actor.user,action.entryId,roster.id));
  }
  tx.add(env.DB.prepare('UPDATE access_rosters SET revision=revision+1,updated_at=? WHERE id=?').bind(now,roster.id));audit(action.action,{rosterId:roster.id});await tx.commit();return {ok:true};
}
