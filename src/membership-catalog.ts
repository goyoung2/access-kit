import {z} from 'zod';
import type {Env} from './types';
import {atomicMutation,activeOperator,MutationConflict} from './atomic-mutation';
import {randomToken} from './crypto';

const kind=z.enum(['season','organization']);
type Kind=z.infer<typeof kind>;
const selected=z.object({kind,id:z.string().min(1).max(128),revision:z.number().int().positive()});
const name=z.string().trim().min(1).max(80);
export const catalogAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),kind,name}),
 selected.extend({action:z.literal('rename'),name}),
 selected.extend({action:z.literal('delete')}),selected.extend({action:z.literal('restore')}),
 selected.extend({action:z.literal('end'),kind:z.literal('season')}),
]);
const tables={season:'member_seasons',organization:'member_organizations'} as const;
type CatalogRow={readonly id:string;readonly name:string;readonly status?:'draft'|'active'|'archived';readonly revision:number;readonly deleted_at:number|null;readonly roster_count:number;readonly member_count:number;readonly manager_count:number;readonly service_count:number};

/** Kind and key expressions are code-owned SQL, never user input. */
export function catalogAvailable(kind:Kind,key:string){return `NOT EXISTS(SELECT 1 FROM catalog_state cs WHERE cs.kind='${kind}' AND cs.entity_id=${key} AND cs.deleted_at IS NOT NULL)`;}
export function catalogSelect(kind:Kind){
 const foreign=kind==='season'?'season_id':'organization_id';
 return `SELECT e.*,c.revision,c.deleted_at,
 (SELECT COUNT(*) FROM roster_entries r WHERE r.${foreign}=e.id) AS roster_count,
 ((SELECT COUNT(*) FROM season_memberships sm WHERE sm.${foreign}=e.id AND NOT EXISTS(SELECT 1 FROM automatic_registrations registration WHERE registration.user_id=sm.user_id))
 + (SELECT COUNT(*) FROM roster_entries r JOIN game_accounts g ON g.realm=r.realm AND g.game_uid=r.game_uid JOIN automatic_registrations registration ON registration.user_id=g.user_id WHERE r.${foreign}=e.id)) AS member_count,
 ${kind==='organization'?"(SELECT COUNT(*) FROM member_managers mm WHERE mm.organization_id=e.id)":"0"} AS manager_count,
 ${kind==='organization'?"(SELECT COUNT(*) FROM common_application_policies p WHERE p.mode='season' AND p.organization_id=e.id)":"0"} AS service_count
 FROM ${tables[kind]} e JOIN catalog_state c ON c.kind='${kind}' AND c.entity_id=e.id`;
}

export async function mutateCatalog(env:Env,actor:string,action:z.infer<typeof catalogAction>){
 const table=tables[action.kind],transaction=atomicMutation(env),now=Date.now();
 transaction.require(activeOperator,actor);
 let entityId:string,old:CatalogRow|null=null;
 if(action.action==='create')entityId=(action.kind==='season'?'sea_':'org_')+randomToken(16);
 else{
  entityId=action.id;old=await env.DB.prepare(catalogSelect(action.kind)+' WHERE e.id=?').bind(entityId).first<CatalogRow>();
  if(!old||old.revision!==action.revision)throw new MutationConflict('목록이 변경되었습니다. 새로고침 후 다시 시도하세요.');
  transaction.require('EXISTS(SELECT 1 FROM catalog_state WHERE kind=? AND entity_id=? AND revision=? AND deleted_at IS ?)',action.kind,entityId,old.revision,old.deleted_at);
 }
 if(action.action==='create'||action.action==='rename'||action.action==='restore'){
  const proposed=action.action==='restore'?old?.name:action.name;
  if(!proposed)throw new MutationConflict('이름을 확인해 주세요.');
  const predicate=`NOT EXISTS(SELECT 1 FROM ${table} e WHERE e.name=? COLLATE NOCASE AND e.id<>? AND ${catalogAvailable(action.kind,'e.id')})`;
  if(await env.DB.prepare(`SELECT 1 WHERE NOT (${predicate})`).bind(proposed,entityId).first())throw new MutationConflict('같은 이름이 이미 있습니다. 구분할 수 있는 이름을 입력하세요.');
  transaction.require(predicate,proposed,entityId);
 }
 switch(action.action){
  case 'create':
   transaction.add(env.DB.prepare(action.kind==='season'?`INSERT INTO ${table} VALUES(?,?,'draft')`:`INSERT INTO ${table} VALUES(?,?)`).bind(entityId,action.name));break;
  case 'rename':transaction.add(env.DB.prepare(`UPDATE ${table} SET name=? WHERE id=?`).bind(action.name,entityId));break;
  case 'delete':
   if(!old||old.deleted_at!==null)throw new MutationConflict('이미 삭제된 항목입니다.');
   if(action.kind==='season'&&old.status==='active')throw new MutationConflict('진행 중인 시즌은 먼저 종료한 뒤 삭제하세요.');
   transaction.add(env.DB.prepare('UPDATE catalog_state SET deleted_at=?,revision=revision+1 WHERE kind=? AND entity_id=?').bind(now,action.kind,entityId));break;
  case 'restore':
   if(!old||old.deleted_at===null)throw new MutationConflict('삭제된 항목만 복구할 수 있습니다.');
   transaction.add(env.DB.prepare('UPDATE catalog_state SET deleted_at=NULL,revision=revision+1 WHERE kind=? AND entity_id=?').bind(action.kind,entityId));break;
  case 'end':
   if(!old||old.deleted_at!==null||old.status!=='active')throw new MutationConflict('진행 중인 시즌만 종료할 수 있습니다.');
   transaction.add(env.DB.prepare("UPDATE member_seasons SET status='archived' WHERE id=?").bind(entityId));break;
 }
 transaction.add(env.DB.prepare("INSERT INTO auth_events VALUES(?,?,NULL,?,?,?)").bind('evt_'+randomToken(10),actor,'catalog.'+action.action,JSON.stringify({kind:action.kind,id:entityId,name:'name' in action?action.name:old?.name,previousName:old?.name,rosterCount:old?.roster_count??0,memberCount:old?.member_count??0,managerCount:old?.manager_count??0,serviceCount:old?.service_count??0}),now));
 await transaction.commit();
 return {ok:true,entity:await env.DB.prepare(catalogSelect(action.kind)+' WHERE e.id=?').bind(entityId).first<CatalogRow>()};
}
