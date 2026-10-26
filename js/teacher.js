// 교사 대시보드 — 반 목록, 실시간 기록판, 다시 보기, 무작위 실험(상대도수), 학생별 기록, 제출 모아 보기
import { parse, classify, CHALLENGES, challengeIds, bestRecords, balanced, RESULT_TEXT, RANDOM_FIXED_5x5 } from "./core.js";
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

const T = {
  store: null, config: null, subs: [], unsub: null,
  cls: ls.get("bml-t-cls", ALL),
  showBoards: false, showSids: false, showOld: false,
  filter: "all", sid: null, selected: null, cmp: false,
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
// 기록에는 다시 계산한 결과가 맞는 제출만 씀
function cleanSubs() {
  const since = T.showOld ? {} : (T.config ? T.config.resetAt || {} : {});
  return T.subs.filter((s) => !s.hidden && verify(s) && s.createdAt >= (since[s.cls] || 0));
}
// 5×5 도전 제출과 무작위 실험 제출(mode "density")은 따로 셈
const isRandom = (s) => s.mode === "density";
function challengeSubs() { return cleanSubs().filter((s) => !isRandom(s)); }
function randomSubs() { return cleanSubs().filter((s) => isRandom(s) && balanced(s)); }
function scopeSubs() {
  const since = T.showOld ? {} : (T.config ? T.config.resetAt || {} : {});
  return T.subs.filter((s) => s.createdAt >= (since[s.cls] || 0));
}
const fmtTime = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

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
  // 반 고르기
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

$("clsSel").addEventListener("change", (e) => {
  T.cls = e.target.value; ls.set("bml-t-cls", T.cls);
  T.sid = null; T.selected = null;
  subscribe();
  renderAll();
});

/* ---------- 기록판 ---------- */
function renderBest() {
  const subs = challengeSubs();
  const best = bestRecords(subs);
  const name = T.cls === ALL ? "모든 반" : T.cls;
  $("boardTitle").textContent = `실시간 기록판 · ${name}`;
  const box = $("bestCards");
  box.innerHTML = "";
  for (const c of CHALLENGES) {
    const r = best[c.id];
    const people = new Set(r.subs.map((s) => s.cls + "|" + s.sid));
    const card = document.createElement("div");
    card.className = "board-card";
    card.innerHTML = `<h3>${c.title}</h3><div class="big-num">${r.value === null ? "–" : r.value}<small>${r.value === null ? "" : "대"}</small></div>
      <div class="meta">${r.value === null ? "아직 기록이 없어요" : `${people.size}명이 이 기록을 냈어요`}</div>`;
    if (T.showBoards && r.subs.length) {
      const grid = document.createElement("div");
      grid.className = "best-boards";
      const uniq = new Map();
      r.subs.forEach((s) => { if (!uniq.has(s.board)) uniq.set(s.board, s); });
      [...uniq.values()].slice(0, 6).forEach((s) => {
        const f = document.createElement("figure");
        f.style.cursor = "pointer";
        f.append(miniBoard(parse(s.board, 5), 5, { label: `${s.sid} 배치` }));
        const cap = document.createElement("figcaption");
        cap.textContent = T.showSids ? `${s.sid}${T.cls === ALL ? " · " + s.cls : ""}` : `빨강 ${s.nr} · 파랑 ${s.nb}`;
        f.append(cap);
        f.addEventListener("click", () => select(s));
        grid.append(f);
      });
      card.append(grid);
    }
    box.append(card);
  }
  const bal = subs.filter(balanced), nFix = bal.filter((s) => s.result === "fixed").length;
  const people = new Set(subs.map((s) => s.cls + "|" + s.sid)).size;
  $("boardCount").textContent = subs.length ? `지금까지 도전 제출 ${subs.length}개 (학생 ${people}명) · 기록으로 세는 제출 중 고정 ${nFix}개, 반복 ${bal.length - nFix}개` : "";
}
$("showBoards").addEventListener("change", (e) => { T.showBoards = e.target.checked; renderBest(); });
$("showSids").addEventListener("change", (e) => { T.showSids = e.target.checked; renderBest(); });
$("showOld").addEventListener("change", (e) => { T.showOld = e.target.checked; renderAll(); });
$("btnReset").addEventListener("click", () => {
  const targets = T.cls === ALL ? (T.config ? T.config.classes : []) : [T.cls];
  if (!targets.length) return;
  $("resetText").textContent = `${T.cls === ALL ? "모든 반" : T.cls}의 기록판을 새로 시작할까요? 지금까지의 제출은 지워지지 않고, 기록판과 학생 화면의 최고 기록에서만 빠져요.`;
  $("resetConfirm").hidden = false;
});
$("btnResetNo").addEventListener("click", () => { $("resetConfirm").hidden = true; });
$("btnResetYes").addEventListener("click", () => {
  const targets = T.cls === ALL ? T.config.classes : [T.cls];
  const resetAt = Object.assign({}, T.config.resetAt);
  const now = Date.now();
  targets.forEach((c) => { resetAt[c] = now; });
  $("resetConfirm").hidden = true;
  saveCfg({ resetAt });
});

/* ---------- 다시 보기 ---------- */
function select(s) {
  T.selected = s.id;
  replay.load(parse(s.board, 5), 5);
  const ok = verify(s);
  $("replayInfo").innerHTML = `${esc(s.sid)} · ${esc(s.cls)} · ${fmtTime(s.createdAt)} · 제출 결과 <span class="tag ${s.result}">${RESULT_TEXT[s.result] || s.result}</span> 차 ${s.n}대 (빨강 ${s.nr} · 파랑 ${s.nb})${ok ? "" : ' <span class="tag warn">다시 계산한 결과와 다름</span>'}`;
  const b = $("btnHide");
  b.hidden = false;
  b.textContent = s.hidden ? "숨김 풀기" : "이 제출 숨기기";
  renderGallery();
  $("replaySection").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("btnHide").addEventListener("click", async () => {
  const s = T.subs.find((x) => x.id === T.selected);
  if (!s) return;
  try { await T.store.setHidden(s.id, !s.hidden); } catch (e) { $("replayInfo").textContent = "숨기기를 저장하지 못했어요."; }
});

/* ---------- 무작위 실험 ---------- */
// 학생이 '② 무작위 실험'에서 앱이 정한 차 수로 아무렇게나 놓고 판정한 결과 → 차 수별 고정의 상대도수
const RAND_COUNTS = [10, 12, 14, 16, 18, 20, 22];
attachZoom($("densZoom"), $("densChart"), "무작위 실험 · 고정의 상대도수");
$("randOn").addEventListener("change", (e) => {
  if (!T.config) { e.target.checked = false; return; }
  saveCfg({ density: { on: e.target.checked, cars: (T.config.density && T.config.density.cars) || 16 } });
});
$("densCmp").addEventListener("change", (e) => { T.cmp = e.target.checked; renderDensity(); });

function renderDensity() {
  const on = !!(T.config && T.config.density && T.config.density.on);
  $("randOn").checked = on;
  $("randOn").closest("label").classList.toggle("on", on);
  const subs = randomSubs();
  const people = new Set(subs.map((s) => s.cls + "|" + s.sid)).size;
  const label = T.cls === ALL ? "모든 반" : T.cls;
  $("densMeta").textContent = subs.length ? `${label} · 실험 ${subs.length}번 · 학생 ${people}명` : `${label} · 아직 실험 없음`;
  const by = {};
  RAND_COUNTS.forEach((n) => { by[n] = { n: 0, fixed: 0 }; });
  subs.forEach((s) => { (by[s.n] = by[s.n] || { n: 0, fixed: 0 }); by[s.n].n++; if (s.result === "fixed") by[s.n].fixed++; });
  publishRandom({ label, by, total: subs.length });
  const rows = Object.keys(by).map(Number).sort((a, b) => a - b);
  $("densHead").innerHTML = `<tr><th>차 수</th><th>밀도</th><th>실험</th><th>고정</th><th>반복</th><th>고정의 상대도수</th>${T.cmp ? "<th>컴퓨터 4000번</th>" : ""}</tr>`;
  $("densBody").innerHTML = rows.map((n) => {
    const r = by[n], rnd = RANDOM_FIXED_5x5[n];
    return `<tr><td>${n}대</td><td class="mono">${(n / 25).toFixed(2)}</td><td class="mono">${r.n}</td><td class="mono">${r.fixed}</td><td class="mono">${r.n - r.fixed}</td><td class="mono">${r.n ? (r.fixed / r.n).toFixed(2) : "–"}</td>${T.cmp ? `<td class="mono">${rnd === undefined ? "–" : rnd.toFixed(2)}</td>` : ""}</tr>`;
  }).join("") + `<tr class="total"><td>합계</td><td></td><td class="mono">${subs.length}</td><td class="mono">${subs.filter((s) => s.result === "fixed").length}</td><td class="mono">${subs.filter((s) => s.result !== "fixed").length}</td><td></td>${T.cmp ? "<td></td>" : ""}</tr>`;

  // 막대그래프: 차 수마다 고정의 상대도수 (고정 횟수 ÷ 실험 횟수)
  const svg = $("densChart"), NS = "http://www.w3.org/2000/svg";
  const el = (tag, a, t) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (t !== undefined) e.textContent = t; return e; };
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const W = 560, H = 320, l = 50, r = 14, t = 46, b = 58;
  const step = (W - l - r) / rows.length;
  const X = (k) => l + step * (k + 0.5), Y = (v) => H - b - v * (H - t - b);
  svg.append(el("text", { x: 0, y: 16, "font-size": 14, fill: "var(--ink)" }, "차 수에 따른 고정의 상대도수"));
  svg.append(el("rect", { x: l, y: 27, width: 12, height: 10, fill: "var(--ink)" }));
  svg.append(el("text", { x: l + 18, y: 36, "font-size": 12, fill: "var(--muted)" }, `${label} 무작위 실험`));
  if (T.cmp) {
    svg.append(el("circle", { cx: l + 150, cy: 32, r: 4, fill: "var(--surface)", stroke: "var(--jam)", "stroke-width": 2 }));
    svg.append(el("text", { x: l + 160, y: 36, "font-size": 12, fill: "var(--muted)" }, "컴퓨터 4000번"));
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
    if (!d.n) { svg.append(el("text", { x: X(k), y: Y(0) - 6, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, "0번")); return; }
    const v = d.fixed / d.n, bw = Math.min(40, step * 0.62);
    const bar = el("rect", { x: X(k) - bw / 2, y: Y(v), width: bw, height: Math.max(1, Y(0) - Y(v)), fill: "var(--ink)", rx: 2 });
    bar.append(el("title", {}, `${n}대: ${d.n}번 중 ${d.fixed}번 고정 → ${(v).toFixed(2)}`));
    svg.append(bar);
    svg.append(el("text", { x: X(k), y: Y(v) - 6, "text-anchor": "middle", "font-size": 11, fill: "var(--ink)" }, `${d.fixed}/${d.n}`));
  });
  svg.append(el("text", { x: (l + W - r) / 2, y: H - 6, "text-anchor": "middle", "font-size": 12, fill: "var(--muted)" }, "차 수 (아래 숫자는 밀도 = 차 수 ÷ 25)"));
  if (T.cmp) {
    const pts = rows.filter((n) => RANDOM_FIXED_5x5[n] !== undefined);
    svg.append(el("polyline", { points: pts.map((n) => `${X(rows.indexOf(n))},${Y(RANDOM_FIXED_5x5[n])}`).join(" "), fill: "none", stroke: "var(--jam)", "stroke-width": 1.5, "stroke-dasharray": "4 4" }));
    pts.forEach((n) => svg.append(el("circle", { cx: X(rows.indexOf(n)), cy: Y(RANDOM_FIXED_5x5[n]), r: 4, fill: "var(--surface)", stroke: "var(--jam)", "stroke-width": 2 })));
  }
  if (!subs.length) svg.append(el("text", { x: (l + W - r) / 2, y: (t + H - b) / 2, "text-anchor": "middle", "font-size": 13, fill: "var(--muted)" }, on ? "학생들이 실험하면 막대가 쌓여요" : "위의 '무작위 실험 열기'를 켜면 학생 화면에서 시작할 수 있어요"));
}

/* ---------- 학생별 기록 ---------- */
function renderStudents() {
  const all = scopeSubs().filter((s) => !s.hidden);
  const by = new Map();
  all.forEach((s) => { const k = s.cls + "|" + s.sid; if (!by.has(k)) by.set(k, []); by.get(k).push(s); });
  const rows = [...by.entries()].sort((a, b) => a[0].split("|")[1].localeCompare(b[0].split("|")[1]) || a[0].localeCompare(b[0]));
  $("stuBody").innerHTML = "";
  if (!rows.length) { $("stuBody").innerHTML = '<tr><td colspan="9" class="empty" style="text-align:center">아직 제출이 없어요.</td></tr>'; return; }
  for (const [k, list] of rows) {
    const [cls, sid] = k.split("|");
    const good = list.filter(verify).filter((s) => !isRandom(s));
    const nRand = list.filter(isRandom).length;
    const best = bestRecords(good);
    const warn = list.filter((s) => !verify(s)).length;
    const bal = good.filter(balanced);
    const hasFixed = bal.some((s) => s.result === "fixed"), hasRep = bal.some((s) => s.result !== "fixed");
    const top = best.minFixed.value === 10 || (best.maxRepeat.value || 0) >= 20;
    const level = top ? "상" : hasFixed && hasRep ? "중" : "하";
    const tr = document.createElement("tr");
    tr.className = "clickable" + (T.sid === k ? " sel" : "");
    const v = (x) => (x === null ? "–" : x);
    tr.innerHTML = `<td class="mono">${esc(sid)}</td><td class="left">${esc(cls)}</td><td class="mono">${list.length - nRand}</td><td class="mono">${v(best.minFixed.value)}</td><td class="mono">${v(best.maxRepeat.value)}</td><td class="mono">${nRand || ""}</td><td class="mono">${warn || ""}</td><td class="left">${level}</td><td class="mono">${fmtTime(Math.max(...list.map((s) => s.createdAt)))}</td>`;
    tr.addEventListener("click", () => { T.sid = T.sid === k ? null : k; renderStudents(); renderGallery(); });
    $("stuBody").append(tr);
  }
}

/* ---------- 제출 모아 보기 ---------- */
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
    if (T.filter === "challenge") list = list.filter((s) => !isRandom(s));
    if (T.filter === "random") list = list.filter(isRandom);
    if (T.filter === "fixed") list = list.filter((s) => s.result === "fixed");
    if (T.filter === "repeat") list = list.filter((s) => s.result !== "fixed");
    if (T.filter === "warn") list = list.filter((s) => !verify(s));
  }
  if (T.sid) list = list.filter((s) => s.cls + "|" + s.sid === T.sid);
  const chip = $("sidChip");
  if (T.sid) {
    chip.hidden = false;
    chip.innerHTML = `${esc(T.sid.split("|")[1])}의 제출만 보는 중 `;
    const x = document.createElement("button");
    x.className = "linkbtn"; x.textContent = "전체 보기";
    x.addEventListener("click", () => { T.sid = null; renderStudents(); renderGallery(); });
    chip.append(x);
  } else chip.hidden = true;
  const g = $("gallery");
  g.innerHTML = "";
  if (!list.length) { g.innerHTML = '<p class="note">보여 줄 제출이 없어요.</p>'; return; }
  list.slice().reverse().slice(0, 300).forEach((s) => {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "gtile" + (s.hidden ? " hidden-sub" : "") + (T.selected === s.id ? " sel" : "");
    t.append(miniBoard(parse(s.board, 5), 5, { label: `${s.sid} 제출` }));
    const ok = verify(s);
    const info = document.createElement("div");
    info.innerHTML = `<b>${esc(s.sid)}</b>${T.cls === ALL ? " · " + esc(s.cls) : ""}<br><span class="tag ${s.result}">${s.result === "fixed" ? "고정" : s.result === "free" ? "반복·모두" : "반복"}</span> ${s.n}대${balanced(s) ? "" : ' <span class="tag muted">수 다름</span>'}${isRandom(s) ? ' <span class="tag muted">무작위</span>' : ""}${ok ? "" : ' <span class="tag warn">확인 필요</span>'}<br><span class="meta">${fmtTime(s.createdAt)}</span>`;
    t.append(info);
    t.addEventListener("click", () => select(s));
    g.append(t);
  });
}

/* ---------- 복사 ---------- */
$("btnCsv").addEventListener("click", () => {
  const head = ["반", "학번", "제출 시각", "종류", "배치(5줄)", "빨강", "파랑", "차 수", "결과", "반복 시작 라운드", "반복 주기", "해당 도전", "다시 계산 일치", "숨김"];
  const lines = [head.join("\t")].concat(scopeSubs().map((s) => {
    const rows = s.board.match(/.{5}/g).join(" ");
    const ids = challengeIds(s).map((id) => CHALLENGES.find((c) => c.id === id).short).join(", ");
    return [s.cls, s.sid, new Date(s.createdAt).toLocaleString("ko-KR"), isRandom(s) ? "무작위 실험" : "도전", rows, s.nr, s.nb, s.n, RESULT_TEXT[s.result] || s.result, s.start, s.period, ids, verify(s) ? "예" : "아니오", s.hidden ? "예" : ""].join("\t");
  }));
  const text = lines.join("\n");
  const msg = $("csvMsg"), fb = $("csvFallback");
  const fallback = () => { fb.hidden = false; fb.value = text; fb.focus(); fb.select(); msg.textContent = "아래 글상자의 내용을 직접 복사해 주세요(Ctrl+C)."; };
  try { navigator.clipboard.writeText(text).then(() => { fb.hidden = true; msg.textContent = `${lines.length - 1}개 제출을 복사했어요. 스프레드시트에 붙여 넣을 수 있어요.`; }, fallback); } catch (e) { fallback(); }
});

/* ---------- 연결 ---------- */
function renderAll() { renderClasses(); renderBest(); renderDensity(); renderStudents(); renderGallery(); }
function subscribe() {
  if (T.unsub) { T.unsub(); T.unsub = null; }
  T.subs = [];
  if (!T.store) return;
  T.unsub = T.store.watchSubmissions(T.cls === ALL ? null : T.cls, (list) => {
    T.subs = list;
    const sel = list.find((s) => s.id === T.selected);
    if (sel) { $("btnHide").textContent = sel.hidden ? "숨김 풀기" : "이 제출 숨기기"; }
    renderAll();
  }, (e) => { $("connLine").textContent = "제출을 불러오지 못했어요. 데이터베이스 설정을 확인해 주세요."; });
}
async function connect() {
  try { T.store = await import("./store.js"); }
  catch (e) { $("connLine").textContent = "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요."; return; }
  T.store.watchConfig((cfg) => {
    T.config = cfg;
    $("connLine").textContent = "실시간으로 연결됨 · 학생이 제출하면 바로 반영돼요";
    renderAll();
  }, () => { $("connLine").textContent = "설정을 불러오지 못했어요. 데이터베이스 설정을 확인해 주세요."; });
  subscribe();
}
renderAll();
connect();
