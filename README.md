# Access Kit

초대된 개발자를 위한 공통 Google 인증·회원 승인·시즌 자격 플랫폼.

**서비스 개발자:** [설치 가이드](docs/INSTALL.md)를 따라 비공개 릴리스의 SDK를 설치하세요. 인증 서버 운영자에게 `/developer/install` 주소와 개발자 권한을 받으면 서비스 등록부터 설치 명령까지 한 페이지에서 진행합니다.

**운영자:** [서버 운영 가이드](docs/OPERATIONS.md). Firebase Google 로그인을 사용하며 회원 명부·앱·세션은 독립 DB에서 관리합니다. 기존 인증 서버·Discord·공개 npm 패키지에 연결하지 않습니다.

| 구성 | 경로 |
|---|---|
| Google 로그인·가입 신청 | `/auth/firebase` |
| 승인 명부·중복 UID·시즌 관리 | `/auth/firebase/admin` |
| 개발자 서비스 등록·설치 안내 | `/developer/install` |
| 브라우저 SDK | `/sdk/v0.1.0/access-kit.js` |
| 서버 SDK·설치 CLI | `@goyoung2/access-kit` — 비공개 Releases tarball |

로그인은 최초 인증부터 7일. 서비스 권한은 요청이 있을 때 최대 5분 간격으로 재확인합니다. 서비스가 거절돼도 공통 로그인은 유지됩니다. 자동 갱신 polling은 없습니다.

```sh
npm ci
npm run db:migrate:local
npm run typecheck
npm test
npm run dev
```

로컬 주소: `https://localhost:8792`. `.dev.vars.example`을 `.dev.vars`로 복사하고 Firebase 웹 앱 설정을 입력하세요. 서비스 계정 개인키는 사용하지 않습니다.

배포 상태와 검증 범위는 [검증 기록](docs/VALIDATION.md)에 명시합니다. 릴리스 파일은 GitHub 저장소 권한으로 접근합니다. 인증 서버의 개발자 페이지는 별도 개발자/운영자 권한이 필요합니다.

원본에서 재사용한 구성의 출처·라이선스는 [NOTICE](NOTICE.md)에 남깁니다.

## 0.2 설치 도구

[새 프로젝트 시작](docs/QUICKSTART.md) → [설치 안내](docs/INSTALL.md) → [업데이트·복구](docs/UPGRADE.md).
기존 서버/Pages middleware는 [어댑터 예제](docs/ADAPTERS.md)를 사용합니다.
개발자 초대·권한 관리는 `/developer/admin`, 초대 수락 후 설치는 `/developer/install`입니다.
