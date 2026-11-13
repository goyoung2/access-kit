import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';
import {mutateMembership} from '../src/common-admin';
import {commonAccess} from '../src/common-membership';
import app from '../src/index';
import {readFile} from 'node:fs/promises';
import {migrationStatements} from './migration-statements';

async function fixture(){
 const f=await createAuthFixture();
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('own','Own'),('other','Other')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('s','Season','active'),('next','Next','draft')"),
  f.DB.prepare("INSERT INTO users VALUES('manager','Manager',NULL,'active',0,0),('member','Member',NULL,'active',0,0),('dev','Dev',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO member_managers VALUES('manager','own','user',0)"),
  f.DB.prepare("INSERT INTO developers VALUES('dev','active')"),
 ]);
 const sessions={user:await createSession(f.env,'user'),manager:await createSession(f.env,'manager'),dev:await createSession(f.env,'dev')};
 const request=(actor:keyof typeof sessions,body:unknown,origin='https://auth.test',env=f.env)=>app.request('https://auth.test/console/roster',{method:'POST',headers:{Cookie:'accesskit_sid='+sessions[actor].token,Origin:origin,'X-Access-Kit-Action':'1','Content-Type':'application/json'},body:JSON.stringify(body)},env);
 return {...f,request,sessions};
}
const context={realm:'kr',seasonId:'s',organizationId:'own'};

test('roster CRUD works before Google login, rejects duplicate and stale writes, and restores deleted entries',async t=>{
 const f=await fixture();t.after(f.dispose);
 const created=await f.request('user',{action:'create',...context,nickname:'First',gameUid:'90000000001'});
 assert.equal(created.status,200);let entry=(await created.json()).entry;
 assert.equal(await f.DB.prepare("SELECT * FROM game_accounts WHERE game_uid='90000000001'").first(),null);
 assert.equal((await f.request('user',{action:'create',...context,nickname:'Duplicate',gameUid:entry.game_uid})).status,409);
 const edited=await f.request('user',{action:'update',...context,id:entry.id,revision:entry.revision,nickname:'Renamed',gameUid:'90000000002'});
 assert.equal(edited.status,200);const updated=(await edited.json()).entry;
 assert.equal(updated.nickname,'Renamed');assert.equal(updated.game_uid,'90000000002');
 assert.equal((await f.request('user',{action:'delete',id:entry.id,revision:entry.revision})).status,409);
 const deleted=await f.request('user',{action:'delete',id:updated.id,revision:updated.revision});assert.equal(deleted.status,200);entry=(await deleted.json()).entry;
 assert.equal(entry.status,'deleted');
 const restored=await f.request('user',{action:'restore',id:entry.id,revision:entry.revision});assert.equal(restored.status,200);assert.equal((await restored.json()).entry.status,'active');
 assert.ok((await f.DB.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE event_type LIKE 'roster.%'").first())?.n);
});

test('import previews the supplied JSON shape and pasted tables, commits atomically and rejects stale previews',async t=>{
 const f=await fixture();t.after(f.dispose);
 const text=JSON.stringify({schema_version:2,cid_source_field:'avatarId',records:[{nickname:'One',cid:'101'},{nickname:'Two',cid:'102'}]});
 const previewResponse=await f.request('user',{action:'preview',...context,text});assert.equal(previewResponse.status,200);const preview=await previewResponse.json();
 assert.equal(preview.ready,true);assert.equal(preview.counts.add,2);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM roster_entries').first())?.n,0);
 const committed=await f.request('user',{action:'import',...context,text,fingerprint:preview.fingerprint});assert.equal(committed.status,200);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM roster_entries').first())?.n,2);
 assert.equal((await f.request('user',{action:'import',...context,text,fingerprint:preview.fingerprint})).status,409);
 const pasted=await f.request('user',{action:'preview',...context,text:'닉네임\tUID\nNew One\t101\nThree\t103'});const table=await pasted.json();assert.equal(table.counts.update,1);assert.equal(table.counts.add,1);
 assert.equal((await f.request('user',{action:'import',...context,text:'닉네임\tUID\nNew One\t101\nThree\t103',fingerprint:table.fingerprint})).status,200);
 const invalid=await(await f.request('user',{action:'preview',...context,text:'[{"nickname":"A","cid":9007199254740993},{"nickname":"B","cid":"104"}]'})).json();assert.equal(invalid.ready,false);assert.ok(invalid.errors.length);
 const conflict=await(await f.request('user',{action:'preview',...context,text:'A,105\nB,105'})).json();assert.equal(conflict.ready,false);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM roster_entries WHERE game_uid IN ('104','105')").first())?.n,0);
});

test('member managers stay in their scope; developers and cross-origin requests cannot write or read rosters',async t=>{
 const f=await fixture();t.after(f.dispose);
 const create={action:'create',...context,nickname:'Scoped',gameUid:'10'};
 assert.equal((await f.request('dev',create)).status,403);
 assert.equal((await f.request('user',create,'https://evil.test')).status,403);
 assert.equal((await f.request('manager',{...create,organizationId:'other'})).status,403);
 const owned=await f.request('manager',create);assert.equal(owned.status,200);const entry=(await owned.json()).entry;
 assert.equal((await f.request('manager',{...create,action:'update',id:entry.id,revision:entry.revision,organizationId:'other'})).status,403);
 const other=(await(await f.request('user',{...create,organizationId:'other',gameUid:'11'})).json()).entry;
 assert.equal((await f.request('manager',{action:'delete',id:other.id,revision:other.revision})).status,403);
 const data=await(await app.request('https://auth.test/console/data',{headers:{Cookie:'accesskit_sid='+f.sessions.manager.token}},f.env)).json();assert.equal(data.roster.length,1);assert.equal(data.roster[0].organization_id,'own');
 const dev=await(await app.request('https://auth.test/console/data',{headers:{Cookie:'accesskit_sid='+f.sessions.dev.token}},f.env)).json();assert.deepEqual(dev.roster,[]);
});

test('approval links the UID roster, edits and deletion affect seasonal access while account IDs and suspension survive',async t=>{
 const f=await fixture();t.after(f.dispose);
 await f.request('user',{action:'create',...context,nickname:'Roster Name',gameUid:'123'});
 await f.DB.batch([f.DB.prepare("INSERT INTO member_applications VALUES('member','kr','123','Applicant','pending',0,NULL,NULL)"),f.DB.prepare("INSERT INTO common_application_policies VALUES('site','season','own')")]);
 await mutateMembership(f.env,'user',{action:'approve',userId:'member',seasonId:'s',organizationId:'own'});
 assert.equal((await commonAccess(f.env,'member','site'))?.access.allowed,true);
 let entry=await f.DB.prepare("SELECT * FROM roster_entries WHERE game_uid='123'").first();assert.ok(entry);
 const renamed=await f.request('user',{action:'update',...context,id:entry.id,revision:entry.revision,nickname:'New Name',gameUid:'123'});assert.equal(renamed.status,200);entry=(await renamed.json()).entry;
 assert.equal((await f.DB.prepare("SELECT nickname FROM game_accounts WHERE user_id='member'").first())?.nickname,'New Name');
 assert.equal((await f.request('user',{action:'update',...context,id:entry.id,revision:entry.revision,nickname:'Wrong',gameUid:'124'})).status,409);
 const removed=await f.request('user',{action:'delete',id:entry.id,revision:entry.revision});assert.equal(removed.status,200);entry=(await removed.json()).entry;
 assert.equal((await commonAccess(f.env,'member','site'))?.access.allowed,false);
 assert.equal((await f.DB.prepare("SELECT id FROM users WHERE id='member'").first())?.id,'member');
 await mutateMembership(f.env,'user',{action:'member',userId:'member',status:'suspended'});
 assert.equal((await f.request('user',{action:'restore',id:entry.id,revision:entry.revision})).status,200);
 assert.equal((await f.DB.prepare("SELECT status FROM common_members WHERE user_id='member'").first())?.status,'suspended');
 assert.equal((await commonAccess(f.env,'member','site'))?.access.allowed,false);
});

test('season copy includes unlinked roster entries and preserves explicit exclusions; deleted rows block approval',async t=>{
 const f=await fixture();t.after(f.dispose);
 await f.request('user',{action:'create',...context,nickname:'Unlinked',gameUid:'501'});
 let removed=(await(await f.request('user',{action:'create',...context,nickname:'Excluded',gameUid:'502'})).json()).entry;
 await f.request('user',{action:'delete',id:removed.id,revision:removed.revision});
 removed=(await(await f.request('user',{action:'create',...context,seasonId:'next',nickname:'Keep excluded',gameUid:'501'})).json()).entry;
 await f.request('user',{action:'delete',id:removed.id,revision:removed.revision});
 await mutateMembership(f.env,'user',{action:'copy',seasonId:'next',fromSeasonId:'s'});
 assert.equal((await f.DB.prepare("SELECT status FROM roster_entries WHERE season_id='next' AND game_uid='501'").first())?.status,'deleted');
 assert.equal(await f.DB.prepare("SELECT id FROM roster_entries WHERE season_id='next' AND game_uid='502'").first(),null);
 await f.DB.prepare("INSERT INTO member_applications VALUES('member','kr','502','Excluded','pending',0,NULL,NULL)").run();
 await assert.rejects(mutateMembership(f.env,'user',{action:'approve',userId:'member',seasonId:'s',organizationId:'own'}));
 assert.equal(await f.DB.prepare("SELECT user_id FROM common_members WHERE user_id='member'").first(),null);
 await f.request('user',{action:'create',...context,nickname:'Copy me',gameUid:'503'});
 await mutateMembership(f.env,'user',{action:'copy',seasonId:'next',fromSeasonId:'s'});
 assert.equal((await f.DB.prepare("SELECT nickname FROM roster_entries WHERE season_id='next' AND game_uid='503'").first())?.nickname,'Copy me');
});

function pausedBatch(DB:D1Database){
 let resume=()=>{},reached=()=>{};
 const ready=new Promise<void>(resolve=>{reached=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});
 const database=new Proxy(DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{reached();await release;return target.batch(statements);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 return {database,ready,resume};
}

test('revoked authority and late import conflicts roll back all roster and membership writes',async t=>{
 const f=await fixture();t.after(f.dispose);
 let pause=pausedBatch(f.DB);
 const create=f.request('manager',{action:'create',...context,nickname:'Revoked',gameUid:'601'},'https://auth.test',{...f.env,DB:pause.database});
 await pause.ready;await f.DB.prepare("DELETE FROM member_managers WHERE user_id='manager'").run();pause.resume();assert.equal((await create).status,409);
 assert.equal(await f.DB.prepare("SELECT id FROM roster_entries WHERE game_uid='601'").first(),null);
 await f.request('user',{action:'create',...context,nickname:'Original',gameUid:'602'});
 const text='Changed,602\nNew,603',preview=await(await f.request('user',{action:'preview',...context,text})).json();
 pause=pausedBatch(f.DB);
 const importing=f.request('user',{action:'import',...context,text,fingerprint:preview.fingerprint},'https://auth.test',{...f.env,DB:pause.database});
 await pause.ready;await f.request('user',{action:'create',...context,nickname:'Concurrent',gameUid:'603'});pause.resume();assert.equal((await importing).status,409);
 assert.equal((await f.DB.prepare("SELECT nickname FROM roster_entries WHERE game_uid='602'").first())?.nickname,'Original');
 assert.equal((await f.DB.prepare("SELECT nickname FROM roster_entries WHERE game_uid='603'").first())?.nickname,'Concurrent');
 assert.equal(await f.DB.prepare('SELECT * FROM mutation_guards').first(),null);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE event_type='roster.import'").first())?.n,0);
});

test('roster migration preserves existing user IDs, inactive memberships and suspension while backfilling records',async t=>{
 const f=await fixture();t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare('DROP TRIGGER roster_after_membership_insert'),f.DB.prepare('DROP TRIGGER roster_after_membership_update'),f.DB.prepare('DROP TABLE roster_entries'),
  f.DB.prepare("INSERT INTO common_members VALUES('member','suspended',0,'user')"),f.DB.prepare("INSERT INTO game_accounts VALUES('member','kr','700','Existing')"),
  f.DB.prepare("INSERT INTO season_memberships VALUES('member','s','own','inactive',10,'user')"),
 ]);
 const migration=await readFile(new URL('../migrations/0005_roster.sql',import.meta.url),'utf8');for(const sql of migrationStatements(migration))await f.DB.prepare(sql).run();
 assert.deepEqual(await f.DB.prepare("SELECT game_uid,nickname,status FROM roster_entries WHERE game_uid='700'").first(),{game_uid:'700',nickname:'Existing',status:'deleted'});
 assert.equal((await f.DB.prepare("SELECT status FROM common_members WHERE user_id='member'").first())?.status,'suspended');
 assert.equal((await f.DB.prepare("SELECT user_id,status FROM season_memberships WHERE user_id='member'").first())?.user_id,'member');
 await f.DB.prepare("UPDATE member_seasons SET status='archived' WHERE id='s'").run();
 const row=await f.DB.prepare("SELECT id,revision FROM roster_entries WHERE game_uid='700'").first();assert.ok(row);
 assert.equal((await f.request('user',{action:'restore',id:row.id,revision:row.revision})).status,409);
});

test('season copy honors target exclusions and organization selections made before a Google account was linked',async t=>{
 const f=await fixture();t.after(f.dispose);
 let target=(await(await f.request('user',{action:'create',...context,seasonId:'next',nickname:'Before linking',gameUid:'800'})).json()).entry;
 await f.request('user',{action:'delete',id:target.id,revision:target.revision});
 await f.DB.prepare("INSERT INTO member_applications VALUES('member','kr','800','Linked','pending',0,NULL,NULL)").run();
 await mutateMembership(f.env,'user',{action:'approve',userId:'member',seasonId:'s',organizationId:'own'});
 await mutateMembership(f.env,'user',{action:'copy',seasonId:'next',fromSeasonId:'s'});
 target=await f.DB.prepare("SELECT * FROM roster_entries WHERE game_uid='800' AND season_id='next'").first();assert.ok(target);assert.equal(target.status,'deleted');
 assert.equal(await f.DB.prepare("SELECT * FROM season_memberships WHERE user_id='member' AND season_id='next'").first(),null);
 await f.request('user',{action:'restore',id:target.id,revision:target.revision});
 target=await f.DB.prepare("SELECT * FROM roster_entries WHERE game_uid='800' AND season_id='next'").first();assert.ok(target);
 await f.request('user',{action:'update',...context,seasonId:'next',organizationId:'other',id:target.id,revision:target.revision,nickname:'Other org',gameUid:'800'});
 await mutateMembership(f.env,'user',{action:'copy',seasonId:'next',fromSeasonId:'s'});
 assert.equal((await f.DB.prepare("SELECT organization_id FROM roster_entries WHERE game_uid='800' AND season_id='next'").first())?.organization_id,'other');
 await f.request('user',{action:'create',...context,seasonId:'next',organizationId:'other',nickname:'Before linking two',gameUid:'801'});
 await f.DB.prepare("INSERT INTO member_applications VALUES('dev','kr','801','Second account','pending',0,NULL,NULL)").run();
 await mutateMembership(f.env,'user',{action:'approve',userId:'dev',seasonId:'s',organizationId:'own'});
 await mutateMembership(f.env,'user',{action:'copy',seasonId:'next',fromSeasonId:'s'});
 assert.equal((await f.DB.prepare("SELECT organization_id FROM season_memberships WHERE user_id='dev' AND season_id='next'").first())?.organization_id,'other');
 assert.equal((await f.DB.prepare("SELECT organization_id FROM roster_entries WHERE game_uid='801' AND season_id='next'").first())?.organization_id,'other');
});

test('large imports persist every UID and a season becoming active aborts a delayed copy',async t=>{
 const f=await fixture();t.after(f.dispose);
 const text=JSON.stringify(Array.from({length:1000},(_,index)=>({nickname:'Synthetic '+index,cid:String(80000000+index)})));
 const preview=await(await f.request('user',{action:'preview',...context,text})).json();assert.equal(preview.counts.add,1000);
 assert.equal((await f.request('user',{action:'import',...context,text,fingerprint:preview.fingerprint})).status,200);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM roster_entries').first())?.n,1000);
 const pause=pausedBatch(f.DB);
 const copying=mutateMembership({...f.env,DB:pause.database},'user',{action:'copy',seasonId:'next',fromSeasonId:'s'});
 const failure=assert.rejects(copying);await pause.ready;
 await mutateMembership(f.env,'user',{action:'activate',seasonId:'next'});pause.resume();await failure;
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM roster_entries WHERE season_id='next'").first())?.n,0);
});
