// 학생 화면 — 첫 화면에서 반과 학번으로 들어가 무작위 실험
//   앱이 정한 차 수로 무작위 배치 → 고정·반복 예상 → 판정, 결과는 반 전체 그래프로 모임
//   점수는 연속으로 맞힌 최고 기록, 실험이 쌓이면 교사 화면의 우리 반 그래프가 점점 또렷해짐
import { serialize, classify, playRound, RAND_COUNTS, encodeGuess, decodeGuess, isHit, guessScore, randCountAt } from "./core.js";
import { carSvg } from "./sim-ui.js";

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
  subsAll: [],                           // 우리 반 제출
  store: null, failed: false, unsubSubs: null, connected: false
};
// 차 수는 학생마다 7가지(10~22대)를 한 바퀴에 한 번씩, 바퀴마다 순서를 섞어서 정함 → 한 사람도, 반 전체도 고르게
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


/* ---------- 화면: 들어가기 ↔ 무작위 실험 ---------- */
function randomOpen() { return ch.practice || !!(ch.config && ch.config.density && ch.config.density.on); }
function route() {
  const inside = !!ch.me || ch.practice;
  $("view-login").hidden = inside;
  $("view-random").hidden = !inside;
  const open = randomOpen();
  $("randClosed").hidden = open;
  $("randOpen").hidden = !open;
  if (!inside || !open) randFinishNow();
}

function visibleSubs() {
  if (!ch.me || !ch.config) return [];
  const since = (ch.config.resetAt || {})[ch.me.cls] || 0;
  return ch.subsAll.filter((s) => !s.hidden && s.createdAt >= since && s.mode === "density");
}
function myRandomSubs() { return ch.me ? visibleSubs().filter((s) => s.sid === ch.me.sid) : []; }

function logout() {
  ch.me = null; ch.practice = false; ls.set("bml-me", null);
  randReset();
  subscribeSubs(); renderWho(); route(); render();
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
  renderWho(); route(); render();
}
$("loginBtn").addEventListener("click", login);
$("loginSid").addEventListener("input", () => { $("loginErr").textContent = ""; });
$("loginSid").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("practiceBtn").addEventListener("click", () => { ch.practice = true; randReset(); renderWho(); route(); render(); });


function render() { renderLogin(); route(); renderRandom(); }

function subscribeSubs() {
  if (ch.unsubSubs) { ch.unsubSubs(); ch.unsubSubs = null; }
  ch.subsAll = [];
  if (!ch.store || !ch.me) return;
  ch.unsubSubs = ch.store.watchSubmissions(ch.me.cls, (list) => { ch.subsAll = list; render(); }, () => {});
}

async function connect() {
  try { ch.store = await import("./store.js"); }
  catch (e) { ch.store = null; ch.failed = true; render(); return; }
  ch.store.watchConfig((cfg) => {
    ch.config = cfg; ch.connected = true;
    if (ch.me && cfg.classes.length && !cfg.classes.includes(ch.me.cls)) { ch.me = null; ls.set("bml-me", null); subscribeSubs(); renderWho(); }
    render();
  }, () => { ch.connected = false; ch.failed = true; render(); });
  subscribeSubs();
}

/* ---------- ② 무작위 실험 ---------- */
function guessKey() { return ch.me ? `bml-rand-g-${ch.me.cls}-${ch.me.sid}` : "bml-rand-g-practice"; }
function guesses() { return ls.get(guessKey(), {}); }
function randTrials() { return ch.practice ? rx.local : myRandomSubs(); }
function nextCars() { return randCountAt(ch.me ? ch.me.sid : "0", randTrials().length); }
// 예상: 서버에 함께 저장된 값, 없으면 이 기기에 남은 값
function guessOf(s, gs) { return s.guess || decodeGuess(s) || (gs || guesses())[s.board] || null; }
// 우리 반 최고 점수(가장 긴 연속 적중)
function classTopScore() {
  if (ch.practice || !ch.me) return null;
  const by = new Map();
  visibleSubs().forEach((s) => { if (!by.has(s.sid)) by.set(s.sid, []); by.get(s.sid).push(s); });
  let top = 0;
  for (const list of by.values()) top = Math.max(top, guessScore(list).best);
  return top;
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
  Object.assign(rx, { phase: "ready", cars: 0, board: null, boardStr: null, frames: null, fi: 0, result: null, guess: null, pending: null, msg: "", msgBad: false });
}
function randFinishNow() {
  if (rx.timer) { clearInterval(rx.timer); rx.timer = null; }
  if (rx.phase === "running") { rx.fi = rx.frames.length - 1; rx.phase = "done"; }
}
function randPlace() {
  rx.cars = nextCars();
  rx.board = randomBoard(rx.cars);
  rx.boardStr = serialize(rx.board);
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
  rx.pending = { cls: ch.me ? ch.me.cls : "", sid: ch.me ? ch.me.sid : "", mode: "density", board, nr: c.nr, nb: c.nb, n: c.n, result: c.type, start: c.start, period: c.period, densityCars: encodeGuess(c.n, g) };
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
  // 돌려 보는 동안에는 이번 실험의 결과(점수·기록)를 아직 보여 주지 않음
  const trials = rx.phase === "running" && rx.boardStr ? randTrials().filter((s) => s.board !== rx.boardStr) : randTrials();
  const cars = rx.phase === "ready" ? nextCars() : rx.cars;
  const no = trials.length + (rx.phase === "done" && trials.some((x) => x.board === rx.boardStr) ? 0 : 1);
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
      const hit = isHit(rx.guess, c.type);
      const sc = guessScore(trials, (s) => guessOf(s));
      const before = guessScore(trials.filter((s) => s.board !== rx.boardStr), (s) => guessOf(s));
      st.innerHTML = `<span class="tag ${c.type}">${repeat ? "반복" : "고정"}</span> ${c.rounds}라운드에 판정 · 예상은 ${rx.guess === "fixed" ? "고정" : "반복"} → ` +
        (hit ? `<b class="hit">맞았어요! ${sc.streak}연속</b>${sc.best > before.best && sc.best >= 2 ? ` <b class="streak">최고 기록 ${sc.best}연속!</b>` : ""}`
          : `<b class="miss">아쉬워요, 이번엔 달랐어요</b>${before.streak >= 1 ? ` ${before.streak}연속이 끊겼어요. 다시 1부터!` : ""}`);
      if (rx.pending && !ch.practice) act.append(btn("다시 보내기", "", randSend));
      act.append(btn("다음 실험", "primary", randNext));
    }
  }
  if (rx.msg) { const m = document.createElement("p"); m.className = "status-line" + (rx.msgBad ? " bad" : ""); m.textContent = rx.msg; act.append(m); }
  // 내 실험
  const gs = guesses();
  const rows = trials.map((s, k) => {
    const gu = guessOf(s, gs);
    const rep = s.result !== "fixed";
    const ok = isHit(gu, s.result);
    return `<tr><td>${k + 1}</td><td class="mono">${s.n}대</td><td>${gu ? (gu === "fixed" ? "고정" : "반복") : "–"}</td><td><span class="tag ${s.result}">${rep ? "반복" : "고정"}</span></td><td>${ok === null ? "" : ok ? '<b class="hit">○</b>' : '<span class="miss">×</span>'}</td></tr>`;
  });
  $("randBody").innerHTML = rows.length ? rows.reverse().join("") : '<tr><td colspan="5" class="empty" style="text-align:center">아직 실험하지 않았어요.</td></tr>';
  const sc = guessScore(trials, (s) => guessOf(s, gs));
  $("randCount").textContent = trials.length ? `모두 ${trials.length}번 · 예상 적중 ${sc.hits}/${sc.known}` : "";
  // 점수
  const scoreEl = $("myScore");
  if (scoreEl.textContent !== String(sc.best)) {
    const up = +scoreEl.textContent < sc.best && rx.phase === "done";
    scoreEl.textContent = sc.best;
    if (up) { scoreEl.classList.remove("bump"); void scoreEl.offsetWidth; scoreEl.classList.add("bump"); }
  }
  $("myStreak").textContent = !sc.known ? "연속으로 맞힌 최고 기록이 점수예요" : sc.streak >= 1 ? `지금 ${sc.streak}번 연속으로 맞히는 중` : "지금 연속 0 · 다음 실험부터 다시!";
  const top = classTopScore();
  $("classTop").textContent = top === null ? "" : `우리 반 최고 ${top}점`;
  // 한 바퀴: 7가지 차 수를 한 번씩
  const L = RAND_COUNTS.length, k = trials.length - (rx.phase === "done" && trials.some((x) => x.board === rx.boardStr) ? 1 : 0);
  const c = Math.floor(Math.max(0, k) / L);
  const inCycle = trials.slice(c * L);
  const cur = rx.phase === "done" ? null : cars;
  $("cycleChips").innerHTML = RAND_COUNTS.map((n) => {
    const s = inCycle.find((x) => x.n === n);
    const ok = s ? isHit(guessOf(s, gs), s.result) : null;
    const cls = s ? (ok ? "done hit" : "done") : n === cur ? "now" : "";
    return `<span class="cchip ${cls}" title="${n}대">${n}<small>대</small>${s ? `<i>${ok ? "○" : ok === false ? "×" : ""}</i>` : ""}</span>`;
  }).join("");
  const doneN = inCycle.length;
  $("cycleNote").textContent = `${c + 1}바퀴째 · ${doneN}/${L} ` + (doneN >= L ? "· 한 바퀴 완성! 다음 실험부터 새 바퀴예요." : "· 일곱 가지 차 수를 한 번씩 하면 한 바퀴예요.");
}

/* ---------- 시작 ---------- */
renderWho();
render();
connect();
