import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthFixture} from './auth-fixture';
import {mutateMembership,MembershipConflict} from '../src/common-admin';
import {createSession} from '../src/store';
import app from '../src/index';

function pausedBatch(DB:D1Database) {
 let resume=()=>{};
 let reached=()=>{};
 const ready=new Promise<void>(resolve=>{reached=resolve;});
 const release=new Promise<void>(resolve=>{resume=resolve;});
 const database=new Proxy(DB,{get(target,key){
  if(key==='batch')return async (statements:D1PreparedStatement[])=>{reached();await release;return target.batch(statements);};
  const value=Reflect.get(target,key,target);
  return typeof value==='function'?value.bind(target):value;
 }});
 return {database,ready,resume};
}

async function fixture(){
 const f=await createAuthFixture();
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO users VALUES('member','Member',NULL,'active',0,0),('manager','Manager',NULL,'active',0,0),('disabled','Disabled',NULL,'disabled',0,0)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('own','Own'),('other','Other')"),
  f.DB.prepare("INSERT INTO member_seasons VALUES('s','Season','active')"),
  f.DB.prepare("INSERT INTO member_applications VALUES('member','kr','123','Nick','pending',0,NULL,NULL)"),
  f.DB.prepare("INSERT INTO member_managers VALUES('manager','own','user',0)"),
 ]);
 return f;
}

test('delayed approval rolls back after rejection, retaining no membership or receipt',async t=>{
 const f=await fixture();t.after(f.dispose);const pause=pausedBatch(f.DB);
 const result=mutateMembership({...f.env,DB:pause.database},'user',{action:'approve',userId:'member',seasonId:'s',organizationId:'own'});
 const rejected=assert.rejects(result,MembershipConflict);
 await pause.ready;
 await mutateMembership(f.env,'user',{action:'reject',userId:'member'});
 pause.resume();await rejected;
 assert.equal((await f.DB.prepare("SELECT status FROM member_applications WHERE user_id='member'").first())?.status,'rejected');
 assert.equal(await f.DB.prepare("SELECT * FROM common_members WHERE user_id='member'").first(),null);
 assert.equal(await f.DB.prepare('SELECT * FROM member_approval_receipts').first(),null);
 assert.equal(await f.DB.prepare('SELECT * FROM mutation_guards').first(),null);
});

test('delayed manager write cannot undo a transfer outside its scope',async t=>{
 const f=await fixture();t.after(f.dispose);
 await mutateMembership(f.env,'user',{action:'approve',userId:'member',seasonId:'s',organizationId:'own'});
 const pause=pausedBatch(f.DB);
 const result=mutateMembership({...f.env,DB:pause.database},'manager',{action:'assign',userId:'member',seasonId:'s',organizationId:'own',status:'inactive'});
 const rejected=assert.rejects(result,MembershipConflict);await pause.ready;
 await mutateMembership(f.env,'user',{action:'assign',userId:'member',seasonId:'s',organizationId:'other',status:'active'});
 pause.resume();await rejected;
 assert.deepEqual(await f.DB.prepare("SELECT organization_id,status FROM season_memberships WHERE user_id='member'").first(),{organization_id:'other',status:'active'});
});

test('mutual role revocation leaves one active administrator despite disabled operator row',async t=>{
 const f=await fixture();t.after(f.dispose);
 await f.DB.prepare("INSERT INTO auth_operators VALUES('manager','operator',0,NULL),('disabled','operator',0,NULL)").run();
 const a=await createSession(f.env,'user'),b=await createSession(f.env,'manager'),pause=pausedBatch(f.DB);
 const revoke=(cookie:string,userId:string,env=f.env)=>app.request('https://auth.test/console/role',{method:'POST',headers:{Cookie:'accesskit_sid='+cookie,Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},body:JSON.stringify({userId,role:'superadmin',enabled:false})},env);
 const delayed=revoke(a.token,'manager',{...f.env,DB:pause.database});await pause.ready;
 assert.equal((await revoke(b.token,'user')).status,200);pause.resume();
 assert.equal((await delayed).status,409);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM auth_operators o JOIN users u ON u.id=o.user_id WHERE u.status='active'").first())?.n,1);
 await assert.rejects(()=>f.DB.prepare("UPDATE users SET status='disabled' WHERE id='manager'").run(),/LAST_OPERATOR/);
});

test('Google account linking transfers authority together with the login identity',async t=>{
 const f=await fixture();t.after(f.dispose);
 await f.DB.prepare("INSERT INTO auth_operators VALUES('member','operator',0,NULL)").run();
 await f.DB.prepare("DELETE FROM auth_operators WHERE user_id='user'").run();
 await f.DB.prepare("INSERT INTO member_managers VALUES('member','own','member',0)").run();
 await f.DB.prepare("INSERT INTO developers VALUES('member','active')").run();
 await f.DB.prepare("INSERT INTO application_owners VALUES('site','member')").run();
 await f.DB.prepare("INSERT INTO auth_identities VALUES('google','member','firebase:test-project','sub',0,0)").run();
 await mutateMembership(f.env,'member',{action:'approve',userId:'member',existingUserId:'user',seasonId:'s',organizationId:'own'});
 assert.equal((await f.DB.prepare("SELECT user_id FROM auth_identities WHERE id='google'").first())?.user_id,'user');
 assert.equal((await f.DB.prepare("SELECT user_id FROM auth_operators WHERE user_id='user'").first())?.user_id,'user');
 assert.equal(await f.DB.prepare("SELECT user_id FROM auth_operators WHERE user_id='member'").first(),null);
 assert.equal((await f.DB.prepare("SELECT user_id FROM member_managers WHERE user_id='user' AND organization_id='own'").first())?.user_id,'user');
 assert.equal((await f.DB.prepare("SELECT status FROM developers WHERE user_id='user'").first())?.status,'active');
 assert.equal((await f.DB.prepare("SELECT user_id FROM application_owners WHERE client_id='site'").first())?.user_id,'user');
});
