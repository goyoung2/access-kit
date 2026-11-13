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

test('authenticated application POST reaches the original handler with its body',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({ok:true,data:{id:'post-user',display_name:'User',status:'active',membership:{is_member:true}},expires_at:Date.now()+604800000,application_access:{client_id:'post-app',allowed:true,source:'policy'}}));
 const gate=createGate({clientId:'post-app',siteUrl:'https://post.test/',authOrigin:'https://auth.test',accessPolicy:'member'});
 let dispatched=0;const host={sessionSecret:'test-secret-with-at-least-32-characters',serveAsset:async r=>{dispatched++;return new Response(await r.text(),{status:201});}};
 assert.equal((await gate(new Request('https://post.test/api',{method:'POST',body:'denied'}),host)).status,401);assert.equal(dispatched,0);
 const login=await gate(new Request('https://post.test/__accesskit/session',{method:'POST',headers:{Origin:'https://post.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'post-test-token'})}),host);
 const cookie=login.headers.get('Set-Cookie').split(';')[0];const response=await gate(new Request('https://post.test/api',{method:'POST',headers:{Cookie:cookie},body:'original-body'}),host);
 assert.equal(response.status,201);assert.equal(await response.text(),'original-body');assert.equal(dispatched,1);
});
test('local admin policy rejects centrally approved members and accepts only operators',async()=>{
 const gate=createGate({clientId:'admin-app',siteUrl:'https://admin.test/',authOrigin:'https://auth.test',accessPolicy:'admin'});
 let admin=false;
 const host={sessionSecret:'test-secret-with-at-least-32-characters',serveAsset:async()=>new Response('private'),fetchAuth:async()=>Response.json({
  ok:true,data:{id:'member',status:'active',membershipAdmin:admin},expires_at:Date.now()+600000,application_access:{client_id:'admin-app',allowed:true,source:'policy'},
 })};
 const exchange=()=>gate(new Request('https://admin.test/__accesskit/session',{method:'POST',headers:{Origin:'https://admin.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'admin-test-token'})}),host);
 assert.equal((await exchange()).status,403);
 admin=true;
 assert.equal((await exchange()).status,204);
});

test('root query parameters remain app-owned and lease renewal preserves distinct cookies',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const gate=createGate({clientId:'query-app',siteUrl:'https://query.test/',authOrigin:'https://auth.test/',accessPolicy:'member',authorizationLeaseMs:1000});
 const appCookies=['a=first; Path=/','b=second; Expires=Wed, 21 Oct 2030 07:28:00 GMT'];
 const host={sessionSecret:'test-secret-with-at-least-32-characters',serveAsset:async r=>new Response(new URL(r.url).search,{headers:appCookies.map(cookie=>['Set-Cookie',cookie])}),
  fetchAuth:async()=>Response.json({ok:true,data:{id:'member',status:'active',membership:{is_member:true}},expires_at:now+600000,application_access:{client_id:'query-app',allowed:true,source:'policy'}})};
 const login=await gate(new Request('https://query.test/__accesskit/session',{method:'POST',headers:{Origin:'https://query.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'query-test-token'})}),host);
 const cookie=login.headers.getSetCookie()[0].split(';')[0];
 now+=1001;
 for(const query of ['?code=app-feature','?error=app-feature&state=custom']) {
  const result=await gate(new Request('https://query.test/'+query,{headers:{Cookie:cookie}}),host);
  assert.equal(result.status,200);
  assert.equal(await result.text(),query);
  assert.deepEqual(result.headers.getSetCookie().slice(0,2),appCookies);
  assert.equal(result.headers.getSetCookie().length,3);
 }
 const denied=await gate(new Request('https://query.test/',{headers:{Accept:'text/html'}}),host);
 assert.match(await denied.text(),/"authOrigin":"https:\/\/auth\.test"/);
});

test('explicit logout clears site cookie and suppresses automatic login in the subsequent page',async()=>{
 const gate=createGate({clientId:'logout-app',siteUrl:'https://logout.test/',authOrigin:'https://auth.test',accessPolicy:'member'});
 const host={sessionSecret:'test-secret-with-at-least-32-characters',serveAsset:async()=>new Response('private')};
 const logout=await gate(new Request('https://logout.test/__accesskit/logout',{method:'POST',headers:{Origin:'https://logout.test'}}),host);
 assert.equal(logout.status,204);
 const cookies=logout.headers.getSetCookie();
 assert.match(cookies[0],/Max-Age=0/);
 const suppression=cookies[1].split(';')[0];
 const denied=await gate(new Request('https://logout.test/',{headers:{Accept:'text/html',Cookie:suppression}}),host);
 assert.equal(denied.status,401);
 assert.match(await denied.text(),/"autoLogin":false/);
});
test('correlated OAuth callback renders login while unrelated state remains app-owned',async()=>{
 const gate=createGate({clientId:'callback-app',siteUrl:'https://callback.test/',authOrigin:'https://auth.test',accessPolicy:'member'});
 const host={sessionSecret:'test-secret-with-at-least-32-characters',serveAsset:async()=>new Response('app'),
 fetchAuth:async()=>Response.json({ok:true,data:{id:'member',status:'active',membership:{is_member:true}},expires_at:Date.now()+600000,application_access:{client_id:'callback-app',allowed:true,source:'policy'}})};
 const login=await gate(new Request('https://callback.test/__accesskit/session',{method:'POST',headers:{Origin:'https://callback.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'callback-token'})}),host);
 const cookie=login.headers.getSetCookie()[0].split(';')[0];
 const href='https://callback.test/?code=app-value&state=pending-state';
 assert.equal((await gate(new Request(href,{headers:{Cookie:cookie+'; __Host-accesskit_oauth_state=unrelated-state'}}),host)).status,200);
 assert.equal((await gate(new Request(href,{headers:{Cookie:cookie+'; __Host-accesskit_oauth_state=pending-state',Accept:'text/html'}}),host)).status,401);
});
test('confirmed logout preserves bounded cross-isolate lease until the next central check',async t=>{
 let now=Date.now(),revoked=false;t.mock.method(Date,'now',()=>now);
 const settings={clientId:'isolate-app',siteUrl:'https://isolate.test/',authOrigin:'https://auth.test',accessPolicy:'member',authorizationLeaseMs:1000};
 const host={sessionSecret:'test-secret-with-at-least-32-characters',serveAsset:async()=>new Response('private'),fetchAuth:async input=>{
  if(new URL(input).pathname==='/logout'){revoked=true;return new Response(null,{status:204});}
  return revoked?new Response(null,{status:401}):Response.json({ok:true,data:{id:'member',status:'active',membership:{is_member:true}},expires_at:now+600000,application_access:{client_id:'isolate-app',allowed:true,source:'policy'}});
 }};
 const first=createGate(settings);
 const second=(await import('../server/gate.mjs?isolated-revocation-test')).createGate(settings);
 const login=await first(new Request('https://isolate.test/__accesskit/session',{method:'POST',headers:{Origin:'https://isolate.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'isolate-token'})}),host);
 const cookie=login.headers.getSetCookie()[0].split(';')[0];
 const request=()=>new Request('https://isolate.test/',{headers:{Cookie:cookie}});
 const logout=await first(new Request('https://isolate.test/__accesskit/logout',{method:'POST',headers:{Origin:'https://isolate.test',Cookie:cookie}}),host);
 assert.equal(logout.headers.get('X-Access-Kit-Revoke'),'confirmed');
 assert.equal((await first(request(),host)).status,401);
 assert.equal((await second(request(),host)).status,200);
 now+=1001;
 assert.equal((await second(request(),host)).status,401);
});
