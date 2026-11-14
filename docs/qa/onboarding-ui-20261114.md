# 가입 상태별 화면 수정 및 임시 서버 검증

2026-11-14. 구현 commit `391ffe4b286cfa63df13af7a0bd408165daaec8e`.

## 수정과 배포

- `/auth/firebase/continue`에서 미승인 계정 전체에 붙이던 고정 거절 문구를 제거했습니다. 회원 판정과 인증 코드 발급 제한은 그대로입니다.
- 로그인 후 안내는 “Google 로그인이 완료되었습니다”로 바뀝니다.
- 최초 가입: 빈 가입 양식과 신청 안내.
- 승인 대기: 신청 양식 없이 승인 대기 안내와 상태 확인 버튼.
- 거절: 거절 안내, 기존 입력값이 채워진 수정 가능한 양식, “수정 후 재신청” 버튼.
- 정지: 정지 안내만 표시하며 가입·재신청 양식은 표시하지 않습니다.
- 승인 후 소속 불일치는 신규 가입과 분리해 소속 확인 안내를 표시합니다.
- 거절·정지 안내는 기존 danger 색상, 가입·승인 대기는 muted 색상을 사용합니다.

배포 대상은 임시 중앙 서버 **`ak-auth-trial-20261114`** 하나입니다.
주소: https://ak-auth-trial-20261114.nakwol.workers.dev/
Cloudflare version: `10a4c27f-31da-4e79-b255-ae3d3c55470c`.
이전 version: `1e52b7e6-3dc1-4181-9cb1-05c36bf5a5ef`.
소비 사이트: https://ak-atlas-trial-20261114.nakwol.workers.dev/

운영 인증 서버·명부와 실제 사용자 신청/승인 상태는 수정하지 않았습니다. 새 합성 QA 계정 5개만 시험 D1에 추가했습니다. SDK, DB 스키마, 회원 정책, 세션 정책 변경이나 npm 게시·GitHub push는 없습니다.

## 실행한 검증

1. 회귀 테스트를 먼저 실행해 신규 가입에 고정 `notice`가 남는 실패를 확인했습니다. 수정 후 같은 테스트는 통과했고 인증 코드가 생성되지 않는 제한도 확인했습니다.
2. 기존 검사를 포함한 `npm test` **68/68**, `npm run typecheck` 통과.
3. 실제 로컬 Hono/D1와 Chrome으로 신규·승인 대기·거절·정지·소속 불일치·로그아웃 **6개 화면** 확인.
4. 배포한 시험 서버에서도 같은 **6개 화면**을 Chrome으로 확인. HTTP 상태/문구/양식·버튼 표시/모바일 390px 가로 넘침/JS 오류를 검사했습니다.
5. 신규 가입과 거절 재신청은 실제 `/auth/firebase/apply` POST 200 후 승인 대기로 전환됐고 상태 확인 버튼도 동작했습니다. 거절 양식의 닉네임·서버·UID가 보존됐습니다.
6. QA 계정의 중앙 `/me`와 소비 사이트 `/__accesskit/session`은 미승인·정지·소속 불일치 상태에서 계속 **403**이었습니다. 익명 데이터 직접 조회는 **401/본문 0 bytes**였습니다.
7. 기존 합성 승인 회원으로 실제 `/authorize` → `/continue` → PKCE `/token` → SDK 세션을 거쳐 데이터 **18,000건 200**, 기존 POST API의 method/body/환경 바인딩 보존을 확인했습니다.
8. 별도 읽기 전용 리뷰에서 권한 제한·재신청 처리·화면 분기를 대조해 승인했습니다.

이 검사의 로그인 세션은 합성 계정을 시험 DB에 등록해 사용했습니다. 상태 API·신청 API·페이지·SDK 응답은 원격 실제 서버의 응답이며 mock하지 않았습니다. 이 실행에서 실제 Google 계정으로 새 로그인한 것은 아닙니다. 사용자가 제시한 최초 가입 화면과 별도의 회귀 검증입니다.

## 화면과 근거

공개 가능한 JSON 및 화면 캡처는 `onboarding-ui-20261114/`에 보관합니다. 쿠키·토큰·raw 설정과 SQL은 포함하지 않습니다.

- `remote-results.json`: 원격 6상태와 신청/재신청 전환 및 403 게이트.
- `approved-gate.json`: 승인 회원의 실제 원격 PKCE·데이터·POST API와 익명 차단.
- `local-results.json`: 로컬 6상태.
- `registration.png`, `pending.png`, `rejected.png`, `suspended.png`: 배포 후 화면.
- `rejected-mobile.png`: 390px에서의 재신청 양식.

QA harness와 합성 입력은 `C:/Users/sepsd/AppData/Local/Temp/access-kit-hosted-20261114/onboarding` 및 같은 상위 폴더의 `check-login-ui.mjs`, `local-login-fixture.mjs`, `seed-login-remote.mjs`, `check-approved-after-ui.mjs`에 있습니다.

SDK를 다시 설치할 필요는 없습니다. 기존 화면의 로그인 요청이 이미 만료됐다면 소비 사이트의 루트 주소에서 다시 접속해 새 요청을 시작하면 됩니다.
