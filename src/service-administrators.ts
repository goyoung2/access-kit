import type {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {consoleIdentity} from './console';
import {atomicMutation,activeOperator} from './atomic-mutation';
import {managesService,serviceManagementSql,managesBoundRoster} from './service-authority';
import {actionInput,mutatePrivateRoster,DeveloperRosterError} from './developer-rosters';
import {mutateRoster,rosterAction} from './console-roster';
import {randomToken} from './crypto';
import {catalogAvailable} from './membership-catalog';

type BoundRoster={readonly id:string;readonly name:string;readonly organization_id:string|null;readonly owner_user_id:string|null;readonly status:string;readonly revision:number};
type Entry={readonly id:string;readonly game_uid:string;readonly nickname:string;readonly status:string;readonly revision:number;readonly realm?:string;readonly season_id?:string};
const administrator=z.object({userId:z.string().min(1).max(192).optional(),gameUid:z.string().regex(/^\d{1,32}$/).optional(),enabled:z.boolean()}).refine(v=>Boolean(v.userId)!==Boolean(v.gameUid));
const reject=()=>new DeveloperRosterError('이 서비스를 관리할 권한이 없습니다.',403);

async function boundRoster(env:Env,clientId:string){
 return env.DB.prepare('SELECT r.* FROM application_rosters b JOIN access_rosters r ON r.id=b.roster_id WHERE b.client_id=?').bind(clientId).first<BoundRoster>();
}
async function sharedSeason(env:Env){return env.DB.prepare(`SELECT id FROM member_seasons s WHERE s.status='active' AND ${catalogAvailable('season','s.id')}`).first<{id:string}>();}
async function rosterEntries(env:Env,roster:BoundRoster|null){
 if(!roster)return [];
 if(!roster.organization_id)return (await env.DB.prepare('SELECT id,game_uid,nickname,status,revision FROM access_roster_entries WHERE roster_id=? ORDER BY nickname,game_uid').bind(roster.id).all<Entry>()).results;
 return (await env.DB.prepare(`SELECT r.id,r.realm,r.game_uid,r.nickname,r.status,r.revision,r.season_id FROM roster_entries r JOIN member_seasons s ON s.id=r.season_id WHERE r.organization_id=? AND s.status='active' AND ${catalogAvailable('season','s.id')} AND ${catalogAvailable('organization','r.organization_id')} ORDER BY r.nickname,r.game_uid`).bind(roster.organization_id).all<Entry>()).results;
}

export function registerServiceAdministrators(app:Hono<{Bindings:Env}>){
 app.get('/console/services/:clientId',async c=>{
  const actor=await consoleIdentity(c),clientId=c.req.param('clientId');if(!actor||!await managesService(c.env,actor.user,clientId))throw reject();
  const service=await c.env.DB.prepare('SELECT client_id,name FROM applications WHERE client_id=?').bind(clientId).first();if(!service)throw reject();
  const roster=await boundRoster(c.env,clientId),canManageRoster=await managesBoundRoster(c.env,actor.user,clientId),entries=canManageRoster?await rosterEntries(c.env,roster):[];
  const administrators=await c.env.DB.prepare(`SELECT a.user_id,a.role,COALESCE(g.nickname,u.display_name) AS name,g.game_uid,u.status FROM (
   SELECT user_id,'owner' AS role FROM application_owners WHERE client_id=? UNION ALL SELECT user_id,'admin' AS role FROM application_administrators WHERE client_id=?
  ) a JOIN users u ON u.id=a.user_id LEFT JOIN game_accounts g ON g.user_id=u.id ORDER BY a.role DESC,name`).bind(clientId,clientId).all();
  const rosterDelegated=Boolean(roster&&await c.env.DB.prepare('SELECT 1 FROM service_roster_grants WHERE client_id=? AND roster_id=?').bind(clientId,roster.id).first());
  const requiresRosterGrant=Boolean(roster&&(roster.organization_id||roster.owner_user_id!==administrators.results.find(row=>row.role==='owner')?.user_id));
  return c.json({service,roster,entries,administrators:administrators.results,shared:Boolean(roster?.organization_id),requiresRosterGrant,canManageRoster,canDelegateRoster:actor.superadmin,rosterDelegated,seasonId:roster?.organization_id?(await sharedSeason(c.env))?.id??null:null});
 });
 app.post('/console/services/:clientId/roster-access',async c=>{
  const actor=await consoleIdentity(c),clientId=c.req.param('clientId');if(!actor?.superadmin)throw reject();
  const {enabled}=z.object({enabled:z.boolean()}).parse(await c.req.json()),roster=await boundRoster(c.env,clientId);if(!roster)throw new DeveloperRosterError('연결 명부가 없습니다.',409);
  const tx=atomicMutation(c.env);tx.require(activeOperator,actor.user);tx.require('EXISTS(SELECT 1 FROM application_rosters WHERE client_id=? AND roster_id=?)',clientId,roster.id);
  tx.add(enabled?c.env.DB.prepare('INSERT INTO service_roster_grants VALUES(?,?,?,?) ON CONFLICT(client_id,roster_id) DO NOTHING').bind(clientId,roster.id,actor.user,Date.now()):c.env.DB.prepare('DELETE FROM service_roster_grants WHERE client_id=? AND roster_id=?').bind(clientId,roster.id));
  tx.add(c.env.DB.prepare("INSERT INTO auth_events VALUES(?,?,?,'service.roster_access',?,?)").bind('evt_'+randomToken(18),actor.user,clientId,JSON.stringify({rosterId:roster.id,enabled}),Date.now()));await tx.commit();return c.json({ok:true});
 });
 app.post('/console/services/:clientId/admins',async c=>{
  const actor=await consoleIdentity(c),clientId=c.req.param('clientId');if(!actor||!await managesService(c.env,actor.user,clientId))throw reject();
  const input=administrator.parse(await c.req.json());let target=input.userId;
  if(!target){const matches=await c.env.DB.prepare('SELECT user_id FROM game_accounts WHERE game_uid=?').bind(input.gameUid).all<{user_id:string}>();if(matches.results.length!==1)throw new DeveloperRosterError('가입을 완료한 계정의 정확한 CID를 입력하세요.',409);target=matches.results[0]?.user_id;}
  if(!target)throw new DeveloperRosterError('관리할 계정을 선택하세요.',409);
  const owner=await c.env.DB.prepare('SELECT user_id FROM application_owners WHERE client_id=?').bind(clientId).first<{user_id:string}>();
  if(owner?.user_id===target){if(!input.enabled)throw new DeveloperRosterError('서비스 소유자는 공동 관리자 목록에서 해제할 수 없습니다.',409);return c.json({ok:true});}
  const tx=atomicMutation(c.env);tx.require(serviceManagementSql,clientId,actor.user,actor.user);
  tx.require('NOT EXISTS(SELECT 1 FROM application_owners WHERE client_id=? AND user_id=?)',clientId,target);
  if(input.enabled)tx.require("EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')",target);
  tx.require('EXISTS(SELECT 1 FROM applications WHERE client_id=?)',clientId);
  tx.add(input.enabled?c.env.DB.prepare('INSERT INTO application_administrators VALUES(?,?,?,?) ON CONFLICT(client_id,user_id) DO NOTHING').bind(clientId,target,actor.user,Date.now()):c.env.DB.prepare('DELETE FROM application_administrators WHERE client_id=? AND user_id=?').bind(clientId,target));
  tx.add(c.env.DB.prepare("INSERT INTO auth_events VALUES(?,?,?,'service.administrator',?,?)").bind('evt_'+randomToken(18),actor.user,clientId,JSON.stringify({userId:target,enabled:input.enabled}),Date.now()));await tx.commit();return c.json({ok:true});
 });
 app.post('/console/services/:clientId/roster',async c=>{
  const actor=await consoleIdentity(c),clientId=c.req.param('clientId');if(!actor||!await managesService(c.env,actor.user,clientId))throw reject();
  const roster=await boundRoster(c.env,clientId);if(!roster)throw new DeveloperRosterError('서비스에 연결된 명부가 없습니다.',409);
  if(!await managesBoundRoster(c.env,actor.user,clientId))throw new DeveloperRosterError('중앙 공유 명부의 관리권한은 중앙 관리자가 이 서비스에 부여해야 합니다.',403);
  const body=await c.req.json<unknown>();
  const input=actionInput.parse({...z.record(z.string(),z.unknown()).parse(body),rosterId:roster.id});
  if(!['entry','remove-entry','restore-entry','preview','import'].includes(input.action))throw new DeveloperRosterError('이 화면에서는 연결 명부의 회원만 관리합니다.',403);
  if(!roster.organization_id)return c.json(await mutatePrivateRoster(c.env,{user:actor.user,admin:actor.superadmin,serviceId:clientId},input));
  const season=await sharedSeason(c.env);if(!season)throw new DeveloperRosterError('공유 명부의 진행 중인 시즌을 먼저 설정하세요.',409);
  const context={realm:'kr',seasonId:season.id,organizationId:roster.organization_id};
  switch(input.action){
   case 'preview':case 'import':return c.json(await mutateRoster(c.env,actor.user,rosterAction.parse({...input,...context}),clientId));
   case 'entry':case 'remove-entry':case 'restore-entry':{
    const entryId=input.entryId;
    const entry=entryId?await c.env.DB.prepare('SELECT * FROM roster_entries WHERE id=? AND organization_id=? AND season_id=?').bind(entryId,roster.organization_id,season.id).first<Entry>():null;
    if(entryId&&!entry)throw reject();
    const action=input.action==='entry'?(entry?'update':'create'):input.action==='remove-entry'?'delete':'restore';
    return c.json(await mutateRoster(c.env,actor.user,rosterAction.parse({...input,...context,realm:entry?.realm??context.realm,action,...(entry?{id:entry.id,revision:input.entryRevision}:{})}),clientId));
   }
   default:throw reject();
  }
 });
}
