import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';
import {registerCommonRoutes} from '../src/common-routes';
import type {Env} from '../src/types';
import {mutateMembership,MembershipConflict} from '../src/common-admin';

test('CID-only signup retains deleted roster exclusions during approval',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO users VALUES('applicant','Applicant',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('own','Own')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('season','Season','active')"),
  f.DB.prepare("INSERT INTO roster_entries VALUES('excluded','legacy-roster','999','Excluded','season','own','deleted',1,0,'user')"),
 ]);
 const session=await createSession(f.env,'applicant');const app=new Hono<{Bindings:Env}>();registerCommonRoutes(app);
 const r=await app.request('https://auth.test/auth/firebase/apply',{method:'POST',headers:{Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json',Cookie:'accesskit_sid='+session.token},body:JSON.stringify({nickname:'Applicant',gameUid:'999'})},f.env);
 assert.equal(r.status,200);assert.equal((await f.DB.prepare("SELECT realm FROM member_applications WHERE user_id='applicant'").first())?.realm,'legacy-roster');
 await assert.rejects(()=>mutateMembership(f.env,'user',{action:'approve',userId:'applicant',seasonId:'season',organizationId:'own'}),MembershipConflict);
 assert.equal(await f.DB.prepare("SELECT * FROM common_members WHERE user_id='applicant'").first(),null);
});

test('registration accepts nickname and CID only and does not let the client choose a realm',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);const session=await createSession(f.env,'user');
 const app=new Hono<{Bindings:Env}>();registerCommonRoutes(app);
 const post=(body:unknown)=>app.request('https://auth.test/auth/firebase/apply',{method:'POST',headers:{Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json',Cookie:'accesskit_sid='+session.token},body:JSON.stringify(body)},f.env);
 assert.equal((await post({nickname:'First',gameUid:'000123'})).status,200);
 assert.deepEqual(await f.DB.prepare("SELECT nickname,game_uid,realm,status FROM member_applications WHERE user_id='user'").first(),{nickname:'First',game_uid:'123',realm:'kr',status:'pending'});
 await f.DB.prepare("UPDATE member_applications SET status='rejected' WHERE user_id='user'").run();
 assert.equal((await post({nickname:'Revised',gameUid:'000456',realm:'client-chosen-server'})).status,200);
 assert.equal((await f.DB.prepare("SELECT realm FROM member_applications WHERE user_id='user'").first())?.realm,'kr');
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM common_members").first<{n:number}>())?.n,0);
});

test('CID-only signup preserves the namespace of an existing game account',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.batch([f.DB.prepare("INSERT INTO users VALUES('existing','Existing',NULL,'active',0,0)"),f.DB.prepare("INSERT INTO game_accounts VALUES('existing','legacy-realm','321','Existing')")]);
 const session=await createSession(f.env,'user');const app=new Hono<{Bindings:Env}>();registerCommonRoutes(app);
 const r=await app.request('https://auth.test/auth/firebase/apply',{method:'POST',headers:{Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json',Cookie:'accesskit_sid='+session.token},body:JSON.stringify({nickname:'Applicant',gameUid:'000321'})},f.env);
 assert.equal(r.status,200);assert.equal((await f.DB.prepare("SELECT realm FROM member_applications WHERE user_id='user'").first())?.realm,'legacy-realm');
 assert.equal((await f.DB.prepare("SELECT user_id FROM game_accounts WHERE game_uid='321'").first())?.user_id,'existing');
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM common_members").first<{n:number}>())?.n,0);
});

test('CID-only signup retains legacy pending application keys so duplicate approval stays blocked',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO users VALUES('old','Old',NULL,'active',0,0),('new','New',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('own','Own')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('season','Season','active')"),
  f.DB.prepare("INSERT INTO member_applications VALUES('old','legacy-pending','555','Old','pending',0,NULL,NULL)"),
 ]);
 const session=await createSession(f.env,'new');const app=new Hono<{Bindings:Env}>();registerCommonRoutes(app);
 const r=await app.request('https://auth.test/auth/firebase/apply',{method:'POST',headers:{Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json',Cookie:'accesskit_sid='+session.token},body:JSON.stringify({nickname:'New',gameUid:'555'})},f.env);
 assert.equal(r.status,200);assert.equal((await f.DB.prepare("SELECT realm FROM member_applications WHERE user_id='new'").first())?.realm,'legacy-pending');
 await mutateMembership(f.env,'user',{action:'approve',userId:'old',seasonId:'season',organizationId:'own'});
 await assert.rejects(()=>mutateMembership(f.env,'user',{action:'approve',userId:'new',seasonId:'season',organizationId:'own'}),MembershipConflict);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM game_accounts WHERE game_uid='555'").first<{n:number}>())?.n,1);
});

test('ambiguous existing CID records cannot be bypassed with a submitted server',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.batch([f.DB.prepare("INSERT INTO users VALUES('other','Other',NULL,'active',0,0)"),f.DB.prepare("INSERT INTO game_accounts VALUES('user','old-a','789','A'),('other','old-b','789','B')")]);
 const session=await createSession(f.env,'user');const app=new Hono<{Bindings:Env}>();registerCommonRoutes(app);
 const r=await app.request('https://auth.test/auth/firebase/apply',{method:'POST',headers:{Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json',Cookie:'accesskit_sid='+session.token},body:JSON.stringify({nickname:'Applicant',gameUid:'789',realm:'old-a'})},f.env);
 assert.equal(r.status,409);assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM member_applications").first<{n:number}>())?.n,0);
});

test('unapproved continue renders onboarding without a blanket denial and keeps authorization blocked',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO common_application_policies VALUES('site','approved',NULL)"),
  f.DB.prepare("INSERT INTO oauth_requests VALUES('onboarding','site','https://site.test/','challenge','state',?,?)").bind(Date.now()+600000,Date.now()),
 ]);
 const session=await createSession(f.env,'user');
 const app=new Hono<{Bindings:Env}>();registerCommonRoutes(app);
 const response=await app.request('https://auth.test/auth/firebase/continue?request=onboarding',{headers:{Cookie:'accesskit_sid='+session.token}},f.env);
 assert.equal(response.status,200);
 assert.equal(response.headers.get('Location'),null);
 assert.doesNotMatch(await response.text(),/id="notice"/,'a first-time applicant must not receive a permanent access-denied notice');
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_codes').first<{n:number}>())?.n,0);
});
