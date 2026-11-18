import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {createAuthFixture} from './auth-fixture';
import {createSession,exchangeAuthorizationCode} from '../src/store';
import {registerCommonRoutes} from '../src/common-routes';
import {registerConsole} from '../src/console';
import {inspectApplicationAccess,inspectApplicationTokenAccess} from '../src/policy';
import {mutateMembership} from '../src/common-admin';
import {mutateRoster} from '../src/console-roster';
import {sha256Base64Url} from '../src/crypto';
import {parseRosterInput} from '../src/roster-input';
import type {Env} from '../src/types';

async function setup(){
 const f=await createAuthFixture();
 await f.DB.batch([
  f.DB.prepare("INSERT INTO users VALUES('owner','Owner',NULL,'active',0,0),('other','Other',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO auth_operators VALUES('owner','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('changcheon','창천')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('season','시험 시즌','active')"),
  f.DB.prepare("INSERT INTO roster_entries VALUES('roster','kr','123','명부 이름','season','changcheon','active',1,0,'owner')"),
  f.DB.prepare("INSERT INTO common_application_policies VALUES('site','season','changcheon')"),
 ]);
 const app=new Hono<{Bindings:Env}>();registerCommonRoutes(app);registerConsole(app);
 const session=await createSession(f.env,'user');
 const headers={Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json',Cookie:'accesskit_sid='+session.token};
 const signup=(gameUid='123',nickname='명부 이름')=>app.request('https://auth.test/auth/firebase/apply',{method:'POST',headers,body:JSON.stringify({gameUid,nickname})},f.env);
 const status=()=>app.request('https://auth.test/auth/firebase/status',{headers},f.env).then(r=>r.json());
 return {...f,app,headers,signup,status};
}

test('roster CID registers immediately and grants alliance access despite changed nickname',async t=>{
 const f=await setup();t.after(f.dispose);
 assert.equal((await f.signup('000123','새 이름')).status,200);
 assert.equal((await f.status()).member.status,'approved');
 assert.equal((await inspectApplicationAccess(f.env,'user','site'))?.access.allowed,true);
 assert.equal((await f.DB.prepare("SELECT nickname FROM roster_entries WHERE id='roster'").first())?.nickname,'명부 이름');
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM member_applications WHERE status='pending'").first())?.n,0);
 await mutateMembership(f.env,'owner',{action:'assign',userId:'user',seasonId:'season',organizationId:'changcheon',status:'active'});
 assert.equal((await f.DB.prepare("SELECT nickname FROM roster_entries WHERE id='roster'").first())?.nickname,'명부 이름','membership sync cannot replace the roster name with the submitted name');
});

test('unknown CID completes visitor registration without granting member services',async t=>{
 const f=await setup();t.after(f.dispose);
 assert.equal((await f.signup('999','방문자')).status,200);
 assert.equal((await f.status()).member.status,'visitor');
 assert.equal((await inspectApplicationAccess(f.env,'user','site'))?.access.allowed,false);
 await f.DB.prepare("UPDATE common_application_policies SET mode='approved',organization_id=NULL").run();
 assert.equal((await inspectApplicationAccess(f.env,'user','site'))?.access.allowed,false);
 assert.equal((await f.signup('123')).status,409,'registered visitor cannot replace the linked CID');
});

test('nickname discrepancy is admin-only and keeps both names',async t=>{
 const f=await setup();t.after(f.dispose);await f.signup('123','새 이름');
 const userStatus=await f.status();
 assert.equal(JSON.stringify(userStatus).includes('명부 이름'),false);
 const owner=await createSession(f.env,'owner');
 const response=await f.app.request('https://auth.test/console/data',{headers:{Cookie:'accesskit_sid='+owner.token}},f.env);
 assert.equal(response.status,200);
 const data=await response.json(),member=data.members.find((m:{id:string})=>m.id==='user');
 assert.equal(member.nickname,'새 이름');assert.equal(member.roster_nickname,'명부 이름');assert.equal(member.nickname_mismatch,1);
 assert.equal((await f.app.request('https://auth.test/console/data',{headers:f.headers},f.env)).status,403);
});

test('roster removal and reinstatement change access without re-registering or lifting suspension',async t=>{
 const f=await setup();t.after(f.dispose);await f.signup();
 await f.DB.prepare("UPDATE roster_entries SET status='deleted' WHERE id='roster'").run();
 assert.equal((await f.status()).member.status,'visitor');
 assert.equal((await inspectApplicationAccess(f.env,'user','site'))?.access.allowed,false);
 await f.DB.prepare("UPDATE roster_entries SET status='active' WHERE id='roster'").run();
 assert.equal((await inspectApplicationAccess(f.env,'user','site'))?.access.allowed,true);
 await mutateMembership(f.env,'owner',{action:'member',userId:'user',status:'suspended'});
 assert.equal((await f.status()).member.status,'suspended');
 assert.equal((await inspectApplicationAccess(f.env,'user','site'))?.access.allowed,false);
 assert.equal((await f.signup()).status,409);
});

test('a second Google account cannot claim an already linked CID',async t=>{
 const f=await setup();t.after(f.dispose);await f.signup();
 const other=await createSession(f.env,'other');
 const response=await f.app.request('https://auth.test/auth/firebase/apply',{method:'POST',headers:{...f.headers,Cookie:'accesskit_sid='+other.token},body:JSON.stringify({nickname:'도용',gameUid:'123'})},f.env);
 assert.equal(response.status,409);
 assert.equal((await f.DB.prepare("SELECT user_id FROM game_accounts WHERE game_uid='123'").first())?.user_id,'user');
 assert.equal(await f.DB.prepare("SELECT * FROM game_accounts WHERE user_id='other'").first(),null);
});

test('visitor becomes a member through roster CRUD and nickname edits never rewrite the submitted name',async t=>{
 const f=await setup();t.after(f.dispose);await f.signup('999','가입 이름');
 await mutateRoster(f.env,'owner',{action:'create',realm:'kr',gameUid:'999',nickname:'명부 이름',seasonId:'season',organizationId:'changcheon'});
 assert.equal((await f.status()).member.status,'approved');
 assert.equal((await inspectApplicationAccess(f.env,'user','site'))?.access.allowed,true);
 assert.equal((await f.DB.prepare("SELECT nickname FROM automatic_registrations WHERE user_id='user'").first())?.nickname,'가입 이름');
 const row=await f.DB.prepare("SELECT id,revision FROM roster_entries WHERE game_uid='999'").first<{id:string;revision:number}>();
 assert.ok(row);
 await mutateRoster(f.env,'owner',{action:'delete',id:row.id,revision:row.revision});
 assert.equal((await f.status()).member.status,'visitor');
 await mutateMembership(f.env,'owner',{action:'member',userId:'user',status:'suspended'});
 const deleted=await f.DB.prepare('SELECT revision FROM roster_entries WHERE id=?').bind(row.id).first<{revision:number}>();assert.ok(deleted);
 await mutateRoster(f.env,'owner',{action:'restore',id:row.id,revision:deleted.revision});
 assert.equal((await f.status()).member.status,'suspended');
 await mutateMembership(f.env,'owner',{action:'member',userId:'user',status:'approved'});
 assert.equal((await f.status()).member.status,'approved');
});

test('draft and archived rosters and deleted catalogs never grant automatic membership',async t=>{
 const f=await setup();t.after(f.dispose);await f.signup();
 for(const seasonStatus of ['draft','archived']){
  await f.DB.prepare('UPDATE member_seasons SET status=?').bind(seasonStatus).run();
  assert.equal((await f.status()).member.status,'visitor');
  assert.equal((await inspectApplicationAccess(f.env,'user','site'))?.access.allowed,false);
 }
 await f.DB.prepare("UPDATE member_seasons SET status='active'").run();
 await f.DB.prepare("UPDATE catalog_state SET deleted_at=1 WHERE kind='organization' AND entity_id='changcheon'").run();
 assert.equal((await f.status()).member.status,'visitor');
});

test('concurrent registrations claim a CID once with no partial account or registration',async t=>{
 const f=await setup();t.after(f.dispose);
 const other=await createSession(f.env,'other');
 const postOther=()=>f.app.request('https://auth.test/auth/firebase/apply',{method:'POST',headers:{...f.headers,Cookie:'accesskit_sid='+other.token},body:JSON.stringify({nickname:'Other',gameUid:'123'})},f.env);
 const responses=await Promise.all([f.signup(),postOther()]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM game_accounts').first())?.n,1);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM automatic_registrations').first())?.n,1);
});

test('member completes PKCE authorization while visitor receives no authorization code',async t=>{
 const f=await setup();t.after(f.dispose);await f.signup();
 const verifier='local-automatic-registration-verifier';
 await f.DB.prepare("INSERT INTO oauth_requests VALUES('request','site','https://site.test/',?,'state',?,?)").bind(await sha256Base64Url(verifier),Date.now()+600000,Date.now()).run();
 const response=await f.app.request('https://auth.test/auth/firebase/continue?request=request',{headers:f.headers},f.env);
 assert.equal(response.status,302);const redirect=new URL(response.headers.get('Location')||'');
 const code=redirect.searchParams.get('code');assert.ok(code);
 const token=await exchangeAuthorizationCode(f.env,{code,clientId:'site',redirectUri:'https://site.test/',codeVerifier:verifier});
 assert.equal((await inspectApplicationTokenAccess(f.env,token.accessToken,'site'))?.access.allowed,true);
 await f.DB.prepare("UPDATE roster_entries SET status='deleted'").run();
 assert.equal((await inspectApplicationTokenAccess(f.env,token.accessToken,'site'))?.access.allowed,false);
 await f.DB.prepare("INSERT INTO oauth_requests VALUES('visitor','site','https://site.test/',?,'state',?,?)").bind(await sha256Base64Url(verifier),Date.now()+600000,Date.now()).run();
 const denied=await f.app.request('https://auth.test/auth/firebase/continue?request=visitor',{headers:f.headers},f.env);
 assert.equal(denied.status,200);assert.equal(denied.headers.get('Location'),null);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_codes WHERE used_at IS NULL').first())?.n,0);
});

test('captured members JSON imports same-name people independently by CID',()=>{
 const parsed=parseRosterInput(JSON.stringify({schemaVersion:1,members:[{nickname:'동명이인',cid:'123',serverId:1},{nickname:'동명이인',cid:'456',serverId:1}]}));
 assert.equal(parsed.items.length,2);assert.equal(parsed.errors.length,0);assert.equal(parsed.duplicateCount,0);
});

test('nickname verification reaches only administrators of the matching affiliation',async t=>{
 const f=await setup();t.after(f.dispose);await f.signup('123','변경 이름');
 await f.DB.batch([
  f.DB.prepare("INSERT INTO users VALUES('manager','Manager',NULL,'active',0,0),('outsider','Outsider',NULL,'active',0,0),('developer','Developer',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('elsewhere','다른 맹')"),
  f.DB.prepare("INSERT INTO member_managers VALUES('manager','changcheon','owner',0),('outsider','elsewhere','owner',0)"),
  f.DB.prepare("INSERT INTO developers VALUES('developer','active')"),
 ]);
 for(const [id,visible] of [['manager',true],['outsider',false],['developer',false]] as const){
  const session=await createSession(f.env,id);
  const response=await f.app.request('https://auth.test/console/data',{headers:{Cookie:'accesskit_sid='+session.token}},f.env);
  assert.equal(response.status,200);
  const data=await response.json(),row=data.members.find((member:{id:string})=>member.id==='user');
  assert.equal(Boolean(row),visible);
  if(row)assert.equal(row.nickname_mismatch,1);
  if(id==='manager')await mutateMembership(f.env,id,{action:'assign',userId:'user',seasonId:'season',organizationId:'changcheon',status:'active'});
 }
});

test('equal nicknames need no verification and automatic assignments retain catalog impact counts',async t=>{
 const f=await setup();t.after(f.dispose);await f.signup();
 const owner=await createSession(f.env,'owner');
 const response=await f.app.request('https://auth.test/console/data',{headers:{Cookie:'accesskit_sid='+owner.token}},f.env);
 const data=await response.json(),member=data.members.find((m:{id:string})=>m.id==='user');
 assert.equal(member.nickname_mismatch,0);
 assert.equal(data.assignments.find((m:{user_id:string})=>m.user_id==='user')?.organization_id,'changcheon');
 assert.equal(data.organizations.find((o:{id:string})=>o.id==='changcheon')?.member_count,1);
});
