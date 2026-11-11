# @goyoung2/access-kit

Private distribution through https://github.com/goyoung2/access-kit/releases.

```js
import {createGate} from '@goyoung2/access-kit/server';
const gate=createGate({clientId:'APP_ID',authOrigin:'https://AUTH_HOST',siteUrl:'https://SITE_HOST/',accessPolicy:'member'});
```

Pass `sessionSecret` and `serveAsset(request, identity)` to the returned handler.
The default session lasts up to seven days from central login. Authorization is rechecked on an incoming request after a five-minute lease.

`access-kit init` generates a Workers static-site adapter. `doctor` checks local configuration; `verify --url https://SITE/` checks anonymous protection. Full installation, updates and rollback: repository `docs/INSTALL.md`.
