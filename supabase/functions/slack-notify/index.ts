// slack-notify: Supabase Database Webhook → Slack Incoming Webhook 변환 함수
// 운영규칙 개정 4 — 알림 이벤트: GO 제출 / 피드백 등록 / 댓글 @멘션
// 배포: Supabase Dashboard > Edge Functions > New Function 에 본 코드 붙여넣기
// 시크릿: SLACK_WEBHOOK_URL 을 Edge Functions > Secrets 에 등록

Deno.serve(async (req) => {
  const SLACK_URL = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!SLACK_URL) return new Response("SLACK_WEBHOOK_URL not set", { status: 500 });

  const payload = await req.json(); // Database Webhook payload: { type, table, record, old_record }
  const { type, table, record, old_record } = payload;
  let text: string | null = null;

  if (table === "wbs_issues") {
    const go = record?.request_go ?? "";
    const oldGo = old_record?.request_go ?? "";
    const oldFb = old_record?.feedback ?? "";
    if (go.startsWith("GO") && go !== oldGo) {
      text = `:rocket: *GO 요청* [${go}] ${record.assignee ?? ""} — ${(record.agenda ?? "").slice(0, 80)}\n피드백 검토가 필요합니다.`;
    } else if (record?.feedback && record.feedback !== oldFb) {
      text = `:speech_balloon: *피드백 등록* → ${record.assignee ?? ""} — ${(record.agenda ?? "").slice(0, 80)}\n${(record.feedback ?? "").slice(0, 200)}`;
    }
  } else if (table === "comments" && type === "INSERT") {
    const mention = record?.mention ? ` → @${record.mention}` : "";
    text = `:memo: *새 댓글* (${record.author}${mention}) [${record.target_table} #${record.target_id}]\n${(record.content ?? "").slice(0, 200)}`;
  }

  if (!text) return new Response("skip", { status: 200 });

  const r = await fetch(SLACK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return new Response(r.ok ? "sent" : "slack error", { status: r.ok ? 200 : 502 });
});
