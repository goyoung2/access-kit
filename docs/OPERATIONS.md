# 인증 서버 운영

## 독립 리소스

Firebase 프로젝트 `nslg-auth-system`의 Google 로그인을 사용할 수 있습니다. 웹 앱 apiKey/projectId/authDomain/appId는 클라이언트 설정입니다. Firebase Admin 개인키 없이 Google 공개 서명키로 토큰을 검증합니다.

새 Worker와 새 D1을 만듭니다. 기존 인증기의 Worker/D1에 배포하지 않습니다. `wrangler d1 create access-kit` 결과의 database_id를 wrangler.jsonc에 넣고, `wrangler d1 migrations apply access-kit --remote`로 초기 스키마를 적용합니다. 최초 배포 전 Firebase 승인 도메인에 새 인증 서버 호스트를 등록합니다.

`.dev.vars.example`의 값은 로컬 `.dev.vars`에 설정합니다. 운영 환경에도 AUTH_PROVIDER=firebase와 Firebase 웹 설정, AUTH_ORIGIN을 설정하고 `npm ci`, `npm run typecheck`, `npm test`, `npm run deploy`를 실행합니다. PUBLIC GitHub Pages 대신 인증 서버의 `/developer/install`을 배포 안내 페이지로 사용합니다.

## 최초 운영자와 개발자

최초 운영자가 Google 로그인한 뒤 DB의 auth_identities에서 해당 Firebase UID와 연결된 users.id를 확인합니다. 이메일·닉네임만으로 다른 기존 회원과 자동 연결하지 않습니다.

```sql
INSERT INTO auth_operators(user_id,role,created_at,created_by_user_id)
VALUES('확인한_USER_ID','operator',unixepoch()*1000,NULL);
INSERT INTO developers(user_id,status) VALUES('확인한_개발자_USER_ID','active');
```

운영자는 `/auth/firebase/admin`에서 시즌·맹을 만들고 가입 신청을 승인합니다. 개발자 권한은 회원 승인과 별개입니다. 개발자는 자신의 서비스만 수정하며 운영자는 전체를 관리합니다. 해제는 developers.status='inactive'. 최초 운영자 부여는 운영 DB 권한으로만 합니다.

## 회원 이관

로컬 비교 도구: `node scripts/import-local.mjs 기존_공통인증_작업폴더`. 원본은 읽기만 하고, 새 DB에 users/Google 연결/승인·정지/게임UID/시즌 명부를 트랜잭션으로 삽입합니다. 대상에 회원이 있으면 덮어쓰지 않습니다. 계정 수를 대조하고 세션·토큰은 이관하지 않습니다.

운영 이전은 원본 백업, 동일 테이블 내보내기, 새 DB staging 대조, 내부 ID·정지·시즌 정책 확인 후 전환합니다. 아직 Google 계정이 없는 기존 회원은 관리자 승인 시 기존 내부 ID에 명시적으로 연결합니다. 과거 자격을 임의로 승인 회원으로 바꾸지 않습니다. 기존 서비스 앱의 정책이 없으면 접근은 거절됩니다.

## 비용·갱신·보호

중앙 서버는 **Cloudflare Workers + D1 Free로 시작하는 구성**을 기본으로 하며 유료 플랜 선결제를 요구하지 않습니다. Workers 계정당 하루 100,000요청·요청당 CPU 10ms, D1 하루 5,000,000행 읽기·100,000행 쓰기와 DB당 500MB·계정 합계 5GB가 무료 기준입니다. [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/) · [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 한도](https://developers.cloudflare.com/d1/platform/limits/)를 운영 시 다시 확인합니다. 같은 계정의 다른 Worker 사용량도 계정 한도에 포함합니다.

인증은 D1만 사용하고 R2를 읽지 않습니다. 사용 중 5분 lease 만료 후 요청에 한해 권한을 조회합니다. 브라우저 polling과 재접속별 세션 연장은 없습니다. 108명·서비스 3개·하루 2시간·기기 1개의 보수적 예상은 중앙 요청 11,664건/일이며 관리자 경로 최적화의 로컬 CPU 평균은 3.91~7.29ms입니다. [측정 근거](qa/admin-cpu-20261114.md)의 로컬 값과 실제 Cloudflare 요청별 cpuTime은 구분합니다. 배포가 허가된 뒤 CPU 분포·한도 오류·D1 읽기/쓰기·저장량을 확인하며, 사용자 허가 없이 유료 전환이나 정책 완화를 하지 않습니다.

만료 데이터 정리용 `scheduled` 핸들러는 있으나 현재 `wrangler.jsonc`에는 cron trigger가 없습니다. 정기 정리가 이미 예약된 것으로 간주하지 않습니다. 배포가 허가되면 저장량 증가와 정리 작업의 CPU·처리 범위를 확인한 뒤 주기를 설정합니다. 소스 문서 반영만으로 cron이나 운영 DB를 변경하지 않습니다.

SDK·CLI는 공개 npm 패키지이며 `/guide`는 로그인이나 DB 접근 없이 안내만 제공합니다. 개발 저장소를 공개할 필요는 없습니다. 서비스 설정을 읽거나 쓰는 `/developer/install`·API는 계속 개발자 인증을 요구합니다. robots와 X-Robots-Tag는 noindex입니다. Google 로그인 페이지와 브라우저 SDK도 접근 가능하지만 회원 정보나 서버 비밀키를 포함하지 않습니다. 공개 SDK 설치는 개발자 권한·회원 승인·명부 접근을 부여하지 않습니다.

서비스별 승인 회원 전체 / 현재 시즌 지정 조직(맹) / 최고 관리자 전용 정책을 선택합니다. 명부를 사용하는 운영에서는 맹·시즌을 등록하되, 모든 소비 서비스에 같은 맹 제한을 강제하지 않습니다. 기존 회원 ID와 정지·서비스 정책은 유지합니다.

데이터 변경과 승인 이력은 auth_events에 기록합니다. 인증 서버 장애는 회원 정지로 처리하지 않습니다. 서비스는 현재 lease 만료 후 장애를 알리고 재시도할 수 있습니다.

## 개발자 초대와 권한 관리 (0.2)

최초 운영자 설정 후에는 `/developer/admin`에서 개발자를 관리합니다. 등록된 사용자에게 권한을 부여/해제하거나, 7일 동안 한 번 사용하는 초대 링크를 생성합니다. 초대받은 개발자는 Google 로그인 후 링크에서 수락합니다. SDK 사용을 위해 GitHub 저장소 초대를 보낼 필요는 없습니다. 개발자 권한은 회원 승인이나 시즌 자격을 자동 부여하지 않습니다.

기존 배포를 0.2로 올릴 때 `0002_developer_invitations.sql` migration을 적용합니다. 기존 회원/세션/게임 UID를 변경하지 않고 초대 테이블만 추가합니다.
