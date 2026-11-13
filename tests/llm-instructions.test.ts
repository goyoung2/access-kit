import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import app from '../src/index';
import type {Env} from '../src/types';
import {createAuthFixture} from './auth-fixture';
import {createAuthorizationCode,exchangeAuthorizationCode} from '../src/store';
import {sha256Base64Url} from '../src/crypto';
import {createGate} from '../packages/sdk/server/gate.mjs';

test('official LLM instructions are public without Firebase/DB, with typed connection data and no secret reflection',async()=>{
 const response=await app.request('https://auth.test/guide/llm?client_id=site&site_url=https%3A%2F%2Fsite.test%2F&hosting=pages&assets=build&token=never-reflect',{},{} as Env);
 assert.equal(response.status,200);
 assert.match(response.headers.get('Content-Type')||'',/^text\/plain/);
 const output=await response.text();
 const [,payload]=output.split('<access-kit-context>\n');assert.ok(payload);
 const context=JSON.parse(payload.split('\n</access-kit-context>')[0]);
 assert.deepEqual(context,{sdkVersion:'0.3.1',authOrigin:'https://auth.test',clientId:'site',siteUrl:'https://site.test/',hosting:'pages',assets:'build'});
 assert.equal(output.includes('never-reflect'),false);
 for(const query of ['site_url=http://site.test/','site_url=https://site.test/path','hosting=unknown','client_id=bad%0Acommand'])assert.equal((await app.request('https://auth.test/guide/llm?'+query,{},{} as Env)).status,400);
});

test('public delivery uses the exact canonical instruction artifact, allowing prose changes without pinned wording',async()=>{
 const document=(await readFile(new URL('../docs/LLM_INSTALLATION.md',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 const prompt=document.split('<!-- access-kit-prompt:start -->\n```text\n')[1]?.split('\n```\n<!-- access-kit-prompt:end -->')[0];assert.ok(prompt);
 const output=await(await app.request('https://auth.test/guide/llm',{},{} as Env)).text();
 const delivered=output.split('\n\n<access-kit-context>')[0];
 const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
 assert.equal(digest(delivered),digest(prompt));
});

test('administrator service instructions carry the SDK administrator policy instead of member defaults',async()=>{
 const response=await app.request('https://auth.test/guide/llm?access_policy=admin',{},{} as Env);
 const payload=(await response.text()).split('<access-kit-context>\n')[1].split('\n</access-kit-context>')[0];
 assert.equal(JSON.parse(payload).accessPolicy,'admin');
 assert.equal((await app.request('https://auth.test/guide/llm?access_policy=guest',{},{} as Env)).status,400);
});

test('installing the delivered administrator context admits an operator without common membership',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.batch([f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),f.DB.prepare("INSERT INTO common_application_policies VALUES('site','admin',NULL)")]);
 const output=await(await app.request('https://auth.test/guide/llm?client_id=site&site_url=https%3A%2F%2Fsite.test%2F&access_policy=admin',{},f.env)).text();
 const context=JSON.parse(output.split('<access-kit-context>\n')[1].split('\n</access-kit-context>')[0]);
 const verifier='a'.repeat(43),code=await createAuthorizationCode(f.env,'user','site','https://site.test/',await sha256Base64Url(verifier));
 const token=await exchangeAuthorizationCode(f.env,{code,clientId:'site',redirectUri:'https://site.test/',codeVerifier:verifier});
 const gate=createGate(context),env={sessionSecret:'synthetic-local-session-secret'.repeat(2),fetchAuth:(input:RequestInfo,init?:RequestInit)=>app.fetch(new Request(input,init),f.env),serveAsset:()=>new Response('protected admin content')};
 const session=await gate(new Request('https://site.test/__accesskit/session',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({access_token:token.accessToken})}),env);
 assert.equal(session.status,204);
 const cookie=session.headers.get('Set-Cookie')?.split(';')[0];assert.ok(cookie);
 assert.equal((await gate(new Request('https://site.test/',{headers:{Cookie:cookie}}),env)).status,200);
});
