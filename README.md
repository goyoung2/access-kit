# Access Kit

코딩 LLM에게 설치를 맡기려면 [공식 설치 지시문](docs/LLM_INSTALLATION.md)을 전달하세요. 중앙 인증기의 `/guide/llm`에서도 전체 지시문을 읽을 수 있으며 설치 스튜디오는 서비스 연결 정보를 포함해 복사합니다.

Google 로그인·회원 승인·서비스별 접근 권한을 연결하는 독립 인증기와 SDK입니다. 특정 맹이나 시즌에 고정되지 않습니다. 맹 명부는 기본 운영에 활용하되 서비스별로 승인 회원 전체 또는 시즌별 소속 조건을 선택합니다.

**서비스 개발자:** 공개 npm 패키지 `@goyoung2/access-kit`를 정확한 버전으로 설치합니다. GitHub 저장소 초대는 필요 없습니다. 인증 서버의 `/guide`와 패키지 README는 로그인 없이 읽고, `/developer/install`에서 서비스 등록부터 환경별 설치 명령까지 진행합니다. 중앙 서버 서비스 등록 권한은 운영자에게 별도로 받습니다.

```sh
npm install --save-exact @goyoung2/access-kit@0.3.1
npx access-kit help
```

위 경로는 게시 준비된 설치 방식입니다. 이 소스 수정만으로 npm 게시가 이루어지지는 않습니다. 실제 게시 버전은 `npm view @goyoung2/access-kit versions --json`으로 확인합니다.

**운영자:** [서버 운영 가이드](docs/OPERATIONS.md). Firebase Google 로그인을 사용하며 회원 명부·앱·세션은 독립 DB에서 관리합니다. 기존 인증 서버·Discord에 연결하지 않습니다. 공개 SDK 배포와 회원 명부·키·운영 권한은 분리합니다.

| 구성 | 경로 |
|---|---|
| Google 로그인·가입 신청 | `/auth/firebase` |
| 승인 명부·중복 UID·시즌 관리 | `/auth/firebase/admin` |
| 개발자 서비스 등록·설치 안내 | `/developer/install` |
| 공개 설치 안내 | `/guide` — 로그인·DB 접근 없음 |
| 브라우저 SDK | `/sdk/v0.3.1/access-kit.js` (기존 v0.1.0 URL 유지) |
| 서버 SDK·설치 CLI | `@goyoung2/access-kit` — 공개 npm 배포용 패키지 |

로그인은 최초 인증부터 7일. 서비스 권한은 요청이 있을 때 최대 5분 간격으로 재확인합니다. 서비스가 거절돼도 공통 로그인은 유지됩니다. 자동 갱신 polling은 없습니다.

```sh
npm ci
npm run db:migrate:local
npm run typecheck
npm test
npm run dev
```

로컬 주소: `https://localhost:8792`. `.dev.vars.example`을 `.dev.vars`로 복사하고 Firebase 웹 앱 설정을 입력하세요. 서비스 계정 개인키는 사용하지 않습니다.

배포 상태와 검증 범위는 [검증 기록](docs/VALIDATION.md)에 명시합니다. 인증 서버의 개발자 페이지와 회원 데이터는 별도 개발자/운영자 권한이 필요합니다. 개발 저장소의 공개 여부는 npm 패키지 공개와 별개입니다. 게시 절차는 [공개 패키지 게시](docs/PUBLISHING.md)를 따릅니다.

원본에서 재사용한 구성의 출처·라이선스는 [NOTICE](NOTICE.md)에 남깁니다.

## 0.2 설치 도구

[새 프로젝트 시작](docs/QUICKSTART.md) → [설치 안내](docs/INSTALL.md) → [업데이트·복구](docs/UPGRADE.md).
기존 서버/Pages middleware는 [어댑터 예제](docs/ADAPTERS.md)를 사용합니다.
개발자 초대·권한 관리는 `/developer/admin`, 초대 수락 후 설치는 `/developer/install`입니다.

## 0.3 운영 콘솔

회원·권한·시즌·서비스·로그인 디자인은 `/console`에서 관리합니다. [운영 안내](docs/CONSOLE.md)를 참고하세요. 일반 로그인에는 관리 메뉴가 없습니다. 기존 회원 ID와 정책을 보존하는 추가 마이그레이션만 사용합니다.

`명부` 메뉴는 로그인 전 회원도 직접 추가하거나 JSON/CSV/표 붙여넣기로 가져오고, 검색·수정·삭제·복구할 수 있습니다. [명부 관리](docs/ROSTER.md)를 참고하세요. `시즌 · 소속` 메뉴에서 이름을 직접 추가·수정하고 삭제·복구합니다. 시즌 이름과 준비 중/진행 중/종료 상태를 구분하며, 삭제해도 회원 ID와 이력을 보존합니다. 서버 적용에는 `0006_catalog.sql`까지 필요하며 SDK 설치나 소스 커밋만으로 운영 DB가 변경되지는 않습니다.
