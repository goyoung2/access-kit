import type {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {parseCookies} from './http';
import {findSessionUser} from './store';
import {randomToken,sha256Base64Url} from './crypto';
import {atomicMutation,activeOperator} from './atomic-mutation';
import {installationPage} from './installation-page';
import {developerAdminPage,invitationPage} from './developer-admin-page';
import {catalogAvailable} from './membership-catalog';
import {developerIdentity as developer} from './developer-identity';
import {availableRosters,usableRosterSql,defaultRosterSql} from './access-rosters';
import {managesService,serviceManagementSql} from './service-authority';
const origin=z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash;},'HTTPS 사이트 루트를 입력하세요.');
const serviceInput=z.object({clientId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),name:z.string().trim().min(1).max(80),siteUrl:origin,mode:z.enum(['approved','season','admin','roster']).optional(),organizationId:z.string().min(1).nullable().default(null),rosterId:z.string().min(1).max(192).optional()});
export function registerDeveloperRoutes(app:Hono<{Bindings:Env}>){
 app.get('/developer/invitation',c=>c.html(invitationPage()));
 app.get('/developer/admin',async c=>{
  const identity=await developer(c);if(!identity?.admin)return c.text('운영자 로그인이 필요합니다.',403);
  return c.redirect('/console#roles');
 });
 app.get('/developer/admin/data',async c=>{
  const identity=await developer(c);if(!identity?.admin)return c.json({error:'ADMIN_REQUIRED'},403);
  const members=await c.env.DB.prepare("SELECT u.id,u.display_name,u.status AS user_status,d.status AS developer_status FROM users u LEFT JOIN developers d ON d.user_id=u.id ORDER BY u.display_name").all();
  return c.json({members:members.results});
 });
 app.post('/developer/admin/action',async c=>{
  if(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('X-Access-Kit-Action')!=='1')return c.json({error:'ORIGIN_DENIED'},403);
  const identity=await developer(c);if(!identity?.admin)return c.json({error:'ADMIN_REQUIRED'},403);
  const b=z.discriminatedUnion('action',[
   z.object({action:z.literal('invite')}),
   z.object({action:z.literal('permission'),userId:z.string().min(1).max(128),status:z.enum(['active','inactive'])}),
  ]).parse(await c.req.json());
  const now=Date.now();
  const transaction=atomicMutation(c.env);transaction.require(activeOperator,identity.user);
  switch(b.action){
   case 'invite':{
    const token=randomToken(32);transaction.add(c.env.DB.prepare('INSERT INTO developer_invitations VALUES(?,?,?,?,NULL,NULL)').bind(await sha256Base64Url(token),identity.user,now,now+7*86400000));await transaction.commit();
    return c.json({url:new URL('/developer/invitation',c.req.url).href+'#'+token,expiresAt:now+7*86400000});
   }
   case 'permission':{
    const user=await c.env.DB.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(b.userId).first();if(!user)return c.json({error:'ACTIVE_USER_REQUIRED'},400);
    transaction.require("EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')",b.userId);
    transaction.add(
     c.env.DB.prepare('INSERT INTO developers VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status').bind(b.userId,b.status),
     c.env.DB.prepare("INSERT INTO auth_events VALUES(?,?,NULL,'developer.permission',?,?)").bind('evt_'+randomToken(10),identity.user,JSON.stringify({userId:b.userId,status:b.status}),now),
    );await transaction.commit();return c.json({ok:true});
   }
  }
 });
 app.post('/developer/invitation/redeem',async c=>{
  if(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('X-Access-Kit-Action')!=='1')return c.json({error:'ORIGIN_DENIED'},403);
  const user=await findSessionUser(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid);if(!user)return c.json({error:'LOGIN_REQUIRED'},401);
  const b=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).parse(await c.req.json()),hash=await sha256Base64Url(b.token),now=Date.now();
  // Single atomic UPDATE wins a race. The transaction grants only the recorded recipient.
  const results=await c.env.DB.batch([
   c.env.DB.prepare('UPDATE developer_invitations SET redeemed_by=?,redeemed_at=? WHERE token_hash=? AND expires_at>? AND redeemed_by IS NULL').bind(user,now,hash,now),
   c.env.DB.prepare("INSERT INTO developers(user_id,status) SELECT redeemed_by,'active' FROM developer_invitations WHERE token_hash=? AND redeemed_by=? AND redeemed_at=? AND changes()=1 ON CONFLICT(user_id) DO UPDATE SET status='active'").bind(hash,user,now),
  ]);
  if(results[0]?.meta.changes!==1)return c.json({error:'INVITATION_EXPIRED_OR_USED'},409);
  return c.json({ok:true});
 });
 app.get('/developer/install',async c=>{
  const identity=await developer(c);
  if(!identity){const user=await findSessionUser(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid);return user?c.text('개발자 접근 권한이 필요합니다.',403):c.redirect('/auth/firebase?developer=1');}
  return c.html(installationPage());
 });
 app.get('/developer/services',async c=>{
  const identity=await developer(c);if(!identity)return c.json({error:'DEVELOPER_REQUIRED'},403);
  const services=await c.env.DB.prepare(`SELECT a.*,o.user_id AS owner_user_id,p.mode,p.organization_id,COALESCE(b.roster_id,CASE WHEN p.mode='season' THEN 'shared_'||p.organization_id END) AS roster_id FROM applications a JOIN application_owners o ON o.client_id=a.client_id JOIN common_application_policies p ON p.client_id=a.client_id LEFT JOIN application_rosters b ON b.client_id=a.client_id WHERE ?=1 OR EXISTS(SELECT 1 FROM service_managers m WHERE m.client_id=a.client_id AND m.user_id=?) ORDER BY a.name`).bind(identity.admin?1:0,identity.user).all();
  const organizations=await c.env.DB.prepare(`SELECT id,name FROM member_organizations o WHERE ${catalogAvailable('organization','o.id')} ORDER BY name`).all();
  const choices=await availableRosters(c.env,identity.user,identity.admin,identity.serviceOnly);
  if(services.results.some(s=>s.roster_id&&!choices.some(r=>r.id===s.roster_id))){for(const r of await availableRosters(c.env,identity.user,identity.admin,true))if(!choices.some(existing=>existing.id===r.id))choices.push(r);}
  const managedRosterIds=new Set(services.results.map(row=>row.roster_id));
  const rosters=identity.serviceOnly?choices.filter(row=>managedRosterIds.has(row.id)):choices;
  return c.json({services:services.results.map(s=>({...s,canChangePolicy:identity.admin||s.owner_user_id===identity.user})),organizations:identity.serviceOnly?organizations.results.filter(row=>rosters.some(r=>r.organization_id===row.id)):organizations.results,rosters,defaultRosterId:identity.serviceOnly?null:await c.env.DB.prepare(defaultRosterSql).first<string>('id'),authOrigin:new URL(c.req.url).origin,version:'0.4.0',admin:identity.admin,serviceOnly:identity.serviceOnly});
 });
 app.post('/developer/services',async c=>{
  if(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('X-Access-Kit-Action')!=='1')return c.json({error:'ORIGIN_DENIED'},403);
  const identity=await developer(c);if(!identity)return c.json({error:'DEVELOPER_REQUIRED'},403);
  const b=serviceInput.parse(await c.req.json()),id=b.clientId||'app_'+randomToken(12),now=Date.now();
  if(identity.serviceOnly&&!b.clientId)return c.json({error:'SERVICE_ADMIN_CANNOT_CREATE_SERVICE'},403);
  let owns=false;
  if(b.clientId){
   const owner=await c.env.DB.prepare('SELECT user_id FROM application_owners WHERE client_id=?').bind(id).first<{user_id:string}>();
   owns=owner?.user_id===identity.user;
   if(!owner||!await managesService(c.env,identity.user,id))return c.json({error:'OWNER_REQUIRED'},403);
  }
  const previousPolicy=b.clientId?await c.env.DB.prepare(`SELECT p.mode,p.organization_id,COALESCE(b.roster_id,CASE WHEN p.mode='season' THEN 'shared_'||p.organization_id END) AS roster_id FROM common_application_policies p LEFT JOIN application_rosters b ON b.client_id=p.client_id WHERE p.client_id=?`)
   .bind(id).first<{mode:'approved'|'season'|'admin'|'roster';organization_id:string|null;roster_id:string|null}>():null;
  const mode=b.mode??previousPolicy?.mode??'roster',organizationId=b.mode===undefined?(previousPolicy?.organization_id??b.organizationId):b.organizationId;
  if(mode==='season'&&(!organizationId||!await c.env.DB.prepare(`SELECT id FROM member_organizations o WHERE o.id=? AND ${catalogAvailable('organization','o.id')}`).bind(organizationId).first()))return c.json({error:'ORGANIZATION_REQUIRED'},400);
  const rosterId=mode==='roster'?(b.rosterId??previousPolicy?.roster_id??await c.env.DB.prepare(defaultRosterSql).first<string>('id')):null;
  const linkedRosterId=mode==='season'&&organizationId?'shared_'+organizationId:rosterId;
  if(b.clientId&&!identity.admin&&!owns&&(mode!==previousPolicy?.mode||organizationId!==previousPolicy?.organization_id||linkedRosterId!==previousPolicy?.roster_id))return c.json({error:'SERVICE_OWNER_REQUIRED_TO_CHANGE_ROSTER'},403);
  const rosterGuard=`EXISTS(SELECT 1 FROM access_rosters r WHERE r.id=? AND ${usableRosterSql} AND (r.owner_user_id IS NULL OR r.owner_user_id=? OR ${activeOperator}))`;
  if(mode==='roster'&&(!rosterId||(owns||identity.admin||!b.clientId)&&!await c.env.DB.prepare('SELECT 1 WHERE '+rosterGuard).bind(rosterId,identity.user,identity.user).first()))return c.json({error:'ROSTER_REQUIRED'},400);
  const transaction=atomicMutation(c.env);
  if(mode==='season')transaction.require(catalogAvailable('organization','?'),organizationId);
  if(mode==='roster'&&(owns||identity.admin||!b.clientId))transaction.require(rosterGuard,rosterId,identity.user,identity.user);
  if(!b.clientId)transaction.require(`${activeOperator} OR EXISTS(SELECT 1 FROM developers d JOIN users u ON u.id=d.user_id WHERE d.user_id=? AND d.status='active' AND u.status='active')`,identity.user,identity.user);
  if(b.clientId) {
   transaction.require(serviceManagementSql,id,identity.user,identity.user);
   if(!identity.admin&&!owns)transaction.require('EXISTS(SELECT 1 FROM common_application_policies p LEFT JOIN application_rosters b ON b.client_id=p.client_id WHERE p.client_id=? AND p.mode=? AND p.organization_id IS ? AND b.roster_id IS ?)',id,previousPolicy?.mode??null,previousPolicy?.organization_id??null,previousPolicy?.roster_id??null);
  }
  const previous=b.clientId?await c.env.DB.prepare('SELECT redirect_uris FROM applications WHERE client_id=?').bind(id).first<{redirect_uris:string}>():null;
  const previousUris=previous?z.array(z.string()).parse(JSON.parse(previous.redirect_uris)):[];
  const redirectUris=[...new Set([new URL(b.siteUrl).href,...previousUris.slice(1)])];
  transaction.add(
   c.env.DB.prepare("INSERT INTO applications VALUES(?,?,?,'active',?,?) ON CONFLICT(client_id) DO UPDATE SET name=excluded.name,redirect_uris=excluded.redirect_uris,updated_at=excluded.updated_at").bind(id,b.name,JSON.stringify(redirectUris),now,now),
   c.env.DB.prepare('INSERT INTO application_owners VALUES(?,?) ON CONFLICT(client_id) DO NOTHING').bind(id,identity.user),
   c.env.DB.prepare('INSERT INTO common_application_policies VALUES(?,?,?) ON CONFLICT(client_id) DO UPDATE SET mode=excluded.mode,organization_id=excluded.organization_id').bind(id,mode,mode==='season'?organizationId:null),
   c.env.DB.prepare("INSERT INTO auth_events VALUES(?,?,?,'service.configure',?,?)").bind('evt_'+randomToken(10),identity.user,id,JSON.stringify({mode,rosterId}),now),
  );
  if(linkedRosterId)transaction.add(c.env.DB.prepare('INSERT INTO application_rosters VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET roster_id=excluded.roster_id').bind(id,linkedRosterId));
  else transaction.add(c.env.DB.prepare('DELETE FROM application_rosters WHERE client_id=?').bind(id));
  await transaction.commit();
  return c.json({clientId:id});
 });
}
