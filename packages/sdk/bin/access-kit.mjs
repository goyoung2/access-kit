#!/usr/bin/env node
import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {parseArgs} from 'node:util';
const {values,positionals}=parseArgs({allowPositionals:true,options:{'client-id':{type:'string'},'auth-origin':{type:'string'},'site-url':{type:'string'},'access-policy':{type:'string',default:'member'},assets:{type:'string',default:'dist'},url:{type:'string'}}});
function rootUrl(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('HTTPS origin required');return u.href;}
async function main(){
 switch(positionals[0]){
 case 'init':{
  const root=await realpath(process.cwd()),assets=await realpath(resolve(values.assets));
  const rel=relative(root,assets);if(!rel||rel.startsWith('..')||/^[A-Za-z]:/.test(rel))throw Error('assets must be a child directory');
  if(!await stat(join(assets,'index.html')).then(s=>s.isFile()))throw Error('Build index.html first');
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(values['client-id']||''))throw Error('--client-id required');
  if(!['member','admin'].includes(values['access-policy']))throw Error('--access-policy must be member or admin');
  const settings={clientId:values['client-id'],authOrigin:new URL(rootUrl(values['auth-origin'])).origin,siteUrl:rootUrl(values['site-url']),accessPolicy:values['access-policy']};
  const files={
   'access-kit.json':JSON.stringify(settings,null,2)+'\n',
   'access-kit.worker.mjs':"import {createGate} from '@goyoung2/access-kit/server';\nconst gate=createGate("+JSON.stringify(settings)+");\nexport default {fetch(request,env){return gate(request,{sessionSecret:env.ACCESS_KIT_SESSION_SECRET,serveAsset:(r)=>env.ASSETS.fetch(r)});}};\n",
   'wrangler.access-kit.json':JSON.stringify({name:settings.clientId.toLowerCase().replaceAll('_','-'),main:'access-kit.worker.mjs',compatibility_date:'2026-08-24',workers_dev:true,assets:{directory:rel.split('\\').join('/'),binding:'ASSETS',run_worker_first:true}},null,2)+'\n',
  };
  // Refuse a partial overwrite, including an existing configuration created by another tool.
  for(const name of Object.keys(files)){try{await stat(name);throw Error(name+' already exists; use the existing config or move it explicitly.');}catch(e){if(e.code!=='ENOENT')throw e;}}
  for(const[name,body]of Object.entries(files))await writeFile(name,body,{flag:'wx'});
  console.log('Created access-kit.json, access-kit.worker.mjs, wrangler.access-kit.json. Set ACCESS_KIT_SESSION_SECRET (32+ random characters), then deploy.');break;
 }
 case 'verify':{
  const url=rootUrl(values.url);let failed=false;
  for(const path of ['/','/index.html','/data.json']){
   const r=await fetch(new URL(path,url),{redirect:'manual',headers:{Accept:'application/json'}});
   const protectedPath=[401,403].includes(r.status)&&r.headers.get('X-Access-Kit-Gate')==='v1';
   console.log(JSON.stringify({path,status:r.status,gate:r.headers.get('X-Access-Kit-Runtime'),protected:protectedPath}));
   if(!protectedPath)failed=true;await r.body?.cancel();
  }
  if(failed)process.exitCode=1;break;
 }
 case 'doctor':{
  const settings=JSON.parse(await readFile('access-kit.json','utf8'));rootUrl(settings.authOrigin);rootUrl(settings.siteUrl);
  const {createGate}=await import('../server/gate.mjs');createGate(settings);
  console.log('Configuration valid. Run verify against the deployed URL, then test Google login and membership denial.');break;
 }
 default:console.log('access-kit init --client-id ID --auth-origin https://AUTH --site-url https://SITE --assets dist\naccess-kit doctor\naccess-kit verify --url https://SITE');
 }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Command failed');process.exitCode=1;});
