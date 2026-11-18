# 공유 연결·독립 운영 설치 검증

2026-11-18. 기준 commit `2aa62ab2c06f500245141d304f965105de0b0ebe`, 작업 브랜치 `codex/independent-auth-install`. [기계 판독 결과](independent-auth-20261118/proof.json).

## 구현

- 기존 창천 등 인증 환경에 연결하는 SDK 설치 경로를 유지했다. 명부·계정·CID·상태·권한은 선택한 인증 환경의 DB에 있다.
- 다른 맹은 `access-kit auth init`으로 자기 서버·DB 마이그레이션·관리자 페이지를 생성한다. Workers/D1 및 Firebase 설정은 그 운영자 소유이며 다른 맹의 데이터나 계정을 복사하지 않는다. 각 맹의 여러 사이트는 자기 인증 환경을 공유한다.
- `auth doctor`, 로컬 기본값인 `auth migrate`, 기존 Firebase 로그인 계정의 첫 관리자만 지정하는 `auth bootstrap`을 추가했다. 원격 작업은 `--remote`로 명시하며 이 검증에서는 사용하지 않았다. 첫 가입자를 자동 관리자로 만들지 않는다.
- 배포용 패키지에 현재 서버 실행본·0001–0008 스키마·해시 manifest·두 설치 안내를 포함했다. 원본 소스 트리, DB 파일, 실제 명부·회원 내보내기, 환경 비밀값은 포함하지 않는다. init은 기존 파일·서버를 덮어쓰지 않으며 doctor는 실행본 변경을 감지한다.
- `/guide/llm`은 기존 인증 환경 연결, `?mode=independent`는 독립 설치 안내를 제공한다. 독립 안내에는 그 안내를 제공한 호스트의 authOrigin/clientId를 자동 주입하지 않는다.

## 자동 검사

- `npm test`: **102/102 통과**, 실패·건너뜀 0 (`.wrangler/independent-auth-20261118/final-tests.log`).
- `npm run typecheck`: 통과.
- 패키지 검사는 Wrangler dry-run 빌드, tar 허용 경로, 서버 실행본·스키마 해시, 실제 npm 파일 설치와 SDK doctor를 포함해 통과했다. 32개 파일, 약 269KB tarball.
- SHA256: `607090b3a98d3e8a457fd4f155d46a19a8edd6753bbff3ffe0f60bad9ff66034`.
- 두 별도 D1 fixture에서 창천 서비스 둘의 명부 공유, 방주의 별도 CID 연결·회원/방문자 분류·명부 수정·정지, 다른 환경의 관리자 세션·게이트 쿠키·토큰 거부를 확인했다. 방주에서 창천 CID를 가입해도 창천 자격을 부여하지 않으며 다른 환경의 CID 연결을 예약하지 않는다. 방주 명부 변경 전후 창천 원본 행은 일치했다.
- 첫 관리자 설정은 프로젝트 불일치·로그인 이력 없는 UID·이미 관리자가 있는 경우 타 계정 승격을 거부했다.

## 짧은 지시문만 받은 새 LLM 설치

두 새 프로젝트에 실제 사이트·Worker·API를 두고, 짧은 지시문, GUIDE 문서, 연결 context 및 읽기 전용 시험 harness를 제공했다. 부모 저장소와 harness 수정은 금지했다. 공통 개발 tarball을 각 프로젝트에서 SHA256 확인 후 npm 설치했다. 실제 Google 로그인 대신 명시적으로 합성 계정·로컬 DB를 사용했다.

### 공유 연결

시험 폴더: `C:/Users/sepsd/AppData/Local/Temp/access-kit-llm-qa-1fjHIF/workers`.

새 LLM은 npm 설치 → 기존 빌드/테스트 → init plan/설치 → 빌드/테스트 → doctor → 통합 검증을 끝냈다. 익명 요청 16건과 14개 검증 흐름이 통과했다. 회원/타 소속 입장, HTML·파일·API 차단, API method/body·binding, export·scheduled 보존, 5분 lease 재사용·명부 제거/복구·정지 반영, 중앙 로그인 보존, 로그아웃 토큰·쿠키 거부를 확인했다.

실행 증거: `.access-kit/llm-local-verification.json`. 위 기계 판독 결과의 `shared`에 복사했다.

### 독립 운영

시험 폴더: `C:/Users/sepsd/AppData/Local/Temp/access-kit-independent-prompt-8U8h8m`.

새 LLM은 npm 설치 → own-auth 생성 → 로컬 8개 마이그레이션 → 인증 서버 dry-run → 합성 로그인 이력과 설치 CLI bootstrap → 생성된 서버 HTTP API로 명부·서비스 구성 → 기존 사이트 SDK 연결 → doctor → 통합 검증을 끝냈다. 실제 생성된 인증 Worker와 로컬 D1을 사용했다. 7개 흐름에서 회원/방문자 분류, 익명·방문자 차단, 실제 PKCE/토큰/게이트 세션, API 보존, 자체 명부 삭제/복구·정지·로그아웃을 확인했다. 기존 파일 해시도 보존됐다.

실행 증거: `.access-kit/independent-proof.json`, `installation-report.md`. 위 기계 판독 결과의 `independent`에 결과를 복사했다. 이 fixture 자체의 7개 흐름은 환경 간 격리나 7일/5분 시간 경계를 다루지 않으며, 격리는 별도 `auth-isolation.test.ts`, lease 회귀는 공유 설치와 기존 SDK 테스트로 확인했다.

## 실패 기록과 복구

첫 별도 CLI LLM 시험은 Windows unelevated sandbox에서 esbuild/workerd의 `spawn EPERM`으로 중단됐다. 설치 실패를 성공으로 계산하지 않았다. 동일 명령이 현재 실행 환경에서는 동작함을 확인한 뒤, 새 빈 fixture와 실제 프로세스 실행이 가능한 LLM 작업에서 처음부터 두 경로를 다시 시험했다. 초기 기록은 ignored `.wrangler/independent-auth-20261118/llm-{shared,independent}.log`에 보존했다.

독립 검증 harness의 Miniflare v4 영속 경로를 Wrangler와 같은 `resourcePersistencePath`로 맞추고, OAuth redirect를 수동 확인하며 token 요청에 실제 사이트 Origin을 전달하도록 수정했다. 인증·CORS 정책이나 검증 assertion을 완화하지 않았다. 기존 패키지 테스트의 허용 경로는 새 요구에 맞게 정확한 서버 실행본·manifest·스키마 경로만 추가했다.

## 적용 범위

로컬 개발본 검증이다. **실제 Google 로그인·신규 Firebase 설정·Cloudflare 원격 리소스 생성·원격 DB 변경·시험/운영 배포·npm 게시·GitHub push는 수행하지 않았다.** 공개 npm 0.3.1에는 새 독립 설치 기능이 아직 없다. 이 버전 번호의 로컬 tarball을 공개 게시본이라고 취급하지 않는다.

기존 창천 서버와 200명 명부는 수정하지 않았다. 실제 독립 운영 시에는 운영자 자신의 Firebase Google 공급자·승인 도메인·새 D1 UUID·실제 관리자 로그인·사이트 세션 비밀키와 별도 허용된 배포가 필요하다.
