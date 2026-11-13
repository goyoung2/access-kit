import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';
import app from '../src/index';

/** Count real D1 round trips and writes without replacing query results. */
function observe(DB:D1Database){
 const counters={roundTrips:0,rowsRead:0};
 const originals=new WeakMap<D1PreparedStatement,D1PreparedStatement>();
 const sqlByStatement=new WeakMap<D1PreparedStatement,string>();
 const batches:{readonly sql:string;readonly read:number}[]=[];
 function statement(raw:D1PreparedStatement,sql:string):D1PreparedStatement{
  const wrapped=new Proxy(raw,{get(target,key){
   if(key==='bind')return (...values:unknown[])=>statement(target.bind(...values),sql);
   const method=Reflect.get(target,key,target);
   if(typeof method!=='function')return method;
   return (...args:unknown[])=>{counters.roundTrips++;return Reflect.apply(method,target,args);};
  }});
  originals.set(wrapped,raw);sqlByStatement.set(wrapped,sql);return wrapped;
 }
 const database=new Proxy(DB,{get(target,key){
  if(key==='prepare')return (sql:string)=>statement(target.prepare(sql),sql);
  if(key==='batch')return async (statements:D1PreparedStatement[])=>{
   counters.roundTrips++;
   const results=await target.batch(statements.map(item=>originals.get(item)??item));
   for(const [index,result] of results.entries()){counters.rowsRead+=result.meta.rows_read;batches.push({sql:sqlByStatement.get(statements[index])??'',read:result.meta.rows_read});}
   return results;
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 return {database,counters,batches,reset(){counters.roundTrips=0;counters.rowsRead=0;batches.length=0;}};
}

async function fixture(){
 const f=await createAuthFixture();
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('own','Own'),('other','Other')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('s','Season','active')"),
  f.DB.prepare("INSERT INTO users VALUES('manager','Manager',NULL,'active',0,0),('developer','Developer',NULL,'active',0,0),('applicant','Applicant',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO member_managers VALUES('manager','own','user',0)"),
  f.DB.prepare("INSERT INTO developers VALUES('developer','active')"),
  f.DB.prepare("INSERT INTO application_owners VALUES('site','developer')"),
  f.DB.prepare("INSERT INTO member_applications VALUES('applicant','kr','9999','Pending','pending',0,NULL,NULL)"),
  f.DB.prepare("INSERT INTO login_branding VALUES('site','Title','Description','','#4657cf','light',0)"),
  f.DB.prepare("INSERT INTO auth_events VALUES('event','user',NULL,'fixture',?,0)").bind(JSON.stringify({text:'quotes " <script> 한글'})),
 ]);
 for(let index=0;index<108;index++){
  const user=index===0?'user':'member-'+index,nickname='Synthetic '+index;
  if(index)await f.DB.prepare("INSERT INTO users VALUES(?,?,NULL,'active',0,0)").bind(user,nickname).run();
  await f.DB.batch([
   f.DB.prepare("INSERT INTO common_members VALUES(?,'approved',0,'user')").bind(user),
   f.DB.prepare("INSERT INTO game_accounts VALUES(?,'kr',?,?)").bind(user,String(1000+index),nickname),
   f.DB.prepare("INSERT INTO season_memberships VALUES(?,'s',?,'active',0,'user')").bind(user,index===107?'other':'own'),
  ]);
 }
 const sessions={user:await createSession(f.env,'user'),manager:await createSession(f.env,'manager'),developer:await createSession(f.env,'developer')};
 const meter=observe(f.DB),env={...f.env,DB:meter.database};
 const request=(actor:keyof typeof sessions,path:string,body?:unknown)=>app.request('https://auth.test/console/'+path,{method:body?'POST':'GET',headers:{Cookie:'accesskit_sid='+sessions[actor].token,Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},env);
 return {...f,request,meter,sessions};
}

test('console snapshot preserves complete data and scoped visibility with bounded D1 round trips',async t=>{
 const f=await fixture();t.after(f.dispose);
 const response=await f.request('user','data');assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.members.length,108);assert.equal(data.roster.length,108);assert.equal(data.users.length,111);
 assert.equal(data.identity.superadmin,true);assert.equal(data.identity.developer,false);
 assert.equal(data.events[0].detail,JSON.stringify({text:'quotes " <script> 한글'}));
 assert.equal(data.brands[0].title,'Title');assert.equal(data.seasons[0].roster_count,108);
 assert.deepEqual(Object.keys(data).sort(),['applications','members','seasons','organizations','assignments','services','identity','users','managers','events','brands','roster'].sort());
 const trips=f.meter.counters.roundTrips;
 const manager=await(await f.request('manager','data')).json();
 assert.equal(manager.members.length,107);assert.equal(manager.roster.length,107);
 assert.ok(manager.assignments.every((row:{organization_id:string})=>row.organization_id==='own'));
 assert.deepEqual(manager.users,[]);assert.deepEqual(manager.events,[]);assert.deepEqual(manager.services,[]);
 assert.equal(manager.applications[0].nickname,'Pending');
 const developer=await(await f.request('developer','data')).json();
 assert.deepEqual(developer.members,[]);assert.deepEqual(developer.roster,[]);assert.deepEqual(developer.applications,[]);
 assert.equal(developer.services[0].client_id,'site');assert.equal(developer.brands[0].title,'Title');
 assert.ok(trips<=4,`108-member console snapshot used ${trips} D1 round trips (budget 4)`);
 t.diagnostic(JSON.stringify({consoleRoundTrips:trips}));
});

test('108-member preview and import retain UID/revision protection within a bounded D1 budget',async t=>{
 const f=await fixture();t.after(f.dispose);
 const context={realm:'kr',seasonId:'s',organizationId:'own'};
 const text=JSON.stringify(Array.from({length:107},(_,index)=>({nickname:'Synthetic '+index,cid:String(1000+index)})));
 const previewResponse=await f.request('user','roster',{action:'preview',...context,text});assert.equal(previewResponse.status,200);
 const preview=await previewResponse.json();assert.equal(preview.ready,true);assert.equal(preview.counts.unchanged,107);
 const previewTrips=f.meter.counters.roundTrips;
 f.meter.reset();
 const imported=await f.request('user','roster',{action:'import',...context,text,fingerprint:preview.fingerprint});assert.equal(imported.status,200);
 assert.equal((await imported.json()).counts.unchanged,107);
 const importTrips=f.meter.counters.roundTrips,rowsRead=f.meter.counters.rowsRead;
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM roster_entries").first())?.n,108);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE event_type='roster.import'").first())?.n,1);
 assert.equal(await f.DB.prepare('SELECT * FROM mutation_guards').first(),null);
 assert.ok(previewTrips<=4,`preview used ${previewTrips} D1 round trips (budget 4)`);
 assert.ok(importTrips<=5,`import used ${importTrips} D1 round trips (budget 5)`);
 assert.ok(rowsRead<3000,`unchanged 107-member import scanned ${rowsRead} rows (budget <3000): ${JSON.stringify(f.meter.batches)}`);
 await f.DB.prepare("UPDATE common_members SET status='suspended' WHERE user_id='member-7'").run();
 const renamed=JSON.stringify(Array.from({length:107},(_,index)=>({nickname:'Renamed '+index,cid:String(1000+index)})));
 const renamePreview=await(await f.request('user','roster',{action:'preview',...context,text:renamed})).json();
 assert.equal(renamePreview.counts.update,107);f.meter.reset();
 assert.equal((await f.request('user','roster',{action:'import',...context,text:renamed,fingerprint:renamePreview.fingerprint})).status,200);
 assert.equal((await f.DB.prepare("SELECT nickname FROM game_accounts WHERE user_id='member-7'").first())?.nickname,'Renamed 7');
 assert.equal((await f.DB.prepare("SELECT status FROM common_members WHERE user_id='member-7'").first())?.status,'suspended');
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM season_memberships WHERE organization_id='other'").first())?.n,1);
 assert.ok(f.meter.counters.rowsRead<6000,`linked import scanned ${f.meter.counters.rowsRead} rows: ${JSON.stringify(f.meter.batches.filter(row=>row.read>1000))}`);
 t.diagnostic(JSON.stringify({previewRoundTrips:previewTrips,importRoundTrips:importTrips,unchangedImportBatchRowsRead:rowsRead,linkedImportBatchRowsRead:f.meter.counters.rowsRead}));
});

test('console retains its complete response when D1 cannot aggregate a large JSON value',async t=>{
 const f=await fixture();t.after(f.dispose);
 let limited=0;
 const DB=new Proxy(f.DB,{get(target,key){
  if(key==='prepare')return (sql:string)=>{
   const statement=target.prepare(sql);
   if(!sql.includes('AS snapshot'))return statement;
   limited++;
   return new Proxy(statement,{get(prepared,method){
    if(method==='bind')return ()=>({first:async()=>{throw new Error('D1_ERROR: string or blob too big: SQLITE_TOOBIG');}});
    const value=Reflect.get(prepared,method,prepared);return typeof value==='function'?value.bind(prepared):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 for(const actor of ['user','manager','developer'] as const){
  const expected=await(await f.request(actor,'data')).json();
  const response=await app.request('https://auth.test/console/data',{headers:{Cookie:'accesskit_sid='+f.sessions[actor].token}},{...f.env,DB});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),expected);
 }
 assert.equal(limited,3);
});
