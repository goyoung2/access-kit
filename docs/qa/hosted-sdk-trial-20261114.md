# 실제 호스팅에서 공식 LLM 지시문으로 SDK 설치 시험

2026-11-14. SDK/중앙 서버 소스 기준 `1b7fbcc50b1b32df19e225293ce4424c85acf154`.

## 판정과 시험 주소

**공식 지시문과 연결 정보만 받은 새 LLM의 소비 사이트 설치·재배포 및 서버 게이트는 통과했습니다.** 공개 npm 설치 시험과 실제 Google 계정 로그인 완료는 별도입니다. npm 미게시 상태이므로 SHA256을 제공한 공식 개발 tarball을 사용했습니다.

- 소비 사이트: https://ak-atlas-trial-20261114.nakwol.workers.dev/
- 시험 중앙 서버: https://ak-auth-trial-20261114.nakwol.workers.dev/
- 중앙 서버 Worker version: `1e52b7e6-3dc1-4181-9cb1-05c36bf5a5ef`.
- 소비 사이트 설치 전 version: `001b495e-5301-4624-8959-1af1c4b292da`.
- 설치 후 version: `43670d0c-fc09-462a-bcff-3116bb72c342`.
- SDK deployment marker: `3c8548c12a1ba819cdb61305c8dc3849`.

새 Worker 2개와 시험 전용 D1 `ak-trial-20261114`만 사용했습니다. 이 D1에만 migrations 0001–0006과 합성 명부를 넣었습니다. 운영 인증 서버·운영 DB·기존 QA 포트·실제 108명 명부는 변경하지 않았습니다. npm 게시·GitHub push·요금제 변경도 하지 않았습니다.

## 조건과 LLM 설치 경계

Atlas는 원본 절차 이미지 JPEG 36장(11,050,322 bytes), 합성 관측 18,000건 JSON(3,699,216 bytes), JS 모듈 6개, CSS, 기존 `/api/summary`와 POST `/api/echo`를 가진 정적 아카이브입니다. 무한 계산이나 무제한 요청은 넣지 않았습니다.

설치 전 실제 브라우저는 리소스 47개, decoded resource 14,758,526 bytes를 읽었습니다. 37개 img 요소가 36개 고유 이미지를 사용합니다. 분류·검색·다운로드와 모바일 화면을 설치 전후 비교했습니다.

부모가 페이지 제작·첫 호스팅·시험 중앙 서버 구성·서비스 등록을 완료한 뒤, 사전 대화가 없는 LLM에게 `docs/LLM_INSTALLATION.md` 공식 블록과 typed context만 전달했습니다. 설치 중 추가 구현 힌트는 주지 않았습니다. `authOrigin`, `clientId=atlas-trial`, `siteUrl`, `hosting=workers`, `assets=dist`, `accessPolicy=member`, 개발 tarball 경로·SHA256, 소비 사이트 경로, 명시적 임시 사이트 배포 허가가 입력입니다. 중앙 서버를 새로 만드는 작업은 소비 사이트 설치에 포함시키지 않았습니다.

SDK `0.3.1` tarball SHA256:
`5d697230c0af6cb2a86a60a8fca269a53eab85d7098220e1cb18831e1c31a6e2`.

소비 사이트는 별도 Git 저장소입니다.

- branch `codex/hosted-trial`.
- baseline `c6b3684`.
- 실제 설치 commit `b036cd5174b60252735273a0b7c635a16fa874f7`.
- 설치 보고서 포함 HEAD `81a271e1b2ef82025e72b361af7c8d927e94d21d`.
- 원본 Worker, 원본 Wrangler 설정, public 자산, 기존 빌드 및 테스트는 diff 0.
- 자동 생성 wrapper와 별도 배포 설정을 연결하고, 배포 스크립트도 공식 보호 배포로 변경했습니다.
- `run_worker_first:true`, `preview_urls:false`, 고정 origin 검사, 기본 5분 권한 lease·7일 세션·member 정책을 유지했습니다.
- 새 LLM 자체 검사: build/doctor 및 테스트 3/3, 배포 후 47경로×4변형=188건, API 포함 48경로×4변형=192건 통과.
- 별도 읽기 전용 리뷰: 원본 보존과 실제 생성 파일·SDK·검사 영수증을 대조, 수정할 결함 없음.

## 부모의 독립 원격 검증

실제 호스팅된 중앙 Hono/D1와 설치된 게이트를 대상으로 87개 항목을 검사했습니다. Google 신원 확인 단계는 합성 중앙 세션을 사전 등록해 분리했습니다. `/authorize` → 실제 코드 발행 → PKCE `/token` → `/me` → SDK 세션 발급은 실제 원격 경로입니다. 인증 응답 mock으로 원격 성공을 대신하지 않았습니다.

- HTML·JS·CSS·JSON·이미지·API와 인코딩/정규화/쿼리 변형 14경로의 GET/HEAD/Range/잘못된 쿠키, 총 56건에서 401/403 및 보호 본문 0 bytes.
- 다른 소속·정지 회원·미승인 회원의 SDK 세션 발급 403.
- 허용 회원은 원본 HTML·이미지·전체 18,000건 JSON·API 200.
- 실제 POST method/body/환경 바인딩 보존, HttpOnly/Secure/SameSite=Lax 쿠키 확인.
- 사용된 authorization code 재사용 400.
- 보호 응답은 private 및 no-cache/no-store. 이미 로그인해 읽은 데이터의 사후 회수는 이 시스템의 기능이 아닙니다.
- 이미지 36개를 병렬 요청하는 배치를 3회, 108건/33,150,966 bytes 전부 200.
- 명부 제외 직후 기존 lease 요청 200, **실제 경과 302,394ms 뒤 403**, 명부 복구 후 200. Date.now 변경이나 짧은 시험용 lease를 사용하지 않았습니다. 서비스 차단 후 중앙 로그인 유지.
- 실제 Chrome QA 프로필에서 로그아웃 204, 브라우저 세션 쿠키 삭제, 이후 JSON 및 페이지 401.

## 브라우저의 무거운 페이지 동작

별도 Chrome stable QA 프로필과 실제 SDK가 발행한 합성 회원 쿠키를 사용했습니다. 이 쿠키는 Git과 공개 증거에서 제외했습니다. 아래 시간은 실험 환경의 단일 관측이며 SDK만의 추가 지연이나 한국 전체의 성능 수치가 아닙니다. 전체 표시 시간은 데이터 렌더링과 모든 이미지 완료를 기다린 값입니다.

| 조건 | 전체 표시 | 탐색 load 이벤트 | 결과 |
|---|---:|---:|---|
| 새 프로필, cold | 3,190ms | 1,285.5ms | 36 plates, 37 img, JS 오류 0 |
| 같은 프로필 재방문 | 1,119ms | 571.6ms | 원본 데이터/이미지 유지 |
| 12Mbps, latency 80ms, CPU 4배 지연 | 9,993ms | 1,411.3ms | 전체 완료, JS 오류 0 |

분류 Highland 12건, 검색 02 1건, JSON 다운로드 18,000건, 390px 모바일 가로 넘침 없음. load 이벤트만으로 비동기 데이터·이미지 완료를 판단하지 않았습니다.

## 관찰된 한계와 실패 기록

1. **로그아웃의 전역 즉시 무효화는 아닙니다.** 최초 독립 검사에서 로그아웃 전에 복사한 암호화 쿠키의 재사용이 200/3,699,216 bytes였고, 재실행에서는 401이었습니다. 중앙 토큰은 즉시 401이지만, 다른 실행 인스턴스는 기존 5분 lease를 유지할 수 있습니다. 일반 브라우저의 쿠키 삭제 후 차단과 복사 쿠키의 전역 즉시 폐기를 구분해야 합니다. 최초 실패 영수증을 보존했으며 이 관찰을 숨기려고 SDK 정책을 바꾸지 않았습니다. 별도의 실제 경과 **302,830ms 뒤에는 복사 쿠키도 401/0 bytes**였습니다(`logout-bound.json`).
2. 최초 테스트 harness가 허용 회원의 Range 요청에 206을 기대했지만 실제는 200/full file이었습니다. 이는 [Cloudflare Static Assets의 문서화된 제한](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)입니다. 익명 Range는 여전히 차단됐습니다. SDK 소스를 바꾸지 않고 원래 호스트 동작 보존을 검사했습니다.
3. 한 수동 세션 probe의 404를 관찰했습니다. 중앙 tail에도 `/__accesskit/session` 요청이 있으며, 후속 전체 원격 검사 87개는 통과했습니다. 이 단일 probe를 SDK 결함이나 성공으로 단정하지 않았습니다.
4. **무료 플랜 CPU를 전부 만족했다고 판정하지 않습니다.** 실제 tail에서 소비 게이트 이미지 경로 최대 6ms, 중앙 `/authorize` 최대 21ms와 `/me` 최대 13ms 등이 관찰됐습니다. [Workers Free의 10ms 기준](https://developers.cloudflare.com/workers/platform/limits/)을 넘는 중앙 요청이 있습니다. 이 시험은 관리자 명부 CPU 경로를 재측정하지 않았고, 계정 요금제도 변경하지 않았습니다. tail 값과 요청 응답 시간은 별개이며, 샘플 최대를 전체 서비스 최대라고 하지 않습니다.
5. 실제 Google 로그인은 처음 `auth/unauthorized-domain`으로 실패했습니다. 사용자가 허용한 뒤 Firebase `nslg-auth-system` 승인 목록에 **시험 중앙 도메인 하나만** 추가했고 저장을 확인했습니다. 이후 Google 계정 선택창까지 진행했습니다. 계정 선택의 브라우저 제어 클릭이 두 번 실패하여 사용자에게 넘겼습니다. 계정 선택 이후 결과는 아직 미확인입니다. 합성 계정의 허용 검사를 실제 Google 로그인 성공으로 보고하지 않습니다.

## 근거와 재개 위치

작업 폴더: `C:/Users/sepsd/AppData/Local/Temp/access-kit-hosted-20261114`.
소비 소스: 위 폴더의 `site`, 공식 프롬프트 입력: `installer-prompt.txt`.
부모 검사: `validate.mjs`, `lease.mjs`, `browser-check.mjs`, `browser-logout.mjs`, `logout-bound.mjs`.
공개 가능한 검사 요약은 같은 이름의 `hosted-sdk-trial-20261114` 하위 폴더에 보관합니다. raw tail·세션·쿠키·서버 환경 설정은 복사하지 않습니다.

Google 계정 선택 뒤 시험 중앙 DB에서 해당 회원의 승인 전 차단과 시험 소속 승인 후 입장을 이어서 확인합니다. 운영 배포나 npm 게시 허가는 포함하지 않습니다.
