export const installationScript=String.raw`
const $=s=>document.querySelector(s);
let data,selected,saving=false,loaded=false;
function message(text,tone='info'){const e=$('#status');e.textContent=text;e.dataset.tone=tone;e.hidden=!text;}
function options(el,rows){el.replaceChildren(...rows.map(x=>new Option(x.name,x.id)));}
function dirty(){return selected&&($('#name').value.trim()!==selected.name||$('#url').value!==JSON.parse(selected.redirect_uris)[0]||$('#mode').value!==selected.mode||($('#mode').value==='roster'&&$('#organization').value!==selected.roster_id));}
function settings(){return {clientId:selected.client_id,authOrigin:data.authOrigin,siteUrl:JSON.parse(selected.redirect_uris)[0],accessPolicy:selected.mode==='admin'?'admin':'member'};}
function prompt(){return ['아래 공식 안내를 읽고 이 사이트에 Access Kit을 설치해 주세요.','기존 기능과 중앙 명부의 접근 제한을 유지하고, npm 설치부터 빌드·익명 차단·허용 회원 입장·로그아웃까지 검증하세요.','서비스 연결 정보는 아래 값을 사용하세요. 사람이 필요한 로그인 단계만 요청하세요.','','https://unpkg.com/access-kit-sdk@'+data.version+'/docs/LLM_INSTALLATION.md','','<access-kit-context>',JSON.stringify({sdkVersion:data.version,...settings()},null,2),'</access-kit-context>'].join('\n');}
function connection(){
 const ready=Boolean(selected),changed=Boolean(dirty());
 $('#connection-empty').hidden=ready;$('#connection-values').hidden=!ready;$('#prompt-preview').hidden=!ready;$('#manual-install').hidden=!ready;
 $('#copy-all').disabled=!ready||!loaded||changed||saving;$('#unsaved-note').hidden=!changed;
 $('#service-title').textContent=ready?'서비스 설정':'서비스 등록';$('#save-service').textContent=ready?'변경사항 저장':'서비스 등록';$('#save-service').classList.toggle('primary',!ready||changed);
 if(ready){const s=settings();$('#connection-origin').textContent=s.authOrigin;$('#connection-id').textContent=s.clientId;$('#connection-site').textContent=s.siteUrl;$('#llm-instructions').textContent=prompt();}
}
function mode(){
 const value=$('#mode').value,season=value==='roster';
 $('#organization-label').hidden=!season;$('#organization').required=season;$('#organization').disabled=!data.rosters.some(r=>r.status==='active');
 $('#policy-help').textContent=({approved:'기존 중앙 승인 회원 기준입니다. 새 서비스는 명부 기준을 권장합니다.',roster:'선택한 명부의 CID만 이 서비스의 회원으로 이용합니다. 서비스 소유자는 이 서비스의 개발자로 접근합니다.',admin:'중앙 인증기의 최고 관리자만 이용하는 기존 정책입니다.'})[value]||'이 사이트를 이용할 사람을 선택하세요.';
 const policyLocked=selected?.canChangePolicy===false;
 $('#policy-lock-note').hidden=!policyLocked;$('#organization-empty').hidden=!season||data.rosters.some(r=>r.status==='active');
 if(policyLocked){$('#mode').disabled=true;$('#organization').disabled=true;$('#policy-lock-note').textContent='공동 관리자는 서비스 이름과 주소를 수정할 수 있습니다. 연결 명부 변경은 소유자가 처리합니다.';}
 const unavailable=season&&selected&&selected.roster_id&&!data.rosters.some(r=>r.id===selected.roster_id&&r.status==='active');
 $('#organization-unavailable').hidden=!unavailable;
 connection();
}
function rosterOptions(){return [{id:'',name:'명부를 선택하세요'},...data.rosters.filter(r=>r.status==='active').map(r=>({id:r.id,name:(r.owner_user_id?'내 명부 · ':'공유 · ')+r.name+(r.is_default?' (기본값)':'')}))];}
function reset(){selected=null;$('#service-form').reset();$('#mode').disabled=false;$('#mode').value='roster';options($('#organization'),rosterOptions());$('#organization').value=data.defaultRosterId||'';$('#manual-install').open=false;mode();}
function show(){
 const raw=data.services.find(x=>x.client_id===$('#existing').value);selected=raw?{...raw,storedMode:raw.mode,mode:raw.mode==='season'?'roster':raw.mode}:null;
 if(!selected){reset();message('');return;}
 $('#name').value=selected.name;$('#url').value=JSON.parse(selected.redirect_uris)[0];$('#mode').value=selected.mode;$('#mode').disabled=false;
 options($('#organization'),rosterOptions());
 if(selected.mode==='roster'&&selected.roster_id&&!data.rosters.some(r=>r.id===selected.roster_id&&r.status==='active'))$('#organization').add(new Option('사용할 수 없는 명부 · 다른 명부를 선택하세요',selected.roster_id));
 $('#organization').value=selected.roster_id||'';mode();render();message('');
}
function step(n){if(!selected){message('먼저 서비스를 등록하세요.');return;}if(n===0){$('#manual-install').open=false;return;}$('#manual-install').open=true;document.querySelectorAll('#manual-install [data-panel]').forEach(e=>e.hidden=Number(e.dataset.panel)!==n);document.querySelectorAll('[data-step]').forEach(e=>{if(Number(e.dataset.step)===n)e.setAttribute('aria-current','step');else e.removeAttribute('aria-current');});}
document.querySelectorAll('[data-step],[data-go]').forEach(b=>b.onclick=()=>step(Number(b.dataset.step??b.dataset.go)));
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
function render(){
 if(!selected)return;
 const manual=$('#hosting').value==='server';$('#automation').hidden=manual;$('#verification-file').hidden=manual;$('#deploy-note').hidden=manual;
 $('#install-note').textContent=manual?'SDK를 설치하고 아래 어댑터를 서버 요청 처리기에 연결하세요. 32바이트 이상의 무작위 세션 비밀키는 서버 환경변수 ACCESS_KIT_SESSION_SECRET에 보관하세요.':'프로젝트를 빌드한 뒤 명령을 순서대로 실행하세요. 배포는 별도 확인 후 진행하세요.';
 const s=settings(),version=data.version,base=['npm install --save-exact access-kit-sdk@'+version];
 if(!manual){
  base.push('npm install --save-dev wrangler@4.160.1','npx wrangler login');
  const init='npx access-kit init --client-id '+q(s.clientId)+' --auth-origin '+q(s.authOrigin)+' --site-url '+q(s.siteUrl)+' --access-policy '+s.accessPolicy+' --hosting '+$('#hosting').value+' --assets '+q($('#assets').value)+($('#hosting').value==='pages'?' --branch '+q($('#pages-branch').value):'')+($('#project').value?' --name '+q($('#project').value):'')+($('#config').value?' --config '+q($('#config').value):'');
  base.push(init+' --plan',init,'npx access-kit doctor');
  if($('#hosting').value==='pages'&&$('#pages-new').checked)base.push('npx wrangler pages project create '+q($('#project').value)+' --production-branch '+q($('#pages-branch').value));
  base.push('npx access-kit secret','npx access-kit deploy');
 }
 $('#commands').textContent=base.join('\n');
 $('#adapter').textContent="import {createGate} from 'access-kit-sdk/server';\nconst gate=createGate("+JSON.stringify(s,null,2)+");\nreturn gate(request,{sessionSecret:env.ACCESS_KIT_SESSION_SECRET,\n  serveAsset:(request,identity)=>existingHandler(request,env,ctx,identity)});";
 $('#verify-command').textContent=manual?'호스팅 배포 후 익명 HTML·API·이미지 차단, Google 로그인·승인 전후 입장·재접속·로그아웃을 확인하세요.':'npx access-kit verify --url '+q(s.siteUrl)+'\n# API가 있다면 실제 경로를 추가하세요\nnpx access-kit verify --path /api/your-endpoint';
 $('#update-command').textContent=manual?'npm install --save-exact access-kit-sdk@'+version+'\n기존 호스팅의 빌드·테스트·배포 절차를 따르세요.':'npx access-kit update --version '+version+'\nnpx access-kit deploy';
}
function environmentError(){
 if($('#hosting').value==='server')return '';
 if($('#hosting').value==='pages'&&!/^[A-Za-z0-9_./-]{1,128}$/.test($('#pages-branch').value))return 'Pages 운영 브랜치를 입력하세요.';
 if($('#hosting').value==='pages'&&$('#pages-new').checked&&!$('#project').value)return '새 Pages 프로젝트 이름을 입력하세요.';
 for(const id of ['assets','config']){const value=$('#'+id).value;if((id==='assets'&&!value)||(value&&!/^[A-Za-z0-9_. /-]+$/.test(value)))return '빌드 폴더와 설정 경로에는 영문·숫자·공백·하이픈을 사용하세요.';}
 if($('#project').value&&!/^[a-z0-9][a-z0-9-]{0,62}$/.test($('#project').value))return '프로젝트 이름은 영문 소문자·숫자·하이픈으로 입력하세요.';
 return '';
}
$('#mode').onchange=mode;$('#organization').onchange=connection;$('#existing').onchange=show;
for(const id of ['name','url'])$('#'+id).oninput=()=>{connection();if($('#status').dataset.tone==='success')message('');};
$('#hosting').onchange=()=>{$('#pages-new-label').hidden=$('#hosting').value!=='pages';$('#pages-branch-label').hidden=$('#hosting').value!=='pages';$('#cloudflare').hidden=$('#hosting').value==='server';$('#custom-note').hidden=$('#hosting').value!=='server';render();};
$('#environment-next').onclick=()=>{const error=environmentError();if(error){message(error,'error');return;}render();message('');step(2);};
async function load(id){
 loaded=false;$('#service-fields').disabled=true;$('#copy-all').disabled=true;$('#retry-load').hidden=true;
 const response=await fetch('/developer/services');if(!response.ok)throw Error(response.status===403?'개발자 권한을 확인해 주세요.':'연결 정보를 불러오지 못했습니다. 다시 시도해 주세요.');
 data=await response.json();loaded=true;$('#admin').hidden=!data.admin;$('#member-admin').hidden=!data.admin;$('#catalog-link').hidden=!data.admin;
 options($('#existing'),[...(!data.serviceOnly?[{id:'',name:'새 서비스 등록'}]:[]),...data.services.map(x=>({id:x.client_id,name:x.name}))]);$('#service-picker').hidden=!data.services.length;
 $('#service-fields').disabled=false;
 if(id||data.serviceOnly&&data.services.length){$('#existing').value=id||data.services[0].client_id;show();}else reset();
}
$('#service-form').onsubmit=async e=>{
 e.preventDefault();if(saving||!data)return;
 if($('#mode').value==='roster'&&!$('#organization').value){message('공유 명부를 선택하거나 내 명부를 먼저 만들어 주세요.','error');return;}
 let url;try{url=new URL($('#url').value);}catch{message('사이트 주소를 확인해 주세요.','error');return;}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash){message('사이트 주소는 https://도메인/ 형식으로 입력하세요.','error');return;}
 saving=true;$('#save-service').disabled=true;connection();
 try{
  const response=await fetch('/developer/services',{method:'POST',headers:{'Content-Type':'application/json','X-Access-Kit-Action':'1'},body:JSON.stringify({clientId:$('#existing').value||undefined,name:$('#name').value.trim(),siteUrl:url.href,mode:selected?.canChangePolicy===false?selected.storedMode:$('#mode').value,organizationId:selected?.canChangePolicy===false?selected.organization_id:null,rosterId:$('#mode').value==='roster'?$('#organization').value:undefined})});
  const body=await response.json();
  if(!response.ok)throw Error(body.error==='ROSTER_REQUIRED'?'사용할 수 있는 공유 명부 또는 내 명부를 선택하세요.':response.status===403?'이 서비스를 수정할 권한을 확인해 주세요.':response.status===409?'다른 곳에서 설정이 바뀌었습니다. 새로고침 후 확인하세요.':'서비스를 저장하지 못했습니다. 다시 시도해 주세요.');
  await load(body.clientId);message('저장했습니다. LLM 설치 지시문을 복사하세요.','success');
 }catch(error){message(error instanceof Error?error.message:'서비스를 저장하지 못했습니다.','error');}
 finally{saving=false;$('#save-service').disabled=false;connection();}
};
async function copy(text,button){const original=button.textContent;try{await navigator.clipboard.writeText(text);button.textContent='복사했습니다';message('클립보드에 복사했습니다.','success');}catch{message('자동 복사를 사용할 수 없습니다. 펼친 내용을 직접 선택해 복사하세요.','error');$('#prompt-preview').open=true;}finally{setTimeout(()=>button.textContent=original,1800);}}
$('#copy').onclick=()=>{const error=environmentError();if(error){message(error,'error');return;}render();copy($('#commands').textContent,$('#copy'));};
$('#copy-all').onclick=()=>{if(selected&&!dirty()&&!saving)copy(prompt(),$('#copy-all'));};
$('#retry-load').onclick=()=>{message('연결 정보를 불러오는 중…');start();};
function start(){load().then(()=>message('')).catch(error=>{message(error instanceof Error?error.message:'연결 정보를 불러오지 못했습니다.','error');$('#retry-load').hidden=false;});}
start();
`;
