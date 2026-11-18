// Isolated consumer fixtures and real installed-gate checks for the one-prompt trial.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createAuthFixture} from '../tests/auth-fixture.ts';
import {createSession,findSessionUser,createAuthorizationCode} from '../src/store.ts';
import {sha256Base64Url} from '../src/crypto.ts';
import app from '../src/index.ts';
import {installationInstructions} from '../src/llm-instructions.ts';
import {parse as parseToml} from 'smol-toml';

const root=fileURLToPath(new URL('../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const packageFile=join(root,'dist/access-kit-sdk-0.3.1.tgz');
const text=async path=>readFile(path,'utf8');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function prepare(publicRegistry=false,shortPrompt=false){
 const directory=await mkdtemp(join(tmpdir(),'access-kit-llm-qa-'));
 const packageSha256=hash(await readFile(packageFile));
 const snapshot=join(directory,'access-kit-sdk-0.3.1.tgz');if(!publicRegistry)await cp(packageFile,snapshot);
 const cases=[];
 for(const hosting of ['workers','pages']){
  const project=join(directory,hosting);await mkdir(join(project,'public'),{recursive:true});await mkdir(join(project,'scripts'));await mkdir(join(project,'src'));
  const siteUrl=`https://${hosting}.example.test/`;
  const write=(name,value)=>writeFile(join(project,name),value);
  await write('public/index.html','<!doctype html><title>Existing service</title><h1>Existing private service</h1>');
  await write('public/private.json',JSON.stringify({existing:true,value:'private-content'}));
  if(publicRegistry){
   await write('public/app.js','export const originalAsset=true;\n');
   await write('public/style.css','body{font-family:system-ui}\n');
   await write('public/image.svg','<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
   await write('public/download.txt','synthetic private download\n');
   await write('.npmrc','registry=https://registry.npmjs.org/\nuserconfig=./anonymous.npmrc\ncache=./.npm-cache/\n');
   await write('anonymous.npmrc','registry=https://registry.npmjs.org/\n');
  }
  await write('scripts/build.mjs',"import {mkdir,cp} from 'node:fs/promises';await mkdir('dist',{recursive:true});await cp('public','dist',{recursive:true});\n");
  await write('.gitignore','node_modules/\ndist/\n.access-kit/\n.dev.vars*\n.env*\n.npm-cache/\n');
  const loader=pathToFileURL(join(root,'node_modules/tsx/dist/loader.mjs')).href;
  const localCommand=`node --import "${loader}" "${join(root,'scripts/llm-install-qa.mjs').replaceAll('\\','/')}" verify .`;
  await write('package.json',JSON.stringify({name:'existing-'+hosting+'-service',private:true,type:'module',scripts:{build:'node scripts/build.mjs',test:'node --test scripts/existing.test.mjs','verify:access-kit':localCommand}},null,2));
  await write('scripts/existing.test.mjs',"import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';test('existing private content builds',async()=>assert.match(await readFile('dist/private.json','utf8'),/private-content/));\n");
  if(hosting==='workers'){
   await write('src/worker.mjs',"export const existingExport='retained-export';export default {async fetch(request,env){const url=new URL(request.url);if(url.pathname==='/api/echo')return Response.json({method:request.method,body:await request.text(),marker:env.MARKER});return env.ASSETS.fetch(request);},async scheduled(){return 'retained-schedule';}};\n");
   await write('wrangler.jsonc',JSON.stringify({name:'existing-workers-service',main:'src/worker.mjs',compatibility_date:'2026-08-24',vars:{MARKER:'retained-binding'},assets:{directory:'dist',binding:'ASSETS'},triggers:{crons:['0 0 * * *']}},null,2));
  }else{
   await mkdir(join(project,'functions/api'),{recursive:true});
   await write('functions/api/echo.js',"export async function onRequest(context){return Response.json({method:context.request.method,body:await context.request.text(),marker:context.env.MARKER});}\n");
   await write('wrangler.toml','name = "existing-pages-service"\npages_build_output_dir = "dist"\ncompatibility_date = "2026-08-24"\n[vars]\nMARKER = "retained-binding"\n');
  }
  await write('README.md','# Existing consumer service\n\nThis is a disposable local installation trial with synthetic accounts. No remote deployment, secret upload, npm publication or production access is authorized.\n\nRun `npm run build` and `npm test` before changing the service. After connecting the official SDK, run `npm run verify:access-kit`. The latter loads the installed generated gate and real central Hono/D1 APIs, checks anonymous and member access and API preservation. It does not perform a real Google login or contact the example.test domains. It must not be weakened to make the installation pass.\n');
  const originals=hosting==='workers'?['src/worker.mjs','wrangler.jsonc']:['functions/api/echo.js','wrangler.toml'];
  const baseline={hosting,siteUrl,files:Object.fromEntries(await Promise.all(originals.map(async name=>[name,hash(await readFile(join(project,name)))])))};
  await write('.access-kit-qa-baseline.json',JSON.stringify(baseline,null,2));
  const context={sdkVersion:'0.3.1',authOrigin:'https://auth.test',clientId:'site',siteUrl,hosting,assets:'dist',accessPolicy:'member',projectPath:project.replaceAll('\\','/'),packageFile:snapshot.replaceAll('\\','/'),packageSha256,localVerificationCommand:'npm run verify:access-kit',deploymentAllowed:false};
  if(publicRegistry){delete context.packageFile;delete context.packageSha256;}
  if(publicRegistry||shortPrompt)await write('access-kit-context.json',JSON.stringify(context,null,2));
  if(shortPrompt)await cp(join(root,'docs/LLM_INSTALLATION.md'),join(project,'GUIDE.md'));
  git(project,'init','-b','codex/llm-fixture');git(project,'add','.');git(project,'-c','user.name=Installation QA','-c','user.email=qa@example.test','commit','-m','test: existing service before Access Kit');
  const base=installationInstructions('https://auth.test',{}).split('\n\n<access-kit-context>')[0];
  const prompt=shortPrompt?'GUIDE.md 안내를 읽고 이 사이트에 Access Kit을 설치해 주세요.\n연결 정보는 access-kit-context.json을 사용하고 npm 설치부터 게이트 검증까지 끝내세요. 원격 배포·npm 게시는 하지 마세요.':publicRegistry?(await text(join(root,'README.md'))).replaceAll('\r\n','\n').match(/```text\n([\s\S]*?)\n```/)[1]:base+'\n\n<access-kit-context>\n'+JSON.stringify(context,null,2)+'\n</access-kit-context>\n';
  await writeFile(join(directory,hosting+'-prompt.txt'),prompt);
  cases.push({hosting,project,prompt:join(directory,hosting+'-prompt.txt'),baselineCommit:git(project,'rev-parse','HEAD')});
 }
 await writeFile(join(directory,'manifest.json'),JSON.stringify({publicRegistry,packageFile,packageSha256,cases},null,2));
 console.log(JSON.stringify({directory,cases},null,2));
}

async function verify(directory){
 const project=resolve(directory);process.chdir(project);
 const baseline=JSON.parse(await text(join(project,'.access-kit-qa-baseline.json'))),settings=JSON.parse(await text(join(project,'access-kit.json')));
 for(const [name,digest] of Object.entries(baseline.files)){
  if(name==='wrangler.toml'){
   const firstCommit=git(project,'rev-list','--max-parents=0','HEAD').split('\n')[0];
   const original=parseToml(git(project,'show',firstCommit+':'+name)),current=parseToml(await text(join(project,name)));
   // The SDK requires this additive compatibility flag; all original fields must survive.
   const flags=[...new Set([...(original.compatibility_flags||[]),'global_fetch_strictly_public'])].sort();
   assert.deepEqual([...(current.compatibility_flags||[])].sort(),flags);
   delete original.compatibility_flags;delete current.compatibility_flags;assert.deepEqual(current,original,'Original Pages settings changed');
  }else assert.equal(hash(await readFile(join(project,name))),digest,'Original changed: '+name);
 }
 assert.deepEqual([settings.clientId,settings.authOrigin,settings.siteUrl,settings.accessPolicy],['site','https://auth.test',baseline.siteUrl,'member']);
 const state=JSON.parse(await text(join(project,'access-kit.install.json')));assert.equal(state.hosting,baseline.hosting);
 const sdk=join(project,'node_modules/access-kit-sdk');
 const metadata=JSON.parse(await text(join(sdk,'package.json')));assert.equal(metadata.version,'0.3.1');
 const specifier=baseline.hosting==='workers'?'access-kit.worker.mjs':'functions/_middleware.js';
 const installed=await import(pathToFileURL(join(project,specifier)).href);
 const api=baseline.hosting==='pages'?await import(pathToFileURL(join(project,'functions/api/echo.js')).href):null;
 const f=await createAuthFixture(),originalFetch=globalThis.fetch,originalNow=Date.now;
 const checks=[];
 try{
  await f.DB.batch([
   f.DB.prepare("UPDATE applications SET redirect_uris=? WHERE client_id='site'").bind(JSON.stringify([settings.siteUrl])),
   f.DB.prepare("INSERT INTO member_organizations VALUES('own','QA Group'),('other','Other Group')"),
   f.DB.prepare("INSERT INTO member_seasons VALUES('season','QA Season 3','active')"),
   f.DB.prepare("INSERT INTO users VALUES('other','Other',NULL,'active',0,0)"),
   f.DB.prepare("INSERT INTO common_members VALUES('user','approved',0,'user'),('other','approved',0,'user')"),
   f.DB.prepare("INSERT INTO season_memberships VALUES('user','season','own','active',0,'user'),('other','season','other','active',0,'user')"),
   f.DB.prepare("INSERT INTO common_application_policies VALUES('site','season','own')"),
  ]);
  const centralSession=await createSession(f.env,'user');
  const assets=async request=>{
   const url=new URL(request.url),name=url.pathname==='/'?'index.html':url.pathname.slice(1);
   const body=await readFile(join(project,state.assets,name));
   return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':name.endsWith('.json')?'application/json':'text/html'}});
  };
  const env={MARKER:'retained-binding',ACCESS_KIT_SESSION_SECRET:'synthetic-local-secret-'.repeat(3),ASSETS:{fetch:assets}};
  const dispatch=async request=>baseline.hosting==='workers'?installed.default.fetch(request,env,{}):installed.onRequest({request,env,data:{},next:async r=>new URL(r.url).pathname==='/api/echo'?api.onRequest({request:r,env}):assets(r)});
  globalThis.fetch=async(input,init)=>{
   const request=new Request(input,init),origin=new URL(request.url).origin;
   if(origin===settings.authOrigin)return app.fetch(request,f.env);
   if(origin===new URL(settings.siteUrl).origin)return dispatch(request);
   throw Error('Unexpected external access: '+origin);
  };
  const {verify:verifyGate}=await import(pathToFileURL(join(sdk,'bin/verify.mjs')).href);
  const anonymous=await verifyGate(state,{path:'/api/echo'});assert.equal(anonymous.ok,true);checks.push('anonymous GET/HEAD/Range/invalid-cookie across built assets and API');
  const tokenFor=async user=>{
   const verifier='q'.repeat(43),code=await createAuthorizationCode(f.env,user,'site',settings.siteUrl,await sha256Base64Url(verifier),Date.now()+7*86400000);
   return app.request('https://auth.test/token?client_id=site',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',client_id:'site',redirect_uri:settings.siteUrl,code,code_verifier:verifier})},f.env);
  };
  assert.equal((await tokenFor('other')).status,400);checks.push('central wrong-affiliation token denied');
  const issued=await tokenFor('user');assert.equal(issued.status,200);const token=(await issued.json()).access_token;
  const request=(path,options={})=>dispatch(new Request(new URL(path,settings.siteUrl),options));
  const session=await request('/__accesskit/session',{method:'POST',headers:{Origin:new URL(settings.siteUrl).origin,'Content-Type':'application/json'},body:JSON.stringify({access_token:token})});assert.equal(session.status,204);
  const cookie=session.headers.get('Set-Cookie')?.split(';')[0];assert.ok(cookie);checks.push('PKCE exchange and real SDK session cookie');
  const authenticated=await request('/private.json',{headers:{Cookie:cookie}});assert.equal(authenticated.status,200);assert.equal((await authenticated.json()).value,'private-content');checks.push('approved roster member receives existing private data');
  const echo=await request('/api/echo',{method:'POST',headers:{Cookie:cookie},body:'unchanged-post-body'});assert.equal(echo.status,200);assert.deepEqual(await echo.json(),{method:'POST',body:'unchanged-post-body',marker:'retained-binding'});checks.push('original API method/body and binding preserved');
  if(baseline.hosting==='workers'){assert.equal(installed.existingExport,'retained-export');assert.equal(await installed.default.scheduled(),'retained-schedule');checks.push('named export and scheduled preserved');}
  await f.DB.prepare("UPDATE season_memberships SET status='inactive' WHERE user_id='user'").run();
  assert.equal((await request('/private.json',{headers:{Cookie:cookie}})).status,200);checks.push('bounded permission lease reused locally');
  const afterLease=originalNow()+300001;Date.now=()=>afterLease;
  assert.equal((await request('/private.json',{headers:{Cookie:cookie}})).status,403);checks.push('central roster removal denies at lease boundary');
  assert.equal(await findSessionUser(f.env,centralSession.token),'user');checks.push('service denial preserves central login');
  await f.DB.prepare("UPDATE season_memberships SET status='active' WHERE user_id='user'").run();
  assert.equal((await request('/private.json',{headers:{Cookie:cookie}})).status,200);checks.push('restored roster allows access');
  await f.DB.prepare("UPDATE common_members SET status='suspended' WHERE user_id='user'").run();
  Date.now=()=>afterLease+300001;
  assert.equal((await request('/private.json',{headers:{Cookie:cookie}})).status,403);checks.push('global suspension denies after renewed lease');
  const logout=await request('/__accesskit/logout',{method:'POST',headers:{Origin:new URL(settings.siteUrl).origin,Cookie:cookie}});
  assert.equal(logout.status,204);assert.equal(logout.headers.get('X-Access-Kit-Revoke'),'confirmed');assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);checks.push('logout revokes central token and clears browser cookie');
  assert.equal((await request('/private.json',{headers:{Cookie:cookie}})).status,401);checks.push('captured cookie rejected in same runtime after logout');
  assert.equal((await app.request('https://auth.test/me?client_id=site',{headers:{Authorization:'Bearer '+token}},f.env)).status,401);checks.push('central token rejected after logout');
  const evidence={ok:true,hosting:baseline.hosting,runtime:metadata.version,anonymousRequests:anonymous.checked,checks,realGoogleLogin:false,remoteDeployment:false,at:new Date().toISOString()};
  await mkdir(join(project,'.access-kit'),{recursive:true});await writeFile(join(project,'.access-kit/llm-local-verification.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
 }finally{Date.now=originalNow;globalThis.fetch=originalFetch;await f.dispose();}
}

switch(process.argv[2]){
 case 'prepare':await prepare();break;
 case 'prepare-short':await prepare(false,true);break;
 case 'prepare-public':await prepare(true);break;
 case 'verify':await verify(process.argv[3]||process.cwd());break;
 default:throw Error('Usage: node --import tsx scripts/llm-install-qa.mjs prepare|prepare-public|verify PROJECT');
}
