import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {loginPage} from '../server/login.mjs';
const settings={clientId:'ui-fixture',siteUrl:'https://site.test/',authOrigin:'https://auth.test'};
async function runPage({url='https://site.test/',saved,autoLogin=true,status=401}={}){
 const storage=new Map(saved?[['access-kit:ui-fixture',saved]]:[]);
 const location=new URL(url);location.replace=value=>{location.target=value;};location.reload=()=>{location.reloaded=true;};
 const button={},message={},title={};const elements={'#login':button,'#message':message,'#service-title':title};
 const calls={login:0,bootstrap:0,modules:[],sessions:0};
 class Client{
  login(){calls.login++;}
  async bootstrap(){calls.bootstrap++;return {authenticated:true};}
  getAccessToken(){return 'token';}
  clearLocalState(){}
 }
 const html=loginPage(settings,status,autoLogin);
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace('await import(','await loadClient(');
 await runInNewContext('(async()=>{'+script+'})()',{
  URL,URLSearchParams,JSON,location,document:{querySelector:selector=>elements[selector]},
  sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  loadClient:async url=>{calls.modules.push(url);return {AccessKitClient:Client};},
  fetch:async url=>{if(url==='/__accesskit/session'){calls.sessions++;return new Response(null,{status:204});}return Response.json({title:'Fixture'});},
 });
 return {calls,button,message,location,storage};
}
test('login page executes normalized module loading and automatic sign in only when enabled',async()=>{
 for(const enabled of [true,false]){
  const result=await runPage({autoLogin:enabled});
  assert.deepEqual(result.calls.modules,['https://auth.test/sdk/v0.1.0/access-kit.js']);
  assert.equal(result.calls.login,enabled?1:0);
  await result.button.onclick();assert.equal(result.calls.login,enabled?2:1);
 }
});
test('login page processes only callbacks matching the pending browser state',async()=>{
 for(const state of ['unrelated','pending']){
  const result=await runPage({url:'https://site.test/?code=value&state='+state,saved:JSON.stringify({state:'pending'})});
  assert.equal(result.calls.bootstrap,state==='pending'?1:0);
  assert.equal(result.calls.sessions,state==='pending'?1:0);
  assert.equal(result.calls.login,state==='pending'?0:1);
 }
 const recovery=await runPage({saved:'broken-json'});
 assert.equal(recovery.calls.login,1);
});
