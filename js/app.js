/* CM기획팀 업무 관리 시스템 v2 — SPA (Supabase + GitHub Pages)
   사번 로그인 / 공지(팀장 전용) / WBS 접기+간트 / 이슈 Cancel=완료 /
   주간·일일 접기 / 파일 업로드(성과물·자료실) / 근태 월별 집계 */
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
function needLogin() { toast("로그인이 필요합니다. 좌측 하단에서 사번으로 로그인하세요.", true); }
const canWrite = () => !!session;
function me() {
  if (!session) return null;
  const m = session.user.user_metadata || {};
  return { empno: m.empno, name: m.name || m.empno, role: m.role || "normal" };
}
const isMaster = () => me()?.role === "master";

/* 이슈 완료 판정 — 요청 Cancel 은 상태 공란이어도 완료. 공란(비Cancel)만 미해결 */
function issueClosed(x) {
  return x.request_go === "Cancel" || x.status === "완료" || x.status === "공지";
}
function issueStatusBadge(x) {
  if (x.request_go === "Cancel" && !x.status) return '<span class="badge b-gray">완료(취소)</span>';
  if (!x.status) return '<span class="badge b-late">미해결</span>';
  const m = { "완료": "b-done", "미해결": "b-late", "보류": "b-warn", "공지": "b-gray", "진행중": "b-prog" };
  return `<span class="badge ${m[x.status] || "b-prog"}">${esc(x.status)}</span>`;
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

/* ── auth (사번 로그인) ───────────────────────── */
async function initAuth() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  renderAuth();
  sb.auth.onAuthStateChange((_e, s) => { session = s; renderAuth(); });
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const empno = $("#login-empno").value.trim().toLowerCase();
    const { error } = await sb.auth.signInWithPassword({
      email: empno + "@" + CONFIG.AUTH_DOMAIN, password: $("#login-pw").value });
    if (error) toast("로그인 실패: 사번 또는 비밀번호를 확인하세요.", true);
    else { toast((CONFIG.USERS[empno]?.name || empno) + "님 환영합니다."); route(); }
  });
  $("#btn-logout").addEventListener("click", async () => { await sb.auth.signOut(); toast("로그아웃"); route(); });
}
function renderAuth() {
  $("#auth-form").classList.toggle("hidden", !!session);
  $("#auth-user").classList.toggle("hidden", !session);
  if (session) {
    const u = me();
    $("#auth-email").innerHTML = esc(u.name) + (u.role === "master" ? ' <span class="badge b-go">팀장</span>' : "") +
      `<br><small class="muted">${esc(u.empno)} · CM기획팀</small>`;
  }
}

/* ── router ───────────────────────────────────── */
const routes = {
  "/": vDashboard, "/tasks": vTasks, "/issues": vIssues,
  "/weekly": vWeekly, "/daily": vDaily, "/deliverables": vDeliverables,
  "/docs": vDocs, "/attendance": vAttendance, "/notes": vNotes,
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
    app.innerHTML = `<div class="panel">데이터를 불러오지 못했습니다.<br><small class="muted">${esc(e.message || e)}</small></div>`;
  }
}

/* ══ 대시보드 — 공지 → 이슈 → 진행 중 과업 → 근태 ══ */
async function vDashboard() {
  const [notices, tasks, issues, att] = await Promise.all([
    q(sb.from("notices").select("*").order("created_at", { ascending: false }).limit(5)),
    q(sb.from("wbs_tasks").select("*")),
    q(sb.from("wbs_issues").select("*")),
    q(sb.from("attendance").select("*").gte("att_date", today()).order("att_date").limit(12)),
  ]);
  const t = today();
  const openTasks = tasks.filter(x => (x.progress ?? 0) < 1)
    .sort((a, b) => (a.end_plan || "9999").localeCompare(b.end_plan || "9999"));
  const late = openTasks.filter(x => x.end_plan && x.end_plan < t);
  const openIssues = issues.filter(x => !issueClosed(x))
    .sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || ""));
  const avg = tasks.length ? tasks.reduce((s, x) => s + (x.progress ?? 0), 0) / tasks.length : 0;

  app.innerHTML = `
  <h1>대시보드</h1><p class="page-sub">CM기획팀 업무 현황 (${t})</p>

  <div class="panel notice-panel"><h2>📢 공지</h2>
    ${notices.length ? notices.map(n => `<div class="notice-item">
      <div class="meta">${esc(n.author)} · ${String(n.created_at).slice(0, 10)}
        ${isMaster() ? `<button class="btn sm ghost" onclick="noticeDel(${n.id})">삭제</button>` : ""}</div>
      <div class="body">${esc(n.content)}</div></div>`).join("") : '<p class="muted">등록된 공지가 없습니다.</p>'}
    ${isMaster() ? `<form id="notice-form" class="row" style="margin-top:10px;margin-bottom:0">
      <input type="text" id="notice-content" placeholder="공지 입력 (팀장 전용)" style="flex:1" required>
      <button class="btn" type="submit">등록</button></form>` : ""}
  </div>

  <div class="cards">
    <div class="card"><div class="num" style="color:var(--warn)">${openIssues.length}</div><div class="lbl">미해결 이슈</div></div>
    <div class="card"><div class="num">${openTasks.length}</div><div class="lbl">진행 중 과업</div></div>
    <div class="card"><div class="num" style="color:var(--danger)">${late.length}</div><div class="lbl">기한 경과 과업</div></div>
    <div class="card"><div class="num">${pct(avg)}</div><div class="lbl">전체 평균 진행률</div></div>
  </div>

  <div class="panel"><h2>미해결 이슈 (${openIssues.length})</h2>${openIssues.length ? `
    <div class="tbl-wrap" style="max-height:none"><table><thead><tr><th>일자</th><th>담당</th><th>안건</th><th>요청</th><th>상태</th></tr></thead><tbody>
    ${openIssues.map(x => `<tr><td>${fmtD(x.issue_date)}</td><td>${esc(x.assignee)}</td>
      <td class="wrap"><a class="link" href="#/issues/${x.id}">${esc((x.agenda || x.question || "").slice(0, 90)) || "(무제)"}</a></td>
      <td>${goBadge(x.request_go)}</td><td>${issueStatusBadge(x)}</td></tr>`).join("")}
    </tbody></table></div>` : '<p class="muted">모든 이슈가 완료되었습니다.</p>'}
  </div>

  <div class="panel"><h2>진행 중 과업 (${openTasks.length}) <small class="muted">— 기한 경과 ${late.length}건 강조</small></h2>
    <div class="tbl-wrap" style="max-height:none"><table><thead><tr><th>업무</th><th>담당</th><th>Start</th><th>End(plan)</th><th>진행률</th></tr></thead><tbody>
    ${openTasks.map(x => `<tr ${x.end_plan && x.end_plan < t ? 'class="row-late"' : ""}>
      <td class="wrap">${esc(x.lv6_content || x.lv5_work)}</td><td>${esc(x.assignee)}</td>
      <td>${fmtD(x.start_date)}</td>
      <td>${x.end_plan && x.end_plan < t ? `<span class="badge b-late">${fmtD(x.end_plan)}</span>` : fmtD(x.end_plan)}</td>
      <td>${progBar(x.progress)}</td></tr>`).join("")}
    </tbody></table></div>
  </div>

  <div class="panel"><h2>다가오는 근태</h2>${att.length ? `
    <table><thead><tr><th>날짜</th><th>이름</th><th>구분</th><th>비고</th></tr></thead><tbody>
    ${att.map(x => `<tr><td>${fmtD(x.att_date)}</td><td>${esc(x.name)}</td>
      <td><span class="badge b-warn">${esc(x.att_type)}</span></td><td>${esc(x.remark)}</td></tr>`).join("")}
    </tbody></table>` : '<p class="muted">예정 없음</p>'}
  </div>`;

  const nf = $("#notice-form");
  if (nf) nf.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await q(sb.from("notices").insert({ author: me().name, content: $("#notice-content").value.trim() }));
      toast("공지 등록 완료"); route();
    } catch (_) {}
  });
}
window.noticeDel = async function (id) {
  if (!confirm("공지를 삭제할까요?")) return;
  try { await q(sb.from("notices").delete().eq("id", id)); toast("삭제됨"); route(); } catch (_) {}
};

/* ══ WBS 진행 현황 — 계층 접기 + 간트 ══ */
async function vTasks() {
  const tasks = await q(sb.from("wbs_tasks").select("*").order("id"));
  const state = { assignee: "", status: "" };

  function filtered() {
    let rows = tasks;
    if (state.assignee) rows = rows.filter(x => x.assignee === state.assignee);
    if (state.status === "done") rows = rows.filter(x => (x.progress ?? 0) >= 1);
    if (state.status === "open") rows = rows.filter(x => (x.progress ?? 0) < 1);
    if (state.status === "late") rows = rows.filter(x => (x.progress ?? 0) < 1 && x.end_plan && x.end_plan < today());
    return rows;
  }

  function render() {
    const rows = filtered();
    // 간트 스케일
    const dates = rows.flatMap(x => [x.start_date, x.end_plan, x.end_real]).filter(Boolean).sort();
    const min = dates[0] ? new Date(dates[0]) : new Date();
    const max = dates.length ? new Date(dates[dates.length - 1]) : new Date();
    max.setDate(max.getDate() + 7);
    const span = Math.max(1, max - min);
    const t = new Date(today());
    const todayPos = t >= min && t <= max ? ((t - min) / span * 100) : null;
    // 월 눈금
    const ticks = [];
    const cur = new Date(min.getFullYear(), min.getMonth(), 1);
    while (cur <= max) {
      const pos = Math.max(0, (cur - min) / span * 100);
      if (pos < 98) ticks.push({ pos, label: (cur.getMonth() + 1) + "월" });
      cur.setMonth(cur.getMonth() + 1);
    }
    const scaleHeader = `<div class="gantt-scale">
      ${ticks.map(k => `<span class="gantt-tick" style="left:${k.pos}%">${k.label}</span>`).join("")}
      ${todayPos != null ? `<span class="gantt-today-flag" style="left:${todayPos}%">오늘</span>` : ""}</div>`;

    const gantt = (x) => {
      if (!x.start_date) return "";
      const s = new Date(x.start_date), e = new Date(x.end_real || x.end_plan || x.start_date);
      const l = Math.max(0, (s - min) / span * 100);
      const w = Math.max(1.2, (e - s) / span * 100);
      const done = (x.progress ?? 0) >= 1;
      const late = !done && x.end_plan && x.end_plan < today();
      return `<div class="gantt-bar-wrap">
        ${ticks.map(k => `<i class="gantt-grid" style="left:${k.pos}%"></i>`).join("")}
        ${todayPos != null ? `<div class="gantt-today" style="left:${todayPos}%"></div>` : ""}
        <div class="gantt-bar ${done ? "done" : late ? "late" : ""}" style="left:${l}%;width:${w}%"
          title="${fmtD(x.start_date)} ~ ${fmtD(x.end_real || x.end_plan)} ${pct(x.progress)}"></div></div>`;
    };

    // Lv3 그룹핑
    const groups = [];
    let g = null;
    for (const x of rows) {
      if (!g || x.lv3_menu !== g.lv3) { g = { lv3: x.lv3_menu, items: [] }; groups.push(g); }
      g.items.push(x);
    }
    $("#task-body").innerHTML = groups.map((grp, gi) => `
      <details class="wbs-group" open>
        <summary><b>${esc(grp.lv3 || "(미분류)")}</b>
          <span class="muted">${grp.items.length}건 · 평균 ${pct(grp.items.reduce((s, x) => s + (x.progress ?? 0), 0) / grp.items.length)}</span>
        </summary>
        <div class="tbl-wrap" style="max-height:none;border-radius:0 0 10px 10px;border-top:none">
        <table><thead><tr><th style="min-width:230px">상세 업무</th><th>담당</th><th>시급성</th><th>Start</th><th>End(plan)</th><th>End(real)</th><th style="min-width:150px">진행률</th>
        <th style="min-width:260px">${gi === 0 ? "타임라인" : ""}<div style="position:relative">${scaleHeader}</div></th></tr></thead><tbody>
        ${grp.items.map(x => `<tr>
          <td class="wrap">${x.lv5_work && x.lv6_content ? `<small class="muted">${esc(x.lv5_work)}</small><br>` : ""}${esc(x.lv6_content || x.lv5_work || "")}${x.remark ? `<br><small class="muted">${esc(x.remark)}</small>` : ""}</td>
          <td>${esc(x.assignee || "")}</td>
          <td><span class="badge ${x.urgency === "S" ? "b-late" : x.urgency === "A" ? "b-warn" : "b-gray"}">${esc(x.urgency || "-")}</span></td>
          <td>${fmtD(x.start_date)}</td><td>${fmtD(x.end_plan)}</td>
          <td>${x.end_real ? fmtD(x.end_real) + (x.end_plan && x.end_real > x.end_plan ? ' <span class="badge b-late">지연</span>' : x.end_plan && x.end_real < x.end_plan ? ' <span class="badge b-done">조기</span>' : "") : '<span class="muted">-</span>'}</td>
          <td>${progBar(x.progress)} ${canWrite() ? `<button class="btn sm ghost" onclick="taskEdit(${x.id})">수정</button>` : ""}</td>
          <td>${gantt(x)}</td></tr>`).join("")}
        </tbody></table></div>
      </details>`).join("");
    $("#task-count").textContent = rows.length + "건";
  }

  app.innerHTML = `
  <h1>WBS 진행 현황</h1>
  <p class="page-sub">WBS(Lv3) 그룹별 접기·펼치기 + 간트 타임라인. Start·End(plan)는 수정 불가, 완료 시 End(real) 필수 (시스템 강제)</p>
  <div class="row">
    ${sel("assignee", CONFIG.TEAM, "", "담당자 전체")}
    <select id="f-status"><option value="">상태 전체</option><option value="open">진행중</option>
      <option value="late">기한 경과</option><option value="done">완료</option></select>
    <button class="btn sm ghost" id="btn-fold">모두 접기</button>
    <button class="btn sm ghost" id="btn-unfold">모두 펼치기</button>
    <span class="muted" id="task-count"></span>
    ${canWrite() ? '<button class="btn" onclick="taskNew()">+ 과업 등록</button>' : ""}
  </div>
  <div id="task-body"></div>`;
  $("#f-assignee").onchange = (e) => { state.assignee = e.target.value; render(); };
  $("#f-status").onchange = (e) => { state.status = e.target.value; render(); };
  $("#btn-fold").onclick = () => document.querySelectorAll(".wbs-group").forEach(d => d.open = false);
  $("#btn-unfold").onclick = () => document.querySelectorAll(".wbs-group").forEach(d => d.open = true);
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
    if (!end_real || !/^\d{4}-\d{2}-\d{2}$/.test(end_real)) return toast("End(real) 미입력 — 완료 처리가 취소되었습니다.", true);
  }
  try {
    await q(sb.from("wbs_tasks").update({ progress, end_real }).eq("id", id));
    toast("저장 완료"); route();
  } catch (_) {}
};
window.taskNew = async function () {
  if (!canWrite()) return needLogin();
  const lv6 = prompt("상세 업무 내용"); if (!lv6) return;
  const assignee = prompt("담당자 (" + CONFIG.TEAM.join("/") + ")", me().name); if (!assignee) return;
  const start = prompt("Start (YYYY-MM-DD) — 이후 수정 불가", today());
  const end = prompt("End(plan) (YYYY-MM-DD) — 이후 수정 불가", today());
  const lv3 = prompt("WBS Lv3 메뉴 (예: 1.1.3 작업보고(기존))", "");
  try {
    await q(sb.from("wbs_tasks").insert({ lv3_menu: lv3, lv6_content: lv6, assignee, urgency: "B", start_date: start, end_plan: end, progress: 0 }));
    toast("과업 등록 완료"); route();
  } catch (_) {}
};

/* ══ WBS별 이슈 ══ */
async function vIssues() {
  const issues = await q(sb.from("wbs_issues").select("*").order("id", { ascending: true }));
  issues.sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || "") || b.id - a.id);
  const state = { assignee: "", status: "", kw: "" };

  function render() {
    let rows = issues;
    if (state.assignee) rows = rows.filter(x => x.assignee === state.assignee);
    if (state.status === "open") rows = rows.filter(x => !issueClosed(x));
    if (state.status === "closed") rows = rows.filter(x => issueClosed(x));
    if (state.kw) {
      const k = state.kw.toLowerCase();
      rows = rows.filter(x => ((x.agenda || "") + " " + (x.question || "") + " " + (x.opinion || "") + " " + (x.feedback || "")).toLowerCase().includes(k));
    }
    $("#issue-body").innerHTML = rows.map(x => `<tr>
      <td>${fmtD(x.issue_date)}</td><td>${esc(x.assignee)}</td>
      <td class="wrap"><a class="link" href="#/issues/${x.id}">${esc((x.agenda || x.question || "").slice(0, 90)) || "(무제)"}</a></td>
      <td>${goBadge(x.request_go)}</td><td>${issueStatusBadge(x)}</td></tr>`).join("");
    $("#issue-count").textContent = rows.length + "건 (미해결 " + rows.filter(x => !issueClosed(x)).length + ")";
  }

  app.innerHTML = `
  <h1>WBS별 이슈</h1>
  <p class="page-sub">안건 → 질의 → 본인생각 → GO → 피드백. 요청 Cancel은 완료로 처리, 상태 공란(비Cancel)만 미해결.</p>
  <div class="row">
    ${sel("assignee", CONFIG.TEAM, "", "담당자 전체")}
    <select id="f-status"><option value="">전체</option><option value="open">미해결</option><option value="closed">완료</option></select>
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
  <p class="page-sub">${fmtD(x.issue_date)} · ${esc(x.assignee || "")} · ${goBadge(x.request_go)} ${issueStatusBadge(x)}</p>
  ${locked ? '<div class="lock-notice">🔒 GO 제출됨 — 안건/질의/본인생각은 수정할 수 없습니다. 추가 의견은 아래 댓글로 남기세요.</div>' : ""}
  <div class="issue-grid">
    ${block("안건 (왜 논의가 필요한가)", x.agenda, true)}
    ${block("질의 사항 / 요청사항", x.question)}
    ${block("본인의 생각", x.opinion)}
    ${block("참고 자료", x.ref_material)}
    ${block("피드백", x.feedback)}
    ${myImgs.length ? `<div class="issue-block full"><h3>첨부 이미지</h3>${myImgs.map(i => `<img class="issue-img" src="${esc(i.image_path)}" loading="lazy">`).join("")}</div>` : ""}
  </div>
  <div class="row" style="margin-top:14px">
    ${canWrite() && !locked && x.request_go !== "Cancel" ? `<button class="btn" onclick="issueGo(${x.id}, null)">GO 제출 (검토 요청)</button>` : ""}
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
      <div class="row">${sel("cmt-mention", CONFIG.TEAM, "", "@멘션 (선택)")}</div>
      <div class="field"><textarea id="cmt-content" placeholder="댓글 입력 — @멘션 선택 시 Slack 알림 발송" required></textarea></div>
      <button class="btn" type="submit">댓글 등록</button>
    </form>` : '<p class="hint" style="color:var(--sub)">댓글 작성은 로그인 필요</p>'}
  </div>`;

  const f = $("#cmt-form");
  if (f) f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = $("#cmt-content").value.trim();
    if (!content) return;
    try {
      await q(sb.from("comments").insert({ target_table: "wbs_issues", target_id: id, author: me().name, mention: $("#f-cmt-mention").value || null, content }));
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
    if (!confirm(`재질의 ${next} 를 제출할까요?`)) return;
  } else if (!confirm("GO 제출 시 안건/질의/본인생각이 잠깁니다. 제출할까요?")) return;
  try {
    await q(sb.from("wbs_issues").update({ request_go: next, status: "진행중" }).eq("id", id));
    toast(next + " 제출 완료"); vIssueDetail(id);
  } catch (_) {}
};
window.issueFeedback = async function (id) {
  if (!canWrite()) return needLogin();
  const fb = prompt("피드백 내용");
  if (!fb) return;
  try { await q(sb.from("wbs_issues").update({ feedback: fb }).eq("id", id)); toast("피드백 등록"); vIssueDetail(id); } catch (_) {}
};
window.issueClose = async function (id) {
  if (!canWrite()) return needLogin();
  if (!confirm("이 이슈를 완료 처리할까요?")) return;
  try { await q(sb.from("wbs_issues").update({ status: "완료" }).eq("id", id)); toast("완료 처리됨"); vIssueDetail(id); } catch (_) {}
};

async function vIssueNew() {
  if (!canWrite()) { app.innerHTML = '<div class="panel">이슈 등록은 로그인이 필요합니다.</div>'; return; }
  app.innerHTML = `
  <h1>이슈 등록</h1>
  <p class="page-sub">안건은 1문장, 질의와 본인생각은 번호 목록으로 1:1 대응</p>
  <div class="panel"><form id="issue-form">
    <div class="row">
      <div class="field"><label>일자</label><input type="date" id="i-date" value="${today()}"></div>
      <div class="field"><label>담당자 <span class="req">*</span></label>${sel("i-assignee", CONFIG.TEAM, me().name)}</div>
      <div class="field"><label>WBS 메뉴</label><input type="text" id="i-lv3" placeholder="예: 1.1.3 작업보고(기존)"></div>
    </div>
    <div class="field"><label>안건 — 왜 논의가 필요한가 <span class="req">*</span></label>
      <input type="text" id="i-agenda" style="width:100%" maxlength="120" required placeholder="1문장으로 작성 (120자 이내)">
    </div>
    <div class="field"><label>질의 사항 / 요청사항 <span class="req">*</span></label>
      <textarea id="i-question" required placeholder="1. 질의&#10;2. 질의"></textarea></div>
    <div class="field"><label>본인의 생각 <span class="req">*</span></label>
      <textarea id="i-opinion" required placeholder="1. 의견 (질의 1에 대한)&#10;2. 의견"></textarea></div>
    <div class="field"><label>참고 자료</label><input type="text" id="i-ref" style="width:100%" placeholder="링크 또는 자료명"></div>
    <button class="btn" type="submit">저장 (GO 제출은 상세 화면에서)</button>
  </form></div>`;
  $("#issue-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const agenda = $("#i-agenda").value.trim();
    if (/\n/.test(agenda)) return toast("안건은 1문장(줄바꿈 없이)으로 작성하세요.", true);
    try {
      const d = await q(sb.from("wbs_issues").insert({
        issue_date: $("#i-date").value, assignee: $("#f-i-assignee").value,
        lv3_menu: $("#i-lv3").value || null, agenda,
        question: $("#i-question").value, opinion: $("#i-opinion").value,
        ref_material: $("#i-ref").value || null, seq: Date.now() % 1000000,
      }).select().single());
      toast("이슈 저장 완료");
      location.hash = "#/issues/" + d.id;
    } catch (_) {}
  });
}

/* ══ 주간 업무 요약 — 월별·주차별 접기 ══ */
async function vWeekly() {
  const rows = await q(sb.from("weekly_summaries").select("*").order("week_start", { ascending: false }));
  const weekMap = {}; const weeks = [];
  for (const r of rows) {
    if (!weekMap[r.week_label]) { weekMap[r.week_label] = { label: r.week_label, start: r.week_start, end: r.week_end, cells: {} }; weeks.push(weekMap[r.week_label]); }
    weekMap[r.week_label].cells[r.member + "|" + r.category] = r.content;
  }
  const members = CONFIG.TEAM.filter(m => rows.some(r => r.member === m));
  const CATS = ["DONE", "ISSUE", "PLAN"];
  const catColor = { DONE: "b-done", ISSUE: "b-warn", PLAN: "b-prog" };
  // 월별 그룹 (라벨 "7월 1주차" → "7월")
  const months = [];
  const mMap = {};
  for (const w of weeks) {
    const mon = (w.label.match(/^(\d+월)/) || [null, "기타"])[1];
    if (!mMap[mon]) { mMap[mon] = { mon, weeks: [] }; months.push(mMap[mon]); }
    mMap[mon].weeks.push(w);
  }
  app.innerHTML = `
  <h1>주간 업무 요약</h1>
  <p class="page-sub">매주 금 17:00 주간 업무 정리 (DONE / ISSUE / PLAN) — 월·주차 접기 가능</p>
  <div class="row">
    <button class="btn sm ghost" onclick="document.querySelectorAll('#app details').forEach(d=>d.open=false)">모두 접기</button>
    <button class="btn sm ghost" onclick="document.querySelectorAll('#app details').forEach(d=>d.open=true)">모두 펼치기</button>
    ${canWrite() ? '<button class="btn" onclick="weeklyAdd()">+ 항목 입력</button>' : ""}
    <span class="muted">${weeks.length}주차 / ${months.length}개월</span></div>
  ${months.map((mg, mi) => `<details class="month-group" ${mi === 0 ? "open" : ""}>
    <summary><b>${esc(mg.mon)}</b> <span class="muted">${mg.weeks.length}주차</span></summary>
    ${mg.weeks.map((w, wi) => `<details class="week-detail" ${mi === 0 && wi === 0 ? "open" : ""}>
      <summary>${esc(w.label)} <small class="muted">${fmtD(w.start)} ~ ${fmtD(w.end)}</small></summary>
      <div class="week-grid" style="grid-template-columns:70px repeat(${members.length}, 1fr)">
        <div class="week-cell week-head">구분</div>
        ${members.map(m => `<div class="week-cell week-head">${esc(m)}</div>`).join("")}
        ${CATS.map(c => `<div class="week-cell week-cat"><span class="badge ${catColor[c]}">${c}</span></div>` +
          members.map(m => `<div class="week-cell">${esc(w.cells[m + "|" + c] || "")}</div>`).join("")).join("")}
      </div></details>`).join("")}
  </details>`).join("")}`;
}
window.weeklyAdd = async function () {
  if (!canWrite()) return needLogin();
  const member = prompt("팀원 (" + CONFIG.TEAM.join("/") + ")", me().name); if (!member) return;
  const category = (prompt("구분 (DONE / ISSUE / PLAN)", "DONE") || "").toUpperCase();
  if (!["DONE", "ISSUE", "PLAN"].includes(category)) return toast("구분은 DONE/ISSUE/PLAN 중 하나", true);
  const week_label = prompt("주차 라벨 (예: 7월 2주차)"); if (!week_label) return;
  const content = prompt("내용"); if (!content) return;
  try {
    await q(sb.from("weekly_summaries").insert({ week_label, member, category, content, week_start: today() }));
    toast("입력 완료"); route();
  } catch (_) {}
};

/* ══ 일일 기록 — 주차·일자 접기 + 팀원별 묶음(최다 시간 상단, 나머지 펼치기) ══ */
async function vDaily() {
  const rows = await q(sb.from("daily_logs").select("*").order("log_date", { ascending: false }).limit(4000));
  const state = { member: "", month: "" };
  const months = [...new Set(rows.map(r => (r.log_date || "").slice(0, 7)))].sort().reverse();

  function render() {
    let f = rows;
    if (state.member) f = f.filter(r => r.member === state.member);
    if (state.month) f = f.filter(r => (r.log_date || "").startsWith(state.month));
    // 집계 카드
    const byMember = {};
    for (const r of f) byMember[r.member] = (byMember[r.member] || 0) + (r.hours || 0);
    $("#daily-cards").innerHTML = Object.entries(byMember).sort((a, b) => b[1] - a[1]).map(([m, h]) =>
      `<div class="card"><div class="num">${Math.round(h * 10) / 10}<small style="font-size:13px">h</small></div><div class="lbl">${esc(m)}</div></div>`).join("");
    // 주차 → 일자 → 팀원 그룹
    const weekOrder = []; const wMap = {};
    for (const r of f) {
      const wk = r.week_label || "기타";
      if (!wMap[wk]) { wMap[wk] = { wk, dates: {}, dateOrder: [] }; weekOrder.push(wMap[wk]); }
      const W = wMap[wk];
      if (!W.dates[r.log_date]) { W.dates[r.log_date] = {}; W.dateOrder.push(r.log_date); }
      (W.dates[r.log_date][r.member] = W.dates[r.log_date][r.member] || []).push(r);
    }
    const taskRow = (r) => `<div class="dlog"><span class="dlog-h">${r.hours ?? "-"}h</span>
      <span class="dlog-p">${esc(r.project || "")}</span> <span class="badge b-gray">${esc(r.subcode || "")}</span>
      <div class="dlog-c">${esc(r.content || "")}</div></div>`;
    $("#daily-body").innerHTML = weekOrder.map((W, wi) => `
      <details class="month-group" ${wi === 0 ? "open" : ""}>
        <summary><b>${esc(W.wk)}</b> <span class="muted">${W.dateOrder.length}일</span></summary>
        ${W.dateOrder.map((dt, di) => {
          const mems = Object.entries(W.dates[dt]);
          return `<details class="week-detail" ${wi === 0 && di === 0 ? "open" : ""}>
          <summary>${dt} <span class="muted">${mems.length}명 ${mems.reduce((s, [, l]) => s + l.length, 0)}건</span></summary>
          <div class="daily-date-grid">
          ${mems.map(([mem, list]) => {
            list.sort((a, b) => (b.hours || 0) - (a.hours || 0));
            const [top, ...rest] = list;
            const uid = "dx" + Math.random().toString(36).slice(2, 9);
            return `<div class="daily-member">
              <div class="dm-head"><b>${esc(mem)}</b> <span class="muted">${Math.round(list.reduce((s, r) => s + (r.hours || 0), 0) * 10) / 10}h · ${list.length}건</span>
                ${rest.length ? `<button class="btn sm ghost" onclick="const e=document.getElementById('${uid}');const v=e.style.display==='none';e.style.display=v?'block':'none';this.textContent=v?'− 접기':'+ ${rest.length}건 더보기'">+ ${rest.length}건 더보기</button>` : ""}
              </div>
              ${taskRow(top)}
              ${rest.length ? `<div id="${uid}" style="display:none">${rest.map(taskRow).join("")}</div>` : ""}
            </div>`;
          }).join("")}
          </div></details>`;
        }).join("")}
      </details>`).join("");
    $("#daily-count").textContent = f.length + "건";
  }

  app.innerHTML = `
  <h1>일일 기록</h1>
  <p class="page-sub">회사 ERP 데이터 조회 전용 — 주차·일자 접기, 팀원별 최다 시간 업무 우선 표시</p>
  <div class="row">
    ${sel("d-member", CONFIG.TEAM, "", "팀원 전체")}
    ${sel("d-month", months, "", "월 전체")}
    <button class="btn sm ghost" onclick="document.querySelectorAll('#daily-body details').forEach(d=>d.open=false)">모두 접기</button>
    <button class="btn sm ghost" onclick="document.querySelectorAll('#daily-body details').forEach(d=>d.open=true)">모두 펼치기</button>
    <span class="muted" id="daily-count"></span>
  </div>
  <div class="cards" id="daily-cards"></div>
  <div id="daily-body"></div>`;
  $("#f-d-member").onchange = (e) => { state.member = e.target.value; render(); };
  $("#f-d-month").onchange = (e) => { state.month = e.target.value; render(); };
  render();
}

/* ══ 성과물 · 참고자료 — 링크 추가 + 파일 업로드 ══ */
async function vDeliverables() {
  const [dels, refs] = await Promise.all([
    q(sb.from("deliverables").select("*").order("no")),
    q(sb.from("reference_materials").select("*").order("no")),
  ]);
  app.innerHTML = `
  <h1>성과물 · 참고자료</h1><p class="page-sub">산출물 링크 대장 — 링크 추가 및 파일 업로드 가능 (로그인 필요)</p>
  <div class="panel"><h2>성과물 (${dels.length})</h2>
    ${canWrite() ? `<div class="row">
      <button class="btn sm" onclick="delAddLink()">+ 링크 추가</button>
      <label class="btn sm ghost" style="cursor:pointer">📎 파일 업로드<input type="file" id="del-file" class="hidden"></label>
    </div>` : ""}
    <div class="tbl-wrap" style="max-height:45vh"><table>
    <thead><tr><th>번호</th><th>설명</th><th>URL</th><th>담당</th><th>비고</th></tr></thead><tbody>
    ${dels.map(d => `<tr><td>${d.no ?? ""}</td><td class="wrap">${esc(d.title)}</td>
      <td>${d.url ? `<a class="link" href="${esc(d.url)}" target="_blank" rel="noopener">열기 ↗</a>` : ""}</td>
      <td>${esc(d.assignee)}</td><td class="wrap">${esc(d.remark)}</td></tr>`).join("")}
    </tbody></table></div></div>
  <div class="panel"><h2>참고자료 (${refs.length})</h2>
    ${canWrite() ? `<div class="row"><button class="btn sm" onclick="refAddLink()">+ 링크 추가</button></div>` : ""}
    <div class="tbl-wrap" style="max-height:45vh"><table>
    <thead><tr><th>번호</th><th>성과물</th><th>자료</th><th>담당</th></tr></thead><tbody>
    ${refs.map(r => `<tr><td>${r.no ?? ""}</td><td>${r.deliverable_no ?? ""}</td>
      <td class="wrap">${r.url ? `<a class="link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title || "링크")}</a>` : esc(r.title)}</td>
      <td>${esc(r.assignee)}</td></tr>`).join("")}
    </tbody></table></div></div>`;

  const fi = $("#del-file");
  if (fi) fi.addEventListener("change", async () => {
    const file = fi.files[0]; if (!file) return;
    const title = prompt("성과물 설명", file.name); if (title == null) return;
    const path = `deliverables/${Date.now()}_${file.name.replace(/[^\w.\-가-힣]/g, "_")}`;
    try {
      const { error } = await sb.storage.from("files").upload(path, file);
      if (error) throw error;
      const url = sb.storage.from("files").getPublicUrl(path).data.publicUrl;
      const maxNo = Math.max(0, ...(await q(sb.from("deliverables").select("no"))).map(d => d.no || 0));
      await q(sb.from("deliverables").insert({ no: Math.floor(maxNo) + 1, title, url, assignee: me().name, remark: "업로드 파일" }));
      toast("파일 업로드 완료"); route();
    } catch (e) { toast("업로드 실패: " + (e.message || e), true); }
  });
}
window.delAddLink = async function () {
  if (!canWrite()) return needLogin();
  const title = prompt("성과물 설명"); if (!title) return;
  const url = prompt("URL (https://...)"); if (!url) return;
  try {
    const maxNo = Math.max(0, ...(await q(sb.from("deliverables").select("no"))).map(d => d.no || 0));
    await q(sb.from("deliverables").insert({ no: Math.floor(maxNo) + 1, title, url, assignee: me().name }));
    toast("링크 추가 완료"); route();
  } catch (_) {}
};
window.refAddLink = async function () {
  if (!canWrite()) return needLogin();
  const title = prompt("자료명"); if (!title) return;
  const url = prompt("URL (https://...)") || null;
  const dno = prompt("연관 성과물 번호 (선택)") || null;
  try {
    const maxNo = Math.max(0, ...(await q(sb.from("reference_materials").select("no"))).map(d => d.no || 0));
    await q(sb.from("reference_materials").insert({ no: Math.floor(maxNo) + 1, title, url, deliverable_no: dno ? +dno : null, assignee: me().name }));
    toast("자료 추가 완료"); route();
  } catch (_) {}
};

/* ══ 자료실 — HTML/MD 업로드 & 뷰어 (기존 hmcmsite 통합) ══ */
async function vDocs() {
  const { data: files, error } = await sb.storage.from("files").list("docs", { limit: 200, sortBy: { column: "created_at", order: "desc" } });
  if (error) { app.innerHTML = `<div class="panel">자료실 로드 실패: ${esc(error.message)}</div>`; return; }
  const list = (files || []).filter(f => f.name !== ".emptyFolderPlaceholder");
  const pub = (name) => sb.storage.from("files").getPublicUrl("docs/" + name).data.publicUrl;
  const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

  app.innerHTML = `
  <h1>자료실</h1>
  <p class="page-sub">팀원이 생성한 HTML·MD 문서 업로드 및 뷰어 (기존 hmcmsite 기능 통합)</p>
  <div class="row">
    ${canWrite() ? `<label class="btn" style="cursor:pointer">📄 문서 업로드 (.html / .md 등)<input type="file" id="doc-file" class="hidden" accept=".html,.htm,.md,.txt,.pdf,.png,.jpg"></label>` : '<span class="muted">업로드는 로그인 필요</span>'}
    <span class="muted">${list.length}개 문서</span>
  </div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>문서명</th><th>크기</th><th>업로드일</th><th>보기</th>${canWrite() ? "<th></th>" : ""}</tr></thead><tbody>
    ${list.map(f => `<tr>
      <td class="wrap">${esc(f.name.replace(/^\d{13}_/, ""))}</td>
      <td>${f.metadata ? kb(f.metadata.size || 0) : ""}</td>
      <td>${(f.created_at || "").slice(0, 10)}</td>
      <td><button class="btn sm" onclick="docView('${esc(f.name)}')">보기</button>
          <a class="btn sm ghost" style="text-decoration:none" href="${esc(pub(f.name))}" target="_blank" rel="noopener">새 창 ↗</a></td>
      ${canWrite() ? `<td><button class="btn sm ghost" onclick="docDel('${esc(f.name)}')">삭제</button></td>` : ""}
    </tr>`).join("") || `<tr><td colspan="5" class="muted">문서가 없습니다. 첫 문서를 업로드하세요.</td></tr>`}
    </tbody></table></div>
  <div id="doc-viewer" class="panel hidden" style="margin-top:16px">
    <div class="row" style="justify-content:space-between"><h2 id="doc-viewer-title"></h2>
      <button class="btn sm ghost" onclick="$('#doc-viewer').classList.add('hidden')">닫기 ✕</button></div>
    <div id="doc-viewer-body" class="doc-body"></div>
  </div>`;

  const fi = $("#doc-file");
  if (fi) fi.addEventListener("change", async () => {
    const file = fi.files[0]; if (!file) return;
    const path = `docs/${Date.now()}_${file.name.replace(/[^\w.\-가-힣]/g, "_")}`;
    try {
      const { error } = await sb.storage.from("files").upload(path, file);
      if (error) throw error;
      toast("업로드 완료: " + file.name); route();
    } catch (e) { toast("업로드 실패: " + (e.message || e), true); }
  });
}
window.docView = async function (name) {
  const url = sb.storage.from("files").getPublicUrl("docs/" + name).data.publicUrl;
  const viewer = $("#doc-viewer"), body = $("#doc-viewer-body");
  $("#doc-viewer-title").textContent = name.replace(/^\d{13}_/, "");
  viewer.classList.remove("hidden");
  if (/\.md$|\.txt$/i.test(name)) {
    const txt = await (await fetch(url)).text();
    body.innerHTML = /\.md$/i.test(name) ? window.marked.parse(txt) : `<pre style="white-space:pre-wrap">${esc(txt)}</pre>`;
  } else if (/\.html?$/i.test(name)) {
    body.innerHTML = `<iframe src="${esc(url)}" style="width:100%;height:75vh;border:1px solid var(--line);border-radius:8px;background:#fff"></iframe>`;
  } else if (/\.(png|jpg|jpeg|gif)$/i.test(name)) {
    body.innerHTML = `<img src="${esc(url)}" style="max-width:100%">`;
  } else {
    body.innerHTML = `<a class="link" href="${esc(url)}" target="_blank">다운로드 ↗</a>`;
  }
  viewer.scrollIntoView({ behavior: "smooth" });
};
window.docDel = async function (name) {
  if (!confirm("문서를 삭제할까요?")) return;
  const { error } = await sb.storage.from("files").remove(["docs/" + name]);
  if (error) toast("삭제 실패: " + error.message, true);
  else { toast("삭제됨"); route(); }
};

/* ══ 근태 — 월별 집계 대시보드 ══ */
async function vAttendance() {
  const rows = await q(sb.from("attendance").select("*").order("att_date", { ascending: false }));
  const months = [...new Set(rows.map(r => (r.att_date || "").slice(0, 7)))].filter(Boolean).sort().reverse();
  const state = { month: months[0] || "" };

  function render() {
    const f = state.month ? rows.filter(r => (r.att_date || "").startsWith(state.month)) : rows;
    // 집계: 팀원 × 구분
    const types = [...new Set(f.map(r => r.att_type || "기타"))];
    const agg = {};
    for (const r of f) {
      const k = r.name;
      agg[k] = agg[k] || {};
      agg[k][r.att_type || "기타"] = (agg[k][r.att_type || "기타"] || 0) + 1;
    }
    $("#att-agg").innerHTML = `
      <table><thead><tr><th>팀원</th>${types.map(tp => `<th>${esc(tp)}</th>`).join("")}<th>합계</th></tr></thead><tbody>
      ${Object.entries(agg).map(([name, m]) => `<tr><td><b>${esc(name)}</b></td>
        ${types.map(tp => `<td>${m[tp] || ""}</td>`).join("")}
        <td><b>${Object.values(m).reduce((s, v) => s + v, 0)}</b></td></tr>`).join("") || `<tr><td colspan="9" class="muted">해당 월 근태 없음</td></tr>`}
      </tbody></table>`;
    $("#att-body").innerHTML = f.map(x => `<tr ${x.att_date >= today() ? 'style="background:#fffbeb"' : ""}>
      <td>${fmtD(x.att_date)}</td><td>${esc(x.name)}</td>
      <td><span class="badge ${x.att_type === "연차" ? "b-prog" : x.att_type === "출장" ? "b-go" : "b-warn"}">${esc(x.att_type)}</span></td>
      <td class="wrap">${esc(x.remark)}</td></tr>`).join("");
  }

  app.innerHTML = `
  <h1>근태</h1><p class="page-sub">월별 집계 + 상세 기록. 연장근무 신청은 당일 16:00까지.</p>
  <div class="row">
    ${sel("a-month", months, state.month, "전체 기간")}
    ${canWrite() ? '<button class="btn" onclick="attAdd()">+ 근태 등록</button>' : ""}
  </div>
  <div class="panel"><h2>월별 집계 <span class="muted" id="att-mon-label"></span></h2><div id="att-agg"></div></div>
  <div class="panel"><h2>상세 기록</h2>
  <div class="tbl-wrap" style="max-height:50vh"><table>
    <thead><tr><th>날짜</th><th>이름</th><th>구분</th><th>비고</th></tr></thead>
    <tbody id="att-body"></tbody></table></div></div>`;
  $("#f-a-month").onchange = (e) => { state.month = e.target.value; render(); };
  render();
}
window.attAdd = async function () {
  if (!canWrite()) return needLogin();
  const att_date = prompt("날짜 (YYYY-MM-DD)", today()); if (!att_date) return;
  const name = prompt("이름", me().name); if (!name) return;
  const att_type = prompt("구분 (연차/시차/출장/연장근무 등)", "연차"); if (!att_type) return;
  const remark = prompt("비고 (선택)") || null;
  try { await q(sb.from("attendance").insert({ att_date, name, att_type, remark })); toast("근태 등록 완료"); route(); } catch (_) {}
};

/* ══ 운영 규칙 — 통합 단일 표 ══ */
async function vNotes() {
  const notes = await q(sb.from("notes").select("*").order("no"));
  const sysRules = [
    ["이슈", "안건(1문장) → 질의(번호 목록) → 본인생각(1:1 대응) 순으로 작성. GO 제출 시 자동 잠금, 추가 의견은 댓글로."],
    ["일정", "Start·End(plan)는 최초 입력 후 수정 불가. 진행률 100% 처리 시 End(real) 필수 — 지연/조기는 시스템 자동 판정."],
    ["일일 기록", "회사 ERP 원본 유지 — 본 사이트는 조회·집계 전용."],
    ["협업", "댓글 + Slack 알림 (GO 제출 / 피드백 등록 / @멘션)."],
    ["회의", "매주 월 09:00 주간 계획/실적 회의 · 금 17:00 주간 업무 정리."],
    ["시간", "회의 없는 시간 09~10시·15~17시 / 회의 가능 시간 10~12시·13~15시."],
    ["근태", "연장근무 신청은 해당 일 16:00까지."],
  ];
  app.innerHTML = `
  <h1>운영 규칙</h1><p class="page-sub">CM기획팀 운영 규칙 — 시스템 강제 항목은 사이트에서 자동 적용됩니다.</p>
  <div class="panel">
    <table><thead><tr><th style="width:90px">구분</th><th>규칙</th></tr></thead><tbody>
    ${sysRules.map(([cat, txt]) => `<tr><td><span class="badge b-go">${cat}</span></td><td class="wrap">${esc(txt)}</td></tr>`).join("")}
    ${notes.map(n => `<tr><td><span class="badge b-gray">전달 ${n.no ?? ""}</span></td><td class="wrap">${esc(n.content)}</td></tr>`).join("")}
    </tbody></table></div>`;
}

/* ── boot ─────────────────────────────────────── */
window.addEventListener("hashchange", route);
initAuth().then(route);
