# 새 프로젝트: 처음부터 설치

코딩 LLM에게 설치를 맡기려면 [공식 설치 지시문](LLM_INSTALLATION.md)을 전달하세요. 중앙 인증기의 `/guide/llm`에서도 전체 지시문을 읽을 수 있으며 설치 스튜디오는 서비스 연결 정보를 포함해 복사합니다.

Node.js 22 LTS와 Cloudflare 계정이 필요합니다. 공개 SDK 설치에는 GitHub 초대·npm 로그인이 필요하지 않습니다. 사용할 Access Kit 서버의 서비스 등록 권한은 운영자에게 별도로 받습니다. 특정 맹에 속해야 개발할 수 있는 구조는 아닙니다.

## 최소 정적 사이트 만들기

PowerShell 또는 bash에서 다음을 실행합니다.

```sh
mkdir my-member-site
cd my-member-site
npm init -y
node -e "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','<!doctype html><meta charset=utf-8><h1>회원 사이트</h1>');fs.writeFileSync('dist/private.json',JSON.stringify({membersOnly:true}));fs.writeFileSync('.gitignore','node_modules/\n.dev.vars*\n.env*\n.access-kit/\n');"
```

Cloudflare 대시보드에서 본인 계정의 workers.dev 하위 도메인을 확인합니다. Worker 이름을 `my-member-site`로 정했다면 서비스 주소는 `https://my-member-site.본인하위도메인.workers.dev/`입니다.

인증기의 `/guide`에서 안내를 읽고, `/developer/install`에서 이 주소로 서비스를 등록합니다. 승인 회원 전체 / 현재 시즌 지정 조직(맹) / 최고 관리자 전용 중 필요한 조건을 선택합니다. 호스팅 Workers / 빌드 폴더 dist / 프로젝트 이름 my-member-site를 선택하고 생성한 명령을 실행합니다.

SDK는 npm에 해당 버전이 게시된 뒤 다음과 같이 설치합니다. `package.json`과 `package-lock.json`을 커밋하세요.

```sh
npm install --save-exact access-kit-sdk@0.5.0
```

설치 도중 `secret`이 새 Worker 생성 여부를 물으면 위에서 정한 이름을 확인한 뒤 진행합니다. `deploy`가 출력한 URL과 등록 주소가 일치하는지 확인합니다. 익명 보호 검사 통과 후 브라우저에서 Google 로그인을 눌러 회원 승인 후 입장까지 확인합니다.

같은 프로젝트를 다른 컴퓨터에서 열 때는 `npm ci` 후 `npx access-kit doctor`로 시작합니다. 세션 키를 다시 생성할 필요가 없습니다.
