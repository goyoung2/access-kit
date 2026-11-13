# 0.1.0 검증

2026-11-12 로컬 독립 서버 `https://localhost:8792`, 전보 사이트 `https://localhost:8793`.

- 실제 Google 로그인 후 중앙 운영자 계정으로 개발자 설치 페이지 진입.
- 개발자 페이지에서 서비스 등록, 현재 시즌·맹 정책 설정, 설치 명령 생성.
- 새 SDK의 PKCE 교환 후 전보 HTML과 `/api/auth/me` 200. 기존 내부 회원 ID 유지.
- 브라우저 재접속 3회 HTML 응답 13/13/21ms. 해당 구간 브라우저의 중앙 인증 요청 0. Secure/HttpOnly 세션 만료 약 7일.
- 실제 7일을 기다리지 않았으며 고정 만료와 lease 경계는 자동 테스트로 검사.
- 실제 새 시즌(등록 0명)으로 전환하고 기존 서비스 쿠키의 lease가 지난 뒤 403 확인. 소속 저장 후 Google 계정 재선택 없이 전보 사이트와 `/api/auth/me` 200 복구.
- 자동 테스트 12/12, TypeScript 검사 통과. 독립 임시 프로젝트에서 릴리스 tarball 설치 → init → doctor → 생성 어댑터 import 확인.
- 개발자 페이지 데스크톱 1440px 및 모바일 390px 확인. 모바일 가로 넘침 없음.
- 자동 검증: 승인 전 차단, 승인·정지, 중복 UID와 동시 승인, 기존 ID 연결 제한, 시즌 전환·이력 보존, CSRF·개발자 소유권·등록 callback·PKCE, 설치기 덮어쓰기 거부 및 외부 경로 거부.
- 로컬 이관: 회원 2명, Google 연결 2개, 승인 명부 2건. 세션·토큰 복사 0. 원본 DB 쓰기 0.

전보 통계용 R2 데이터는 새 로컬 작업 사본에 없으므로 전투 통계 로딩은 503이다. 이 검증은 인증 통합 범위이며 전투 통계 화면 전체 정상 판정은 하지 않았다.

배포 범위: 비공개 GitHub 소스와 SDK 릴리스. 운영 인증 서버와 운영 전보 사이트 전환은 별도다.

## 0.2.0 실제 검증 — 2026-11-12

- 독립 검증 인증기와 새 D1: `https://access-kit-validation-20261112.nakwol.workers.dev`. 기존 운영 인증기와 전보 사이트는 전환하지 않았습니다.
- 실제 Google 로그인 → 개발자 설치 스튜디오에서 서비스 등록 → tarball 설치 → CLI init/doctor/secret/deploy 실행.
- 새 Workers 사이트: `https://ak-fresh-20261112.nakwol.workers.dev`. 미승인 계정은 중앙에서 거절. 관리자 화면에서 가입 신청 승인 후 사이트 세션 204, 보호 HTML 200. 재접속 3회 105/70/82ms. Secure/HttpOnly 쿠키 남은 수명 604308초(중앙 최초 로그인 기준).
- 기존 API 프로젝트: `https://ak-existing-20261112.nakwol.workers.dev`. 기존 original.mjs와 Wrangler 설정 보존. 인증 후 GET API 200, POST API 200, 원래 환경변수 original-binding과 POST 본문 그대로 유지. scheduled/named exports/바인딩/경로 보존은 설치 회귀 테스트로 확인.
- Pages: `https://ak-pages-20261112.pages.dev`. 실제 Functions 배포 및 Google SSO 후 HTML/JSON 200. 익명 전체 자산 12개 요청(GET/HEAD/Range/잘못된 쿠키) 차단 확인.
- Workers 새 사이트 보호 검사 16개 요청 통과. 기존 API 프로젝트 보호 검사 및 실제 API 동작 별도 확인.
- 개발자 관리 화면에서 초대 링크 생성 → 실제 수락 → 설치 페이지 진입. 사용 완료 링크 재사용·권한 해제·비운영자 차단은 자동 테스트로 확인.
- SDK update: SHA256 확인, package/lock 백업, 새 tarball 설치, doctor, 재배포와 버전 검사 통과. 기존 쿠키로 재접속 유지 확인.
- 모바일 390px에서 가로 넘침 없음. 단계별 환경 입력, 명령 생성, 초대 화면을 실제 브라우저로 확인.
- 전보 사이트 SDK를 v0.1에서 v0.2로 교체한 뒤 기존 사용자 ID/설정/지휘 권한·정지·시즌 회귀 17개 통과. 통계 R2 화면 전체는 이 작업의 검증 범위에 포함하지 않았습니다.

### 실행 중 발견하여 수정한 문제

1. 새 Worker가 없을 때 secret list가 실패하던 문제: 존재하지 않는 Worker 응답만 구분해 secret put의 새 Worker 생성 흐름으로 연결. 다른 API 실패는 그대로 보고.
2. 같은 계정 Worker 간 AUTH fetch가 404로 반환되어 세션 발급이 503이던 문제: 필요한 global_fetch_strictly_public 설정 추가. 수정 뒤 실제 로그인 성공. private-origin fetch 의존 프로젝트는 문서의 service binding adapter 사용.
3. 신규 배포의 경로 전파 중 일시 404/522: 운영자 deploy에서 반영 확인을 기다림. 최초 Pages 전체 검사에는 일부 522가 기록되었고, 이후 verify 재실행 12/12 통과. 실패 기록을 성공으로 덮어 해석하지 않음.

### 최종 검증

- 전체 자동 테스트 19/19, TypeScript 검사 통과. SDK SHA256: bf536bcab1545c58f706b770ee052b0be9531e22a770a2574d1dc509bf1842b0.
- 기존 API 프로젝트 익명 보호 검사: API 포함 4개 경로 × 4개 요청 방식 = 16/16 통과.
- 손상된 tarball에 올바른 파일 해시를 지정한 설치 실패도 재현: TAR_BAD_ARCHIVE 이후 이전 package.json/lockfile 복원 및 npm ci, doctor 정상. 백업은 검증 프로젝트 .access-kit/backups에 보존.
- 업데이트 후 기존 브라우저 세션 재접속 HTML 200 확인.

## 0.3 콘솔·로그인 검증 — 2026-11-12

- 별도 브랜치 feat/admin-console. 기존 회원 1명, Google 연결1개, 공통 승인1건, 게임 계정1건, 서비스 정책3건을 마이그레이션 전 SQL 백업과 후속 쿼리로 필드별 비교: 모두 일치. 테스트 계정2개는 별도로 추가.
- 신규 콘솔8화면 및 로그인 디자인 설정. 모바일390px 전 화면 가로 넘침 없음. 실제 화면: E:/Codex/access-kit-review-20261112/console-v03-desktop.png, login-v03.png, branding-v03.png, console-v03-mobile.png.
- 실제 화면으로 테스트 담당자 최고 관리자 부여 → 해당 테스트 세션으로 콘솔 입장 → 화면에서 회수 → 같은 세션 console/data403.
- 회원 관리자 부여 시 담당 맹과4개 관리 메뉴만 표시, 최고 관리자 승격 요청403. 테스트 종료 후 권한 회수.
- 테스트 신청자를 화면에서 승인 →3개 서비스 접근 가능 → 화면에서 정지 →3개 서비스 차단. 실제 데모 접속에서도 정지 안내, 보호 콘텐츠0 확인. 정지 해제 후 인증 코드 교환을 거쳐 데모 입장 성공. 테스트 종료 후 해당 가상 회원은 정지 상태로 보존.
- 위 두 테스트 계정은 역할/승인 검증용으로 별도 생성한 계정과 세션이며 새 Google 로그인을 수행한 사람의 계정이 아닙니다. 기존 사용자 Google 계정/세션/승인은 유지했습니다.
- 비로그인 신규 브라우저가 데모에 접속하면 중앙 로그인으로 바로 이동. 콘솔에서 저장한 멤버 라운지 이름·안내 표시. 관리 링크0 확인. 일반 로그인과 콘솔 로그인 분리.
- SDK0.3 배포 후 익명 자산 보호16/16 통과. 세션7일 및 기본5분 권한 재확인 동작은 기존 회귀 검사로 보존.
- 실제 운영 전보 서버는 변경하지 않았습니다. 임시 인증기 및 임시 데모에서 검증했습니다.

## 공개 npm 설치 준비 — 2026-11-13

브랜치 `codex/public-npm-install`, 기준 `67c18a264c2556e0e8517241f270993b6fec625d`. 비공개 GitHub 초대·릴리스 다운로드 대신 공개 npm 패키지를 기본 설치 경로로 준비했습니다. SDK 0.3.1은 아직 게시하지 않은 버전이며 이번 작업에서 원격 push·릴리스·npm 게시·DB 마이그레이션·원격 배포를 수행하지 않았습니다.

- TypeScript 검사와 전체 `npm test` **43/43 통과**. 회원 ID 보존, 정지·시즌 정책, 마지막 관리자, Google 연결, Pages 우회 차단의 기존 회귀를 함께 확인했습니다.
- 실제 npm을 격리 HTTP 레지스트리에 연결해 `update --version 0.3.10`의 정확한 버전 저장·새 프로세스 검사와 손상된 0.3.11 설치 후 package/lock·의존성 복원을 확인했습니다. latest·범위·추가 명령 문자열·파일 옵션 혼합은 거부했습니다. 기존 tarball hash 검증·복구도 통과했습니다.
- 독립 검토 후 번들 `CONSOLE.md` 링크와 Trusted Publisher의 `Allow npm publish`·2일 조건 안내를 보완했습니다. 최종 배포 파일 검사 **1/1 재통과**: 파일 허용 목록·필수 문서·공개 registry 설정 확인, 최종 tarball을 빈 프로젝트에 실제 설치 → init → doctor 성공.
- 최종 파일: `dist/access-kit-sdk-0.3.1.tgz`, SHA256 `e13dc96ce8c7ddc7942ef33c1b78bef04b39ff2013c030a1145b76252cf0cf55`. 인계 문서의 이전 로컬 tarball과 소스 구성이 달라 해시도 다릅니다. 기존 브라우저 SDK URL과 바이트는 변경하지 않았습니다.
- 실제 로컬 Wrangler: 신규 격리 상태에서 `/guide` GET·HEAD 200, 익명 `/developer/services` 403. 단위 검사에서는 Firebase 설정·DB 없이도 안내 200이며, 서비스 API 권한 검사는 유지됩니다.
- Chromium 브라우저: 실제 `/guide`와 현재 설치 페이지 HTML·가상 서비스 API로 Workers/Pages/수동 서버 명령 생성 확인. npm 정확한 버전 설치, 기존 Pages의 branch 보존·프로젝트 재생성 없음, 수동 서버의 자동 배포 메뉴 숨김 확인. 1440px·390px 안내 및 390px 설치 화면에 가로 넘침 없음. 실제 Google 계정 로그인·운영 회원 데이터는 사용하지 않았습니다.
- 화면 근거: `C:/Users/sepsd/AppData/Local/Temp/access-kit-public-npm-qa/`의 `guide-desktop.png`, `guide-mobile.png`, `studio-pages-mobile.png`, `studio-server-desktop.png`.
- npm 게시 workflow는 수동 실행 전용이며 버전과 일치하는 태그를 요구합니다. 실제 npm scope 권한·Trusted Publisher 설정·GitHub Actions 게시 실행은 아직 확인하지 않았습니다. 중앙 서버와 소비 사이트의 실제 반영도 별도입니다.
