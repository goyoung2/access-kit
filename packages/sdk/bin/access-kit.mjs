#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {install, doctor, loadState, sync, prepare} from './project.mjs';
import {verify} from './verify.mjs';
import {update, deploy, secret, automate} from './operations.mjs';
const strings=['client-id','auth-origin','site-url','access-policy','assets','hosting','config','name','url','package','sha256','path','report'];
const options=Object.fromEntries(strings.map(k=>[k,{type:'string'}]));
for(const k of ['plan','local']) options[k]={type:'boolean'};
try {
 const {values,positionals}=parseArgs({allowPositionals:true,options});
 switch(positionals[0]) {
  case 'wizard': {
   if(!process.stdin.isTTY) throw Error('대화형 터미널에서 wizard를 실행하거나 init 옵션을 사용하세요.');
   const rl=createInterface({input:process.stdin,output:process.stdout});
   try {for(const [key,label,fallback] of [['hosting','호스팅 (workers/pages)','workers'],['client-id','설치 페이지의 Client ID',''],['auth-origin','인증 서버 HTTPS 주소',''],['site-url','서비스 HTTPS 주소',''],['assets','빌드 폴더','dist']]) values[key]=(await rl.question(`${label}${fallback?' ['+fallback+']':''}: `)).trim()||fallback;}
   finally{rl.close();}
   await install(values);break;
  }
  case 'init': await install(values);break;
  case 'doctor': console.log(JSON.stringify(await doctor(),null,2));break;
  case 'sync': await sync();break;
  case 'prepare': await prepare();break;
  case 'secret': await secret(values);break;
  case 'deploy': await deploy(values);break;
  case 'update': await update(values);break;
  case 'automate': await automate();break;
  case 'verify': case 'status': {
   const state=await loadState();const result=await verify(state,{url:values.url,path:values.path,report:values.report});
   console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;break;
  }
  default: console.log(`Access Kit 설치 → 배포 → 업데이트
  init --client-id ID --auth-origin https://AUTH --site-url https://SITE --assets dist [--config wrangler.jsonc] [--hosting workers|pages] [--plan]
  wizard                 질문에 답하며 설치
  doctor                 파일·설정·빌드·SDK 검사
  sync                   기존 호스팅 설정 변경 반영
  prepare                빌드 후 Pages 보호 경로 재생성
  secret [--local]       세션 키 자동 생성·등록 (기존 키 유지)
  deploy                 검사 → 배포 → 실제 사이트 보호 검사
  verify [--path /api]   모든 빌드 자산·추가 경로 검사
  update --package ./SDK.tgz --sha256 HASH
                         백업 → 해시 검사 → 설치 → 빌드 → 검사
  automate               수동 실행 GitHub Actions 배포 workflow 생성
문서: https://github.com/goyoung2/access-kit/blob/main/docs/INSTALL.md`);
 }
} catch(error) {console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
