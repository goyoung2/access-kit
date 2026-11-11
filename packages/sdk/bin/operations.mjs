import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {exists,loadState,doctor,prepare,digest,json} from './project.mjs';
import {verify} from './verify.mjs';
import {RUNTIME_VERSION} from '../server/gate.mjs';
const requireFromProject=()=>createRequire(resolve('package.json'));
async function npmPath(){const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')].filter(Boolean);for(const path of candidates)if(path.endsWith('npm-cli.js')&&await exists(path))return path;throw Error('Node.js LTS의 npm으로 실행하세요: npx access-kit …');}
export async function run(command,args,{input,capture=false}={}){
 const path=command==='npm'?await npmPath():join(dirname(requireFromProject().resolve('wrangler/package.json')),'bin/wrangler.js');
 return new Promise((done,reject)=>{const child=spawn(process.execPath,[path,...args],{stdio:[input===undefined?'inherit':'pipe',capture?'pipe':'inherit',capture?'pipe':'inherit'],windowsHide:true});let output='';if(capture){child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);}if(input!==undefined)child.stdin.end(input);child.on('error',reject);child.on('close',code=>code===0?done(output):reject(Error(`${command} ${args.join(' ')} 실패 (${code})${capture?'\n'+output:''}`)));});
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
export async function deploy(){
 const state=await loadState();const pkg=JSON.parse(await readFile('package.json','utf8'));
 if(pkg.scripts?.build)await run('npm',['run','build']);
 await prepare();await doctor();await run('wrangler',['whoami']);
 // Hosting CLI retains account authentication, interactive confirmations and deployment output.
 await run('wrangler',state.hosting==='workers'?['deploy','--config','wrangler.access-kit.json']:['pages','deploy',state.assets,'--project-name',state.name]);
 // A new workers.dev route can briefly return 404 while the deployment propagates.
 // Only the operator-triggered deploy waits; normal site visits never poll.
 const settings=JSON.parse(await readFile('access-kit.json','utf8'));
 for(let attempt=0;attempt<6;attempt++){
  const probe=await fetch(settings.siteUrl,{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  const ready=[401,403].includes(probe.status)&&probe.headers.get('X-Access-Kit-Runtime')===RUNTIME_VERSION;await probe.body?.cancel();
  if(ready)break;
  if(attempt<5){console.log('배포 반영을 기다리는 중…');await new Promise(done=>setTimeout(done,5000));}
 }
 const result=await verify(state);console.log(json(result));if(!result.ok)throw Error('배포 후 보호 검사가 실패했습니다. .access-kit/last-verification.json을 확인하고 이전 배포로 복구하세요. 자동 성공 처리하지 않았습니다.');
}
export async function update(options){
 await doctor();if(!options.package||! /^[a-f0-9]{64}$/i.test(options.sha256||''))throw Error('릴리스 파일과 SHA256SUMS의 해시를 --package, --sha256로 지정하세요.');
 const archive=await readFile(options.package);if(digest(archive)!==options.sha256.toLowerCase())throw Error('SDK 해시가 일치하지 않습니다. 설치하지 않았습니다.');
 const state=await loadState(),id=new Date().toISOString().replaceAll(/[:.]/g,'-');
 const backup='.access-kit/backups/'+id;await mkdir(backup,{recursive:true});
 for(const name of ['package.json','package-lock.json']){await access(name);await copyFile(name,join(backup,name));}
 const target=resolve('vendor/access-kit-'+digest(archive)+'.tgz');await mkdir(dirname(target),{recursive:true});await writeFile(target,archive);
 try{await run('npm',['install','--save-exact',target]);const pkg=JSON.parse(await readFile('package.json','utf8'));if(pkg.scripts?.build)await run('npm',['run','build']);await prepare();await doctor();}
 catch(error){for(const name of ['package.json','package-lock.json'])await copyFile(join(backup,name),name);await run('npm',['ci']);throw Error(`업데이트 실패, 이전 의존성 복원. 기록: ${backup}. ${error instanceof Error?error.message:String(error)}`);}
 await writeFile('.access-kit/last-update.json',json({at:new Date().toISOString(),backup,sha256:digest(archive),hosting:state.hosting}));
 console.log(`업데이트 검사 완료. 백업: ${backup}\n다음: npx access-kit deploy (새 SDK 프로세스로 배포·버전 검사)`);
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
 console.log(`${path} 생성. 저장소 access-kit 환경에 Cloudflare 비밀값을 등록하세요. SDK tarball은 private 저장소 vendor/에 고정하고 package-lock.json에 상대 경로로 기록하세요. 자동 주기 실행은 없습니다.`);
}

