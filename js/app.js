// 학생 화면 — 첫 화면에서 반과 학번으로 들어가 5×5 기록 도전(배치 만들기, 판정, 제출)
import { parse, serialize, classify, CHALLENGES, challengeIds, bestRecords, balanced, RESULT_TEXT } from "./core.js";
import { Simulator, miniBoard } from "./sim-ui.js";

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
  store: null, failed: false, unsubSubs: null, connected: false, sending: false
};
const savedCh = ls.get("bml-challenge-board", null);
const chSim = new Simulator($("simChallenge"), {
  L: 5, maxRounds: 600,
  board: savedCh && savedCh.length === 25 ? parse(savedCh, 5) : new Int8Array(25),
  onEdit: (b) => ls.set("bml-challenge-board", serialize(b)),
  onChange: (st) => { ch.state = st; renderChallengeSide(); }
});

/* ---------- 화면: 들어가기 ↔ 도전 ---------- */
function route() {
  const inside = !!ch.me || ch.practice;
  $("view-login").hidden = inside;
  $("view-challenge").hidden = !inside;
  if (!inside) chSim.stopAuto();
}

function visibleSubs() {
  if (!ch.me || !ch.config) return [];
  const since = (ch.config.resetAt || {})[ch.me.cls] || 0;
  return ch.subsAll.filter((s) => !s.hidden && s.createdAt >= since);
}
function mySubs() { return visibleSubs().filter((s) => s.sid === ch.me.sid); }

function logout() {
  ch.me = null; ch.practice = false; ls.set("bml-me", null);
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
  subscribeSubs();
  renderWho(); route(); renderChallengeSide();
}
$("loginBtn").addEventListener("click", login);
$("loginSid").addEventListener("input", () => { $("loginErr").textContent = ""; });
$("loginSid").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("practiceBtn").addEventListener("click", () => { ch.practice = true; renderWho(); route(); renderChallengeSide(); });

function renderChallengeSide() {
  renderLogin();
  // 도전 카드
  const subs = visibleSubs();
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
      else lines.push("기록이 아니어도 괜찮아요. 제출한 배치는 모두 반 전체 밀도 조사에 쓰여요.");
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
    t.innerHTML = `<span class="tag ${s.result}">${s.result === "fixed" ? "고정" : "반복"}</span> ${s.n}대${s.mode === "density" ? '<br><span class="meta">밀도 조사</span>' : ""}`;
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

/* ---------- 시작 ---------- */
renderWho();
route();
renderChallengeSide();
connect();
