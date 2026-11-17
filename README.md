# Access Kit

같은 맹의 여러 사이트가 **하나의 중앙 명부와 회원 자격**을 함께 사용하는 인증기와 SDK입니다. Google로 신원을 확인하고, 중앙 Access Kit이 가입 승인·정지·시즌·소속 조건으로 접근을 판단합니다. 사이트마다 Firebase나 명부를 새로 만들지 않습니다.

공개 SDK: [access-kit-sdk@0.3.1](https://www.npmjs.com/package/access-kit-sdk). [짧은 지시문으로 npm 설치·게이트를 검증한 결과](docs/qa/npm-short-prompt-20261117.md)를 확인할 수 있습니다.

## LLM에게 설치 맡기기

사이트 소스를 연 코딩 LLM에게 아래 지시문만 전달하세요. 자세한 설치 절차는 LLM이 안내 링크에서 읽습니다.

```text
아래 공식 안내를 읽고 이 사이트에 Access Kit을 설치해 주세요.
기존 기능과 중앙 명부의 접근 제한을 유지하고, npm 설치부터 빌드·익명 차단·허용 회원 입장·로그아웃까지 검증하세요.
서비스 연결 정보는 기존 설정이나 설치 스튜디오에서 확인하고, 사람이 필요한 로그인 단계만 요청하세요. 원격 배포는 별도 허락을 받으세요.

https://unpkg.com/access-kit-sdk@0.3.1/docs/LLM_INSTALLATION.md
```

안내 링크는 **공개 npm 패키지에 포함된 버전 고정 문서**입니다. GitHub 초대나 로그인 없이 읽으며, 중앙 서버를 배포하지 않아도 최신 SDK 설치 절차를 제공합니다. 중앙 인증 서버 주소와 서비스 ID는 운영자가 별도로 제공합니다.

처음 한 번 운영자에게 개발자 권한을 받고 [설치 스튜디오](https://ak-auth-trial-20261114.nakwol.workers.dev/developer/install)에서 서비스를 등록합니다. 필요한 연결 정보는 중앙 주소·서비스 ID·사이트 URL입니다. SDK 설치가 회원 승인이나 관리자 권한을 부여하지 않습니다. 상세 [LLM 안내](docs/LLM_INSTALLATION.md)에는 입력값·검증 기준·복구 절차가 있습니다.

## 직접 설치

Node.js 22 LTS 이상에서 공개 npm의 정확한 버전을 설치합니다. GitHub 초대나 소비자의 npm 로그인은 필요 없습니다.

```sh
npm install --save-exact access-kit-sdk@0.3.1
npx access-kit help
```

[설치](docs/INSTALL.md) · [Workers / Pages 시작](docs/QUICKSTART.md) · [기존 서버 어댑터](docs/ADAPTERS.md) · [업데이트·복구](docs/UPGRADE.md)

모든 보호 HTML·자산·API는 서버 게이트를 통과해야 합니다. Google 로그인 후 가입 신청은 **닉네임과 게임 CID 두 항목**만 받습니다. 관리자는 `/console#applications`에서 승인·거절하고, `/console`에서 명부와 시즌·소속을 관리합니다.

## 운영과 검증

- [운영 가이드](docs/OPERATIONS.md) · [관리자 콘솔](docs/CONSOLE.md) · [명부 CRUD](docs/ROSTER.md) · [SDK 게시](docs/PUBLISHING.md)
- [시험 소비 사이트](https://ak-atlas-trial-20261114.nakwol.workers.dev/) · [시험 관리자](https://ak-auth-trial-20261114.nakwol.workers.dev/console#applications) — 관리자 권한 필요
- [기존 호스팅 설치 시험](docs/qa/hosted-sdk-trial-20261114.md) · [가입 상태별 화면](docs/qa/onboarding-ui-20261114.md) · [CID 가입·승인](docs/qa/cid-signup-20261114.md) · [검증 기록](docs/VALIDATION.md)

기본 세션은 최초 로그인부터 최대 7일, 권한은 요청이 있을 때 기본 5분마다 재확인합니다. 로그아웃 전에 다른 실행 인스턴스로 복사한 쿠키는 남은 최대 5분까지 유효할 수 있습니다.

Cloudflare Workers + D1 Free를 기본 운영 후보로 삼으며 유료 선결제는 필요하지 않습니다. 다만 기존 실제 시험에서 중앙 `/authorize` CPU 최대 21ms가 관측돼 무료 요청당 10ms를 전부 충족했다고 판정하지 않습니다. [CPU 최적화](docs/qa/admin-cpu-20261114.md)와 [원격 측정 범위](docs/qa/hosted-sdk-trial-20261114.md)를 확인하세요. npm 게시·GitHub 소스 반영·중앙 서버 배포·운영 DB 변경은 서로 별개입니다.

원본 구성의 출처와 라이선스는 [NOTICE](NOTICE.md)에 남깁니다.
