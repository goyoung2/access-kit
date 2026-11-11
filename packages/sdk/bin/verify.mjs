import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {listAssets,json,rootUrl} from './project.mjs';
import {RUNTIME_VERSION,COOKIE} from '../server/gate.mjs';
export async function verify(state,options={}){
 const settings=JSON.parse(await readFile('access-kit.json','utf8'));
 const url=rootUrl(options.url||settings.siteUrl);
 const paths=[...new Set(['/',...await listAssets(state.assets),...(options.path?[options.path]:[])])];
 for(const path of paths)if(!path.startsWith('/')||path.startsWith('//')||new URL(path,url).origin!==new URL(url).origin)throw Error('검사 경로는 같은 사이트의 /경로여야 합니다.');
 const failures=[];let checked=0;
 // Sequential requests avoid spiking the destination Worker; anonymous denial never reads AUTH/D1/R2.
 for(const path of paths)for(const variant of ['GET','HEAD','Range','invalid-cookie']){
  try {
   const r=await fetch(new URL(path,url),{method:variant==='HEAD'?'HEAD':'GET',redirect:'manual',headers:{Accept:'application/json',...(variant==='Range'?{Range:'bytes=0-0'}:{}),...(variant==='invalid-cookie'?{Cookie:COOKIE+'=invalid'}:{})},signal:AbortSignal.timeout(30000)});
   const runtime=r.headers.get('X-Access-Kit-Runtime');
   if(![401,403].includes(r.status)||r.headers.get('X-Access-Kit-Gate')!=='v1'||runtime!==RUNTIME_VERSION)failures.push({path,variant,status:r.status,runtime});
   await r.body?.cancel();checked++;
  }catch(e){failures.push({path,variant,error:e instanceof Error?e.message:String(e)});}
 }
 const result={ok:failures.length===0,url,expectedRuntime:RUNTIME_VERSION,checked,paths:paths.length,at:new Date().toISOString(),failures};
 const report=options.report||'.access-kit/last-verification.json';await mkdir(dirname(report),{recursive:true});await writeFile(report,json(result));return result;
}
