// 교사 대시보드 — 반 목록, 무작위 실험(차 수별 고정 비율, 예상 적중, 예상왕), 학생별 기록, 다시 보기, 실험 모아 보기
import { parse, classify, balanced, RESULT_TEXT, RANDOM_FIXED_5x5, RAND_COUNTS, decodeGuess, isHit, guessScore } from "./core.js";
import { Simulator, miniBoard } from "./sim-ui.js";
import { attachZoom } from "./zoom.js";
import { publishRandom } from "./shared.js";

const $ = (id) => document.getElementById(id);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ALL = "__all__";
const pct = (h, k) => (k ? Math.round(h / k * 100) + "%" : "–");

const T = {
  store: null, config: null, subs: [], unsub: null,
  cls: ls.get("bml-t-cls", ALL),
  showOld: false, filter: "all", sid: null, selected: null, cmp: false, rankSids: false,
  verifyCache: new Map()
};

const replay = new Simulator($("replaySim"), { L: 5, editable: false, maxRounds: 600, showDetectToggle: true });

/* ---------- 확인(다시 계산) ---------- */
function verify(s) {
  if (!T.verifyCache.has(s.board)) {
    const c = /^[.RB]{25}$/.test(s.board) ? classify(parse(s.board, 5)) : null;
    T.verifyCache.set(s.board, c);
  }
  const c = T.verifyCache.get(s.board);
  return !!c && c.type === s.result && c.nr === s.nr && c.nb === s.nb;
}
// 무작위 실험 제출(mode "density")만 씀 — 예전 5×5 도전 제출은 무시
const isRandom = (s) => s.mode === "density";
function scopeSubs() {
  const since = T.showOld ? {} : (T.config ? T.config.resetAt || {} : {});
  return T.subs.filter((s) => isRandom(s) && s.createdAt >= (since[s.cls] || 0));
}
// 그래프·점수에는 다시 계산한 결과가 맞는 실험만
function randomSubs() { return scopeSubs().filter((s) => !s.hidden && verify(s) && balanced(s)); }
const fmtTime = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const targetClasses = () => (T.cls === ALL ? (T.config ? T.config.classes : []) : [T.cls]);

/* ---------- 반 목록 ---------- */
function renderClasses() {
  const cfg = T.config;
  const box = $("classPills");
  box.innerHTML = "";
  if (!cfg) return;
  if (!cfg.classes.length) box.innerHTML = '<span class="note">아직 반이 없어요. 아래에서 반을 추가해 주세요.</span>';
  cfg.classes.forEach((c) => {
    const pill = document.createElement("span");
    pill.className = "class-pill";
    pill.innerHTML = `<span>${esc(c)}</span>`;
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", c + " 빼기");
    x.addEventListener("click", () => {
      if (x.dataset.armed) { saveCfg({ classes: cfg.classes.filter((v) => v !== c) }); }
      else { x.dataset.armed = "1"; x.textContent = "빼기?"; x.style.width = "auto"; x.style.padding = "0 8px"; setTimeout(() => { delete x.dataset.armed; x.textContent = "×"; x.style.width = ""; x.style.padding = ""; }, 3000); }
    });
    pill.append(x);
    box.append(pill);
  });
  const sel = $("clsSel");
  const seen = new Set(cfg.classes);
  T.subs.forEach((s) => seen.add(s.cls));
  const opts = [[ALL, "모든 반"]].concat([...seen].map((c) => [c, cfg.classes.includes(c) ? c : c + " (목록에서 뺌)"]));
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  sel.value = opts.some(([v]) => v === T.cls) ? T.cls : ALL;
}
function addClass() {
  const name = $("newCls").value.trim();
  const err = $("clsErr");
  if (!T.config) return;
  if (!name) { err.textContent = "반 이름을 적어 주세요."; return; }
  if (T.config.classes.includes(name)) { err.textContent = "이미 있는 반이에요."; return; }
  err.textContent = "";
  $("newCls").value = "";
  saveCfg({ classes: T.config.classes.concat([name]) });
}
$("btnAddCls").addEventListener("click", addClass);
$("newCls").addEventListener("keydown", (e) => { if (e.key === "Enter") addClass(); });
$("newCls").addEventListener("input", () => { $("clsErr").textContent = ""; });

async function saveCfg(patch) {
  const next = Object.assign({}, T.config, patch);
  try { await T.store.saveConfig(next); }
  catch (e) { $("clsErr").textContent = "저장하지 못했어요. 인터넷 연결이나 데이터베이스 규칙을 확인해 주세요."; }
}
function saveDensity(patch) {
  const d = Object.assign({ on: false, cars: 16 }, T.config.density || {}, patch);
  return saveCfg({ density: d });
}

$("clsSel").addEventListener("change", (e) => {
  T.cls = e.target.value; ls.set("bml-t-cls", T.cls);
  T.sid = null; T.selected = null;
  subscribe();
  renderAll();
});

/* ---------- 열기 · 새로 시작 ---------- */
$("randOn").addEventListener("change", (e) => {
  if (!T.config) { e.target.checked = false; return; }
  saveDensity({ on: e.target.checked });
});
$("showOld").addEventListener("change", (e) => { T.showOld = e.target.checked; renderAll(); });
$("btnReset").addEventListener("click", () => {
  if (!targetClasses().length) return;
  $("resetText").textContent = `${T.cls === ALL ? "모든 반" : T.cls}의 실험을 새로 시작할까요? 지금까지의 실험은 지워지지 않고 그래프와 점수에서만 빠져요. 수업 전에 시험해 본 기록을 치울 때 쓰세요.`;
  $("resetConfirm").hidden = false;
});
$("btnResetNo").addEventListener("click", () => { $("resetConfirm").hidden = true; });
$("btnResetYes").addEventListener("click", () => {
  const resetAt = Object.assign({}, T.config.resetAt);
  const now = Date.now();
  targetClasses().forEach((c) => { resetAt[c] = now; });
  $("resetConfirm").hidden = true;
  saveCfg({ resetAt });
});

/* ---------- 다시 보기 ---------- */
function select(s) {
  T.selected = s.id;
  replay.load(parse(s.board, 5), 5);
  const ok = verify(s), g = decodeGuess(s);
  $("replayInfo").innerHTML = `${esc(s.sid)} · ${esc(s.cls)} · ${fmtTime(s.createdAt)} · 차 ${s.n}대 · 예상 ${g ? (g === "fixed" ? "고정" : "반복") : "–"} → 결과 <span class="tag ${s.result}">${RESULT_TEXT[s.result] || s.result}</span>${ok ? "" : ' <span class="tag warn">다시 계산한 결과와 다름</span>'}`;
  const b = $("btnHide");
  b.hidden = false;
  b.textContent = s.hidden ? "숨김 풀기" : "이 실험 숨기기";
  renderGallery();
  $("replaySection").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("btnHide").addEventListener("click", async () => {
  const s = T.subs.find((x) => x.id === T.selected);
  if (!s) return;
  try { await T.store.setHidden(s.id, !s.hidden); } catch (e) { $("replayInfo").textContent = "숨기기를 저장하지 못했어요."; }
});

/* ---------- 무작위 실험 ---------- */
attachZoom($("densZoom"), $("densChart"), "무작위 실험 · 차 수에 따른 고정 비율");
$("densCmp").addEventListener("change", (e) => { T.cmp = e.target.checked; renderDensity(); });
$("rankSids").addEventListener("change", (e) => { T.rankSids = e.target.checked; renderDensity(); });

function tally(list) {
  const by = {};
  RAND_COUNTS.forEach((n) => { by[n] = { n: 0, fixed: 0, k: 0, h: 0 }; });
  list.forEach((s) => {
    const d = (by[s.n] = by[s.n] || { n: 0, fixed: 0, k: 0, h: 0 });
    d.n++; if (s.result === "fixed") d.fixed++;
    const h = isHit(decodeGuess(s), s.result);
    if (h !== null) { d.k++; if (h) d.h++; }
  });
  return by;
}

function renderDensity() {
  const on = !!(T.config && T.config.density && T.config.density.on);
  $("randOn").checked = on;
  $("randOn").closest("label").classList.toggle("on", on);
  const subs = randomSubs();
  const label = T.cls === ALL ? "모든 반" : T.cls;
  $("randTitle").textContent = `무작위 실험 · ${label}`;
  const by = tally(subs);
  const rows = Object.keys(by).map(Number).sort((a, b) => a - b);

  // 카드: 실험 수, 예상 적중률, 가장 맞히기 어려운 차 수
  let k = 0, h = 0;
  subs.forEach((s) => { const x = isHit(decodeGuess(s), s.result); if (x !== null) { k++; if (x) h++; } });
  const people = new Set(subs.map((s) => s.cls + "|" + s.sid)).size;
  const hard = rows.filter((n) => by[n].k >= 5).sort((a, b) => by[a].h / by[a].k - by[b].h / by[b].k)[0];
  $("randCards").innerHTML = `
    <div class="board-card"><h3>모인 실험</h3><div class="big-num">${subs.length}<small>번</small></div><div class="meta">학생 ${people}명 · ${on ? "학생 화면 열림" : "학생 화면 닫힘"}</div></div>
    <div class="board-card"><h3>예상 적중률</h3><div class="big-num">${pct(h, k)}</div><div class="meta">${k ? `${k}번 중 ${h}번 맞힘` : "학생들이 예상하고 실험하면 여기에 나와요"}</div></div>
    <div class="board-card"><h3>가장 맞히기 어려운 차 수</h3><div class="big-num">${hard ? hard + "<small>대</small>" : "–"}</div><div class="meta">${hard ? `적중률 ${pct(by[hard].h, by[hard].k)} · 고정 ${by[hard].fixed}/${by[hard].n}번` : "차 수마다 5번 넘게 모이면 나와요"}</div></div>`;

  publishRandom({ label, by, total: subs.length });

  $("densHead").innerHTML = `<tr><th>차 수</th><th>밀도</th><th>실험</th><th>고정</th><th>반복</th><th>고정 비율</th>${T.cmp ? "<th>컴퓨터 4000번</th>" : ""}<th>예상 적중</th></tr>`;
  const frac = (a, b) => (b ? `${a}/${b}` : "–");
  $("densBody").innerHTML = rows.map((n) => {
    const r = by[n], rr = RANDOM_FIXED_5x5[n];
    return `<tr><td>${n}대</td><td class="mono">${(n / 25).toFixed(2)}</td><td class="mono">${r.n}</td><td class="mono">${r.fixed}</td><td class="mono">${r.n - r.fixed}</td><td class="mono">${r.n ? (r.fixed / r.n).toFixed(2) : "–"}</td>${T.cmp ? `<td class="mono">${rr === undefined ? "–" : rr.toFixed(2)}</td>` : ""}<td class="mono">${frac(r.h, r.k)}</td></tr>`;
  }).join("") + `<tr class="total"><td>합계</td><td></td><td class="mono">${subs.length}</td><td class="mono">${subs.filter((s) => s.result === "fixed").length}</td><td class="mono">${subs.filter((s) => s.result !== "fixed").length}</td><td></td>${T.cmp ? "<td></td>" : ""}<td class="mono">${frac(h, k)}</td></tr>`;
  renderRanking(subs);

  // 막대그래프: 차 수마다 고정 비율 (고정 횟수 ÷ 실험 횟수), 막대 위에 '고정 횟수/실험 횟수'
  const svg = $("densChart"), NS = "http://www.w3.org/2000/svg";
  const el = (tag, a, t) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (t !== undefined) e.textContent = t; return e; };
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const W = 560, H = 320, l = 50, r = 14, t = 46, b = 58;
  const step = (W - l - r) / rows.length;
  const X = (k) => l + step * (k + 0.5), Y = (v) => H - b - v * (H - t - b);
  svg.append(el("text", { x: 0, y: 16, "font-size": 14, fill: "var(--ink)" }, "차 수에 따른 고정 비율 (고정 횟수 ÷ 실험 횟수)"));
  svg.append(el("rect", { x: l, y: 27, width: 12, height: 10, fill: "var(--ink)" }));
  svg.append(el("text", { x: l + 18, y: 36, "font-size": 12, fill: "var(--muted)" }, `${label} · 실험 ${subs.length}번`));
  if (T.cmp) {
    svg.append(el("circle", { cx: l + 170, cy: 32, r: 4, fill: "var(--surface)", stroke: "var(--jam)", "stroke-width": 2 }));
    svg.append(el("text", { x: l + 180, y: 36, "font-size": 12, fill: "var(--muted)" }, "컴퓨터 4000번"));
  }
  for (let k = 0; k <= 4; k++) {
    const v = k / 4;
    svg.append(el("line", { x1: l, x2: W - r, y1: Y(v), y2: Y(v), stroke: "var(--line)" }));
    svg.append(el("text", { x: l - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" }, v.toFixed(2)));
  }
  svg.append(el("line", { x1: l, x2: W - r, y1: Y(0), y2: Y(0), stroke: "var(--ink)" }));
  rows.forEach((n, k) => {
    svg.append(el("text", { x: X(k), y: H - b + 17, "text-anchor": "middle", "font-size": 12, fill: "var(--ink)" }, `${n}대`));
    svg.append(el("text", { x: X(k), y: H - b + 32, "text-anchor": "middle", "font-size": 10.5, fill: "var(--muted)" }, (n / 25).toFixed(2)));
    const d = by[n];
    if (!d || !d.n) { svg.append(el("text", { x: X(k), y: Y(0) - 6, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, "0번")); return; }
    const v = d.fixed / d.n, bw = Math.min(40, step * 0.62);
    const bar = el("rect", { x: X(k) - bw / 2, y: Y(v), width: bw, height: Math.max(1, Y(0) - Y(v)), fill: "var(--ink)", rx: 2 });
    bar.append(el("title", {}, `${n}대: ${d.n}번 중 ${d.fixed}번 고정 → ${v.toFixed(2)}`));
    svg.append(bar);
    svg.append(el("text", { x: X(k), y: Y(v) - 6, "text-anchor": "middle", "font-size": 11, fill: "var(--ink)" }, `${d.fixed}/${d.n}`));
  });
  svg.append(el("text", { x: (l + W - r) / 2, y: H - 6, "text-anchor": "middle", "font-size": 12, fill: "var(--muted)" }, "차 수 (아래 숫자는 밀도 = 차 수 ÷ 25)"));
  if (T.cmp) {
    const pts = rows.filter((n) => RANDOM_FIXED_5x5[n] !== undefined);
    svg.append(el("polyline", { points: pts.map((n) => `${X(rows.indexOf(n))},${Y(RANDOM_FIXED_5x5[n])}`).join(" "), fill: "none", stroke: "var(--jam)", "stroke-width": 1.5, "stroke-dasharray": "4 4" }));
    pts.forEach((n) => svg.append(el("circle", { cx: X(rows.indexOf(n)), cy: Y(RANDOM_FIXED_5x5[n]), r: 4, fill: "var(--surface)", stroke: "var(--jam)", "stroke-width": 2 })));
  }
  if (!subs.length) svg.append(el("text", { x: (l + W - r) / 2, y: (t + H - b) / 2, "text-anchor": "middle", "font-size": 13, fill: "var(--muted)" }, on ? "학생들이 실험하면 막대가 쌓여요" : "위의 '학생 화면에서 실험 열기'를 켜면 시작할 수 있어요"));
}

// 학생 한 명의 예상 요약 — 실험이 쌓이며 예상이 나아지므로 수준은 최근 7번으로 봄
function studentStats(list) {
  const sorted = list.slice().sort((a, b) => a.createdAt - b.createdAt);
  const all = guessScore(sorted);
  const known = sorted.filter((s) => decodeGuess(s));
  const recent = guessScore(known.slice(-7));
  const rate = recent.known ? recent.hits / recent.known : 0;
  const level = !all.known ? "–" : all.known >= 10 && recent.hits >= 6 ? "상" : rate >= 0.6 ? "중" : "하";
  return { all, recent, level };
}

// 예상왕: 맞힌 수(점수)가 많은 순, 같으면 적중률이 높은 순
function renderRanking(subs) {
  const by = new Map();
  subs.forEach((s) => { const k = s.cls + "|" + s.sid; if (!by.has(k)) by.set(k, []); by.get(k).push(s); });
  const list = [...by.entries()].map(([k, l]) => ({ k, sid: k.split("|")[1], cls: k.split("|")[0], n: l.length, ...studentStats(l) }))
    .filter((x) => x.all.known > 0)
    .sort((a, b) => b.all.hits - a.all.hits || b.all.hits / b.all.known - a.all.hits / a.all.known || a.n - b.n);
  const box = $("rankBody");
  if (!list.length) { box.innerHTML = '<tr><td colspan="5" class="empty" style="text-align:center">아직 예상 기록이 없어요.</td></tr>'; return; }
  let rank = 0, prev = null;
  box.innerHTML = list.slice(0, 10).map((x, i) => {
    if (!prev || prev.all.hits !== x.all.hits || prev.all.known !== x.all.known) rank = i + 1;
    prev = x;
    const who = T.rankSids ? `${esc(x.sid)}${T.cls === ALL ? ` <span class="meta">${esc(x.cls)}</span>` : ""}` : '<span class="meta">학번 가림</span>';
    return `<tr${rank === 1 ? ' class="rank1"' : ""}><td>${rank}위</td><td class="left">${who}</td><td class="mono"><b>${x.all.hits}</b>점</td><td class="mono">${x.n}번</td><td class="mono">${pct(x.all.hits, x.all.known)}</td></tr>`;
  }).join("");
}

/* ---------- 학생별 기록 ---------- */
function renderStudents() {
  const all = scopeSubs().filter((s) => !s.hidden);
  const by = new Map();
  all.forEach((s) => { const k = s.cls + "|" + s.sid; if (!by.has(k)) by.set(k, []); by.get(k).push(s); });
  const rows = [...by.entries()].sort((a, b) => a[0].split("|")[1].localeCompare(b[0].split("|")[1]) || a[0].localeCompare(b[0]));
  $("stuBody").innerHTML = "";
  if (!rows.length) { $("stuBody").innerHTML = '<tr><td colspan="9" class="empty" style="text-align:center">아직 실험이 없어요.</td></tr>'; return; }
  for (const [k, list] of rows) {
    const [cls, sid] = k.split("|");
    const good = list.filter((s) => verify(s) && balanced(s));
    const warn = list.length - good.length;
    const st = studentStats(good);
    const tr = document.createElement("tr");
    tr.className = "clickable" + (T.sid === k ? " sel" : "");
    tr.innerHTML = `<td class="mono">${esc(sid)}</td><td class="left">${esc(cls)}</td><td class="mono">${list.length}</td><td class="mono">${st.all.hits}</td><td class="mono">${pct(st.all.hits, st.all.known)}</td><td class="mono">${st.recent.known ? `${st.recent.hits}/${st.recent.known}` : "–"}</td><td class="mono">${warn || ""}</td><td class="left">${st.level}</td><td class="mono">${fmtTime(Math.max(...list.map((s) => s.createdAt)))}</td>`;
    tr.addEventListener("click", () => { T.sid = T.sid === k ? null : k; renderStudents(); renderGallery(); });
    $("stuBody").append(tr);
  }
}

/* ---------- 실험 모아 보기 ---------- */
document.querySelectorAll("#galFilter button").forEach((b) => b.addEventListener("click", () => {
  T.filter = b.dataset.f;
  document.querySelectorAll("#galFilter button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
  renderGallery();
}));
function renderGallery() {
  let list = scopeSubs();
  if (T.filter === "hidden") list = list.filter((s) => s.hidden);
  else {
    list = list.filter((s) => !s.hidden);
    if (T.filter === "fixed") list = list.filter((s) => s.result === "fixed");
    if (T.filter === "repeat") list = list.filter((s) => s.result !== "fixed");
    if (T.filter === "miss") list = list.filter((s) => isHit(decodeGuess(s), s.result) === false);
  }
  if (T.sid) list = list.filter((s) => s.cls + "|" + s.sid === T.sid);
  const chip = $("sidChip");
  if (T.sid) {
    chip.hidden = false;
    chip.innerHTML = `${esc(T.sid.split("|")[1])}의 실험만 보는 중 `;
    const x = document.createElement("button");
    x.className = "linkbtn"; x.textContent = "전체 보기";
    x.addEventListener("click", () => { T.sid = null; renderStudents(); renderGallery(); });
    chip.append(x);
  } else chip.hidden = true;
  const g = $("gallery");
  g.innerHTML = "";
  if (!list.length) { g.innerHTML = '<p class="note">보여 줄 실험이 없어요.</p>'; return; }
  list.slice().reverse().slice(0, 300).forEach((s) => {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "gtile" + (s.hidden ? " hidden-sub" : "") + (T.selected === s.id ? " sel" : "");
    t.append(miniBoard(parse(s.board, 5), 5, { label: `${s.sid} 실험` }));
    const ok = verify(s), hit = isHit(decodeGuess(s), s.result);
    const info = document.createElement("div");
    info.innerHTML = `<b>${esc(s.sid)}</b>${T.cls === ALL ? " · " + esc(s.cls) : ""}<br><span class="tag ${s.result}">${s.result === "fixed" ? "고정" : "반복"}</span> ${s.n}대${hit === null ? "" : hit ? ' <span class="tag free">예상 ○</span>' : ' <span class="tag muted">예상 ×</span>'}${ok ? "" : ' <span class="tag warn">확인 필요</span>'}<br><span class="meta">${fmtTime(s.createdAt)}</span>`;
    t.append(info);
    t.addEventListener("click", () => select(s));
    g.append(t);
  });
}

/* ---------- 복사 ---------- */
$("btnCsv").addEventListener("click", () => {
  const head = ["반", "학번", "시각", "차 수", "예상", "결과", "예상 맞음", "배치(5줄)", "반복 시작 라운드", "반복 주기", "다시 계산 일치", "숨김"];
  const lines = [head.join("\t")].concat(scopeSubs().map((s) => {
    const g = decodeGuess(s), h = isHit(g, s.result);
    return [s.cls, s.sid, new Date(s.createdAt).toLocaleString("ko-KR"), s.n, g ? (g === "fixed" ? "고정" : "반복") : "", RESULT_TEXT[s.result] || s.result, h === null ? "" : h ? "○" : "×", s.board.match(/.{5}/g).join(" "), s.start, s.period, verify(s) ? "예" : "아니오", s.hidden ? "예" : ""].join("\t");
  }));
  const text = lines.join("\n");
  const msg = $("csvMsg"), fb = $("csvFallback");
  const fallback = () => { fb.hidden = false; fb.value = text; fb.focus(); fb.select(); msg.textContent = "아래 글상자의 내용을 직접 복사해 주세요(Ctrl+C)."; };
  try { navigator.clipboard.writeText(text).then(() => { fb.hidden = true; msg.textContent = `${lines.length - 1}개 실험을 복사했어요. 스프레드시트에 붙여 넣을 수 있어요.`; }, fallback); } catch (e) { fallback(); }
});

/* ---------- 연결 ---------- */
function renderAll() { renderClasses(); renderDensity(); renderStudents(); renderGallery(); }
function subscribe() {
  if (T.unsub) { T.unsub(); T.unsub = null; }
  T.subs = [];
  if (!T.store) return;
  T.unsub = T.store.watchSubmissions(T.cls === ALL ? null : T.cls, (list) => {
    T.subs = list;
    const sel = list.find((s) => s.id === T.selected);
    if (sel) { $("btnHide").textContent = sel.hidden ? "숨김 풀기" : "이 실험 숨기기"; }
    renderAll();
  }, (e) => { $("connLine").textContent = "실험 기록을 불러오지 못했어요. 데이터베이스 설정을 확인해 주세요."; });
}
async function connect() {
  try { T.store = await import("./store.js"); }
  catch (e) { $("connLine").textContent = "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요."; return; }
  T.store.watchConfig((cfg) => {
    T.config = cfg;
    $("connLine").textContent = "실시간으로 연결됨 · 학생이 실험하면 바로 반영돼요";
    renderAll();
  }, () => { $("connLine").textContent = "설정을 불러오지 못했어요. 데이터베이스 설정을 확인해 주세요."; });
  subscribe();
}
renderAll();
connect();
