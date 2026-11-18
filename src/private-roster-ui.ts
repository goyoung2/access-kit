export const privateRosterScript=String.raw`
let privateSelected='',privateContent,privateGeneration=0;
async function privateApi(path='',body){const r=await fetch('/developer/rosters'+path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Access-Kit-Action':'1'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok)throw Error(d.error||'명부를 처리하지 못했습니다.');return d;}
async function renderPrivateRosters(root){
 const generation=++privateGeneration;root.innerHTML='<section class="panel"><p>명부를 불러오는 중…</p></section>';
 try{
  const result=await privateApi(),shared=result.rosters.filter(r=>!r.owner_user_id&&r.status==='active'),own=result.rosters.filter(r=>r.owner_user_id);
  if(!own.some(r=>r.id===privateSelected))privateSelected=own.find(r=>r.status==='active')?.id||own[0]?.id||'';
  const content=privateSelected?await privateApi('/'+encodeURIComponent(privateSelected)):null;
  if(generation!==privateGeneration||tab!=='myrosters')return;privateContent=content;
  root.innerHTML='<section class="panel"><h2>공유 명부</h2><p>연결하면 원본의 변경 사항을 함께 적용받습니다. 공유 명부는 중앙 관리자가 관리하며, 개발자는 회원 명단을 내려받거나 수정할 수 없습니다.</p>'+shared.map(r=>'<article class="card"><div class="row"><strong>'+esc(r.name)+'</strong>'+badge(r.is_default?'기본 공유 명부':'공유 · 읽기 전용',r.is_default?'ok':'')+'<span>'+r.entry_count+'명</span>'+(result.admin&&!r.is_default?button('private-default',r.id,'기본값으로 설정'):'')+'</div></article>').join('')+(shared.length?'':'<p class="empty">공유 명부가 없습니다. 내 명부를 만들어 사용할 수 있습니다.</p>')+'</section><section class="panel"><div class="row"><h2>내 명부</h2>'+button('private-create','','명부 만들기','primary')+'</div><p>직접 관리하는 명부입니다. 내 서비스에서 선택할 수 있으며 공유 명부와 다른 개발자의 명부에는 영향을 주지 않습니다.</p>'+(own.length?'<label>관리할 명부<select id="private-roster-select">'+options(own.map(r=>({id:r.id,name:r.name+(result.admin&&r.owner_name?' · '+r.owner_name:'')+(r.status==='deleted'?' (삭제됨)':'')})),privateSelected)+'</select></label>':'<p class="empty">아직 만든 명부가 없습니다. 기본 공유 명부로 바로 시작하거나 새 명부를 만드세요.</p>')+'<div id="private-roster-detail"></div></section>';
  const picker=$('#private-roster-select');if(picker)picker.onchange=()=>{privateSelected=picker.value;renderPrivateRosters(root);};renderPrivateDetail();
 }catch(e){if(generation!==privateGeneration)return;root.innerHTML='<section class="panel"><p>명부를 불러오지 못했습니다.</p>'+button('private-reload','','다시 불러오기')+'</section>';status(e.message,true);}
}
function renderPrivateDetail(){
 const target=$('#private-roster-detail');if(!target||!privateContent)return;
 const r=privateContent.roster,active=r.status==='active';
 target.innerHTML='<div class="toolbar">'+badge(active?'사용 중':'삭제됨',active?'ok':'bad')+button('private-rename','','이름 수정')+button(active?'private-delete':'private-restore','',active?'명부 삭제':'명부 복구',active?'danger':'')+'</div>'+(active?'<div class="toolbar">'+button('private-add','','한 명 추가')+button('private-import','','파일 · 붙여넣기로 가져오기')+'</div>':'<p>명부를 복구한 뒤 회원을 수정할 수 있습니다. 이 명부를 연결한 서비스의 일반 회원 입장은 차단됩니다.</p>')+'<div class="toolbar"><input id="private-search" aria-label="내 명부 검색" placeholder="닉네임 또는 CID 검색"><select id="private-filter" aria-label="내 명부 상태"><option value="active">등록된 명부</option><option value="deleted">삭제된 명부</option><option value="all">전체 이력</option></select></div><div id="private-entries"></div>';
 $('#private-search').oninput=renderPrivateEntries;$('#private-filter').onchange=renderPrivateEntries;renderPrivateEntries();
}
function renderPrivateEntries(){
 if(!privateContent)return;const q=$('#private-search').value.toLocaleLowerCase(),filter=$('#private-filter').value,active=privateContent.roster.status==='active';
 const rows=privateContent.entries.filter(e=>(filter==='all'||e.status===filter)&&[e.nickname,e.game_uid].some(v=>v.toLocaleLowerCase().includes(q)));
 $('#private-entries').innerHTML='<p>'+rows.length+'명</p>'+table(['닉네임','CID','상태','관리'],rows.map(e=>'<tr><td>'+esc(e.nickname)+'</td><td>'+esc(e.game_uid)+'</td><td>'+badge(e.status==='active'?'등록':'삭제됨')+'</td><td>'+(active?(e.status==='active'?button('private-edit',e.id,'수정')+' '+button('private-remove-entry',e.id,'삭제','danger'):button('private-restore-entry',e.id,'복구')):'—')+'</td></tr>').join(''))+(rows.length?'':'<p class="empty">해당 회원이 없습니다.</p>');
}
async function privateSave(body){await privateApi('',body);await renderPrivateRosters($('#content'));status('명부를 저장했습니다.');}
async function handlePrivateRoster(action,id){
 if(action==='private-reload'){await renderPrivateRosters($('#content'));return;}
 if(action==='private-create'){dialog('<h2>내 명부 만들기</h2><label>명부 이름<input id="private-name" maxlength="80" required></label><p>생성 후 회원을 입력하거나 파일로 가져오세요. 사용할 서비스에서 이 명부를 선택하면 연결됩니다.</p>',async()=>{const name=$('#private-name').value.trim();if(!name)throw Error('명부 이름을 입력하세요.');const r=await privateApi('',{action:'create',name});privateSelected=r.rosterId;await renderPrivateRosters($('#content'));status('명부를 만들었습니다.');});return;}
 if(action==='private-default'){dialog('<h2>기본 공유 명부 변경</h2><p>새 서비스의 기본 선택만 바뀝니다. 기존 서비스의 명부는 변경하지 않습니다.</p>',()=>privateSave({action:'default',rosterId:id}));return;}
 if(!privateContent)return;const r=privateContent.roster,context={rosterId:r.id,revision:r.revision},entry=privateContent.entries.find(e=>e.id===id);
 if(action==='private-rename'){dialog('<h2>명부 이름 수정</h2><label>명부 이름<input id="private-name" value="'+esc(r.name)+'" maxlength="80"></label>',()=>privateSave({...context,action:'rename',name:$('#private-name').value.trim()}));return;}
 if(action==='private-delete'||action==='private-restore'){dialog('<h2>'+esc(r.name)+' '+(action==='private-delete'?'삭제':'복구')+'</h2><p>'+(action==='private-delete'?'이 명부를 사용하는 일반 회원의 서비스 접근이 차단됩니다. 계정·공유 명부는 보존되며 나중에 복구할 수 있습니다.':'명부를 다시 사용합니다. 이용 정지된 계정은 해제하지 않습니다.')+'</p>',()=>privateSave({...context,action:action==='private-delete'?'delete':'restore'}));return;}
 if(action==='private-remove-entry'||action==='private-restore-entry'){if(!entry)return;dialog('<h2>'+esc(entry.nickname)+' '+(action==='private-remove-entry'?'삭제':'복구')+'</h2><p>이 명부에만 반영하며 Google 계정이나 다른 명부는 변경하지 않습니다.</p>',()=>privateSave({...context,action:action==='private-remove-entry'?'remove-entry':'restore-entry',entryId:entry.id,entryRevision:entry.revision}));return;}
 if(action==='private-add'||action==='private-edit'){dialog('<h2>'+(entry?'회원 수정':'한 명 추가')+'</h2><label>닉네임<input id="private-nickname" maxlength="40" value="'+esc(entry?.nickname||'')+'"></label><label>게임 CID<input id="private-cid" inputmode="numeric" maxlength="32" value="'+esc(entry?.game_uid||'')+'"></label>',()=>privateSave({...context,action:'entry',nickname:$('#private-nickname').value.trim(),gameUid:$('#private-cid').value.trim(),...(entry?{entryId:entry.id,entryRevision:entry.revision}:{})}));return;}
 if(action==='private-import'){
  dialog('<h2>내 명부 가져오기</h2><p>JSON·CSV·TSV 또는 닉네임·CID 두 열을 사용하세요. members 배열도 읽습니다. 미리보기에서 확인한 뒤 저장합니다.</p><label>파일 선택<input id="private-file" type="file" accept=".json,.csv,.tsv,.txt"></label><label>내용 붙여넣기<textarea id="private-text" class="roster-input" rows="8"></textarea></label><button id="private-preview" type="button">미리보기</button><div id="private-preview-result" aria-live="polite"></div>');
  let generation=0;const invalidate=()=>{generation++;confirmAction=undefined;$('#confirm').hidden=true;$('#private-preview-result').textContent='내용을 확인하고 미리보기를 실행하세요.';};$('#private-text').oninput=invalidate;
  $('#private-file').onchange=()=>run(async()=>{const file=$('#private-file').files[0];if(!file)return;if(file.size>2000000)throw Error('파일은 2MB 이하로 나누어 주세요.');$('#private-text').value=await file.text();invalidate();});
  $('#private-preview').onclick=()=>run(async()=>{const attempt=++generation,text=$('#private-text').value;$('#confirm').hidden=true;$('#private-preview-result').textContent='미리보기 중…';const result=await privateApi('',{...context,action:'preview',text});if(attempt!==generation)return;$('#private-preview-result').innerHTML='<p>신규 '+result.counts.add+' · 수정 '+result.counts.update+' · 유지 '+result.counts.unchanged+' · 충돌 '+result.counts.conflict+' · 오류 '+result.errors.length+'</p>'+result.errors.map(e=>'<p class="status error">'+esc(e.message)+'</p>').join('')+table(['닉네임','CID','변경'],result.items.map(e=>'<tr><td>'+esc(e.nickname)+'</td><td>'+esc(e.gameUid)+'</td><td>'+esc({add:'추가',update:'수정',unchanged:'유지',conflict:'삭제된 행 · 먼저 복구'}[e.kind])+'</td></tr>').join(''));if(result.ready){confirmAction=()=>privateSave({...context,action:'import',text,fingerprint:result.fingerprint});$('#confirm').hidden=false;}});
 }
}
`;
