import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';
import {commonAccess} from '../src/common-membership';
import {mutateMembership} from '../src/common-admin';
import {readFile} from 'node:fs/promises';
import {migrationStatements} from './migration-statements';

async function setup(){
 const f=await createAuthFixture();
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO users VALUES('alice','Alice',NULL,'active',0,0),('bob','Bob',NULL,'active',0,0),('member','Member',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO developers VALUES('alice','active'),('bob','active')"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('changcheon','창천')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('season','Season','active')"),
  f.DB.prepare("INSERT INTO roster_entries VALUES('shared-entry','kr','123','공유 회원','season','changcheon','active',1,0,'user')"),
  f.DB.prepare("INSERT INTO default_access_roster VALUES(1,'shared_changcheon')"),
 ]);
 const sessions=new Map<string,string>();for(const id of ['user','alice','bob','member'])sessions.set(id,(await createSession(f.env,id)).token);
 const request=(who:string,path:string,body?:unknown)=>app.request('https://auth.test'+path,{method:body?'POST':'GET',headers:{Cookie:'accesskit_sid='+sessions.get(who),Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},f.env);
 async function createService(who:string,name:string,rosterId?:string){const r=await request(who,'/developer/services',{name,siteUrl:'https://'+name+'.test/',...(rosterId?{rosterId}:{})});assert.equal(r.status,200);return (await r.json()).clientId;}
 async function createRoster(who:string){const r=await request(who,'/developer/rosters',{action:'create',name:who+' 명부'});assert.equal(r.status,200);return (await r.json()).rosterId;}
 return {...f,request,createService,createRoster};
}

test('service defaults to shared roster and developer identity is limited to its owner',async t=>{
 const f=await setup();t.after(f.dispose);
 const client=await f.createService('alice','alice-site');
 assert.equal((await f.DB.prepare('SELECT roster_id FROM application_rosters WHERE client_id=?').bind(client).first())?.roster_id,'shared_changcheon');
 const owner=await commonAccess(f.env,'alice',client),other=await commonAccess(f.env,'bob',client);
 assert.equal(owner?.access.allowed,true);assert.equal(owner?.user?.serviceDeveloper,true);assert.equal(owner?.user?.membershipAdmin,false);
 assert.equal(other?.access.allowed,false);assert.equal(other?.user?.serviceDeveloper,false);
 const bobSite=await f.createService('bob','bob-site');assert.equal((await commonAccess(f.env,'alice',bobSite))?.access.allowed,false);
});

test('private roster admits a central visitor only to the selected service and preserves the shared roster',async t=>{
 const f=await setup();t.after(f.dispose);const roster=await f.createRoster('alice');
 assert.equal((await f.request('alice','/developer/rosters',{action:'entry',rosterId:roster,revision:1,nickname:'사설 회원',gameUid:'999'})).status,200);
 const privateSite=await f.createService('alice','private-site',roster),sharedSite=await f.createService('bob','shared-site');
 assert.equal((await f.request('member','/auth/firebase/apply',{nickname:'가입 이름',gameUid:'999'})).status,200);
 assert.equal((await(await f.request('member','/auth/firebase/status')).json()).member.status,'visitor');
 assert.equal((await commonAccess(f.env,'member',privateSite))?.access.allowed,true);
 assert.equal((await commonAccess(f.env,'member',privateSite))?.user?.membership.is_member,true);
 assert.equal((await commonAccess(f.env,'member',sharedSite))?.access.allowed,false);
 assert.equal((await f.DB.prepare("SELECT nickname FROM roster_entries WHERE id='shared-entry'").first())?.nickname,'공유 회원');
});

test('developer can switch its service roster, but cannot inspect, edit or bind another developer roster',async t=>{
 const f=await setup();t.after(f.dispose);const own=await f.createRoster('alice'),other=await f.createRoster('bob'),client=await f.createService('alice','switch-site');
 assert.equal((await f.request('alice','/developer/rosters/'+other)).status,403);
 assert.equal((await f.request('alice','/developer/rosters',{action:'rename',rosterId:other,revision:1,name:'盗用'})).status,403);
 assert.equal((await f.request('alice','/developer/services',{clientId:client,name:'switch-site',siteUrl:'https://switch-site.test/',mode:'roster',rosterId:other})).status,400);
 assert.equal((await f.request('alice','/developer/services',{clientId:client,name:'switch-site',siteUrl:'https://switch-site.test/',mode:'roster',rosterId:own})).status,200);
 assert.equal((await f.request('bob','/developer/services',{clientId:client,name:'hack',siteUrl:'https://hack.test/',mode:'roster',rosterId:other})).status,403);
 const listed=await(await f.request('alice','/developer/rosters')).json();assert.equal(listed.rosters.some((r:{id:string})=>r.id===other),false);
 assert.equal((await f.request('alice','/developer/rosters/shared_changcheon')).status,403,'shared data is not exported to developers');
});

test('private roster import previews, rejects stale writes and deletes/restores without affecting accounts',async t=>{
 const f=await setup();t.after(f.dispose);const roster=await f.createRoster('alice');
 const input={rosterId:roster,revision:1,text:JSON.stringify({members:[{nickname:'A',cid:'999'},{nickname:'B',cid:'998'}]})};
 const preview=await(await f.request('alice','/developer/rosters',{...input,action:'preview'})).json();assert.equal(preview.counts.add,2);assert.equal(preview.ready,true);
 assert.equal((await f.request('alice','/developer/rosters',{...input,action:'import',fingerprint:preview.fingerprint})).status,200);
 assert.equal((await f.request('alice','/developer/rosters',{...input,action:'import',fingerprint:preview.fingerprint})).status,409);
 const content=await(await f.request('alice','/developer/rosters/'+roster)).json(),entry=content.entries[0];
 assert.equal((await f.request('alice','/developer/rosters',{action:'remove-entry',rosterId:roster,revision:content.roster.revision,entryId:entry.id,entryRevision:entry.revision})).status,200);
 const deleted=await(await f.request('alice','/developer/rosters/'+roster)).json();
 assert.equal((await f.request('alice','/developer/rosters',{action:'restore-entry',rosterId:roster,revision:deleted.roster.revision,entryId:entry.id,entryRevision:entry.revision+1})).status,200);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM users').first())?.n,4);
});

test('private deletion and developer revocation remove their respective access without bypassing suspension',async t=>{
 const f=await setup();t.after(f.dispose);const roster=await f.createRoster('alice'),client=await f.createService('alice','restricted-site',roster);
 await f.request('alice','/developer/rosters',{action:'entry',rosterId:roster,revision:1,nickname:'회원',gameUid:'999'});
 await f.request('member','/auth/firebase/apply',{nickname:'회원',gameUid:'999'});
 assert.equal((await commonAccess(f.env,'member',client))?.access.allowed,true);
 await f.request('alice','/developer/rosters',{action:'delete',rosterId:roster,revision:2});
 assert.equal((await commonAccess(f.env,'member',client))?.access.allowed,false);
 await f.request('alice','/developer/rosters',{action:'restore',rosterId:roster,revision:3});
 await mutateMembership(f.env,'user',{action:'member',userId:'member',status:'suspended'});
 assert.equal((await commonAccess(f.env,'member',client))?.access.allowed,false);
 await f.DB.prepare("UPDATE developers SET status='inactive' WHERE user_id='alice'").run();
 assert.equal((await commonAccess(f.env,'alice',client))?.access.allowed,false);
 assert.equal((await f.request('alice','/developer/rosters')).status,403);
});

test('only central admin can choose a shared default and a private default is rejected',async t=>{
 const f=await setup();t.after(f.dispose);const roster=await f.createRoster('alice');
 assert.equal((await f.request('alice','/developer/rosters',{action:'default',rosterId:'shared_changcheon'})).status,403);
 assert.equal((await f.request('user','/developer/rosters',{action:'default',rosterId:roster})).status,409);
 assert.equal((await f.request('user','/developer/rosters',{action:'default',rosterId:'shared_changcheon'})).status,200);
});

test('migration preserves legacy IDs and restrictions and derives an unambiguous shared default',async t=>{
 const f=await createAuthFixture({throughMigration:'0007_automatic_registration.sql'});t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO member_organizations VALUES('legacy-alliance','창천')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('old-season','Season','active')"),
  f.DB.prepare("INSERT INTO common_members VALUES('user','approved',0,NULL)"),
  f.DB.prepare("INSERT INTO game_accounts VALUES('user','kr','777','기존 이름')"),
  f.DB.prepare("INSERT INTO season_memberships VALUES('user','old-season','legacy-alliance','active',0,NULL)"),
  f.DB.prepare("INSERT INTO common_application_policies VALUES('site','season','legacy-alliance')"),
 ]);
 const before=await f.DB.prepare('SELECT * FROM roster_entries').all();
 const migration=await readFile(new URL('../migrations/0008_service_rosters.sql',import.meta.url),'utf8');for(const statement of migrationStatements(migration))await f.DB.prepare(statement).run();
 assert.deepEqual(await f.DB.prepare('SELECT * FROM roster_entries').all().then(r=>r.results),before.results);
 assert.equal((await f.DB.prepare('SELECT roster_id FROM default_access_roster').first())?.roster_id,'shared_legacy-alliance');
 const current=await readFile(new URL('../migrations/0009_service_administrators.sql',import.meta.url),'utf8');for(const statement of migrationStatements(current))await f.DB.prepare(statement).run();
 assert.equal((await commonAccess(f.env,'user','site'))?.access.allowed,true);
 await f.DB.prepare("UPDATE common_members SET status='suspended' WHERE user_id='user'").run();
 assert.equal((await commonAccess(f.env,'user','site'))?.access.allowed,false);
});

test('changing the shared default never rewires existing services or metadata-only edits',async t=>{
 const f=await setup();t.after(f.dispose);const old=await f.createService('alice','old-default');
 await f.DB.prepare("INSERT INTO member_organizations VALUES('second','다른 공유 명부')").run();
 assert.equal((await f.request('user','/developer/rosters',{action:'default',rosterId:'shared_second'})).status,200);
 const next=await f.createService('bob','new-default');
 assert.equal((await f.DB.prepare('SELECT roster_id FROM application_rosters WHERE client_id=?').bind(next).first())?.roster_id,'shared_second');
 assert.equal((await f.request('alice','/developer/services',{clientId:old,name:'Renamed',siteUrl:'https://old-default.test/'})).status,200);
 assert.equal((await f.DB.prepare('SELECT roster_id FROM application_rosters WHERE client_id=?').bind(old).first())?.roster_id,'shared_changcheon');
});

test('private roster CID normalization matches signup and coalesces equivalent input rows',async t=>{
 const f=await setup();t.after(f.dispose);const roster=await f.createRoster('alice');
 const input={rosterId:roster,revision:1,text:JSON.stringify({members:[{nickname:'A',cid:'000999'},{nickname:'A',cid:'999'}]})};
 const preview=await(await f.request('alice','/developer/rosters',{...input,action:'preview'})).json();assert.equal(preview.duplicateCount,1);assert.equal(preview.counts.add,1);
 assert.equal((await f.request('alice','/developer/rosters',{...input,action:'import',fingerprint:preview.fingerprint})).status,200);
 const client=await f.createService('alice','normalized-site',roster);await f.request('member','/auth/firebase/apply',{nickname:'A',gameUid:'000999'});
 assert.equal((await commonAccess(f.env,'member',client))?.access.allowed,true);
});
