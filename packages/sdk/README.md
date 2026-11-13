# @goyoung2/access-kit

Private distribution through https://github.com/goyoung2/access-kit/releases.

```js
import {createGate} from '@goyoung2/access-kit/server';
const gate=createGate({clientId:'APP_ID',authOrigin:'https://AUTH_HOST',siteUrl:'https://SITE_HOST/',accessPolicy:'member'});
```

Pass `sessionSecret` and `serveAsset(request, identity)` to the returned handler.
The default session lasts up to seven days from central login. Authorization is rechecked on an incoming request after a five-minute lease. An `admin` gate requires the central response to confirm both application access and operator status.

Sign out with a same-origin `POST /__accesskit/logout` and navigate to the login screen or site root after the response. The gate clears its site session cookie and suppresses automatic sign-in in that browser until the visitor explicitly signs in again. `X-Access-Kit-Revoke: failed` means the site cleared its cookie but could not confirm central token revocation. Even after confirmed revocation, a copied site cookie can retain access in another isolate for the rest of its existing lease (five minutes by default, or the configured `authorizationLeaseMs`), bounded by the session's expiration.

`access-kit init` generates a Workers static-site adapter. `doctor` checks local configuration; `verify --url https://SITE/` checks anonymous protection. Full installation, updates and rollback: repository `docs/INSTALL.md`.

## CLI 0.2

`init --plan` → `init` → `doctor` → `secret` → `deploy`.
`sync`는 원본 호스팅 설정을 다시 반영하고, `verify`는 모든 빌드 자산의 GET/HEAD/Range/잘못된 쿠키와 실행 버전을 검사합니다.
Pages의 운영 브랜치는 `init --branch BRANCH`로 저장하거나 `deploy --branch BRANCH`로 지정합니다. `prepare`와 `doctor`는 Pages Functions를 우회하는 빌드 산출물 `_worker.js`를 발견하면 중단합니다. `deploy`는 새 배포가 등록된 운영 URL에서 실제로 익명 요청을 차단하는지 확인합니다.

`update --package SDK.tgz --sha256 HASH`는 기존 의존성 백업, 해시 검증, 설치, 빌드 검사와 새 SDK 프로세스의 export·doctor 검사를 수행합니다. 실패하면 이전 의존성을 복원합니다.
자세한 설치·호스트별 예제·복구 절차: https://github.com/goyoung2/access-kit/blob/main/docs/INSTALL.md
