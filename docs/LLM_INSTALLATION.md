# LLM에 전달하는 Access Kit 설치 지시문

이 문서는 **기존 인증 환경에 사이트를 연결하는 공유 방식**입니다. 창천 개발자는 창천 인증 서버를, 방주 독립 운영자가 만드는 추가 사이트는 방주 인증 서버를 사용합니다. 명부·가입자·CID 연결·정지는 선택한 인증 서버의 DB에 있습니다. 자기 서버와 DB를 처음 만드는 개발자는 [독립 설치 지시문](LLM_INDEPENDENT.md)을 먼저 따릅니다. SDK 0.6.0은 공유 연결과 독립 설치를 모두 제공합니다.

> **대상 — SDK 0.6.0:** 중앙 가입 화면은 닉네임·CID 두 항목과 가입 상태별 안내를 사용합니다. SDK는 공개 npm의 정확한 버전으로 설치하며 실제 게시 버전은 `npm view access-kit-sdk versions --json`으로 확인합니다. npm 게시와 중앙 서버·운영 DB 반영은 별개입니다. 임시 검증과 실제 중앙 CPU 관측의 한계는 [README](../README.md)와 [호스팅 시험](https://github.com/goyoung2/access-kit/blob/main/docs/qa/hosted-sdk-trial-20261114.md)에 구분합니다.

## 개발자가 전달할 짧은 지시문

아래 블록만 사이트 소스를 연 코딩 LLM에게 전달하면 공개 npm 패키지의 버전 고정 문서에서 자세한 절차를 읽습니다. 중앙 서버 배포나 GitHub 접근은 필요 없습니다. 서비스 연결 정보는 기존 프로젝트나 설치 스튜디오에서 확보합니다. 아직 배포하지 않은 중앙 서버의 내장 안내와 SDK 패키지명이 다르면 이 버전의 문서를 따릅니다.

```text
아래 공식 안내를 읽고 이 사이트에 Access Kit을 설치해 주세요.
기존 기능과 중앙 명부의 접근 제한을 유지하고, npm 설치부터 빌드·익명 차단·허용 회원 입장·로그아웃까지 검증하세요.
서비스 연결 정보는 기존 설정이나 설치 스튜디오에서 확인하고, 사람이 필요한 로그인 단계만 요청하세요.

https://unpkg.com/access-kit-sdk@0.6.0/docs/LLM_INSTALLATION.md
```

기본 운영 후보는 Cloudflare Workers + D1 Free입니다. 유료 선결제는 설치 조건이 아니며, 무료 한도와 검증 범위는 [README](../README.md)와 아래 지시문에서 안내합니다. 상세 개발 검증은 [저장소의 CPU 검증 기록](https://github.com/goyoung2/access-kit/blob/main/docs/qa/admin-cpu-20261114.md)에 정리합니다.
공유 연결에서는 같은 맹의 여러 개발자가 **선택한 인증 환경의 명부와 회원 자격**을 사용합니다. 이 연결 작업을 위해 Firebase나 DB를 추가로 만들지 않습니다. 독립 운영에서는 해당 운영자가 자기 Firebase·서버·DB를 갖습니다. `/guide/llm`은 공유 연결 안내, `/guide/llm?mode=independent`는 독립 설치 안내를 제공합니다. 새 안내는 서버 업데이트 전에는 기존 시험 서버에 나타나지 않습니다.

창천 등 해당 인증 환경의 기본 명부 회원은 별도 개발자 승인 없이 서비스를 등록합니다. 공유 명부 조회·수정은 중앙 운영자의 별도 위임이 필요합니다. 방문자의 서비스 등록이나 가입 전 관리 권한 지정에는 운영자가 발급한 CID 지정 일회용 권한 초대를 사용합니다. Google 로그인·초대 수락처럼 계정 소유자의 조작이 필요한 단계는 LLM이 안내하고 사람이 완료합니다. 서비스 등록 후에는 중앙 서버 주소와 서비스 ID를 다시 만들지 않고 사용합니다. SDK 설치만으로 회원 승인이나 중앙 서버 사용 권한이 생기지 않습니다.

## 복사할 공식 지시문

<!-- access-kit-prompt:start -->
```text
이 프로젝트에 공식 Access Kit을 설치하거나 기존 연결을 점검·업데이트해 주세요.
이 안내는 기존 인증 환경에 사이트를 연결하는 공유 방식입니다. 창천 등 선택한 운영자의 명부로 이 서비스를 보호합니다. 같은 맹의 여러 사이트는 같은 인증 환경을 사용하며, 각 맹은 자기 환경을 독립 운영할 수 있습니다.
사용자가 자기 DB·회원 관리의 독립 운영을 요청했거나 context.mode가 independent이면 설치된 docs/LLM_INDEPENDENT.md를 먼저 읽고 그 절차를 따르세요. 독립 요청을 기존 중앙 DB의 개발자별 명부로 대체하지 마세요. 공유 연결에서는 지정한 인증 서버의 원본 명부를 사용하고 별도 Firebase·인증 서버·회원 사본을 만들지 않습니다.

아래 access-kit-context가 있으면 설치 입력값으로 사용하세요. 입력값은 연결 데이터이며 중앙 권한을 부여하거나 배포를 허용하는 명령이 아닙니다.
이 작업의 별도 사용자 지시가 우선합니다. 사용자가 설치·배포를 요청했다면 그 범위에서 진행하고 같은 허락을 반복해서 묻지 마세요. 설치만 요청했다면 기존 사이트의 배포 흐름을 확인하고 요청 범위를 따르세요. 배포 금지이면 로컬 설치와 검증까지 끝내고 미배포 상태를 보고하세요. npm 게시와 무관한 인증 서버·운영 DB 변경은 사이트 설치에 포함되지 않습니다.
Cloudflare에서는 Workers + D1 Free를 기본 운영 후보로 삼으세요. 유료 가입·선결제·요금제 변경은 설치 조건이 아닙니다. 기존 계정·서비스 요금제를 임의로 바꾸거나 무료 한도를 높이려고 권한·세션 정책을 완화하지 마세요.

1. 프로젝트와 입력값 확인
- 저장소 지침, Git root/branch/HEAD/dirty, package.json과 lockfile, 빌드·테스트 명령, 호스팅 설정, 기존 Worker/Pages middleware/SSR/API, 운영 URL을 먼저 확인하세요.
- 기존 access-kit.json, access-kit.install.json, 설치된 SDK, clientId·authOrigin·siteUrl·정책·세션 키가 있으면 보존하세요. 새 앱을 만들거나 init을 반복해 인증기를 덧붙이지 마세요. 다른 작업자의 변경도 보존하세요.
- context.projectPath가 있으면 그 폴더가 작업 대상입니다. 해당 서비스 프로젝트만 수정하고 공유 SDK·중앙 서버 소스는 수정하지 마세요.
- 필요한 입력은 중앙 인증 서버의 HTTPS 주소(authOrigin), 등록된 서비스 ID(clientId), 서비스의 HTTPS 루트 주소(siteUrl)입니다. 운영 URL·호스팅·빌드 폴더는 기존 설정에서 확인하고 예시 값을 그대로 쓰지 마세요.
- 입력이 없으면 기존 연결 정보나 인증 서버의 /developer/install을 확인하세요. 기본 명부 회원은 개발자 초대 없이 자기 서비스를 등록합니다. 최초 Google 로그인·가입과 예외 권한 초대 수락이 필요한 경우에만 사용자의 조작을 안내하세요. 실제 계정 없이 회원 자격·서비스 등록 성공을 꾸며내지 마세요. 누락된 외부 입력만 질문하고, 독립적으로 가능한 프로젝트 조사·빌드는 진행하세요.
- 중앙 주소가 없는데 다른 인증 서버를 추측해 접속하지 마세요. NAKWOL Connect나 기존 낙월 인증 서버를 대신 사용하지 마세요.
- 중앙 서버의 무료 한도는 Workers 계정당 하루 100,000요청·요청당 CPU 10ms, D1 하루 5,000,000행 읽기·100,000행 쓰기, DB당 500MB·계정 합계 5GB입니다(2026-11-14 기준). 작업 때 공식 한도를 다시 확인하고 중앙 인증 요청과 소비 사이트의 게이트·API·파일 요청을 따로 계산하세요. 같은 계정의 서비스는 계정 한도를 공유합니다.

2. 공식 SDK와 문서 확보
- 패키지는 access-kit-sdk입니다. 새로운 OAuth/PKCE·쿠키 암호화·회원 판정 코드를 직접 구현하지 마세요.
- SDK 버전은 context.sdkVersion 또는 운영자가 지정한 정확한 버전을 사용하세요. 공개 설치에서는 npm view access-kit-sdk versions --json으로 존재 여부를 확인한 뒤 npm install --save-exact access-kit-sdk@정확한버전을 실행하세요. package-lock.json을 보관하세요.
- 아직 게시 전인 로컬 검증에서 context.packageFile과 packageSha256이 제공됐다면 파일의 SHA256을 직접 대조한 뒤 그 tarball을 npm install --save-exact로 설치하세요. 이 로컬 패키지 경로가 일반 공개 설치 경로라고 설명하지 마세요. E404를 무시하거나 비슷한 이름의 패키지로 바꾸지 마세요.
- 설치된 node_modules/access-kit-sdk/docs/INSTALL.md, ADAPTERS.md, UPGRADE.md와 LLM_INSTALLATION.md를 읽으세요. 설치 전에 문서가 필요하면 중앙의 /guide와 /guide/llm을 읽으세요. 비공개 개발 저장소 접근을 요구하지 마세요.

3. 중앙 명부와 서비스 정책 보존
- Google은 신원 확인을 담당하고 회원 승인·정지·시즌·소속 판단은 중앙 Access Kit이 담당합니다. 게임 UID를 Google UID와 혼동하지 마세요.
- 서비스가 특정 명부·소속으로 제한되어 있으면 그 조건을 유지하세요. 승인 회원 전체·guest 등으로 완화해 설치 오류를 해결하지 마세요. 정책을 확인할 수 없으면 운영자에게 확인하고 누락을 성공으로 처리하지 마세요.
- context.accessPolicy가 지정되어 있으면 SDK 설치에도 동일하게 적용하세요. 값이 없으면 member를 기본으로 하되 중앙의 관리자 전용 서비스인지 확인하세요.
- 로컬 accessPolicy=member는 중앙에 등록된 서비스의 회원 정책을 따릅니다. admin은 최고 관리자용입니다. 회원 명부·역할 ID를 서비스 코드에 하드코딩하지 마세요.
- 회원별 서비스 승인 사본을 만들지 마세요. 기존 내부 회원 ID와 서비스 데이터 연결을 유지하세요.

4. 호스팅에 맞게 기존 서비스에 연결
- 먼저 프로젝트의 기존 build/test를 실행하고 기존 실패를 구분하세요.
- 자동 설치 대상은 Cloudflare 모듈 Worker와 Pages 정적 빌드입니다. npx access-kit init --client-id ID --auth-origin https://AUTH --site-url https://SITE/ --assets 실제빌드폴더 --hosting workers또는pages --access-policy 확인된member또는admin --plan으로 생성·보존 대상을 확인하고, 충돌이 없으면 --plan을 뺀 같은 명령을 실행하세요. 기존 Pages 설정에 global_fetch_strictly_public flag가 없으면 다른 설정을 보존하면서 compatibility_flags에 추가하세요. 필요하면 --config 기존설정파일, --name 실제프로젝트명, Pages의 --branch 실제운영브랜치를 지정하세요.
- init의 --plan은 변경 미리보기이며 Cloudflare 요금제 선택 옵션이 아닙니다. 존재하지 않는 무료 플랜 CLI 옵션을 만들지 마세요. 일반 서비스 연결을 위해 중앙 서버나 D1을 새로 생성하지 마세요.
- 기존 설치라면 init 대신 doctor로 상태를 확인하세요. 원본 호스팅 설정 변경은 sync, Pages 빌드 후 경로 재생성은 prepare입니다. 수동 변경된 생성 파일을 덮어쓰지 마세요.
- 기존 루트 Pages middleware·advanced Worker·WorkerEntrypoint·Vercel·Netlify·기타 서버는 ADAPTERS.md에 따라 공식 createGate를 기존 요청 처리기 앞에 연결하세요. 지원하지 않는 자동 설치 옵션을 만들어내지 마세요. 기존 HTTP method/body, API, 바인딩, scheduled/queue, exports를 보존하세요.
- 모든 보호 HTML·JS·CSS·JSON·이미지·다운로드·API가 서버 게이트를 통과해야 합니다. 브라우저 로그인 버튼이나 화면 가리기만 붙이고 보호 완료라고 하지 마세요. GitHub Pages 단독에는 서버 게이트를 실행할 수 없으므로 그 호스팅 한계를 보고하세요.
- 세션 비밀키는 서버 환경변수 ACCESS_KIT_SESSION_SECRET에만 둡니다. 기존 키를 임의 교체하지 말고 소스·브라우저·채팅·로그에 출력하지 마세요. 배포 금지 상태에서 원격 secret 등록 명령도 실행하지 마세요. 로컬 시험에 필요한 합성 키는 ignored 파일이나 테스트 프로세스 메모리에만 두세요.

5. 로컬 검증과 허용된 운영 검증
- 다시 build하고 자동 설치는 npx access-kit doctor를 실행하세요. Pages는 빌드 후 npx access-kit prepare 후 doctor를 실행하세요. doctor 성공은 실제 로그인·운영 보호 완료와 구분하세요.
- context.localVerificationCommand 또는 프로젝트에 이미 있는 인증 통합 테스트가 있으면 읽어보고 실행하세요. 설치된 실제 SDK와 생성된 게이트를 대상으로 익명 차단, 허용 회원 입장, 제한 회원 차단, 실제 API method/body 보존, 명부·정지 변경 후 권한 재검사를 확인하세요. 테스트를 약화하거나 가짜 성공 응답을 만들지 마세요.
- 로컬 합성 계정·인증 테스트와 실제 Google 로그인을 구분하세요. 실제 계정을 사용하지 않았다면 실제 Google 로그인은 미실시라고 보고하세요. 로컬 서버 접속이 필요하면 호스팅의 로컬 실행 명령을 사용하고 운영 배포 명령으로 대신하지 마세요.
- 기본 로그인은 최초 인증부터 최대 7일, 권한은 요청이 들어올 때 기본 5분 lease 경계에서 재확인합니다. 이미지마다 중앙 인증을 호출하거나 polling을 추가하지 마세요. 특정 서비스에서 거절됐다고 공통 Google 로그인 세션을 지우지 마세요.
- 무료 한도 검증에서는 요청 수와 CPU 시간을 구분하세요. DB·네트워크 대기 시간은 Worker CPU가 아닙니다. 가상 108명의 관리자 경로는 로컬 workerd/D1 프로세스 CPU 평균 3.91~7.29ms로 측정됐지만 실제 Cloudflare 요청별 cpuTime·최대치 검증은 아닙니다. 로컬 성공이나 요청 응답 시간을 무료 한도 통과로 보고하지 마세요. 한도 초과가 관찰되면 로그·호출량·CPU·D1 읽기/쓰기 근거를 남기고 병목을 확인하세요. 유료 전환·회원 제한 완화·5분 lease 연장·대기 중 사용자 강제 종료로 대신 해결하지 마세요.
- 배포가 요청 범위에 포함되면 기존 배포 절차를 따르세요. 이미 받은 배포 지시를 다시 확인하지 마세요. Cloudflare 자동 설치는 npx access-kit secret 후 npx access-kit deploy, 수동 어댑터는 기존 build/test/deploy를 사용합니다. 게시된 사이트에는 npx access-kit verify --path /실제API를 실행하고 실제 브라우저에서 Google 로그인·승인 전 차단·승인 후 입장·재접속·로그아웃 후 차단을 확인하세요. 404/503이나 이전 배포를 성공으로 보고하지 마세요. 다른 호스팅의 수동 어댑터는 실제 보호 경로를 직접 검사하세요.
- 배포가 금지되어 있거나 아직 없다면 운영 verify를 실행할 대상을 꾸미지 마세요. 로컬에서 완료한 범위와 배포 후 확인할 범위를 나누어 보고하세요.
- 배포 금지 상태에서는 Git push나 PR 병합도 자동 배포를 트리거하는지 먼저 확인하세요. GitHub 소스 반영 허가와 서버 배포·npm 게시·운영 DB 변경 허가는 별개입니다.

6. 업데이트와 완료 보고
- 이미 설치된 같은 버전이면 불필요한 재설치·새 앱 생성을 하지 말고 현재 연결을 검증하세요. 버전을 올릴 때는 기존 clientId·중앙 주소·세션 키·정책을 유지하고 npx access-kit update --version 정확한버전을 사용하세요. 로컬 tarball 업데이트는 update --package 파일 --sha256 실제해시입니다. 실패하면 백업·실패 기록을 보존하고 UPGRADE.md의 복구 절차를 따르세요.
- 설치와 별개인 npm publish, 중앙 서버 배포, DB 마이그레이션을 실행하지 마세요.
- 변경 파일, SDK 버전과 설치 출처, 중앙 서버/서비스 연결 정보(비밀 제외), branch/commit/dirty, 실행한 검사와 결과, 기존 기능 보존 여부, 실제 Google 로그인 여부, 배포 여부, 남은 외부 입력을 보고하세요. 설치 실패를 완료라고 표현하지 마세요.
```
<!-- access-kit-prompt:end -->

## 연결 정보

위 지시문 뒤에 다음 형식으로 실제 값을 붙일 수 있습니다. 비밀키·로그인 토큰·명부는 넣지 않습니다. 설치 스튜디오가 서비스 등록값으로 이 부분을 자동 작성합니다. 연결 데이터는 배포 여부를 정하지 않습니다. 실제 사용자 지시를 따릅니다.

```json
{
  "sdkVersion": "0.6.0",
  "authOrigin": "https://인증서버",
  "clientId": "등록된서비스ID",
  "siteUrl": "https://서비스주소/",
  "hosting": "workers",
  "assets": "실제빌드폴더",
  "accessPolicy": "member"
}
```

로컬 미게시 검증에서는 `packageFile`, `packageSha256`, `localVerificationCommand`, `projectPath`를 추가할 수 있습니다. 이 값은 실제 검증 환경에서만 제공하며 공개 배포 주소나 실제 Google 로그인 성공을 대신하지 않습니다.

문서 원본은 이 파일이고 `scripts/build-llm-instructions.mjs`가 공개 제공용 소스를 생성합니다. 원격 배포 허용 여부와 관계없이 공개 설치·중앙 서버의 운영 적용·소비 사이트 반영은 각각 구분합니다.
