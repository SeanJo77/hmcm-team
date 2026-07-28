-- ══════════════════════════════════════════════════════════════
-- v11 마이그레이션: Claude 사용량 위젯 — 재설정 시각 컬럼 추가
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 하세요. (1회만)
-- ══════════════════════════════════════════════════════════════

-- 세션(5시간) 재설정 절대 시각 / 주간(모든 모델) 재설정 절대 시각.
-- 캡처 시점의 "N시간 M분 후 재설정" / "(요일) HH:MM에 재설정" 문구를
-- 절대 timestamptz로 환산해 저장 → 위젯에서 남은 시간·요일을 정확히 표시.
alter table claude_usage add column if not exists session_reset_at timestamptz;
alter table claude_usage add column if not exists weekly_reset_at timestamptz;
