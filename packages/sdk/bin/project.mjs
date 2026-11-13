import {readFile,writeFile,appendFile,mkdir,stat,lstat,readdir,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {parse as jsonc} from 'jsonc-parser';
import {parse as toml} from 'smol-toml';
import {createGate,RUNTIME_VERSION} from '../server/gate.mjs';
export const digest=text=>createHash('sha256').update(text).digest('hex');
const normalizeLines=text=>text.replaceAll('\r\n','\n');
const textDigest=text=>digest(normalizeLines(text));
async function matchesTextHash(path,hash){
 const text=await readFile(path,'utf8'),lf=normalizeLines(text);
 return [digest(text),digest(lf),digest(lf.replaceAll('\n','\r\n'))].includes(hash);
}
export const json=value=>JSON.stringify(value,null,2)+'\n';
export async function exists(path){try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function readConfig(path){const text=await readFile(path,'utf8');if(path.endsWith('.toml'))return toml(text);const errors=[];const value=jsonc(text,errors,{allowTrailingComma:true});if(errors.length)throw Error(`${path}: JSON/JSONC 구문 오류`);return value;}
export function rootUrl(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('https://도메인/ 형식의 사이트 루트를 입력하세요.');return u.href;}
async function inside(path){const p=await realpath(path),root=await realpath('.'),rel=relative(root,p);if(!rel||rel==='..'||rel.startsWith('..'+sep)||resolve(root,rel)!==p)throw Error(`프로젝트 내부의 별도 파일/폴더를 사용하세요: ${path}`);return rel.split(sep).join('/');}
export async function listAssets(directory){const result=[];async function walk(dir,prefix=''){for(const ent of await readdir(dir,{withFileTypes:true})){if(ent.isSymbolicLink())throw Error(`빌드 자산의 심볼릭 링크를 해제하세요: ${ent.name}`);if(ent.isDirectory())await walk(join(dir,ent.name),prefix+ent.name+'/');else if(!['_routes.json','_headers','_redirects','_worker.js'].includes(ent.name))result.push('/'+(prefix+ent.name).split('/').map(encodeURIComponent).join('/'));}}await walk(directory);return result.sort();}
function workerCode(entry,binding){return `import {createGate} from '@goyoung2/access-kit/server';\nimport settings from './access-kit.json' with {type:'json'};\n${entry?`import original from ${JSON.stringify('./'+entry)};\nexport * from ${JSON.stringify('./'+entry)};`:'const original = {};'}\nconst gate=createGate(settings);\nexport default {...original,fetch(request,env,ctx){return gate(request,{sessionSecret:env.ACCESS_KIT_SESSION_SECRET,serveAsset:(r,identity)=>original.fetch?original.fetch.call(original,r,env,ctx,identity):env[${JSON.stringify(binding)}].fetch(r)});}};\n`;}
function pagesCode(){return `import {createGate} from '@goyoung2/access-kit/server';\nimport settings from '../access-kit.json' with {type:'json'};\nconst gate=createGate(settings);\nexport const onRequest=context=>gate(context.request,{sessionSecret:context.env.ACCESS_KIT_SESSION_SECRET,serveAsset:(request,identity)=>{context.data.accessKit=identity;return context.next(request);}});\n`;}
async function generated(state){
 const original=state.sourceConfig?await readConfig(state.sourceConfig):{name:state.name,compatibility_date:'2026-08-24'};
 if(state.hosting==='pages'){
  if(state.sourceConfig&&!original.compatibility_flags?.includes('global_fetch_strictly_public'))throw Error('Pages 원본 설정의 compatibility_flags에 global_fetch_strictly_public을 추가하세요. 기존 fetch가 private-origin에 의존하면 AUTH service binding을 사용하세요.');
  return {'functions/_middleware.js':pagesCode(),...(!state.sourceConfig?{'wrangler.jsonc':json({name:state.name,compatibility_date:'2026-08-24',compatibility_flags:['global_fetch_strictly_public'],pages_build_output_dir:state.assets})}:{})};
 }
 const sourceDir=state.sourceConfig?dirname(state.sourceConfig):'.';
 if(sourceDir!=='.')throw Error('설정 파일은 프로젝트 루트에서 선택하세요. 중첩 설정은 해당 폴더에서 실행하세요.');
 for(const [name,env] of Object.entries(original.env||{}))if(env.main||env.assets)throw Error(`env.${name}의 별도 main/assets를 루트 설정과 분리해 해당 환경에서 설치하세요.`);
 const entry=original.main||null;
 if(entry){await inside(entry);if(entry==='access-kit.worker.mjs')throw Error('원래 Wrangler 설정을 --config로 지정하세요.');}
 const assets={...(original.assets||{}),directory:state.assets,binding:original.assets?.binding||'ASSETS',run_worker_first:true};
 if(original.compatibility_flags?.includes('global_fetch_private_origin'))throw Error('기존 private-origin fetch 설정이 있습니다. docs/ADAPTERS.md의 AUTH service binding 방식으로 연결하세요.');
 const config={...original,compatibility_flags:[...new Set([...(original.compatibility_flags||[]),'global_fetch_strictly_public'])],main:'access-kit.worker.mjs',assets};
 return {'access-kit.worker.mjs':workerCode(entry,assets.binding),'wrangler.access-kit.json':json(config)};
}
export async function loadState(){if(!await exists('access-kit.install.json'))throw Error('설치 기록이 없습니다. 먼저 access-kit init 또는 wizard를 실행하세요.');return JSON.parse(await readFile('access-kit.install.json','utf8'));}
async function saveGenerated(state,files){for(const [name,text] of Object.entries(files)){await mkdir(dirname(name),{recursive:true});await writeFile(name,text);}await writeFile('access-kit.install.json',json({...state,generated:Object.fromEntries(Object.entries(files).map(([n,t])=>[n,textDigest(t)])),sourceHash:state.sourceConfig?textDigest(await readFile(state.sourceConfig,'utf8')):null}));}
async function checkPagesOutput(assets){
 await inside(assets);
 const worker=join(assets,'_worker.js');
 try{await lstat(worker);}catch(error){if(error.code==='ENOENT')return;throw error;}
 throw Error(`${worker}: Pages advanced mode bypasses Functions middleware. Remove it from the build output or protect the advanced Worker directly.`);
}
export async function install(values){
 if(await exists('access-kit.install.json'))throw Error('이미 설치되어 있습니다. 설정 변경은 sync, SDK 갱신은 update를 사용하세요.');
 const hosting=values.hosting||'workers';if(!['workers','pages'].includes(hosting))throw Error('자동 설치는 workers/pages입니다. 다른 서버는 docs/ADAPTERS.md를 따르세요.');
 let sourceConfig=values.config;
 if(!sourceConfig){const configs=[];for(const p of ['wrangler.jsonc','wrangler.json','wrangler.toml'])if(await exists(p))configs.push(p);if(configs.length>1)throw Error('--config로 사용할 Wrangler 설정을 선택하세요.');sourceConfig=configs[0]||null;}
 const original=sourceConfig?await readConfig(sourceConfig):{};
 const assets=values.assets||original.assets?.directory||original.pages_build_output_dir||'dist';
 const settings={clientId:values['client-id'],authOrigin:new URL(rootUrl(values['auth-origin'])).origin,siteUrl:rootUrl(values['site-url']),accessPolicy:values['access-policy']||'member'};
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(settings.clientId||''))throw Error('설치 페이지에서 Client ID를 복사하세요.');createGate(settings);
 if(!await exists(assets))throw Error(`빌드 폴더 ${assets}가 없습니다. 프로젝트의 빌드 명령을 먼저 실행하거나 --assets로 실제 폴더를 지정하세요.`);
 await inside(assets);if(!await exists(join(assets,'index.html')))throw Error(`${assets}/index.html이 없습니다. 사이트 빌드를 먼저 완료하세요.`);
 const name=values.name||original.name||settings.clientId.toLowerCase().replaceAll('_','-');
 if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name))throw Error('--name은 영문 소문자·숫자·하이픈으로 입력하세요.');
 if(hosting==='pages'){
  await checkPagesOutput(assets);
  for(const p of ['functions/_middleware.ts','functions/_middleware.js',join(assets,'_routes.json')])if(await exists(p))throw Error(`${p}가 이미 있습니다. 기존 middleware/advanced worker는 docs/ADAPTERS.md의 감싸기 예제로 연결하세요. 기존 파일은 보존했습니다.`);
 }
 const state={schema:1,hosting,assets:await inside(assets),name,sourceConfig,...(hosting==='pages'&&values.branch?{branch:values.branch}:{}),generated:{},sourceHash:null};
 const files={'access-kit.json':json(settings),...await generated(state)};
 for(const p of Object.keys(files))if(await exists(p))throw Error(`${p}가 이미 있습니다. 기존 설정을 보존했습니다. 이전 v0.1 설치는 docs/UPGRADE.md를 따르세요.`);
 if(values.plan){console.log(json({hosting,sourceConfig,files:Object.keys(files),preserves:original,settings}));return;}
 await saveGenerated(state,files);await prepare();
 const ignored=await exists('.gitignore')?await readFile('.gitignore','utf8'):'';
 const missing=['node_modules/','.dev.vars*','.env*','.access-kit/'].filter(line=>!ignored.split(/\r?\n/).includes(line));
 if(missing.length)await appendFile('.gitignore','\n# Access Kit local secrets and verification\n'+missing.join('\n')+'\n');
 console.log('설치 파일을 생성했습니다. 원래 설정과 소스는 보존했습니다. 다음: access-kit doctor → access-kit secret → access-kit deploy');
}
export async function sync(){const state=await loadState();await checkGenerated(state);const settings=JSON.parse(await readFile('access-kit.json','utf8'));createGate(settings);await saveGenerated(state,{'access-kit.json':json(settings),...await generated(state)});await prepare();console.log('원래 호스팅 설정을 다시 반영했습니다.');}
async function checkGenerated(state){for(const [name,hash] of Object.entries(state.generated)){if(name==='access-kit.json')continue;if(!await exists(name)||!await matchesTextHash(name,hash))throw Error(`${name}이 없거나 수동 변경되었습니다. 변경 내용을 보존하고 원래 생성 파일과 비교하세요.`);}}
export async function prepare(){const state=await loadState();if(state.hosting==='pages'){await checkPagesOutput(state.assets);await writeFile(join(state.assets,'_routes.json'),json({version:1,include:['/*'],exclude:[]}));}return state;}
export async function doctor(){
 const state=await loadState();await checkGenerated(state);const settings=JSON.parse(await readFile('access-kit.json','utf8'));createGate(settings);
 if(state.sourceConfig&&!await matchesTextHash(state.sourceConfig,state.sourceHash))throw Error('원래 Wrangler 설정이 변경되었습니다. access-kit sync로 반영하세요.');
 await inside(state.assets);if(!await exists(join(state.assets,'index.html')))throw Error(`${state.assets}/index.html이 없습니다. 빌드 후 다시 검사하세요.`);
 if(state.hosting==='workers'){const config=await readConfig('wrangler.access-kit.json');if(config.main!=='access-kit.worker.mjs'||config.assets?.run_worker_first!==true)throw Error('모든 요청이 인증 게이트를 먼저 통과해야 합니다.');}
 else {await checkPagesOutput(state.assets);const routes=await readConfig(join(state.assets,'_routes.json'));if(routes.version!==1||JSON.stringify(routes.include)!=='["/*"]'||JSON.stringify(routes.exclude)!=='[]')throw Error('Pages 보호 경로가 변경되었습니다. access-kit prepare를 실행하세요.');}
 return {ok:true,runtime:RUNTIME_VERSION,hosting:state.hosting,siteUrl:settings.siteUrl,assets:(await listAssets(state.assets)).length,checks:['generated-files','source-config','gate-settings','build-output','protected-routing'],next:'access-kit secret 후 deploy. 로그인은 배포 사이트에서 확인하세요.'};
}
