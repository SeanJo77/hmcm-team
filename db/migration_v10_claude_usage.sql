-- ══════════════════════════════════════════════════════════════
-- v10 마이그레이션: Claude Max 플랜 사용량 위젯
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 하세요. (1회만)
-- ══════════════════════════════════════════════════════════════

-- ── Claude 사용량 (claude_usage) ──
--    Claude Max 플랜의 세션(5시간)/주간 사용량(%)을 주기적으로 기록.
--    Anthropic이 이 값을 API로 제공하지 않아, 예약작업이 claude.ai 설정
--    화면을 판독해 채워 넣는 방식. 읽기는 전체 공개, 쓰기는 service_role만
--    (insert/update 정책을 두지 않음 → anon/authenticated는 쓰기 불가).
create table if not exists claude_usage (
  id bigint generated always as identity primary key,
  session_pct numeric,               -- 세션(5시간 롤링) 사용량 %
  weekly_pct numeric,                -- 주간 전체 사용량 %
  weekly_sonnet_pct numeric,         -- 주간 Sonnet 전용 사용량 % (없으면 null)
  captured_at timestamptz default now()
);
create index if not exists idx_claude_usage_captured on claude_usage (captured_at desc);

alter table claude_usage enable row level security;
create policy "claude_usage_read" on claude_usage for select using (true);
