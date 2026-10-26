// 학생 화면 — 첫 화면에서 반과 학번으로 들어가 ① 5×5 기록 도전(배치 만들기, 판정, 제출)
//              ② 무작위 실험(앱이 정한 차 수로 무작위 배치 → 예상 → 판정, 결과는 반 전체 상대도수 그래프로)
import { parse, serialize, classify, playRound, CHALLENGES, challengeIds, bestRecords, balanced, RESULT_TEXT } from "./core.js";
import { Simulator, miniBoard, carSvg } from "./sim-ui.js";

const $ = (id) => document.getElementById(id);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ch = {
  me: ls.get("bml-me", null),            // { cls, sid }
  practice: false,                       // 서버 없이 연습만
  config: null,
  subsAll: [],                           // 우리 반 제출 (숨김·초기화 이전 제외)
  state: null,
  store: null, failed: false, unsubSubs: null, connected: false, sending: false,
  tab: ls.get("bml-tab", "challenge") === "random" ? "random" : "challenge"
};
// 차 수는 학번에 따라 순서를 엇갈려 돌아가며 정함 → 반 전체로 보면 차 수마다 실험 횟수가 고르게 쌓임
const RAND_COUNTS = [10, 12, 14, 16, 18, 20, 22];
const COLS = "가나다라마";
const rx = { phase: "ready", cars: 0, board: null, frames: null, fi: 0, result: null, guess: null, timer: null, pending: null, msg: "", msgBad: false, local: [] };
const randCells = [];
(function buildRandBoard() {
  const f = $("randFrame");
  f.style.setProperty("--n", 5);
  const edge = (cls, style) => { const d = document.createElement("div"); d.className = "edge " + cls; d.setAttribute("style", style); return d; };
  const c1 = edge("cols", "grid-row:1"), c2 = edge("cols", "grid-row:3"), r1 = edge("rows", "grid-column:1;grid-row:2"), r2 = edge("rows", "grid-column:3;grid-row:2");
  c1.innerHTML = c2.innerHTML = [...COLS].map((c) => `<span>${c}</span>`).join("");
  r1.innerHTML = r2.innerHTML = [1, 2, 3, 4, 5].map((i) => `<span>${i}</span>`).join("");
  const board = document.createElement("div");
  board.className = "board"; board.setAttribute("role", "img"); board.setAttribute("aria-label", "무작위 실험 판");
  for (let i = 0; i < 25; i++) { const c = document.createElement("div"); c.className = "cell"; board.append(c); randCells.push(c); }
  f.append(c1, r1, board, r2, c2);
})();

const savedCh = ls.get("bml-challenge-board", null);
const chSim = new Simulator($("simChallenge"), {
  L: 5, maxRounds: 600,
  board: savedCh && savedCh.length === 25 ? parse(savedCh, 5) : new Int8Array(25),
  onEdit: (b) => ls.set("bml-challenge-board", serialize(b)),
  onChange: (st) => { ch.state = st; renderChallengeSide(); }
});

/* ---------- 화면: 들어가기 ↔ ① 도전 / ② 무작위 실험 ---------- */
function randomOpen() { return ch.practice || !!(ch.config && ch.config.density && ch.config.density.on); }
function route() {
  const inside = !!ch.me || ch.practice;
  $("view-login").hidden = inside;
  $("view-inside").hidden = !inside;
  $("view-challenge").hidden = ch.tab !== "challenge";
  $("view-random").hidden = ch.tab !== "random";
  if (!inside || ch.tab !== "challenge") chSim.stopAuto();
  if (!inside || ch.tab !== "random") randFinishNow();
  renderTabs();
}
function renderTabs() {
  $("stab-challenge").setAttribute("aria-pressed", ch.tab === "challenge" ? "true" : "false");
  $("stab-random").setAttribute("aria-pressed", ch.tab === "random" ? "true" : "false");
  const open = randomOpen();
  $("stab-random").textContent = open ? "② 무작위 실험" : "② 무작위 실험 (아직 닫힘)";
  $("randOpenNote").hidden = !(open && ch.tab === "challenge" && !ch.practice);
  $("randClosed").hidden = open;
  $("randOpen").hidden = !open;
}
function setTab(t) { ch.tab = t; ls.set("bml-tab", t); route(); renderRandom(); }
$("stab-challenge").addEventListener("click", () => setTab("challenge"));
$("stab-random").addEventListener("click", () => setTab("random"));

function visibleSubs() {
  if (!ch.me || !ch.config) return [];
  const since = (ch.config.resetAt || {})[ch.me.cls] || 0;
  return ch.subsAll.filter((s) => !s.hidden && s.createdAt >= since);
}
// 도전 제출과 무작위 실험 제출(mode "density")은 따로 셈
function challengeSubs() { return visibleSubs().filter((s) => s.mode !== "density"); }
function mySubs() { return challengeSubs().filter((s) => s.sid === ch.me.sid); }
function myRandomSubs() { return ch.me ? visibleSubs().filter((s) => s.mode === "density" && s.sid === ch.me.sid) : []; }

function logout() {
  ch.me = null; ch.practice = false; ls.set("bml-me", null);
  randReset();
  subscribeSubs(); renderWho(); route(); renderChallengeSide();
  $("loginSid").focus();
}

function renderWho() {
  const w = $("who");
  if (ch.me || ch.practice) {
    w.hidden = false;
    w.innerHTML = ch.me ? `<span><b>${esc(ch.me.cls)}</b> · ${esc(ch.me.sid)}</span>` : "<span>연습 중 (제출 안 됨)</span>";
    const b = document.createElement("button");
    b.className = "linkbtn"; b.textContent = ch.me ? "다른 학번으로" : "처음 화면으로";
    b.addEventListener("click", logout);
    w.append(b);
  } else w.hidden = true;
}

function renderLogin() {
  const sel = $("loginCls");
  const classes = ch.config ? ch.config.classes : [];
  const prev = sel.value;
  sel.innerHTML = classes.length ? classes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("") : '<option value="">반 목록이 아직 없어요</option>';
  if (classes.includes(prev)) sel.value = prev;
  sel.disabled = !classes.length;
  $("loginBtn").disabled = !ch.connected || !classes.length;
  $("practiceBtn").hidden = !ch.failed;
  const line = $("connLine");
  if (ch.failed) { line.textContent = "서버에 연결하지 못했어요. 잠시 뒤 새로고침해 주세요."; line.className = "status-line bad"; }
  else if (!ch.connected) { line.textContent = "서버에 연결하는 중…"; line.className = "status-line"; }
  else if (!classes.length) { line.textContent = "선생님이 아직 반 목록을 만들지 않았어요."; line.className = "status-line"; }
  else { line.textContent = ""; line.className = "status-line"; }
}

function login() {
  const cls = $("loginCls").value, sid = $("loginSid").value.trim();
  const err = $("loginErr");
  if (!cls) { err.textContent = "반을 골라 주세요."; return; }
  if (!/^\d{5}$/.test(sid)) { err.textContent = "학번은 숫자 다섯 자리로 적어 주세요. 예: 10101"; $("loginSid").focus(); return; }
  err.textContent = "";
  ch.me = { cls, sid }; ch.practice = false;
  ls.set("bml-me", ch.me);
  randReset();
  subscribeSubs();
  renderWho(); route(); renderChallengeSide();
}
$("loginBtn").addEventListener("click", login);
$("loginSid").addEventListener("input", () => { $("loginErr").textContent = ""; });
$("loginSid").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("practiceBtn").addEventListener("click", () => { ch.practice = true; randReset(); renderWho(); route(); renderChallengeSide(); });

function renderChallengeSide() {
  renderLogin();
  renderTabs();
  renderRandom();
  // 도전 카드
  const subs = challengeSubs();
  const best = bestRecords(subs), mine = ch.me ? bestRecords(mySubs()) : null;
  const st = ch.state, v = st && st.verdict;
  const curSub = v ? { result: v.type, nr: st.nr, nb: st.nb, n: st.n } : null;
  const hits = curSub ? challengeIds(curSub) : [];
  $("ccards").innerHTML = CHALLENGES.map((c) => {
    const b = best[c.id].value, m = mine ? mine[c.id].value : null;
    return `<div class="ccard${hits.includes(c.id) ? " hit" : ""}">
      <h3>${c.title}</h3>
      <div class="recs"><div class="rec"><span>우리 반 최고</span><b>${b === null ? "–" : b}</b></div><div class="rec"><span>내 최고</span><b>${m === null || m === undefined ? "–" : m}</b></div></div>
      <p>${c.desc}</p></div>`;
  }).join("");

  // 이번 배치
  const card = $("resultCard"), btn = $("submitBtn");
  let can = false, why = "";
  if (!st || st.n === 0) { card.innerHTML = "판에 차를 놓아 배치를 만들어 보세요. 빨간 차와 파란 차의 수가 같아야 기록이 돼요."; why = ""; }
  else if (!v) {
    card.innerHTML = `차 <b>${st.n}대</b> (빨강 ${st.nr} · 파랑 ${st.nb}). 배치를 마쳤으면 '판정까지 한 번에'를 누르거나 한 라운드씩 돌려서 결과를 확인하세요.`;
    why = "결과를 확인하면 제출할 수 있어요.";
  } else {
    const tag = `<span class="tag ${v.type}">${RESULT_TEXT[v.type]}</span>`;
    let lines = [`${tag} 차 <b>${st.n}대</b> (빨강 ${st.nr} · 파랑 ${st.nb})`];
    if (!balanced(curSub)) {
      lines.push("빨간 차와 파란 차의 수가 달라서 기록으로 인정되지 않아요.");
      why = "빨강과 파랑의 수를 같게 맞춰 보세요.";
    } else {
      const titles = hits.map((id) => CHALLENGES.find((c) => c.id === id));
      lines.push("해당 도전: " + titles.map((c) => `<b>${c.title}</b>`).join(", "));
      const news = titles.filter((c) => { const b = best[c.id].value; return b === null || (c.better === "min" ? st.n < b : st.n > b); });
      const ties = titles.filter((c) => best[c.id].value === st.n);
      if (news.length) lines.push(`우리 반 새 기록이에요! (${news.map((c) => c.short).join(", ")})`);
      else if (ties.length) lines.push(`우리 반 최고 기록과 같아요. (${ties.map((c) => c.short).join(", ")})`);
      else lines.push("기록이 아니어도 괜찮아요. 나온 배치는 모두 제출해 보세요.");
      can = true;
    }
    card.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
  }
  if (can && ch.me && mySubs().some((s) => s.board === st.board)) { can = false; why = "이미 제출한 배치예요. 칸 하나만 바꿔서 다시 해 보세요."; }
  if (can && ch.practice) { can = false; why = "연습 중이라 제출되지 않아요."; }
  if (can && !ch.store) { can = false; why = "서버에 연결되지 않아 제출할 수 없어요."; }
  if (can && !ch.me) { can = false; why = "반과 학번으로 먼저 들어가 주세요."; }
  btn.disabled = !can || ch.sending;
  const msgEl = $("submitMsg");
  if (msgEl.dataset.keep && msgEl.dataset.board !== (st ? st.board : "")) delete msgEl.dataset.keep;
  if (!ch.sending && !msgEl.dataset.keep) { msgEl.textContent = can ? "" : why; msgEl.className = "status-line"; }

  // 내 제출
  const list = $("myList");
  list.innerHTML = "";
  const mine2 = ch.me ? mySubs().slice().reverse() : [];
  const nFixed = mine2.filter((s) => s.result === "fixed").length;
  $("myCount").textContent = mine2.length ? `모두 ${mine2.length}개 · 고정 ${nFixed} · 반복 ${mine2.length - nFixed}` : "";
  if (!mine2.length) { list.innerHTML = `<p class="note">${ch.me ? "아직 제출한 배치가 없어요." : "반과 학번으로 들어오면 여기에 내 제출이 보여요."}</p>`; return; }
  for (const s of mine2) {
    const d = document.createElement("div");
    d.className = "mysub";
    d.append(miniBoard(parse(s.board, 5), 5, { label: `${RESULT_TEXT[s.result]} ${s.n}대` }));
    const t = document.createElement("div");
    t.innerHTML = `<span class="tag ${s.result}">${s.result === "fixed" ? "고정" : "반복"}</span> ${s.n}대`;
    d.append(t);
    const again = document.createElement("button");
    again.className = "btn small"; again.textContent = "판에 다시 놓기";
    again.addEventListener("click", () => { chSim.load(parse(s.board, 5), 5); ls.set("bml-challenge-board", s.board); window.scrollTo({ top: 0, behavior: "smooth" }); });
    d.append(again);
    list.append(d);
  }
}

async function submit() {
  const st = ch.state;
  if (!st || !st.verdict || !ch.me || !ch.store) return;
  const c = classify(st.start);   // 판정을 처음부터 다시 계산해서 보냄
  const sub = { cls: ch.me.cls, sid: ch.me.sid, mode: "challenge", board: st.board, nr: c.nr, nb: c.nb, n: c.n, result: c.type, start: c.start, period: c.period };
  ch.sending = true; $("submitBtn").disabled = true;
  const msg = $("submitMsg");
  msg.textContent = "제출하는 중…"; msg.className = "status-line";
  try {
    await ch.store.addSubmission(sub);
    msg.textContent = "제출했어요. 다른 배치도 만들어 보세요!"; msg.className = "status-line"; msg.dataset.keep = "1"; msg.dataset.board = st.board;
  } catch (e) {
    msg.textContent = "제출하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요."; msg.className = "status-line bad"; msg.dataset.keep = "1"; msg.dataset.board = st.board;
  } finally { ch.sending = false; renderChallengeSide(); }
}
$("submitBtn").addEventListener("click", submit);

function subscribeSubs() {
  if (ch.unsubSubs) { ch.unsubSubs(); ch.unsubSubs = null; }
  ch.subsAll = [];
  if (!ch.store || !ch.me) return;
  ch.unsubSubs = ch.store.watchSubmissions(ch.me.cls, (list) => { ch.subsAll = list; renderChallengeSide(); }, () => {});
}

async function connect() {
  try { ch.store = await import("./store.js"); }
  catch (e) { ch.store = null; ch.failed = true; renderChallengeSide(); return; }
  ch.store.watchConfig((cfg) => {
    ch.config = cfg; ch.connected = true;
    if (ch.me && cfg.classes.length && !cfg.classes.includes(ch.me.cls)) { ch.me = null; ls.set("bml-me", null); subscribeSubs(); renderWho(); route(); }
    renderChallengeSide();
  }, () => { ch.connected = false; ch.failed = true; renderChallengeSide(); });
  subscribeSubs();
}

/* ---------- ② 무작위 실험 ---------- */
function guessKey() { return ch.me ? `bml-rand-g-${ch.me.cls}-${ch.me.sid}` : "bml-rand-g-practice"; }
function guesses() { return ls.get(guessKey(), {}); }
function randTrials() { return ch.practice ? rx.local : myRandomSubs(); }
function nextCars() {
  const k = randTrials().length;
  const base = ch.me ? parseInt(ch.me.sid, 10) % RAND_COUNTS.length : 0;
  return RAND_COUNTS[(base + k) % RAND_COUNTS.length];
}
function randomBoard(n) {
  const idx = Array.from({ length: 25 }, (_, i) => i);
  for (let k = 0; k < n; k++) { const j = k + Math.floor(Math.random() * (25 - k)); [idx[k], idx[j]] = [idx[j], idx[k]]; }
  const g = new Int8Array(25);
  for (let k = 0; k < n; k++) g[idx[k]] = k < n / 2 ? 1 : 2;
  return g;
}
function randReset() {
  if (rx.timer) { clearInterval(rx.timer); rx.timer = null; }
  Object.assign(rx, { phase: "ready", cars: 0, board: null, frames: null, fi: 0, result: null, guess: null, pending: null, msg: "", msgBad: false });
}
function randFinishNow() {
  if (rx.timer) { clearInterval(rx.timer); rx.timer = null; }
  if (rx.phase === "running") { rx.fi = rx.frames.length - 1; rx.phase = "done"; }
}
function randPlace() {
  rx.cars = nextCars();
  rx.board = randomBoard(rx.cars);
  rx.phase = "placed"; rx.msg = "";
  renderRandom();
}
async function randSend() {
  const sub = rx.pending;
  if (!sub) return;
  if (ch.practice) { rx.local.push(Object.assign({ createdAt: Date.now(), guess: rx.guess }, sub)); rx.pending = null; rx.msg = "연습 중이라 선생님 화면에는 모이지 않아요."; rx.msgBad = false; renderRandom(); return; }
  if (!ch.store || !ch.me) { rx.msg = "서버에 연결되지 않아 결과를 보내지 못했어요."; rx.msgBad = true; renderRandom(); return; }
  rx.msg = "결과를 보내는 중…"; rx.msgBad = false; renderRandom();
  try {
    await ch.store.addSubmission(sub);
    rx.pending = null; rx.msg = "결과가 선생님 화면에 모였어요."; rx.msgBad = false;
  } catch (e) { rx.msg = "결과를 보내지 못했어요. 인터넷 연결을 확인하고 '다시 보내기'를 눌러 주세요."; rx.msgBad = true; }
  renderRandom();
}
function randGuess(g) {
  if (rx.phase !== "placed") return;
  rx.guess = g;
  const c = classify(rx.board);
  rx.result = c;
  // 판정까지의 판 모습 (처음 + 라운드마다)
  const frames = [Int8Array.from(rx.board)];
  let cur = rx.board;
  for (let r = 1; r <= c.rounds; r++) { cur = playRound(cur, 5).next; frames.push(cur); }
  rx.frames = frames; rx.fi = 0;
  const board = serialize(rx.board);
  const gs = guesses(); gs[board] = g; ls.set(guessKey(), gs);
  rx.pending = { cls: ch.me ? ch.me.cls : "", sid: ch.me ? ch.me.sid : "", mode: "density", board, nr: c.nr, nb: c.nb, n: c.n, result: c.type, start: c.start, period: c.period, densityCars: c.n };
  randSend();
  rx.phase = "running";
  const stride = Math.max(1, Math.ceil((frames.length - 1) / 24));
  rx.timer = setInterval(() => {
    rx.fi = Math.min(frames.length - 1, rx.fi + stride);
    if (rx.fi >= frames.length - 1) { clearInterval(rx.timer); rx.timer = null; rx.phase = "done"; }
    renderRandom();
  }, 170);
  renderRandom();
}
function randNext() { randReset(); renderRandom(); }

function btn(label, cls, fn) { const b = document.createElement("button"); b.type = "button"; b.className = "btn " + cls; b.textContent = label; b.addEventListener("click", fn); return b; }
function renderRandom() {
  if ($("randOpen").hidden) return;
  const trials = randTrials();
  const cars = rx.phase === "ready" ? nextCars() : rx.cars;
  const no = trials.length + (rx.phase === "ready" || rx.pending || rx.phase === "placed" ? 1 : 0);
  $("randNo").textContent = `실험 ${Math.max(1, no)}`;
  $("randCars").innerHTML = `차 <b>${cars}대</b> <span class="meta">빨강 ${cars / 2} · 파랑 ${cars / 2} · 25칸 중 ${cars}칸 (밀도 ${(cars / 25).toFixed(2)})</span>`;
  // 판
  const g = rx.phase === "running" || rx.phase === "done" ? rx.frames[rx.fi] : rx.board;
  for (let i = 0; i < 25; i++) randCells[i].innerHTML = g && g[i] ? carSvg(g[i]) : "";
  // 상태와 버튼
  const st = $("randStatus"), act = $("randActions");
  act.innerHTML = "";
  if (rx.phase === "ready") {
    st.innerHTML = `이번 실험은 차 <b>${cars}대</b>예요. 버튼을 누르면 앱이 빨간 차 ${cars / 2}대와 파란 차 ${cars / 2}대를 아무렇게나 놓아요.`;
    act.append(btn("무작위로 놓기", "primary", randPlace));
  } else if (rx.phase === "placed") {
    st.innerHTML = "<b>고정일까, 반복일까?</b> 예상을 고르면 바로 돌려 봐요.";
    act.append(btn("고정일 것 같아요", "guess-fixed", () => randGuess("fixed")), btn("반복일 것 같아요", "guess-repeat", () => randGuess("repeat")));
  } else {
    const c = rx.result;
    const round = Math.min(rx.fi, c.rounds);
    if (rx.phase === "running") {
      st.innerHTML = `돌려 보는 중… <b>${round}</b>라운드`;
      act.append(btn("바로 결과 보기", "", () => { randFinishNow(); renderRandom(); }));
    } else {
      const repeat = c.type !== "fixed";
      const hit = (rx.guess === "fixed") === !repeat;
      st.innerHTML = `<span class="tag ${c.type}">${repeat ? "반복" : "고정"}</span> ${c.rounds}라운드에 판정 · 예상은 ${rx.guess === "fixed" ? "고정" : "반복"} → <b>${hit ? "맞았어요!" : "달랐어요"}</b>`;
      if (rx.pending && !ch.practice) act.append(btn("다시 보내기", "", randSend));
      act.append(btn("다음 실험", "primary", randNext));
    }
  }
  if (rx.msg) { const m = document.createElement("p"); m.className = "status-line" + (rx.msgBad ? " bad" : ""); m.textContent = rx.msg; act.append(m); }
  // 내 실험
  const gs = guesses();
  let hits = 0, known = 0;
  const rows = trials.map((s, k) => {
    const gu = ch.practice ? s.guess : gs[s.board];
    const rep = s.result !== "fixed";
    let mark = "";
    if (gu) { known++; const ok = (gu === "fixed") === !rep; if (ok) hits++; mark = ok ? "○" : "×"; }
    return `<tr><td>${k + 1}</td><td class="mono">${s.n}대</td><td>${gu ? (gu === "fixed" ? "고정" : "반복") : "–"}</td><td><span class="tag ${s.result}">${rep ? "반복" : "고정"}</span></td><td>${mark}</td></tr>`;
  });
  $("randBody").innerHTML = rows.length ? rows.reverse().join("") : '<tr><td colspan="5" class="empty" style="text-align:center">아직 실험하지 않았어요.</td></tr>';
  $("randCount").textContent = trials.length ? `모두 ${trials.length}번${known ? ` · 예상 적중 ${hits}/${known}` : ""}` : "";
}

/* ---------- 시작 ---------- */
renderWho();
route();
renderChallengeSide();
connect();
