import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';
import {createAuthFixture} from './auth-fixture';
import {createSession,createAuthorizationCode,exchangeAuthorizationCode} from '../src/store';
import {sha256Base64Url} from '../src/crypto';
import {commonAccess} from '../src/common-membership';
import {bootstrapSql} from '../packages/sdk/bin/auth-project.mjs';
import {createGate} from '../packages/sdk/server/gate.mjs';

async function instance(name:string,cid:string){
 const f=await createAuthFixture();f.env.FIREBASE_PROJECT_ID=name+'-project';f.env.AUTH_ORIGIN='https://'+name+'.test';
 await f.DB.batch([
  f.DB.prepare("INSERT INTO auth_identities VALUES('google-owner','user',?,'owner-google-uid',0,0)").bind('firebase:'+f.env.FIREBASE_PROJECT_ID),
  f.DB.prepare("INSERT INTO users VALUES('member','Local member',NULL,'active',0,0),('visitor','Visitor',NULL,'active',0,0),('developer','Developer',NULL,'active',0,0)"),
  f.DB.prepare("INSERT INTO member_organizations VALUES('org',?)").bind(name),
  f.DB.prepare("INSERT INTO member_seasons VALUES('season','S1','active')"),
  f.DB.prepare("INSERT INTO roster_entries VALUES('entry','kr',?,?,'season','org','active',1,0,'user')").bind(cid,name+' member'),
  f.DB.prepare("INSERT INTO default_access_roster VALUES(1,'shared_org')"),
 ]);
 const statements=bootstrapSql(f.env.FIREBASE_PROJECT_ID,'owner-google-uid').split(';').map((s:string)=>s.trim()).filter(Boolean);await f.DB.batch(statements.map((s:string)=>f.DB.prepare(s)));
 const sessions=new Map<string,string>();for(const id of ['user','member','visitor','developer'])sessions.set(id,(await createSession(f.env,id)).token);
 const request=(id:string,path:string,body?:unknown)=>app.request(f.env.AUTH_ORIGIN+path,{method:body?'POST':'GET',headers:{Cookie:'accesskit_sid='+sessions.get(id),Origin:f.env.AUTH_ORIGIN,'Content-Type':'application/json','X-Access-Kit-Action':'1'},...(body?{body:JSON.stringify(body)}:{})},f.env);
 async function service(id:string,suffix:string){const url='https://'+name+'-'+suffix+'.test/';const response=await request(id,'/developer/services',{name:suffix,siteUrl:url});assert.equal(response.status,200);return {id:(await response.json()).clientId,url};}
 return {...f,request,service,sessions};
}

test('independent bootstrap requires a matching logged-in Firebase identity and never grants a second first-admin',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.prepare("INSERT INTO auth_identities VALUES('google','user','firebase:own-project','known-uid',0,0)").run();
 const bootstrap=async(project:string,uid:string)=>{for(const sql of bootstrapSql(project,uid).split(';').filter((s:string)=>s.trim()))await f.DB.prepare(sql).run();};
 await bootstrap('other-project','known-uid');await bootstrap('own-project','not-logged-in');
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_operators').first())?.n,0);
 await bootstrap('own-project','known-uid');assert.equal((await f.DB.prepare('SELECT user_id FROM auth_operators').first())?.user_id,'user');
 await f.DB.prepare("INSERT INTO users VALUES('other','Other',NULL,'active',0,0)").run();await f.DB.prepare("INSERT INTO auth_identities VALUES('other-google','other','firebase:own-project','other-uid',0,0)").run();
 await bootstrap('own-project','other-uid');assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_operators').first())?.n,1);
});

test('Changcheon services share one roster; another alliance owns separate registration, CID links, suspension and admin data',async t=>{
 const a=await instance('changcheon','123'),b=await instance('bangju','999');t.after(async()=>{await a.dispose();await b.dispose();});
 await a.DB.prepare("INSERT INTO developers VALUES('developer','active')").run();const shared1=await a.service('user','one'),shared2=await a.service('developer','two'),independent=await b.service('user','one');
 assert.equal((await a.request('member','/auth/firebase/apply',{nickname:'A nickname',gameUid:'123'})).status,200);
 assert.equal((await b.request('member','/auth/firebase/apply',{nickname:'B nickname',gameUid:'999'})).status,200,'same local user ID can link a different CID in its own DB');
 assert.equal((await commonAccess(a.env,'member',shared1.id))?.access.allowed,true);assert.equal((await commonAccess(a.env,'member',shared2.id))?.access.allowed,true);
 assert.equal((await commonAccess(b.env,'member',independent.id))?.access.allowed,true);
 assert.equal((await b.request('visitor','/auth/firebase/apply',{nickname:'Unknown in B',gameUid:'123'})).status,200,'CID known to A is not globally reserved');
 assert.equal((await(await b.request('visitor','/auth/firebase/status')).json()).member.status,'visitor');
 assert.equal((await commonAccess(b.env,'visitor',independent.id))?.access.allowed,false);
 const before=(await a.DB.prepare('SELECT * FROM roster_entries').all()).results;
 const removed=await b.request('user','/console/roster',{action:'delete',id:'entry',revision:1});assert.equal(removed.status,200);
 assert.equal((await commonAccess(b.env,'member',independent.id))?.access.allowed,false);assert.deepEqual((await a.DB.prepare('SELECT * FROM roster_entries').all()).results,before);
 assert.equal((await b.request('user','/console/membership',{action:'member',userId:'member',status:'suspended'})).status,200);
 assert.equal((await commonAccess(a.env,'member',shared1.id))?.access.allowed,true);
 assert.equal((await app.request(b.env.AUTH_ORIGIN+'/console/data',{headers:{Cookie:'accesskit_sid='+a.sessions.get('user')}},b.env)).status,403,'an A administrator session has no authority in B');
 assert.equal((await a.DB.prepare("SELECT game_uid FROM game_accounts WHERE user_id='member'").first())?.game_uid,'123');
 assert.equal((await b.DB.prepare("SELECT game_uid FROM game_accounts WHERE user_id='member'").first())?.game_uid,'999');
});

test('real SDK gates preserve API requests and reject tokens and cookies from another independent auth DB',async t=>{
 const a=await instance('changcheon','123'),b=await instance('bangju','123');t.after(async()=>{await a.dispose();await b.dispose();});
 const services=[await a.service('user','site'),await b.service('user','site')];const instances=[a,b];
 for(const f of instances)assert.equal((await f.request('member','/auth/firebase/apply',{nickname:'Member',gameUid:'123'})).status,200);
 const tokens:string[]=[];
 for(const [i,f] of instances.entries()){const verifier='v'.repeat(43),s=services[i];const code=await createAuthorizationCode(f.env,'member',s.id,s.url,await sha256Base64Url(verifier));tokens.push((await exchangeAuthorizationCode(f.env,{code,clientId:s.id,redirectUri:s.url,codeVerifier:verifier})).accessToken);}
 const gates=services.map((s,i)=>createGate({clientId:s.id,siteUrl:s.url,authOrigin:instances[i].env.AUTH_ORIGIN,accessPolicy:'member'}));
 const hosts=instances.map(f=>({sessionSecret:'local-only-independent-key-0123456789',fetchAuth:(input:RequestInfo,init?:RequestInit)=>app.fetch(new Request(input,init),f.env),serveAsset:async(request:Request)=>Response.json({method:request.method,body:await request.text()})}));
 for(const [i,gate] of gates.entries())assert.equal((await gate(new Request(services[i].url),hosts[i])).status,401);
 const login=(i:number,token:string)=>gates[i](new Request(new URL('/__accesskit/session',services[i].url),{method:'POST',headers:{Origin:new URL(services[i].url).origin,'Content-Type':'application/json'},body:JSON.stringify({access_token:token})}),hosts[i]);
 const first=await login(0,tokens[0]);assert.equal(first.status,204);const cookie=first.headers.get('Set-Cookie')?.split(';')[0];assert.ok(cookie);
 const api=await gates[0](new Request(new URL('/api/echo',services[0].url),{method:'POST',headers:{Cookie:cookie},body:'preserved'}),hosts[0]);assert.deepEqual(await api.json(),{method:'POST',body:'preserved'});
 assert.equal((await gates[1](new Request(services[1].url,{headers:{Cookie:cookie}}),hosts[1])).status,401);
 assert.equal((await login(1,tokens[0])).status,401,'another DB does not recognize the token');
 assert.equal((await login(1,tokens[1])).status,204);
 const logout=await gates[0](new Request(new URL('/__accesskit/logout',services[0].url),{method:'POST',headers:{Origin:new URL(services[0].url).origin,Cookie:cookie}}),hosts[0]);assert.equal(logout.status,204);
 assert.equal((await gates[0](new Request(services[0].url,{headers:{Cookie:cookie}}),hosts[0])).status,401);
});
