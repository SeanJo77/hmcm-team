/* CM기획팀 업무 관리 시스템 — SPA (Supabase + GitHub Pages)
   운영규칙 개정안 v1 반영: GO 잠금, End(real) 필수, 사이트 내 댓글(+Slack 알림) */
"use strict";

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
let session = null;

/* ── helpers ─────────────────────────────────── */
const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const esc = (v) => v == null ? "" : String(v)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const fmtD = (v) => v ? String(v).slice(0, 10) : "";
const today = () => new Date().toISOString().slice(0, 10);
const pct = (v) => v == null ? "" : Math.round(v * 100) + "%";

function toast(msg, err = false) {
  const d = document.createElement("div");
  d.className = "toast-item" + (err ? " err" : "");
  d.textContent = msg;
  $("#toast").appendChild(d);
  setTimeout(() => d.remove(), 4200);
}
function needLogin() { toast("로그인이 필요합니다. 좌측 하단에서 로그인하세요.", true); }
function statusBadge(s) {
  if (!s) return '<span class="badge b-gray">-</span>';
  const m = { "완료": "b-done", "미해결": "b-late", "보류": "b-warn", "공지": "b-gray", "진행중": "b-prog" };
  return `<span class="badge ${m[s] || "b-prog"}">${esc(s)}</span>`;
}
function goBadge(g) {
  if (!g) return '<span class="badge b-gray">대기</span>';
  if (g === "Cancel") return '<span class="badge b-gray">Cancel</span>';
  return `<span class="badge b-go">${esc(g)}</span>`;
}
function progBar(p) {
  const w = p == null ? 0 : Math.min(100, Math.round(p * 100));
  return `<span class="prog-wrap"><span class="prog-fill" style="width:${w}%"></span></span> <small>${pct(p)}</small>`;
}
function sel(name, options, selected, allLabel) {
  return `<select name="${name}" id="f-${name}">` +
    (allLabel ? `<option value="">${allLabel}</option>` : "") +
    options.map(o => `<option value="${esc(o)}" ${o === selected ? "selected" : ""}>${esc(o)}</option>`).join("") +
    `</select>`;
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) { toast(error.message, true); throw error; }
  return data;
}

/* ── auth ─────────────────────────────────────── */
async function initAuth() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  renderAuth();
  sb.auth.onAuthStateChange((_e, s) => { session = s; renderAuth(); });
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({
      email: $("#login-email").value, password: $("#login-pw").value });
    if (error) toast("로그인 실패: " + error.message, true);
    else toast("로그인 완료");
  });
  $("#btn-logout").addEventListener("click", async () => { await sb.auth.signOut(); toast("로그아웃"); });
}
function renderAuth() {
  $("#auth-form").classList.toggle("hidden", !!session);
  $("#auth-user").classList.toggle("hidden", !session);
  if (session) $("#auth-email").textContent = session.user.email;
}
const canWrite = () => !!session;

/* ── router ───────────────────────────────────── */
const routes = {
  "/": vDashboard, "/tasks": vTasks, "/issues": vIssues, "/issues/:id": vIssueDetail,
  "/issues/new": vIssueNew, "/weekly": vWeekly, "/daily": vDaily,
  "/deliverables": vDeliverables, "/attendance": vAttendance, "/notes": vNotes,
};
async function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  document.querySelectorAll("#sidebar nav a").forEach(a => {
    const r = a.dataset.route;
    a.classList.toggle("active", r === "/" ? hash === "/" : hash.startsWith(r));
  });
  app.innerHTML = '<div class="loading">불러오는 중…</div>';
  try {
    if (hash === "/issues/new") return await vIssueNew();
    const m = hash.match(/^\/issues\/(\d+)$/);
    if (m) return await vIssueDetail(+m[1]);
    await (routes[hash] || vDashboard)();
  } catch (e) {
    app.innerHTML = `<div class="panel">데이터를 불러오지 못했습니다.<br><small class="muted">${esc(e.message || e)}</small>
      <p class="muted" style="margin-top:8px">js/config.js 의 Supabase URL/KEY 설정을 확인하세요.</p></div>`;
  }
}

/* ── 대시보드 ─────────────────────────────────── */
async function vDashboard() {
  const [tasks, issues, att] = await Promise.all([
    q(sb.from("wbs_tasks").select("*")),
    q(sb.from("wbs_issues").select("id,issue_date,assignee,agenda,status,request_go").order("id", { ascending: false }).limit(400)),
    q(sb.from("attendance").select("*").gte("att_date", today()).order("att_date").limit(10)),
  ]);
  const t = today();
  const open = tasks.filter(x => (x.progress ?? 0) < 1);
  const late = open.filter(x => x.end_plan && x.end_plan < t);
  const openIssues = issues.filter(x => x.status !== "완료" && x.request_go !== "Cancel");
  const avg = tasks.length ? tasks.reduce((s, x) => s + (x.progress ?? 0), 0) / tasks.length : 0;

  app.innerHTML = `
  <h1>대시보드</h1><p class="page-sub">CM기획팀 업무 현황 요약 (${t})</p>
  <div class="cards">
    <div class="card"><div class="num">${open.length}</div><div class="lbl">진행 중 과업</div></div>
    <div class="card"><div class="num" style="color:var(--danger)">${late.length}</div><div class="lbl">기한 경과 과업</div></div>
    <div class="card"><div class="num">${pct(avg)}</div><div class="lbl">전체 평균 진행률</div></div>
    <div class="card"><div class="num" style="color:var(--warn)">${openIssues.length}</div><div class="lbl">미완료 이슈</div></div>
  </div>
  <div class="panel"><h2>기한 경과 과업 (End(plan) 초과·미완료)</h2>${late.length ? `
    <div class="tbl-wrap"><table><thead><tr><th>업무</th><th>담당</th><th>End(plan)</th><th>진행률</th></tr></thead><tbody>
    ${late.sort((a, b) => (a.end_plan || "").localeCompare(b.end_plan || "")).map(x => `
      <tr><td class="wrap">${esc(x.lv6_content || x.lv5_work)}</td><td>${esc(x.assignee)}</td>
      <td><span class="badge b-late">${fmtD(x.end_plan)}</span></td><td>${progBar(x.progress)}</td></tr>`).join("")}
    </tbody></table></div>` : '<p class="muted">없음</p>'}
  </div>
  <div class="panel"><h2>최근 이슈</h2>
    <div class="tbl-wrap"><table><thead><tr><th>일자</th><th>담당</th><th>안건</th><th>요청</th><th>상태</th></tr></thead><tbody>
    ${issues.slice(0, 8).map(x => `
      <tr><td>${fmtD(x.issue_date)}</td><td>${esc(x.assignee)}</td>
      <td class="wrap"><a class="link" href="#/issues/${x.id}">${esc((x.agenda || "").slice(0, 70))}</a></td>
      <td>${goBadge(x.request_go)}</td><td>${statusBadge(x.status)}</td></tr>`).join("")}
    </tbody></table></div>
  </div>
  <div class="panel"><h2>다가오는 근태</h2>${att.length ? `
    <table><thead><tr><th>날짜</th><th>이름</th><th>구분</th><th>비고</th></tr></thead><tbody>
    ${att.map(x => `<tr><td>${fmtD(x.att_date)}</td><td>${esc(x.name)}</td>
      <td><span class="badge b-warn">${esc(x.att_type)}</span></td><td>${esc(x.remark)}</td></tr>`).join("")}
    </tbody></table>` : '<p class="muted">예정 없음</p>'}
  </div>`;
}

/* ── WBS 진행 현황 (간트) ─────────────────────── */
async function vTasks() {
  const tasks = await q(sb.from("wbs_tasks").select("*").order("id"));
  const params = new URLSearchParams(location.search);
  const state = { assignee: "", status: "" };

  function render() {
    let rows = tasks;
    if (state.assignee) rows = rows.filter(x => x.assignee === state.assignee);
    if (state.status === "done") rows = rows.filter(x => (x.progress ?? 0) >= 1);
    if (state.status === "open") rows = rows.filter(x => (x.progress ?? 0) < 1);
    if (state.status === "late") rows = rows.filter(x => (x.progress ?? 0) < 1 && x.end_plan && x.end_plan < today());

    const dates = rows.flatMap(x => [x.start_date, x.end_plan, x.end_real]).filter(Boolean).sort();
    const min = dates[0] ? new Date(dates[0]) : new Date();
    const max = dates.length ? new Date(dates[dates.length - 1]) : new Date();
    const span = Math.max(1, max - min);
    const t = new Date(today());
    const todayPos = t >= min && t <= max ? ((t - min) / span * 100) : null;

    const gantt = (x) => {
      if (!x.start_date) return "";
      const s = new Date(x.start_date), e = new Date(x.end_real || x.end_plan || x.start_date);
      const l = Math.max(0, (s - min) / span * 100);
      const w = Math.max(1.2, (e - s) / span * 100);
      const done = (x.progress ?? 0) >= 1;
      const late = !done && x.end_plan && x.end_plan < today();
      return `<div class="gantt-bar-wrap">
        ${todayPos != null ? `<div class="gantt-today" style="left:${todayPos}%"></div>` : ""}
        <div class="gantt-bar ${done ? "done" : late ? "late" : ""}" style="left:${l}%;width:${w}%"
          title="${fmtD(x.start_date)} ~ ${fmtD(x.end_real || x.end_plan)}"></div></div>`;
    };

    let lastMenu = "";
    $("#task-body").innerHTML = rows.map(x => {
      const menuRow = x.lv3_menu !== lastMenu
        ? `<tr><td colspan="8" style="background:#f1f5f9;font-weight:700">${esc(x.lv3_menu || "")} <span class="muted" style="font-weight:400">${esc(x.lv4_detail || "")}</span></td></tr>` : "";
      lastMenu = x.lv3_menu;
      return menuRow + `<tr>
        <td class="wrap">${esc(x.lv6_content || x.lv5_work || "")}${x.remark ? `<br><small class="muted">${esc(x.remark)}</small>` : ""}</td>
        <td>${esc(x.assignee || "")}</td>
        <td><span class="badge ${x.urgency === "S" ? "b-late" : x.urgency === "A" ? "b-warn" : "b-gray"}">${esc(x.urgency || "-")}</span></td>
        <td>${fmtD(x.start_date)}</td><td>${fmtD(x.end_plan)}</td>
        <td>${x.end_real ? fmtD(x.end_real) + (x.end_plan && x.end_real > x.end_plan ? ' <span class="badge b-late">지연</span>' : x.end_plan && x.end_real < x.end_plan ? ' <span class="badge b-done">조기</span>' : "") : '<span class="muted">-</span>'}</td>
        <td>${progBar(x.progress)} ${canWrite() ? `<button class="btn sm ghost" onclick="taskEdit(${x.id})">수정</button>` : ""}</td>
        <td>${gantt(x)}</td></tr>`;
    }).join("");
    $("#task-count").textContent = rows.length + "건";
  }

  app.innerHTML = `
  <h1>WBS 진행 현황</h1>
  <p class="page-sub">Start·End(plan)는 최초 입력 후 수정 불가, 완료 처리 시 End(real) 필수 (운영규칙 개정 2 — 시스템 강제)</p>
  <div class="row">
    ${sel("assignee", CONFIG.TEAM, "", "담당자 전체")}
    <select id="f-status"><option value="">상태 전체</option><option value="open">진행중</option>
      <option value="late">기한 경과</option><option value="done">완료</option></select>
    <span class="muted" id="task-count"></span>
    ${canWrite() ? '<button class="btn" onclick="taskNew()">+ 과업 등록</button>' : ""}
  </div>
  <div class="tbl-wrap"><table>
    <thead><tr><th style="min-width:260px">상세 업무</th><th>담당</th><th>시급성</th><th>Start</th><th>End(plan)</th><th>End(real)</th><th style="min-width:170px">진행률</th><th style="min-width:230px">타임라인</th></tr></thead>
    <tbody id="task-body"></tbody></table></div>`;
  $("#f-assignee").onchange = (e) => { state.assignee = e.target.value; render(); };
  $("#f-status").onchange = (e) => { state.status = e.target.value; render(); };
  window._tasks = tasks;
  render();
}

window.taskEdit = async function (id) {
  if (!canWrite()) return needLogin();
  const x = (window._tasks || []).find(t => t.id === id);
  if (!x) return;
  const p = prompt(`진행률(%) 입력 — 현재 ${pct(x.progress) || "0%"}\n(100 입력 시 End(real) 필수)`, Math.round((x.progress ?? 0) * 100));
  if (p == null) return;
  const progress = Math.min(100, Math.max(0, parseFloat(p) || 0)) / 100;
  let end_real = x.end_real;
  if (progress >= 1 && !end_real) {
    end_real = prompt("End(real) — 실제 완료일 (YYYY-MM-DD, 필수)", today());
    if (!end_real || !/^\d{4}-\d{2}-\d{2}$/.test(end_real)) return toast("End(real) 미입력 — 완료 처리가 취소되었습니다. (운영규칙 개정 2)", true);
  }
  try {
    await q(sb.from("wbs_tasks").update({ progress, end_real }).eq("id", id));
    toast("저장 완료"); route();
  } catch (_) {}
};

window.taskNew = async function () {
  if (!canWrite()) return needLogin();
  const lv6 = prompt("상세 업무 내용"); if (!lv6) return;
  const assignee = prompt("담당자 (" + CONFIG.TEAM.join("/") + ")"); if (!assignee) return;
  const start = prompt("Start (YYYY-MM-DD) — 이후 수정 불가", today());
  const end = prompt("End(plan) (YYYY-MM-DD) — 이후 수정 불가", today());
  const lv3 = prompt("WBS Lv3 메뉴 (예: 1.1.3 작업보고(기존))", "");
  try {
    await q(sb.from("wbs_tasks").insert({ lv3_menu: lv3, lv6_content: lv6, assignee, urgency: "B", start_date: start, end_plan: end, progress: 0 }));
    toast("과업 등록 완료"); route();
  } catch (_) {}
};

/* ── WBS별 이슈 ───────────────────────────────── */
async function vIssues() {
  const issues = await q(sb.from("wbs_issues").select("*").order("id", { ascending: true }));
  issues.sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || "") || b.id - a.id);
  const state = { assignee: "", status: "", kw: "" };

  function render() {
    let rows = issues;
    if (state.assignee) rows = rows.filter(x => x.assignee === state.assignee);
    if (state.status) rows = rows.filter(x => (x.status || "(공란)") === state.status);
    if (state.kw) {
      const k = state.kw.toLowerCase();
      rows = rows.filter(x => (x.agenda + " " + x.question + " " + x.opinion + " " + x.feedback).toLowerCase().includes(k));
    }
    $("#issue-body").innerHTML = rows.map(x => `<tr>
      <td>${fmtD(x.issue_date)}</td><td>${esc(x.assignee)}</td>
      <td class="wrap"><a class="link" href="#/issues/${x.id}">${esc((x.agenda || x.question || "").slice(0, 90)) || "(무제)"}</a></td>
      <td>${goBadge(x.request_go)}</td><td>${statusBadge(x.status)}</td></tr>`).join("");
    $("#issue-count").textContent = rows.length + "건";
  }
  const statuses = [...new Set(issues.map(x => x.status || "(공란)"))];

  app.innerHTML = `
  <h1>WBS별 이슈</h1>
  <p class="page-sub">안건 → 질의 → 본인생각 → GO → 피드백. GO 제출 후 수정 불가, 추가 의견은 댓글로 (운영규칙 개정 1)</p>
  <div class="row">
    ${sel("assignee", CONFIG.TEAM, "", "담당자 전체")}
    ${sel("status", statuses, "", "상태 전체")}
    <input type="text" id="f-kw" placeholder="검색어">
    <span class="muted" id="issue-count"></span>
    <a class="btn" href="#/issues/new" style="text-decoration:none">+ 이슈 등록</a>
  </div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>일자</th><th>담당</th><th style="min-width:320px">안건</th><th>요청</th><th>상태</th></tr></thead>
    <tbody id="issue-body"></tbody></table></div>`;
  $("#f-assignee").onchange = (e) => { state.assignee = e.target.value; render(); };
  $("#f-status").onchange = (e) => { state.status = e.target.value; render(); };
  $("#f-kw").oninput = (e) => { state.kw = e.target.value; render(); };
  render();
}

async function vIssueDetail(id) {
  const [x, imgs] = await Promise.all([
    q(sb.from("wbs_issues").select("*").eq("id", id).single()),
    q(sb.from("issue_images").select("*")),
  ]);
  const myImgs = imgs.filter(i => x.seq != null && +i.issue_seq === +x.seq);
  const locked = x.request_go && x.request_go.startsWith("GO");
  const comments = await q(sb.from("comments").select("*").eq("target_table", "wbs_issues").eq("target_id", id).order("created_at"));

  const block = (title, body, full = false) =>
    `<div class="issue-block ${full ? "full" : ""}"><h3>${title}</h3><div class="body">${esc(body) || '<span class="muted">-</span>'}</div></div>`;

  app.innerHTML = `
  <h1>이슈 상세 <small class="muted">#${x.seq ?? x.id}</small></h1>
  <p class="page-sub">${fmtD(x.issue_date)} · ${esc(x.assignee || "")} · ${goBadge(x.request_go)} ${statusBadge(x.status)}</p>
  ${locked ? '<div class="lock-notice">🔒 GO 제출됨 — 안건/질의/본인생각은 수정할 수 없습니다. 추가 의견은 아래 댓글로 남기세요. (운영규칙 개정 1)</div>' : ""}
  <div class="issue-grid">
    ${block("안건 (왜 논의가 필요한가)", x.agenda, true)}
    ${block("질의 사항 / 요청사항", x.question)}
    ${block("본인의 생각", x.opinion)}
    ${block("참고 자료", x.ref_material)}
    ${block("피드백", x.feedback)}
    ${myImgs.length ? `<div class="issue-block full"><h3>첨부 이미지</h3>${myImgs.map(i => `<img class="issue-img" src="${esc(i.image_path)}" loading="lazy">`).join("")}</div>` : ""}
  </div>
  <div class="row" style="margin-top:14px">
    ${canWrite() && !locked ? `<button class="btn" onclick="issueGo(${x.id}, null)">GO 제출 (검토 요청)</button>` : ""}
    ${canWrite() && locked && x.status !== "완료" ? `
      <button class="btn ghost" onclick="issueGo(${x.id}, '${esc(x.request_go)}')">재질의 (GO*n)</button>
      <button class="btn" onclick="issueFeedback(${x.id})">피드백 입력</button>
      <button class="btn ghost" onclick="issueClose(${x.id})">완료 처리</button>` : ""}
    <a class="btn ghost" href="#/issues" style="text-decoration:none">← 목록</a>
  </div>
  <div class="panel" style="margin-top:18px"><h2>댓글 ${comments.length ? `(${comments.length})` : ""}</h2>
    <div id="cmt-list">${comments.map(c => `<div class="comment">
      <div class="meta"><b>${esc(c.author)}</b>${c.mention ? ` → @${esc(c.mention)}` : ""} · ${String(c.created_at).slice(0, 16).replace("T", " ")}</div>
      <div class="body">${esc(c.content)}</div></div>`).join("") || '<p class="muted">댓글 없음</p>'}
    </div>
    ${canWrite() ? `
    <form id="cmt-form" style="margin-top:12px">
      <div class="row">
        ${sel("cmt-mention", CONFIG.TEAM, "", "@멘션 (선택)")}
      </div>
      <div class="field"><textarea id="cmt-content" placeholder="댓글 입력 — @멘션 선택 시 Slack 알림 발송" required></textarea></div>
      <button class="btn" type="submit">댓글 등록</button>
    </form>` : '<p class="hint" style="color:var(--sub)">댓글 작성은 로그인 필요</p>'}
  </div>`;

  const f = $("#cmt-form");
  if (f) f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = $("#cmt-content").value.trim();
    if (!content) return;
    const author = (session.user.email || "").split("@")[0];
    try {
      await q(sb.from("comments").insert({ target_table: "wbs_issues", target_id: id, author, mention: $("#f-cmt-mention").value || null, content }));
      toast("댓글 등록 완료"); vIssueDetail(id);
    } catch (_) {}
  });
}

window.issueGo = async function (id, cur) {
  if (!canWrite()) return needLogin();
  let next = "GO";
  if (cur) {
    const n = cur === "GO" ? 2 : (parseInt(cur.split("*")[1]) || 1) + 1;
    next = "GO*" + n;
    if (!confirm(`재질의 ${next} 를 제출할까요?\n(재질의율 관리 지표 대상입니다 — 질의·의견을 분리해 작성했는지 확인하세요)`)) return;
  } else if (!confirm("GO 제출 시 안건/질의/본인생각이 잠깁니다. 제출할까요?")) return;
  try {
    await q(sb.from("wbs_issues").update({ request_go: next, status: "진행중" }).eq("id", id));
    toast(next + " 제출 완료 — Slack 알림 발송"); vIssueDetail(id);
  } catch (_) {}
};
window.issueFeedback = async function (id) {
  if (!canWrite()) return needLogin();
  const fb = prompt("피드백 내용");
  if (!fb) return;
  try {
    await q(sb.from("wbs_issues").update({ feedback: fb }).eq("id", id));
    toast("피드백 등록 — Slack 알림 발송"); vIssueDetail(id);
  } catch (_) {}
};
window.issueClose = async function (id) {
  if (!canWrite()) return needLogin();
  if (!confirm("이 이슈를 완료 처리할까요?")) return;
  try {
    await q(sb.from("wbs_issues").update({ status: "완료" }).eq("id", id));
    toast("완료 처리됨"); vIssueDetail(id);
  } catch (_) {}
};

async function vIssueNew() {
  if (!canWrite()) { app.innerHTML = '<div class="panel">이슈 등록은 로그인이 필요합니다.</div>'; return; }
  app.innerHTML = `
  <h1>이슈 등록</h1>
  <p class="page-sub">운영규칙 개정 1 — 안건은 1문장, 질의와 본인생각은 번호 목록으로 1:1 대응</p>
  <div class="panel"><form id="issue-form">
    <div class="row">
      <div class="field"><label>일자</label><input type="date" id="i-date" value="${today()}"></div>
      <div class="field"><label>담당자 <span class="req">*</span></label>${sel("i-assignee", CONFIG.TEAM, "")}</div>
      <div class="field"><label>WBS 메뉴</label><input type="text" id="i-lv3" placeholder="예: 1.1.3 작업보고(기존)"></div>
    </div>
    <div class="field"><label>안건 — 왜 논의가 필요한가 <span class="req">*</span></label>
      <input type="text" id="i-agenda" style="width:100%" maxlength="120" required placeholder="1문장으로 작성 (120자 이내, 줄바꿈 불가)">
      <div class="field-hint">'검토 요청할 안건'이 아니라 '왜 논의가 필요한지'를 적습니다.</div></div>
    <div class="field"><label>질의 사항 / 요청사항 <span class="req">*</span></label>
      <textarea id="i-question" required placeholder="1. 질의&#10;2. 질의&#10;3. 질의"></textarea></div>
    <div class="field"><label>본인의 생각 <span class="req">*</span></label>
      <textarea id="i-opinion" required placeholder="1. 의견 (질의 1에 대한)&#10;2. 의견&#10;3. 의견"></textarea>
      <div class="field-hint">질의에 1:1로 대응하는 본인 의견. 질의와 혼합 금지.</div></div>
    <div class="field"><label>참고 자료</label><input type="text" id="i-ref" style="width:100%" placeholder="링크 또는 자료명"></div>
    <button class="btn" type="submit">저장 (GO 제출은 상세 화면에서)</button>
  </form></div>`;
  $("#issue-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const agenda = $("#i-agenda").value.trim();
    if (/\n/.test(agenda)) return toast("안건은 1문장(줄바꿈 없이)으로 작성하세요.", true);
    const seq = Date.now() % 100000; // 신규 순번 (기존 순번과 충돌 없는 범위)
    try {
      const d = await q(sb.from("wbs_issues").insert({
        issue_date: $("#i-date").value, assignee: $("#f-i-assignee").value,
        lv3_menu: $("#i-lv3").value || null, agenda,
        question: $("#i-question").value, opinion: $("#i-opinion").value,
        ref_material: $("#i-ref").value || null, status: null, seq,
      }).select().single());
      toast("이슈 저장 완료");
      location.hash = "#/issues/" + d.id;
    } catch (_) {}
  });
}

/* ── 주간 업무 요약 ───────────────────────────── */
async function vWeekly() {
  const rows = await q(sb.from("weekly_summaries").select("*").order("week_start", { ascending: false }));
  const weeks = [];
  const map = {};
  for (const r of rows) {
    if (!map[r.week_label]) { map[r.week_label] = { label: r.week_label, start: r.week_start, end: r.week_end, cells: {} }; weeks.push(map[r.week_label]); }
    map[r.week_label].cells[r.member + "|" + r.category] = r.content;
  }
  const members = CONFIG.TEAM.filter(m => rows.some(r => r.member === m));
  const CATS = ["DONE", "ISSUE", "PLAN"];
  const catColor = { DONE: "b-done", ISSUE: "b-warn", PLAN: "b-prog" };

  app.innerHTML = `
  <h1>주간 업무 요약</h1>
  <p class="page-sub">매주 금 17:00 주간 업무 정리 (DONE / ISSUE / PLAN)</p>
  <div class="row">${canWrite() ? '<button class="btn" onclick="weeklyAdd()">+ 항목 입력</button>' : ""}
    <span class="muted">${weeks.length}주차</span></div>
  ${weeks.map(w => `<div class="week-block">
    <div class="week-title">${esc(w.label)} <small class="muted">${fmtD(w.start)} ~ ${fmtD(w.end)}</small></div>
    <div class="week-grid" style="grid-template-columns:70px repeat(${members.length}, 1fr)">
      <div class="week-cell week-head">구분</div>
      ${members.map(m => `<div class="week-cell week-head">${esc(m)}</div>`).join("")}
      ${CATS.map(c => `<div class="week-cell week-cat"><span class="badge ${catColor[c]}">${c}</span></div>` +
        members.map(m => `<div class="week-cell">${esc(w.cells[m + "|" + c] || "")}</div>`).join("")).join("")}
    </div></div>`).join("")}`;
}
window.weeklyAdd = async function () {
  if (!canWrite()) return needLogin();
  const member = prompt("팀원 (" + CONFIG.TEAM.join("/") + ")"); if (!member) return;
  const category = (prompt("구분 (DONE / ISSUE / PLAN)", "DONE") || "").toUpperCase();
  if (!["DONE", "ISSUE", "PLAN"].includes(category)) return toast("구분은 DONE/ISSUE/PLAN 중 하나", true);
  const week_label = prompt("주차 라벨 (예: 7월 2주차)"); if (!week_label) return;
  const content = prompt("내용"); if (!content) return;
  try {
    await q(sb.from("weekly_summaries").insert({ week_label, member, category, content, week_start: today() }));
    toast("입력 완료"); route();
  } catch (_) {}
};

/* ── 일일 기록 (ERP 조회 전용) ─────────────────── */
async function vDaily() {
  const rows = await q(sb.from("daily_logs").select("*").order("log_date", { ascending: false }).limit(3000));
  const state = { member: "", month: "" };
  const months = [...new Set(rows.map(r => (r.log_date || "").slice(0, 7)))].sort().reverse();

  function render() {
    let f = rows;
    if (state.member) f = f.filter(r => r.member === state.member);
    if (state.month) f = f.filter(r => (r.log_date || "").startsWith(state.month));
    const byMember = {};
    for (const r of f) byMember[r.member] = (byMember[r.member] || 0) + (r.hours || 0);
    $("#daily-cards").innerHTML = Object.entries(byMember).sort((a, b) => b[1] - a[1]).map(([m, h]) =>
      `<div class="card"><div class="num">${Math.round(h * 10) / 10}<small style="font-size:13px">h</small></div><div class="lbl">${esc(m)}</div></div>`).join("");
    $("#daily-body").innerHTML = f.slice(0, 500).map(r => `<tr>
      <td>${fmtD(r.log_date)}</td><td>${esc(r.member)}</td><td>${esc(r.project)}</td>
      <td>${esc(r.subcode)}</td><td class="wrap">${esc(r.content)}</td><td>${r.hours ?? ""}</td></tr>`).join("");
    $("#daily-count").textContent = f.length + "건" + (f.length > 500 ? " (500건까지 표시)" : "");
  }

  app.innerHTML = `
  <h1>일일 기록</h1>
  <p class="page-sub">회사 ERP 데이터 조회 전용 — 자동 집계 (운영규칙 개정 3). 갱신은 관리자 데이터 적재로 수행.</p>
  <div class="row">
    ${sel("d-member", CONFIG.TEAM, "", "팀원 전체")}
    ${sel("d-month", months, "", "월 전체")}
    <span class="muted" id="daily-count"></span>
  </div>
  <div class="cards" id="daily-cards"></div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>일자</th><th>팀원</th><th>프로젝트</th><th>서브코드</th><th>업무내용</th><th>시간</th></tr></thead>
    <tbody id="daily-body"></tbody></table></div>`;
  $("#f-d-member").onchange = (e) => { state.member = e.target.value; render(); };
  $("#f-d-month").onchange = (e) => { state.month = e.target.value; render(); };
  render();
}

/* ── 성과물 · 참고자료 ────────────────────────── */
async function vDeliverables() {
  const [dels, refs] = await Promise.all([
    q(sb.from("deliverables").select("*").order("no")),
    q(sb.from("reference_materials").select("*").order("no")),
  ]);
  app.innerHTML = `
  <h1>성과물 · 참고자료</h1><p class="page-sub">산출물 링크 대장</p>
  <div class="panel"><h2>성과물 (${dels.length})</h2>
    <div class="tbl-wrap" style="max-height:45vh"><table>
    <thead><tr><th>번호</th><th>설명</th><th>URL</th><th>담당</th><th>비고</th></tr></thead><tbody>
    ${dels.map(d => `<tr><td>${d.no ?? ""}</td><td class="wrap">${esc(d.title)}</td>
      <td>${d.url ? `<a class="link" href="${esc(d.url)}" target="_blank" rel="noopener">열기 ↗</a>` : ""}</td>
      <td>${esc(d.assignee)}</td><td class="wrap">${esc(d.remark)}</td></tr>`).join("")}
    </tbody></table></div></div>
  <div class="panel"><h2>참고자료 (${refs.length})</h2>
    <div class="tbl-wrap" style="max-height:45vh"><table>
    <thead><tr><th>번호</th><th>성과물</th><th>자료</th><th>담당</th></tr></thead><tbody>
    ${refs.map(r => `<tr><td>${r.no ?? ""}</td><td>${r.deliverable_no ?? ""}</td>
      <td class="wrap">${r.url ? `<a class="link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title || "링크")}</a>` : esc(r.title)}</td>
      <td>${esc(r.assignee)}</td></tr>`).join("")}
    </tbody></table></div></div>`;
}

/* ── 근태 ─────────────────────────────────────── */
async function vAttendance() {
  const rows = await q(sb.from("attendance").select("*").order("att_date", { ascending: false }));
  app.innerHTML = `
  <h1>근태</h1><p class="page-sub">연장근무 신청은 당일 16:00까지 (운영규칙 유지 조항)</p>
  <div class="row">${canWrite() ? '<button class="btn" onclick="attAdd()">+ 근태 등록</button>' : ""}</div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>날짜</th><th>이름</th><th>구분</th><th>비고</th></tr></thead><tbody>
    ${rows.map(x => `<tr ${x.att_date >= today() ? 'style="background:#fffbeb"' : ""}>
      <td>${fmtD(x.att_date)}</td><td>${esc(x.name)}</td>
      <td><span class="badge ${x.att_type === "연차" ? "b-prog" : x.att_type === "출장" ? "b-go" : "b-warn"}">${esc(x.att_type)}</span></td>
      <td class="wrap">${esc(x.remark)}</td></tr>`).join("")}
    </tbody></table></div>`;
}
window.attAdd = async function () {
  if (!canWrite()) return needLogin();
  const att_date = prompt("날짜 (YYYY-MM-DD)", today()); if (!att_date) return;
  const name = prompt("이름 (" + CONFIG.TEAM.join("/") + ")"); if (!name) return;
  const att_type = prompt("구분 (연차/시차/출장/연장근무 등)", "연차"); if (!att_type) return;
  const remark = prompt("비고 (선택)") || null;
  try {
    await q(sb.from("attendance").insert({ att_date, name, att_type, remark }));
    toast("근태 등록 완료"); route();
  } catch (_) {}
};

/* ── 운영 규칙 (Note) ─────────────────────────── */
async function vNotes() {
  const notes = await q(sb.from("notes").select("*").order("no"));
  app.innerHTML = `
  <h1>운영 규칙</h1><p class="page-sub">운영규칙 개정안 v1 (2026-07) — 시스템 강제 항목은 자동 적용됩니다.</p>
  <div class="panel"><h2>핵심 규칙 (개정안 v1)</h2>
    <table><tbody>
    <tr><td><span class="badge b-go">개정 1</span></td><td class="wrap">이슈: 안건(1문장) → 질의(번호 목록) → 본인생각(1:1 대응) → GO 제출 시 자동 잠금. 추가 의견은 댓글.</td></tr>
    <tr><td><span class="badge b-go">개정 2</span></td><td class="wrap">Start·End(plan) 최초 입력 후 수정 불가. 진행률 100% 처리 시 End(real) 필수 — 지연/조기는 시스템 자동 판정.</td></tr>
    <tr><td><span class="badge b-go">개정 3</span></td><td class="wrap">일일 기록은 회사 ERP 원본 유지 — 본 사이트는 조회·집계 전용.</td></tr>
    <tr><td><span class="badge b-go">개정 4</span></td><td class="wrap">협업은 사이트 내 댓글 + Slack 알림 (GO 제출 / 피드백 등록 / @멘션).</td></tr>
    <tr><td><span class="badge b-done">유지</span></td><td class="wrap">월 09:00 주간회의 · 금 17:00 주간정리 · 회의 가능 10~12/13~15시 · 연장근무 신청 당일 16:00까지</td></tr>
    </tbody></table></div>
  <div class="panel"><h2>기존 전달 사항 (아카이브)</h2>
    <table><tbody>${notes.map(n => `<tr><td style="width:40px">${n.no ?? ""}</td><td class="wrap">${esc(n.content)}</td></tr>`).join("")}</tbody></table></div>`;
}

/* ── boot ─────────────────────────────────────── */
window.addEventListener("hashchange", route);
initAuth().then(route);
