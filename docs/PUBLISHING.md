# 공개 SDK 게시

SDK·CLI는 공개 npm 패키지 `access-kit-sdk`로 배포합니다. 개발 저장소는 비공개로 유지할 수 있습니다. 중앙 인증기·운영 DB·회원 명부는 이 패키지와 별개입니다. 소스 수정·커밋·pack은 npm 게시나 중앙 서버 배포를 수행하지 않습니다.

## 게시 전 로컬 확인

1. `npm ci`, `npm run typecheck`, `npm test`를 실행합니다.
2. `npm run sdk:pack`으로 `dist/access-kit-sdk-VERSION.tgz`와 `SHA256SUMS`를 만듭니다. SDK 소스만 임시 폴더에 복사하고 설치·시작·어댑터·업데이트 문서를 포함합니다. DB·서버 설정·키·명부는 포함하지 않습니다.
3. 실제 tarball을 설치하여 CLI와 서버 게이트를 확인합니다. `packages/sdk/test/distribution.test.mjs`는 tarball 파일 경로 허용 목록과 필수 문서·public registry 설정을 검사합니다. update fixture는 실제 npm과 격리 레지스트리로 버전 고정·손상 패키지 복구를 확인합니다.
4. 검증된 소스를 커밋하고 패키지 버전과 같은 `access-kit-sdk-vX.Y.Z` 태그를 지정합니다. 같은 버전을 게시한 뒤 파일을 바꿔 다시 게시하지 않습니다. 이미 게시된 버전은 새 버전으로 올립니다. 이전 미게시 시도의 로컬 `v0.3.1` 태그는 이 패키지의 게시 태그로 사용하지 않습니다.

## 최초 게시와 권한

실제 게시 지시를 받은 뒤 진행합니다. `npm whoami`로 게시 계정을 확인하고 일반 패키지명 `access-kit-sdk`의 사용 가능 여부 또는 기존 게시 권한을 확인합니다. GitHub 아이디와 npm 계정은 일치할 필요가 없으며 조직 생성도 필요하지 않습니다. 소비자는 npm 로그인이 필요 없습니다.

최초 게시에는 npm 로그인/2FA를 이용한 수동 게시 또는 일회성 게시 토큰을 사용할 수 있습니다. 검토한 tarball을 대상으로 게시합니다.

```sh
npm publish ./dist/access-kit-sdk-X.Y.Z.tgz --access public --registry=https://registry.npmjs.org/
```

토큰을 사용하면 GitHub의 `npm-publish` environment secret `NPM_TOKEN`으로만 보관합니다. 소스·문서·출력에 값을 기록하지 않습니다. 최초 게시 후에는 패키지의 Trusted Publisher를 설정하고 일회성 토큰을 폐기합니다.

## 수동 GitHub Actions

`.github/workflows/publish-npm.yml`은 **workflow_dispatch 전용**입니다. push/태그 생성만으로 게시하지 않고, 중앙 서버나 DB를 배포하지 않습니다.

- npm Trusted Publisher: owner `goyoung2`, repository `access-kit`, workflow `publish-npm.yml`, environment `npm-publish`.
- Allowed actions에서 **Allow npm publish**를 선택합니다. 신규 설정의 기본 `npm stage publish`만으로는 이 workflow의 직접 게시를 허용하지 않습니다. Trusted Publisher 생성 후 2일 이내에 최초 게시를 완료해야 하며, 만료되면 설정을 새로 만듭니다.
- 같은 이름으로 GitHub environment를 준비합니다. npm CLI·Node 요구사항을 충족하는 Node 24 GitHub-hosted runner를 사용합니다.
- workflow 실행 시 패키지와 일치하는 `access-kit-sdk-vX.Y.Z` 태그 및 version 입력을 선택합니다. 브랜치나 버전 불일치는 거부합니다.
- 최초 토큰 방식만 `first_publish=true`를 선택합니다. 이후 기본값 false는 OIDC Trusted Publishing을 사용합니다.
- 로컬 검증과 tarball 생성 후 지정한 패키지만 공개 게시하고, 레지스트리 버전 조회와 `npm exec ... access-kit help`를 확인합니다.

비공개 저장소의 공개 패키지에는 npm provenance가 생성되지 않습니다. SDK를 공개한다고 개발 저장소 공개나 provenance 완료를 주장하지 않습니다. 게시 방식과 요구사항은 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)과 [일반 공개 패키지 안내](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)를 따릅니다.

## 서버와 소비 사이트 반영

SDK 게시와 중앙 인증 서버 배포는 별도입니다. 명부 CRUD가 포함된 현재 적용본은 DB 백업 → migration 0008까지 → 중앙 인증기 → 소비 SDK 순서로 반영합니다. 중앙 서버를 적용해야 명부 CRUD·`/guide`·npm 기반 설치 스튜디오가 운영에서 보입니다. 기존 세션 키와 회원 ID·정지·서비스 정책을 유지합니다. 실제 Google 로그인·승인 전후 차단·재접속은 원격 반영 후 별도로 검증합니다.
