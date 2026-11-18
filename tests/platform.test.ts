import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';
import {registerDeveloperRoutes} from '../src/developer';
import {mutateMembership} from '../src/common-admin';
import {commonAccess} from '../src/common-membership';
import app from '../src/index';

test('developer installation requires explicit permission and preserves service ownership',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 const routes=new Hono<{Bindings:typeof f.env}>();registerDeveloperRoutes(routes);
 const session=await createSession(f.env,'user'),cookie='accesskit_sid='+session.token;
 const request=(path:string,method='GET',body?:unknown,origin='https://auth.test')=>routes.request('https://auth.test'+path,{method,headers:{Cookie:cookie,Origin:origin,'X-Access-Kit-Action':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},f.env);
 assert.equal((await request('/developer/install')).status,403);
 await f.DB.prepare("INSERT INTO developers VALUES('user','active')").run();
 assert.equal((await request('/developer/install')).status,200);
 const config={name:'Consumer',siteUrl:'https://consumer.test/',mode:'approved',organizationId:null};
 assert.equal((await request('/developer/services','POST',config,'https://evil.test')).status,403);
 const result=await request('/developer/services','POST',config);assert.equal(result.status,200);
 const created=await result.json() as {clientId:string};
 assert.equal((await f.DB.prepare('SELECT mode FROM common_application_policies WHERE client_id=?').bind(created.clientId).first())?.mode,'approved');
 await f.DB.prepare("INSERT INTO users VALUES('other','Other',NULL,'active',0,0)").run();
 await f.DB.prepare("UPDATE application_owners SET user_id='other' WHERE client_id=?").bind(created.clientId).run();
 assert.equal((await request('/developer/services','POST',{...config,clientId:created.clientId})).status,403);
});

test('new unconfigured services deny access; approved and seasonal qualifications stay separate',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 assert.equal(await commonAccess(f.env,'user','site'),null);
 await f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)").run();
 await f.DB.batch([
  f.DB.prepare("INSERT INTO member_organizations VALUES('org','Org')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('s1','S1','active'),('s2','S2','draft')"),
  f.DB.prepare("INSERT INTO member_applications VALUES('user','kr','123','Nick','pending',0,NULL,NULL)"),
  f.DB.prepare("INSERT INTO common_application_policies VALUES('site','season','org')"),
 ]);
 await mutateMembership(f.env,'user',{action:'approve',userId:'user',seasonId:'s1',organizationId:'org'});
 assert.equal((await commonAccess(f.env,'user','site'))?.access.allowed,true);
 await mutateMembership(f.env,'user',{action:'activate',seasonId:'s2'});
 assert.equal((await commonAccess(f.env,'user','site'))?.access.allowed,false);
 await mutateMembership(f.env,'user',{action:'policy',clientId:'site',mode:'approved',organizationId:null});
 assert.equal((await commonAccess(f.env,'user','site'))?.access.allowed,true);
});

test('HTTP authorization enforces registered callback and PKCE input; SDK has no fixed host',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 const base='https://auth.test';
 const q=new URLSearchParams({client_id:'site',redirect_uri:'https://evil.test/',response_type:'code',code_challenge:'a'.repeat(43),code_challenge_method:'S256',state:'b'.repeat(24)});
 assert.equal((await app.request(base+'/authorize?'+q,{},f.env)).status,400);
 q.set('redirect_uri','https://site.test/');
 const response=await app.request(base+'/authorize?'+q,{},f.env);assert.equal(response.status,302);assert.match(response.headers.get('location')||'',/^\/auth\/firebase\?request=/);
 const sdk=await app.request(base+'/sdk/v0.1.0/access-kit.js',{},f.env);assert.equal(sdk.status,200);
 assert.equal((await sdk.text()).includes('workers.dev'),false);
 const denied=await app.request(base+'/me?client_id=site',{headers:{Authorization:'Bearer unknown'}},f.env);assert.equal(denied.status,401);
 const cors=await app.request(base+'/token?client_id=site',{method:'OPTIONS',headers:{Origin:'https://evil.test'}},f.env);assert.equal(cors.status,403);
});

test('operator invites developers once and can revoke access without granting membership',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)").run();
 const session=await createSession(f.env,'user');
 const request=(cookie:string,path:string,body:unknown)=>app.request('https://auth.test'+path,{method:'POST',headers:{Cookie:cookie,Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},body:JSON.stringify(body)},f.env);
 const op='accesskit_sid='+session.token;
 const invitation=await request(op,'/developer/admin/action',{action:'invite'});
 assert.equal(invitation.status,200);const payload=await invitation.json();
 assert.ok(typeof payload==='object'&&payload!==null&&'url' in payload&&typeof payload.url==='string');
 const token=new URL(payload.url).hash.slice(1);
 await f.DB.prepare("INSERT INTO users VALUES('dev','Developer',NULL,'active',0,0)").run();
 const dev='accesskit_sid='+(await createSession(f.env,'dev')).token;
 assert.equal((await request(dev,'/developer/admin/action',{action:'invite'})).status,403);
 assert.equal((await request(dev,'/developer/invitation/redeem',{token})).status,200);
 assert.equal((await request(dev,'/developer/invitation/redeem',{token})).status,409);
 assert.equal((await f.DB.prepare("SELECT status FROM developers WHERE user_id='dev'").first())?.status,'active');
 assert.equal(await f.DB.prepare("SELECT user_id FROM common_members WHERE user_id='dev'").first(),null);
 assert.equal((await request(op,'/developer/admin/action',{action:'permission',userId:'dev',status:'inactive'})).status,200);
 assert.equal((await app.request('https://auth.test/developer/install',{headers:{Cookie:dev}},f.env)).status,403);
 assert.equal((await request(dev,'/developer/invitation/redeem',{token})).status,409);
 assert.equal((await f.DB.prepare("SELECT status FROM developers WHERE user_id='dev'").first())?.status,'inactive');
});

test('service owner can change its own policy and normalizes unused legacy organization',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO developers VALUES('user','active')"),
  f.DB.prepare("INSERT INTO application_owners VALUES('site','user')"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('own','Own')"),
  f.DB.prepare("INSERT INTO common_application_policies VALUES('site','approved','own')"),
 ]);
 const session=await createSession(f.env,'user');
 const post=(mode:string)=>app.request('https://auth.test/developer/services',{method:'POST',headers:{Cookie:'accesskit_sid='+session.token,Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},body:JSON.stringify({clientId:'site',name:'Renamed',siteUrl:'https://site.test/',mode,organizationId:null})},f.env);
 assert.equal((await post('approved')).status,200);
 assert.equal((await f.DB.prepare("SELECT organization_id FROM common_application_policies WHERE client_id='site'").first())?.organization_id,null);
 await f.DB.prepare("UPDATE common_application_policies SET mode='season',organization_id='own' WHERE client_id='site'").run();
 assert.equal((await post('approved')).status,200);
 assert.equal((await f.DB.prepare("SELECT mode FROM common_application_policies WHERE client_id='site'").first())?.mode,'approved');
});
