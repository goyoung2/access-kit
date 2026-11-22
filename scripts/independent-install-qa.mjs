// Disposable local installation trial. All identities and CIDs are synthetic.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as miniflare from 'miniflare';
import {createSession} from '../src/store.ts';
import {sha256Base64Url} from '../src/crypto.ts';

const root=fileURLToPath(new URL('../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n',read=async path=>JSON.parse(await readFile(path,'utf8'));
const cli=project=>join(project,'node_modules/access-kit-sdk/bin/access-kit.mjs');
const command=(project,args)=>execFileSync(process.execPath,[cli(project),...args],{cwd:project,encoding:'utf8',stdio:['ignore','pipe','pipe']});
async function openServer(project){
 const directory=join(project,'own-auth'),config=await read(join(directory,'wrangler.jsonc'));
 const options={modules:true,scriptPath:join(directory,'worker.mjs'),compatibilityDate:config.compatibility_date,bindings:config.vars,d1Databases:{DB:config.d1_databases[0].database_id},resourcePersistencePath:join(directory,'.wrangler/state/v3'),d1Persist:join(directory,'.wrangler/state/v3/d1')};
 const mf=new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare?miniflare.convertV4MiniflareOptions(options):options),DB=await mf.getD1Database('DB');
 const request=(path,{cookie,body,method,headers}={})=>mf.dispatchFetch(new URL(path,config.vars.AUTH_ORIGIN).href,{redirect:'manual',method:method||(body?'POST':'GET'),headers:{Origin:config.vars.AUTH_ORIGIN,'X-Access-Kit-Action':'1','Content-Type':'application/json',...(cookie?{Cookie:'accesskit_sid='+cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 return {mf,DB,config,request};
}
async function prepare(){
 const project=await mkdtemp(join(tmpdir(),'access-kit-independent-prompt-'));await mkdir(join(project,'public'));await mkdir(join(project,'src'));
 const write=(name,value)=>writeFile(join(project,name),value);
 await write('public/index.html','<!doctype html><title>Independent trial</title><h1>Existing private site</h1>');await write('public/private.json',json({value:'existing-private-data'}));
 await write('src/worker.mjs',"export const preserved='original-export';export default {async fetch(request,env){if(new URL(request.url).pathname==='/api/echo')return Response.json({method:request.method,body:await request.text(),marker:env.MARKER});return env.ASSETS.fetch(request);}};\n");
 await write('build.mjs',"import {mkdir,cp} from 'node:fs/promises';await mkdir('dist',{recursive:true});await cp('public','dist',{recursive:true});\n");
 await write('wrangler.jsonc',json({name:'existing-independent-site',main:'src/worker.mjs',compatibility_date:'2026-08-24',assets:{directory:'dist',binding:'ASSETS'},vars:{MARKER:'original-binding'}}));
 const loader=pathToFileURL(join(root,'node_modules/tsx/dist/loader.mjs')).href,harness=join(root,'scripts/independent-install-qa.mjs').replaceAll('\\','/');
 await write('package.json',json({name:'independent-prompt-trial',type:'module',private:true,scripts:{build:'node build.mjs','setup:auth-fixture':`node --import "${loader}" "${harness}" setup .`,'verify:access-kit':`node --import "${loader}" "${harness}" verify .`}}));
 await write('.gitignore','node_modules/\ndist/\n.wrangler/\n.access-kit/\n.dev.vars*\n.env*\nown-auth/\nsdk.tgz\n');
 await copyFile(join(root,'dist/access-kit-sdk-0.6.0.tgz'),join(project,'sdk.tgz'));
 const context={mode:'independent',sdkVersion:'0.6.0',packageFile:join(project,'sdk.tgz').replaceAll('\\','/'),packageSha256:hash(await readFile(join(project,'sdk.tgz'))),siteUrl:'https://independent-site.example.test/',auth:{directory:'own-auth',name:'bangju-auth-fixture',authOrigin:'https://bangju-auth.example.test',firebaseProjectId:'bangju-fixture',firebaseApiKey:'synthetic-public-web-key',firebaseAuthDomain:'bangju-fixture.firebaseapp.com',firebaseAppId:'synthetic-app'},fixtureSetupCommand:'npm run setup:auth-fixture',localVerificationCommand:'npm run verify:access-kit',deploymentAllowed:false};
 await write('access-kit-context.json',json(context));await copyFile(join(root,'docs/LLM_INDEPENDENT.md'),join(project,'GUIDE.md'));
 await write('README.md','# Disposable independent installer trial\n\nRead access-kit-context.json. Only this fixture may be modified. No remote resources, deployment, secret upload, npm publish, GitHub push or real credentials. After creating own-auth and applying local migrations, run npm run setup:auth-fixture. This seeds synthetic Google-identity rows (not a real Google login), executes the installed CLI first-admin bootstrap, creates the local roster through the generated server HTTP API, and writes its clientId/authOrigin into access-kit-context.json. Use that connection for this existing site. After installing the gate and building, run npm run verify:access-kit. Do not alter or weaken verification. The source-harness path is a read-only test dependency.\n');
 const baseline={};for(const name of ['src/worker.mjs','wrangler.jsonc','public/index.html','public/private.json'])baseline[name]=hash(await readFile(join(project,name)));await write('.original-files.json',json(baseline));
 const git=(...args)=>execFileSync('git',args,{cwd:project,stdio:'pipe'});git('init','-b','codex/independent-prompt');git('add','.');git('-c','user.name=Local installer QA','-c','user.email=qa@example.test','commit','-m','test: independent installation fixture');
 const prompt='Access Kit으로 내 명부와 회원 정보를 내 서버·DB에서 독립 관리하도록 설치해 주세요.\nGUIDE.md 안내와 access-kit-context.json을 읽고 설치부터 가입 분류·게이트 검증까지 끝내세요. 원격 변경·배포·npm 게시는 하지 마세요.\n';
 await write('prompt.txt',prompt);console.log(json({project,prompt:join(project,'prompt.txt')}));
}
async function setup(project){
 let server=await openServer(project);
 try{
  assert.ok(await server.DB.prepare("SELECT name FROM sqlite_master WHERE name='automatic_registrations'").first(),'apply the generated local migrations first');
  if(await server.DB.prepare("SELECT id FROM users WHERE id='qa_owner'").first())throw Error('Fixture already seeded; use its existing connection instead of resetting it');
  await server.DB.batch([
   server.DB.prepare("INSERT INTO users VALUES('qa_owner','QA Owner',NULL,'active',0,0),('qa_member','QA Member',NULL,'active',0,0),('qa_visitor','QA Visitor',NULL,'active',0,0)"),
   server.DB.prepare("INSERT INTO auth_identities VALUES('qa_google','qa_owner',?,'qa-owner-google-uid',0,0)").bind('firebase:'+server.config.vars.FIREBASE_PROJECT_ID),
  ]);
 }finally{await server.mf.dispose();}
 command(project,['auth','bootstrap','--directory','own-auth','--firebase-uid','qa-owner-google-uid','--local']);
 server=await openServer(project);
 try{
  assert.equal((await server.DB.prepare('SELECT user_id FROM auth_operators').first())?.user_id,'qa_owner');
  const env={DB:server.DB},sessions={};for(const id of ['qa_owner','qa_member','qa_visitor'])sessions[id]=(await createSession(env,id)).token;
  const action=async(path,body)=>{const r=await server.request(path,{cookie:sessions.qa_owner,body});assert.equal(r.status,200,await r.clone().text());return r.json();};
  const org=(await action('/console/catalog',{action:'create',kind:'organization',name:'방주 QA'})).entity;
  const season=(await action('/console/catalog',{action:'create',kind:'season',name:'S1 QA'})).entity;
  await action('/console/membership',{action:'activate',seasonId:season.id});
  const input={realm:'kr',seasonId:season.id,organizationId:org.id,text:JSON.stringify({members:[{nickname:'Roster name',cid:'777'}]})};
  const preview=await action('/console/roster',{...input,action:'preview'});await action('/console/roster',{...input,action:'import',fingerprint:preview.fingerprint});
  await action('/developer/rosters',{action:'default',rosterId:'shared_'+org.id});
  const context=await read(join(project,'access-kit-context.json')),service=await action('/developer/services',{name:'Independent existing site',siteUrl:context.siteUrl});
  for(const [id,cid] of [['qa_member','777'],['qa_visitor','888']])assert.equal((await server.request('/auth/firebase/apply',{cookie:sessions[id],body:{nickname:id,gameUid:cid}})).status,200);
  await mkdir(join(project,'.access-kit'),{recursive:true});await writeFile(join(project,'.access-kit/independent-fixture.json'),json({sessions,org:org.id,season:season.id,clientId:service.clientId}));
  await writeFile(join(project,'access-kit-context.json'),json({...context,authOrigin:server.config.vars.AUTH_ORIGIN,clientId:service.clientId,accessPolicy:'member',hosting:'workers',assets:'dist'}));
  console.log(json({ok:true,clientId:service.clientId,authOrigin:server.config.vars.AUTH_ORIGIN,realGoogleLogin:false,remoteChanges:false}));
 }finally{await server.mf.dispose();}
}
async function verify(project){
 const original=await read(join(project,'.original-files.json'));for(const [name,digest] of Object.entries(original))assert.equal(hash(await readFile(join(project,name))),digest,'original changed: '+name);
 const settings=await read(join(project,'access-kit.json')),state=await read(join(project,'access-kit.install.json')),context=await read(join(project,'access-kit-context.json')),fixture=await read(join(project,'.access-kit/independent-fixture.json'));
 assert.deepEqual([settings.authOrigin,settings.clientId,settings.accessPolicy],[context.auth.authOrigin,fixture.clientId,'member']);assert.equal(state.hosting,'workers');
 command(project,['auth','doctor','--directory','own-auth','--local']);command(project,['doctor']);
 const server=await openServer(project),installed=await import(pathToFileURL(join(project,'access-kit.worker.mjs')).href),originalFetch=globalThis.fetch,checks=[];
 try{
  assert.equal((await(await server.request('/auth/firebase/status',{cookie:fixture.sessions.qa_member})).json()).member.status,'approved');
  assert.equal((await(await server.request('/auth/firebase/status',{cookie:fixture.sessions.qa_visitor})).json()).member.status,'visitor');checks.push('generated authentication Worker and own D1 classify member and visitor');
  globalThis.fetch=(input,init)=>{assert.equal(new URL(typeof input==='string'||input instanceof URL?input:input.url).origin,settings.authOrigin);return server.mf.dispatchFetch(input,init);};
  const env={MARKER:'original-binding',ACCESS_KIT_SESSION_SECRET:'local-synthetic-independent-secret-0123456789',ASSETS:{fetch:async request=>new Response(await readFile(join(project,'dist',new URL(request.url).pathname==='/'?'index.html':new URL(request.url).pathname.slice(1))))}};
  const dispatch=(path,options={})=>installed.default.fetch(new Request(new URL(path,settings.siteUrl),options),env,{});
  for(const path of ['/','/private.json','/api/echo'])assert.equal((await dispatch(path)).status,401);checks.push('installed generated gate blocks anonymous HTML, data and API');
  const issue=async user=>{
   const verifier='q'.repeat(43),authorize=new URL('/authorize',settings.authOrigin);for(const [key,value] of Object.entries({client_id:settings.clientId,redirect_uri:settings.siteUrl,response_type:'code',code_challenge:await sha256Base64Url(verifier),code_challenge_method:'S256',state:'local-qa-state-123456789'}))authorize.searchParams.set(key,value);
   const first=await server.request(authorize.pathname+authorize.search,{cookie:fixture.sessions[user]});assert.equal(first.status,302);
   const continued=await server.request(first.headers.get('Location'),{cookie:fixture.sessions[user]});
   if(user==='qa_visitor'){assert.equal(continued.status,200);assert.equal(continued.headers.get('Location'),null);return null;}
   assert.equal(continued.status,302);const code=new URL(continued.headers.get('Location')).searchParams.get('code');assert.ok(code);
   const r=await server.request('/token?client_id='+settings.clientId,{headers:{Origin:new URL(settings.siteUrl).origin},body:{grant_type:'authorization_code',client_id:settings.clientId,redirect_uri:settings.siteUrl,code,code_verifier:verifier}});assert.equal(r.status,200,await r.clone().text());return (await r.json()).access_token;
  };
  await issue('qa_visitor');checks.push('visitor denied by generated central authorization flow');const token=await issue('qa_member');
  const login=()=>dispatch('/__accesskit/session',{method:'POST',headers:{Origin:new URL(settings.siteUrl).origin,'Content-Type':'application/json'},body:JSON.stringify({access_token:token})});
  const session=await login();assert.equal(session.status,204);const cookie=session.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await dispatch('/private.json',{headers:{Cookie:cookie}})).status,200);assert.equal(installed.preserved,'original-export');
  const echo=await dispatch('/api/echo',{method:'POST',headers:{Cookie:cookie},body:'original-body'});assert.deepEqual(await echo.json(),{method:'POST',body:'original-body',marker:'original-binding'});checks.push('real PKCE/token/session flow admits member and preserves API body, binding and export');
  const row=await server.DB.prepare('SELECT id,revision FROM roster_entries LIMIT 1').first();
  assert.equal((await server.request('/console/roster',{cookie:fixture.sessions.qa_owner,body:{action:'delete',id:row.id,revision:row.revision}})).status,200);assert.equal((await login()).status,403);
  assert.equal((await server.request('/console/roster',{cookie:fixture.sessions.qa_owner,body:{action:'restore',id:row.id,revision:row.revision+1}})).status,200);assert.equal((await login()).status,204);checks.push('own roster delete denies and restore allows through generated server');
  assert.equal((await server.request('/console/membership',{cookie:fixture.sessions.qa_owner,body:{action:'member',userId:'qa_member',status:'suspended'}})).status,200);assert.equal((await login()).status,403);
  assert.equal((await server.request('/console/membership',{cookie:fixture.sessions.qa_owner,body:{action:'member',userId:'qa_member',status:'approved'}})).status,200);checks.push('own member suspension is enforced');
  assert.equal((await dispatch('/__accesskit/logout',{method:'POST',headers:{Origin:new URL(settings.siteUrl).origin,Cookie:cookie}})).status,204);assert.equal((await dispatch('/private.json',{headers:{Cookie:cookie}})).status,401);checks.push('logout revokes token and captured cookie');
  const proof={ok:true,mode:'independent',checks,realGoogleLogin:false,remoteDeployment:false,npmPublished:false,at:new Date().toISOString()};await writeFile(join(project,'.access-kit/independent-proof.json'),json(proof));console.log(json(proof));
 }finally{globalThis.fetch=originalFetch;await server.mf.dispose();}
}
switch(process.argv[2]){case 'prepare':await prepare();break;case 'setup':await setup(resolve(process.argv[3]||'.'));break;case 'verify':await verify(resolve(process.argv[3]||'.'));break;default:throw Error('Use prepare|setup|verify PROJECT');}
