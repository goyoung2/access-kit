export const catalogScript=String.raw`
let catalogFilter='live';
function liveSeasons(){return data.seasons.filter(x=>!x.deleted_at);}
function liveOrganizations(){return data.organizations.filter(x=>!x.deleted_at);}
const phaseLabel=status=>({draft:'준비 중',active:'진행 중',archived:'종료'}[status]||status);
function renderSeasons(root,superadmin){
 const seasonsList=liveSeasons(),active=seasonsList.find(x=>x.status==='active');
 if(!seasonsList.some(x=>x.id===selectedSeason))selectedSeason=active?.id||seasonsList[0]?.id||'';
 const season=seasonsList.find(x=>x.id===selectedSeason),archived=season?.status==='archived';
 const visible=rows=>rows.filter(x=>catalogFilter==='all'||(catalogFilter==='deleted'?Boolean(x.deleted_at):!x.deleted_at));
 let html='';
 if(superadmin){
  html='<section class="panel"><div class="toolbar"><h2>시즌 관리</h2>'+button('catalog-create-season','','시즌 추가','primary')+'<select id="catalog-filter" aria-label="시즌·소속 표시">'+options([{id:'live',name:'삭제 제외'},{id:'deleted',name:'삭제된 항목'},{id:'all',name:'전체'}],catalogFilter)+'</select></div><p>시즌 이름은 직접 정합니다. 준비 중·진행 중·종료는 이름과 별도의 상태입니다.</p><div class="roster-table">'+table(['시즌 이름','상태','명부 기록','관리'],visible(data.seasons).map(s=>'<tr><td><strong>'+esc(s.name)+'</strong></td><td>'+badge(s.deleted_at?'삭제됨':phaseLabel(s.status),s.deleted_at?'bad':s.status==='active'?'ok':'')+'</td><td>'+s.roster_count+'건</td><td>'+button('catalog-rename-season',s.id,'이름 수정')+' '+(s.deleted_at?button('catalog-restore-season',s.id,'복구'):(s.status==='active'?button('catalog-end-season',s.id,'시즌 종료','danger'):button('catalog-delete-season',s.id,'삭제','danger')))+' '+(!s.deleted_at?button('catalog-view-season',s.id,'명부 보기'):'')+'</td></tr>').join(''))+'</div>'+(!visible(data.seasons).length?'<p class="empty">해당 시즌이 없습니다.</p>':'')+'</section>';
  html+='<section class="panel"><div class="toolbar"><h2>소속 관리</h2>'+button('catalog-create-organization','','소속 추가','primary')+'</div><p>맹·모임 등 실제 소속의 이름을 입력합니다. 이름을 바꿔도 회원과 연결된 내부 ID는 유지됩니다.</p><div class="roster-table">'+table(['소속 이름','연결 기록','관리'],visible(data.organizations).map(o=>'<tr><td><strong>'+esc(o.name)+'</strong>'+(o.deleted_at?' '+badge('삭제됨','bad'):'')+'</td><td>명부 '+o.roster_count+'건 · 담당 관리자 '+o.manager_count+'명 · 서비스 '+o.service_count+'개</td><td>'+button('catalog-rename-organization',o.id,'이름 수정')+' '+button(o.deleted_at?'catalog-restore-organization':'catalog-delete-organization',o.id,o.deleted_at?'복구':'삭제',o.deleted_at?'':'danger')+'</td></tr>').join(''))+'</div>'+(!visible(data.organizations).length?'<p class="empty">해당 소속이 없습니다.</p>':'')+'</section>';
 }
 html+='<section class="panel"><h2>시즌별 회원 소속</h2><label>시즌 선택<select id="season-select">'+options(seasonsList,selectedSeason)+'</select></label>'+(season?'<div class="toolbar">'+badge(phaseLabel(season.status),season.status==='active'?'ok':'')+(season.status==='draft'&&superadmin?(active?button('copy','','진행 중인 시즌에서 복사'):'')+button('activate','','시즌 시작','primary'):'')+'</div>'+table(['회원','소속','변경'],data.members.map(m=>{const a=data.assignments.find(x=>x.user_id===m.id&&x.season_id===season.id),o=data.organizations.find(x=>x.id===a?.organization_id);return '<tr data-member="'+esc(m.id)+'"><td>'+esc(m.nickname||m.display_name)+'</td><td>'+badge(a?.status==='active'?(o?.name||'등록됨')+(o?.deleted_at?' (삭제된 소속)':''):'미등록',o?.deleted_at?'bad':a?.status==='active'?'ok':'')+'</td><td>'+(archived?'—':'<select aria-label="'+esc(m.nickname||m.display_name)+' 소속">'+orgs(a?.organization_id)+'</select> '+button('assign',m.id,'저장')+(a?.status==='active'&&!o?.deleted_at?' '+button('unassign',m.id,'해제','danger'):''))+'</td></tr>';}).join('')):'<p class="empty">시즌을 추가한 뒤 회원의 소속을 관리할 수 있습니다.</p>')+'</section>';
 root.innerHTML=html;
 if($('#catalog-filter'))$('#catalog-filter').onchange=e=>{catalogFilter=e.target.value;renderBody();};
 $('#season-select').onchange=e=>{selectedSeason=e.target.value;renderBody();};
}
async function handleCatalog(action,id){
 const [operation,kind]=action.slice('catalog-'.length).split('-'),label=kind==='season'?'시즌':'소속';
 const row=(kind==='season'?data.seasons:data.organizations).find(x=>x.id===id);
 if(operation==='view'){rosterSeason=id;navigate('roster');return;}
 if(operation==='create'||operation==='rename'){
  if(operation==='rename'&&!row)throw Error('목록을 새로고침하세요.');
  dialog('<h2>'+label+' '+(operation==='create'?'추가':'이름 수정')+'</h2><label>'+label+' 이름<input id="catalog-name" maxlength="80" required value="'+esc(row?.name||'')+'" placeholder="'+(kind==='season'?'예: 시즌 3':'예: 소속 이름')+'"></label><p>시간이 지나도 같은 대상을 구분할 수 있는 이름을 입력하세요.</p>',()=>save('catalog',{action:operation,kind,...(row?{id:row.id,revision:row.revision}:{}),name:$('#catalog-name').value}));return;
 }
 if(!row)throw Error('목록을 새로고침하세요.');
 const impact='명부 '+row.roster_count+'건 · 시즌 소속 '+row.member_count+'건'+(kind==='organization'?' · 담당 관리자 '+row.manager_count+'명 · 서비스 '+row.service_count+'개':'');
 let title,description;
 switch(operation){
  case 'delete':title=label+' 삭제';description=kind==='season'?'목록에서 숨기고 명부와 이력을 보존합니다. 삭제된 항목에서 복구할 수 있습니다.':'목록에서 숨기고 해당 소속의 시즌 제한 서비스 및 담당 관리자 접근을 차단합니다. 연결 기록과 계정은 보존하며 삭제된 항목에서 복구할 수 있습니다. 공통 승인·전체 정지는 변경하지 않습니다.';break;
  case 'restore':title=label+' 복구';description=kind==='season'?'기존 이름과 준비·종료 상태로 복구합니다. 자동으로 시작하지 않습니다.':'기존 명부·담당 관리 권한·서비스 조건을 다시 사용할 수 있게 합니다. 전체 이용 정지는 해제하지 않습니다.';break;
  case 'end':title='시즌 종료';description='이 시즌의 소속을 시즌 제한 서비스 접근에 더 이상 사용하지 않습니다. 명부와 회원 ID는 보존합니다. 종료한 시즌은 조회하거나 삭제할 수 있습니다.';break;
  default:throw Error('지원하지 않는 관리 작업입니다.');
 }
 dialog('<h2>'+title+'</h2><h3>'+esc(row.name)+'</h3><p>'+esc(impact)+'</p><p>'+description+'</p>',()=>save('catalog',{action:operation,kind,id:row.id,revision:row.revision}));
}
`;
