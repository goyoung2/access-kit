import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';
import {commonAccess} from '../src/common-membership';

async function setup(){
 const f=await createAuthFixture();
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO users VALUES('alice','Alice',NULL,'active',0,0),('bob','Bob',NULL,'active',0,0),('carol','Carol',NULL,'active',0,0),('eve','Eve',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO developers VALUES('alice','active'),('eve','active')"),
  f.DB.prepare("INSERT INTO access_rosters VALUES('ra','Roster A','alice',NULL,'active',1,0,0),('rb','Roster B','eve',NULL,'active',1,0,0)"),
  f.DB.prepare("INSERT INTO applications VALUES('a','Service A','[\"https://a.test/\"]','active',0,0),('b','Service B','[\"https://b.test/\"]','active',0,0)"),
  f.DB.prepare("INSERT INTO application_owners VALUES('a','alice'),('b','eve')"),
  f.DB.prepare("INSERT INTO common_application_policies VALUES('a','roster',NULL),('b','roster',NULL)"),
  f.DB.prepare("INSERT INTO application_rosters VALUES('a','ra'),('b','rb')"),
 ]);
 const sessions=new Map<string,string>();for(const id of ['user','alice','bob','carol','eve'])sessions.set(id,(await createSession(f.env,id)).token);
 const request=(who:string,path:string,body?:unknown)=>app.request('https://auth.test'+path,{method:body?'POST':'GET',headers:{Cookie:'accesskit_sid='+sessions.get(who),Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},f.env);
 return {...f,request};
}

test('three service administrators share one roster; grants, revocation and every sibling boundary are enforced',async t=>{
 const f=await setup();t.after(f.dispose);
 assert.equal((await f.request('alice','/console/services/a/admins',{userId:'bob',enabled:true})).status,200);
 assert.equal((await f.request('bob','/console/services/a/admins',{userId:'carol',enabled:true})).status,200);
 const snapshot=await(await f.request('carol','/console/services/a')).json();assert.equal(snapshot.administrators.length,3);
 assert.equal((await f.request('bob','/console/data')).status,200);
 const data=await(await f.request('bob','/console/data')).json();assert.deepEqual(data.services.map((s:{client_id:string})=>s.client_id),['a']);assert.equal(data.users.length,0);
 const install=await(await f.request('bob','/developer/services')).json();assert.deepEqual(install.rosters.map((r:{id:string})=>r.id),['ra']);assert.equal(install.serviceOnly,true);
 const entry=await f.request('bob','/console/services/a/roster',{action:'entry',revision:1,nickname:'Member A',gameUid:'123'});assert.equal(entry.status,200,await entry.clone().text());
 const roster=await(await f.request('carol','/console/services/a')).json();assert.equal(roster.entries[0].nickname,'Member A');
 assert.equal((await f.request('carol','/console/services/a/roster',{action:'entry',revision:roster.roster.revision,entryId:roster.entries[0].id,entryRevision:roster.entries[0].revision,nickname:'Changed',gameUid:'123'})).status,200);
 for(const who of ['bob','carol']){
  assert.equal((await f.request(who,'/console/services/b')).status,403);
  assert.equal((await f.request(who,'/console/services/b/admins',{userId:'bob',enabled:true})).status,403);
  assert.equal((await f.request(who,'/console/services/b/roster',{action:'entry',revision:1,nickname:'Intrusion',gameUid:'456'})).status,403);
  assert.equal((await f.request(who,'/developer/services',{clientId:'b',name:'Stolen',siteUrl:'https://stolen.test/'})).status,403);
  assert.equal((await f.request(who,'/console/branding',{clientId:'b',title:'Stolen',description:'',logoUrl:'',accent:'#4657cf',theme:'light'})).status,403);
  assert.equal((await f.request(who,'/console/role',{userId:who,role:'superadmin',enabled:true})).status,403);
  assert.equal((await f.request(who,'/developer/services',{name:'Unauthorized service',siteUrl:'https://new.test/'})).status,403);
  assert.equal((await f.request(who,'/developer/rosters',{action:'create',name:'Unauthorized roster'})).status,403);
 }
 assert.equal((await f.request('bob','/console/services/a/admins',{userId:'alice',enabled:false})).status,409);
 assert.equal((await commonAccess(f.env,'bob','a'))?.user?.serviceDeveloper,true);assert.equal((await commonAccess(f.env,'bob','b'))?.access.allowed,false);
 assert.equal((await f.request('alice','/console/services/a/admins',{userId:'bob',enabled:false})).status,200);
 assert.equal((await f.request('bob','/console/services/a')).status,403);
 assert.equal((await f.request('bob','/console/data')).status,403);
 assert.equal((await commonAccess(f.env,'bob','a'))?.access.allowed,false);
 assert.equal((await f.request('carol','/console/services/a')).status,200);
 await f.request('alice','/console/services/a/admins',{userId:'eve',enabled:true});
 const mixed=await(await f.request('eve','/developer/services')).json();assert.deepEqual(mixed.rosters.map((r:{id:string})=>r.id).sort(),['ra','rb']);
 assert.equal(mixed.services.find((s:{client_id:string})=>s.client_id==='a').canChangePolicy,false);assert.equal(mixed.services.find((s:{client_id:string})=>s.client_id==='b').canChangePolicy,true);
});

test('shared roster service administrators edit only the bound affiliation and cannot change the binding or global membership state',async t=>{
 const f=await setup();t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO member_organizations VALUES('org','Shared'),('other','Other')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('s','Snapshot','active')"),
  f.DB.prepare("UPDATE application_rosters SET roster_id='shared_org' WHERE client_id='a'"),
  f.DB.prepare("INSERT INTO roster_entries VALUES('foreign','kr','999','Other','s','other','active',1,0,'user')"),
 ]);
 assert.equal((await f.request('alice','/console/services/a/admins',{userId:'bob',enabled:true})).status,200);
 const s=await(await f.request('bob','/console/services/a')).json();assert.equal(s.roster.id,'shared_org');assert.equal(s.shared,true);
 assert.equal(s.canManageRoster,false);assert.deepEqual(s.entries,[]);
 assert.equal((await f.request('alice','/console/services/a/roster-access',{enabled:true})).status,403);
 assert.equal((await f.request('bob','/console/services/a/roster',{action:'entry',revision:s.roster.revision,nickname:'Blocked',gameUid:'456'})).status,403);
 assert.equal((await f.request('user','/console/services/a/roster-access',{enabled:true})).status,200);
 assert.equal((await f.request('bob','/console/services/a/roster',{action:'entry',revision:s.roster.revision,nickname:'Shared member',gameUid:'456'})).status,200);
 const next=await(await f.request('bob','/console/services/a')).json();assert.equal(next.entries.length,1);
 assert.equal((await f.request('bob','/console/services/a/roster',{action:'remove-entry',revision:next.roster.revision,entryId:'foreign',entryRevision:1})).status,403);
 assert.equal((await f.request('bob','/developer/services',{clientId:'a',name:'A',siteUrl:'https://a.test/',mode:'roster',rosterId:'shared_other'})).status,403);
 assert.equal((await f.request('bob','/console/membership',{action:'member',userId:'eve',status:'suspended'})).status,403);
 const own=next.entries[0];assert.equal((await f.request('bob','/console/services/a/roster',{action:'remove-entry',revision:next.roster.revision,entryId:own.id,entryRevision:own.revision})).status,200);
 const removed=await(await f.request('alice','/console/services/a')).json();assert.equal(removed.entries[0].status,'deleted');
 assert.equal((await f.request('alice','/console/services/a/roster',{action:'restore-entry',revision:removed.roster.revision,entryId:own.id,entryRevision:removed.entries[0].revision})).status,200);
});

test('private and shared roster writes recheck revocation in the same transaction',async t=>{
 const f=await setup();t.after(f.dispose);
 await f.DB.batch([f.DB.prepare("INSERT INTO member_organizations VALUES('org','Shared')"),f.DB.prepare("INSERT INTO member_seasons VALUES('s','Snapshot','active')")]);
 for(const kind of ['private','shared']){
  await f.DB.prepare("UPDATE application_rosters SET roster_id=? WHERE client_id='a'").bind(kind==='private'?'ra':'shared_org').run();
  if(kind==='shared')await f.request('user','/console/services/a/roster-access',{enabled:true});
  assert.equal((await f.request('alice','/console/services/a/admins',{userId:'bob',enabled:true})).status,200);
  const original=f.env.DB;let intercepted=false;
  f.env.DB=new Proxy(original,{get(target,key){if(key==='batch')return async<T>(statements:D1PreparedStatement[])=>{intercepted=true;f.env.DB=original;await original.prepare("DELETE FROM application_administrators WHERE client_id='a' AND user_id='bob'").run();return original.batch<T>(statements);};const value:unknown=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const response=await f.request('bob','/console/services/a/roster',{action:'entry',revision:1,nickname:'Race',gameUid:'777'});assert.equal(intercepted,true);assert.equal(response.status,409,kind);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM '+(kind==='private'?'access_roster_entries':'roster_entries')+" WHERE game_uid='777'").first())?.n,0);
 }
});

test('bulk import uses shared revisions and keeps sibling services and restrictions intact',async t=>{
 const f=await setup();t.after(f.dispose);
 await f.request('alice','/console/services/a/admins',{userId:'bob',enabled:true});
 const context={revision:1,text:'[{"nickname":"One","cid":"101"},{"nickname":"Two","cid":"102"}]'};
 const preview=await(await f.request('bob','/console/services/a/roster',{...context,action:'preview'})).json();assert.equal(preview.ready,true);
 assert.equal((await f.request('bob','/console/services/a/roster',{...context,action:'import',fingerprint:preview.fingerprint})).status,200);
 assert.equal((await f.request('bob','/console/services/a/roster',{...context,action:'import',fingerprint:preview.fingerprint})).status,409);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM access_roster_entries WHERE roster_id='rb'").first())?.n,0);
 await f.DB.prepare("INSERT INTO common_members VALUES('bob','suspended',0,NULL)").run();assert.equal((await commonAccess(f.env,'bob','a'))?.access.allowed,false);
 await f.DB.prepare("UPDATE users SET status='disabled' WHERE id='bob'").run();assert.equal((await f.request('bob','/console/services/a')).status,403);
 const csrf=await app.request('https://auth.test/console/services/a/admins',{method:'POST',headers:{Origin:'https://foreign.test','Content-Type':'application/json'},body:JSON.stringify({userId:'eve',enabled:true})},f.env);assert.equal(csrf.status,403);
});

test('a shared-source grant cannot survive revocation during a write or a service rebind',async t=>{
 const f=await setup();t.after(f.dispose);
 await f.DB.batch([f.DB.prepare("INSERT INTO member_organizations VALUES('org','Shared')"),f.DB.prepare("INSERT INTO member_seasons VALUES('s','Snapshot','active')"),f.DB.prepare("UPDATE application_rosters SET roster_id='shared_org' WHERE client_id='a'")]);
 await f.request('alice','/console/services/a/admins',{userId:'bob',enabled:true});await f.request('user','/console/services/a/roster-access',{enabled:true});
 const original=f.env.DB;let intercepted=false;
 f.env.DB=new Proxy(original,{get(target,key){if(key==='batch')return async<T>(statements:D1PreparedStatement[])=>{intercepted=true;f.env.DB=original;await original.prepare("DELETE FROM service_roster_grants WHERE client_id='a'").run();return original.batch<T>(statements);};const value:unknown=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 assert.equal((await f.request('bob','/console/services/a/roster',{action:'entry',revision:1,nickname:'Revoked',gameUid:'888'})).status,409);assert.equal(intercepted,true);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM roster_entries WHERE game_uid='888'").first())?.n,0);
 await f.request('user','/console/services/a/roster-access',{enabled:true});await f.DB.prepare("UPDATE application_rosters SET roster_id='rb' WHERE client_id='a'").run();
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM service_roster_grants WHERE client_id='a'").first())?.n,0);
 const snapshot=await(await f.request('bob','/console/services/a')).json();assert.equal(snapshot.canManageRoster,false);assert.equal(snapshot.requiresRosterGrant,true);assert.deepEqual(snapshot.entries,[]);
});
