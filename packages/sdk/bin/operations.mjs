import {readFile,writeFile,mkdir,copyFile,access,mkdtemp,unlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {exists,loadState,doctor,prepare,digest,json} from './project.mjs';
import {verify,isProtectedDenial} from './verify.mjs';
const requireFromProject=()=>createRequire(resolve('package.json'));
async function npmPath(){const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')].filter(Boolean);for(const path of candidates)if(path.endsWith('npm-cli.js')&&await exists(path))return path;throw Error('Node.js LTS의 npm으로 실행하세요: npx access-kit …');}
async function runNode(path,args,{input,capture=false,env}={},label='node'){
 return new Promise((done,reject)=>{
  const child=spawn(process.execPath,[path,...args],{
   env,
   stdio:[input===undefined?'inherit':'pipe',capture?'pipe':'inherit',capture?'pipe':'inherit'],
   windowsHide:true,
  });
  let output='';
  if(capture){
   child.stdout.on('data',bytes=>output+=bytes);
   child.stderr.on('data',bytes=>output+=bytes);
  }
  if(input!==undefined)child.stdin.end(input);
  child.on('error',reject);
  child.on('close',code=>{
   if(code===0)done(output);
   else reject(Error(`${label} ${args.join(' ')} 실패 (${code})${capture?'\n'+output:''}`));
  });
 });
}
export async function run(command,args,options){
 const path=command==='npm'?await npmPath():join(dirname(requireFromProject().resolve('wrangler/package.json')),'bin/wrangler.js');
 return runNode(path,args,options,command);
}
async function installedCli(){
 // Resolve the package's declared CLI in a new process, including its public server entry.
 const source=`
  import {createGate,RUNTIME_VERSION} from '@goyoung2/access-kit/server';
  import {AccessKitClient} from '@goyoung2/access-kit/browser';
  import {readFile} from 'node:fs/promises';
  import {resolve,relative,isAbsolute,sep} from 'node:path';
  const root=resolve('node_modules/@goyoung2/access-kit');
  const metadata=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
  if(metadata.name!=='@goyoung2/access-kit'||typeof createGate!=='function'||typeof AccessKitClient!=='function'||!RUNTIME_VERSION)throw Error('Invalid Access Kit package exports');
  const gate=createGate({clientId:'doctor',siteUrl:'https://doctor.test/',authOrigin:'https://auth.test',accessPolicy:'member'});
  const reply=await gate(new Request('https://doctor.test/'),{sessionSecret:'doctor-only-session-secret-0123456789',serveAsset:async()=>new Response('private')});
  if(reply.status!==401||reply.headers.get('X-Access-Kit-Runtime')!==RUNTIME_VERSION)throw Error('Invalid Access Kit gate');
  const entry=metadata.bin?.['access-kit'];
  if(typeof entry!=='string'||!entry)throw Error('Missing Access Kit CLI');
  const cli=resolve(root,entry),rel=relative(root,cli);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Invalid Access Kit CLI path');
  console.log(JSON.stringify({cli,runtime:RUNTIME_VERSION,version:metadata.version}));
 `;
 const installed=JSON.parse(await runNode('--input-type=module',['-e',source],{capture:true}));
 return installed;
}
async function verifyInstalled(expectedVersion){
 const installed=await installedCli();
 if(expectedVersion&&installed.version!==expectedVersion)throw Error('요청한 SDK 버전과 설치된 버전이 다릅니다.');
 await runNode(installed.cli,['prepare']);
 const result=JSON.parse(await runNode(installed.cli,['doctor'],{capture:true}));
 if(result.ok!==true||result.runtime!==installed.runtime)throw Error('설치된 SDK doctor 응답이 올바르지 않습니다.');
 return installed;
}
export async function secret(options){
 const state=await loadState();await doctor();
 if(options.local){const path=state.hosting==='workers'?'.dev.vars.access-kit':'.dev.vars';if(await exists(path))throw Error(`${path}가 이미 있습니다. 기존 키를 유지하세요.`);await writeFile(path,'ACCESS_KIT_SESSION_SECRET='+randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});console.log(`${path} 생성. Git에 넣지 마세요. 로컬 Workers 실행: wrangler dev --config wrangler.access-kit.json --env-file .dev.vars.access-kit`);return;}
 const args=state.hosting==='workers'?['--config','wrangler.access-kit.json']:['--project-name',state.name];
 const prefix=state.hosting==='workers'?[]:['pages'];
 let list='';
 try{list=await run('wrangler',[...prefix,'secret','list',...args],{capture:true});}
 catch(error){if(state.hosting!=='workers'||!(error instanceof Error)||!(/10007|Worker does not exist|Could not find Worker|Worker .* not found/i.test(error.message)))throw error;}
 if(list.includes('ACCESS_KIT_SESSION_SECRET')){console.log('기존 세션 키를 유지합니다.');return;}
 await run('wrangler',[...prefix,'secret','put','ACCESS_KIT_SESSION_SECRET',...args],{input:randomBytes(32).toString('hex')+'\n'});
}
export async function deploy(options={}){
 const state=await loadState();const pkg=JSON.parse(await readFile('package.json','utf8'));
 if(pkg.scripts?.build)await run('npm',['run','build']);
 await prepare();await doctor();
 const branch=options.branch||state.branch;
 if(state.hosting==='pages'&&!branch?.trim())throw Error('Pages 운영 브랜치를 --branch로 지정하세요.');
 await run('wrangler',['whoami']);
 // Hosting CLI retains account authentication, interactive confirmations and deployment output.
 const deploymentId=randomBytes(16).toString('hex');
 const config='access-kit.json',original=await readFile(config,'utf8'),settings=JSON.parse(original);
 const marked=json({...settings,deploymentId});
 const receipt=resolve('.access-kit','deployments',deploymentId+'.jsonl');
 await mkdir(dirname(receipt),{recursive:true});
 const lock=resolve('.access-kit','deploy.lock');
 await writeFile(lock,receipt+'\n',{flag:'wx'});
 try{
  await writeFile(config,marked);
  try{
   await run('wrangler',state.hosting==='workers'?['deploy','--config','wrangler.access-kit.json']:['pages','deploy',state.assets,'--project-name',state.name,'--branch',branch],{env:{...process.env,WRANGLER_OUTPUT_FILE_PATH:receipt}});
  }finally{
   if(await readFile(config,'utf8')===marked)await writeFile(config,original);
  }
 }finally{await unlink(lock);}
 if(state.hosting==='pages'){
  const records=(await readFile(receipt,'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line));
  const deployed=records.find(record=>record.type==='pages-deploy-detailed');
  if(deployed?.pages_project!==state.name||deployed.environment!=='production'||deployed.production_branch!==branch)throw Error(`Pages 운영 배포를 확인하지 못했습니다. Wrangler 기록: ${receipt}`);
 }
 // A new workers.dev route can briefly return 404 while the deployment propagates.
 // Only the operator-triggered deploy waits; normal site visits never poll.
 for(let attempt=0;attempt<6;attempt++){
  const probe=await fetch(settings.siteUrl,{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  const ready=isProtectedDenial(probe,deploymentId);await probe.body?.cancel();
  if(ready)break;
  if(attempt<5){console.log('배포 반영을 기다리는 중…');await new Promise(done=>setTimeout(done,5000));}
 }
 const result=await verify(state,{deploymentId});console.log(json(result));if(!result.ok)throw Error('배포 후 보호 검사가 실패했습니다. .access-kit/last-verification.json을 확인하고 이전 배포로 복구하세요. 자동 성공 처리하지 않았습니다.');
}
export async function update(options={}){
 let source,archive;
 if(options.version!==undefined){
  if(options.package||options.sha256||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(options.version))throw Error('npm 업데이트는 --version X.Y.Z로 정확한 버전만 지정하세요. --package/--sha256와 함께 사용할 수 없습니다.');
  source='@goyoung2/access-kit@'+options.version;
 }else{
  if(!options.package||! /^[a-f0-9]{64}$/i.test(options.sha256||''))throw Error('--version X.Y.Z 또는 --package SDK.tgz --sha256 HASH를 지정하세요.');
  archive=await readFile(options.package);if(digest(archive)!==options.sha256.toLowerCase())throw Error('SDK 해시가 일치하지 않습니다. 설치하지 않았습니다.');
 }
 await doctor();
 const state=await loadState(),id=new Date().toISOString().replaceAll(/[:.]/g,'-');
 await mkdir('.access-kit/backups',{recursive:true});
 const backup=await mkdtemp('.access-kit/backups/'+id+'-');
 for(const name of ['package.json','package-lock.json']){await access(name);await copyFile(name,join(backup,name));}
 if(archive){const target=join('vendor','access-kit-'+digest(archive)+'.tgz');await mkdir(dirname(target),{recursive:true});await writeFile(target,archive);source='./'+target;}
 let installed;
 try{await run('npm',['install','--save-exact','--',source]);await build();installed=await verifyInstalled(options.version);}
 catch(error){
  try{for(const name of ['package.json','package-lock.json'])await copyFile(join(backup,name),name);await run('npm',['ci']);await build();await verifyInstalled();}
  catch(rollbackError){throw new AggregateError([error,rollbackError],`업데이트 및 복원 실패. 백업: ${backup}. ${error.message}\n${rollbackError.message}`);}
  throw Error(`업데이트 실패, 이전 의존성 복원. 기록: ${backup}. ${error instanceof Error?error.message:String(error)}`);
 }
 await writeFile('.access-kit/last-update.json',json({at:new Date().toISOString(),backup,source,version:installed.version,...(archive?{sha256:digest(archive)}:{}),hosting:state.hosting}));
 console.log(`업데이트 검사 완료. 백업: ${backup}\n다음: npx access-kit deploy (새 SDK 프로세스로 배포·버전 검사)`);
}
async function build(){
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 if(pkg.scripts?.build)await run('npm',['run','build']);
}
export async function automate(){
 await doctor();const path='.github/workflows/access-kit-deploy.yml';if(await exists(path))throw Error(`${path}가 이미 있습니다. 기존 workflow를 보존했습니다.`);await mkdir(dirname(path),{recursive:true});
 await writeFile(path,`name: Access Kit deploy
on: workflow_dispatch
permissions:
  contents: read
concurrency:
  group: access-kit-deploy
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: access-kit
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx access-kit deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: access-kit-verification
          path: .access-kit/last-verification.json
`);
 console.log(`${path} 생성. 저장소 access-kit 환경에 Cloudflare 비밀값을 등록하세요. SDK 정확한 버전과 package-lock.json을 커밋하세요. 파일 설치라면 vendor/도 함께 보관하세요. 자동 주기 실행은 없습니다.`);
}

