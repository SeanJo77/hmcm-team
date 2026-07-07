# CM기획팀 업무 관리 시스템

Google Sheets(CM기획팀_이슈)를 대체하는 팀 관리 웹사이트.
GitHub Pages(프론트) + Supabase 무료 티어(DB·인증·알림). 개인 PC 서버 불필요.

운영규칙 개정안 v1(`docs/운영규칙_개정안_v1.md`)의 시스템 강제 항목 내장:
GO 제출 후 이슈 잠금(DB 트리거) · Start/End(plan) 불변 · 완료 시 End(real) 필수 · 사이트 내 댓글 + Slack 알림.

---

## 배포 절차 (총 30~40분)

### 1. Supabase 프로젝트 (10분)

1. https://supabase.com 가입 → New Project (리전: Northeast Asia Seoul 권장)
2. SQL Editor에서 순서대로 실행:
   1) `db/schema.sql` 전체 실행
   2) 새 쿼리에서 아래 3줄로 seed 실행 (기존 데이터에 트리거 예외가 있으므로 반드시 이 방식으로):
      ```sql
      set session_replication_role = replica;  -- 트리거 일시 비활성
      -- (여기에 db/seed.sql 내용 붙여넣기)
      set session_replication_role = origin;
      ```
3. Authentication > Users > Add user 로 팀원 6명 이메일·비밀번호 등록
   (Authentication > Providers 에서 Email 로그인 활성 상태 확인)
4. Project Settings > API 에서 `Project URL`과 `anon public key` 복사

### 2. 프론트엔드 설정 (2분)

`js/config.js` 에 위에서 복사한 값 입력:
```js
SUPABASE_URL: "https://xxxx.supabase.co",
SUPABASE_ANON_KEY: "eyJ...",
```

### 3. GitHub Pages 배포 (10분)

1. GitHub에서 새 저장소 생성 (예: `hmcm-team`) — Private 가능하나 Pages는 Public 저장소에서 무료
2. 이 폴더(`hmcm-web/`) 내용 전체 업로드 (웹 UI: Add file > Upload files 로 드래그)
3. Settings > Pages > Source: `main` branch, `/ (root)` → Save
4. 1~2분 후 `https://<계정>.github.io/<저장소명>/` 접속 확인
5. Settings > Secrets and variables > Actions 에 keep-alive용 시크릿 2개 등록:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` (Actions가 주 2회 ping → 무료 티어 일시정지 방지)

### 4. Slack 알림 연동 (10분, 운영규칙 개정 4)

1. Slack 워크스페이스에서 Incoming Webhook 생성:
   https://api.slack.com/apps > Create App > Incoming Webhooks 활성 > 채널 지정 > Webhook URL 복사
2. Supabase Dashboard > Edge Functions > Deploy new function
   - 이름: `slack-notify`, 코드: `supabase/functions/slack-notify/index.ts` 붙여넣기
   - Secrets에 `SLACK_WEBHOOK_URL` 등록
   - Details 에서 "Verify JWT" **비활성화** (DB Webhook이 직접 호출하므로)
3. Database > Webhooks > Create webhook (2개):
   - `wbs_issues` 테이블, 이벤트 UPDATE → HTTP POST → slack-notify 함수 URL
   - `comments` 테이블, 이벤트 INSERT → HTTP POST → slack-notify 함수 URL

### 5. 확인 체크리스트

- [ ] 사이트 접속 → 대시보드에 과업/이슈 수치 표시
- [ ] 로그인 → 이슈 등록 → GO 제출 → Slack 채널 알림 수신
- [ ] GO 제출된 이슈의 안건 수정 시도 → 차단 메시지 확인
- [ ] 과업 진행률 100% 입력 → End(real) 요구 확인

---

## 구조

```
index.html            SPA 진입점
css/style.css         스타일
js/config.js          Supabase 연결 설정 (배포 시 수정)
js/app.js             전체 앱 로직 (라우팅·화면·규칙 강제)
db/schema.sql         테이블 12개 + RLS + 운영규칙 트리거
db/seed.sql           기존 시트 데이터 2,097건
assets/issue-images/  이슈 첨부 이미지 13개
supabase/functions/   Slack 알림 Edge Function
.github/workflows/    Supabase keep-alive (주 2회)
docs/                 운영규칙 개정안 v1
```

## 운영 메모

- 읽기: 로그인 불필요 / 등록·수정: 로그인 필요 (RLS)
- 일일 기록은 ERP 원본 유지 — 사이트는 조회·집계 전용. 갱신은 관리자가 SQL Editor에서 insert (또는 추후 CSV 업로드 기능 추가)
- Supabase 무료 한도: DB 500MB (현 사용량 0.4MB), 프로젝트 일시정지는 keep-alive로 방지
- 문제 발생 시: Supabase Dashboard > Logs, 브라우저 F12 콘솔 확인
