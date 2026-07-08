-- schema.sql : CM기획팀 팀 관리 시스템 (Supabase PostgreSQL)
-- 원본: Google Sheets 'CM기획팀_이슈' (2026-07-07 마이그레이션)

-- ── 1. Note (전달 사항) ──────────────────────────
create table notes (
  id bigint generated always as identity primary key,
  no numeric,                        -- 전달사항 번호
  content text not null,
  created_at timestamptz default now()
);

-- ── 2. WBS 코드 체계 (Lv1~Lv3) ───────────────────
create table wbs_codes (
  id bigint generated always as identity primary key,
  lv1 text,                          -- 상단 메뉴 탭
  lv2 text,                          -- 소분류 그룹
  code text not null,                -- Lv3 실제 실행 메뉴 (예: 1.1.3 작업보고(기존))
  description text,
  priority numeric
);

-- ── 2-1. Activity 코드 (Lv4) ─────────────────────
create table wbs_activity_codes (
  id bigint generated always as identity primary key,
  code text not null,                -- 예: a. 조사 및 분석
  description text,
  activity_code text                 -- 2.Activity 코드
);

-- ── 3. WBS별 진행 현황 ───────────────────────────
create table wbs_tasks (
  id bigint generated always as identity primary key,
  lv3_menu text,
  lv4_detail text,
  lv5_work text,
  lv6_content text,
  assignee text,
  urgency text,                      -- S/A/B...
  start_date date,
  end_plan date,                     -- 최초 계획 이후 수정 금지 (Note 11)
  end_real date,                     -- 지연/조기 종료 시 입력 (Note 12)
  deliverable_no text,               -- 성과물 번호 참조
  progress numeric,                  -- 0.0 ~ 1.0
  remark text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 4. WBS별 이슈 ────────────────────────────────
create table wbs_issues (
  id bigint generated always as identity primary key,
  issue_date date,
  lv3_menu text,
  lv4_detail text,
  lv5_work text,
  lv6_content text,
  assignee text,
  agenda text,                       -- 안건 (Note 16)
  question text,                     -- 질의 사항/요청사항
  ref_material text,                 -- 참고 자료
  opinion text,                      -- 본인의 생각 (필수, Note 6)
  request_go text,                   -- 'GO' 활성화 (Note 10)
  feedback text,
  status text,                       -- 완료/진행중 등
  seq numeric,                       -- 순번 (이미지 연결 키)
  created_at timestamptz default now()
);

-- ── 4-1. 이슈 첨부 이미지 ────────────────────────
create table issue_images (
  id bigint generated always as identity primary key,
  issue_seq numeric not null,        -- wbs_issues.seq 참조
  image_path text not null           -- 사이트 내 assets 경로
);

-- ── 5. 주간 업무 요약 ────────────────────────────
create table weekly_summaries (
  id bigint generated always as identity primary key,
  week_label text not null,          -- 예: 7월 1주차
  week_start date,
  week_end date,
  member text not null,
  category text not null check (category in ('DONE','ISSUE','PLAN')),
  content text,
  created_at timestamptz default now()
);

-- ── 6. 성과물 (URLs) ─────────────────────────────
create table deliverables (
  id bigint generated always as identity primary key,
  no numeric,
  title text,
  output_ref text,
  url text,
  assignee text,
  remark text
);

-- ── 7. 참고자료 ──────────────────────────────────
create table reference_materials (
  id bigint generated always as identity primary key,
  no numeric,
  deliverable_no numeric,
  title text,
  url text,
  assignee text
);

-- ── 8. 일일 이슈 (일일 업무 기록) ─────────────────
create table daily_logs (
  id bigint generated always as identity primary key,
  week_label text,
  log_date date not null,
  member text not null,
  project text,                      -- 예: [BD-26-활용-02] bCMf
  subcode text,                      -- 예: e.S/W 설계
  content text,
  hours numeric,
  created_at timestamptz default now()
);

-- ── 9. 근태 관련 ─────────────────────────────────
create table attendance (
  id bigint generated always as identity primary key,
  att_date date,
  name text not null,
  att_type text,                     -- 연차/시차/출장/연장근무 등
  remark text,
  created_at timestamptz default now()
);

-- ── 10. 사이트 내 댓글 (운영규칙 개정 4) ──────────
create table comments (
  id bigint generated always as identity primary key,
  target_table text not null check (target_table in ('wbs_issues','wbs_tasks')),
  target_id bigint not null,
  author text not null,
  mention text,                      -- @멘션 대상 (Slack 알림 트리거)
  content text not null,
  created_at timestamptz default now()
);
create index on comments (target_table, target_id);

-- ── 인덱스 ───────────────────────────────────────
create index on wbs_tasks (assignee);
create index on wbs_tasks (start_date);
create index on wbs_issues (assignee);
create index on wbs_issues (status);
create index on wbs_issues (seq);
create index on weekly_summaries (week_start, member);
create index on daily_logs (log_date, member);
create index on attendance (att_date);

-- ── updated_at 자동 갱신 ─────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
create trigger trg_wbs_tasks_updated before update on wbs_tasks
  for each row execute function set_updated_at();

-- ── 운영규칙 강제 트리거 (개정안 v1 §3) ──────────

-- 개정 1: GO 제출 후 이슈 핵심 필드 잠금 (피드백/상태/GO 재요청만 허용)
create or replace function enforce_issue_lock() returns trigger as $$
begin
  if old.request_go is not null and old.request_go like 'GO%' then
    if new.agenda      is distinct from old.agenda
    or new.question    is distinct from old.question
    or new.opinion     is distinct from old.opinion
    or new.ref_material is distinct from old.ref_material
    or new.issue_date  is distinct from old.issue_date
    or new.assignee    is distinct from old.assignee then
      raise exception 'GO 제출 후에는 안건/질의/본인생각을 수정할 수 없습니다. 추가 의견은 댓글로 남기세요. (운영규칙 개정 1)';
    end if;
  end if;
  return new;
end; $$ language plpgsql;
create trigger trg_issue_lock before update on wbs_issues
  for each row execute function enforce_issue_lock();

-- 개정 2: Start/End(plan) 최초 입력 후 불변 + 완료 시 End(real) 필수
create or replace function enforce_task_rules() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    if old.start_date is not null and new.start_date is distinct from old.start_date then
      raise exception 'Start는 최초 입력 후 수정할 수 없습니다. (운영규칙 개정 2)';
    end if;
    if old.end_plan is not null and new.end_plan is distinct from old.end_plan then
      raise exception 'End(plan)는 최초 입력 후 수정할 수 없습니다. (운영규칙 개정 2)';
    end if;
  end if;
  if new.progress is not null and new.progress >= 1 and new.end_real is null then
    raise exception '진행률 100%% 처리 시 End(real) 입력이 필수입니다. (운영규칙 개정 2)';
  end if;
  return new;
end; $$ language plpgsql;
create trigger trg_task_rules before insert or update on wbs_tasks
  for each row execute function enforce_task_rules();

-- ※ 기존 seed 데이터에는 미완료 End(real) 27건이 있으므로,
--   트리거는 schema → seed 순서로 실행해도 신규 입력분부터만 적용되도록
--   seed.sql을 먼저 실행하거나, 본 스키마 실행 후 seed 실행 시
--   'set session_replication_role = replica;' 로 트리거를 일시 비활성화할 것 (README 참조).

-- ── RLS (Row Level Security) ─────────────────────
-- 기본: 읽기는 누구나(anon), 쓰기는 로그인 사용자만.
-- 로그인 기능을 쓰지 않기로 결정하면 아래 'authenticated'를 'anon'으로 변경.
do $$
declare t text;
begin
  foreach t in array array['notes','wbs_codes','wbs_activity_codes','wbs_tasks',
    'wbs_issues','issue_images','weekly_summaries','deliverables',
    'reference_materials','daily_logs','attendance','comments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "read_all" on %I for select using (true)', t);
    execute format('create policy "write_auth" on %I for insert to authenticated with check (true)', t);
    execute format('create policy "update_auth" on %I for update to authenticated using (true)', t);
    execute format('create policy "delete_auth" on %I for delete to authenticated using (true)', t);
  end loop;
end $$;

-- ── v2 개편: 공지(notices) — 작성은 팀장(master)만 ──
create table if not exists notices (
  id bigint generated always as identity primary key,
  author text not null default '조선두',
  content text not null,
  created_at timestamptz default now()
);
alter table notices enable row level security;
create policy "notice_read" on notices for select using (true);
create policy "notice_insert_master" on notices for insert to authenticated
  with check ((auth.jwt()->>'email') = 'b22042@hmcm.local');
create policy "notice_update_master" on notices for update to authenticated
  using ((auth.jwt()->>'email') = 'b22042@hmcm.local');
create policy "notice_delete_master" on notices for delete to authenticated
  using ((auth.jwt()->>'email') = 'b22042@hmcm.local');

-- ── v2 개편: 파일 스토리지 (자료실·성과물 업로드) ──
insert into storage.buckets (id, name, public) values ('files','files', true)
  on conflict (id) do nothing;
create policy "files_read" on storage.objects for select using (bucket_id = 'files');
create policy "files_insert" on storage.objects for insert to authenticated with check (bucket_id = 'files');
create policy "files_update" on storage.objects for update to authenticated using (bucket_id = 'files');
create policy "files_delete" on storage.objects for delete to authenticated using (bucket_id = 'files');

-- ── v6 개편: 인앱 알림 (in-app notifications) ──────
-- 멘션 댓글·팀장 카드 코멘트 시 대상자에게 알림 생성. 읽기는 전체, 쓰기는 로그인 사용자.
-- (앱은 recipient = 로그인 사용자 이름으로 필터링하여 표시)
create table if not exists notifications (
  id bigint generated always as identity primary key,
  recipient text not null,           -- 알림 대상자 이름 (CONFIG.TEAM)
  actor text,                        -- 알림을 발생시킨 사람
  type text,                         -- mention / weekly_comment / daily_comment 등
  message text not null,             -- 표시 문구
  link text,                         -- 클릭 시 이동할 해시 경로 (예: #/issues/123)
  is_read boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_notif_recipient on notifications (recipient, is_read);
alter table notifications enable row level security;
create policy "notif_read"   on notifications for select using (true);
create policy "notif_insert" on notifications for insert to authenticated with check (true);
create policy "notif_update" on notifications for update to authenticated using (true);
create policy "notif_delete" on notifications for delete to authenticated using (true);

-- ── v6 개편: 카드 코멘트 (주간/일일 팀장 코멘트) ──
-- 주간 업무 요약(주차×팀원)·일일 기록(일자×팀원) 카드에 팀장이 남기는 코멘트.
-- 열람은 전체, 작성·삭제는 앱에서 팀장(master)만 허용(RLS는 로그인 사용자 허용).
create table if not exists card_comments (
  id bigint generated always as identity primary key,
  scope text not null,               -- 'weekly' | 'daily'
  card_key text not null,            -- weekly: '<week_label>|<member>' , daily: '<log_date>|<member>'
  author text not null,
  content text not null,
  created_at timestamptz default now()
);
create index if not exists idx_cardcmt on card_comments (scope, card_key);
alter table card_comments enable row level security;
create policy "cardcmt_read"   on card_comments for select using (true);
create policy "cardcmt_insert" on card_comments for insert to authenticated with check (true);
create policy "cardcmt_update" on card_comments for update to authenticated using (true);
create policy "cardcmt_delete" on card_comments for delete to authenticated using (true);
