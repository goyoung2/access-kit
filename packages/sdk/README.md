# @goyoung2/access-kit

Private distribution through https://github.com/goyoung2/access-kit/releases.

```js
import {createGate} from '@goyoung2/access-kit/server';
const gate=createGate({clientId:'APP_ID',authOrigin:'https://AUTH_HOST',siteUrl:'https://SITE_HOST/',accessPolicy:'member'});
```

Pass `sessionSecret` and `serveAsset(request, identity)` to the returned handler.
The default session lasts up to seven days from central login. Authorization is rechecked on an incoming request after a five-minute lease.

`access-kit init` generates a Workers static-site adapter. `doctor` checks local configuration; `verify --url https://SITE/` checks anonymous protection. Full installation, updates and rollback: repository `docs/INSTALL.md`.

## CLI 0.2

`init --plan` → `init` → `doctor` → `secret` → `deploy`.
`sync`는 원본 호스팅 설정을 다시 반영하고, `verify`는 모든 빌드 자산의 GET/HEAD/Range/잘못된 쿠키와 실행 버전을 검사합니다.
`update --package SDK.tgz --sha256 HASH`는 기존 의존성 백업, 해시 검증, 설치, 빌드 검사를 수행합니다.
자세한 설치·호스트별 예제·복구 절차: https://github.com/goyoung2/access-kit/blob/main/docs/INSTALL.md
