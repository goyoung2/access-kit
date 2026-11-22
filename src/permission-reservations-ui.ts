import {developerStyle} from './developer-style';

export const permissionReservationScript=String.raw`
let reservationScope='';
const reservationRoles={developer:'서비스 등록 허용',manager:'회원 관리자',superadmin:'최고 관리자',service_admin:'서비스 공동 관리자'};
function reservationEndpoint(){return reservationScope?'/console/services/'+encodeURIComponent(reservationScope)+'/invitations':'/console/permission-reservations';}
async function reservationApi(body){const r=await fetch(reservationEndpoint(),body?{method:'POST',headers:{'Content-Type':'application/json','X-Access-Kit-Action':'1'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok)throw Error(d.error||'권한 예약을 처리하지 못했습니다.');return d;}
async function openPermissionReservations(clientId=''){
 reservationScope=clientId;const result=await reservationApi();
 dialog('<h2>가입 전 권한 예약</h2><p>CID와 권한을 지정하고 초대 링크를 전달하세요. 상대방이 로그인·가입 후 링크를 수락해야 적용됩니다. 링크는 7일 동안 한 번 사용할 수 있습니다.</p><label>대상 게임 CID<input id="reservation-cid" inputmode="numeric" maxlength="32" required></label>'+(clientId?'<p>권한: 이 서비스의 공동 관리자</p>':'<label>권한<select id="reservation-role">'+Object.entries(reservationRoles).map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join('')+'</select></label><label id="reservation-org-label" hidden>담당 소속<select id="reservation-org">'+liveOrganizations().map(o=>'<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>').join('')+'</select></label><label id="reservation-service-label" hidden>담당 서비스<select id="reservation-service">'+data.services.map(s=>'<option value="'+esc(s.client_id)+'">'+esc(s.name)+'</option>').join('')+'</select></label>')+'<h3>최근 예약</h3>'+table(['CID · 권한','상태','관리'],result.reservations.map(r=>{const state=r.redeemed_at?'수락 완료':r.revoked_at?'취소됨':r.expires_at<=Date.now()?'만료됨':'수락 대기';return '<tr><td>'+esc(r.game_uid)+'<br><small>'+esc(reservationRoles[r.role])+' · '+esc(r.client_id?data.services.find(s=>s.client_id===r.client_id)?.name||'해당 서비스':r.organization_id?data.organizations.find(o=>o.id===r.organization_id)?.name||'담당 소속':'이 인증 환경')+'</small></td><td>'+badge(state)+'</td><td>'+(state==='수락 대기'?button('reservation-revoke',r.id,'예약 취소','danger'):'—')+'</td></tr>';}).join(''))+(result.reservations.length?'':'<p class="empty">예약된 권한이 없습니다.</p>'),async()=>{
  const role=clientId?'service_admin':$('#reservation-role').value,body={action:'create',role,gameUid:$('#reservation-cid').value.trim()};
  if(role==='service_admin')body.clientId=clientId||$('#reservation-service').value;
  if(role==='manager')body.organizationId=$('#reservation-org').value;
  const created=await reservationApi(body);dialog('<h2>초대 링크를 전달하세요</h2><p>아직 권한은 부여되지 않았습니다. 지정한 CID로 가입하고 이 링크를 수락해야 적용됩니다. 링크는 다시 표시되지 않습니다.</p><label>일회용 초대 링크<input id="reservation-link" readonly value="'+esc(created.url)+'"></label><button id="reservation-copy" type="button">초대 링크 복사</button>');
  $('#reservation-link').select();$('#reservation-copy').onclick=()=>run(async()=>{await navigator.clipboard.writeText(created.url);$('#reservation-copy').textContent='복사했습니다';});
 });
 if(!clientId){const sync=()=>{$('#reservation-org-label').hidden=$('#reservation-role').value!=='manager';$('#reservation-service-label').hidden=$('#reservation-role').value!=='service_admin';};$('#reservation-role').onchange=sync;sync();}
}
async function handlePermissionReservation(action,id){
 if(action==='reservation-open'){await openPermissionReservations();return;}
 if(action==='reservation-revoke'){dialog('<h2>권한 예약 취소</h2><p>이 초대 링크는 더 이상 권한을 부여하지 않습니다. 이미 수락한 권한은 해당 관리자 목록에서 해제하세요.</p>',async()=>{await reservationApi({action:'revoke',id});status('권한 예약을 취소했습니다.');});}
}
`;

export function permissionInvitationPage(){return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>권한 초대 · Access Kit</title><style>${developerStyle}</style><header><strong>ACCESS KIT</strong></header><main style="display:block;max-width:640px"><h1>관리 권한 초대</h1><section><p id="details" role="status">초대 내용을 확인하는 중…</p><p>먼저 본인의 Google 계정으로 로그인하고 지정된 CID로 가입하세요. 아래 버튼으로 초대를 수락해야 권한이 적용됩니다.</p><div class="row"><a href="/auth/firebase" target="_blank" rel="noopener">Google 로그인·가입 ↗</a><button id="accept" class="primary" disabled>로그인·가입 후 권한 받기</button></div><p id="status" class="status" role="status" aria-live="polite"></p><a id="console" href="/console" hidden>관리 콘솔 열기</a></section></main><script type="module">
const token=location.hash.slice(1),status=document.querySelector('#status'),button=document.querySelector('#accept');
const roles={developer:'서비스 등록 허용',manager:'회원 관리자',superadmin:'최고 관리자',service_admin:'서비스 공동 관리자'};
async function post(path){const r=await fetch('/permissions/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Access-Kit-Action':'1'},body:JSON.stringify({token})});const d=await r.json();if(!r.ok)throw Error(d.error||'초대를 처리하지 못했습니다.');return d;}
try{const d=await post('preview');document.querySelector('#details').textContent='대상 CID: '+d.gameUid+' · 권한: '+roles[d.role]+' · 범위: '+d.scopeName+' · 만료: '+new Date(d.expiresAt).toLocaleString();button.disabled=false;}catch(e){status.textContent=e.message;}
button.onclick=async()=>{button.disabled=true;status.textContent='권한을 확인하는 중…';try{await post('accept');status.textContent='권한을 받았습니다. 자기 계정으로 관리 콘솔을 이용하세요.';document.querySelector('#console').hidden=false;}catch(e){status.textContent=e.message+' 가입 CID와 초대 상태를 확인한 뒤 다시 시도하세요.';button.disabled=false;}};
</script></html>`;}
