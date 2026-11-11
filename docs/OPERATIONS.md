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

인증은 D1만 사용하고 R2를 읽지 않습니다. 사용 중 5분 lease 만료 후 요청에 한해 권한을 조회합니다. 브라우저 polling과 재접속별 세션 연장은 없습니다. 만료 데이터 정리는 `scheduled` 핸들러를 제공하므로 운영 cron을 하루 1회 지정합니다.

저장소·릴리스는 비공개이고 설치 페이지/API는 개발자 인증을 요구합니다. robots와 X-Robots-Tag는 noindex입니다. Google 로그인 페이지와 브라우저 SDK는 로그인 전에 필요하므로 접근 가능하지만 회원 정보나 서버 비밀키를 포함하지 않습니다.

데이터 변경과 승인 이력은 auth_events에 기록합니다. 인증 서버 장애는 회원 정지로 처리하지 않습니다. 서비스는 현재 lease 만료 후 장애를 알리고 재시도할 수 있습니다.

## 개발자 초대와 권한 관리 (0.2)

최초 운영자 설정 후에는 `/developer/admin`에서 개발자를 관리합니다. 등록된 사용자에게 권한을 부여/해제하거나, 7일 동안 한 번 사용하는 초대 링크를 생성합니다. 초대받은 개발자는 Google 로그인 후 링크에서 수락합니다. GitHub 비공개 저장소 접근 권한은 별도로 저장소 Settings → Collaborators에서 부여합니다. 페이지에 해당 관리 링크를 제공합니다. 개발자 권한은 회원 승인이나 시즌 자격을 자동 부여하지 않습니다.

기존 배포를 0.2로 올릴 때 `0002_developer_invitations.sql` migration을 적용합니다. 기존 회원/세션/게임 UID를 변경하지 않고 초대 테이블만 추가합니다.
