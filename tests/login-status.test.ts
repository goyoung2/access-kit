import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';
import {registerCommonRoutes} from '../src/common-routes';
import type {Env} from '../src/types';

test('unapproved continue renders onboarding without a blanket denial and keeps authorization blocked',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.batch([
  f.DB.prepare("INSERT INTO common_application_policies VALUES('site','approved',NULL)"),
  f.DB.prepare("INSERT INTO oauth_requests VALUES('onboarding','site','https://site.test/','challenge','state',?,?)").bind(Date.now()+600000,Date.now()),
 ]);
 const session=await createSession(f.env,'user');
 const app=new Hono<{Bindings:Env}>();registerCommonRoutes(app);
 const response=await app.request('https://auth.test/auth/firebase/continue?request=onboarding',{headers:{Cookie:'accesskit_sid='+session.token}},f.env);
 assert.equal(response.status,200);
 assert.equal(response.headers.get('Location'),null);
 assert.doesNotMatch(await response.text(),/id="notice"/,'a first-time applicant must not receive a permanent access-denied notice');
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_codes').first<{n:number}>())?.n,0);
});
