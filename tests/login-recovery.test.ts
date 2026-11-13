import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';
import app from '../src/index';

test('inactive role holder cannot enter console through status redirects',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.prepare("INSERT INTO developers VALUES('user','active')").run();
 const session=await createSession(f.env,'user');
 await f.DB.prepare("UPDATE users SET status='disabled' WHERE id='user'").run();
 const response=await app.request('https://auth.test/auth/firebase/status',{headers:{Cookie:'accesskit_sid='+session.token}},f.env);
 const status=await response.json();
 assert.equal(status.consoleAccess,false);assert.equal(status.blocked,true);
});

test('service access status admits an operator without requiring common membership',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
  f.DB.prepare("INSERT INTO common_application_policies VALUES('site','admin',NULL)"),
  f.DB.prepare("INSERT INTO oauth_requests VALUES('request','site','https://site.test/',?,?,?,?)").bind('a'.repeat(43),'b'.repeat(24),Date.now()+600000,Date.now()),
 ]);
 const session=await createSession(f.env,'user');
 const response=await app.request('https://auth.test/auth/firebase/status?request=request',{headers:{Cookie:'accesskit_sid='+session.token}},f.env);
 const status=await response.json();assert.equal(status.member,null);assert.equal(status.serviceAccess.allowed,true);
 await f.DB.prepare("UPDATE oauth_requests SET expires_at=0 WHERE id='request'").run();
 const expired=await app.request('https://auth.test/auth/firebase/continue?request=request',{headers:{Cookie:'accesskit_sid='+session.token}},f.env);
 assert.equal(expired.status,400);assert.match(await expired.text(),/href="https:\/\/site.test\/"/);
});
