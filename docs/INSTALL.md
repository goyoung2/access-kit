# 서비스 개발자 설치

## 1. 접근 준비

1. `goyoung2/access-kit` 비공개 저장소 초대를 수락합니다.
2. 인증 서버 운영자에게 서버 주소와 개발자 권한을 받습니다.
3. `<인증 서버>/developer/install`에서 Google 로그인합니다.
4. 서비스 이름, HTTPS 루트 주소, 입장 조건을 저장합니다. 승인 회원 공통 또는 현재 시즌의 특정 맹을 선택합니다. 사이트의 주소가 바뀌면 기존 서비스를 선택해 수정하세요.

## 2. 고정 버전 설치

프로젝트 폴더에서 실행합니다. 토큰은 명령이나 설정 파일에 적지 않습니다.

```sh
gh auth login
gh release download v0.1.0 --repo goyoung2/access-kit --pattern access-kit-sdk-0.1.0.tgz
npm install ./access-kit-sdk-0.1.0.tgz
```

tarball은 프로젝트의 `vendor/` 같은 경로로 옮겨 고정하고 package-lock.json을 함께 커밋할 수 있습니다. CI도 저장소 접근 권한으로 릴리스를 받거나 승인된 프로젝트에 포함한 tarball을 사용합니다. 공개 npm 검색에 패키지를 게시하지 않습니다.

## 3. Workers 정적 사이트

먼저 기존 프로젝트의 build를 실행하세요. 생성된 `dist/index.html`이 있어야 합니다. 아래 값은 개발자 페이지의 복사 버튼으로 받습니다.

```sh
npx access-kit init --client-id APP_ID --auth-origin https://AUTH_HOST --site-url https://SITE_HOST/ --assets dist
npx access-kit doctor
npx wrangler secret put ACCESS_KIT_SESSION_SECRET --config wrangler.access-kit.json
npx wrangler deploy --config wrangler.access-kit.json
npx access-kit verify --url https://SITE_HOST/
```

세션 비밀키는 32자 이상 무작위 값입니다. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`로 로컬 생성하고 Secret 입력란에 넣습니다. Git에는 넣지 않습니다.

설치기는 `access-kit.json`, `access-kit.worker.mjs`, `wrangler.access-kit.json`을 생성합니다. 기존 설정·스크립트를 덮어쓰지 않으며 기존 파일이 있으면 중단하고 파일명을 알려줍니다. 모든 정적 요청이 게이트를 먼저 통과합니다.

## 4. 기존 서버에 직접 연결

```js
import {createGate} from '@goyoung2/access-kit/server';
const gate=createGate({
  clientId:'APP_ID',authOrigin:'https://AUTH_HOST',
  siteUrl:'https://SITE_HOST/',accessPolicy:'member'
});
export default {fetch(request,env){
  return gate(request,{
    sessionSecret:env.ACCESS_KIT_SESSION_SECRET,
    serveAsset:(request,identity)=>env.ASSETS.fetch(request)
  });
}};
```

`identity.id`는 서버가 검증한 공통 회원 ID입니다. 기존 사용자별 설정 키를 유지할 때 사용합니다. 브라우저가 보낸 닉네임이나 UID를 서버 신원으로 사용하지 마세요. `identity.displayName`, `identity.membershipAdmin`도 제공합니다. 회원 관리 권한과 서비스 내부 운영 권한은 별도로 판단하세요.

Node/Vercel 같은 호스트는 요청을 표준 `Request`로 변환하고 위 반환값 `Response`를 전달합니다. 보호할 페이지·JSON·파일 모두 같은 핸들러를 통과시켜야 합니다. Workers 외 호스팅 자동 생성기는 이번 버전에 포함하지 않습니다.

## 5. 로그인과 검증

SDK가 로그인 화면, PKCE 교환, 암호화 HttpOnly 쿠키를 처리합니다. 익명은 401, 권한 없음은 403, 인증 서버 연결 실패는 503입니다. 승인 전 사용자, 정지 회원, 다른 시즌 회원을 각각 확인하세요. `verify`는 익명 차단을 검사하며 실제 로그인 성공까지 대신 검사하지 않습니다.

기본값은 7일 세션·5분 권한 lease입니다. 7일은 중앙 로그인 시각부터 계산하며 재접속으로 연장하지 않습니다. 새로고침은 lease 안에서 중앙 인증 요청을 만들지 않습니다. 회원 정지나 시즌 변경은 다음 권한 재확인에 반영됩니다.

## 업데이트·복구

새 릴리스 tarball을 설치하고 `npm ci`, 기존 프로젝트 build, `access-kit doctor`, 테스트 환경 `access-kit verify` 및 실제 로그인을 확인합니다. `createGate`를 import하므로 설치된 패키지 버전이 실행 버전입니다. 연결 설정과 App ID는 유지합니다. 생성기를 다시 실행할 필요가 없습니다.

복구는 이전 package.json/package-lock.json과 tarball을 사용한 검증된 커밋을 다시 배포합니다. 회원 DB를 롤백하지 않습니다. 마이그레이션이 있는 릴리스는 해당 릴리스의 별도 절차를 먼저 확인합니다.
