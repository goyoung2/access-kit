import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';
import {commonAccess} from '../src/common-membership';
import {mutateMembership} from '../src/common-admin';
import app from '../src/index';
import {readFile} from 'node:fs/promises';
import {migrationStatements} from './migration-statements';

async function fixture(){
 const f=await createAuthFixture();
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO users VALUES('manager','Manager',NULL,'active',0,0),('member','Member',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('own','Group A'),('other','Group B')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('s','Season 2','active'),('next','Season 3','draft')"),
  f.DB.prepare("INSERT INTO member_managers VALUES('manager','own','user',0)"),
 ]);
 const admin=await createSession(f.env,'user'),manager=await createSession(f.env,'manager');
 const post=(path:string,body:unknown,actor='user',env=f.env,origin='https://auth.test')=>app.request('https://auth.test/console/'+path,{method:'POST',headers:{Cookie:'accesskit_sid='+(actor==='user'?admin.token:manager.token),Origin:origin,'X-Access-Kit-Action':'1','Content-Type':'application/json'},body:JSON.stringify(body)},env);
 const data=async()=> (await(await app.request('https://auth.test/console/data',{headers:{Cookie:'accesskit_sid='+admin.token}},f.env)).json());
 const entity=async(kind:'season'|'organization',id:string)=>{const overview=await data();return (kind==='season'?overview.seasons:overview.organizations).find((row:{id:string})=>row.id===id);};
 return {...f,post,data,entity,manager};
}

test('season and affiliation names have CRUD with revisions, duplicate checks, recoverable deletion and stable IDs',async t=>{
 const f=await fixture();t.after(f.dispose);
 for(const kind of ['season','organization']){
  const created=await f.post('catalog',{action:'create',kind,name:kind==='season'?'Season 4':'New Group'});assert.equal(created.status,200);let row=(await created.json()).entity;
  const firstRevision=row.revision;
  const edited=await f.post('catalog',{action:'rename',kind,id:row.id,revision:row.revision,name:'Renamed '+kind});assert.equal(edited.status,200);row=(await edited.json()).entity;
  assert.ok(row.revision>firstRevision);assert.equal(row.name,'Renamed '+kind);
  assert.equal((await f.post('catalog',{action:'rename',kind,id:row.id,revision:firstRevision,name:'Stale'})).status,409);
  assert.equal((await f.post('catalog',{action:'create',kind,name:row.name})).status,409);
  const removed=await f.post('catalog',{action:'delete',kind,id:row.id,revision:row.revision});assert.equal(removed.status,200);row=(await removed.json()).entity;assert.ok(row.deleted_at);
  const restored=await f.post('catalog',{action:'restore',kind,id:row.id,revision:row.revision});assert.equal(restored.status,200);const live=(await restored.json()).entity;assert.equal(live.id,row.id);assert.equal(live.deleted_at,null);
 }
 assert.ok((await f.DB.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE event_type LIKE 'catalog.%'").first())?.n);
});

test('deleting an affiliation disables seasonal access and manager scope without deleting identities or history',async t=>{
 const f=await fixture();t.after(f.dispose);
 await f.DB.prepare("INSERT INTO member_applications VALUES('member','kr','123','Member','pending',0,NULL,NULL)").run();
 await mutateMembership(f.env,'user',{action:'approve',userId:'member',seasonId:'s',organizationId:'own'});
 await mutateMembership(f.env,'user',{action:'policy',clientId:'site',mode:'season',organizationId:'own'});
 assert.equal((await commonAccess(f.env,'member','site'))?.access.allowed,true);
 let org=await f.entity('organization','own');
 const deleted=await f.post('catalog',{action:'delete',kind:'organization',id:'own',revision:org.revision});assert.equal(deleted.status,200);org=(await deleted.json()).entity;
 assert.equal((await commonAccess(f.env,'member','site'))?.access.allowed,false);
 assert.equal((await app.request('https://auth.test/console/data',{headers:{Cookie:'accesskit_sid='+f.manager.token}},f.env)).status,403);
 assert.equal((await f.DB.prepare("SELECT user_id FROM game_accounts WHERE game_uid='123'").first())?.user_id,'member');
 assert.equal((await f.DB.prepare("SELECT status FROM season_memberships WHERE user_id='member' AND season_id='s'").first())?.status,'active');
 assert.equal((await f.post('roster',{action:'create',realm:'kr',seasonId:'s',organizationId:'own',gameUid:'124',nickname:'No'})).status,409);
 assert.equal((await f.post('role',{userId:'member',role:'manager',organizationId:'own',enabled:true})).status,409);
 assert.equal((await f.post('membership',{action:'policy',clientId:'site',mode:'season',organizationId:'own'})).status,409);
 const services=await app.request('https://auth.test/developer/services',{method:'POST',headers:{Cookie:'accesskit_sid='+(await createSession(f.env,'user')).token,Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},body:JSON.stringify({name:'Denied',siteUrl:'https://denied.test/',mode:'season',organizationId:'own'})},f.env);assert.equal(services.status,400);
 const restored=await f.post('catalog',{action:'restore',kind:'organization',id:'own',revision:org.revision});assert.equal(restored.status,200);
 assert.equal((await commonAccess(f.env,'member','site'))?.access.allowed,true);
 assert.equal((await app.request('https://auth.test/console/data',{headers:{Cookie:'accesskit_sid='+f.manager.token}},f.env)).status,200);
 await mutateMembership(f.env,'user',{action:'member',userId:'member',status:'suspended'});
 org=await f.entity('organization','own');const again=(await(await f.post('catalog',{action:'delete',kind:'organization',id:'own',revision:org.revision})).json()).entity;
 await f.post('catalog',{action:'restore',kind:'organization',id:'own',revision:again.revision});assert.equal((await commonAccess(f.env,'member','site'))?.access.allowed,false);
});

test('season end is explicit; deleted seasons cannot be started or written, and restore never activates them',async t=>{
 const f=await fixture();t.after(f.dispose);let season=await f.entity('season','s');
 assert.equal((await f.post('catalog',{action:'delete',kind:'season',id:'s',revision:season.revision})).status,409);
 const ended=await f.post('catalog',{action:'end',kind:'season',id:'s',revision:season.revision});assert.equal(ended.status,200);season=(await ended.json()).entity;assert.equal(season.status,'archived');
 const deleted=await f.post('catalog',{action:'delete',kind:'season',id:'s',revision:season.revision});assert.equal(deleted.status,200);season=(await deleted.json()).entity;
 assert.equal((await f.post('roster',{action:'create',realm:'kr',seasonId:'s',organizationId:'own',gameUid:'500',nickname:'No'})).status,409);
 const next=await f.entity('season','next');assert.equal((await f.post('catalog',{action:'delete',kind:'season',id:'next',revision:next.revision})).status,200);
 assert.equal((await f.post('membership',{action:'activate',seasonId:'next'})).status,409);
 assert.equal((await f.post('membership',{action:'copy',seasonId:'next',fromSeasonId:'s'})).status,409);
 assert.equal((await f.post('catalog',{action:'restore',kind:'season',id:'s',revision:season.revision})).status,200);assert.equal((await f.entity('season','s')).status,'archived');
});

test('copy skips deleted affiliations; managers with another scope cannot see their deleted-scope roster',async t=>{
 const f=await fixture();t.after(f.dispose);
 await f.DB.prepare("INSERT INTO member_managers VALUES('manager','other','user',0)").run();
 await f.DB.prepare("INSERT INTO member_applications VALUES('member','kr','123','Member','pending',0,NULL,NULL)").run();
 await mutateMembership(f.env,'user',{action:'approve',userId:'member',seasonId:'s',organizationId:'own'});
 await f.post('roster',{action:'create',realm:'kr',seasonId:'s',organizationId:'own',gameUid:'124',nickname:'Unlinked'});
 const org=await f.entity('organization','own');
 await f.post('catalog',{action:'delete',kind:'organization',id:'own',revision:org.revision});
 const overview=await(await app.request('https://auth.test/console/data',{headers:{Cookie:'accesskit_sid='+f.manager.token}},f.env)).json();
 assert.deepEqual(overview.identity.scopes,['other']);assert.equal(overview.roster.length,0);assert.equal(overview.members.length,0);
 assert.equal((await f.post('membership',{action:'copy',seasonId:'next',fromSeasonId:'s'})).status,200);
 assert.equal(await f.DB.prepare("SELECT * FROM season_memberships WHERE season_id='next'").first(),null);
 assert.equal(await f.DB.prepare("SELECT * FROM roster_entries WHERE season_id='next'").first(),null);
 // Name collisions must be resolved explicitly, including during restore.
 assert.equal((await f.post('catalog',{action:'create',kind:'organization',name:org.name})).status,200);
 const removed=await f.entity('organization','own');
 assert.equal((await f.post('catalog',{action:'restore',kind:'organization',id:'own',revision:removed.revision})).status,409);
 assert.equal((await f.post('catalog',{action:'rename',kind:'organization',id:'own',revision:removed.revision,name:'Restored Group'})).status,200);
 const renamed=await f.entity('organization','own');
 assert.equal((await f.post('catalog',{action:'restore',kind:'organization',id:'own',revision:renamed.revision})).status,200);
});

function pausedBatch(DB:D1Database){let resume=()=>{},arrive=()=>{};const ready=new Promise<void>(r=>{arrive=r;}),released=new Promise<void>(r=>{resume=r;});const database=new Proxy(DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{arrive();await released;return target.batch(statements);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});return{database,ready,resume};}

test('catalog writes enforce admin/origin and a concurrent deletion aborts roster creation',async t=>{
 const f=await fixture();t.after(f.dispose);
 assert.equal((await f.post('catalog',{action:'create',kind:'season',name:'No'},'manager')).status,403);
 assert.equal((await f.post('catalog',{action:'create',kind:'season',name:'No'},'user',f.env,'https://evil.test')).status,403);
 const pause=pausedBatch(f.DB),creating=f.post('roster',{action:'create',realm:'kr',seasonId:'s',organizationId:'own',gameUid:'600',nickname:'Race'},'user',{...f.env,DB:pause.database});
 await pause.ready;const org=await f.entity('organization','own');await f.post('catalog',{action:'delete',kind:'organization',id:'own',revision:org.revision});pause.resume();assert.equal((await creating).status,409);
 assert.equal(await f.DB.prepare("SELECT id FROM roster_entries WHERE game_uid='600'").first(),null);assert.equal(await f.DB.prepare('SELECT * FROM mutation_guards').first(),null);
});

test('affiliation deletion invalidates a delayed manager transfer from that affiliation',async t=>{
 const f=await fixture();t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO member_managers VALUES('manager','other','user',0)"),
  f.DB.prepare("INSERT INTO common_members VALUES('member','approved',0,'user')"),
  f.DB.prepare("INSERT INTO season_memberships VALUES('member','s','own','active',0,'user'),('member','next','other','active',0,'user')"),
 ]);
 const pause=pausedBatch(f.DB),moving=f.post('membership',{action:'assign',userId:'member',seasonId:'s',organizationId:'other',status:'active'},'manager',{...f.env,DB:pause.database});
 await pause.ready;const org=await f.entity('organization','own');
 await f.post('catalog',{action:'delete',kind:'organization',id:'own',revision:org.revision});pause.resume();
 assert.equal((await moving).status,409);
 assert.equal((await f.DB.prepare("SELECT organization_id FROM season_memberships WHERE user_id='member' AND season_id='s'").first())?.organization_id,'own');
});

test('catalog migration backfills existing names without changing data and legacy creates obey duplicate-name guards',async t=>{
 const f=await fixture();t.after(f.dispose);
 const before=await f.DB.prepare('SELECT * FROM member_seasons ORDER BY id').all();
 await f.DB.batch(['catalog_season_insert','catalog_organization_insert','catalog_season_update','catalog_organization_update'].map(trigger=>f.DB.prepare('DROP TRIGGER '+trigger)));
 await f.DB.prepare('DROP TABLE catalog_state').run();
 const sql=await readFile(new URL('../migrations/0006_catalog.sql',import.meta.url),'utf8');
 for(const statement of migrationStatements(sql))await f.DB.prepare(statement).run();
 assert.deepEqual((await f.DB.prepare('SELECT * FROM member_seasons ORDER BY id').all()).results,before.results);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM catalog_state WHERE revision=1 AND deleted_at IS NULL').first())?.n,4);
 assert.equal((await f.post('membership',{action:'season',id:'duplicate',name:'season 2'})).status,409);
 assert.equal((await f.post('membership',{action:'organization',id:'duplicate',name:'Group A'})).status,409);
 assert.equal((await f.post('membership',{action:'season',id:'new',name:'Season 5'})).status,200);
 assert.equal((await f.entity('season','new')).revision,1);
});
