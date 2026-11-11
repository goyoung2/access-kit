import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {createAuthFixture} from './auth-fixture';
import {mutateMembership,MembershipConflict} from '../src/common-admin';
import {inspectApplicationAccess,inspectApplicationTokenAccess} from '../src/policy';
import {createSession,findSessionUser,createAuthorizationCode,exchangeAuthorizationCode} from '../src/store';
import {sha256Base64Url} from '../src/crypto';
import {registerCommonRoutes} from '../src/common-routes';
import type {Env} from '../src/types';

async function setup(){
 const f=await createAuthFixture();f.env.AUTH_PROVIDER='firebase';f.env.FIREBASE_PROJECT_ID='test-project';
 await f.DB.batch([
  f.DB.prepare("INSERT INTO member_organizations VALUES('alliance','맹')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('s1','시즌 1','active'),('s2','시즌 2','draft')"),
  f.DB.prepare("INSERT INTO common_application_policies VALUES('site','season','alliance')"),
  f.DB.prepare("INSERT INTO member_applications VALUES('user','kr-1','123','닉네임','pending',0,NULL,NULL)"),
 ]);
 return f;
}
test('approval, fixed 7 day reconnect, season transition, and suspension use central policy',async t=>{
 const f=await setup();t.after(f.dispose);
 assert.equal((await inspectApplicationAccess(f.env,'user','site')).access.allowed,false);
 await mutateMembership(f.env,'user',{action:'approve',userId:'user',seasonId:'s1',organizationId:'alliance'});
 assert.equal((await inspectApplicationAccess(f.env,'user','site')).access.allowed,true);
 const session=await createSession(f.env,'user'),hash=await sha256Base64Url(session.token);
 assert.equal(session.maxAgeSeconds,604800);
 const before=await f.DB.prepare('SELECT * FROM auth_sessions WHERE token_hash=?').bind(hash).first();
 assert.equal(await findSessionUser(f.env,session.token),'user');
 assert.deepEqual(await f.DB.prepare('SELECT * FROM auth_sessions WHERE token_hash=?').bind(hash).first(),before,'reconnect has no sliding expiration or DB write');
 const expiry=Number(before?.expires_at),code=await createAuthorizationCode(f.env,'user','site','https://site.test/',await sha256Base64Url('verifier'),expiry);
 const issued=await exchangeAuthorizationCode(f.env,{code,clientId:'site',redirectUri:'https://site.test/',codeVerifier:'verifier'});
 assert.ok(issued.expiresIn>604700&&issued.expiresIn<=604800);
 assert.equal((await inspectApplicationTokenAccess(f.env,issued.accessToken,'site')).tokenExpiresAt,expiry);
 await assert.rejects(()=>exchangeAuthorizationCode(f.env,{code,clientId:'site',redirectUri:'https://site.test/',codeVerifier:'verifier'}));
 await mutateMembership(f.env,'user',{action:'activate',seasonId:'s2'});
 assert.equal((await inspectApplicationTokenAccess(f.env,issued.accessToken,'site')).access.allowed,false,'existing token loses seasonal permission');
 assert.equal(await findSessionUser(f.env,session.token),'user','membership loss does not delete login');
 assert.equal((await f.DB.prepare("SELECT status FROM season_memberships WHERE user_id='user' AND season_id='s1'").first())?.status,'active','history retained');
 await mutateMembership(f.env,'user',{action:'assign',userId:'user',seasonId:'s2',organizationId:'alliance',status:'active'});
 assert.equal((await inspectApplicationTokenAccess(f.env,issued.accessToken,'site')).access.allowed,true);
 await mutateMembership(f.env,'user',{action:'member',userId:'user',status:'suspended'});
 assert.equal((await inspectApplicationTokenAccess(f.env,issued.accessToken,'site')).access.allowed,false);
 await f.DB.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').bind(Date.now()-1,hash).run();
 assert.equal(await findSessionUser(f.env,session.token),null);
});
test('duplicate game UID fails atomically without creating membership',async t=>{
 const f=await setup();t.after(f.dispose);
 await mutateMembership(f.env,'user',{action:'approve',userId:'user',seasonId:'s1',organizationId:'alliance'});
 await f.DB.prepare("INSERT INTO users VALUES('other','Other',NULL,'active',0,0)").run();
 await f.DB.prepare("INSERT INTO member_applications VALUES('other','kr-1','123','중복','pending',0,NULL,NULL)").run();
 await assert.rejects(()=>mutateMembership(f.env,'user',{action:'approve',userId:'other',seasonId:'s1',organizationId:'alliance'}),MembershipConflict);
 assert.equal(await f.DB.prepare("SELECT * FROM common_members WHERE user_id='other'").first(),null);
});
test('explicit Google linking preserves old user ID and legacy identity',async t=>{
 const f=await setup();t.after(f.dispose);
 await f.DB.prepare("INSERT INTO users VALUES('applicant','New',NULL,'active',0,0)").run();
 await f.DB.prepare("INSERT INTO auth_identities VALUES('google','applicant','firebase:test-project','firebase-sub',0,0)").run();
 await f.DB.prepare("INSERT INTO member_applications VALUES('applicant','kr-1','456','기존회원','pending',0,NULL,NULL)").run();
 await mutateMembership(f.env,'user',{action:'approve',userId:'applicant',existingUserId:'user',seasonId:'s1',organizationId:'alliance'});
 assert.equal((await f.DB.prepare("SELECT user_id FROM auth_identities WHERE id='google'").first())?.user_id,'user');
 assert.equal((await f.DB.prepare("SELECT user_id FROM auth_identities WHERE provider='discord'").first())?.user_id,'user');
 assert.equal((await inspectApplicationAccess(f.env,'user','site')).access.allowed,true);
});
test('HTTP registration requires login; admin requires operator and same origin',async t=>{
 const f=await setup();t.after(f.dispose);
 const app=new Hono<{Bindings:Env}>();registerCommonRoutes(app,async()=>({sub:'google-test',email:'fixture@example.invalid',email_verified:true,iat:Math.floor(Date.now()/1000),auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'google.com'}}));
 const post=(path:string,body:unknown,cookie='',origin='https://auth.test')=>app.request('https://auth.test/auth/firebase'+path,{method:'POST',headers:{Origin:origin,'X-Access-Kit-Action':'1','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)},f.env);
 assert.equal((await post('/apply',{nickname:'A',realm:'kr-1',gameUid:'123'})).status,401);
 const concurrent=await Promise.all([post('/session',{idToken:'fixture'}),post('/session',{idToken:'fixture'})]);
 assert.ok(concurrent.every(r=>r.status===200));
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE provider='firebase:test-project'").first())?.n,1);
 const login=concurrent[0];
 const cookie=login.headers.get('Set-Cookie')?.split(';')[0]||'';assert.match(login.headers.get('Set-Cookie')||'',/Max-Age=604800/);
 assert.equal((await post('/admin/action',{action:'activate',seasonId:'s2'},cookie)).status,403);
 assert.equal((await post('/apply',{nickname:'A',realm:'kr-1',gameUid:'00123'},cookie,'https://evil.test')).status,403);
 assert.equal((await post('/apply',{nickname:'A',realm:'kr-1',gameUid:'00123'},cookie)).status,200);
 assert.equal((await f.DB.prepare("SELECT game_uid FROM member_applications WHERE nickname='A'").first())?.game_uid,'123');
 assert.equal((await post('/apply',{nickname:'B',realm:'kr-1',gameUid:'99'},cookie)).status,409);
});

test('season copy preserves explicit exclusions and old roster; parallel approvals commit once',async t=>{
 const f=await setup();t.after(f.dispose);
 const action={action:'approve' as const,userId:'user',seasonId:'s1',organizationId:'alliance'};
 const outcomes=await Promise.allSettled([mutateMembership(f.env,'user',action),mutateMembership(f.env,'user',action)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 await mutateMembership(f.env,'user',{action:'assign',userId:'user',seasonId:'s2',organizationId:'alliance',status:'inactive'});
 await mutateMembership(f.env,'user',{action:'copy',seasonId:'s2',fromSeasonId:'s1'});
 assert.equal((await f.DB.prepare("SELECT status FROM season_memberships WHERE user_id='user' AND season_id='s2'").first())?.status,'inactive');
 await mutateMembership(f.env,'user',{action:'activate',seasonId:'s2'});
 assert.equal((await inspectApplicationAccess(f.env,'user','site')).access.allowed,false);
 await mutateMembership(f.env,'user',{action:'policy',clientId:'site',mode:'approved',organizationId:null});
 assert.equal((await inspectApplicationAccess(f.env,'user','site')).access.allowed,true,'common approval remains valid across seasons');
 await f.DB.prepare("UPDATE users SET status='disabled' WHERE id='user'").run();
 assert.equal((await inspectApplicationAccess(f.env,'user','site')).access.allowed,false,'existing account block overrides approval');
});

test('Google linking cannot replace a different game identity or lift suspension',async t=>{
 const f=await setup();t.after(f.dispose);
 await mutateMembership(f.env,'user',{action:'approve',userId:'user',seasonId:'s1',organizationId:'alliance'});
 await f.DB.prepare("INSERT INTO users VALUES('applicant','New',NULL,'active',0,0)").run();
 await f.DB.prepare("INSERT INTO auth_identities VALUES('google','applicant','firebase:test-project','firebase-sub',0,0)").run();
 await f.DB.prepare("INSERT INTO member_applications VALUES('applicant','kr-1','999','신청','pending',0,NULL,NULL)").run();
 const action={action:'approve' as const,userId:'applicant',existingUserId:'user',seasonId:'s1',organizationId:'alliance'};
 await assert.rejects(()=>mutateMembership(f.env,'user',action),MembershipConflict);
 await f.DB.prepare("UPDATE member_applications SET game_uid='123' WHERE user_id='applicant'").run();
 await mutateMembership(f.env,'user',{action:'member',userId:'user',status:'suspended'});
 await assert.rejects(()=>mutateMembership(f.env,'user',action),MembershipConflict);
 assert.equal((await f.DB.prepare("SELECT user_id FROM auth_identities WHERE id='google'").first())?.user_id,'applicant');
});
