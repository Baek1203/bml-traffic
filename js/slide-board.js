// 슬라이드 속 움직이는 판 — 차가 한 칸씩 미끄러져 가고, 판 끝을 넘는 차는 반대쪽 끝에서 들어온다.
//   <div class="bb" data-b=".BR BR. ..." data-mode="half" data-c="R" data-show="amber" data-after="arrive next" data-at="1000">
//   data-b    : 판 모습. 줄을 띄어 쓰고 R 빨간 차, B 파란 차, . 빈칸 (1×5 줄, 5×1 열도 됨)
//   data-mode : static(그대로) · half(한 차례) · round(1라운드) · flow(계속 돌리기) · random(무작위로 놓고 돌리기)
//   data-c    : half에서 움직일 색 R/B
//   data-show : 움직이기 전 표시 — amber(움직일 차에 노란 점선) · ox(○ 갈 수 있는 차, × 막힌 차)
//   data-after: 움직인 뒤 표시 — arrive(도착한 칸 노랗게) · next(다음 차례에 움직일 차 점선)
//   data-at   : 슬라이드 주기(section의 data-period) 안에서 움직이기 시작하는 때(ms)
//   data-rounds: 처음 판에서 미리 돌려 둘 라운드 수 (round에서 '앞 라운드까지 끝난 판')
//   data-until: flow에서 fixed면 멈추면 잠시 뒤 처음부터, data-max: flow에서 이 라운드 수만큼 돌고 처음부터
const NS = "http://www.w3.org/2000/svg";
const E = 0, R = 1, B = 2;
const C = 100;
const STOP = Symbol("stop");
const REDUCE = (() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();

export function parseBoard(str) {
  const rows = str.trim().split(/\s+/);
  const nr = rows.length, nc = rows[0].length;
  const g = new Int8Array(nr * nc);
  rows.forEach((row, r) => [...row].forEach((ch, c) => { g[r * nc + c] = ch === "R" ? R : ch === "B" ? B : E; }));
  return { nr, nc, g };
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.append(e);
  return e;
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// 슬라이드가 보이는 동안만 도는 시계: stop() 하면 기다리던 움직임이 모두 그친다
export function makeClock() {
  const ck = { alive: true, timers: new Set() };
  ck.wait = (ms) => new Promise((res, rej) => {
    if (!ck.alive) return rej(STOP);
    const t = setTimeout(() => { ck.timers.delete(t); ck.alive ? res() : rej(STOP); }, Math.max(0, ms));
    ck.timers.add(t);
  });
  ck.tween = (dur, f) => new Promise((res, rej) => {
    if (!ck.alive) return rej(STOP);
    if (REDUCE || dur <= 0) { f(1); return res(); }
    const t0 = performance.now();
    const step = (now) => {
      if (!ck.alive) return rej(STOP);
      const t = Math.min(1, (now - t0) / dur);
      f(t);
      if (t < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  ck.stop = () => { ck.alive = false; ck.timers.forEach(clearTimeout); ck.timers.clear(); };
  return ck;
}

const RED_PTS = "13.6,13.6 55.7,13.6 86.4,50 55.7,86.4 13.6,86.4";
const BLUE_PTS = "13.6,13.6 86.4,13.6 86.4,55.7 50,86.4 13.6,55.7";

export class AnimBoard {
  constructor(host) {
    this.host = host;
    const d = host.dataset;
    this.b = parseBoard(d.b);
    const { nr, nc } = this.b;
    this.g0 = this.b.g;
    for (let k = 0; k < (+d.rounds || 0); k++) this.g0 = this.apply(this.apply(this.g0, R), B);
    this.g = this.g0;
    const W = nc * C, H = nr * C;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: "100%", role: "img", "aria-label": host.getAttribute("aria-label") || "판" });
    const id = "clip" + Math.random().toString(36).slice(2, 9);
    el("rect", { x: 0, y: 0, width: W, height: H }, el("clipPath", { id }, el("defs", {}, svg)));
    el("rect", { x: 0, y: 0, width: W, height: H, fill: "#F9FBFA" }, svg);
    this.arriveL = el("g", {}, svg);
    const grid = el("g", { stroke: "#9AA4AA", "stroke-width": 2 }, svg);
    for (let c = 1; c < nc; c++) el("line", { x1: c * C, y1: 0, x2: c * C, y2: H }, grid);
    for (let r = 1; r < nr; r++) el("line", { x1: 0, y1: r * C, x2: W, y2: r * C }, grid);
    this.underL = el("g", {}, svg);
    this.carL = el("g", { "clip-path": `url(#${id})` }, svg);
    this.overL = el("g", {}, svg);
    el("rect", { x: 2, y: 2, width: W - 4, height: H - 4, fill: "none", stroke: "#1B2024", "stroke-width": 4 }, svg);
    host.append(svg);
    this.svg = svg;
    this.render(this.g0);
    this.showPre();
  }
  xy(i) { return [(i % this.b.nc) * C, ((i / this.b.nc) | 0) * C]; }
  front(i, color) {
    const { nr, nc } = this.b, r = (i / nc) | 0, c = i % nc;
    return color === R ? r * nc + (c + 1) % nc : ((r + 1) % nr) * nc + c;
  }
  plan(g, color) {
    const go = [], stop = [];
    for (let i = 0; i < g.length; i++) if (g[i] === color) (g[this.front(i, color)] === E ? go : stop).push(i);
    return { go, stop };
  }
  apply(g, color) {
    const n = Int8Array.from(g), { go } = this.plan(g, color);
    go.forEach((i) => { n[i] = E; });
    go.forEach((i) => { n[this.front(i, color)] = color; });
    return n;
  }
  car(color, i, parent) {
    const [x, y] = this.xy(i);
    const gEl = el("g", { transform: `translate(${x},${y})` }, parent || this.carL);
    el("polygon", { points: color === R ? RED_PTS : BLUE_PTS, fill: color === R ? "#C0392B" : "#5DA9E9", stroke: color === R ? "#82231A" : "#28649F", "stroke-width": 3.4, "stroke-linejoin": "round" }, gEl);
    return gEl;
  }
  render(g) {
    this.g = g;
    this.carL.replaceChildren();
    this.cars = new Map();
    for (let i = 0; i < g.length; i++) if (g[i]) this.cars.set(i, this.car(g[i], i));
  }
  clearMarks() { this.arriveL.replaceChildren(); this.underL.replaceChildren(); this.overL.replaceChildren(); this.cars.forEach((c) => c.removeAttribute("opacity")); }
  amber(color) {
    this.plan(this.g, color).go.forEach((i) => {
      const [x, y] = this.xy(i);
      el("rect", { x: x + 6.5, y: y + 6.5, width: 87, height: 87, rx: 8, fill: "none", stroke: "#E2A50E", "stroke-width": 5.5, "stroke-dasharray": "14 9" }, this.overL);
    });
  }
  ox(color) {
    const { go, stop } = this.plan(this.g, color);
    go.forEach((i) => {
      const [x, y] = this.xy(i), [fx, fy] = this.xy(this.front(i, color));
      el("rect", { x: fx + 9, y: fy + 9, width: 82, height: 82, rx: 9, fill: "none", stroke: "#1D7344", "stroke-width": 5, "stroke-dasharray": "12 8" }, this.underL);
      el("rect", { x: x + 3, y: y + 3, width: 94, height: 94, fill: "none", stroke: "#1D7344", "stroke-width": 6 }, this.underL);
      const b = el("g", { transform: `translate(${x + 78},${y + 22})` }, this.overL);
      el("circle", { r: 17, fill: "#FFFFFF", stroke: "#1D7344", "stroke-width": 3 }, b);
      el("circle", { r: 8.5, fill: "none", stroke: "#1D7344", "stroke-width": 5 }, b);
    });
    stop.forEach((i) => {
      const [x, y] = this.xy(i);
      const c = this.cars.get(i); if (c) c.setAttribute("opacity", 0.45);
      const b = el("g", { transform: `translate(${x + 78},${y + 22})` }, this.overL);
      el("circle", { r: 17, fill: "#B3261E" }, b);
      el("path", { d: "M-7 -7L7 7M7 -7L-7 7", stroke: "#FFFFFF", "stroke-width": 5, "stroke-linecap": "round" }, b);
    });
  }
  arrive(cells) {
    cells.forEach((i) => { const [x, y] = this.xy(i); el("rect", { x, y, width: C, height: C, fill: "#FFF0BF" }, this.arriveL); });
  }
  showPre() {
    const d = this.host.dataset, color = d.c === "B" ? B : R;
    this.clearMarks();
    if (d.show === "amber") this.amber(color);
    if (d.show === "ox" && d.mode === "static") this.ox(color);
  }
  // 한 차례: 갈 수 있는 차는 한 칸 미끄러지고(판 끝은 반대쪽으로), 막힌 차는 앞으로 가려다 멈칫
  async half(ck, color, dur = 650) {
    const { go, stop } = this.plan(this.g, color);
    if (!go.length && !stop.length) return [];
    const dx = color === R ? C : 0, dy = color === B ? C : 0;
    const moves = go.map((i) => {
      const j = this.front(i, color), [x0, y0] = this.xy(i), [x1, y1] = this.xy(j);
      const wrap = color === R ? x1 < x0 : y1 < y0;
      const ghost = wrap ? this.car(color, j) : null;
      return { node: this.cars.get(i), x0, y0, ghost, gx: x1 - dx, gy: y1 - dy };
    });
    const bumps = stop.map((i) => { const [x0, y0] = this.xy(i); return { node: this.cars.get(i), x0, y0 }; });
    await ck.tween(dur, (t) => {
      const e = ease(t), s = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 15;
      moves.forEach((m) => {
        m.node.setAttribute("transform", `translate(${m.x0 + dx * e},${m.y0 + dy * e})`);
        if (m.ghost) m.ghost.setAttribute("transform", `translate(${m.gx + dx * e},${m.gy + dy * e})`);
      });
      bumps.forEach((b) => b.node.setAttribute("transform", `translate(${b.x0 + (dx ? s : 0)},${b.y0 + (dy ? s : 0)})`));
    });
    const next = this.apply(this.g, color);
    this.render(next);
    return go.map((i) => this.front(i, color));
  }
  async fadeTo(ck, g, dur = 260) {
    await ck.tween(dur / 2, (t) => this.carL.setAttribute("opacity", 1 - t));
    this.render(g); this.showPre();
    if (this.host.dataset.mode === "random") this.clearMarks();
    await ck.tween(dur / 2, (t) => this.carL.setAttribute("opacity", t));
  }
  reset() { this.carL.setAttribute("opacity", 1); this.render(this.g0); this.showPre(); }

  async run(ck, period) {
    const d = this.host.dataset, mode = d.mode;
    if (mode === "flow") return this.flow(ck);
    if (mode === "random") return this.random(ck);
    if (mode !== "half" && mode !== "round") return;
    const at = +d.at || 900, color = d.c === "B" ? B : R;
    for (;;) {
      const t0 = performance.now();
      const left = () => period - (performance.now() - t0);
      if (mode === "half" && d.show === "ox") { await ck.wait(Math.max(0, at - 900)); this.ox(color); await ck.wait(at - (performance.now() - t0)); }
      else await ck.wait(at);
      this.clearMarks();
      let arrived;
      if (mode === "half") arrived = await this.half(ck, color, 700);
      else { await this.half(ck, R, 600); await ck.wait(140); await this.half(ck, B, 600); }
      const after = (d.after || "").split(/\s+/);
      if (after.includes("arrive")) this.arrive(arrived || []);
      if (after.includes("next")) this.amber(color === R ? B : R);
      await ck.wait(left() - 300);
      await this.fadeTo(ck, this.g0, 300);
    }
  }
  // 계속 돌리기: 빨강 차례 → 파랑 차례를 되풀이, 모두 멈추면 잠시 뒤 처음부터
  async flow(ck) {
    const d = this.host.dataset, gap = +d.gap || 140, dur = +d.dur || 480, max = +d.max || 0;
    for (;;) {
      await ck.wait(500);
      let rounds = 0;
      for (;;) {
        const a = this.plan(this.g, R).go.length; await this.half(ck, R, dur); await ck.wait(gap);
        const b = this.plan(this.g, B).go.length; await this.half(ck, B, dur); await ck.wait(gap);
        rounds++;
        if (!a && !b) { await ck.wait(1400); break; }
        if (max && rounds >= max) { await ck.wait(700); break; }
      }
      await this.fadeTo(ck, this.g0, 400);
    }
  }
  // 무작위로 놓기 → 돌려 보기 → 다시 놓기
  async random(ck) {
    const n = this.g.length, counts = (this.host.dataset.counts || "12 16 20").split(/\s+/).map(Number);
    for (let k = 0; ; k++) {
      const cars = Math.min(n, counts[k % counts.length]);
      const idx = Array.from({ length: n }, (_, i) => i);
      for (let a = n - 1; a > 0; a--) { const j = Math.floor(Math.random() * (a + 1)); [idx[a], idx[j]] = [idx[j], idx[a]]; }
      const g = new Int8Array(n);
      this.render(g); this.carL.setAttribute("opacity", 1);
      await ck.wait(500);
      for (let m = 0; m < cars; m++) {
        const i = idx[m], color = m % 2 ? B : R;
        g[i] = color;
        const node = this.car(color, i); this.cars.set(i, node);
        const [x, y] = this.xy(i);
        await ck.tween(120, (t) => { const s = 0.3 + 0.7 * ease(t); node.setAttribute("transform", `translate(${x + 50 * (1 - s)},${y + 50 * (1 - s)}) scale(${s})`); });
      }
      this.g = g;
      await ck.wait(700);
      for (let r = 0; r < 14; r++) {
        const a = this.plan(this.g, R).go.length; await this.half(ck, R, 440); await ck.wait(110);
        const b = this.plan(this.g, B).go.length; await this.half(ck, B, 440); await ck.wait(110);
        if (!a && !b) { await ck.wait(500); break; }
      }
      await ck.wait(1300);
      await ck.tween(300, (t) => this.carL.setAttribute("opacity", 1 - t));
    }
  }
}

// 슬라이드 하나의 판을 모두 움직이기 시작 → 멈출 때 쓸 시계를 돌려줌
export function startBoards(section, boards) {
  const ck = makeClock();
  const period = +section.dataset.period || 5000;
  boards.forEach((bd) => { bd.reset(); bd.run(ck, period).catch((e) => { if (e !== STOP) console.error(e); }); });
  return ck;
}
