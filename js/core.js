// BML 교통모형 계산 핵심 — 판은 Int8Array(0 빈칸, 1 빨간 차 →, 2 파란 차 ↓), L×L 칸, 끝과 끝이 이어짐
export const EMPTY = 0, RED = 1, BLUE = 2;

export function parse(str, L) {
  const s = String(str).replace(/\s/g, "");
  const g = new Int8Array(L * L);
  for (let i = 0; i < L * L; i++) g[i] = s[i] === "R" ? RED : s[i] === "B" ? BLUE : EMPTY;
  return g;
}
export function serialize(g) {
  let s = "";
  for (let i = 0; i < g.length; i++) s += g[i] === RED ? "R" : g[i] === BLUE ? "B" : ".";
  return s;
}
export function sizeOf(g) { return Math.round(Math.sqrt(g.length)); }
export function counts(g) {
  let nr = 0, nb = 0;
  for (let i = 0; i < g.length; i++) { if (g[i] === RED) nr++; else if (g[i] === BLUE) nb++; }
  return { nr, nb, n: nr + nb };
}
export function target(i, L, color) {
  const x = i % L, y = (i / L) | 0;
  return color === RED ? y * L + (x + 1) % L : ((y + 1) % L) * L + x;
}
export function willMove(g, L, i, color) {
  return g[i] === color && g[target(i, L, color)] === EMPTY;
}
// 같은 색 차가 동시에 한 칸씩 — dst에 결과를 쓰고 움직인 차 수를 돌려줌
export function halfStep(src, dst, L, color) {
  dst.set(src);
  let m = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== color) continue;
    const j = target(i, L, color);
    if (src[j] === EMPTY) { dst[i] = EMPTY; dst[j] = color; m++; }
  }
  return m;
}
// 1라운드(빨강 차례 → 파랑 차례)
export function playRound(g, L) {
  const mid = new Int8Array(g.length), next = new Int8Array(g.length);
  const mr = halfStep(g, mid, L, RED);
  const mb = halfStep(mid, next, L, BLUE);
  return { mid, next, mr, mb };
}
export function sameBoard(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// 같은 모습이 다시 나올 때까지 돌려서 판정
// type: fixed(고정) | free(모든 차가 쉬지 않고 움직이는 반복) | partial(몇 대는 기다리는 반복)
// start: 반복이 시작되는 라운드, period: 몇 라운드마다 반복, rounds: 판정이 나는 라운드(start+period)
export function classify(g0, maxRounds = 5000) {
  const L = sizeOf(g0);
  const { nr, nb } = counts(g0);
  let g = Int8Array.from(g0);
  const seen = new Map([[serialize(g), 0]]);
  const moves = [];
  for (let r = 1; r <= maxRounds; r++) {
    const { next, mr, mb } = playRound(g, L);
    moves.push([mr, mb]);
    g = next;
    const k = serialize(g);
    if (seen.has(k)) {
      const start = seen.get(k), period = r - start;
      const cyc = moves.slice(start);
      const type = period === 1 ? "fixed" : cyc.every(([a, b]) => a === nr && b === nb) ? "free" : "partial";
      return { type, start, period, rounds: r, nr, nb, n: nr + nb };
    }
    seen.set(k, r);
  }
  return { type: "unknown", start: null, period: null, rounds: maxRounds, nr, nb, n: nr + nb };
}

export const RESULT_TEXT = { fixed: "고정", free: "반복 (모두 움직임)", partial: "반복 (몇 대는 기다림)", unknown: "판정 못 함" };

// 5×5 도전: 빨간 차와 파란 차의 수가 같고, 두 색 모두 1대 이상
export const CHALLENGES = [
  { id: "minFixed", title: "고정, 가장 적게", short: "고정 최소", better: "min",
    desc: "모든 차가 끝내 멈추는 배치를 차를 가장 적게 써서 만들기",
    test: (s) => s.result === "fixed" },
  { id: "maxRepeat", title: "반복, 가장 많이", short: "반복 최대", better: "max",
    desc: "멈추지 않고 같은 모습이 되풀이되는 배치를 차를 가장 많이 써서 만들기",
    test: (s) => s.result === "free" || s.result === "partial" }
];
export function balanced(s) { return s.nr === s.nb && s.nr > 0; }
export function challengeIds(s) {
  if (!balanced(s)) return [];
  return CHALLENGES.filter((c) => c.test(s)).map((c) => c.id);
}
// 기록 목록에서 도전별 최고 기록 { id: { value, subs: [...] } }
export function bestRecords(subs) {
  const out = {};
  for (const c of CHALLENGES) {
    let best = null, list = [];
    for (const s of subs) {
      if (!challengeIds(s).includes(c.id)) continue;
      if (best === null || (c.better === "min" ? s.n < best : s.n > best)) { best = s.n; list = [s]; }
      else if (s.n === best) list.push(s);
    }
    out[c.id] = { value: best, subs: list };
  }
  return out;
}

// 수업용 배치 — 모두 시뮬레이션으로 결과를 확인함
export const PRESETS = {
  3: [
    { id: "e1", label: "예제 1", board: "... RR. ...", note: "줄 선 빨간 차: 맨 앞 차만 가요." },
    { id: "e2", label: "예제 2", board: ".B. .B. ...", note: "줄 선 파란 차: 맨 앞(아래) 차만 가요." },
    { id: "e3", label: "예제 3", board: "... RRR ...", note: "꽉 찬 줄: 아무도 못 가요." },
    { id: "e4", label: "예제 4", board: ".B. R.. ...", note: "빨강이 먼저 간 뒤의 판을 보고 파랑을 표시해요." },
    { id: "d1", label: "시연 ①", board: "BBR RR. B..", note: "4라운드까지 움직이다 멈춰요." },
    { id: "d2", label: "시연 ②", board: ".BR BR. ...", note: "3라운드마다 처음 모습이 돼요." },
    { id: "d3", label: "시연 ③", board: "BB. RR. ...", note: "5라운드마다 처음 모습이 되는데, 그동안 몇 대는 기다려요." },
    { id: "p1", label: "연습 가", board: "B.B BRR R..", note: "" },
    { id: "p2", label: "연습 나", board: "R.B BR. ...", note: "" },
    { id: "p3", label: "연습 다", board: "RR. BB. ...", note: "" }
  ],
  4: [
    { id: "q1", label: "4×4 ①", board: "B.R. RR.R BB.. B...", note: "" },
    { id: "q2", label: "4×4 ②", board: ".BR. BR.. .R.. R.BB", note: "" },
    { id: "q3", label: "4×4 ③", board: "..RR .... B.B. RBRB", note: "" },
    { id: "q4", label: "4×4 ④", board: "RR.R ...B .B.. RB.B", note: "" },
    { id: "e5", label: "예제 5", board: "RR.B ...B BRRR ..B.", note: "여러 경우가 섞인 판" }
  ],
  5: []
};

/* ---------- 무작위 실험 ---------- */
export const RAND_COUNTS = [10, 12, 14, 16, 18, 20, 22];
// 학생의 예상은 따로 칸이 없어서 densityCars에 함께 적음 (데이터베이스 규칙을 바꾸지 않으려고)
//   100 + 차 수 = '고정' 예상, 200 + 차 수 = '반복' 예상, 차 수만 = 예상 없음
export function encodeGuess(n, guess) { return (guess === "fixed" ? 100 : guess === "repeat" ? 200 : 0) + n; }
export function decodeGuess(s) {
  const d = s && s.densityCars;
  if (typeof d !== "number") return null;
  return d >= 200 ? "repeat" : d >= 100 ? "fixed" : null;
}
export function isHit(guess, result) { return guess ? (guess === "fixed") === (result === "fixed") : null; }
// 예상 점수: 맞힌 수, 예상한 수, 끝에서부터 연속으로 맞힌 수 (trials는 시간 순서)
export function guessScore(trials, getGuess = decodeGuess) {
  let hits = 0, known = 0, streak = 0;
  for (const s of trials) {
    const g = getGuess(s);
    if (!g) { streak = 0; continue; }
    known++;
    if (isHit(g, s.result)) { hits++; streak++; } else streak = 0;
  }
  return { hits, known, streak };
}
// 1판·2판: 교사가 '2판 시작'을 누른 때(config.density.round2[반], 밀리초)부터 그 반은 2판
export function round2Time(config, cls) {
  const d = config && config.density, r = d && d.round2 && d.round2[cls];
  const since = (config && config.resetAt && config.resetAt[cls]) || 0;
  return typeof r === "number" && r > since ? r : null;
}
export function roundOf(s, config) { const r = round2Time(config, s.cls); return r && s.createdAt >= r ? 2 : 1; }
// 학생마다 차 수 7가지를 한 바퀴에 한 번씩, 바퀴마다 순서를 섞어서 (학번으로 정해지는 순서라 새로고침해도 같음)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mix(h) {
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
function cycleOrder(seed, c) {
  const rnd = mulberry32(mix(mix(seed) + Math.imul(c + 1, 0x9E3779B9)));
  rnd();
  const arr = RAND_COUNTS.slice();
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
export function randCycle(sid, c) {
  const seed = parseInt(sid, 10) || 0;
  const order = cycleOrder(seed, c);
  // 바퀴가 바뀔 때 같은 차 수가 두 번 연달아 나오지 않게
  if (c > 0 && order[0] === cycleOrder(seed, c - 1)[RAND_COUNTS.length - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order;
}
export function randCountAt(sid, k) {
  const L = RAND_COUNTS.length;
  return randCycle(sid, Math.floor(k / L))[k % L];
}

// 5×5 무작위 배치(빨강·파랑 같은 수)에서 고정되는 비율 — 차 수별로 4000번씩 미리 돌린 값
export const RANDOM_FIXED_5x5 = { 2: 0, 4: 0, 6: 0, 8: 0, 10: 0, 12: 0.003, 14: 0.105, 16: 0.488, 18: 0.867, 20: 0.979, 22: 0.994, 24: 1 };
