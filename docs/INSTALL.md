# Access Kit 설치

코딩 LLM에게 설치를 맡기려면 [공식 설치 지시문](LLM_INSTALLATION.md)을 전달하세요. 중앙 인증기의 `/guide/llm`에서도 전체 지시문을 읽을 수 있으며 설치 스튜디오는 서비스 연결 정보를 포함해 복사합니다.

자신의 사이트에 Google 로그인과 승인 회원 접근 제한을 연결하는 안내입니다. SDK는 공개 npm 패키지로 배포하며 GitHub 초대·GitHub CLI·npm 로그인은 설치 조건이 아닙니다. 인증 서버의 `/guide`와 npm README는 로그인 없이 읽을 수 있습니다. 상세 문서는 설치된 패키지의 `node_modules/access-kit-sdk/docs/`에도 포함됩니다.

## 1. 설치와 서버 사용 권한

1. Node.js 22 LTS 이상을 설치하고 `node --version`, `npm --version`을 확인합니다.
2. 프로젝트 폴더에서 아래 명령으로 SDK를 설치합니다. 해당 버전이 npm에 게시된 뒤 사용할 수 있습니다. E404이면 운영자에게 게시 버전을 확인합니다.
3. 사용할 중앙 인증 서버의 개발자 초대 링크를 열고 Google 로그인 후 **초대 수락**을 누릅니다. 링크는 7일 동안 한 번 사용합니다. 기존 사용자는 운영자가 권한을 부여할 수도 있습니다. SDK 설치만으로 중앙 서버 사용 권한이나 회원 자격이 부여되지는 않습니다.
4. 기존 프로젝트를 먼저 빌드합니다. 처음 만드는 사이트는 [새 프로젝트 시작](QUICKSTART.md)을 사용합니다.

```sh
npm view access-kit-sdk versions --json
npm install --save-exact access-kit-sdk@0.5.0
npx access-kit help
```

## 2. 설치 스튜디오

인증 서버의 `/developer/install`에서 서비스를 등록합니다. 실제 배포할 HTTPS 루트 주소와 입장 조건을 선택합니다. **승인 회원 전체**는 특정 맹·현재 시즌 소속을 요구하지 않습니다. 명부 제한이 필요한 서비스만 **현재 시즌 · 지정 조직(맹)**을 선택합니다. **최고 관리자 전용**도 별도 선택입니다. 기존 서비스의 정책은 자동으로 바뀌지 않습니다. 운영자가 설정한 회원 승인·시즌 자격은 중앙 인증기에서 판단합니다.

다음 단계에서 호스팅, 빌드 결과 폴더, 기존 프로젝트 이름/설정 파일을 입력합니다. 새 Workers 사이트라면 Cloudflare 계정의 workers.dev 하위 도메인과 만들 Worker 이름을 조합해 서비스 주소를 정하세요. 실제 배포 URL이 달라지면 서비스 등록 주소와 `access-kit.json`의 siteUrl을 함께 수정합니다.

생성된 명령은 PowerShell과 bash에서 실행할 수 있습니다. 폴더 이름에 작은따옴표를 넣지 마세요. 기존 설정 파일이 하나면 자동 감지합니다. 둘 이상이면 `--config`로 선택합니다.

## 3. 설치와 배포

화면이 만든 명령을 순서대로 실행합니다. SDK의 정확한 버전과 package-lock.json을 커밋하고 `npm ci`로 같은 의존성을 재설치합니다. 기존 파일 설치는 tarball과 lockfile도 함께 보관합니다. 키·명부·개발자 토큰은 Git이나 패키지에 넣지 않습니다.

- `init --plan`: 만들 파일과 보존할 호스팅 설정을 확인합니다. 파일을 수정하지 않습니다.
- `init`: 게이트와 배포 설정을 생성합니다. 원래 Worker와 Wrangler 설정은 그대로 둡니다.
- `doctor`: 생성 파일의 누락/수동 변경, 원본 설정의 변경, 빌드 결과, 보호 경로를 검사합니다.
- `secret`: 32바이트 난수로 세션 키를 생성해 호스팅에 등록합니다. 기존 키가 있으면 유지합니다. 키는 화면에 출력하지 않습니다.
- `deploy`: 프로젝트 build 스크립트 실행 → 보호 경로 준비 → doctor → 배포 → 실제 URL 보호 검사.

Wrangler 로그인이 안 되어 있으면 `npx wrangler login`을 먼저 실행합니다. Pages는 화면 명령에 포함된 `pages project create`를 새 프로젝트일 때 한 번만 실행합니다. 이미 있는 Pages 프로젝트에서는 이 명령을 건너뜁니다.

### 기존 Workers 프로젝트

JSON, JSONC, TOML 설정을 읽고 `wrangler.access-kit.json`을 별도로 생성합니다. 원래 name, routes, vars, D1/R2/KV/service bindings, triggers 등을 유지합니다. main만 게이트로 연결하고 assets는 모든 요청이 Worker를 먼저 통과하도록 설정합니다. 원래 fetch/POST API, scheduled/queue 핸들러와 named exports를 유지합니다. 원래 소스의 상대 경로는 바뀌지 않습니다.

원본 Wrangler 설정 변경 후 `npx access-kit sync`를 실행하세요. `access-kit.json`의 비밀이 아닌 연결 설정을 수정하면 wrapper가 직접 읽습니다. 원본 코드의 변경은 그대로 반영됩니다. 생성 wrapper를 직접 변경했다면 sync는 덮어쓰지 않고 충돌을 알립니다.

환경별 main/assets가 다르거나 WorkerEntrypoint 클래스/서비스 워커 문법을 쓰는 프로젝트는 [서버 연결 예제](ADAPTERS.md)의 직접 연결 방식을 사용합니다. CLI 자동 설치는 모듈 Worker의 기본 객체 export를 대상으로 합니다.

### Pages

루트 `functions/_middleware.js`와 빌드 폴더 `_routes.json`을 생성합니다. 기존 하위 Functions는 유지합니다. 빌드 후에는 `prepare`가 `/*` 전체를 보호하도록 경로를 재생성합니다. 이미 루트 middleware, `_worker.js`, `_routes.json`이 있으면 자동 덮어쓰지 않습니다. [기존 middleware 연결](ADAPTERS.md)을 사용하세요.

## 4. 실제 검증

`npx access-kit verify`는 빌드 파일을 열거해 GET, HEAD, Range, 잘못된 쿠키의 네 요청을 각각 보내고 401/403과 SDK 실행 버전을 검사합니다. API는 `--path /실제/API/경로`로 추가합니다. 순차 요청이며 로그인하지 않은 게이트 검사에 중앙 인증 DB 접근은 없습니다. 결과는 `.access-kit/last-verification.json`에 저장됩니다.

별도로 브라우저에서 Google 로그인, 승인 대기 차단, 승인 후 입장, 새로고침과 재접속을 확인하세요. 세션은 최초 로그인부터 최대 7일입니다. 현재 사용 중인 권한은 최대 5분 lease 뒤 다음 요청에서 다시 확인합니다. 화면을 가만히 두면 갱신 요청을 만들지 않습니다.

## 5. 업데이트와 문제 해결

[업데이트·복구](UPGRADE.md)를 따릅니다.

| 상황 | 해결 |
|---|---|
| `node`/`npm` 명령을 찾지 못함 | Node.js 설치 후 터미널을 새로 열어 PATH 반영 |
| npm E404 | 게시된 패키지·버전과 registry 설정을 확인하고 공개 npmjs.org를 사용 |
| 빌드 폴더/index.html 없음 | 기존 build 실행 후 실제 출력 폴더를 --assets로 지정 |
| 원본 설정 변경 감지 | 변경 내용을 확인한 후 `access-kit sync` |
| 생성 파일 수정 감지 | 직접 변경한 내용을 보존한 뒤 생성 파일과 비교 |
| 배포 URL 404/이전 버전 | deploy의 반영 대기 후 verify 재실행. 결과 파일 보존 |
| 로그인 후 403 | 관리자에게 회원 승인·현재 시즌 자격 확인 요청 |
| 503 | 인증 서버 health 및 서비스 로그 확인. 회원 승인을 임의 변경하지 않음 |

`.dev.vars*`, `.env*`, `.access-kit/`를 .gitignore에 추가하세요. 세션 키와 회원 명부는 저장소에 넣지 않습니다.
