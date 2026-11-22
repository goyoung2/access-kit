import {developerStyle} from './developer-style';

export function publicGuidePage(){return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access Kit · 설치 안내</title><style>${developerStyle}</style></head><body>
<header><strong>ACCESS KIT</strong><a href="/developer/install">서비스 등록 · 설치 스튜디오</a></header>
<main><aside aria-label="안내 목차"><p><a href="#install">설치</a></p><p><a href="#policy">입장 조건</a></p><p><a href="#adapters">기존 서버 연결</a></p><p><a href="#upgrade">업데이트 · 복구</a></p></aside><article>
<span class="tag">GOOGLE SIGN-IN / SDK / CLI</span><h1>내 사이트에 인증 연결하기</h1><p>Access Kit은 Google 로그인과 승인 회원 접근을 연결합니다. SDK 설치에는 GitHub 초대나 npm 로그인이 필요하지 않습니다. 이 안내도 로그인 없이 읽을 수 있습니다.</p>
<section id="llm"><h2>LLM에게 설치 맡기기</h2><p>프로젝트를 연 코딩 LLM에게 공식 지시문 전체를 전달하세요. 기존 연결 보존, 호스팅 조사, SDK 설치와 검증까지 안내합니다. 연결 정보가 없다면 LLM이 필요한 항목을 안내합니다.</p><p><a href="/guide/llm">공식 설치 지시문 전체 열기 ↗</a></p><button id="copy-llm" type="button">LLM 설치 지시문 복사</button><p id="copy-status" role="status" aria-live="polite"></p></section><section id="install"><h2>설치</h2><p>Node.js 22 LTS 이상을 준비하고 프로젝트 폴더에서 실행하세요. 아래 명령은 npm에 해당 버전이 게시된 뒤 사용할 수 있습니다. E404가 나오면 인증 서버 운영자에게 게시 버전을 확인하세요.</p><pre>npm view access-kit-sdk versions --json
npm install --save-exact access-kit-sdk@0.5.0
npx access-kit help</pre>
<p>인증 서버 운영자에게 서비스 등록 권한을 받은 뒤 <a href="/developer/install">설치 스튜디오</a>에서 사이트 주소와 입장 조건을 선택합니다. SDK 설치와 중앙 서버 사용 권한은 별개입니다.</p>
<pre>npm install --save-dev wrangler@4.160.1
npx wrangler login
npx access-kit init --client-id CLIENT_ID --auth-origin https://AUTH_HOST --site-url https://SITE_HOST/ --assets dist --plan</pre>
<p>스튜디오가 만든 실제 값으로 plan을 확인하고, 같은 명령에서 --plan을 빼고 실행합니다. Pages는 --hosting pages --branch 실제운영브랜치를 추가합니다.</p><pre>npx access-kit doctor
npx access-kit secret
npx access-kit deploy</pre><p>새 정적 사이트는 npm init -y 후 dist/index.html을 준비합니다. 기존 프로젝트는 원래 빌드 결과 폴더를 지정합니다. 이후 같은 소스를 설치할 때는 npm ci를 사용합니다.</p></section>
<section id="policy"><h2>입장 조건은 서비스별로 선택합니다</h2><ul><li><strong>승인 회원 전체:</strong> 특정 맹이나 진행 중인 시즌 소속으로 제한하지 않습니다.</li><li><strong>진행 중인 시즌 · 선택한 소속(맹):</strong> 명부를 사용하는 서비스의 선택 조건입니다.</li><li><strong>최고 관리자 전용:</strong> 운영자 전용 서비스를 보호합니다.</li></ul><p>특정 맹이나 기존 인증 서버가 SDK에 고정되어 있지 않습니다. Google 로그인만 완료했다고 회원 승인을 받는 것은 아닙니다. 기존 회원 ID·정지·서비스 제한은 유지합니다. 명부와 비밀키는 패키지에 포함하지 않습니다.</p></section>
<section id="adapters"><h2>기존 서버 연결</h2><p>Workers·Pages는 설치기가 기존 설정을 보존하며 게이트를 연결합니다. 다른 Fetch API 서버는 요청 처리기 앞에 다음과 같이 연결하세요.</p><pre>import {createGate} from 'access-kit-sdk/server';
const gate=createGate({clientId:'CLIENT_ID',authOrigin:'https://AUTH_HOST',siteUrl:'https://SITE_HOST/',accessPolicy:'member'});
return gate(request,{
  sessionSecret:env.ACCESS_KIT_SESSION_SECRET,
  serveAsset:(request,identity)=&gt;existingHandler(request,env,ctx,identity),
});</pre><p>32바이트 이상의 무작위 세션 키를 서버 환경변수에 보관합니다. HTML·API·이미지가 게이트를 우회하지 않게 연결해야 합니다. 수동 서버는 자신의 build/test/deploy 명령을 사용합니다.</p><p>설치된 패키지의 docs/ADAPTERS.md에 기존 Pages middleware와 서버 연결 예제가 있습니다. 경로는 node_modules/access-kit-sdk/docs/입니다.</p></section>
<section id="upgrade"><h2>업데이트 · 복구</h2><p>현재 package.json과 package-lock.json을 먼저 커밋합니다. 게시된 정확한 버전 X.Y.Z를 지정하세요.</p><pre>npx access-kit update --version X.Y.Z
npx access-kit deploy</pre><p>업데이트는 이전 의존성을 백업하고 새 패키지의 빌드·export·doctor를 새 프로세스에서 확인합니다. 실패하면 이전 의존성을 복구합니다. 설치 기록이 없는 수동 서버는 npm install --save-exact access-kit-sdk@X.Y.Z 후 자신의 빌드·테스트·배포를 실행합니다.</p><p>파일 설치도 update --package SDK.tgz --sha256 HASH로 유지합니다. 운영 배포 복구와 로컬 백업은 패키지 docs/UPGRADE.md를 참고하세요. 중앙 서버 업데이트·DB 마이그레이션은 SDK와 별도입니다.</p><p>로그아웃 상태의 HTML·API·이미지 차단, 승인 전후 입장, 실제 Google 로그인과 재접속을 확인하세요. 로그인은 최초 인증부터 최대 7일, 권한 변경은 요청 기반 기본 5분 주기로 확인합니다.</p></section>
<p><a href="https://www.npmjs.com/package/access-kit-sdk">npm 패키지 · 전체 README</a></p>
</article></main><script>document.querySelector('#copy-llm').onclick=async()=>{const status=document.querySelector('#copy-status');try{const response=await fetch('/guide/llm');if(!response.ok)throw Error('지시문을 불러오지 못했습니다.');const prompt=await response.text();await navigator.clipboard.writeText(prompt);status.textContent='복사했습니다. 프로젝트를 연 LLM에게 전달하세요.';}catch(error){status.textContent='전체 열기 링크에서 지시문을 직접 복사하세요.';}};</script></body></html>`;}
