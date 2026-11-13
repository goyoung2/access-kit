import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {join,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createAuthFixture} from '../tests/auth-fixture.ts';
import {createSession} from '../src/store.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=await mkdtemp(join(tmpdir(),'access-kit-admin-cpu-'));
const {build}=createRequire(join(root,'package.json'))('esbuild');
const baseline='c33721392726d82ac640e761207aca2c4b4f15d7';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sourceFiles=['src/console.ts','src/common-admin.ts','src/console-roster.ts','src/console-data.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(join(root,path))).digest('hex')])));
const reports=[];
for(const version of ['before','after']){
 const bundle=join(directory,'handler-'+version+'.mjs');
 await build({entryPoints:[join(root,'src/index.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',target:'node22',loader:{'.txt':'text'},plugins:[{name:'baseline',setup(builder){
  if(version==='before')builder.onLoad({filter:/\.ts$/},args=>{
   const path=relative(root,args.path).replaceAll('\\','/');
   if(path.startsWith('src/'))return{contents:git('show',baseline+':'+path),loader:'ts'};
  });
 }}]});
 const app=(await import(pathToFileURL(bundle).href)).default;
 const f=await createAuthFixture();
 try{
  await f.DB.batch([
   f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),
   f.DB.prepare("INSERT INTO member_organizations VALUES('own','Synthetic affiliation')"),
   f.DB.prepare("INSERT INTO member_seasons VALUES('s','Synthetic season','active')"),
  ]);
  for(let i=0;i<108;i++){
   const user=i?'member-'+i:'user',nickname='Synthetic '+i;
   if(i)await f.DB.prepare("INSERT INTO users VALUES(?,?,NULL,'active',0,0)").bind(user,nickname).run();
   await f.DB.batch([
    f.DB.prepare("INSERT INTO common_members VALUES(?,'approved',0,'user')").bind(user),
    f.DB.prepare("INSERT INTO game_accounts VALUES(?,'kr',?,?)").bind(user,String(1000+i),nickname),
    f.DB.prepare("INSERT INTO season_memberships VALUES(?,'s','own','active',0,'user')").bind(user),
   ]);
  }
  const session=await createSession(f.env,'user');
  const call=async(path,body)=>{
   const response=await app.request('https://auth.test'+path,{method:body?'POST':'GET',headers:{Cookie:'accesskit_sid='+session.token,Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},f.env);
   const text=await response.text();assert.equal(response.status,200,text.slice(0,200));return text;
  };
  const results=[];
  async function measure(name,n,action,warmups=10){
   for(let i=0;i<warmups;i++)await action();
   const times=[],started=process.cpuUsage();
   for(let i=0;i<n;i++){const start=performance.now();await action();times.push(performance.now()-start);}
   const usage=process.cpuUsage(started);times.sort((a,b)=>a-b);
   const result={name,n,applicationProcessCpuMeanMs:(usage.user+usage.system)/1000/n,wallMedianMs:times[Math.floor(n/2)],wallP95Ms:times[Math.floor(n*.95)]};
   results.push(result);console.log(JSON.stringify({version,...result}));
  }
  const context={realm:'kr',seasonId:'s',organizationId:'own'};
  const text=JSON.stringify(Array.from({length:108},(_,i)=>({nickname:'Synthetic '+i,cid:String(1000+i)})));
  await measure('console-data-108',300,()=>call('/console/data'));
  await measure('roster-preview-108',300,()=>call('/console/roster',{action:'preview',...context,text}));
  const preview=JSON.parse(await call('/console/roster',{action:'preview',...context,text}));
  await measure('roster-import-108-unchanged',150,()=>call('/console/roster',{action:'import',...context,text,fingerprint:preview.fingerprint}));
  const inputs=[];
  for(let i=0;i<60;i++){
   const input={realm:'new-'+i,seasonId:'s',organizationId:'own',text};
   const result=JSON.parse(await call('/console/roster',{action:'preview',...input}));
   inputs.push({action:'import',...input,fingerprint:result.fingerprint});
  }
  let index=0;
  await measure('roster-import-108-new',50,()=>call('/console/roster',inputs[index++]));
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM roster_entries WHERE realm LIKE 'new-%'").first()).n,60*108);
  const changeInputs=[];
  for(let i=0;i<60;i++){
   const input={realm:'new-'+i,seasonId:'s',organizationId:'own',text:JSON.stringify(Array.from({length:108},(_,j)=>({nickname:'Changed '+j,cid:String(1000+j)})))};
   const result=JSON.parse(await call('/console/roster',{action:'preview',...input}));
   changeInputs.push({action:'import',...input,fingerprint:result.fingerprint});
  }
  index=0;
  await measure('roster-import-108-update',50,()=>call('/console/roster',changeInputs[index++]));
  reports.push({version,results});
 }finally{await f.dispose();}
}
const report=join(directory,'handler-cpu-results.json');
await writeFile(report,JSON.stringify({at:new Date().toISOString(),baseline,head:git('rev-parse','HEAD'),dirty:Boolean(git('status','--porcelain')),sourceHashes,node:process.version,method:'Same Hono application code bundled for Node/V8, real D1 executed in separate workerd child process. process.cpuUsage measures only Node handler+driver CPU, excludes SQLite child CPU and network wait. Does not equal Cloudflare production cpuTime, nor per-request maximum/p95 CPU. No cache or authentication bypass. No deployment.',reports},null,2));
console.log(JSON.stringify({report}));
