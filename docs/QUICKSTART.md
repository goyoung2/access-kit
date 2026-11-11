# 새 프로젝트: 처음부터 설치

Node.js 22 LTS, GitHub CLI, Cloudflare 계정, Access Kit 개발자 초대가 필요합니다.

## 최소 정적 사이트 만들기

PowerShell 또는 bash에서 다음을 실행합니다.

```sh
mkdir my-member-site
cd my-member-site
npm init -y
node -e "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','<!doctype html><meta charset=utf-8><h1>회원 사이트</h1>');fs.writeFileSync('dist/private.json',JSON.stringify({membersOnly:true}));fs.writeFileSync('.gitignore','node_modules/\n.dev.vars*\n.env*\n.access-kit/\n');"
```

Cloudflare 대시보드에서 본인 계정의 workers.dev 하위 도메인을 확인합니다. Worker 이름을 `my-member-site`로 정했다면 서비스 주소는 `https://my-member-site.본인하위도메인.workers.dev/`입니다.

인증기의 설치 스튜디오에서 이 주소로 서비스를 등록하고, 호스팅 Workers / 빌드 폴더 dist / 프로젝트 이름 my-member-site를 선택합니다. 다음 단계가 생성한 명령을 실행합니다. SDK tarball과 package-lock.json은 private 프로젝트에 보관합니다.

설치 도중 `secret`이 새 Worker 생성 여부를 물으면 위에서 정한 이름을 확인한 뒤 진행합니다. `deploy`가 출력한 URL과 등록 주소가 일치하는지 확인합니다. 익명 보호 검사 통과 후 브라우저에서 Google 로그인을 눌러 회원 승인 후 입장까지 확인합니다.

같은 프로젝트를 다른 컴퓨터에서 열 때는 `npm ci` 후 `npx access-kit doctor`로 시작합니다. 세션 키를 다시 생성할 필요가 없습니다.
