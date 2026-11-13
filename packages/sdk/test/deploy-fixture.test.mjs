import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {isProtectedDenial} from '../bin/verify.mjs';
import {RUNTIME_VERSION} from '../server/gate.mjs';
const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../bin/access-kit.mjs',import.meta.url));
const operations=new URL('../bin/operations.mjs',import.meta.url).href;
const server=new URL('../server/gate.mjs',import.meta.url).href;
test('anonymous verification rejects host-mismatch 403 and mismatched deployment receipts',()=>{
 const headers={'X-Access-Kit-Gate':'v1','X-Access-Kit-Runtime':RUNTIME_VERSION,'X-Access-Kit-Decision':'unauthenticated','X-Access-Kit-Deployment':'a'.repeat(32)};
 assert.equal(isProtectedDenial(new Response(null,{status:403,headers})),false);
 assert.equal(isProtectedDenial(new Response(null,{status:401,headers}),'b'.repeat(32)),false);
 assert.equal(isProtectedDenial(new Response(null,{status:401,headers}),'a'.repeat(32)),true);
});
test('CLI Pages deployment names the production branch and verifies the newly uploaded gate',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ak-deploy-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'build'));await writeFile(join(root,'build/index.html'),'private');
 await writeFile(join(root,'package.json'),'{"type":"module"}');
 const run=(...args)=>exec(process.execPath,args,{cwd:root,maxBuffer:4*1024*1024});
 await run(cli,'init','--client-id','fixture','--site-url','https://fixture.test/','--auth-origin','https://auth.test','--hosting','pages','--assets','build');
 const settings=await readFile(join(root,'access-kit.json'),'utf8');
 await mkdir(join(root,'node_modules/wrangler/bin'),{recursive:true});
 await writeFile(join(root,'node_modules/wrangler/package.json'),'{"name":"wrangler","version":"0.0.0","type":"module"}');
 await writeFile(join(root,'node_modules/wrangler/bin/wrangler.js'),`
  import {readFile,writeFile,appendFile} from 'node:fs/promises';
  const args=process.argv.slice(2);
  await appendFile('calls.jsonl',JSON.stringify(args)+'\\n');
  if(args[0]==='pages'){
   const settings=await readFile('access-kit.json','utf8');
   await writeFile('uploaded.json',settings);
   const mode=await readFile('mode','utf8');
   await appendFile(process.env.WRANGLER_OUTPUT_FILE_PATH,JSON.stringify({
    type:'pages-deploy-detailed',pages_project:args[args.indexOf('--project-name')+1],
    environment:mode==='preview'?'preview':'production',production_branch:'main'
   })+'\\n');
  }
 `);
 async function deploy(mode,branch='main'){
  await writeFile(join(root,'mode'),mode);
  const source=`
   import {readFile} from 'node:fs/promises';
   import {deploy} from ${JSON.stringify(operations)};
   import {createGate} from ${JSON.stringify(server)};
   const originalTimer=globalThis.setTimeout;
   globalThis.setTimeout=(callback,delay,...args)=>originalTimer(callback,0,...args);
   globalThis.fetch=async(input,options)=>{
    const settings=JSON.parse(await readFile('uploaded.json','utf8'));
    if(${JSON.stringify(mode)}==='stale')settings.deploymentId='0'.repeat(32);
    const gate=createGate(settings);
    const url=new URL(input);if(${JSON.stringify(mode)}==='wrong-host')url.hostname='wrong.test';
    return gate(new Request(url,options),{sessionSecret:'local-only-secret-with-32-characters',serveAsset:async()=>new Response('private')});
   };
   await deploy(${JSON.stringify(branch?{branch}:{})});
  `;
  return run('--input-type=module','-e',source);
 }
 await assert.rejects(deploy('production',null),error=>error.stderr.includes('--branch'));
 for(const mode of ['preview','stale','wrong-host']){
  await assert.rejects(deploy(mode));
  assert.equal(await readFile(join(root,'access-kit.json'),'utf8'),settings);
 }
 await deploy('production');
 const calls=(await readFile(join(root,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.ok(calls.filter(args=>args[0]==='pages').every(args=>args[args.indexOf('--branch')+1]==='main'));
 const result=JSON.parse(await readFile(join(root,'.access-kit/last-verification.json'),'utf8'));
 assert.equal(result.ok,true);assert.equal(result.checked,8);
 assert.equal(result.expectedDeploymentId,JSON.parse(await readFile(join(root,'uploaded.json'),'utf8')).deploymentId);
 assert.equal(await readFile(join(root,'access-kit.json'),'utf8'),settings);
});
