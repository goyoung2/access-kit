import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';

async function fixture(ids:readonly string[]){
 const f=await createAuthFixture();await f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)").run();
 for(const id of ids)await f.DB.prepare("INSERT INTO users VALUES(?,?,NULL,'active',0,0)").bind(id,id).run();
 const sessions=new Map<string,string>();for(const id of ['user',...ids])sessions.set(id,(await createSession(f.env,id)).token);
 const request=(id:string,path:string,body?:unknown)=>app.request('https://auth.test'+path,{method:body?'POST':'GET',headers:{Cookie:'accesskit_sid='+sessions.get(id),Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},f.env);
 return {...f,request};
}

test('legacy invitation from a revoked issuer grants neither registration permission nor a service',async t=>{
 const f=await fixture(['backup','visitor']);t.after(f.dispose);
 await f.DB.prepare("INSERT INTO auth_operators VALUES('backup','operator',0,NULL)").run();
 const invitation=await(await f.request('user','/developer/admin/action',{action:'invite'})).json();
 assert.equal((await f.request('backup','/console/role',{userId:'user',role:'superadmin',enabled:false})).status,200);
 assert.equal((await f.request('visitor','/developer/invitation/redeem',{token:new URL(invitation.url).hash.slice(1)})).status,409);
 assert.equal((await f.request('visitor','/developer/services',{name:'Denied',siteUrl:'https://denied.test/',mode:'approved'})).status,403);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) n FROM developers WHERE user_id='visitor'").first())?.n,0);
});

test('legacy invitation issuer authority is checked inside the redemption transaction',async t=>{
 const f=await fixture(['backup','visitor']);t.after(f.dispose);
 await f.DB.prepare("INSERT INTO auth_operators VALUES('backup','operator',0,NULL)").run();
 const invitation=await(await f.request('user','/developer/admin/action',{action:'invite'})).json();
 const original=f.env.DB;let intercepted=false;
 f.env.DB=new Proxy(original,{get(target,key){if(key==='batch')return async<T>(statements:D1PreparedStatement[])=>{intercepted=true;f.env.DB=original;await original.prepare("DELETE FROM auth_operators WHERE user_id='user'").run();return original.batch<T>(statements);};const value:unknown=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 assert.equal((await f.request('visitor','/developer/invitation/redeem',{token:new URL(invitation.url).hash.slice(1)})).status,409);assert.equal(intercepted,true);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) n FROM developer_invitations WHERE redeemed_by IS NOT NULL").first())?.n,0);
});

test('legacy invitation cannot grant a disabled or suspended recipient but a valid invitation still works',async t=>{
 const f=await fixture(['visitor']);t.after(f.dispose);
 for(const blocked of ['disabled','suspended']){
  const invitation=await(await f.request('user','/developer/admin/action',{action:'invite'})).json();
  if(blocked==='disabled')await f.DB.prepare("UPDATE users SET status='disabled' WHERE id='visitor'").run();
  else await f.DB.prepare("INSERT INTO common_members VALUES('visitor','suspended',0,'user')").run();
  assert.equal((await f.request('visitor','/developer/invitation/redeem',{token:new URL(invitation.url).hash.slice(1)})).status,409,blocked);
  await f.DB.prepare("UPDATE users SET status='active' WHERE id='visitor'").run();await f.DB.prepare("DELETE FROM common_members WHERE user_id='visitor'").run();
  assert.equal((await f.request('visitor','/developer/invitation/redeem',{token:new URL(invitation.url).hash.slice(1)})).status,200);
  assert.equal((await f.request('visitor','/developer/invitation/redeem',{token:new URL(invitation.url).hash.slice(1)})).status,409);
 }
});

async function mergeFixture(){
 const f=await fixture(['source','legacy','other','future']);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO developers VALUES('source','active'),('other','active')"),
  f.DB.prepare("INSERT INTO auth_identities VALUES('src-google','source','firebase:test-project','google-source',0,0)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('group','Group')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('season','Season','active')"),
  f.DB.prepare("INSERT INTO game_accounts VALUES('legacy','kr','888','Legacy'),('future','kr','999','Future')"),
  f.DB.prepare("INSERT INTO common_members VALUES('legacy','approved',0,'user')"),
  f.DB.prepare("INSERT INTO member_applications VALUES('source','kr','888','Applicant','pending',0,NULL,NULL)"),
 ]);
 const {rosterId}=await(await f.request('source','/developer/rosters',{action:'create',name:'Owned private roster'})).json();
 const {clientId}=await(await f.request('source','/developer/services',{name:'Owned service',siteUrl:'https://own.test/',rosterId})).json();
 const other=await(await f.request('other','/developer/services',{name:'Other service',siteUrl:'https://other.test/',mode:'approved'})).json();
 assert.equal((await f.request('other','/console/services/'+other.clientId+'/admins',{userId:'source',enabled:true})).status,200);
 const merge=()=>f.request('user','/console/membership',{action:'approve',userId:'source',existingUserId:'legacy',seasonId:'season',organizationId:'group'});
 return {...f,rosterId,clientId,otherClientId:other.clientId,merge};
}

test('Google account linking preserves private-roster ownership, coadmin scope and pending service invitations',async t=>{
 const f=await mergeFixture();t.after(f.dispose);
 const pending=await(await f.request('source','/console/services/'+f.clientId+'/invitations',{action:'create',role:'service_admin',clientId:f.clientId,gameUid:'999'})).json();
 const beforeRoster=await f.DB.prepare('SELECT * FROM access_rosters WHERE id=?').bind(f.rosterId).first();
 assert.equal((await f.merge()).status,200);
 const after=await(await f.request('legacy','/console/services/'+f.clientId)).json();assert.equal(after.canManageRoster,true);
 assert.equal((await f.request('legacy','/developer/rosters/'+f.rosterId)).status,200);
 assert.equal((await f.request('legacy','/console/services/'+f.otherClientId)).status,200);
 assert.equal((await f.request('source','/console')).status,302);
 const row=await f.DB.prepare('SELECT * FROM access_rosters WHERE id=?').bind(f.rosterId).first();assert.deepEqual(row,{...beforeRoster,owner_user_id:'legacy'});
 assert.equal((await f.DB.prepare("SELECT user_id FROM auth_identities WHERE id='src-google'").first())?.user_id,'legacy');
 assert.equal((await f.request('future','/permissions/accept',{token:new URL(pending.url).hash.slice(1)})).status,200);
 assert.equal((await f.request('future','/console/services/'+f.otherClientId)).status,403);
});

test('account linking merges duplicate coadmin grants without duplicating the owner or losing unrelated grants',async t=>{
 const f=await mergeFixture();t.after(f.dispose);
 await f.DB.prepare("INSERT INTO application_administrators VALUES(?,'legacy','other',10)").bind(f.otherClientId).run();
 await f.DB.prepare("INSERT INTO application_administrators VALUES(?,'source','user',11)").bind(f.clientId).run();
 assert.equal((await f.merge()).status,200);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) n FROM application_administrators WHERE client_id=?').bind(f.otherClientId).first())?.n,1);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) n FROM application_administrators WHERE client_id=?').bind(f.clientId).first())?.n,0);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) n FROM application_administrators WHERE user_id='source'").first())?.n,0);
});

test('account linking never clears explicit registration revocation on either source or target',async()=>{
 for(const side of ['source','legacy']){
  const f=await mergeFixture();try{
   await f.DB.prepare("INSERT INTO developers VALUES(?,'inactive') ON CONFLICT(user_id) DO UPDATE SET status='inactive'").bind(side).run();
   assert.equal((await f.merge()).status,200);
   assert.equal((await f.DB.prepare("SELECT status FROM developers WHERE user_id='legacy'").first())?.status,'inactive',side);
   assert.equal((await f.request('legacy','/developer/services',{name:'Blocked registration',siteUrl:'https://blocked.test/',mode:'approved'})).status,403);
  }finally{await f.dispose();}
 }
});

test('pending legacy invitations follow the linked operator while used invitation history keeps its original issuer',async t=>{
 const f=await mergeFixture();t.after(f.dispose);
 await f.DB.prepare("INSERT INTO auth_operators VALUES('source','operator',0,NULL)").run();
 const live=await(await f.request('source','/developer/admin/action',{action:'invite'})).json();
 const used=await(await f.request('source','/developer/admin/action',{action:'invite'})).json();
 assert.equal((await f.request('future','/developer/invitation/redeem',{token:new URL(used.url).hash.slice(1)})).status,200);
 assert.equal((await f.merge()).status,200);
 const invitations=(await f.DB.prepare('SELECT created_by,redeemed_by FROM developer_invitations ORDER BY created_at').all()).results;
 assert.ok(invitations.some(r=>r.created_by==='legacy'&&r.redeemed_by===null));
 assert.ok(invitations.some(r=>r.created_by==='source'&&r.redeemed_by==='future'));
 assert.equal((await f.request('other','/developer/invitation/redeem',{token:new URL(live.url).hash.slice(1)})).status,200);
});

test('pagination reveals and cancels an older live invitation behind 100 records even when timestamps tie and new records arrive',async t=>{
 const f=await fixture([]);t.after(f.dispose);
 const oldest=await(await f.request('user','/console/permission-reservations',{action:'create',role:'developer',gameUid:'123'})).json(),now=Date.now();
 await f.DB.batch(Array.from({length:100},(_,i)=>f.DB.prepare("INSERT INTO permission_reservations VALUES(?,?,'developer',NULL,NULL,?,'user',?,?,?,NULL,NULL)").bind('history_'+i,'9'+i,'unused_hash_'+i,now+1,now+604800000,now)));
 const first=await(await f.request('user','/console/permission-reservations')).json();assert.equal(first.reservations.length,100);assert.equal(typeof first.nextCursor,'string');
 await f.DB.prepare("INSERT INTO permission_reservations VALUES('newest','555','developer',NULL,NULL,'newest_hash','user',?,?,NULL,NULL,NULL)").bind(now+2,now+604800000).run();
 const last=await(await f.request('user','/console/permission-reservations?cursor='+encodeURIComponent(first.nextCursor))).json();assert.deepEqual(last.reservations.map((r:{id:string})=>r.id),[oldest.id]);assert.equal(last.nextCursor,null);
 assert.equal(new Set([...first.reservations,...last.reservations].map((r:{id:string})=>r.id)).size,101);
 assert.equal((await f.request('user','/console/permission-reservations',{action:'revoke',id:last.reservations[0].id})).status,200);
});

test('reservation cursor pages stay scoped to one managed service and invalid cursors fail as input errors',async t=>{
 const f=await fixture(['alice','eve']);t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO applications VALUES('a','A','[\"https://a.test/\"]','active',0,0),('b','B','[\"https://b.test/\"]','active',0,0)"),
  f.DB.prepare("INSERT INTO application_owners VALUES('a','alice'),('b','eve')"),
 ]);
 const now=Date.now();await f.DB.batch(Array.from({length:102},(_,i)=>f.DB.prepare("INSERT INTO permission_reservations VALUES(?,?,'service_admin',?,NULL,?,'user',?,?,NULL,NULL,NULL)").bind('page_'+i,'8'+i,i===101?'b':'a','hash_page_'+i,now,now+604800000)));
 const first=await(await f.request('alice','/console/services/a/invitations')).json();assert.equal(typeof first.nextCursor,'string');
 const second=await(await f.request('alice','/console/services/a/invitations?cursor='+encodeURIComponent(first.nextCursor))).json();
 assert.equal([...first.reservations,...second.reservations].length,101);assert.ok([...first.reservations,...second.reservations].every((r:{client_id:string})=>r.client_id==='a'));
 assert.equal((await f.request('alice','/console/services/b/invitations?cursor='+encodeURIComponent(first.nextCursor))).status,403);
 assert.equal((await f.request('user','/console/permission-reservations?cursor=malformed')).status,400);
});
