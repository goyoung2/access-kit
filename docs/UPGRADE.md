# 업데이트와 복구

## SDK 버전 올리기

1. private Releases에서 새 SDK와 SHA256SUMS를 받습니다. 배포 프로젝트에서 다운로드한 버전과 해시를 사용합니다.
2. 현재 소스와 package-lock.json을 커밋합니다.
3. `npx access-kit update --package ./다운로드한-SDK.tgz --sha256 실제64자리해시`를 실행합니다.
4. 도구가 해시를 확인하고 package.json/lock을 `.access-kit/backups/시간/`에 보관합니다. tarball은 `vendor/`에 해시 이름으로 보관합니다. npm install, 기존 build, 파일/경로 검사를 실행합니다. 실패하면 이전 의존성을 복원하고 실패를 보고합니다.
5. **새 프로세스**에서 `npx access-kit deploy`를 실행합니다. 설치된 새 런타임으로 배포하고 실제 사이트 버전을 확인합니다.
6. Google 로그인·미승인 차단·기존 API·재접속을 확인한 후 package.json, lock, vendor, 설정을 커밋합니다.

인증기 Worker는 별도입니다. 서비스 SDK 업데이트가 인증기 D1이나 회원 명부를 변경하지 않습니다.

## 배포 실패 복구

배포 전 검증된 Git commit과 Cloudflare deployment/version ID를 기록합니다. Workers는 `npx wrangler deployments list --config wrangler.access-kit.json`으로 확인합니다.

- Workers: 검증된 버전 ID로 `npx wrangler rollback VERSION_ID --config wrangler.access-kit.json`을 실행합니다.
- Pages: Cloudflare 대시보드 Deployments에서 검증된 production 배포의 Rollback을 선택합니다.
- 로컬 의존성: `.access-kit/backups/시간/package.json`과 `package-lock.json`을 복원하고 `npm ci`를 실행합니다. 관련 소스도 해당 검증 commit과 맞춥니다.
- 이전 SDK의 `verify`로 실제 배포 버전과 차단을 검사합니다. 실패 결과는 `.access-kit/last-verification.json`을 별도로 보존합니다.

자동으로 DB를 되돌리거나 사용자 변경을 reset하지 않습니다. 배포 시 네트워크 실패만으로 자동 rollback하지 않습니다.

## 원래 호스팅 설정 변경

원본 Wrangler 설정의 바인딩·경로·변수를 수정한 뒤 `npx access-kit sync`를 실행합니다. 원본 설정 hash가 다르면 doctor/deploy는 먼저 동기화하도록 안내합니다. 생성 파일 직접 수정은 덮어쓰지 않습니다.

## v0.1에서 옮기기

v0.1 수동 어댑터는 SDK tarball 교체만으로 계속 작동합니다. 기존 게이트 설정을 유지한 채 기존 build/test/deploy를 사용하세요.

v0.1 CLI가 생성한 프로젝트에는 install 기록이 없습니다. 기존 access-kit.json/worker/config 세 파일을 별도 백업 폴더에 보존하고, 원래 Wrangler 설정을 기준으로 v0.2 init을 실행합니다. 같은 client ID와 site URL을 사용하고 기존 세션 secret은 그대로 유지합니다. 새 파일 diff를 확인한 뒤 배포합니다.

## GitHub Actions

`npx access-kit automate`가 기존 workflow를 덮어쓰지 않고 수동 배포 workflow를 추가합니다. private 프로젝트에 SDK tarball과 lock을 커밋하고 `access-kit` environment에 CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID를 등록합니다. 필요하면 이 environment에 배포 승인자를 지정합니다. 기존 Worker에 세션 secret은 한 번 등록해 둡니다. 실행 결과에 보호 검사 JSON을 첨부합니다. 자동 반복 실행이나 방문자 polling은 없습니다.

## 0.3 업데이트

DB를 백업한 뒤 `0003_console.sql`까지 마이그레이션을 적용하고 인증기를 배포합니다. 기존 운영자는 최고 관리자 권한을 그대로 유지합니다. 관리자 주소는 `/console`입니다. 새 SDK0.3은 비로그인 접속을 중앙 로그인으로 바로 연결하며, 기존SDK0.2도 중앙 인증과 호환됩니다. 자세한 역할·관리 화면은 [CONSOLE.md](CONSOLE.md)를 참고하세요.
