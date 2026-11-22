# 새 창천 인증 환경과 SDK 0.4.0 검증

2026-11-23 KST. 게시 소스: `7c98c582ed154676dbf9f8c15fce466119333efc`, 태그 `access-kit-sdk-v0.4.0`.

## 새 리소스와 명부

- 인증 서버: https://access-kit.nslg-hub.workers.dev
- 관리자: https://access-kit.nslg-hub.workers.dev/console
- 설치 스튜디오: https://access-kit.nslg-hub.workers.dev/developer/install
- 게이트 시험 사이트: https://access-kit-check.nslg-hub.workers.dev/
- 새 D1: `access-kit`, `3dac3da2-382a-4e9f-a8a3-630669412d2b`. 마이그레이션 0001–0008 적용.

사용자가 제공한 파일은 **198명**이었으며 198명 그대로 등록하도록 명시적으로 승인받았다. 중복·형식 오류 0건. CID·닉네임 198쌍이 원본과 정확히 일치하며 `창천` 공유 명부를 기본값으로 등록했다. 시즌 표시는 게임 시즌을 추측하지 않고 `2026-11-22 명부`로 지정했다. 원본 SHA256: `38c510526ac94086457d23593b14dc083253035ac60b5adbddb3a436252c71db`.

리소스는 지정된 새 Cloudflare 계정에 생성했고 Wrangler 로그인은 유지했다. 이전 인증 Worker·D1에는 쓰기 작업을 하지 않았다. 기존 Pages 두 곳의 production deployment ID도 전후 일치한다. 작업 중 별도 Pages 프로젝트가 추가로 나타났지만 이 작업에서는 Pages 생성·배포 요청을 하지 않았다.

## Firebase와 실제 계정

Playwright 브라우저 DOM 조작으로 `nslg-auth-system` 승인 도메인에 `access-kit.nslg-hub.workers.dev`만 추가했다. 기존 5개 도메인을 보존했고 Firebase 공개 프로젝트 설정 API로 재확인했다. 비밀번호·회원 데이터 변경은 하지 않았다.

사용자가 직접 Google 로그인과 닉네임·CID 가입을 완료했다. 새 DB의 실제 Firebase identity와 가입 기록에서 **창천 명부 CID 일치, 닉네임 일치, 활성 계정**을 확인했다. 별도 승인을 받아 해당 계정을 새 서버 최고 관리자로 지정했다. Playwright에서도 Google 로그인 완료 → 맹원 가입 안내 → 시험 사이트 `로그인·게이트 통과` → 보호 데이터 200을 확인했다. 관리자 `/console/data`는 200이며 회원 1명·명부 198명을 반환했다.

## 원격 게이트

실제 배포된 Worker·D1·PKCE·SDK 게이트에 합성 로그인 fixture를 넣어 46개 검사를 통과했다. 실제 Google 로그인 증거와 합성 fixture 검증은 별개다.

- 명부 CID 맹원, 없는 CID 방문자, 닉네임 불일치 맹원 자동 가입.
- 중복 CID 연결 거부, 승인 대기 없음, 닉네임 확인 정보는 일반 가입 상태 응답에 노출되지 않음.
- 일반 회원·방문자 관리자 데이터 차단, 방문자 authorization code 발급 차단.
- PKCE 교환·회원 세션·최대 7일 쿠키, 익명/잘못된 쿠키의 HTML·이미지·JSON·API·HEAD·Range 차단.
- 회원 입장, API POST body 보존, 정지 시 새 세션 거부·정지 해제 후 허용.
- 로그아웃 중앙 토큰 폐기. 다른 실행 인스턴스의 복사 쿠키는 기존 5분 lease 동안 유효할 수 있으며 실제 5분 경과 후 401을 확인했다.

모든 합성 계정·세션·토큰·관련 가입 기록은 제거했다. 원본 명부 198개 행의 ID·CID·닉네임·상태·revision은 전후 동일하다. 최초 명부 등록용 비활성 시스템 레코드에는 로그인 identity·세션·관리자 권한이 없다.

초기 수동 시험 Worker 설정에서 `global_fetch_strictly_public`이 빠져 같은 계정의 인증 Worker 요청이 404로 돌아왔고 게이트는 503으로 차단했다. 원격 tail에서 원인을 확인하고 시험 Worker 설정에 옵션을 추가해 재검증했다. 공식 SDK 자동 설치는 이미 이 옵션을 설정하므로 SDK 인증 정책을 변경하지 않았다.

## SDK 공개 게시

`access-kit-sdk@0.4.0`은 독립 인증 서버·마이그레이션·첫 관리자 설치 도구와 서비스 개발자 역할을 포함한다. 기존 v0.3.1 브라우저 프로토콜의 URL·바이트는 유지하며 게이트 runtime은 0.4.0이다. 두 방식의 짧은 안내 링크와 README를 갱신했다.

타입 검사와 102개 테스트 통과. 검증한 공개 패키지 32개 파일, SHA256 `98003aa8374fdeb4255bf8dff69ff18a583bb760c0fe2d705e4ea3d65325b944`. npm 계정 `goyoung`으로 공개 게시했으며 `latest=0.4.0`과 일반 다운로드 URL의 200·정확한 해시를 확인했다. 두 버전 고정 unpkg 설치 안내도 모두 200이다. GitHub main과 게시 태그에 동일한 소스를 반영했다.

빈 별도 소비 프로젝트 세 곳에서 버전 고정 공개 안내를 읽고 **`npm install --save-exact access-kit-sdk@0.4.0`**으로 설치했다. 소비 프로젝트에는 별도의 익명 npm 설정·캐시를 사용했고 로컬 tarball을 설치 경로로 전달하지 않았다. 부모 LLM이 안내 절차를 실행했으며, 이전 11월 18일의 별도 LLM 자율 설치 시험과는 구분한다. 통합 검증 harness의 assertion은 변경하지 않았다.

| 방식 | 확인한 결과 |
|---|---|
| 공유 연결 / Workers | 공개 npm 설치·빌드·doctor, 익명 요청 32건 차단, 타 소속 차단·PKCE·회원 입장·API body·기존 export/scheduled 보존·5분 lease·명부 변경·정지·로그아웃 |
| 공유 연결 / Pages | 공개 npm 설치·빌드·prepare·doctor, 기존 Pages 설정 보존, 익명 HTML·파일·API·HEAD·Range·잘못된 쿠키 차단, 회원 입장·명부 변경·정지·로그아웃 |
| 독립 운영 / Workers | 공개 npm 설치·auth init·8개 로컬 마이그레이션·서버 dry-run·CLI 첫 관리자 지정·자체 명부/서비스 생성·회원/방문자 분류·기존 사이트 게이트 설치·명부 삭제/복구·정지·로그아웃의 7개 흐름 |

위 세 설치 fixture는 합성 신원과 로컬 DB를 사용했고 원격 배포를 하지 않았다. 실제 Google 로그인과 새 창천 원격 게이트는 앞 절의 별도 증거다. 독립 fixture의 `npmPublished:false`는 그 소비 프로젝트가 npm 게시를 수행하지 않았다는 뜻이며 SDK 0.4.0의 공개 게시 결과와는 별개다.

초기 공개 전파 중 npm 메타데이터보다 tarball/CDN이 늦게 반영되어 일반 설치가 E404로 실패했다. 우회 설치로 성공 처리하지 않고 일반 URL과 안내가 정상화된 뒤 같은 공개 버전 설치를 다시 확인했다. 독립형 최초 시도는 C드라이브 공간 부족(`ENOSPC`)으로 중단됐으며 실패 기록을 보존했다. 이번 작업의 임시 fixture 파일만 E드라이브로 이동하고 새 E드라이브 fixture에서 재시험해 통과했다. 사용자 파일을 삭제하거나 SDK의 검증 기준을 완화하지 않았다.

기계 판독 증거: [공개 패키지](changcheon-deploy-20261123/npm-public-proof.json), [세 설치 결과](changcheon-deploy-20261123/public-install-proof.json), [Workers](changcheon-deploy-20261123/public-workers-proof.json), [Pages](changcheon-deploy-20261123/public-pages-proof.json), [독립 서버](changcheon-deploy-20261123/public-independent-proof.json), [원격 게이트](changcheon-deploy-20261123/hosted-proof.json), [실제 브라우저](changcheon-deploy-20261123/real-browser-proof.json).

상세 실행 로그·개인정보 포함 fixture는 ignored `.wrangler/changcheon-deploy-20261122/`에만 보존하며 Git에 올리지 않는다. 이 문서에는 회원 CID·닉네임·Firebase UID·세션·비밀키를 포함하지 않는다.
