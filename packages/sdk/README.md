# @goyoung2/access-kit

> **적용 상태 — 2026-11-14:** 0.3.1 개발본입니다. 공개 npm에서는 아직 조회되지 않으며, 소스 반영만으로 npm 게시·중앙 서버 배포·운영 DB 변경이 이루어지지 않습니다. 아래 공개 npm 설치 명령은 버전 게시 후 사용하는 예시입니다.

코딩 LLM에게 설치를 맡기려면 공식 설치 지시문 전체를 전달하세요. 중앙 인증기의 `/guide/llm`에서도 읽을 수 있으며 설치 스튜디오는 서비스 연결 정보를 포함해 복사합니다.

GitHub 소스에서는 [저장소의 설치 지시문](../../docs/LLM_INSTALLATION.md)을 읽을 수 있습니다. 패키지 설치 후에는 `node_modules/@goyoung2/access-kit/docs/LLM_INSTALLATION.md`를 사용합니다.

Google 로그인, 승인 회원 접근 게이트와 설치·관리 CLI입니다. 특정 맹이나 인증 서버에 고정되지 않으며 `authOrigin`으로 사용할 Access Kit 서버를 지정합니다.

## 설치

Node.js 22 LTS 이상을 준비하고 프로젝트 폴더에서 실행합니다. GitHub 저장소 초대나 npm 로그인은 필요 없습니다. 아래 명령은 해당 버전이 npm에 게시된 뒤 사용할 수 있습니다.

```sh
npm view @goyoung2/access-kit versions --json
npm install --save-exact @goyoung2/access-kit@0.3.1
npx access-kit help
```

SDK 설치와 중앙 인증 서버 사용 권한은 별개입니다. 운영자에게 서비스 등록 권한과 인증 서버 주소를 받고 `https://인증서버/developer/install`에서 Client ID·사이트 URL·입장 조건을 등록합니다. 로그인 없이 읽는 안내는 `https://인증서버/guide`입니다. 서비스별 설정과 회원 명부는 권한이 있는 사용자만 접근합니다.

## Workers / Pages

기존 프로젝트를 먼저 빌드하세요. 새 정적 사이트라면 `npm init -y` 후 `dist/index.html`을 준비합니다. 아래 예시의 ID·주소·빌드 폴더를 실제 값으로 바꿉니다.

```sh
npm install --save-dev wrangler@4.160.1
npx wrangler login
npx access-kit init --client-id CLIENT_ID --auth-origin https://AUTH_HOST --site-url https://SITE_HOST/ --assets dist --plan
```

plan을 검토한 후 같은 명령에서 `--plan`을 빼고 실행합니다. Pages는 `--hosting pages --branch 실제운영브랜치`를 추가합니다. 기존 설정·Worker API·바인딩은 보존하며, 충돌하는 middleware나 advanced Worker를 자동 덮어쓰지 않습니다.

```sh
npx access-kit doctor
npx access-kit secret
npx access-kit deploy
```

배포 후 익명 HTML·API·이미지 차단, Google 로그인, 승인 전 차단·승인 후 입장과 재접속을 확인합니다. `init`이나 `doctor` 성공만으로 운영 보호가 완료된 것은 아닙니다. 기존 세션 키는 유지합니다.

## 다른 Fetch API 서버

```js
import {createGate} from '@goyoung2/access-kit/server';
const gate=createGate({
  clientId:'APP_ID',authOrigin:'https://AUTH_HOST',
  siteUrl:'https://SITE_HOST/',accessPolicy:'member',
});
return gate(request,{
  sessionSecret:env.ACCESS_KIT_SESSION_SECRET,
  serveAsset:(request,identity)=>existingHandler(request,env,ctx,identity),
});
```

32바이트 이상의 무작위 세션 키는 서버 환경변수에 보관합니다. 모든 보호 HTML·API·정적 자산 요청이 게이트를 거치도록 호스팅을 설정하세요. 브라우저 SDK만 추가해서는 파일 접근을 보호할 수 없습니다. 수동 서버는 자신의 build/test/deploy 명령을 사용합니다.

## 입장 정책

중앙 서버에서 승인 회원 전체 / 진행 중인 시즌의 지정 소속 / 최고 관리자 전용을 서비스별로 선택합니다. SDK의 기본 `member`는 중앙에서 해당 서비스의 조건을 확인하며, 특정 맹을 고정하지 않습니다. 로컬 `admin` 게이트는 중앙 서비스 허용과 운영자 여부를 모두 요구합니다.

Google 로그인만으로 회원 승인이 부여되지는 않습니다. 공개 SDK를 설치해도 다른 운영자의 명부·관리 권한을 얻지 않습니다. 기존 회원 ID와 이용 제한을 유지합니다.

기본 세션은 최초 중앙 로그인부터 최대 7일입니다. 권한은 요청이 들어올 때 기본 5분 lease 만료 후 다시 확인합니다. 브라우저 polling이나 새로고침에 의한 세션 연장은 없습니다.

## 무료 플랜 운영

중앙 Access Kit은 Cloudflare Workers + D1 Free를 기본 운영 후보로 사용합니다. 개발자는 제공된 중앙 명부에 연결하며 유료 선결제나 별도 Firebase·명부 생성이 필요하지 않습니다. 중앙 Worker의 무료 기준은 계정당 하루 100,000요청·요청당 CPU 10ms입니다. 소비 사이트의 보호 파일·API 요청도 해당 사이트의 호스팅 한도에 포함되며, 같은 Cloudflare 계정이면 한도를 공유합니다. `init --plan`은 설치 변경 미리보기이며 요금제 선택이 아닙니다.

권한이 유효한 동안 파일마다 중앙 인증을 호출하지 않고 5분 만료 후 실제 요청에서 재확인합니다. 중앙 관리자 경로의 로컬 108명 CPU 평균 3.91~7.29ms는 실제 Cloudflare 요청별 한도 검증을 대신하지 않습니다. 기존 권한·세션 키·정지 정책을 보존하고, 한도 문제를 이유로 허가 없이 유료 전환이나 정책 완화를 하지 않습니다.

로그아웃은 같은 사이트의 `POST /__accesskit/logout` 후 로그인 화면이나 루트로 이동합니다. 현재 브라우저의 사이트 쿠키를 삭제하고 자동 재진입을 억제합니다. `X-Access-Kit-Revoke: failed`는 중앙 토큰 회수를 확인하지 못했다는 뜻입니다. 회수 확인 후에도 다른 런타임에 복사된 쿠키는 기존 lease의 남은 기간까지 유효할 수 있습니다.

## 업데이트

먼저 현재 소스·package.json·package-lock.json을 커밋하고 게시된 정확한 버전으로 업데이트합니다. `X.Y.Z`를 원하는 버전으로 바꿉니다.

```sh
npx access-kit update --version X.Y.Z
npx access-kit deploy
```

업데이트는 의존성을 백업하고 정확한 버전을 설치한 뒤 기존 빌드와 새 프로세스의 export·doctor를 검사합니다. 실패하면 이전 package/lock과 의존성을 복구합니다. 설정·Client ID·세션 키·회원 제한은 유지합니다. 새 런타임 배포는 업데이트가 끝난 다음 명령으로 실행합니다. `latest`·버전 범위는 받지 않습니다.

설치 기록이 없는 수동 서버는 `npm install --save-exact @goyoung2/access-kit@X.Y.Z` 후 기존 build/test/deploy를 사용합니다. 실패하면 이전 package/lock을 복원하고 `npm ci`를 실행합니다.

기존 파일 설치도 `npx access-kit update --package SDK.tgz --sha256 HASH`로 지원합니다. 인증 서버·DB 업데이트는 별도이며 명부 CRUD가 포함된 현재 중앙 서버에는 migration 0006까지 소비 SDK보다 먼저 적용합니다. `package-lock.json`을 보관하고 재설치에는 `npm ci`를 사용합니다.

## 함께 제공하는 문서

설치된 패키지의 `node_modules/@goyoung2/access-kit/docs/`에서 INSTALL.md, QUICKSTART.md, ADAPTERS.md, UPGRADE.md, CONSOLE.md, ROSTER.md를 읽을 수 있습니다. 비공개 개발 저장소 접근이 없어도 설치·업데이트 안내를 사용할 수 있습니다. 회원 명부·개인키·운영 환경설정은 배포 패키지에 포함하지 않습니다.
