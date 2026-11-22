import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';

async function setup(){
 const f=await createAuthFixture();
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO users VALUES('member','Member',NULL,'active',0,0),('visitor','Visitor',NULL,'active',0,0),('future','Future',NULL,'active',0,0),('other','Other',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('group','Default Group')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('season','Season','active')"),
  f.DB.prepare("INSERT INTO default_access_roster VALUES(1,'shared_group')"),
  f.DB.prepare("INSERT INTO roster_entries VALUES('source','kr','123','Canonical','season','group','active',1,0,'user')"),
  f.DB.prepare("INSERT INTO game_accounts VALUES('member','kr','123','Canonical'),('visitor','kr','456','Visitor'),('other','kr','789','Other')"),
  f.DB.prepare("INSERT INTO automatic_registrations VALUES('member','Changed nickname',0),('visitor','Visitor',0),('other','Other',0)"),
 ]);
 const sessions=new Map<string,string>();for(const who of ['user','member','visitor','future','other'])sessions.set(who,(await createSession(f.env,who)).token);
 const request=(who:string,path:string,body?:unknown)=>app.request('https://auth.test'+path,{method:body?'POST':'GET',headers:{Cookie:'accesskit_sid='+sessions.get(who),Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},f.env);
 const create=(who='member')=>request(who,'/developer/services',{name:'Member service',siteUrl:'https://member.test/'});
 return {...f,request,create};
}

test('live default-roster member registers own service without a developer grant and manages only that service',async t=>{
 const f=await setup();t.after(f.dispose);
 assert.equal((await f.request('member','/developer/install')).status,200);
 assert.equal((await f.request('member','/console/data')).status,200);
 assert.equal((await(await f.request('member','/auth/firebase/status')).json()).consoleAccess,true);
 const response=await f.create();assert.equal(response.status,200,await response.clone().text());const {clientId}=await response.json();
 assert.equal((await f.DB.prepare('SELECT COUNT(*) n FROM developers').first())?.n,0);
 assert.equal((await f.request('member','/console/services/'+clientId+'/admins',{gameUid:'456',enabled:true})).status,200);
 const detail=await(await f.request('visitor','/console/services/'+clientId)).json();assert.equal(detail.administrators.length,2);assert.equal(detail.canManageRoster,false);assert.deepEqual(detail.entries,[]);
 assert.equal((await f.request('visitor','/console/services/site')).status,403);
 assert.equal((await f.request('member','/console/services/'+clientId+'/roster-access',{enabled:true})).status,403);
 assert.equal((await f.request('member','/console/services/'+clientId+'/roster',{action:'entry',revision:1,nickname:'Intrusion',gameUid:'999'})).status,403);
 assert.equal((await f.request('user','/console/services/'+clientId+'/roster-access',{enabled:true})).status,200);
 assert.equal((await(await f.request('visitor','/console/services/'+clientId)).json()).entries.length,1);
 assert.equal((await f.request('user','/console/services/'+clientId+'/roster-access',{enabled:false})).status,200);
 assert.deepEqual((await(await f.request('visitor','/console/services/'+clientId)).json()).entries,[]);
 assert.equal((await f.DB.prepare("SELECT nickname FROM roster_entries WHERE id='source'").first())?.nickname,'Canonical');
});

test('visitor, deleted source, suspension and explicit registration denial cannot auto-create services',async t=>{
 const f=await setup();t.after(f.dispose);
 assert.equal((await f.create('visitor')).status,403);
 for(const sql of ["UPDATE roster_entries SET status='deleted' WHERE id='source'","INSERT INTO common_members VALUES('member','suspended',0,'user')","INSERT INTO developers VALUES('member','inactive')"]){
  await f.DB.prepare(sql).run();assert.equal((await f.create()).status,403,sql);
  await f.DB.batch([f.DB.prepare("UPDATE roster_entries SET status='active' WHERE id='source'"),f.DB.prepare("DELETE FROM common_members WHERE user_id='member'"),f.DB.prepare("DELETE FROM developers WHERE user_id='member'")]);
 }
});

test('pre-signup role requires matching CID and secret acceptance, is single-use and cannot escalate across services',async t=>{
 const f=await setup();t.after(f.dispose);
 const {clientId}=await(await f.create()).json();
 const invitation=await f.request('member','/console/services/'+clientId+'/invitations',{action:'create',role:'service_admin',clientId,gameUid:'777'});assert.equal(invitation.status,200);const grant=await invitation.json(),token=new URL(grant.url).hash.slice(1);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) n FROM application_administrators').first())?.n,0);
 assert.equal((await f.request('other','/permissions/accept',{token})).status,409);
 assert.equal((await f.request('future','/auth/firebase/apply',{gameUid:'777',nickname:'Future'})).status,200);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) n FROM application_administrators').first())?.n,0);
 const accepted=await f.request('future','/permissions/accept',{token});assert.equal(accepted.status,200,await accepted.clone().text());
 assert.equal((await f.request('future','/permissions/accept',{token})).status,409);
 assert.equal((await f.request('future','/console/services/'+clientId)).status,200);
 assert.equal((await f.request('future','/console/services/site')).status,403);
 assert.equal((await f.request('member','/console/services/'+clientId+'/invitations',{action:'create',role:'superadmin',gameUid:'888'})).status,403);
 assert.equal((await f.request('member','/console/permission-reservations',{action:'create',role:'superadmin',gameUid:'888'})).status,403);
 assert.equal((await f.request('future','/console/services/'+clientId+'/admins',{gameUid:'456',enabled:true})).status,200);
 assert.equal((await f.request('member','/console/services/'+clientId+'/admins',{gameUid:'777',enabled:false})).status,200);
 assert.equal((await f.request('future','/console/services/'+clientId)).status,403);
});

test('operator may reserve each global role before signup, cancel reservations, and lost inviter authority invalidates acceptance',async t=>{
 const f=await setup();t.after(f.dispose);
 for(const [index,role] of ['developer','manager','superadmin'].entries()){
  const cid=String(800+index),created=await f.request('user','/console/permission-reservations',{action:'create',role,gameUid:cid,...(role==='manager'?{organizationId:'group'}:{})});assert.equal(created.status,200);
  const grant=await created.json(),token=new URL(grant.url).hash.slice(1);
  const id='future'+index;await f.DB.prepare("INSERT INTO users VALUES(?,?,NULL,'active',0,0)").bind(id,id).run();const sid=(await createSession(f.env,id)).token;
  const accept=()=>app.request('https://auth.test/permissions/accept',{method:'POST',headers:{Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json',Cookie:'accesskit_sid='+sid},body:JSON.stringify({token})},f.env);
  await f.DB.prepare('INSERT INTO game_accounts VALUES(?,?,?,?)').bind(id,'kr',cid,id).run();
  assert.equal((await accept()).status,200,role);
 }
 const {clientId}=await(await f.create()).json();
 await f.request('member','/console/services/'+clientId+'/admins',{gameUid:'456',enabled:true});
 const grant=await(await f.request('visitor','/console/services/'+clientId+'/invitations',{action:'create',role:'service_admin',clientId,gameUid:'789'})).json();
 await f.request('member','/console/services/'+clientId+'/admins',{gameUid:'456',enabled:false});
 assert.equal((await f.request('other','/permissions/accept',{token:new URL(grant.url).hash.slice(1)})).status,409);
 const cancelled=await(await f.request('user','/console/permission-reservations',{action:'create',role:'developer',gameUid:'789'})).json();
 assert.equal((await f.request('user','/console/permission-reservations',{action:'revoke',id:cancelled.id})).status,200);
 assert.equal((await f.request('other','/permissions/accept',{token:new URL(cancelled.url).hash.slice(1)})).status,409);
 const listing=await(await f.request('user','/console/permission-reservations')).json();assert.ok(listing.reservations.every((r:Record<string,unknown>)=>!('token_hash' in r)));
});

test('membership removal during service creation rolls back the whole write, while existing owner identity is retained',async t=>{
 const f=await setup();t.after(f.dispose);
 const {clientId}=await(await f.create()).json();
 const original=f.env.DB;let intercepted=false;
 f.env.DB=new Proxy(original,{get(target,key){if(key==='batch')return async<T>(statements:D1PreparedStatement[])=>{intercepted=true;f.env.DB=original;await original.prepare("UPDATE roster_entries SET status='deleted' WHERE id='source'").run();return original.batch<T>(statements);};const value:unknown=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 assert.equal((await f.create()).status,409);assert.equal(intercepted,true);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) n FROM application_owners').first())?.n,1);
 assert.equal((await f.request('member','/console/services/'+clientId)).status,200);
});

test('expired reservation and cross-origin acceptance grant nothing',async t=>{
 const f=await setup();t.after(f.dispose);
 const grant=await(await f.request('user','/console/permission-reservations',{action:'create',role:'developer',gameUid:'456'})).json();
 const token=new URL(grant.url).hash.slice(1);
 const response=await app.request('https://auth.test/permissions/accept',{method:'POST',headers:{Origin:'https://foreign.test','Content-Type':'application/json'},body:JSON.stringify({token})},f.env);assert.equal(response.status,403);
 await f.DB.prepare('UPDATE permission_reservations SET expires_at=1 WHERE id=?').bind(grant.id).run();
 assert.equal((await f.request('visitor','/permissions/accept',{token})).status,409);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) n FROM developers').first())?.n,0);
});
