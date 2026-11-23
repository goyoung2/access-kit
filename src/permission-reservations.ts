import type {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {consoleIdentity} from './console';
import {parseCookies} from './http';
import {findSessionUser} from './store';
import {randomToken,sha256Base64Url} from './crypto';
import {atomicMutation,activeOperator} from './atomic-mutation';
import {serviceManagementSql,managesService} from './service-authority';
import {catalogAvailable} from './membership-catalog';
import {DeveloperRosterError} from './developer-rosters';
import {permissionInvitationPage} from './permission-reservations-ui';

const reservationInput=z.discriminatedUnion('role',[
 z.object({role:z.literal('developer')}),z.object({role:z.literal('superadmin')}),
 z.object({role:z.literal('manager'),organizationId:z.string().min(1).max(192)}),
 z.object({role:z.literal('service_admin'),clientId:z.string().min(1).max(192)}),
]);
const createInput=z.object({gameUid:z.string().regex(/^\d{1,32}$/).transform(v=>v.replace(/^0+(?=\d)/,''))}).and(reservationInput);
const tokenInput=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)});
const pageCursor=z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).transform((value,ctx):unknown=>{
 try{return JSON.parse(atob(value.replaceAll('-','+').replaceAll('_','/')));}
 catch(error){if(!(error instanceof Error))throw error;ctx.addIssue({code:'custom',message:'목록 위치를 확인해 주세요.'});return z.NEVER;}
}).pipe(z.object({createdAt:z.number().int().nonnegative(),id:z.string().min(1).max(192)}));
type Actor={readonly user:string;readonly superadmin:boolean};
type Reservation={readonly id:string;readonly game_uid:string;readonly role:'developer'|'superadmin'|'manager'|'service_admin';readonly client_id:string|null;readonly organization_id:string|null;readonly created_by:string;readonly created_at:number;readonly expires_at:number;readonly revoked_at:number|null;readonly redeemed_by:string|null;readonly redeemed_at:number|null};
const columns='id,game_uid,role,client_id,organization_id,created_by,created_at,expires_at,revoked_at,redeemed_by,redeemed_at';
const denied=()=>new DeveloperRosterError('이 권한을 예약하거나 회수할 수 없습니다.',403);
function authority(tx:ReturnType<typeof atomicMutation>,actor:string,role:Reservation['role'],clientId:string|null){
 if(role==='service_admin')tx.require(serviceManagementSql,clientId,actor,actor);
 else tx.require(activeOperator,actor);
}
async function canReserve(env:Env,actor:Actor,role:Reservation['role'],clientId:string|null){return actor.superadmin||(role==='service_admin'&&Boolean(clientId)&&await managesService(env,actor.user,clientId??''));}
export async function reservationList(env:Env,actor:Actor,clientId?:string,cursor?:string){
 if(clientId){if(!await managesService(env,actor.user,clientId))throw denied();}
 else if(!actor.superadmin)throw denied();
 const after=pageCursor.optional().parse(cursor),predicates:string[]=[],values:(string|number)[]=[];
 if(clientId){predicates.push('client_id=?');values.push(clientId);}
 if(after){predicates.push('(created_at<? OR (created_at=? AND id<?))');values.push(after.createdAt,after.createdAt,after.id);}
 const result=(await env.DB.prepare('SELECT '+columns+' FROM permission_reservations'+(predicates.length?' WHERE '+predicates.join(' AND '):'')+' ORDER BY created_at DESC,id DESC LIMIT 101').bind(...values).all<Reservation>()).results;
 const reservations=result.slice(0,100),last=reservations.at(-1);
 const nextCursor=result.length>100&&last?btoa(JSON.stringify({createdAt:last.created_at,id:last.id})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''):null;
 return {reservations,nextCursor};
}
export async function reservePermission(env:Env,actor:Actor,body:unknown,origin:string,scope?:string){
 const input=createInput.parse(body),clientId=input.role==='service_admin'?input.clientId:null,organizationId=input.role==='manager'?input.organizationId:null;
 if(scope&&(input.role!=='service_admin'||clientId!==scope))throw denied();
 if(!await canReserve(env,actor,input.role,clientId))throw denied();
 const now=Date.now(),expiresAt=now+7*86400000,id='grant_'+randomToken(18),token=randomToken(32),tx=atomicMutation(env);
 authority(tx,actor.user,input.role,clientId);
 if(clientId)tx.require("EXISTS(SELECT 1 FROM applications WHERE client_id=? AND status='active')",clientId);
 if(organizationId)tx.require(catalogAvailable('organization','?'),organizationId);
 tx.add(env.DB.prepare('INSERT INTO permission_reservations VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)').bind(id,input.gameUid,input.role,clientId,organizationId,await sha256Base64Url(token),actor.user,now,expiresAt));
 tx.add(env.DB.prepare("INSERT INTO auth_events VALUES(?,?,?,'permission.reserve',?,?)").bind('evt_'+randomToken(18),actor.user,clientId,JSON.stringify({id,gameUid:input.gameUid,role:input.role,organizationId}),now));
 await tx.commit();return {id,url:new URL('/permissions/invitation',origin).href+'#'+token,expiresAt};
}
export async function revokeReservation(env:Env,actor:Actor,id:string,scope?:string){
 const row=await env.DB.prepare('SELECT '+columns+' FROM permission_reservations WHERE id=?').bind(id).first<Reservation>();
 if(!row||scope&&row.client_id!==scope||!await canReserve(env,actor,row.role,row.client_id))throw denied();
 const now=Date.now(),tx=atomicMutation(env);authority(tx,actor.user,row.role,row.client_id);
 tx.require('EXISTS(SELECT 1 FROM permission_reservations WHERE id=? AND redeemed_at IS NULL AND revoked_at IS NULL)',id);
 tx.add(env.DB.prepare('UPDATE permission_reservations SET revoked_at=? WHERE id=?').bind(now,id));
 tx.add(env.DB.prepare("INSERT INTO auth_events VALUES(?,?,?,'permission.cancel',?,?)").bind('evt_'+randomToken(18),actor.user,row.client_id,JSON.stringify({id}),now));await tx.commit();return {ok:true};
}
async function invitation(env:Env,token:string){
 const row=await env.DB.prepare('SELECT '+columns+' FROM permission_reservations WHERE token_hash=?').bind(await sha256Base64Url(token)).first<Reservation>();
 if(!row||row.revoked_at||row.redeemed_at||row.expires_at<=Date.now())throw new DeveloperRosterError('만료되었거나 취소·사용된 초대입니다.',409);
 return row;
}
export function registerPermissionReservations(app:Hono<{Bindings:Env}>){
 app.get('/permissions/invitation',c=>c.html(permissionInvitationPage()));
 for(const path of ['/console/permission-reservations','/console/services/:clientId/invitations']){
  app.get(path,async c=>{const actor=await consoleIdentity(c);if(!actor)throw denied();return c.json(await reservationList(c.env,actor,c.req.param('clientId'),c.req.query('cursor')));});
  app.post(path,async c=>{
   const actor=await consoleIdentity(c);if(!actor)throw denied();
   const body=z.object({action:z.enum(['create','revoke']),id:z.string().min(1).optional()}).passthrough().parse(await c.req.json()),scope=c.req.param('clientId');
   if(!scope&&!actor.superadmin)throw denied();
   return c.json(body.action==='create'?await reservePermission(c.env,actor,body,new URL(c.req.url).origin,scope):await revokeReservation(c.env,actor,z.string().min(1).parse(body.id),scope));
  });
 }
 app.use('/permissions/*',async(c,next)=>{if(c.req.method==='POST'&&(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('X-Access-Kit-Action')!=='1'))return c.json({error:'요청 출처를 확인해 주세요.'},403);await next();});
 app.post('/permissions/preview',async c=>{
  const input=tokenInput.parse(await c.req.json()),row=await invitation(c.env,input.token);
  const scopeName=row.client_id?await c.env.DB.prepare('SELECT name FROM applications WHERE client_id=?').bind(row.client_id).first<string>('name'):row.organization_id?await c.env.DB.prepare('SELECT name FROM member_organizations WHERE id=?').bind(row.organization_id).first<string>('name'):'이 인증 환경';
  return c.json({gameUid:row.game_uid,role:row.role,scopeName,expiresAt:row.expires_at});
 });
 app.post('/permissions/accept',async c=>{
  const user=await findSessionUser(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid);if(!user)return c.json({error:'먼저 Google 로그인과 닉네임·CID 가입을 완료해 주세요.'},401);
  const input=tokenInput.parse(await c.req.json()),row=await invitation(c.env,input.token),now=Date.now(),tx=atomicMutation(c.env);
  tx.require("EXISTS(SELECT 1 FROM users u JOIN game_accounts g ON g.user_id=u.id WHERE u.id=? AND u.status='active' AND g.game_uid=?) AND (SELECT COUNT(*) FROM game_accounts WHERE game_uid=?)=1 AND NOT EXISTS(SELECT 1 FROM common_members WHERE user_id=? AND status='suspended')",user,row.game_uid,row.game_uid,user);
  tx.require('EXISTS(SELECT 1 FROM permission_reservations WHERE id=? AND token_hash=? AND expires_at>? AND revoked_at IS NULL AND redeemed_at IS NULL)',row.id,await sha256Base64Url(input.token),now);
  // The inviter must still hold this exact authority when the recipient accepts.
  authority(tx,row.created_by,row.role,row.client_id);
  let grant:D1PreparedStatement;
  switch(row.role){
   case 'developer':grant=c.env.DB.prepare("INSERT INTO developers VALUES(?,'active') ON CONFLICT(user_id) DO UPDATE SET status='active'").bind(user);break;
   case 'superadmin':grant=c.env.DB.prepare("INSERT INTO auth_operators VALUES(?,'operator',?,?) ON CONFLICT(user_id) DO NOTHING").bind(user,now,row.created_by);break;
   case 'manager':tx.require(catalogAvailable('organization','?'),row.organization_id);grant=c.env.DB.prepare('INSERT INTO member_managers VALUES(?,?,?,?) ON CONFLICT(user_id,organization_id) DO NOTHING').bind(user,row.organization_id,row.created_by,now);break;
   case 'service_admin':
    tx.require("EXISTS(SELECT 1 FROM applications WHERE client_id=? AND status='active') AND NOT EXISTS(SELECT 1 FROM application_owners WHERE client_id=? AND user_id=?)",row.client_id,row.client_id,user);
    grant=c.env.DB.prepare('INSERT INTO application_administrators VALUES(?,?,?,?) ON CONFLICT(client_id,user_id) DO NOTHING').bind(row.client_id,user,row.created_by,now);break;
  }
  tx.add(grant,c.env.DB.prepare('UPDATE permission_reservations SET redeemed_by=?,redeemed_at=? WHERE id=?').bind(user,now,row.id));
  tx.add(c.env.DB.prepare("INSERT INTO auth_events VALUES(?,?,?,'permission.accept',?,?)").bind('evt_'+randomToken(18),user,row.client_id,JSON.stringify({id:row.id,role:row.role}),now));
  await tx.commit();return c.json({ok:true,role:row.role});
 });
}
