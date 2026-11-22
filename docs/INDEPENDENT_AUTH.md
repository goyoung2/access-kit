# 독립 인증 운영

Access Kit은 Google 로그인, 닉네임·CID 가입, 명부 대조, 서버 게이트를 묶어 제공합니다. **공유 연결**은 창천처럼 기존 운영자의 인증 서버를 여러 사이트가 사용하는 방식입니다. **독립 운영**은 방주처럼 운영자 자신의 서버·DB·Firebase를 만들고 명부·가입자·CID 연결·상태·관리자·서비스를 그 DB에서 관리하는 방식입니다. 독립 운영자에게 창천의 초대나 최고 관리자 권한은 필요하지 않습니다.

SDK 0.5.0부터 독립 인증 서버 실행본·마이그레이션과 `auth` 설치 도구를 공개 패키지에 포함합니다. `npm install --save-exact access-kit-sdk@0.5.0`으로 설치합니다. 원격 생성·배포는 별도 단계입니다.

## 데이터와 연결

| 항목 | 공유 연결 | 독립 운영 |
|---|---|---|
| 인증 서버·DB 소유자 | 기존 명부 운영자 | 설치하는 운영자 |
| 명부·가입자·CID·정지·권한 | 선택한 인증 서버의 DB | 자기 인증 서버의 DB |
| Google 로그인 설정 | 기존 인증 서버의 Firebase | 자기 Firebase 프로젝트 |
| 여러 사이트 | 동일한 인증 서버를 참조 | 자기 인증 서버를 공통 참조 |
| 게이트·세션 암호화 키 | 각 사이트 서버 | 각 사이트 서버 |

창천 데이터는 새 환경으로 복사하지 않습니다. 독립 환경의 같은 CID·Google 계정은 다른 환경과 독립적으로 가입·관리됩니다. 한 환경의 최고 관리자는 다른 환경에 권한이 없습니다. `SERVICE_ROSTERS.md`의 개발자별 명부도 **그 인증 환경 내부의 기능**이며 외부 맹의 DB 독립을 대신하지 않습니다.

## 설치

Node.js 22 LTS와 npm을 사용합니다. 새 인증 서버를 사이트 프로젝트 안의 별도 폴더에 만듭니다. 기존 사이트 파일과 기존 인증 서버를 덮어쓰지 않습니다.

```sh
npm install --save-exact ./운영자가-제공한-검증된-SDK.tgz
npm install --save-dev wrangler@4.160.1
npx access-kit auth init --directory access-kit-auth --name 방주용영문이름 --auth-origin https://본인인증도메인 --firebase-project-id 본인프로젝트ID --firebase-api-key 본인웹API키 --firebase-auth-domain 본인인증호스트 --firebase-app-id 본인웹앱ID --plan
```

`--name`은 실제 영문 소문자·숫자·하이픈 이름을 사용합니다. Firebase 웹 설정은 자기 프로젝트에서 가져옵니다. 예시 값을 그대로 배포하지 않습니다. 관리자 개인키나 Google 비밀번호를 소스·채팅에 넣지 않습니다. 계획을 검토한 뒤 같은 명령에서 `--plan`을 제거합니다. 원격 리소스는 생성하지 않습니다.

생성물: 인증 Worker `worker.mjs`, 전체 DB 마이그레이션, `wrangler.jsonc`, 검사 기록 `access-kit.auth.json`, 로컬 실행·빌드 명령과 운영 안내입니다. 클라우드 계정·DB·Firebase는 설치하는 운영자 소유여야 합니다.

```sh
npx access-kit auth doctor --directory access-kit-auth --local
npx access-kit auth migrate --directory access-kit-auth --local
```

`access-kit-auth`에서 `npm install`, `npm run build`(배포 없는 dry-run), `npm run dev`로 로컬 서버를 확인합니다. 로컬 DB는 이 폴더의 `.wrangler/state`에 저장합니다. `auth migrate`도 같은 경로를 사용합니다. 실제 Google 로그인에는 자기 Firebase의 Google 공급자·승인 도메인 설정이 필요합니다.

## 별도 허락이 있는 원격 설치

원격 작업이 금지되어 있으면 이 절은 실행하지 않습니다. 허용되면 계정 소유자가 Cloudflare에 로그인하고 **자기 계정에 새로운 D1**을 만듭니다. 기존 창천/운영 D1을 재사용하지 않습니다. `wrangler.jsonc`의 placeholder `database_id`를 새 UUID로 바꿉니다. 이 도구는 UUID의 실제 소유권을 추측하지 않으므로 로그인 계정과 새 DB 생성 결과를 대조해야 합니다.

```sh
npx access-kit auth doctor --directory access-kit-auth
npx access-kit auth migrate --directory access-kit-auth --remote --plan
npx access-kit auth migrate --directory access-kit-auth --remote
```

자기 Firebase에 인증 서버의 승인 도메인을 추가한 후, 명시적으로 배포를 허락받았을 때만 `access-kit-auth` 안에서 `npm run deploy`를 실행합니다. `auth init`·`doctor`·`--plan`은 배포 명령이 아닙니다.

## 첫 관리자와 명부

1. 운영자가 자기 인증 서버에서 Google 로그인합니다. 가입 CID 입력 전에도 첫 관리자 설정이 가능합니다.
2. 자기 Firebase Authentication 사용자 목록에서 방금 로그인한 계정의 UID를 확인합니다. 이메일·게임 CID·다른 환경의 내부 회원 ID와 혼동하지 않습니다.
3. 설치 프로젝트 루트에서 아래 명령을 실행합니다. 기본 대상은 로컬이며 원격 DB에는 `--remote`를 명시합니다.

```sh
npx access-kit auth bootstrap --directory access-kit-auth --firebase-uid 본인의FirebaseUID --local --plan
npx access-kit auth bootstrap --directory access-kit-auth --firebase-uid 본인의FirebaseUID --local
```

이 명령은 **자기 DB에 이미 Google 로그인으로 연결된 활성 계정**만 첫 관리자로 설정합니다. 먼저 로그인한 아무 사용자에게 권한을 주지 않습니다. 관리자가 이미 있으면 다른 계정을 추가 최고 관리자로 승격하지 않습니다. 이후 관리자는 `/console#roles`에서 관리합니다.

4. `/console#seasons`에서 실제 시즌명과 소속(예: 방주)을 등록하고 사용할 시즌을 활성화합니다.
5. `/console#roster`에서 자기 명부 JSON/CSV/TSV를 가져오거나 입력합니다. 닉네임·CID 수정·삭제·복구도 이곳에서 합니다.
6. `/console#myrosters`에서 자기 소속의 공유 명부를 새 서비스 기본값으로 지정합니다. 여기의 공유는 **이 독립 환경 안의 여러 사이트가 공유한다**는 뜻입니다.
7. `/console#roles`에서 같은 맹의 다른 개발자를 초대하거나 권한을 부여합니다. `/developer/install`에서 각 서비스가 자기 환경의 명부를 선택하고 연결 정보를 복사합니다.
8. 사이트에 `LLM_INSTALLATION.md`의 짧은 지시문으로 SDK를 연결합니다. `authOrigin`은 방금 만든 자기 인증 서버입니다.

## 검증

명부 CID 가입자는 회원, 없는 CID 가입자는 방문자로 판정되는지 확인합니다. 익명·방문자의 HTML·API·자산은 보호 서비스에서 차단하고 회원은 통과시킵니다. 닉네임 차이는 입장 조건으로 쓰지 않고 관리자 확인으로 남깁니다. 개발자 역할은 자기 서비스에 한정합니다.

다른 환경의 명부·CID 연결·정지·최고 관리자·세션·토큰이 이 환경에 영향을 주지 않는지 확인합니다. 자기 명부를 수정·삭제해도 창천의 원본 DB는 바뀌지 않아야 합니다. 7일 로그인·기본 5분 권한 확인·로그아웃을 유지합니다.

합성 세션·로컬 D1 검증과 실제 Google 로그인·원격 배포 검증은 구분해서 보고합니다. 원격 작업 금지나 실제 계정 로그인이 미실시이면 그 사실을 남깁니다. HTTP 200, doctor 또는 빌드만으로 가입·게이트 검증을 대신하지 않습니다.
