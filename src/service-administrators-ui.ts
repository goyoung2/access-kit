export const serviceAdministratorScript=String.raw`
let teamSelected='',teamSnapshot,teamGeneration=0;
async function teamApi(suffix='',body){
 const r=await fetch('/console/services/'+encodeURIComponent(teamSelected)+suffix,body?{method:'POST',headers:{'Content-Type':'application/json','X-Access-Kit-Action':'1'},body:JSON.stringify(body)}:{});
 const d=await r.json();if(!r.ok)throw Error(d.error||'서비스 관리 정보를 처리하지 못했습니다.');return d;
}
async function renderServiceManagement(root){
 const generation=++teamGeneration;teamSnapshot=undefined;root.innerHTML='<section class="panel"><p>서비스 관리 정보를 불러오는 중…</p></section>';
 try{
  const result=await teamApi();if(generation!==teamGeneration||tab!=='services')return;teamSnapshot=result;
  root.innerHTML='<section class="panel"><div class="toolbar">'+button('team-back','','서비스 목록')+'<h2>'+esc(result.service.name)+'</h2>'+button('team-reload','','새로고침')+'</div><p>관리자들은 이 서비스와 연결된 명부를 함께 관리합니다. 다른 서비스의 권한은 부여되지 않습니다.</p></section><section class="panel service-admins"><div class="row"><h2>공동 관리자</h2>'+button('team-add-admin','','관리자 추가','primary')+'</div>'+table(['관리자','CID','권한','관리'],result.administrators.map(a=>'<tr><td>'+esc(a.name)+(a.status!=='active'?' '+badge('계정 비활성','bad'):'')+'</td><td>'+esc(a.game_uid||'미등록')+'</td><td>'+badge(a.role==='owner'?'소유자':'공동 관리자')+'</td><td>'+(a.role==='owner'?'소유자 유지':button('team-remove-admin',a.user_id,'관리자 해제','danger'))+'</td></tr>').join(''))+'</section><section class="panel service-members"><h2>연결 명부 · '+esc(result.roster?.name||'없음')+'</h2>'+(result.shared?'<p>공유 원본 명부입니다. 여기서 변경하면 이 명부를 사용하는 다른 서비스에도 함께 반영됩니다.</p>':'<p>동일한 명부를 공동 관리합니다. Google 로그인 계정과 다른 명부는 삭제하지 않습니다.</p>')+(result.canDelegateRoster&&result.requiresRosterGrant?'<div class="toolbar">'+button(result.rosterDelegated?'team-lock-roster':'team-unlock-roster','',result.rosterDelegated?'이 서비스의 명부 관리권한 회수':'이 서비스에 명부 관리권한 부여',result.rosterDelegated?'danger':'')+'</div>':'')+(result.canManageRoster&&result.roster?.status==='active'&&(!result.shared||result.seasonId)?'<div class="toolbar">'+button('team-add-entry','','한 명 추가')+button('team-import','','파일 · 붙여넣기로 가져오기')+'</div><div class="toolbar"><input id="team-search" aria-label="서비스 명부 검색" placeholder="닉네임 또는 CID 검색"><select id="team-filter" aria-label="서비스 명부 상태"><option value="active">등록된 회원</option><option value="deleted">삭제된 회원</option><option value="all">전체 이력</option></select></div><div id="team-entries"></div>':'<p class="empty">명부 관리권한 또는 사용 가능한 명부가 없습니다. 중앙 관리자의 권한 부여와 소유자의 연결 설정을 확인하세요.</p>')+'</section>';
  if($('#team-search')){$('#team-search').oninput=renderTeamEntries;$('#team-filter').onchange=renderTeamEntries;renderTeamEntries();}
 }catch(e){if(generation!==teamGeneration)return;teamSnapshot=undefined;root.innerHTML='<section class="panel"><h2>서비스 관리 정보를 열 수 없습니다</h2><p>'+esc(e.message)+'</p>'+button('team-back','','서비스 목록')+button('team-reload','','다시 확인')+'</section>';status(e.message,true);}
}
function renderTeamEntries(){
 if(!teamSnapshot)return;const q=$('#team-search').value.toLocaleLowerCase(),filter=$('#team-filter').value;
 const rows=teamSnapshot.entries.filter(e=>(filter==='all'||e.status===filter)&&[e.nickname,e.game_uid].some(v=>v.toLocaleLowerCase().includes(q)));
 $('#team-entries').innerHTML='<p>'+rows.length+'명</p>'+table(['닉네임','CID','상태','관리'],rows.map(e=>'<tr><td>'+esc(e.nickname)+'</td><td>'+esc(e.game_uid)+'</td><td>'+badge(e.status==='active'?'등록':'삭제됨')+'</td><td>'+(e.status==='active'?button('team-edit-entry',e.id,'수정')+' '+button('team-remove-entry',e.id,'삭제','danger'):button('team-restore-entry',e.id,'복구'))+'</td></tr>').join(''))+(rows.length?'':'<p class="empty">해당 회원이 없습니다.</p>');
}
async function teamSave(suffix,body){await teamApi(suffix,body);await renderServiceManagement($('#content'));status('서비스 관리 변경을 저장했습니다.');}
async function handleServiceManagement(action,id){
 if(action==='team-open'){teamSelected=id;await renderServiceManagement($('#content'));return;}
 if(action==='team-back'){teamSelected='';teamSnapshot=undefined;teamGeneration++;await load();return;}
 if(action==='team-reload'){await renderServiceManagement($('#content'));return;}
 if(!teamSnapshot)throw Error('서비스 정보를 다시 불러오세요.');
 if(action==='team-lock-roster'||action==='team-unlock-roster'){dialog('<h2>공유 명부 관리권한 '+(action==='team-unlock-roster'?'부여':'회수')+'</h2><p>이 서비스의 관리자들에게 연결된 공유 원본 명부의 조회·수정 권한을 '+(action==='team-unlock-roster'?'부여':'회수')+'합니다. 이 명부를 사용하는 서비스에는 원본 변경이 함께 반영됩니다.</p>',()=>teamSave('/roster-access',{enabled:action==='team-unlock-roster'}));return;}
 if(action==='team-add-admin'){
  dialog('<h2>공동 관리자 추가</h2><p>상대방이 먼저 Google 로그인과 가입을 완료해야 합니다. 추가하면 이 서비스의 명부와 관리자 목록을 함께 관리할 수 있습니다.</p><label>추가할 사람의 게임 CID<input id="team-admin-cid" inputmode="numeric" maxlength="32" required></label>',()=>teamSave('/admins',{gameUid:$('#team-admin-cid').value.trim(),enabled:true}));return;
 }
 if(action==='team-remove-admin'){
  const account=teamSnapshot.administrators.find(a=>a.user_id===id);if(!account)return;
  dialog('<h2>'+esc(account.name)+' 관리자 해제</h2><p>이 서비스의 관리 권한을 해제합니다. 회원 계정과 다른 서비스의 권한은 유지됩니다.</p>',()=>teamSave('/admins',{userId:id,enabled:false}));return;
 }
 const context={revision:teamSnapshot.roster.revision},entry=teamSnapshot.entries.find(e=>e.id===id);
 if(action==='team-add-entry'||action==='team-edit-entry'){
  dialog('<h2>'+(entry?'회원 수정':'한 명 추가')+'</h2><label>닉네임<input id="team-nickname" maxlength="40" value="'+esc(entry?.nickname||'')+'" required></label><label>게임 CID<input id="team-cid" inputmode="numeric" maxlength="32" value="'+esc(entry?.game_uid||'')+'" required></label>',()=>teamSave('/roster',{...context,action:'entry',nickname:$('#team-nickname').value.trim(),gameUid:$('#team-cid').value.trim(),...(entry?{entryId:entry.id,entryRevision:entry.revision}:{})}));return;
 }
 if(action==='team-remove-entry'||action==='team-restore-entry'){
  if(!entry)return;dialog('<h2>'+esc(entry.nickname)+' '+(action==='team-remove-entry'?'삭제':'복구')+'</h2><p>연결된 명부에 반영합니다. 로그인 계정과 다른 명부는 변경하지 않습니다.</p>',()=>teamSave('/roster',{...context,action:action==='team-remove-entry'?'remove-entry':'restore-entry',entryId:entry.id,entryRevision:entry.revision}));return;
 }
 if(action==='team-import'){
  dialog('<h2>서비스 명부 가져오기</h2><p>닉네임·CID JSON, CSV, TSV를 사용하세요. 미리보기 후 저장하며 파일에 없는 기존 회원은 삭제하지 않습니다.</p><label>파일 선택<input id="team-file" type="file" accept=".json,.csv,.tsv,.txt"></label><label>내용 붙여넣기<textarea id="team-text" class="roster-input" rows="8"></textarea></label><button id="team-preview" type="button">미리보기</button><div id="team-preview-result" role="status"></div>');
  let generation=0;const invalidate=()=>{generation++;confirmAction=undefined;$('#confirm').hidden=true;$('#team-preview-result').textContent='내용을 확인하고 미리보기를 실행하세요.';};$('#team-text').oninput=invalidate;
  $('#team-file').onchange=()=>run(async()=>{const file=$('#team-file').files[0];if(!file)return;invalidate();const request=generation;if(file.size>2000000)throw Error('파일은 2MB 이하로 나누어 주세요.');const text=await file.text();if(request!==generation||!$('#team-text'))return;$('#team-text').value=text;invalidate();});
  $('#team-preview').onclick=()=>run(async()=>{const request=++generation,text=$('#team-text').value;confirmAction=undefined;$('#confirm').hidden=true;const result=await teamApi('/roster',{...context,action:'preview',text});if(request!==generation||!$('#team-preview-result'))return;$('#team-preview-result').innerHTML='<p>추가 '+result.counts.add+' · 수정 '+result.counts.update+' · 동일 '+result.counts.unchanged+' · 충돌 '+result.counts.conflict+'</p>'+(result.errors?.length?'<p>'+esc(result.errors.map(e=>e.message).join('\n'))+'</p>':'');if(result.ready){confirmAction=()=>teamSave('/roster',{...context,action:'import',text,fingerprint:result.fingerprint});$('#confirm').hidden=false;}});return;
 }
}
`;
