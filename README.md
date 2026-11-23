# Access Kit

**Google 간편 로그인 + 닉네임·CID 명부 대조 + 서버 게이트**를 한 세트로 제공하는 인증 도구입니다. 창천 개발자는 기존 창천 인증 서버와 명부를 공유합니다. 다른 맹은 **자기 서버·DB·Firebase에서 명부와 가입자·CID 연결·회원 상태·관리자 권한을 독립 관리**하고, 같은 맹의 여러 사이트가 그 환경을 공유합니다. 게이트는 각 사이트 서버에 설치합니다.

공개 SDK: [access-kit-sdk@0.6.1](https://www.npmjs.com/package/access-kit-sdk). 독립 서버 설치 도구를 포함합니다. [기존 공개 npm 설치·게이트 검증](docs/qa/npm-short-prompt-20261117.md)과 [독립 운영 검증](docs/qa/independent-auth-20261118.md)을 확인할 수 있습니다.

## LLM에게 설치 맡기기

두 경로를 제공합니다. **공유 연결**은 기존 인증 서버에 사이트 SDK를 연결합니다. **독립 운영**은 자기 인증 서버·DB·관리자 페이지를 만든 뒤 사이트 SDK를 연결합니다. SDK 0.6.1에는 독립 서버 생성·검사·마이그레이션·첫 관리자 지정 도구와 서비스 개발자 역할이 포함됩니다. 두 방식 모두 공개 npm의 버전 고정 안내를 사용합니다.

공유 연결 — 창천 등 기존 명부 사용:

사이트 소스를 연 코딩 LLM에게 아래 지시문만 전달하세요. 자세한 설치 절차는 LLM이 안내 링크에서 읽습니다.

```text
아래 공식 안내를 읽고 이 사이트에 Access Kit을 설치해 주세요.
기존 기능과 중앙 명부의 접근 제한을 유지하고, npm 설치부터 빌드·익명 차단·허용 회원 입장·로그아웃까지 검증하세요.
서비스 연결 정보는 기존 설정이나 설치 스튜디오에서 확인하고, 사람이 필요한 로그인 단계만 요청하세요.

https://unpkg.com/access-kit-sdk@0.6.1/docs/LLM_INSTALLATION.md
```

안내 링크는 **공개 npm 패키지에 포함된 버전 고정 문서**입니다. GitHub 초대나 로그인 없이 읽으며, 중앙 서버를 배포하지 않아도 최신 SDK 설치 절차를 제공합니다. 중앙 인증 서버 주소와 서비스 ID는 운영자가 별도로 제공합니다.

독립 운영 — 자기 DB·명부·회원 관리:

```text
Access Kit으로 내 명부와 회원 정보를 내 서버·DB에서 독립 관리하도록 설치해 주세요.
아래 안내를 읽고 인증 서버·관리자 페이지·사이트 SDK를 연결한 뒤 가입 분류와 게이트를 검증하세요.
https://unpkg.com/access-kit-sdk@0.6.1/docs/LLM_INDEPENDENT.md
```

[독립 LLM 안내](docs/LLM_INDEPENDENT.md) · [독립 운영 절차](docs/INDEPENDENT_AUTH.md). 독립 운영도 공개 패키지의 안내 링크로 시작합니다. 자기 Firebase 프로젝트와 클라우드 계정은 운영자가 준비합니다.

창천 기본 명부에 CID가 있는 가입자는 별도 개발자 승인 없이 [설치 스튜디오](https://access-kit.nslg-hub.workers.dev/developer/install)에서 서비스를 등록합니다. 필요한 연결 정보는 중앙 주소·서비스 ID·사이트 URL입니다. SDK 설치가 회원 승인이나 관리자 권한을 부여하지 않습니다. 상세 [LLM 안내](docs/LLM_INSTALLATION.md)에는 입력값·검증 기준·복구 절차가 있습니다.

## 직접 설치

Node.js 22 LTS 이상에서 공개 npm의 정확한 버전을 설치합니다. GitHub 초대나 소비자의 npm 로그인은 필요 없습니다.

```sh
npm install --save-exact access-kit-sdk@0.6.1
npx access-kit help
```

[설치](docs/INSTALL.md) · [Workers / Pages 시작](docs/QUICKSTART.md) · [기존 서버 어댑터](docs/ADAPTERS.md) · [업데이트·복구](docs/UPGRADE.md)

모든 보호 HTML·자산·API는 서버 게이트를 통과해야 합니다. Google 로그인 후 **닉네임과 게임 CID 두 항목**으로 가입합니다. 진행 중인 시즌의 유효한 명부에 CID가 있으면 맹원, 없으면 방문자로 자동 가입하며 새 가입의 관리자 승인은 필요 없습니다. 닉네임은 자격 판정에 사용하지 않고, 명부와 다르면 `/console#members`에 관리자용 확인 표시를 보여줍니다. 명부는 `/console#roster`에서 관리합니다. 창천 기본 명부는 새 중앙 서버의 DB에서 관리합니다. 기존 서버를 업그레이드할 때는 `0011_permission_reservation_pagination.sql`까지 순서대로 적용하며 npm 설치만으로 원격 DB가 바뀌지 않습니다.

## 운영과 검증

- [회원 자동 서비스 등록·가입 전 권한 예약 0.6.0 검증](docs/qa/member-self-service-20261123.md) — 로컬 113개, 분리된 Cloudflare 검사 31개, 새 창천 서버에서 실제 콘솔 조작·시험 계정 가입/수락·사이트 입장과 권한 회수를 확인했습니다. 기존 창천 명부 198명과 기존 서버·데이터는 보존했습니다.

창천 기본 명부 회원은 개발자 승인 없이 자기 서비스를 등록하고 공동 관리자를 추가할 수 있습니다. 공유 원본 명부 조회·수정은 사용자님의 별도 서비스별 위임이 필요합니다. 가입 전 권한 지정은 콘솔 **관리자 · 권한 → 가입 전 권한 예약**에서 CID·역할을 선택하고 일회용 링크를 전달합니다. 수신자가 가입 후 링크를 수락해야 적용됩니다. [권한 예약과 공동 관리자 안내](docs/SERVICE_ADMINISTRATORS.md#가입-전-권한-지정).

- [서비스 공동 관리자](docs/SERVICE_ADMINISTRATORS.md): SDK 0.6.1의 서버 템플릿과 마이그레이션 0009에 포함됩니다. 콘솔에서 여러 관리자를 지정하고 연결 명부를 함께 관리하며, 중앙 공유 원본은 서비스별 명시적 위임으로 보호합니다.

- [공동 관리자 원격 배포·공개 npm 설치·호스팅 검증](docs/qa/coadmin-rollout-20261123.md) — 새 창천 서버 0.6.1에 반영했습니다. [팀 운영 시험 사이트](https://ak-team-trial-20261123.nslg-hub.workers.dev/)는 창천 명부를 공유하며 로그인 후 사용할 수 있습니다. 관리자 추가·해제, 다른 서비스 접근 차단, 기존 쿠키의 5분 재확인 후 차단을 검증했습니다.

- [새 창천 서버·명부 198명·실제 Google 가입과 게이트 검증](docs/qa/changcheon-deploy-20261123.md).

- [공유 연결·독립 운영의 짧은 LLM 설치 검증](docs/qa/independent-auth-20261118.md) — 102개 테스트와 두 새 프로젝트의 설치·게이트 검증. 실제 Google 로그인·원격 배포는 미실시.

[서비스별 개발자·명부](docs/SERVICE_ROSTERS.md)는 각 인증 환경 내부의 권한 분리입니다. 외부 맹을 창천 DB에 수용하는 방식으로 독립 운영을 대신하지 않습니다. 독립 환경의 관리자 권한·정지·가입·CID 연결은 창천에 영향을 주지 않습니다. 중앙 서버 마이그레이션과 새 SDK 기능 공개 배포는 별도입니다.

- [운영 가이드](docs/OPERATIONS.md) · [관리자 콘솔](docs/CONSOLE.md) · [명부 CRUD](docs/ROSTER.md) · [SDK 게시](docs/PUBLISHING.md)
- [창천 인증 서버](https://access-kit.nslg-hub.workers.dev/) · [관리자 페이지](https://access-kit.nslg-hub.workers.dev/console) · [회원 연결 시험 사이트](https://access-kit-check.nslg-hub.workers.dev/) — 기본 명부 198명, 관리자는 별도 권한 필요
- [기존 호스팅 설치 시험](docs/qa/hosted-sdk-trial-20261114.md) · [가입 상태별 화면](docs/qa/onboarding-ui-20261114.md) · [CID 가입·승인](docs/qa/cid-signup-20261114.md) · [검증 기록](docs/VALIDATION.md)

기본 세션은 최초 로그인부터 최대 7일, 권한은 요청이 있을 때 기본 5분마다 재확인합니다. 로그아웃 전에 다른 실행 인스턴스로 복사한 쿠키는 남은 최대 5분까지 유효할 수 있습니다.

Cloudflare Workers + D1 Free를 기본 운영 후보로 삼으며 유료 선결제는 필요하지 않습니다. 다만 기존 실제 시험에서 중앙 `/authorize` CPU 최대 21ms가 관측돼 무료 요청당 10ms를 전부 충족했다고 판정하지 않습니다. [CPU 최적화](docs/qa/admin-cpu-20261114.md)와 [원격 측정 범위](docs/qa/hosted-sdk-trial-20261114.md)를 확인하세요. npm 게시·GitHub 소스 반영·중앙 서버 배포·운영 DB 변경은 서로 별개입니다.

원본 구성의 출처와 라이선스는 [NOTICE](NOTICE.md)에 남깁니다.
