/* CM기획팀 업무 관리 시스템 v3 — SPA (Supabase + GitHub Pages) */
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
  setTimeout(() => d.remove(), 4500);
}
function needLogin() { toast("로그인이 필요합니다. 좌측 하단에서 사번으로 로그인하세요.", true); }
const canWrite = () => !!session;
function me() {
  if (!session) return null;
  const m = session.user.user_metadata || {};
  const empno = m.empno || (session.user.email || "").split("@")[0];
  const u = CONFIG.USERS[empno] || {};
  return { empno, name: m.name || u.name || empno, role: m.role || u.role || "normal" };
}
window.changePw = function () {
  if (!canWrite()) return needLogin();
  modal("비밀번호 변경", [
    fld("새 비밀번호 (6자 이상) <span class='req'>*</span>", `<input type="password" name="p1" required minlength="6" style="width:100%" autocomplete="new-password">`),
    fld("새 비밀번호 확인 <span class='req'>*</span>", `<input type="password" name="p2" required style="width:100%" autocomplete="new-password">`),
  ].join(""), async (f) => {
    if (f.get("p1") !== f.get("p2")) { toast("비밀번호가 일치하지 않습니다.", true); return false; }
    const { error } = await sb.auth.updateUser({ password: f.get("p1") });
    if (error) { toast("변경 실패: " + error.message, true); return false; }
    toast("비밀번호가 변경되었습니다. 다음 로그인부터 적용됩니다.");
  }, "변경");
};
const isMaster = () => me()?.role === "master";
const hhmm = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return String(ts).slice(11, 16);
  return d.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
};
/* 일일 기록에서 시차·연차(휴가) 로그 판별 — 업무시간 합계에서 제외 */
const isLeaveLog = (r) => { const s = (r.subcode || "").replace(/\s/g, ""); return s.includes("시차") || s.includes("연차"); };
/* 월요일 시작 주차 라벨 — 목요일이 속한 달을 기준으로 'N월 M주차 (월~금)' */
function weekOfMonthLabel(dateStr) {
  const [Y, M, D] = String(dateStr).split("-").map(Number);
  const d = new Date(Y, M - 1, D);
  const dow = (d.getDay() + 6) % 7;                 // Mon=0 … Sun=6
  const mon = new Date(d); mon.setDate(d.getDate() - dow);
  const thu = new Date(mon); thu.setDate(mon.getDate() + 3);   // 소속 월 판정 기준
  const first = new Date(thu.getFullYear(), thu.getMonth(), 1);
  const firstThu = 1 + ((3 - ((first.getDay() + 6) % 7) + 7) % 7);
  const wk = Math.floor((thu.getDate() - firstThu) / 7) + 1;
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  const p = (n) => String(n).padStart(2, "0");
  const fmt = (t) => `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  return `${thu.getMonth() + 1}월 ${wk}주차 (${fmt(mon)}~${fmt(fri)})`;
}
/* KST 날짜+시간 "YYYY-MM-DD HH:MM" */
const kstDateTime = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return String(ts).slice(0, 16).replace("T", " ");
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) + " " + hhmm(ts);
};
/* 수정·삭제 권한: 해당 건의 담당자(owner) 또는 팀장(master)만 */
const canEditOwn = (owner) => !!session && (isMaster() || (!!me() && me().name === owner));
function guardEdit(owner) {
  if (canEditOwn(owner)) return true;
  toast("해당 건의 담당자 또는 팀장만 수정·삭제할 수 있습니다.", true);
  return false;
}

/* ── 알림 (in-app notifications) ─────────────── */
let _notifs = [];
async function loadNotifs() {
  const bell = $("#notif-bell");
  if (!session) { _notifs = []; if (bell) { bell.classList.add("hidden"); bell.innerHTML = ""; } return; }
  try {
    _notifs = await q(sb.from("notifications").select("*").eq("recipient", me().name).order("created_at", { ascending: false }).limit(50));
  } catch (_) { _notifs = []; }
  renderNotifBell();
}
function renderNotifBell() {
  const el = $("#notif-bell"); if (!el) return;
  if (!session) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.classList.remove("hidden");
  const unread = _notifs.filter(n => !n.is_read).length;
  el.innerHTML = `<button type="button" class="notif-btn ${unread ? "has-unread" : ""}" onclick="openNotifModal()">🔔 알림${unread ? ` <span class="notif-badge">${unread}</span>` : ""}</button>`;
}
window.openNotifModal = function () {
  const unread = _notifs.filter(n => !n.is_read);
  const read = _notifs.filter(n => n.is_read).slice(0, 5);   // 확인한 알림은 최근 5건 유지
  const item = (n) => `<div class="notif-item ${n.is_read ? "" : "unread"}" onclick="notifOpen(${n.id}, '${esc(n.link || "")}')">
      <div class="notif-msg">${esc(n.message)}</div>
      <div class="notif-time">${kstDateTime(n.created_at)}${n.is_read ? "" : ' <span class="badge b-warn">NEW</span>'}</div>
    </div>`;
  let body = `<div class="notif-sec"><div class="notif-sec-h">🔴 신규 알림${unread.length ? ` (${unread.length})` : ""}</div>`
    + (unread.length ? unread.map(item).join("") : '<p class="muted" style="margin:2px 0 0">새 알림이 없습니다.</p>')
    + `</div>`;
  if (read.length) body += `<div class="notif-sec"><div class="notif-sec-h">확인한 알림 <small class="muted">(최근 ${read.length})</small></div>` + read.map(item).join("") + `</div>`;
  const foot = unread.length ? `<div class="row" style="margin-top:8px;margin-bottom:0"><button class="btn sm ghost" onclick="notifReadAll()">모두 읽음</button></div>` : "";
  modal("🔔 알림", body + foot, null);
};
window.notifOpen = async function (id, link) {
  try { await q(sb.from("notifications").update({ is_read: true }).eq("id", id)); } catch (_) {}
  document.querySelectorAll(".modal-back").forEach(w => w.remove());
  await loadNotifs();
  if (link) { location.hash = link; route(); }
};
window.notifReadAll = async function () {
  try { await q(sb.from("notifications").update({ is_read: true }).eq("recipient", me().name).eq("is_read", false)); } catch (_) {}
  document.querySelectorAll(".modal-back").forEach(w => w.remove());
  await loadNotifs();
  toast("모든 알림을 읽음 처리했습니다.");
};
async function notify(recipient, message, link, type) {
  if (!recipient || !me() || recipient === me().name) return;
  try { await sb.from("notifications").insert({ recipient, actor: me().name, type: type || null, message, link: link || null }); } catch (_) {}
}

/* ── 실시간 접속자 (Realtime Presence) ─────────── */
let _presenceCh = null;
function initPresence() {
  const el = $("#presence");
  if (!session || !me()) {
    if (_presenceCh) { try { sb.removeChannel(_presenceCh); } catch (_) {} _presenceCh = null; }
    if (el) { el.classList.add("hidden"); el.innerHTML = ""; }
    return;
  }
  if (_presenceCh) return;                       // 이미 접속 채널 유지 중
  const u = me();
  _presenceCh = sb.channel("online-users", { config: { presence: { key: u.empno } } });
  _presenceCh.on("presence", { event: "sync" }, renderPresence);
  _presenceCh.subscribe(async (st) => { if (st === "SUBSCRIBED") { try { await _presenceCh.track({ name: u.name, empno: u.empno }); } catch (_) {} } });
}
function renderPresence() {
  const el = $("#presence"); if (!el) return;
  if (!_presenceCh || !session) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const state = _presenceCh.presenceState();
  const seen = {}, users = [];
  for (const k in state) { const m = (state[k] || [])[0]; if (m && m.name && !seen[m.name]) { seen[m.name] = 1; users.push(m); } }
  users.sort((a, b) => CONFIG.TEAM.indexOf(a.name) - CONFIG.TEAM.indexOf(b.name));
  if (!users.length) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const myName = me() && me().name;
  el.classList.remove("hidden");
  el.innerHTML = `<div class="presence-row">${users.map(m => {
    const gn = (m.name || "").length > 1 ? m.name.slice(1) : (m.name || "");
    const self = m.name === myName;
    return `<span class="presence-dot ${self ? "self" : ""}" title="접속 중: ${esc(m.name)}${self ? " (나)" : ""}">${esc(gn)}</span>`;
  }).join("")}</div>`;
}

/* 범용 모달 */
function modal(title, bodyHtml, onSubmit, submitLabel = "저장") {
  const wrap = document.createElement("div");
  wrap.className = "modal-back";
  wrap.innerHTML = `<div class="modal">
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>${title}</h2>
      <button type="button" class="btn sm ghost" data-x>✕ 닫기</button></div>
    <form id="modal-form">${bodyHtml}
      ${onSubmit ? `<div class="row" style="margin-top:14px;margin-bottom:0"><button class="btn" type="submit">${submitLabel}</button></div>` : ""}
    </form></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.hasAttribute("data-x")) wrap.remove();
  });
  if (onSubmit) $("#modal-form", wrap).addEventListener("submit", async (e) => {
    e.preventDefault();
    const ok = await onSubmit(new FormData(e.target), wrap);
    if (ok !== false) wrap.remove();
  });
  return wrap;
}
const fld = (label, inner, hint) => `<div class="field"><label>${label}</label>${inner}${hint ? `<div class="field-hint">${hint}</div>` : ""}</div>`;
const selHtml = (name, options, selected, allLabel) =>
  `<select name="${name}" style="width:100%">` + (allLabel ? `<option value="">${allLabel}</option>` : "") +
  options.map(o => `<option value="${esc(o)}" ${o === selected ? "selected" : ""}>${esc(o)}</option>`).join("") + `</select>`;

/* 이슈 완료 판정 — 요청 Cancel 은 상태 공란이어도 완료 */
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
  document.body.classList.toggle("locked", !session);
  $("#auth-form").classList.toggle("hidden", !!session);
  $("#auth-user").classList.toggle("hidden", !session);
  if (session) {
    const u = me();
    $("#auth-email").innerHTML = esc(u.name) + (u.role === "master" ? ' <span class="badge b-go">팀장</span>' : "") +
      `<br><small class="muted">${esc(u.empno)} · CM기획팀</small>` +
      `<br><a href="javascript:changePw()" style="color:#93c5fd;font-size:11px">비밀번호 변경</a>`;
  }
  loadNotifs();
  initPresence();
}

/* ── router ───────────────────────────────────── */
const routes = {
  "/": vDashboard, "/tasks": vTasks, "/wbs": vWbsManage, "/issues": vIssues,
  "/weekly": vWeekly, "/daily": vDaily, "/deliverables": vDeliverables,
  "/docs": vDocs, "/attendance": vAttendance, "/suggest": vSuggest, "/notes": vNotes,
};
function renderLoginGate() {
  app.innerHTML = `<div class="login-hero"><div class="login-card">
    <div class="login-logo">HMCM · CM기획팀</div>
    <h1>업무 관리 시스템</h1>
    <p class="muted" style="margin-bottom:18px">로그인 후 이용할 수 있습니다.</p>
    <form id="main-login">
      <input type="text" id="ml-empno" placeholder="사번" autocomplete="username" required>
      <input type="password" id="ml-pw" placeholder="비밀번호" autocomplete="current-password" required>
      <button class="btn" type="submit" style="width:100%">로그인</button>
    </form></div></div>`;
  $("#main-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const empno = $("#ml-empno").value.trim().toLowerCase();
    const { error } = await sb.auth.signInWithPassword({
      email: empno + "@" + CONFIG.AUTH_DOMAIN, password: $("#ml-pw").value });
    if (error) toast("로그인 실패: 사번 또는 비밀번호를 확인하세요.", true);
    else { toast((CONFIG.USERS[empno]?.name || empno) + "님 환영합니다."); route(); }
  });
}
async function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  document.querySelectorAll("#sidebar nav a").forEach(a => {
    const r = a.dataset.route;
    a.classList.toggle("active", r === "/" ? hash === "/" : hash.startsWith(r));
  });
  if (!session) { renderLoginGate(); return; }
  loadNotifs();
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

/* ══ 대시보드 ══ */
async function vDashboard() {
  const t = today();
  const p2 = n => String(n).padStart(2, "0");
  const iso = d => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  const base = new Date(t + "T00:00:00");
  const dow = (base.getDay() + 6) % 7;                       // 월=0 … 일=6
  const thisMon = new Date(base); thisMon.setDate(base.getDate() - dow);
  const startMon = new Date(thisMon); startMon.setDate(thisMon.getDate() - 7);   // 지난주 월
  const endSun = new Date(thisMon); endSun.setDate(thisMon.getDate() + 13);      // 다음주 일

  const [notices, tasks, issues, att, cmts] = await Promise.all([
    q(sb.from("notices").select("*").order("created_at", { ascending: false }).limit(8)),
    q(sb.from("wbs_tasks").select("*")),
    q(sb.from("wbs_issues").select("*")),
    q(sb.from("attendance").select("*").gte("att_date", t).order("att_date").limit(12)),
    q(sb.from("comments").select("target_id").eq("target_table", "wbs_issues")),
  ]);
  let calEvents = [];
  try { calEvents = await q(sb.from("calendar_events").select("*").gte("event_date", iso(startMon)).lte("event_date", iso(endSun)).order("id")); } catch (_) {}

  const cmtCount = {};
  for (const c of cmts) cmtCount[c.target_id] = (cmtCount[c.target_id] || 0) + 1;
  const openTasks = tasks.filter(x => (x.progress ?? 0) < 1)
    .sort((a, b) => (a.end_plan || "9999").localeCompare(b.end_plan || "9999"));
  const late = openTasks.filter(x => x.end_plan && x.end_plan < t);
  const openIssues = issues.filter(x => !issueClosed(x))
    .sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || ""));
  const avg = tasks.length ? tasks.reduce((s, x) => s + (x.progress ?? 0), 0) / tasks.length : 0;

  // 주 달력 (지난주·이번주·다음주 3주)
  const evBy = {};
  calEvents.forEach(e => (evBy[e.event_date] = evBy[e.event_date] || []).push(e));
  const wd = ["월", "화", "수", "목", "금", "토", "일"];
  const wlab = ["지난주", "이번주", "다음주"];
  let calRows = "";
  for (let w = 0; w < 3; w++) {
    calRows += `<div class="cal-wlabel">${wlab[w]}</div>`;
    for (let d = 0; d < 7; d++) {
      const cell = new Date(startMon); cell.setDate(startMon.getDate() + w * 7 + d);
      const cs = iso(cell);
      const cls = (cs === t ? " cal-today" : "") + (d === 5 ? " cal-sat" : d === 6 ? " cal-sun" : "") + (isMaster() ? " cal-edit" : "");
      calRows += `<div class="cal-cell${cls}" ${isMaster() ? `onclick="calAdd('${cs}')"` : ""}>
        <div class="cal-dnum">${cell.getMonth() + 1}/${cell.getDate()}</div>
        ${(evBy[cs] || []).map(e => `<div class="cal-ev c-${esc(e.color || "blue")}" title="${esc(e.title)}"><span class="cal-ev-t">${esc(e.title)}</span>${isMaster() ? `<span class="cal-ev-x" onclick="event.stopPropagation();calDel(${e.id})">×</span>` : ""}</div>`).join("")}
      </div>`;
    }
  }

  app.innerHTML = `
  <h1>대시보드</h1><p class="page-sub">CM기획팀 업무 현황 (${t})</p>

  <div class="panel"><h2>🗓 주 달력 <small class="muted">지난주 · 이번주 · 다음주${isMaster() ? " — 날짜 클릭하여 일정 추가" : ""}</small></h2>
    <div class="cal-grid">
      <div class="cal-hcell"></div>${wd.map((n, i) => `<div class="cal-hcell${i === 5 ? " cal-sat" : i === 6 ? " cal-sun" : ""}">${n}</div>`).join("")}
      ${calRows}
    </div>
  </div>

  <div class="panel notice-panel"><h2>📢 공지 · 팀 전달사항</h2>
    ${notices.length ? notices.map(n => `<div class="notice-item">
      <div class="meta"><span class="badge ${n.type === "team" ? "b-prog" : "b-warn"}">${n.type === "team" ? "팀 전달" : "회사 공지"}</span> ${esc(n.author)} · ${kstDateTime(n.created_at)}
        ${isMaster() ? `<button class="btn sm ghost" onclick="noticeDel(${n.id})">삭제</button>` : ""}</div>
      <div class="body">${esc(n.content)}</div></div>`).join("") : '<p class="muted">등록된 공지가 없습니다.</p>'}
    ${isMaster() ? `<form id="notice-form" class="row" style="margin-top:10px;margin-bottom:0">
      <select id="notice-type"><option value="company">회사 공지</option><option value="team">팀 전달</option></select>
      <input type="text" id="notice-content" placeholder="공지 / 팀 전달사항 입력 (팀장 전용)" style="flex:1;min-width:180px" required>
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
    ${openIssues.map(x => `<tr><td style="white-space:nowrap">${fmtD(x.issue_date)}${x.created_at ? ` <small class="muted">${hhmm(x.created_at)}</small>` : ""}</td><td>${esc(x.assignee)}</td>
      <td class="wrap"><a class="link" href="#/issues/${x.id}">${esc((x.agenda || x.question || "").slice(0, 90)) || "(무제)"}</a>${cmtCount[x.id] ? ` <span class="cmt-badge" title="댓글 ${cmtCount[x.id]}개">💬 ${cmtCount[x.id]}</span>` : ""}</td>
      <td>${goBadge(x.request_go)}</td><td>${issueStatusBadge(x)}</td></tr>`).join("")}
    </tbody></table></div>` : '<p class="muted">모든 이슈가 완료되었습니다.</p>'}
  </div>

  <div class="panel"><h2>다가오는 근태</h2>${att.length ? `
    <table><thead><tr><th>날짜</th><th>이름</th><th>구분</th><th>비고</th></tr></thead><tbody>
    ${att.map(x => `<tr><td>${fmtD(x.att_date)}</td><td>${esc(x.name)}</td>
      <td><span class="badge b-warn">${esc(x.att_type)}</span></td><td>${esc(x.remark)}</td></tr>`).join("")}
    </tbody></table>` : '<p class="muted">예정 없음</p>'}
  </div>

  <details class="panel dash-tasks"><summary>진행 중 과업 (${openTasks.length}) <small class="muted">— 기한 경과 ${late.length}건 · 클릭하여 펼치기</small></summary>
    <div class="tbl-wrap" style="max-height:none;margin-top:10px"><table><thead><tr><th>업무</th><th>담당</th><th>Start</th><th>End(plan)</th><th>진행률</th></tr></thead><tbody>
    ${openTasks.map(x => `<tr ${x.end_plan && x.end_plan < t ? 'class="row-late"' : ""}>
      <td class="wrap">${esc(x.lv6_content || x.lv5_work)}</td><td>${esc(x.assignee)}</td>
      <td>${fmtD(x.start_date)}</td>
      <td>${x.end_plan && x.end_plan < t ? `<span class="badge b-late">${fmtD(x.end_plan)}</span>` : fmtD(x.end_plan)}</td>
      <td>${progBar(x.progress)}</td></tr>`).join("")}
    </tbody></table></div>
  </details>`;

  const nf = $("#notice-form");
  if (nf) nf.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await q(sb.from("notices").insert({ author: me().name, content: $("#notice-content").value.trim(), type: $("#notice-type").value }));
      toast("등록 완료"); route();
    } catch (_) { toast("등록 실패 — notices.type 컬럼(마이그레이션 SQL) 적용을 확인하세요.", true); }
  });
}
window.calAdd = function (dateISO) {
  if (!isMaster()) return toast("일정 추가는 팀장만 가능합니다.", true);
  modal("일정 추가 · " + dateISO, [
    fld("제목 <span class='req'>*</span>", `<input type="text" name="title" style="width:100%" required maxlength="40" placeholder="예: 사장님 세미나, 착수보고">`),
    fld("색상 구분", `<select name="color" style="width:100%">
      <option value="blue">🔵 파랑 (일정 · 회의)</option>
      <option value="red">🔴 빨강 (마감 · 중요)</option>
      <option value="green">🟢 초록 (완료 · 승인)</option>
      <option value="amber">🟠 주황 (주의)</option>
      <option value="gray">⚪ 회색 (기타)</option></select>`),
  ].join(""), async (f) => {
    try {
      await q(sb.from("calendar_events").insert({ event_date: dateISO, title: f.get("title").trim(), color: f.get("color"), created_by: me().name }));
      toast("일정 추가 완료"); route();
    } catch (_) { toast("추가 실패 — calendar_events 테이블(마이그레이션 SQL) 적용을 확인하세요.", true); return false; }
  }, "추가");
};
window.calDel = async function (id) {
  if (!isMaster()) return toast("일정 삭제는 팀장만 가능합니다.", true);
  if (!confirm("이 일정을 삭제할까요?")) return;
  try { await q(sb.from("calendar_events").delete().eq("id", id)); toast("삭제됨"); route(); } catch (_) {}
};
window.noticeDel = async function (id) {
  if (!isMaster()) return toast("공지 삭제는 팀장만 가능합니다.", true);
  if (!confirm("공지를 삭제할까요?")) return;
  try { await q(sb.from("notices").delete().eq("id", id)); toast("삭제됨"); route(); } catch (_) {}
};

/* ══ WBS 진행 현황 ══ */
let _tasks = [], _wbsMenus = [];
async function vTasks() {
  const [tasks, codes] = await Promise.all([
    q(sb.from("wbs_tasks").select("*").order("id")),
    q(sb.from("wbs_codes").select("code").order("code")),
  ]);
  _tasks = tasks;
  _wbsMenus = [...new Set([...codes.map(c => c.code), ...tasks.map(t => t.lv3_menu).filter(Boolean)])].sort();
  const state = { assignee: "", status: "" };

  function filtered() {
    let rows = tasks;
    if (state.assignee) rows = rows.filter(x => x.assignee === state.assignee);
    if (state.status === "done") rows = rows.filter(x => (x.progress ?? 0) >= 1);
    if (state.status === "open") rows = rows.filter(x => (x.progress ?? 0) < 1);
    if (state.status === "late") rows = rows.filter(x => (x.progress ?? 0) < 1 && x.end_plan && x.end_plan < today());
    if (state.status === "holding") rows = rows.filter(x => x.holding);
    return rows;
  }

  function render() {
    const rows = filtered();
    const dates = rows.flatMap(x => [x.start_date, x.end_plan, x.end_real]).filter(Boolean).sort();
    const min = dates[0] ? new Date(dates[0]) : new Date();
    const max = dates.length ? new Date(dates[dates.length - 1]) : new Date();
    max.setDate(max.getDate() + 10);
    const span = Math.max(1, max - min);
    const t = new Date(today());
    const todayPos = t >= min && t <= max ? ((t - min) / span * 100) : null;
    // 월 눈금 + 격월 밴드
    const ticks = [];
    const cur = new Date(min.getFullYear(), min.getMonth(), 1);
    while (cur <= max) {
      const pos = (cur - min) / span * 100;
      const nxt = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const w = (Math.min(nxt, max) - Math.max(cur, min)) / span * 100;
      ticks.push({ pos: Math.max(0, pos), w: Math.max(0, w), label: (cur.getMonth() + 1) + "월", band: cur.getMonth() % 2 === 0 });
      cur.setMonth(cur.getMonth() + 1);
    }
    const scaleHeader = `<div class="gantt-scale">
      ${ticks.map(k => `<span class="gantt-tick" style="left:${k.pos}%">${k.label}</span>`).join("")}
      ${todayPos != null ? `<span class="gantt-today-flag" style="left:${todayPos}%">오늘</span>` : ""}</div>`;

    const gantt = (x) => {
      if (!x.start_date) return "";
      const s = new Date(x.start_date), e0 = new Date(x.end_real || x.end_plan || x.start_date);
      const e = new Date(e0); e.setDate(e.getDate() + 1); // 종료일 포함
      const l = Math.max(0, (s - min) / span * 100);
      const w = Math.max(1.6, (e - s) / span * 100);
      const done = (x.progress ?? 0) >= 1;
      const late = !done && x.end_plan && x.end_plan < today();
      const p = Math.min(100, Math.round((x.progress ?? 0) * 100));
      const days = Math.round((e0 - s) / 86400000) + 1;
      return `<div class="gantt-bar-wrap">
        ${ticks.map(k => k.band ? `<i class="gantt-band" style="left:${k.pos}%;width:${k.w}%"></i>` : "").join("")}
        ${ticks.map(k => `<i class="gantt-grid" style="left:${k.pos}%"></i>`).join("")}
        ${todayPos != null ? `<div class="gantt-today" style="left:${todayPos}%"></div>` : ""}
        <div class="gantt-bar ${done ? "done" : late ? "late" : ""}" style="left:${l}%;width:${w}%"
          title="${fmtD(x.start_date)} ~ ${fmtD(x.end_real || x.end_plan)} (${days}일) · 진행률 ${p}%">
          <i class="gantt-prog" style="width:${p}%"></i></div>
        <span class="gantt-label" style="left:${Math.min(l + w + 0.5, 88)}%">${fmtD(x.start_date).slice(5)}~${fmtD(x.end_real || x.end_plan).slice(5)}</span>
      </div>`;
    };

    const groups = [];
    let g = null;
    for (const x of rows) {
      if (!g || x.lv3_menu !== g.lv3) { g = { lv3: x.lv3_menu, items: [] }; groups.push(g); }
      g.items.push(x);
    }
    $("#task-body").innerHTML = groups.map(grp => `
      <details class="wbs-group" open>
        <summary><b>${esc(grp.lv3 || "(미분류)")}</b>
          <span class="muted">${grp.items.length}건 · 평균 ${pct(grp.items.reduce((s, x) => s + (x.progress ?? 0), 0) / grp.items.length)}</span>
        </summary>
        <div class="tbl-wrap" style="max-height:none;border-radius:0 0 10px 10px;border-top:none">
        <table><thead><tr><th style="min-width:220px">상세 업무</th><th>담당</th><th>시급성</th><th>Start</th><th>End(plan)</th><th>End(real)</th><th style="min-width:130px">진행률</th>
        <th style="min-width:340px"><div style="position:relative">${scaleHeader}</div></th>${canWrite() ? "<th></th>" : ""}</tr></thead><tbody>
        ${grp.items.map(x => `<tr>
          <td class="wrap">${x.lv5_work && x.lv6_content ? `<small class="muted">${esc(x.lv5_work)}</small><br>` : ""}${esc(x.lv6_content || x.lv5_work || "")}${x.remark ? `<div class="task-lc">📝 <b>팀장 코멘트</b> · ${esc(x.remark)}</div>` : ""}</td>
          <td>${esc(x.assignee || "")}</td>
          <td><span class="badge ${x.urgency === "S" ? "b-late" : x.urgency === "A" ? "b-warn" : "b-gray"}">${esc(x.urgency || "-")}</span></td>
          <td>${fmtD(x.start_date)}</td><td>${fmtD(x.end_plan)}</td>
          <td>${x.holding ? '<span class="badge b-hold">⏸ Holding</span>' : (x.end_real ? fmtD(x.end_real) + (x.end_plan && x.end_real > x.end_plan ? ' <span class="badge b-late">지연</span>' : x.end_plan && x.end_real < x.end_plan ? ' <span class="badge b-done">조기</span>' : "") : '<span class="muted">-</span>')}</td>
          <td>${progBar(x.progress)}</td>
          <td>${gantt(x)}</td>
          ${canWrite() ? `<td style="white-space:nowrap">${canEditOwn(x.assignee) ? `<button class="btn sm ghost" onclick="taskEdit(${x.id})">수정</button>
            <button class="btn sm ghost" style="color:var(--danger)" onclick="taskDel(${x.id})">삭제</button>` : `<span class="muted">-</span>`}</td>` : ""}
        </tr>`).join("")}
        </tbody></table></div>
      </details>`).join("");
    $("#task-count").textContent = rows.length + "건";
  }

  app.innerHTML = `
  <h1>WBS 진행 현황</h1>
  <p class="page-sub">WBS(Lv3) 그룹별 접기 + 간트 타임라인. Start·End(plan)는 최초 입력 후 수정 불가, 완료 시 End(real) 필수 (시스템 강제)</p>
  <div class="row">
    ${sel("assignee", CONFIG.TEAM, "", "담당자 전체")}
    <select id="f-status"><option value="">상태 전체</option><option value="open">진행중</option>
      <option value="late">기한 경과</option><option value="holding">Holding</option><option value="done">완료</option></select>
    <button class="btn sm ghost" id="btn-fold">모두 접기</button>
    <button class="btn sm ghost" id="btn-unfold">모두 펼치기</button>
    <span class="muted" id="task-count"></span>
    ${canWrite() ? '<button class="btn" onclick="taskNew()">+ 과업 등록</button>' : ""}
    ${isMaster() ? '<button class="btn ghost" onclick="wbsNew()">+ WBS 등록 (팀장)</button><a class="btn ghost" href="#/wbs" style="text-decoration:none">WBS 전체 관리</a>' : ""}
  </div>
  <div id="task-body"></div>`;
  $("#f-assignee").onchange = (e) => { state.assignee = e.target.value; render(); };
  $("#f-status").onchange = (e) => { state.status = e.target.value; render(); };
  $("#btn-fold").onclick = () => document.querySelectorAll(".wbs-group").forEach(d => d.open = false);
  $("#btn-unfold").onclick = () => document.querySelectorAll(".wbs-group").forEach(d => d.open = true);
  render();
}

window.wbsNew = function () {
  if (!isMaster()) return toast("팀장만 WBS를 등록할 수 있습니다.", true);
  modal("WBS 등록 (WBS_CODE)", [
    fld("Level 1 — 상단 메뉴 탭", `<input type="text" name="lv1" style="width:100%" placeholder="예: 1. 일일보고">`),
    fld("Level 2 — 소분류 그룹", `<input type="text" name="lv2" style="width:100%" placeholder="예: 1.1 입력 및 보고">`),
    fld("Level 3 — 실행 메뉴 코드 <span class='req'>*</span>", `<input type="text" name="code" style="width:100%" required placeholder="예: 1.1.5 신규 메뉴명">`),
    fld("설명", `<input type="text" name="desc" style="width:100%">`),
    fld("우선순위", `<input type="number" name="pri" step="0.5" style="width:100px" value="0">`),
  ].join(""), async (f) => {
    try {
      await q(sb.from("wbs_codes").insert({
        lv1: f.get("lv1") || null, lv2: f.get("lv2") || null, code: f.get("code"),
        description: f.get("desc") || null, priority: parseFloat(f.get("pri")) || 0,
      }));
      toast("WBS 등록 완료 — 과업 등록 드롭다운에 반영됩니다."); route();
    } catch (_) { return false; }
  }, "등록");
};

/* ══ 전체 WBS 관리 (팀장) ══ */
let _wbsCodes = [];
async function vWbsManage() {
  const [codes, tasks] = await Promise.all([
    q(sb.from("wbs_codes").select("*")),
    q(sb.from("wbs_tasks").select("lv3_menu")),
  ]);
  const usage = {};
  for (const t of tasks) if (t.lv3_menu) usage[t.lv3_menu] = (usage[t.lv3_menu] || 0) + 1;
  const cmp = (a, b) => String(a || "").localeCompare(String(b || ""), "ko", { numeric: true });
  codes.sort((a, b) => cmp(a.lv1, b.lv1) || cmp(a.lv2, b.lv2) || cmp(a.code, b.code));
  _wbsCodes = codes;
  const state = { kw: "" };

  function render() {
    let rows = _wbsCodes;
    if (state.kw) {
      const k = state.kw.toLowerCase();
      rows = rows.filter(x => ((x.lv1 || "") + " " + (x.lv2 || "") + " " + (x.code || "") + " " + (x.description || "")).toLowerCase().includes(k));
    }
    const groups = []; const gmap = {};
    for (const x of rows) {
      const key = x.lv1 || "(미분류)";
      if (!gmap[key]) { gmap[key] = { lv1: key, items: [] }; groups.push(gmap[key]); }
      gmap[key].items.push(x);
    }
    $("#wbs-body").innerHTML = groups.map(g => `
      <details class="wbs-group" open>
        <summary><b>${esc(g.lv1)}</b> <span class="muted">${g.items.length}개 코드</span></summary>
        <div class="tbl-wrap" style="max-height:none;border-radius:0 0 10px 10px;border-top:none">
        <table><thead><tr><th style="min-width:130px">Lv2 소분류</th><th style="min-width:200px">Lv3 실행 메뉴 코드</th><th>설명</th><th style="width:80px">우선순위</th><th style="width:80px">사용</th>${isMaster() ? "<th></th>" : ""}</tr></thead><tbody>
        ${g.items.map(x => `<tr>
          <td class="wrap">${esc(x.lv2 || "")}</td>
          <td class="wrap"><b>${esc(x.code || "")}</b></td>
          <td class="wrap">${esc(x.description || "")}</td>
          <td>${x.priority ?? ""}</td>
          <td>${usage[x.code] ? `<span class="badge b-prog">${usage[x.code]}건</span>` : '<span class="muted">-</span>'}</td>
          ${isMaster() ? `<td style="white-space:nowrap"><button class="btn sm ghost" onclick="wbsEdit(${x.id})">수정</button>
            <button class="btn sm ghost" style="color:var(--danger)" onclick="wbsDel(${x.id})">삭제</button></td>` : ""}
        </tr>`).join("")}
        </tbody></table></div>
      </details>`).join("") || '<div class="panel muted">검색 결과가 없습니다.</div>';
    $("#wbs-count").textContent = rows.length + "개 코드 / 전체 " + _wbsCodes.length;
  }

  app.innerHTML = `
  <h1>전체 WBS 관리 <small class="muted">(팀장)</small></h1>
  <p class="page-sub">WBS 코드 체계(Lv1 상단 탭 · Lv2 소분류 · Lv3 실행 메뉴)를 등록·수정·삭제합니다. 여기 등록한 코드가 과업 등록 시 WBS 메뉴 드롭다운에 반영됩니다.</p>
  <div class="row">
    <input type="text" id="f-wbs-kw" placeholder="검색 (탭 / 소분류 / 코드 / 설명)">
    <button class="btn sm ghost" id="btn-fold">모두 접기</button>
    <button class="btn sm ghost" id="btn-unfold">모두 펼치기</button>
    <span class="muted" id="wbs-count"></span>
    ${isMaster() ? '<button class="btn" onclick="wbsNew()">+ WBS 등록</button>' : '<span class="muted">등록·수정·삭제는 팀장 로그인 필요</span>'}
  </div>
  <div id="wbs-body"></div>`;
  $("#f-wbs-kw").oninput = (e) => { state.kw = e.target.value; render(); };
  $("#btn-fold").onclick = () => document.querySelectorAll("#wbs-body .wbs-group").forEach(d => d.open = false);
  $("#btn-unfold").onclick = () => document.querySelectorAll("#wbs-body .wbs-group").forEach(d => d.open = true);
  render();
}

window.wbsEdit = function (id) {
  if (!isMaster()) return toast("팀장만 WBS를 수정할 수 있습니다.", true);
  const x = _wbsCodes.find(c => c.id === id);
  if (!x) return;
  modal("WBS 수정", [
    fld("Level 1 — 상단 메뉴 탭", `<input type="text" name="lv1" style="width:100%" value="${esc(x.lv1 || "")}" placeholder="예: 1. 일일보고">`),
    fld("Level 2 — 소분류 그룹", `<input type="text" name="lv2" style="width:100%" value="${esc(x.lv2 || "")}" placeholder="예: 1.1 입력 및 보고">`),
    fld("Level 3 — 실행 메뉴 코드 <span class='req'>*</span>", `<input type="text" name="code" style="width:100%" required value="${esc(x.code || "")}">`),
    fld("설명", `<input type="text" name="desc" style="width:100%" value="${esc(x.description || "")}">`),
    fld("우선순위", `<input type="number" name="pri" step="0.5" style="width:100px" value="${x.priority ?? 0}">`),
    `<div class="field-hint">⚠ 코드명을 변경하면, 이 코드를 참조하는 기존 과업의 WBS 메뉴도 함께 변경할지 확인합니다.</div>`,
  ].join(""), async (f) => {
    const newCode = f.get("code").trim();
    if (!newCode) { toast("코드는 필수입니다.", true); return false; }
    try {
      if (newCode !== x.code) {
        const used = await q(sb.from("wbs_tasks").select("id").eq("lv3_menu", x.code));
        if (used.length && confirm(`이 코드를 참조하는 과업 ${used.length}건의 WBS 메뉴도 새 코드("${newCode}")로 함께 변경할까요?`)) {
          await q(sb.from("wbs_tasks").update({ lv3_menu: newCode }).eq("lv3_menu", x.code));
        }
      }
      await q(sb.from("wbs_codes").update({
        lv1: f.get("lv1") || null, lv2: f.get("lv2") || null, code: newCode,
        description: f.get("desc") || null, priority: parseFloat(f.get("pri")) || 0,
      }).eq("id", id));
      toast("WBS 수정 완료"); route();
    } catch (_) { return false; }
  });
};

window.wbsDel = async function (id) {
  if (!isMaster()) return toast("팀장만 WBS를 삭제할 수 있습니다.", true);
  const x = _wbsCodes.find(c => c.id === id);
  if (!x) return;
  let used = [];
  try { used = await q(sb.from("wbs_tasks").select("id").eq("lv3_menu", x.code)); } catch (_) {}
  let msg = `WBS 코드를 삭제할까요?\n"${x.code}"`;
  if (used.length) msg += `\n\n⚠ 이 코드를 참조하는 과업이 ${used.length}건 있습니다.\n과업 데이터 자체는 삭제되지 않지만, 과업 등록 드롭다운에서는 사라집니다.`;
  if (!confirm(msg)) return;
  try { await q(sb.from("wbs_codes").delete().eq("id", id)); toast("삭제됨"); route(); } catch (_) {}
};

window.taskNew = function () {
  if (!canWrite()) return needLogin();
  modal("과업 등록", [
    fld("WBS 메뉴 (Lv3) <span class='req'>*</span>", selHtml("lv3", _wbsMenus, "")),
    fld("수행 업무 (Lv5)", `<input type="text" name="lv5" style="width:100%" placeholder="예: 파싱 로직">`),
    fld("상세 업무 내용 (Lv6) <span class='req'>*</span>", `<input type="text" name="lv6" style="width:100%" required>`),
    `<div class="row">` +
      fld("담당자", selHtml("assignee", CONFIG.TEAM, me().name)) +
      fld("시급성", selHtml("urgency", ["S", "A", "B"], "B")) + `</div>`,
    `<div class="row">` +
      fld("Start", `<input type="date" name="start" value="${today()}" required>`) +
      fld("End(plan)", `<input type="date" name="end" value="${today()}" required>`) + `</div>`,
    `<div class="field-hint">⚠ Start·End(plan)는 저장 후 수정할 수 없습니다.</div>`,
    fld("비고", `<input type="text" name="remark" style="width:100%">`),
  ].join(""), async (f) => {
    try {
      await q(sb.from("wbs_tasks").insert({
        lv3_menu: f.get("lv3"), lv5_work: f.get("lv5") || null, lv6_content: f.get("lv6"),
        assignee: f.get("assignee"), urgency: f.get("urgency"),
        start_date: f.get("start"), end_plan: f.get("end"), remark: f.get("remark") || null, progress: 0,
      }));
      toast("과업 등록 완료"); route();
    } catch (_) { return false; }
  }, "등록");
};

window.taskEdit = function (id) {
  const x = _tasks.find(t => t.id === id);
  if (!x) return;
  if (!guardEdit(x.assignee)) return;
  const master = isMaster();
  modal("과업 수정", [
    fld("상세 업무 내용", `<input type="text" name="lv6" style="width:100%" value="${esc(x.lv6_content || "")}">`),
    `<div class="row">` +
      fld("시급성", selHtml("urgency", ["S", "A", "B"], x.urgency || "B")) +
      fld("진행률(%)", `<input type="number" name="prog" min="0" max="100" value="${Math.round((x.progress ?? 0) * 100)}" style="width:90px">`) +
      fld("End(real)", `<input type="date" name="end_real" value="${x.end_real || ""}">`) + `</div>`,
    fld("상태", `<label style="display:inline-flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" name="holding" ${x.holding ? "checked" : ""} style="width:auto"> ⏸ Holding (보류)</label>`),
    `<div class="field-hint">진행률 100% 저장 시 End(real) 필수. Start(${fmtD(x.start_date)})·End(plan)(${fmtD(x.end_plan)})은 수정 불가.</div>`,
    master
      ? fld("팀장 코멘트", `<textarea name="remark" style="width:100%;min-height:70px" placeholder="담당자에게 전달할 코멘트 (저장 시 알림 발송)">${esc(x.remark || "")}</textarea>`)
      : fld("팀장 코멘트", `<div class="body" style="white-space:pre-wrap">${esc(x.remark) || '<span class="muted">-</span>'}</div><div class="field-hint">팀장만 작성/수정할 수 있습니다.</div>`),
  ].join(""), async (f) => {
    const progress = Math.min(100, Math.max(0, parseFloat(f.get("prog")) || 0)) / 100;
    const end_real = f.get("end_real") || null;
    if (progress >= 1 && !end_real) { toast("진행률 100%는 End(real) 입력이 필수입니다.", true); return false; }
    const holding = !!f.get("holding");
    const newRemark = master ? ((f.get("remark") || "").trim() || null) : (x.remark ?? null);
    const remarkChanged = master && newRemark !== (x.remark || null);
    try {
      await q(sb.from("wbs_tasks").update({
        lv6_content: f.get("lv6") || null, urgency: f.get("urgency"),
        progress, end_real, holding, remark: newRemark,
      }).eq("id", id));
      if (remarkChanged && newRemark && x.assignee) {
        await notify(x.assignee, `${me().name} 팀장이 '${(x.lv6_content || x.lv5_work || "과업").slice(0, 30)}' 과업에 팀장 코멘트를 남겼습니다.`, "#/tasks", "task_comment");
      }
      toast("저장 완료" + (remarkChanged && newRemark ? " · 알림 발송" : "")); route();
    } catch (_) { return false; }
  });
};

window.taskDel = async function (id) {
  const x = _tasks.find(t => t.id === id);
  if (!guardEdit(x?.assignee)) return;
  if (!confirm(`과업을 삭제할까요?\n"${(x?.lv6_content || "").slice(0, 50)}"`)) return;
  try { await q(sb.from("wbs_tasks").delete().eq("id", id)); toast("삭제됨"); route(); } catch (_) {}
};

/* ══ WBS별 이슈 ══ */
async function vIssues() {
  const [issues, cmts] = await Promise.all([
    q(sb.from("wbs_issues").select("*").order("id", { ascending: true })),
    q(sb.from("comments").select("target_id").eq("target_table", "wbs_issues")),
  ]);
  const cmtCount = {};
  for (const c of cmts) cmtCount[c.target_id] = (cmtCount[c.target_id] || 0) + 1;
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
      <td style="white-space:nowrap">${fmtD(x.issue_date)}${x.created_at ? ` <small class="muted">${hhmm(x.created_at)}</small>` : ""}</td><td>${esc(x.assignee)}</td>
      <td class="wrap"><a class="link" href="#/issues/${x.id}">${esc((x.agenda || x.question || "").slice(0, 90)) || "(무제)"}</a>${cmtCount[x.id] ? ` <span class="cmt-badge" title="댓글 ${cmtCount[x.id]}개">💬 ${cmtCount[x.id]}</span>` : ""}</td>
      <td>${goBadge(x.request_go)}</td><td>${issueStatusBadge(x)}</td></tr>`).join("");
    $("#issue-count").textContent = rows.length + "건 (미해결 " + rows.filter(x => !issueClosed(x)).length + ")";
  }

  app.innerHTML = `
  <h1>WBS별 이슈</h1>
  <p class="page-sub">안건 → 질의 → 본인생각 → GO → 피드백. 요청 Cancel은 완료로 처리.</p>
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

let _issueCache = null;
async function vIssueDetail(id) {
  const [x, imgs] = await Promise.all([
    q(sb.from("wbs_issues").select("*").eq("id", id).single()),
    q(sb.from("issue_images").select("*")),
  ]);
  _issueCache = x;
  const myImgs = imgs.filter(i => x.seq != null && +i.issue_seq === +x.seq);
  const locked = x.request_go && x.request_go.startsWith("GO");
  const nextGo = !locked ? "GO" : (x.request_go === "GO" ? "GO*2" : "GO*" + (((parseInt((x.request_go.split("*")[1] || "1"), 10)) || 1) + 1));
  const canEd = canEditOwn(x.assignee);
  const comments = await q(sb.from("comments").select("*").eq("target_table", "wbs_issues").eq("target_id", id).order("created_at"));

  const block = (title, body, full = false) =>
    `<div class="issue-block ${full ? "full" : ""}"><h3>${title}</h3><div class="body">${esc(body) || '<span class="muted">-</span>'}</div></div>`;

  app.innerHTML = `
  <h1>이슈 상세 <small class="muted">#${x.seq ?? x.id}</small></h1>
  <p class="page-sub">${fmtD(x.issue_date)}${x.created_at ? ` <small class="muted">${hhmm(x.created_at)} 작성</small>` : ""} · ${esc(x.assignee || "")} · ${goBadge(x.request_go)} ${issueStatusBadge(x)}</p>
  ${locked ? '<div class="lock-notice">🔒 GO 제출됨 — 안건/질의/본인생각은 수정할 수 없습니다. 추가 의견은 댓글로.</div>' : ""}
  <div class="issue-grid">
    ${block("안건 (왜 논의가 필요한가)", x.agenda, true)}
    ${block("질의 사항 / 요청사항", x.question)}
    ${block("본인의 생각", x.opinion)}
    ${block("참고 자료", x.ref_material)}
    <div class="issue-block"><h3>피드백 ${canEd ? `<button class="btn sm ghost" onclick="issueFeedback(${x.id})">✎ 입력/수정</button>` : ""}</h3>
      <div class="body">${esc(x.feedback) || '<span class="muted">-</span>'}</div></div>
    ${myImgs.length ? `<div class="issue-block full"><h3>첨부 이미지</h3>${myImgs.map(i => `<img class="issue-img" src="${esc(i.image_path)}" loading="lazy">`).join("")}</div>` : ""}
  </div>
  <div class="row" style="margin-top:14px">
    ${canEd && !locked && x.request_go !== "Cancel" ? `<button class="btn" onclick="issueGo(${x.id}, null)">GO 제출 (검토 요청)</button>` : ""}
    ${canEd && locked && x.request_go !== "Cancel" ? `<button class="btn ghost" onclick="issueGo(${x.id}, '${esc(x.request_go)}')">재질의 (${nextGo})</button>` : ""}
    ${canEd && locked && x.status !== "완료" ? `<button class="btn ghost" onclick="issueClose(${x.id})">완료 처리</button>` : ""}
    ${canEd ? `<button class="btn ghost" style="color:var(--danger)" onclick="issueDel(${x.id})">이슈 삭제</button>` : ""}
    <a class="btn ghost" href="#/issues" style="text-decoration:none">← 목록</a>
  </div>
  <div class="panel" style="margin-top:18px"><h2>댓글 ${comments.length ? `(${comments.length})` : ""}</h2>
    <div id="cmt-list">${comments.map(c => `<div class="comment">
      <div class="meta"><b>${esc(c.author)}</b>${c.mention ? ` → @${esc(c.mention)}` : ""} · ${String(c.created_at).slice(0, 16).replace("T", " ")}
        ${canWrite() && (c.author === me().name || isMaster()) ? `<button class="btn sm ghost" onclick="cmtDel(${c.id}, ${id}, '${esc(c.author)}')">삭제</button>` : ""}</div>
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
    const mention = $("#f-cmt-mention").value || null;
    try {
      await q(sb.from("comments").insert({ target_table: "wbs_issues", target_id: id, author: me().name, mention, content }));
      if (mention) await notify(mention, `${me().name}님이 이슈 #${x.seq ?? id} 댓글에서 회원님을 멘션했습니다: "${content.slice(0, 30)}"`, `#/issues/${id}`, "mention");
      toast("댓글 등록 완료" + (mention ? " · 알림 발송" : "")); vIssueDetail(id);
    } catch (_) {}
  });
}

window.cmtDel = async function (cid, issueId, author) {
  if (!guardEdit(author)) return;
  if (!confirm("댓글을 삭제할까요?")) return;
  try { await q(sb.from("comments").delete().eq("id", cid)); toast("댓글 삭제됨"); vIssueDetail(issueId); } catch (_) {}
};
window.issueDel = async function (id) {
  const x = _issueCache && _issueCache.id === id ? _issueCache : null;
  if (!guardEdit(x?.assignee)) return;
  if (!confirm("이 이슈를 삭제할까요? 댓글도 함께 삭제됩니다.")) return;
  try {
    await q(sb.from("comments").delete().eq("target_table", "wbs_issues").eq("target_id", id));
    await q(sb.from("wbs_issues").delete().eq("id", id));
    toast("이슈 삭제됨"); location.hash = "#/issues";
  } catch (_) {}
};
window.issueGo = async function (id, cur) {
  const xg = _issueCache && _issueCache.id === id ? _issueCache : null;
  if (!guardEdit(xg?.assignee)) return;
  if (!cur) {
    // 최초 GO 제출
    if (!confirm("GO 제출 시 안건/질의/본인생각이 잠깁니다. 제출할까요?")) return;
    try {
      await q(sb.from("wbs_issues").update({ request_go: "GO", status: "진행중" }).eq("id", id));
      toast("GO 제출 완료 — Slack 알림 발송"); vIssueDetail(id);
    } catch (_) {}
    return;
  }
  // 재질의: 회차별 추가 질의/의견을 입력해야 제출 가능
  const n = cur === "GO" ? 2 : (parseInt(cur.split("*")[1]) || 1) + 1;
  const next = "GO*" + n;
  const x = _issueCache && _issueCache.id === id ? _issueCache : null;
  if (!x) return;
  modal(`재질의 ${next} — 추가 내용 입력`, [
    `<div class="field-hint" style="margin-bottom:10px">재질의는 추가 질의와 본인 생각을 입력해야 제출됩니다. 기존 내용 아래에 회차 구분선과 함께 추가됩니다.</div>`,
    fld(`추가 질의 내용 (${next}) <span class='req'>*</span>`, `<textarea name="q" required placeholder="1. 추가 질의&#10;2. 추가 질의"></textarea>`),
    fld(`추가 본인 생각 (${next}) <span class='req'>*</span>`, `<textarea name="o" required placeholder="1. 의견 (추가 질의 1에 대한)"></textarea>`),
  ].join(""), async (f) => {
    const q2 = (x.question || "") + `\n\n━━ ${next} 추가 질의 (${today()}) ━━\n` + f.get("q").trim();
    const o2 = (x.opinion || "") + `\n\n━━ ${next} 추가 의견 (${today()}) ━━\n` + f.get("o").trim();
    try {
      await q(sb.from("wbs_issues").update({ question: q2, opinion: o2, request_go: next, status: "진행중" }).eq("id", id));
      toast(next + " 제출 완료 — Slack 알림 발송"); vIssueDetail(id);
    } catch (_) { return false; }
  }, next + " 제출");
};
window.issueFeedback = function (id) {
  const xf = _issueCache && _issueCache.id === id ? _issueCache : null;
  if (!guardEdit(xf?.assignee)) return;
  const cur = xf ? (xf.feedback || "") : "";
  modal("피드백 입력/수정", fld("피드백 내용", `<textarea name="fb" style="min-height:140px" required>${esc(cur)}</textarea>`),
    async (f) => {
      try {
        await q(sb.from("wbs_issues").update({ feedback: f.get("fb") }).eq("id", id));
        toast("피드백 저장 — Slack 알림 발송"); vIssueDetail(id);
      } catch (_) { return false; }
    });
};
window.issueClose = async function (id) {
  const xc = _issueCache && _issueCache.id === id ? _issueCache : null;
  if (!guardEdit(xc?.assignee)) return;
  if (!confirm("이 이슈를 완료 처리할까요?")) return;
  try { await q(sb.from("wbs_issues").update({ status: "완료" }).eq("id", id)); toast("완료 처리됨"); vIssueDetail(id); } catch (_) {}
};

async function vIssueNew() {
  if (!canWrite()) { app.innerHTML = '<div class="panel">이슈 등록은 로그인이 필요합니다.</div>'; return; }
  const dels = await q(sb.from("deliverables").select("*").order("no", { ascending: false }));
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
    <div class="field"><label>참고 자료</label>
      <div class="row" style="margin-bottom:6px">
        <select id="i-ref-pick" style="flex:1;min-width:200px">
          <option value="">참고자료에서 선택 (구글 시트 등)…</option>
          ${dels.map(d => `<option value="${esc(d.url || d.title)}" data-title="${esc(d.title)}">${esc(d.title)}${d.url ? "" : " (링크없음)"}</option>`).join("")}
        </select>
        <button type="button" class="btn sm ghost" onclick="document.getElementById('i-ref').value='';document.getElementById('i-ref-pick').value=''">지우기</button>
      </div>
      <input type="text" id="i-ref" style="width:100%" placeholder="위에서 선택하거나 링크·자료명 직접 입력">
    </div>
    <button class="btn" type="submit">저장 (GO 제출은 상세 화면에서)</button>
  </form></div>`;
  $("#i-ref-pick").addEventListener("change", (e) => {
    const opt = e.target.selectedOptions[0];
    if (!opt || !opt.value) return;
    const title = opt.getAttribute("data-title") || "";
    const url = opt.value;
    $("#i-ref").value = (url && url !== title) ? `${title} — ${url}` : title;
  });
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

/* ══ 주간 업무 요약 — 본인 셀 직접 작성/수정 + 주차 추가 ══ */
let _weeklyRows = [], _weeklyWeeks = {}, _weekCmts = {};
async function vWeekly() {
  const [rows, cc] = await Promise.all([
    q(sb.from("weekly_summaries").select("*").order("week_start", { ascending: false })),
    q(sb.from("card_comments").select("*").eq("scope", "weekly").order("created_at")),
  ]);
  _weeklyRows = rows;
  _weekCmts = {};
  for (const c of cc) (_weekCmts[c.card_key] = _weekCmts[c.card_key] || []).push(c);
  const weekMap = {}; const weeks = [];
  for (const r of rows) {
    if (!weekMap[r.week_label]) { weekMap[r.week_label] = { label: r.week_label, start: r.week_start, end: r.week_end, cells: {} }; weeks.push(weekMap[r.week_label]); }
    if (r.week_start && !weekMap[r.week_label].start) weekMap[r.week_label].start = r.week_start;
    if (r.week_end && !weekMap[r.week_label].end) weekMap[r.week_label].end = r.week_end;
    weekMap[r.week_label].cells[r.member + "|" + r.category] = r;
  }
  _weeklyWeeks = weekMap;
  const members = CONFIG.TEAM.filter(m => rows.some(r => r.member === m));
  const CATS = ["DONE", "ISSUE", "PLAN"];
  const catColor = { DONE: "b-done", ISSUE: "b-warn", PLAN: "b-prog" };
  const months = [];
  const mMap = {};
  for (const w of weeks) {
    const mon = (w.label.match(/^(\d+월)/) || [null, "기타"])[1];
    if (!mMap[mon]) { mMap[mon] = { mon, weeks: [] }; months.push(mMap[mon]); }
    mMap[mon].weeks.push(w);
  }
  const myName = me()?.name;
  const editable = (m) => canWrite() && (m === myName || isMaster());

  app.innerHTML = `
  <h1>주간 업무 요약</h1>
  <p class="page-sub">매주 금 17:00 주간 업무 정리 — 본인 칸을 클릭해 직접 작성/수정 (DONE / ISSUE / PLAN)</p>
  <div class="row">
    <button class="btn sm ghost" onclick="document.querySelectorAll('#app details').forEach(d=>d.open=false)">모두 접기</button>
    <button class="btn sm ghost" onclick="document.querySelectorAll('#app details').forEach(d=>d.open=true)">모두 펼치기</button>
    ${canWrite() ? '<button class="btn" onclick="weekAdd()">+ 주차 추가</button>' : ""}
    <span class="muted">${weeks.length}주차 / ${months.length}개월</span></div>
  ${months.map((mg, mi) => `<details class="month-group" ${mi === 0 ? "open" : ""}>
    <summary><b>${esc(mg.mon)}</b> <span class="muted">${mg.weeks.length}주차</span></summary>
    ${mg.weeks.map((w, wi) => `<details class="week-detail" ${mi === 0 && wi === 0 ? "open" : ""}>
      <summary>${esc(w.label)} <small class="muted">${fmtD(w.start)} ~ ${fmtD(w.end)}</small>
        ${isMaster() ? `<span style="margin-left:auto;white-space:nowrap">
          <button type="button" class="btn sm ghost" onclick="event.stopPropagation();event.preventDefault();weekDates('${esc(w.label)}')">날짜 변경</button>
          <button type="button" class="btn sm ghost" style="color:var(--danger)" onclick="event.stopPropagation();event.preventDefault();weekDel('${esc(w.label)}')">주차 삭제</button></span>` : ""}
      </summary>
      <div class="week-grid" style="grid-template-columns:70px repeat(${members.length}, 1fr)">
        <div class="week-cell week-head">구분</div>
        ${members.map(m => `<div class="week-cell week-head">${esc(m)}${m === myName ? ' <span class="badge b-go">나</span>' : ""}</div>`).join("")}
        ${CATS.map(c => `<div class="week-cell week-cat"><span class="badge ${catColor[c]}">${c}</span></div>` +
          members.map(m => {
            const cell = w.cells[m + "|" + c];
            const canEd = editable(m);
            return `<div class="week-cell ${canEd ? "editable" : ""}"
              ${canEd ? `onclick="weekCellEdit('${esc(w.label)}','${esc(m)}','${c}')" title="클릭하여 작성/수정"` : ""}>${esc(cell?.content || "")}${canEd ? '<span class="cell-pen">✎</span>' : ""}</div>`;
          }).join("")).join("")}
        <div class="week-cell week-cat"><span class="badge b-go">팀장</span></div>
        ${members.map(m => {
          const key = w.label + "|" + m;
          const list = _weekCmts[key] || [];
          return `<div class="week-cell wk-cmt">
            ${list.map(c => `<div class="cardcmt"><div class="cardcmt-b">${esc(c.content)}</div>${isMaster() ? `<button type="button" class="cardcmt-x" onclick="weekCmtDel(${c.id})">✕</button>` : ""}</div>`).join("")}
            ${isMaster() ? `<button type="button" class="btn sm ghost" onclick="weekCmtAdd('${esc(w.label)}','${esc(m)}')">+ 코멘트</button>` : (list.length ? "" : '<span class="muted" style="font-size:11px">-</span>')}
          </div>`;
        }).join("")}
      </div></details>`).join("")}
  </details>`).join("") || '<div class="panel muted">주차가 없습니다. [+ 주차 추가]로 시작하세요.</div>'}`;
}

window.weekCellEdit = function (label, member, cat) {
  if (!canWrite()) return needLogin();
  if (member !== me().name && !isMaster()) return toast("본인 칸만 작성할 수 있습니다.", true);
  const w = _weeklyWeeks[label];
  const cell = w?.cells[member + "|" + cat];
  modal(`${label} · ${member} · ${cat}`,
    fld("내용", `<textarea name="c" style="min-height:160px" placeholder="- 항목별로 줄바꿈하여 작성">${esc(cell?.content || "")}</textarea>`),
    async (f) => {
      const content = f.get("c").trim();
      try {
        if (cell) await q(sb.from("weekly_summaries").update({ content }).eq("id", cell.id));
        else await q(sb.from("weekly_summaries").insert({
          week_label: label, week_start: w?.start || null, week_end: w?.end || null,
          member, category: cat, content }));
        toast("저장 완료"); route();
      } catch (_) { return false; }
    });
};

window.weekDates = function (label) {
  if (!isMaster()) return toast("주차 날짜 변경은 팀장만 가능합니다.", true);
  const w = _weeklyWeeks[label];
  if (!w) return;
  modal("주차 날짜 변경 — " + label, `<div class="row">` +
    fld("시작일", `<input type="date" name="s" value="${w.start || ""}" required>`) +
    fld("종료일", `<input type="date" name="e" value="${w.end || ""}" required>`) + `</div>`,
    async (f) => {
      try {
        await q(sb.from("weekly_summaries").update({ week_start: f.get("s"), week_end: f.get("e") }).eq("week_label", label));
        toast("날짜 변경 완료"); route();
      } catch (_) { return false; }
    });
};
window.weekDel = async function (label) {
  if (!isMaster()) return toast("주차 삭제는 팀장만 가능합니다.", true);
  if (!confirm(`"${label}" 주차 전체를 삭제할까요? (전 팀원 DONE/ISSUE/PLAN 내용 포함)`)) return;
  try {
    await q(sb.from("weekly_summaries").delete().eq("week_label", label));
    toast(label + " 삭제됨"); route();
  } catch (_) {}
};

window.weekAdd = function () {
  if (!canWrite()) return needLogin();
  // 다음 주차 라벨 자동 제안
  const d = new Date();
  const sug = (d.getMonth() + 1) + "월 " + Math.ceil(d.getDate() / 7) + "주차";
  const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 이번주 월요일
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  modal("주차 추가", [
    fld("주차 라벨 <span class='req'>*</span>", `<input type="text" name="label" value="${sug}" required placeholder="예: 7월 2주차">`),
    `<div class="row">` +
      fld("시작일(월)", `<input type="date" name="s" value="${mon.toISOString().slice(0, 10)}" required>`) +
      fld("종료일(금)", `<input type="date" name="e" value="${fri.toISOString().slice(0, 10)}" required>`) + `</div>`,
    `<div class="field-hint">추가하면 전 팀원 × DONE/ISSUE/PLAN 빈 칸이 생성되고, 각자 본인 칸을 클릭해 입력합니다.</div>`,
  ].join(""), async (f) => {
    const label = f.get("label").trim();
    if (_weeklyWeeks[label]) { toast("이미 존재하는 주차입니다.", true); return false; }
    const ins = [];
    for (const m of CONFIG.TEAM) for (const c of ["DONE", "ISSUE", "PLAN"])
      ins.push({ week_label: label, week_start: f.get("s"), week_end: f.get("e"), member: m, category: c, content: "" });
    try { await q(sb.from("weekly_summaries").insert(ins)); toast(label + " 생성 완료 — 본인 칸을 클릭해 입력하세요."); route(); }
    catch (_) { return false; }
  }, "주차 생성");
};

window.weekCmtAdd = function (label, member) {
  if (!isMaster()) return toast("팀장만 코멘트를 남길 수 있습니다.", true);
  modal(`팀장 코멘트 — ${label} · ${member}`,
    fld("코멘트", `<textarea name="c" required placeholder="${esc(member)}님 주간 업무에 대한 코멘트"></textarea>`),
    async (f) => {
      const content = f.get("c").trim(); if (!content) return false;
      try {
        await q(sb.from("card_comments").insert({ scope: "weekly", card_key: label + "|" + member, author: me().name, content }));
        await notify(member, `${me().name} 팀장이 '${label}' 주간 업무에 코멘트를 남겼습니다.`, "#/weekly", "weekly_comment");
        toast("코멘트 등록 · 알림 발송"); route();
      } catch (_) { return false; }
    }, "등록");
};
window.weekCmtDel = async function (id) {
  if (!isMaster()) return toast("팀장만 삭제할 수 있습니다.", true);
  if (!confirm("코멘트를 삭제할까요?")) return;
  try { await q(sb.from("card_comments").delete().eq("id", id)); toast("삭제됨"); route(); } catch (_) {}
};

/* ══ 일일 기록 ══ */
let _dailyCmts = {};
async function vDaily() {
  let rows = []; let page = 0;
  while (true) {
    const chunk = await q(sb.from("daily_logs").select("*").order("log_date", { ascending: false }).range(page * 1000, page * 1000 + 999));
    rows = rows.concat(chunk);
    if (chunk.length < 1000 || page >= 9) break;
    page++;
  }
  _dailyCmts = {};
  try {
    const cc = await q(sb.from("card_comments").select("*").eq("scope", "daily").order("created_at"));
    for (const c of cc) (_dailyCmts[c.card_key] = _dailyCmts[c.card_key] || []).push(c);
  } catch (_) {}
  for (const r of rows) {
    if (r.log_date) r.week_label = weekOfMonthLabel(r.log_date);   // 저장값 무시하고 월요일 기준으로 통일
  }
  const ORD = (m) => { const i = CONFIG.TEAM.indexOf(m); return i < 0 ? 99 : i; };
  const state = { member: "", month: "" };
  const months = [...new Set(rows.map(r => (r.log_date || "").slice(0, 7)))].sort().reverse();

  function render() {
    let f = rows;
    if (state.member) f = f.filter(r => r.member === state.member);
    if (state.month) f = f.filter(r => (r.log_date || "").startsWith(state.month));
    const byMember = {};
    for (const r of f) { if (isLeaveLog(r)) continue; byMember[r.member] = (byMember[r.member] || 0) + (r.hours || 0); }
    $("#daily-cards").innerHTML = Object.entries(byMember).sort((a, b) => ORD(a[0]) - ORD(b[0])).map(([m, h]) =>
      `<div class="card"><div class="num">${Math.round(h * 10) / 10}<small style="font-size:13px">h</small></div><div class="lbl">${esc(m)}</div></div>`).join("");
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
          const mems = Object.entries(W.dates[dt]).sort((a, b) => ORD(a[0]) - ORD(b[0]));
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
              ${(() => {
                const cmts2 = _dailyCmts[dt + "|" + mem] || [];
                if (!cmts2.length && !isMaster()) return "";
                return `<div class="daily-cmts">
                  ${cmts2.map(c => `<div class="cardcmt"><span class="badge b-go">팀장</span> <span class="cardcmt-b">${esc(c.content)}</span>${isMaster() ? `<button type="button" class="cardcmt-x" onclick="dailyCmtDel(${c.id})">✕</button>` : ""}</div>`).join("")}
                  ${isMaster() ? `<button type="button" class="btn sm ghost cardcmt-add" onclick="dailyCmtAdd('${dt}','${esc(mem)}')">+ 팀장 코멘트</button>` : ""}
                </div>`;
              })()}
            </div>`;
          }).join("")}
          </div></details>`;
        }).join("")}
      </details>`).join("");
    $("#daily-count").textContent = f.length + "건";
  }

  app.innerHTML = `
  <h1>일일 기록</h1>
  <p class="page-sub">회사 ERP 데이터 조회 전용 — 주차·일자 접기, 팀원별 최다 시간 업무 우선 표시 · 상단 업무시간 합계는 시차·연차 제외</p>
  <div class="row">
    ${sel("d-member", CONFIG.TEAM, "", "팀원 전체")}
    ${sel("d-month", months, "", "월 전체")}
    <button class="btn sm ghost" onclick="document.querySelectorAll('#daily-body details').forEach(d=>d.open=false)">모두 접기</button>
    <button class="btn sm ghost" onclick="document.querySelectorAll('#daily-body details').forEach(d=>d.open=true)">모두 펼치기</button>
    ${canWrite() ? '<button class="btn" onclick="dailyAdd()">+ 기록 입력</button>' : ""}
    <span class="muted" id="daily-count"></span>
  </div>
  <div class="cards" id="daily-cards"></div>
  <div id="daily-body"></div>`;
  $("#f-d-member").onchange = (e) => { state.member = e.target.value; render(); };
  $("#f-d-month").onchange = (e) => { state.month = e.target.value; render(); };
  render();
}

window.dailyAdd = function () {
  if (!canWrite()) return needLogin();
  modal("일일 기록 입력", [
    `<div class="row">` +
      fld("일자", `<input type="date" name="d" value="${today()}" required>`) +
      fld("팀원", selHtml("m", CONFIG.TEAM, me().name)) +
      fld("시간(h)", `<input type="number" name="h" step="0.5" min="0" max="24" value="1" style="width:90px" required>`) + `</div>`,
    `<div class="row">` +
      fld("프로젝트", `<input type="text" name="p" placeholder="예: [BD-26-활용-02] bCMf">`) +
      fld("서브코드", `<input type="text" name="s" placeholder="예: e.S/W 설계">`) + `</div>`,
    fld("업무 내용 <span class='req'>*</span>", `<textarea name="c" required placeholder="[시간] 업무 내용"></textarea>`),
  ].join(""), async (f) => {
    const dt = f.get("d");
    const wk = weekOfMonthLabel(dt);
    try {
      await q(sb.from("daily_logs").insert({
        log_date: dt, week_label: wk, member: f.get("m"),
        project: f.get("p") || null, subcode: f.get("s") || null,
        content: f.get("c"), hours: parseFloat(f.get("h")) || null,
      }));
      toast("기록 입력 완료"); route();
    } catch (_) { return false; }
  }, "입력");
};

window.dailyCmtAdd = function (dt, member) {
  if (!isMaster()) return toast("팀장만 코멘트를 남길 수 있습니다.", true);
  modal(`팀장 코멘트 — ${dt} · ${member}`,
    fld("코멘트", `<textarea name="c" required placeholder="${esc(member)}님 ${dt} 업무에 대한 코멘트"></textarea>`),
    async (f) => {
      const content = f.get("c").trim(); if (!content) return false;
      try {
        await q(sb.from("card_comments").insert({ scope: "daily", card_key: dt + "|" + member, author: me().name, content }));
        await notify(member, `${me().name} 팀장이 ${dt} 일일 기록에 코멘트를 남겼습니다.`, "#/daily", "daily_comment");
        toast("코멘트 등록 · 알림 발송"); route();
      } catch (_) { return false; }
    }, "등록");
};
window.dailyCmtDel = async function (id) {
  if (!isMaster()) return toast("팀장만 삭제할 수 있습니다.", true);
  if (!confirm("코멘트를 삭제할까요?")) return;
  try { await q(sb.from("card_comments").delete().eq("id", id)); toast("삭제됨"); route(); } catch (_) {}
};

/* ══ 참고자료 (구 성과물) ══ */
async function vDeliverables() {
  // 신규 항목이 맨 위로: no 내림차순 정렬
  const dels = await q(sb.from("deliverables").select("*").order("no", { ascending: false }));
  app.innerHTML = `
  <h1>참고자료</h1><p class="page-sub">참고자료 링크 대장 — 구글 시트 등 링크 등록 (로그인 필요). md·html 문서는 [HMCM Mock-up] 메뉴를 활용하세요.</p>
  <div class="panel"><h2>참고자료 (${dels.length})</h2>
    ${canWrite() ? `<div class="row">
      <button class="btn sm" onclick="delAddLink()">+ 링크 추가</button>
    </div>` : ""}
    <p class="hint" style="color:var(--sub);margin:-2px 0 10px">신규 항목이 맨 위에 표시됩니다. 파일 업로드는 지원하지 않으며 구글 시트 등 링크로 등록하세요. md·html 산출물은 [HMCM Mock-up]에서 관리하는 것을 권장합니다.</p>
    <div class="tbl-wrap" style="max-height:60vh"><table>
    <thead><tr><th>번호</th><th>설명</th><th>URL</th><th>담당</th><th>비고</th></tr></thead><tbody>
    ${dels.map(d => `<tr><td>${d.no ?? ""}</td><td class="wrap">${esc(d.title)}</td>
      <td>${d.url ? `<a class="link" href="${esc(d.url)}" target="_blank" rel="noopener">열기 ↗</a>` : ""}</td>
      <td>${esc(d.assignee)}</td><td class="wrap">${esc(d.remark)}</td></tr>`).join("")}
    </tbody></table></div></div>`;
}
window.delAddLink = function () {
  if (!canWrite()) return needLogin();
  modal("참고자료 링크 추가", [
    fld("설명 <span class='req'>*</span>", `<input type="text" name="t" style="width:100%" required>`),
    fld("URL <span class='req'>*</span>", `<input type="text" name="u" style="width:100%" required placeholder="https://docs.google.com/spreadsheets/...">`, "구글 시트 등 링크를 입력하세요. (md·html은 HMCM Mock-up 활용 권장)"),
    fld("비고", `<input type="text" name="r" style="width:100%">`),
  ].join(""), async (f) => {
    try {
      const maxNo = Math.max(0, ...(await q(sb.from("deliverables").select("no"))).map(d => d.no || 0));
      await q(sb.from("deliverables").insert({ no: Math.floor(maxNo) + 1, title: f.get("t"), url: f.get("u"), assignee: me().name, remark: f.get("r") || null }));
      toast("링크 추가 완료"); route();
    } catch (_) { return false; }
  }, "추가");
};

/* ══ 자료실 ══ */
async function vDocs() {
  /* HMCM Mock-up 사이트를 우측 창에 그대로 표시 (업로드·문서관리 미사용) */
  app.innerHTML = `
  <div class="row" style="margin-bottom:10px">
    <h1 style="margin:0">HMCM Mock-up</h1>
    <span class="muted" id="mockup-status">${me() ? me().empno + " 자동 로그인 중…" : "로그인하지 않아 수동/게스트 접속"}</span>
    <a class="btn sm ghost" style="text-decoration:none;margin-left:auto" href="https://seanjo77.github.io/hmcmsite/" target="_blank" rel="noopener">새 창에서 열기 ↗</a>
  </div>
  <iframe id="mockup-if" src="https://seanjo77.github.io/hmcmsite/" class="mockup-frame"></iframe>`;
  // 본 사이트 로그인 사번으로 Mock-up 자동 로그인 (동일 도메인 → iframe 제어 가능)
  const emp = me()?.empno;
  const ifr = $("#mockup-if");
  if (emp && ifr) ifr.addEventListener("load", () => {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      try {
        const w = ifr.contentWindow, doc = ifr.contentDocument;
        const inp = doc && doc.querySelector('input[placeholder="Enter your ID"]');
        if (inp) {
          const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
          set.call(inp, emp);
          inp.dispatchEvent(new w.Event("input", { bubbles: true }));
          setTimeout(() => {
            if (inp.form) (inp.form.requestSubmit ? inp.form.requestSubmit() : inp.form.submit());
            const st = $("#mockup-status"); if (st) st.textContent = emp + " 자동 로그인 완료";
          }, 200);
          clearInterval(timer);
        } else if (tries > 40) {
          clearInterval(timer);
          const st = $("#mockup-status"); if (st) st.textContent = "";
        }
      } catch (_) { clearInterval(timer); }
    }, 250);
  });
  return;
  // eslint-disable-next-line no-unreachable
  const { data: files, error } = await sb.storage.from("files").list("docs", { limit: 200, sortBy: { column: "created_at", order: "desc" } });
  if (error) { app.innerHTML = `<div class="panel">자료실 로드 실패: ${esc(error.message)}</div>`; return; }
  const list = (files || []).filter(f => f.name !== ".emptyFolderPlaceholder");
  const pub = (name) => sb.storage.from("files").getPublicUrl("docs/" + name).data.publicUrl;
  const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

  app.innerHTML = `
  <h1>HMCM Mock-up</h1>
  <p class="page-sub">팀원이 생성한 HTML·MD 문서 업로드 및 뷰어</p>
  <div class="row">
    ${canWrite() ? `<button class="btn" onclick="document.getElementById('doc-file').click()">📄 문서 업로드</button>
      <input type="file" id="doc-file" class="hidden" accept=".html,.htm,.md,.txt,.pdf,.png,.jpg,.jpeg,.gif" onchange="docUpload(this)">` : '<span class="muted">업로드는 로그인 필요</span>'}
    <button class="btn ghost" onclick="mockupOpen()">🖥 기존 Mock-up 열기 (hmcmsite)</button>
    <span class="muted">${list.length}개 문서</span>
  </div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>문서명</th><th>크기</th><th>업로드일</th><th>보기</th>${canWrite() ? "<th></th>" : ""}</tr></thead><tbody>
    ${list.map(f => `<tr>
      <td class="wrap">${esc(docDisplayName(f.name))}</td>
      <td>${f.metadata ? kb(f.metadata.size || 0) : ""}</td>
      <td>${(f.created_at || "").slice(0, 10)}</td>
      <td><button class="btn sm" onclick="docView('${esc(f.name)}')">보기</button>
          <a class="btn sm ghost" style="text-decoration:none" href="${esc(pub(f.name))}" target="_blank" rel="noopener">새 창 ↗</a></td>
      ${isMaster() ? `<td><button class="btn sm ghost" style="color:var(--danger)" onclick="docDel('${esc(f.name)}')">삭제</button></td>` : ""}
    </tr>`).join("") || `<tr><td colspan="5" class="muted">문서가 없습니다. 첫 문서를 업로드하세요.</td></tr>`}
    </tbody></table></div>
  <div id="doc-viewer" class="panel hidden" style="margin-top:16px">
    <div class="row" style="justify-content:space-between"><h2 id="doc-viewer-title"></h2>
      <button class="btn sm ghost" onclick="document.getElementById('doc-viewer').classList.add('hidden')">닫기 ✕</button></div>
    <div id="doc-viewer-body" class="doc-body"></div>
  </div>`;
}
/* 스토리지 키는 ASCII만 허용 → 한글 파일명은 base64url 인코딩 저장, 화면에서 복원 */
function docKeyEncode(filename) {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot).replace(/[^\w.]/g, "") : "";
  const b64 = btoa(unescape(encodeURIComponent(base))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b64 + ext;
}
function docDisplayName(key) {
  const m = key.match(/^\d{13}_([A-Za-z0-9\-_]+)(\.\w+)?$/);
  if (!m) return key.replace(/^\d{13}_/, "");
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    return decodeURIComponent(escape(atob(b64))) + (m[2] || "");
  } catch (_) { return key.replace(/^\d{13}_/, ""); }
}
window.docUpload = async function (input) {
  const file = input.files[0]; if (!file) return;
  if (!canWrite()) return needLogin();
  const path = `docs/${Date.now()}_${docKeyEncode(file.name)}`;
  toast("업로드 중… " + file.name);
  try {
    const { error } = await sb.storage.from("files").upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (error) throw error;
    toast("업로드 완료: " + file.name);
    route();
  } catch (e) { toast("업로드 실패: " + (e.message || e), true); }
};
window.mockupOpen = function () {
  const wrap = modal("HMCM Mock-up (기존 사이트)",
    `<iframe src="https://seanjo77.github.io/hmcmsite/" style="width:100%;height:76vh;border:1px solid var(--line);border-radius:8px;background:#fff"></iframe>
     <div class="field-hint" style="margin-top:6px"><a class="link" href="https://seanjo77.github.io/hmcmsite/" target="_blank" rel="noopener">새 창에서 열기 ↗</a></div>`,
    null);
  $(".modal", wrap).style.maxWidth = "1100px";
  $(".modal", wrap).style.width = "92vw";
};
window.docView = async function (name) {
  const url = sb.storage.from("files").getPublicUrl("docs/" + name).data.publicUrl;
  const viewer = $("#doc-viewer"), body = $("#doc-viewer-body");
  $("#doc-viewer-title").textContent = docDisplayName(name);
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
  if (!isMaster()) return toast("자료 삭제는 팀장만 가능합니다.", true);
  if (!confirm("문서를 삭제할까요?")) return;
  const { error } = await sb.storage.from("files").remove(["docs/" + name]);
  if (error) toast("삭제 실패: " + error.message, true);
  else { toast("삭제됨"); route(); }
};

/* ══ 근태 ══ */
async function vAttendance() {
  const rows = await q(sb.from("attendance").select("*").order("att_date", { ascending: false }));
  const months = [...new Set(rows.map(r => (r.att_date || "").slice(0, 7)))].filter(Boolean).sort().reverse();
  const curMon = today().slice(0, 7);
  const state = { month: months.includes(curMon) ? curMon : (months[0] || "") };

  function render() {
    const f = state.month ? rows.filter(r => (r.att_date || "").startsWith(state.month)) : rows;
    const types = [...new Set(f.map(r => r.att_type || "기타"))];
    const agg = {};
    for (const r of f) {
      agg[r.name] = agg[r.name] || {};
      agg[r.name][r.att_type || "기타"] = (agg[r.name][r.att_type || "기타"] || 0) + 1;
    }
    $("#att-agg").innerHTML = `
      <table><thead><tr><th>팀원</th>${types.map(tp => `<th>${esc(tp)}</th>`).join("")}<th>합계</th></tr></thead><tbody>
      ${Object.entries(agg).map(([name, m]) => `<tr><td><b>${esc(name)}</b></td>
        ${types.map(tp => `<td>${m[tp] || ""}</td>`).join("")}
        <td><b>${Object.values(m).reduce((s, v) => s + v, 0)}</b></td></tr>`).join("") || `<tr><td colspan="9" class="muted">해당 월 근태 없음</td></tr>`}
      </tbody></table>`;
    $("#att-body").innerHTML = f.map(x => `<tr ${x.att_date >= today() ? 'style="background:#F7F1E3"' : ""}>
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
  <div class="panel"><h2>월별 집계</h2><div id="att-agg"></div></div>
  <div class="panel"><h2>상세 기록</h2>
  <div class="tbl-wrap" style="max-height:50vh"><table>
    <thead><tr><th>날짜</th><th>이름</th><th>구분</th><th>비고</th></tr></thead>
    <tbody id="att-body"></tbody></table></div></div>`;
  $("#f-a-month").onchange = (e) => { state.month = e.target.value; render(); };
  render();
}
window.attAdd = function () {
  if (!canWrite()) return needLogin();
  modal("근태 등록", [
    `<div class="row">` +
      fld("날짜", `<input type="date" name="d" value="${today()}" required>`) +
      fld("이름", selHtml("n", CONFIG.TEAM, me().name)) +
      fld("구분", selHtml("t", ["연차", "반차", "시차", "출장", "연장근무", "기타"], "연차")) + `</div>`,
    fld("비고", `<input type="text" name="r" style="width:100%" placeholder="예: 8/18~21 (총 4일)">`),
  ].join(""), async (f) => {
    try {
      await q(sb.from("attendance").insert({ att_date: f.get("d"), name: f.get("n"), att_type: f.get("t"), remark: f.get("r") || null }));
      toast("근태 등록 완료"); route();
    } catch (_) { return false; }
  }, "등록");
};

/* ══ 건의사항 ══ */
async function vSuggest() {
  const rows = await q(sb.from("suggestions").select("*").order("created_at", { ascending: false }));
  app.innerHTML = `
  <h1>건의사항</h1><p class="page-sub">팀 운영·업무에 대한 건의를 자유롭게 남겨주세요.</p>
  <div class="panel"><h2>건의 작성</h2>
    <form id="sugg-form">
      <div class="field"><textarea id="sugg-content" required placeholder="건의 내용을 입력하세요"></textarea></div>
      <button class="btn" type="submit">등록</button>
    </form></div>
  <div class="panel"><h2>건의 목록 (${rows.length})</h2>
    ${rows.map(sg => `<div class="comment">
      <div class="meta"><b>${esc(sg.author)}</b> · ${kstDateTime(sg.created_at)}
        ${(sg.author === me().name || isMaster()) ? `<button class="btn sm ghost" onclick="suggDel(${sg.id}, '${esc(sg.author)}')">삭제</button>` : ""}</div>
      <div class="body">${esc(sg.content)}</div></div>`).join("") || '<p class="muted">아직 건의사항이 없습니다.</p>'}
  </div>`;
  $("#sugg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = $("#sugg-content").value.trim();
    if (!content) return;
    try { await q(sb.from("suggestions").insert({ author: me().name, content })); toast("건의가 등록되었습니다."); route(); } catch (_) {}
  });
}
window.suggDel = async function (id, author) {
  if (!guardEdit(author)) return;
  if (!confirm("건의를 삭제할까요?")) return;
  try { await q(sb.from("suggestions").delete().eq("id", id)); toast("삭제됨"); route(); } catch (_) {}
};

/* ══ 운영 규칙 ══ */
let _notes = [];
async function vNotes() {
  const notes = await q(sb.from("notes").select("*").order("no"));
  _notes = notes;
  app.innerHTML = `
  <h1>운영 규칙</h1><p class="page-sub">CM기획팀 운영 규칙</p>
  ${isMaster() ? `<div class="row"><button class="btn" onclick="noteAdd()">+ 규칙 추가 (팀장 전용)</button></div>` : ""}
  <div class="panel">
    <table><thead><tr><th style="width:60px">순번</th><th>규칙</th>${isMaster() ? '<th style="width:110px"></th>' : ""}</tr></thead><tbody>
    ${notes.map((n, i) => `<tr><td><b>${i + 1}</b></td><td class="wrap">${esc(n.content)}</td>
      ${isMaster() ? `<td style="white-space:nowrap"><button class="btn sm ghost" onclick="noteEdit(${n.id})">수정</button>
        <button class="btn sm ghost" style="color:var(--danger)" onclick="noteDel(${n.id})">삭제</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="3" class="muted">등록된 규칙이 없습니다.</td></tr>`}
    </tbody></table></div>`;
}
window.noteAdd = function () {
  if (!isMaster()) return toast("팀장만 규칙을 추가할 수 있습니다.", true);
  const maxNo = Math.max(0, ..._notes.map(n => n.no || 0));
  modal("규칙 추가", fld("내용", `<textarea name="c" required></textarea>`), async (f) => {
    try { await q(sb.from("notes").insert({ no: Math.floor(maxNo) + 1, content: f.get("c") })); toast("추가 완료"); route(); }
    catch (_) { return false; }
  }, "추가");
};
window.noteEdit = function (id) {
  if (!isMaster()) return toast("팀장만 수정할 수 있습니다.", true);
  const n = _notes.find(x => x.id === id); if (!n) return;
  modal("규칙 수정 — 전달 " + (n.no ?? ""), fld("내용", `<textarea name="c" required>${esc(n.content)}</textarea>`), async (f) => {
    try { await q(sb.from("notes").update({ content: f.get("c") }).eq("id", id)); toast("수정 완료"); route(); }
    catch (_) { return false; }
  });
};
window.noteDel = async function (id) {
  if (!isMaster()) return toast("팀장만 삭제할 수 있습니다.", true);
  if (!confirm("이 규칙을 삭제할까요?")) return;
  try { await q(sb.from("notes").delete().eq("id", id)); toast("삭제됨"); route(); } catch (_) {}
};

/* ── boot ─────────────────────────────────────── */
window.addEventListener("hashchange", route);
initAuth().then(route);
