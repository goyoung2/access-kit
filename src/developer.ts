import type {Hono,Context} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {parseCookies} from './http';
import {findSessionUser} from './store';
import {isPlatformAdmin} from './policy';
import {randomToken} from './crypto';
import {installationPage} from './installation-page';
type C=Context<{Bindings:Env}>;
async function developer(c:C){
 const user=await findSessionUser(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid);
 if(!user)return null;
 if(await isPlatformAdmin(c.env,user))return {user,admin:true};
 const row=await c.env.DB.prepare("SELECT d.user_id FROM developers d JOIN users u ON u.id=d.user_id WHERE d.user_id=? AND d.status='active' AND u.status='active'").bind(user).first();
 return row?{user,admin:false}:null;
}
const origin=z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash;},'HTTPS 사이트 루트를 입력하세요.');
const serviceInput=z.object({clientId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),name:z.string().trim().min(1).max(80),siteUrl:origin,mode:z.enum(['approved','season','admin']),organizationId:z.string().min(1).nullable()});
export function registerDeveloperRoutes(app:Hono<{Bindings:Env}>){
 app.get('/developer/install',async c=>{
  const identity=await developer(c);
  if(!identity){const user=await findSessionUser(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid);return user?c.text('개발자 접근 권한이 필요합니다.',403):c.redirect('/auth/firebase?developer=1');}
  return c.html(installationPage());
 });
 app.get('/developer/services',async c=>{
  const identity=await developer(c);if(!identity)return c.json({error:'DEVELOPER_REQUIRED'},403);
  const services=await c.env.DB.prepare(`SELECT a.*,p.mode,p.organization_id FROM applications a JOIN application_owners o ON o.client_id=a.client_id JOIN common_application_policies p ON p.client_id=a.client_id WHERE ?=1 OR o.user_id=? ORDER BY a.name`).bind(identity.admin?1:0,identity.user).all();
  const organizations=await c.env.DB.prepare('SELECT id,name FROM member_organizations ORDER BY name').all();
  return c.json({services:services.results,organizations:organizations.results,authOrigin:new URL(c.req.url).origin,version:'0.1.0'});
 });
 app.post('/developer/services',async c=>{
  if(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('X-Access-Kit-Action')!=='1')return c.json({error:'ORIGIN_DENIED'},403);
  const identity=await developer(c);if(!identity)return c.json({error:'DEVELOPER_REQUIRED'},403);
  const b=serviceInput.parse(await c.req.json()),id=b.clientId||'app_'+randomToken(12),now=Date.now();
  if(b.clientId){
   const owner=await c.env.DB.prepare('SELECT user_id FROM application_owners WHERE client_id=?').bind(id).first<{user_id:string}>();
   if(!owner||(!identity.admin&&owner.user_id!==identity.user))return c.json({error:'OWNER_REQUIRED'},403);
  }
  if(b.mode==='season'&&(!b.organizationId||!await c.env.DB.prepare('SELECT id FROM member_organizations WHERE id=?').bind(b.organizationId).first()))return c.json({error:'ORGANIZATION_REQUIRED'},400);
  await c.env.DB.batch([
   c.env.DB.prepare("INSERT INTO applications VALUES(?,?,?,'active',?,?) ON CONFLICT(client_id) DO UPDATE SET name=excluded.name,redirect_uris=excluded.redirect_uris,updated_at=excluded.updated_at").bind(id,b.name,JSON.stringify([new URL(b.siteUrl).href]),now,now),
   c.env.DB.prepare('INSERT INTO application_owners VALUES(?,?) ON CONFLICT(client_id) DO NOTHING').bind(id,identity.user),
   c.env.DB.prepare('INSERT INTO common_application_policies VALUES(?,?,?) ON CONFLICT(client_id) DO UPDATE SET mode=excluded.mode,organization_id=excluded.organization_id').bind(id,b.mode,b.mode==='season'?b.organizationId:null),
   c.env.DB.prepare("INSERT INTO auth_events VALUES(?,?,?,'service.configure',?,?)").bind('evt_'+randomToken(10),identity.user,id,JSON.stringify({mode:b.mode}),now),
  ]);
  return c.json({clientId:id});
 });
}
