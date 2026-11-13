import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';

test('anonymous installation guide works without a database or Firebase setup while service registration stays protected',async()=>{
 const env={AUTH_PROVIDER:'firebase',DB:{prepare(){throw Error('Public guide must not query member data');}}};
 const guide=await app.request('https://auth.test/guide',{},env);
 assert.equal(guide.status,200);
 assert.match(guide.headers.get('Content-Type')||'',/^text\/html/);
 assert.equal((await app.request('https://auth.test/developer/services',{},env)).status,403);
 assert.equal((await app.request('https://auth.test/guide',{},{})).status,200);
});
