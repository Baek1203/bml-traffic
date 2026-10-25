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
    { id: "q4", label: "4×4 ④", board: "RR.R ...B .B.. RB.B", note: "" }
  ],
  5: []
};

// 5×5 무작위 배치(빨강·파랑 같은 수)에서 고정되는 비율 — 차 수별로 4000번씩 미리 돌린 값
export const RANDOM_FIXED_5x5 = { 6: 0, 8: 0, 10: 0, 12: 0.003, 14: 0.105, 16: 0.488, 18: 0.867, 20: 0.979, 22: 0.994, 24: 1 };
