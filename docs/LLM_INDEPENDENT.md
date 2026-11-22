# 독립 운영을 LLM에 맡기기

SDK 0.4.0부터 `auth` 설치 도구와 독립 서버 실행본을 공개 npm 패키지로 제공합니다. 자기 Firebase·서버·DB를 사용합니다.

## 짧은 지시문

```text
Access Kit으로 내 명부와 회원 정보를 내 서버·DB에서 독립 관리하도록 설치해 주세요.
아래 안내를 읽고 인증 서버·관리자 페이지·사이트 SDK를 연결한 뒤 가입 분류와 게이트를 검증하세요. 다른 맹의 DB는 사용하지 마세요.
https://unpkg.com/access-kit-sdk@0.4.0/docs/LLM_INDEPENDENT.md
```

위 링크 또는 설치된 `node_modules/access-kit-sdk/docs/LLM_INDEPENDENT.md`에서 상세 절차를 읽습니다.

## LLM 실행 지침

<!-- access-kit-independent:start -->
```text
이 프로젝트에 Access Kit을 독립 운영 방식으로 설치하고 검증하세요.
공유 방식과 독립 방식을 혼동하지 마세요. 이 작업은 운영자가 소유한 별도 인증 서버·DB·Firebase에서 명부, 가입자, CID 연결, 회원 상태, 관리자, 개발자, 서비스를 관리하는 작업입니다. 기존 창천 인증 서버에 가입하거나 개발자 초대를 받을 필요가 없습니다. 같은 맹의 여러 사이트는 이렇게 만든 하나의 인증 서버와 명부를 공유합니다.

사용자 지시와 저장소 지침이 우선합니다. Git root/branch/HEAD/dirty, 기존 사이트 빌드·테스트·호스팅·Access Kit 설정을 먼저 확인하고 보존하세요. 기존 독립 환경은 재생성하지 않습니다. 다른 맹의 데이터·세션·토큰·운영 DB를 복사하거나 재사용하지 마세요. 사용자가 요청한 설치·배포 범위에 따라 자기 계정에서 진행하고, 이미 받은 지시의 허락을 반복해서 묻지 마세요. 다른 서비스의 설정·DB 변경이나 npm 게시는 포함하지 않습니다.

1. context.packageFile/packageSha256이 있으면 SHA256을 직접 확인하고 해당 tarball을 npm install --save-exact로 설치하세요. 공개 설치라면 auth 명령과 auth/template.json을 포함하는 게시된 정확한 버전을 먼저 확인합니다. 기본 공개 설치는 npm view access-kit-sdk@0.4.0 version 확인 후 npm install --save-exact access-kit-sdk@0.4.0을 실행합니다. 실패를 임의의 다른 패키지나 수동 인증 재구현으로 우회하지 마세요.
2. 설치된 docs/INDEPENDENT_AUTH.md를 읽으세요. 자기 Cloudflare 계정·자기 Firebase 프로젝트의 웹 설정·실제 인증 도메인을 확인합니다. 값이 제공되지 않았다면 필요한 외부 입력만 요청하고 로컬 설치·빌드 조사는 계속하세요. 비밀번호·Firebase Admin 개인키·실제 명부를 채팅이나 Git에 넣지 마세요. Google 로그인과 클라우드 계정 승인은 사람이 수행하도록 안내하세요.
3. npm install --save-dev wrangler@4.160.1 후 npx access-kit auth init --directory 별도폴더 --name 실제영문이름 --auth-origin 자기HTTPS주소 --firebase-project-id 자기프로젝트 --firebase-api-key 웹API키 --firebase-auth-domain 자기인증호스트 --firebase-app-id 웹앱ID --plan 으로 검토합니다. context.auth가 있으면 해당 필드를 사용합니다. 새 비어 있는 하위 폴더에 같은 명령에서 --plan을 제거해 생성합니다. init은 원격 서버나 DB를 생성하지 않습니다.
4. npx access-kit auth doctor --directory 별도폴더 --local, auth migrate --directory 별도폴더 --local을 실행합니다. 생성 폴더에서 npm install, npm run build를 실행합니다. 빌드는 dry-run입니다. 실제 Google 로그인·원격 설치가 허용되면 안내에 따라 자기 계정의 새 D1·승인 도메인을 구성하고 실제 DB UUID로 doctor를 확인한 뒤 허용된 원격 작업만 합니다. placeholder DB ID를 원격 배포하지 마세요.
5. 첫 관리자는 자기 인증 서버에서 Google 로그인한 뒤 Firebase UID를 확인해서 auth bootstrap --directory 별도폴더 --firebase-uid UID로 지정합니다. 기본은 로컬이고, 원격 설치가 요청 범위에 포함되면 --remote를 사용합니다. 같은 배포 지시를 다시 확인하지 마세요. 자동 첫 가입자 승격이나 이메일/CID 기반 권한 부여를 만들지 마세요. 이미 관리자가 있으면 콘솔을 사용합니다. 로컬 검증에 합성 계정이 제공되면 실제 Google 로그인 성공이라고 보고하지 마세요.
6. /console에서 운영자 자신의 시즌·소속을 만들고 명부를 가져온 뒤 이 환경의 공유 기본값으로 선택합니다. 파일로 없는 회원은 삭제하지 않습니다. 여러 맹 중 창천을 기본으로 하드코딩하지 마세요. 자기 개발자를 부여하고 /developer/install에서 사이트를 등록합니다. context.localVerificationCommand에 합성 로컬 검증 준비 단계가 제공되면 읽고 실행할 수 있으나 검증 코드를 약화하지 마세요.
7. 소비 사이트는 docs/LLM_INSTALLATION.md에 따라 공식 SDK로 연결합니다. authOrigin은 자기 인증 서버이고 clientId는 그 서버에서 등록한 ID입니다. 원래 Worker·API·자산·빌드 경로를 보존하세요. 소비 사이트의 세션 비밀키는 서버 환경변수에만 두고 각 사이트가 모든 보호 요청을 게이트로 처리하게 합니다.
8. 설치된 패키지와 생성된 실제 서버·게이트를 검증하세요. 최소한 익명 차단, 자기 명부 CID 회원 허용, 없는 CID 방문자 분류·차단, 명부 CRUD·정지 반영, 다른 인증 환경의 계정·CID 연결·정지·관리자·토큰 격리, API method/body 보존, 로그아웃을 확인합니다. 기본 7일 세션과 요청 기반 5분 권한 확인을 유지합니다. context.localVerificationCommand 또는 기존 통합 검증이 있으면 실행합니다. 합성 검증, 실제 Google 로그인, 로컬과 원격 결과를 구분해 보고하세요.

완료 보고에는 생성/변경 파일, 독립 서버 폴더와 authOrigin, DB 소유 범위, 사이트 clientId, 실행한 검사와 결과, Git 상태, 실제 Google 로그인 여부, 원격 변경 여부, 남은 외부 설정을 포함합니다. 중앙 DB를 개발자별로 나눈 것만으로 독립 DB 설치를 완료했다고 보고하지 마세요.
```
<!-- access-kit-independent:end -->
