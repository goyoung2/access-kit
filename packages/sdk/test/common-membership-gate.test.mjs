import test from 'node:test';
import assert from 'node:assert/strict';
import {createGate} from '../server/gate.mjs';

test('seven day site session reuses identity locally and rechecks season permission at the lease boundary',async t=>{
 const original=Date.now;let now=original(),checks=0,allowed=true,served=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{
  checks++;
  return allowed?Response.json({ok:true,data:{id:'existing-user',display_name:'기존 회원',status:'active',membership:{is_member:true},membershipAdmin:false},
   expires_at:original()+604800000,application_access:{client_id:'common-test',allowed:true,source:'policy'}}):new Response(null,{status:403});
 });
 const gate=createGate({clientId:'common-test',siteUrl:'https://site.test/',authOrigin:'https://auth.test',accessPolicy:'member',provider:'firebase',authorizationLeaseMs:300000,sessionMaxAgeSeconds:604800});
 const host={sessionSecret:'test-only-32-character-session-secret',serveAsset:async(request,identity)=>{
  served++;assert.deepEqual(identity,{id:'existing-user',displayName:'기존 회원',membershipAdmin:false});return Response.json(identity);
 }};
 for(const method of ['GET','HEAD'])assert.equal((await gate(new Request('https://site.test/private.json',{method}),host)).status,401);
 const login=await gate(new Request('https://site.test/__accesskit/session',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'seven-day-fixture'})}),host);
 assert.equal(login.status,204);assert.match(login.headers.get('Set-Cookie'),/Max-Age=604[78]\d\d/);
 const cookie=login.headers.get('Set-Cookie').split(';')[0],headers={Cookie:cookie};
 for(let i=0;i<5;i++)assert.equal((await gate(new Request('https://site.test/private.json',{headers}),host)).status,200);
 assert.equal(checks,1,'page/assets/reconnect inside lease do not contact AUTH');
 allowed=false;now+=300001;
 assert.equal((await gate(new Request('https://site.test/private.json',{headers}),host)).status,403);
 assert.equal(checks,2);assert.equal(served,5,'season removal never reaches protected handler');
});
