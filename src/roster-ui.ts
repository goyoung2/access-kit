export const rosterScript=String.raw`
let rosterSeason='',rosterOrganization='';
function renderRoster(root){
 if(!liveSeasons().some(s=>s.id===rosterSeason))rosterSeason=liveSeasons().find(s=>s.status==='active')?.id||liveSeasons()[0]?.id||'';
 if(rosterOrganization&&!liveOrganizations().some(o=>o.id===rosterOrganization))rosterOrganization='';
 const season=data.seasons.find(s=>s.id===rosterSeason),editable=season&&season.status!=='archived'&&liveOrganizations().length;
 const rows=(data.roster||[]).filter(r=>r.season_id===rosterSeason&&(!rosterOrganization||r.organization_id===rosterOrganization)&&(filter==='all'||r.status===(filter||'active'))&&matches(r));
 root.innerHTML='<section class="panel"><div class="row"><label>시즌<select id="roster-season">'+options(liveSeasons(),rosterSeason)+'</select></label><label>소속<select id="roster-organization"><option value="">전체 담당 소속</option>'+orgs(rosterOrganization)+'</select></label></div>'+
  (editable?'<div class="toolbar">'+button('roster-create','','한 명 추가','primary')+button('roster-import','','파일 · 붙여넣기로 가져오기')+'</div>':'<p>'+(!season?'시즌 · 소속 메뉴에서 시즌을 추가하세요.':season.status==='archived'?'종료된 시즌은 조회만 가능합니다.':'시즌 · 소속 메뉴에서 소속을 추가하세요.')+' 삭제된 소속의 기록은 소속 복구 후 수정할 수 있습니다.</p>')+
  '<p>Google 로그인 전에도 명부를 등록할 수 있습니다. 명부 등록은 로그인 계정의 회원 승인을 대신하지 않습니다.</p>'+toolbar('닉네임 또는 UID 검색','<select id="filter" aria-label="명부 상태">'+options([{id:'active',name:'등록된 명부'},{id:'deleted',name:'삭제된 명부'},{id:'all',name:'전체 이력'}],filter||'active')+'</select>')+
  '<p>'+rows.length+'명 · 표가 넓으면 좌우로 스크롤하세요.</p><div class="roster-table">'+table(['닉네임','UID · 권역','소속','계정 연결','관리'],rows.map(r=>'<tr><td><strong>'+esc(r.nickname)+'</strong>'+(r.status==='deleted'?'<br>'+badge('삭제됨','bad'):'')+'</td><td>'+esc(r.game_uid)+'<br><small>'+esc(r.realm)+'</small></td><td>'+esc((data.organizations.find(o=>o.id===r.organization_id)?.name||'')+(data.organizations.find(o=>o.id===r.organization_id)?.deleted_at?' (삭제됨)':''))+'</td><td>'+badge(r.linked_user_id?(r.member_status==='suspended'?'연결됨 · 이용 정지':'계정 연결됨'):'로그인 계정 미연결',r.member_status==='suspended'?'bad':'')+'</td><td>'+(editable&&liveOrganizations().some(o=>o.id===r.organization_id)?(r.status==='active'?button('roster-edit',r.id,'수정')+' '+button('roster-delete',r.id,'삭제','danger'):button('roster-restore',r.id,'복구')):'—')+'</td></tr>').join(''))+'</div>'+(rows.length?'':'<p class="empty">명부가 없습니다. 한 명씩 추가하거나 파일·표를 가져오세요.</p>')+'</section>';
 $('#roster-season').onchange=e=>{rosterSeason=e.target.value;renderBody();};
 $('#roster-organization').onchange=e=>{rosterOrganization=e.target.value;renderBody();};
}
function rosterFields(entry){
 const locked=entry?.linked_user_id?' readonly':'';
 return '<label>소속<select id="roster-org" required>'+orgs(entry?.organization_id||rosterOrganization||liveOrganizations()[0]?.id)+'</select></label>'+
 '<label>권역 / 서버<input id="roster-realm" value="'+esc(entry?.realm||'kr')+'" maxlength="64" required'+locked+'></label>'+
 '<label>닉네임<input id="roster-name" value="'+esc(entry?.nickname||'')+'" maxlength="40" required></label>'+
 '<label>UID (CID)<input id="roster-uid" value="'+esc(entry?.game_uid||'')+'" inputmode="numeric" pattern="[0-9]{1,32}" required'+locked+'></label>'+
 (entry?.linked_user_id?'<p>연결된 UID·권역은 유지합니다. 닉네임과 담당 소속은 수정할 수 있습니다.</p>':'');
}
async function rosterSave(body){await api('roster',body);await load();status('명부 변경을 저장했습니다.');}
async function handleRoster(action,id){
 const entry=(data.roster||[]).find(r=>r.id===id);
 if(action==='roster-create'||action==='roster-edit'){
  if(action==='roster-edit'&&!entry)throw Error('명부를 새로고침하세요.');
  const seasonId=entry?.season_id||rosterSeason;
  dialog('<h2>'+(entry?'명부 수정':'명부에 한 명 추가')+'</h2><p>'+esc(data.seasons.find(s=>s.id===seasonId)?.name||'')+'</p>'+rosterFields(entry),async()=>{
   const nickname=$('#roster-name').value.trim(),gameUid=$('#roster-uid').value.trim(),realm=$('#roster-realm').value.trim();
   if(!nickname||!/^[0-9]{1,32}$/.test(gameUid)||!realm)throw Error('닉네임·권역과 숫자 UID를 입력하세요.');
   await rosterSave({action:entry?'update':'create',...(entry?{id:entry.id,revision:entry.revision}:{}),seasonId,organizationId:$('#roster-org').value,realm,nickname,gameUid});
  });return;
 }
 if(action==='roster-delete'||action==='roster-restore'){
  if(!entry)throw Error('명부를 새로고침하세요.');
  const restore=action==='roster-restore';
  dialog('<h2>'+esc(entry.nickname)+' '+(restore?'복구':'명부에서 삭제')+'</h2><p>'+(restore?'이 시즌 명부에 다시 포함합니다. 전체 이용 정지는 자동 해제하지 않습니다.':'이 시즌 소속을 해제합니다. 다른 시즌·Google 계정·회원 ID·정지 이력은 유지합니다. 승인 회원 공통 서비스의 자격은 별도입니다. 삭제 목록에서 복구할 수 있습니다.')+'</p>',()=>rosterSave({action:restore?'restore':'delete',id:entry.id,revision:entry.revision}));return;
 }
 if(action!=='roster-import')return;
 dialog('<h2>명부 가져오기</h2><p>'+esc(data.seasons.find(s=>s.id===rosterSeason)?.name||'')+' · JSON 매핑/records 배열, CSV 또는 엑셀 두 열(닉네임·UID)을 붙여넣을 수 있습니다. 미리보기 전에는 저장하지 않습니다.</p><label>소속<select id="import-org">'+orgs(rosterOrganization||liveOrganizations()[0]?.id)+'</select></label><label>권역 / 서버<input id="import-realm" value="kr" maxlength="64"></label><label>파일 선택<input id="roster-file" type="file" accept=".json,.csv,.tsv,.txt,application/json,text/csv"></label><label>내용 붙여넣기 · 수정<textarea id="roster-text" class="roster-input" rows="9" placeholder="닉네임&#9;UID"></textarea></label><button id="roster-preview-button" type="button">미리보기</button><div id="roster-preview" aria-live="polite"></div>');
 let generation=0;
 const invalidate=()=>{generation++;confirmAction=undefined;$('#confirm').hidden=true;$('#roster-preview').textContent='내용을 확인하고 미리보기를 실행하세요.';};
 for(const selector of ['#roster-text','#import-org','#import-realm'])$(selector).oninput=invalidate;
 $('#roster-file').onchange=e=>run(async()=>{const file=e.target.files[0];if(!file)return;if(file.size>2_000_000)throw Error('파일이 2MB를 넘습니다. 명부를 나누어 가져오세요.');const textarea=$('#roster-text'),content=await file.text();if(textarea!==$('#roster-text')||!$('#dialog').open)return;textarea.value=content;invalidate();});
 $('#roster-preview-button').onclick=()=>run(async()=>{
  const panel=$('#roster-preview'),button=$('#roster-preview-button'),version=++generation;
  $('#confirm').hidden=true;button.disabled=true;panel.textContent='명부를 검사하고 있습니다…';
  const body={realm:$('#import-realm').value.trim(),seasonId:rosterSeason,organizationId:$('#import-org').value,text:$('#roster-text').value};
  try{
   const result=await api('roster',{action:'preview',...body});
   if(version!==generation||$('#roster-preview')!==panel||!$('#dialog').open)return;
   const counts=result.counts;
   panel.innerHTML='<h3>미리보기</h3><p>신규 '+counts.add+' · 수정 '+counts.update+' · 유지 '+counts.unchanged+' · 충돌 '+counts.conflict+' · 입력 오류 '+result.errors.length+'</p>'+(result.duplicateCount?'<p>같은 닉네임·UID의 중복 입력 '+result.duplicateCount+'건을 합쳤습니다.</p>':'')+result.errors.map(e=>'<p class="status error">'+(e.row?e.row+'행: ':'')+esc(e.message)+'</p>').join('')+table(['닉네임','UID','반영 내용'],result.items.map(r=>'<tr><td>'+esc(r.nickname)+'</td><td>'+esc(r.gameUid)+'</td><td>'+esc({add:'추가',update:'닉네임 수정',unchanged:'변경 없음',conflict:'충돌'}[r.kind])+(r.message?'<br><small>'+esc(r.message)+'</small>':'')+'</td></tr>').join(''));
   if(result.ready){$('#confirm').hidden=false;confirmAction=async()=>{panel.insertAdjacentHTML('beforeend','<p id="roster-progress" class="status" role="status">명부 '+(counts.add+counts.update)+'명을 반영하고 있습니다. 완료될 때까지 기다려 주세요.</p>');try{await api('roster',{action:'import',...body,fingerprint:result.fingerprint});}catch(error){$('#roster-progress').textContent='반영하지 못했습니다. 아래 오류를 확인하세요.';throw error;}await load();status('명부 가져오기 완료: 신규 '+counts.add+'명, 수정 '+counts.update+'명, 유지 '+counts.unchanged+'명');};}
  }finally{if(button.isConnected)button.disabled=false;}
 });
}
`;
