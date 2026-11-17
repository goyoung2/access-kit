# 기존 서버에 직접 연결

## Fetch API 서버 (Workers, Hono, Vercel Edge 등)

인증기를 호출하는 쪽은 서버입니다. 세션 secret을 브라우저로 전달하지 않습니다. 모든 HTML·API·정적 자산 요청이 이 경로를 통과하도록 호스트 라우팅을 설정합니다.

```js
import {createGate} from 'access-kit-sdk/server';
import original from './existing-handler.js';
import settings from './access-kit.json' with {type:'json'};
const gate=createGate(settings);
export * from './existing-handler.js';
export default {
  ...original,
  fetch(request,env,ctx) {
    return gate(request,{
      sessionSecret:env.ACCESS_KIT_SESSION_SECRET,
      serveAsset:(r,identity)=>original.fetch.call(original,r,env,ctx,identity),
    });
  },
};
```

게이트는 로그인 처리용 `/__accesskit/*`를 사용합니다. 기존 서비스가 이 경로를 사용하면 먼저 충돌을 해결합니다. 로그인한 요청의 HTTP method와 body는 그대로 기존 handler에 전달됩니다. 기존 API의 CSRF/권한 세부 정책도 유지하세요. 서비스 바인딩 RPC·scheduled·queue는 HTTP 사용자 로그인 경로와 별개이며 원래 동작을 유지합니다.

Workers CLI는 위 adapter와 원본 Wrangler 설정 복사본을 생성합니다. WorkerEntrypoint 클래스는 클래스의 fetch 안에서 gate를 호출합니다. 다른 메서드는 변경하지 않습니다.

## 기존 Pages middleware

기존 루트 middleware의 onRequest를 `existing`이라는 로컬 변수로 바꾸고 인증 함수를 배열 맨 앞에 연결합니다. 같은 파일 안에서 변경하므로 기존 상대 import 경로는 유지됩니다.

```js
import {createGate} from 'access-kit-sdk/server';
import settings from '../access-kit.json' with {type:'json'};
const gate=createGate(settings);
// 기존 함수 본문을 그대로 유지합니다.
const existing=async context=>context.next();
const authenticate=context=>gate(context.request,{
  sessionSecret:context.env.ACCESS_KIT_SESSION_SECRET,
  serveAsset:(request,identity)=>{
    context.data.accessKit=identity;
    return context.next(request);
  },
});
export const onRequest=[authenticate,...(Array.isArray(existing)?existing:[existing])];
```

빌드 폴더 `_routes.json`은 `{ "version":1, "include":["/*"], "exclude":[] }`로 설정합니다. 빌드가 파일을 다시 생성하면 build 마지막 단계에 같은 설정을 생성하도록 추가합니다. Advanced `_worker.js`는 위 Worker adapter처럼 원래 worker를 감쌉니다. 기존 도메인·환경변수·DB bindings를 유지합니다.

## 기타 호스팅

Vercel/Netlify/Node 서버에서는 해당 프레임워크의 Request/Response adapter를 사용해 위 Fetch API 함수로 연결합니다. 정적 public 파일이 서버를 우회하지 않도록 설정하는 것이 먼저입니다. 프레임워크마다 라우팅 규약이 달라 CLI 자동 변환을 제공하지 않습니다. 인증 middleware 한 파일을 추가한 것만으로 사이트 전체 보호가 완료된 것으로 처리하지 마세요. 실제 빌드 파일별 GET/HEAD/Range를 확인합니다.

서버 실행 계층이 없는 GitHub Pages 단독 호스팅은 비공개 자산 보호를 적용할 수 없습니다. 같은 정적 결과물을 Workers/Pages의 서버 게이트 뒤에 배포합니다.

### Cloudflare Worker 간 통신

자동 Workers 설정은 기존 compatibility_flags를 유지하면서 `global_fetch_strictly_public`을 추가합니다. 인증 Worker에 HTTP 요청을 보내는 데 필요합니다. 기존 애플리케이션이 같은 zone의 origin 직접 fetch에 의존한다면 자동 설치 대신 AUTH service binding을 사용하세요. 이 차이는 init --plan에 표시됩니다.

```js
// Wrangler services에 {binding:'ACCESS_KIT_AUTH',service:'인증기-Worker-이름'} 추가
return gate(request,{
  sessionSecret:env.ACCESS_KIT_SESSION_SECRET,
  fetchAuth:(input,init)=>env.ACCESS_KIT_AUTH.fetch(input,init),
  serveAsset:(r,identity)=>original.fetch(r,env,ctx,identity),
});
```

Pages의 기존 설정에는 같은 compatibility flag를 명시합니다. 새 Pages 프로젝트에는 CLI가 설정 파일을 생성합니다.
