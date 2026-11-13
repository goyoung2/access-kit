import type {Hono,Context} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {findSessionUser,deleteSession} from './store';
import {parseCookies,sessionCookie} from './http';
import {diagnoseApplicationAccess} from './policy';
import {adminAction,mutateMembership} from './common-admin';
import {randomToken} from './crypto';
import {brandingInput,getBranding} from './branding';
import {consolePage} from './console-ui';
import {atomicMutation,activeOperator} from './atomic-mutation';
import {rosterAction,mutateRoster,RosterError} from './console-roster';
import {catalogAction,mutateCatalog,catalogAvailable} from './membership-catalog';
import {consoleData} from './console-data';
type C=Context<{Bindings:Env}>;
const scopeList=z.array(z.string());
export async function consoleIdentity(c:C){
 const user=await findSessionUser(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid);if(!user)return null;
 const active=await c.env.DB.prepare(`SELECT u.display_name,
  EXISTS(SELECT 1 FROM auth_operators WHERE user_id=u.id) AS superadmin,
  (SELECT json_group_array(organization_id) FROM member_managers WHERE user_id=u.id AND ${catalogAvailable('organization','organization_id')}) AS scopes,
  EXISTS(SELECT 1 FROM developers WHERE user_id=u.id AND status='active') AS developer
  FROM users u WHERE u.id=? AND u.status='active'`).bind(user).first<{display_name:string;superadmin:number;scopes:string;developer:number}>();
 if(!active)return null;
 return {user,name:active.display_name,superadmin:Boolean(active.superadmin),scopes:scopeList.parse(JSON.parse(active.scopes)),developer:Boolean(active.developer)};
}
const roleInput=z.object({userId:z.string().min(1),role:z.enum(['superadmin','manager','developer']),enabled:z.boolean(),organizationId:z.string().optional()});
export function registerConsole(app:Hono<{Bindings:Env}>){
 app.use('/console/*',async(c,next)=>{if(c.req.method==='POST'&&(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('X-Access-Kit-Action')!=='1'))return c.json({error:'요청 출처를 확인해 주세요.'},403);await next();});
 app.get('/console',async c=>{const i=await consoleIdentity(c);if(!i)return c.redirect('/auth/firebase?console=1');if(!i.superadmin&&!i.scopes.length&&!i.developer)return c.text('관리 권한이 없습니다.',403);return c.html(consolePage());});
 app.post('/console/logout',async c=>{await deleteSession(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid);c.header('Set-Cookie',sessionCookie('',true,0));return c.json({ok:true});});
 app.get('/console/data',async c=>{
  const i=await consoleIdentity(c);if(!i||(!i.superadmin&&!i.scopes.length&&!i.developer))return c.json({error:'관리 권한이 없습니다.'},403);
  const snapshot=await consoleData(c.env,i);
  if(snapshot===null)throw new Error('Console snapshot unavailable');
  return c.body(snapshot,200,{'Content-Type':'application/json; charset=UTF-8'});
 });
 app.post('/console/roster',async c=>{
  const i=await consoleIdentity(c);if(!i||(!i.superadmin&&!i.scopes.length))return c.json({error:'명부 관리 권한이 필요합니다.'},403);
  try{return c.json(await mutateRoster(c.env,i.user,rosterAction.parse(await c.req.json())));}
  catch(error){
   if(error instanceof RosterError)return c.json({error:error.message},error.status);
   if(error instanceof SyntaxError)return c.json({error:'JSON 요청 형식을 확인하세요.'},400);
   throw error;
  }
 });
 app.post('/console/catalog',async c=>{
  const identity=await consoleIdentity(c);if(!identity?.superadmin)return c.json({error:'최고 관리자 권한이 필요합니다.'},403);
  try{return c.json(await mutateCatalog(c.env,identity.user,catalogAction.parse(await c.req.json())));}
  catch(error){if(error instanceof SyntaxError)return c.json({error:'JSON 요청 형식을 확인하세요.'},400);throw error;}
 });
 app.post('/console/membership',async c=>{
  const i=await consoleIdentity(c);if(!i)return c.json({error:'관리 권한이 없습니다.'},403);
  const a=adminAction.parse(await c.req.json());
  if(!i.superadmin){
   if(a.action==='approve'){if(!i.scopes.includes(a.organizationId)||a.existingUserId)return c.json({error:'담당 소속의 신규 승인만 가능합니다.'},403);}
   else if(a.action==='assign'){
    const existing=await c.env.DB.prepare('SELECT organization_id FROM season_memberships WHERE user_id=? AND season_id=?').bind(a.userId,a.seasonId).first<{organization_id:string}>();
    if(!i.scopes.includes(a.organizationId)||(existing&&!i.scopes.includes(existing.organization_id)))return c.json({error:'담당 범위 밖의 회원 소속은 변경할 수 없습니다.'},403);
    const known=await c.env.DB.prepare('SELECT user_id FROM season_memberships WHERE user_id=? AND organization_id=?').bind(a.userId,a.organizationId).first();if(!known)return c.json({error:'담당 소속의 회원만 변경할 수 있습니다.'},403);
   }else return c.json({error:'최고 관리자 권한이 필요합니다.'},403);
  }
  await mutateMembership(c.env,i.user,a);return c.json({ok:true});
 });
 app.post('/console/role',async c=>{
  const i=await consoleIdentity(c);if(!i?.superadmin)return c.json({error:'최고 관리자 권한이 필요합니다.'},403);
  const a=roleInput.parse(await c.req.json());
  if(a.userId===i.user&&a.role==='superadmin'&&!a.enabled)return c.json({error:'본인의 최고 관리자 권한은 다른 최고 관리자가 회수해야 합니다.'},409);
  if(!await c.env.DB.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(a.userId).first())return c.json({error:'활성 계정을 선택해 주세요.'},400);
  const q=(s:string,...v:(string|number)[])=>c.env.DB.prepare(s).bind(...v),now=Date.now();let change:D1PreparedStatement;
  switch(a.role){
   case 'superadmin':change=a.enabled?q("INSERT INTO auth_operators VALUES(?,'operator',?,?) ON CONFLICT(user_id) DO NOTHING",a.userId,now,i.user):q('DELETE FROM auth_operators WHERE user_id=?',a.userId);break;
   case 'manager':if(!a.organizationId||!await q('SELECT id FROM member_organizations WHERE id=?',a.organizationId).first())return c.json({error:'담당 소속을 선택해 주세요.'},400);change=a.enabled?q('INSERT INTO member_managers VALUES(?,?,?,?) ON CONFLICT(user_id,organization_id) DO NOTHING',a.userId,a.organizationId,i.user,now):q('DELETE FROM member_managers WHERE user_id=? AND organization_id=?',a.userId,a.organizationId);break;
   case 'developer':change=q('INSERT INTO developers VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status',a.userId,a.enabled?'active':'inactive');break;
  }
  const transaction=atomicMutation(c.env);
  transaction.require(activeOperator,i.user);
  if(a.role==='manager'&&a.enabled)transaction.require(catalogAvailable('organization','?'),a.organizationId??null);
  transaction.require("EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')",a.userId);
  transaction.add(change,q("INSERT INTO auth_events VALUES(?,?,NULL,'console.role',?,?)",'evt_'+randomToken(10),i.user,JSON.stringify(a),now));
  await transaction.commit();return c.json({ok:true});
 });
 app.get('/console/access',async c=>{
  const i=await consoleIdentity(c);if(!i?.superadmin)return c.json({error:'최고 관리자 권한이 필요합니다.'},403);
  const userId=z.string().min(1).parse(c.req.query('userId'));const services=await c.env.DB.prepare('SELECT client_id,name FROM applications').all<{client_id:string;name:string}>();
  return c.json({services:await Promise.all(services.results.map(async s=>({...s,...await diagnoseApplicationAccess(c.env,userId,s.client_id)})))});
 });
 app.post('/console/branding',async c=>{
  const i=await consoleIdentity(c);if(!i)return c.json({error:'관리 권한이 없습니다.'},403);const a=brandingInput.parse(await c.req.json());
  if(!i.superadmin&&(!i.developer||!await c.env.DB.prepare('SELECT client_id FROM application_owners WHERE client_id=? AND user_id=?').bind(a.clientId,i.user).first()))return c.json({error:'본인 서비스만 설정할 수 있습니다.'},403);
  const transaction=atomicMutation(c.env);
  transaction.require(`${activeOperator} OR EXISTS(SELECT 1 FROM application_owners o JOIN developers d ON d.user_id=o.user_id JOIN users u ON u.id=d.user_id WHERE o.client_id=? AND o.user_id=? AND d.status='active' AND u.status='active')`,i.user,a.clientId,i.user);
  transaction.add(c.env.DB.prepare('INSERT INTO login_branding VALUES(?,?,?,?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET title=excluded.title,description=excluded.description,logo_url=excluded.logo_url,accent=excluded.accent,theme=excluded.theme,updated_at=excluded.updated_at').bind(a.clientId,a.title,a.description,a.logoUrl,a.accent,a.theme,Date.now()),c.env.DB.prepare("INSERT INTO auth_events VALUES(?,?,?,'console.branding',?,?)").bind('evt_'+randomToken(10),i.user,a.clientId,JSON.stringify({title:a.title,theme:a.theme}),Date.now()));await transaction.commit();return c.json({ok:true});
 });
 app.get('/public/branding',async c=>{const id=c.req.query('client_id')||'';if(!await c.env.DB.prepare("SELECT client_id FROM applications WHERE client_id=? AND status='active'").bind(id).first())return c.json({error:'NOT_FOUND'},404);c.header('Access-Control-Allow-Origin','*');c.header('Cache-Control','public,max-age=300');return c.json(await getBranding(c.env,id));});
}
