import test from 'node:test';
import assert from 'node:assert/strict';
import {createGate} from '../server/gate.mjs';

test('SDK passes a server-verified service developer role without converting it into platform admin',async()=>{
 const identities=[];
 const settings={clientId:'owned',siteUrl:'https://owned.test/',authOrigin:'https://auth.test',accessPolicy:'member'};
 const gate=createGate(settings),host={sessionSecret:'local-only-service-developer-secret',serveAsset:async(_request,identity)=>{identities.push(identity);return new Response('private');},fetchAuth:async()=>Response.json({ok:true,data:{id:'owner',status:'active',membership:{is_member:true},serviceDeveloper:true,membershipAdmin:false},expires_at:Date.now()+604800000,application_access:{client_id:'owned',allowed:true,source:'policy'}})};
 const login=await gate(new Request('https://owned.test/__accesskit/session',{method:'POST',headers:{Origin:'https://owned.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'server-verified-owner'})}),host);
 assert.equal(login.status,204);const cookie=login.headers.get('Set-Cookie').split(';')[0];
 assert.equal((await gate(new Request('https://owned.test/admin',{headers:{Cookie:cookie}}),host)).status,200);
 assert.equal(identities[0].serviceDeveloper,true);assert.equal(identities[0].membershipAdmin,false);
 const other=createGate({...settings,clientId:'other'});
 assert.equal((await other(new Request('https://owned.test/admin',{headers:{Cookie:cookie}}),host)).status,401,'another service cannot consume the developer cookie');
});
