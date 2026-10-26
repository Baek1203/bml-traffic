// 큰 판 실험실 — 우리 반 5×5 무작위 실험에서 출발해 판을 키워 가며 밀도별 고정 비율을 보는 화면
// (교사가 직접 돌린 실험 기록은 이 컴퓨터에만 저장)
import { halfStep, RANDOM_FIXED_5x5 } from "./core.js";
import { attachZoom } from "./zoom.js";
import { onRandom } from "./shared.js";

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
const $ = (id) => document.getElementById(id);
const MAXR = 3000;
const SIZES = [5, 16, 32, 64];
const STATUS_TEXT = { ready: "대기", run: "진행 중", jam: "고정 (모두 멈춤)", flow: "계속 흐름", repeat: "반복", timeout: "3000라운드 끝" };

// 컴퓨터가 미리 해 본 결과: 밀도 0.20~0.60(0.02 간격)에서 모두 멈춘(고정) 비율
// 무작위 배치(빨강·파랑 반씩), 실험 한 번 최대 3000라운드, 16·32×32는 밀도마다 400번, 64×64는 200번
const BIG_FIXED = {
  16: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.035, 0.155, 0.405, 0.805, 0.938, 0.990, 0.993, 1, 0.998, 1],
  32: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.003, 0.045, 0.263, 0.680, 0.925, 0.980, 0.998, 0.998, 0.998, 1, 1, 1],
  64: [0, 0, 0, 0, 0, 0, 0, 0, 0.005, 0.090, 0.370, 0.675, 0.860, 0.950, 0.995, 0.995, 1, 1, 1, 1, 1]
};
function curve(L) {
  if (L === 5) return Object.keys(RANDOM_FIXED_5x5).map(Number).sort((a, b) => a - b).map((n) => [n / 25, RANDOM_FIXED_5x5[n]]);
  return BIG_FIXED[L].map((v, k) => [0.20 + k * 0.02, v]);
}
// 판 크기별 선 (판이 클수록 진하고 굵게)
const SERIES = { 5: { op: 0.4, w: 1.6 }, 16: { op: 0.6, w: 2 }, 32: { op: 0.8, w: 2.4 }, 64: { op: 1, w: 2.8 } };

export function initLab() {
  const saved = ls.get("bml-lab", {});
  const lab = {
    L: SIZES.includes(saved.L) ? saved.L : 5,
    p: typeof saved.p === "number" ? saved.p : 0.64,
    speed: 6, mode: "idle", paused: false, sim: null, raf: 0, acc: 0,
    batch: null, records: ls.get("bml-records", {}), finishFast: false,
    revealed: new Set([5]), cls: null
  };
  lab.revealed.add(lab.L);
  const canvas = $("labCanvas"), ctx = canvas.getContext("2d");
  let colors = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    colors = { cell: cs.getPropertyValue("--cell").trim(), grid: cs.getPropertyValue("--grid").trim(), r: cs.getPropertyValue("--car-r").trim(), b: cs.getPropertyValue("--car-b").trim(), re: cs.getPropertyValue("--car-r-edge").trim(), be: cs.getPropertyValue("--car-b-edge").trim() };
  }
  function sizeCanvas() {
    const box = canvas.parentElement.getBoundingClientRect();
    if (!box.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.max(100, Math.round(box.width * dpr));
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  }
  // 5×5는 차 수를 짝수(빨강·파랑 같은 수)로 맞춤
  function snapP(L, p) {
    if (L === 5) { const cars = Math.min(24, Math.max(2, 2 * Math.round(p * 25 / 2))); return cars / 25; }
    return Math.min(0.60, Math.max(0.10, Math.round(p * 100) / 100));
  }
  function newSim(L, p) {
    const n = L * L, cars = Math.round(p * n), nr = Math.floor(cars / 2), nb = cars - nr;
    const idx = new Int32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    for (let k = 0; k < cars; k++) { const j = k + Math.floor(Math.random() * (n - k)); const t = idx[k]; idx[k] = idx[j]; idx[j] = t; }
    const g = new Int8Array(n);
    for (let k = 0; k < nr; k++) g[idx[k]] = 1;
    for (let k = nr; k < cars; k++) g[idx[k]] = 2;
    return { L, p, g, t: new Int8Array(n), nr, nb, round: 0, streak: 0, ring: new Float32Array(100), ringN: 0, ringI: 0, status: "ready", lastV: null, seen: L <= 8 ? new Set([g.join("")]) : null };
  }
  function stepSim(s) {
    let tmp;
    const mr = halfStep(s.g, s.t, s.L, 1); tmp = s.g; s.g = s.t; s.t = tmp;
    const mb = halfStep(s.g, s.t, s.L, 2); tmp = s.g; s.g = s.t; s.t = tmp;
    s.round++;
    const v = (mr + mb) / (s.nr + s.nb);
    s.lastV = v; s.ring[s.ringI] = v; s.ringI = (s.ringI + 1) % 100; if (s.ringN < 100) s.ringN++;
    if (mr + mb === 0) { s.status = "jam"; return; }
    if (mr === s.nr && mb === s.nb) { if (++s.streak >= s.L) s.status = "flow"; }
    else s.streak = 0;
    // 작은 판은 같은 모습이 다시 나오면 반복으로 판정 (5×5 도전과 같은 기준)
    if (s.status === "run" && s.seen) { const k = s.g.join(""); if (s.seen.has(k)) s.status = "repeat"; else s.seen.add(k); }
    if (s.status === "run" && s.round >= MAXR) s.status = "timeout";
  }
  function meanV(s) {
    if (s.status === "jam") return 0;
    if (s.status === "flow") return 1;
    let t = 0; for (let k = 0; k < s.ringN; k++) t += s.ring[k];
    return s.ringN ? t / s.ringN : 0;
  }
  function record(s) {
    const k = s.L + "|" + s.p.toFixed(2);
    const r = lab.records[k] || { L: s.L, p: +s.p.toFixed(2), n: 0, jam: 0, vsum: 0 };
    r.n++; if (s.status === "jam") r.jam++; r.vsum += meanV(s);
    lab.records[k] = r;
    ls.set("bml-records", lab.records);
  }
  const CAR_R = [[14, 14], [56, 14], [86, 50], [56, 86], [14, 86]];
  const CAR_B = [[14, 14], [86, 14], [86, 56], [50, 86], [14, 56]];
  function drawCar(pts, x, y, c) {
    ctx.beginPath();
    pts.forEach(([a, b], k) => { const px = x + a / 100 * c, py = y + b / 100 * c; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function draw() {
    const s = lab.sim; if (!s || !canvas.width) return;
    const W = canvas.width, L = s.L, c = W / L;
    ctx.fillStyle = colors.cell; ctx.fillRect(0, 0, W, W);
    const g = s.g;
    if (c >= 24) {
      // 작은 판: 칸 선과 자동차 모양
      ctx.strokeStyle = colors.grid; ctx.lineWidth = Math.max(1, c * 0.012);
      for (let k = 1; k < L; k++) { ctx.beginPath(); ctx.moveTo(k * c, 0); ctx.lineTo(k * c, W); ctx.moveTo(0, k * c); ctx.lineTo(W, k * c); ctx.stroke(); }
      ctx.lineWidth = Math.max(1.5, c * 0.03);
      for (let i = 0; i < g.length; i++) {
        if (!g[i]) continue;
        const x = (i % L) * c, y = ((i / L) | 0) * c;
        ctx.fillStyle = g[i] === 1 ? colors.r : colors.b; ctx.strokeStyle = g[i] === 1 ? colors.re : colors.be;
        drawCar(g[i] === 1 ? CAR_R : CAR_B, x, y, c);
      }
      return;
    }
    const gap = c >= 9 ? Math.max(1, c * 0.08) : c >= 5 ? 0.6 : 0;
    ctx.fillStyle = colors.r;
    for (let i = 0; i < g.length; i++) if (g[i] === 1) { const x = i % L, y = (i / L) | 0; ctx.fillRect(x * c + gap, y * c + gap, c - 2 * gap, c - 2 * gap); }
    ctx.fillStyle = colors.b;
    for (let i = 0; i < g.length; i++) if (g[i] === 2) { const x = i % L, y = (i / L) | 0; ctx.fillRect(x * c + gap, y * c + gap, c - 2 * gap, c - 2 * gap); }
  }
  function renderStatus() {
    const s = lab.sim;
    $("lRound").textContent = s ? s.round : 0;
    const st = s ? s.status : "ready";
    $("lStatus").textContent = STATUS_TEXT[st];
    $("lStatus").className = "chip status-chip " + (st === "ready" ? "" : st === "repeat" ? "flow" : st);
    $("lMoving").textContent = s && s.lastV !== null ? "이번 라운드 움직인 차 " + Math.round(s.lastV * 100) + "%" : "움직인 차 —";
  }
  function renderControls() {
    const busy = lab.mode !== "idle";
    $("densityNum").textContent = lab.p.toFixed(2);
    const dens = $("density");
    if (lab.L === 5) { dens.min = "0.08"; dens.max = "0.96"; dens.step = "0.08"; }
    else { dens.min = "0.10"; dens.max = "0.60"; dens.step = "0.01"; }
    dens.value = lab.p.toFixed(2);
    const n = lab.L * lab.L, cars = Math.round(lab.p * n), nr = Math.floor(cars / 2);
    $("carCount").textContent = "차 " + cars + "대 · 빨강 " + nr + " · 파랑 " + (cars - nr) + " / " + n + "칸";
    document.querySelectorAll("#labSize button").forEach((b) => { b.setAttribute("aria-pressed", +b.dataset.size === lab.L ? "true" : "false"); b.disabled = busy; });
    dens.disabled = busy;
    // 5×5는 차 수로(2대·4대씩), 큰 판은 밀도로 조금씩
    document.querySelectorAll("[data-nudge]").forEach((b) => {
      b.disabled = busy;
      const v = parseFloat(b.dataset.nudge);
      b.textContent = lab.L === 5 ? (v < 0 ? "−" : "+") + (Math.abs(v) > 0.02 ? 4 : 2) + "대" : (v < 0 ? "−" : "+") + Math.abs(v).toFixed(2);
    });
    const next = SIZES[SIZES.indexOf(lab.L) + 1];
    $("btnGrow").disabled = busy || !next;
    $("btnGrow").textContent = next ? `판 키우기 → ${next}×${next}` : "가장 큰 판이에요";
    $("btnOne").disabled = busy; $("btnTen").disabled = busy;
    $("btnStop").hidden = !busy;
    $("btnPause").disabled = lab.mode !== "watch";
    $("btnFinish").disabled = lab.mode !== "watch";
    $("btnPause").textContent = lab.paused ? "계속" : "멈춤";
  }
  function preview() {
    lab.sim = newSim(lab.L, lab.p);
    draw(); renderStatus(); renderControls();
    ls.set("bml-lab", { L: lab.L, p: lab.p });
  }
  function setP(v) { lab.p = snapP(lab.L, v); preview(); }
  function setL(L) {
    lab.L = L; lab.revealed.add(L);
    lab.p = snapP(L, lab.p);
    $("progress").textContent = "";
    preview(); renderResults();
  }
  function startWatch() {
    lab.sim = newSim(lab.L, lab.p); lab.sim.status = "run";
    lab.mode = "watch"; lab.paused = false; lab.finishFast = false; lab.acc = 0;
    $("progress").textContent = "";
    renderControls(); loop();
  }
  function startBatch(total) {
    lab.batch = { total, done: 0, jam: 0 };
    lab.sim = null; lab.mode = "batch";
    $("progress").textContent = "실험 1 / " + total;
    renderControls(); loop();
  }
  function stopRun() {
    cancelAnimationFrame(lab.raf);
    lab.mode = "idle"; lab.paused = false; lab.batch = null;
    if (lab.sim && lab.sim.status === "run") lab.sim.status = "ready";
    $("progress").textContent = "실험을 그만뒀어요. 끝나지 않은 실험은 기록하지 않았어요.";
    renderStatus(); renderControls();
  }
  function loop() { cancelAnimationFrame(lab.raf); lab.raf = requestAnimationFrame(tick); }
  function tick() {
    if (lab.mode === "watch") {
      const s = lab.sim;
      if (!lab.paused) {
        const t0 = performance.now();
        if (lab.finishFast) { while (s.status === "run" && performance.now() - t0 < 14) stepSim(s); }
        else {
          // 작은 판은 천천히(5×5 보통: 1초에 약 4라운드), 큰 판은 화면 한 번에 여러 라운드
          lab.acc += lab.L <= 8 ? lab.speed / 90 : lab.speed;
          while (lab.acc >= 1 && s.status === "run") { stepSim(s); lab.acc -= 1; }
        }
      }
      draw(); renderStatus();
      if (s.status !== "run") {
        record(s); lab.mode = "idle";
        $("progress").textContent = "기록했어요: " + s.L + "×" + s.L + " · 밀도 " + s.p.toFixed(2) + " → " + STATUS_TEXT[s.status] + " (" + s.round + "라운드)";
        renderControls(); renderResults(); return;
      }
      loop(); return;
    }
    if (lab.mode === "batch") {
      const b = lab.batch, t0 = performance.now();
      while (performance.now() - t0 < 14) {
        if (!lab.sim || lab.sim.status !== "run") {
          if (lab.sim && lab.sim.status !== "ready") { record(lab.sim); b.done++; if (lab.sim.status === "jam") b.jam++; }
          if (b.done >= b.total) break;
          lab.sim = newSim(lab.L, lab.p); lab.sim.status = "run";
        }
        for (let k = 0; k < 20 && lab.sim.status === "run"; k++) stepSim(lab.sim);
      }
      draw(); renderStatus();
      $("progress").textContent = "실험 " + Math.min(b.done + 1, b.total) + " / " + b.total + " · 지금까지 고정 " + b.jam + "번";
      if (b.done >= b.total) {
        lab.mode = "idle";
        $("progress").textContent = "10번 실험 끝: " + lab.L + "×" + lab.L + " · 밀도 " + lab.p.toFixed(2) + "에서 고정 " + b.jam + "번";
        lab.batch = null; renderControls(); renderResults(); return;
      }
      if (b.done !== b.shown) { b.shown = b.done; renderResults(); }
      loop();
    }
  }

  const NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, text) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; }
  function renderResults() {
    const recs = Object.values(lab.records).sort((a, b) => a.L - b.L || a.p - b.p);
    $("recBody").innerHTML = recs.length ? recs.map((r) => "<tr><td>" + r.L + "×" + r.L + '</td><td class="mono">' + r.p.toFixed(2) + '</td><td class="mono">' + r.n + '</td><td class="mono">' + r.jam + '</td><td class="mono">' + (r.jam / r.n).toFixed(2) + '</td><td class="mono">' + Math.round(r.vsum / r.n * 100) + "%</td></tr>").join("")
      : '<tr><td colspan="6" class="empty" style="text-align:center">아직 직접 해 본 실험이 없어요.</td></tr>';
    const svg = $("labChart");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = 640, H = 380, l = 56, r = 14, t = 74, b = 54;
    const X0 = 0.20, X1 = 0.90;
    const X = (p) => l + (p - X0) / (X1 - X0) * (W - l - r);
    const Y = (v) => H - b - v * (H - t - b);
    for (let k = 0; k <= 4; k++) {
      const v = k / 4;
      svg.appendChild(el("line", { x1: l, x2: W - r, y1: Y(v), y2: Y(v), stroke: "var(--line)", "stroke-width": 1 }));
      svg.appendChild(el("text", { x: l - 10, y: Y(v) + 5, "text-anchor": "end", "font-size": 14, fill: "var(--muted)" }, v.toFixed(2)));
    }
    for (let k = 0; k <= 7; k++) {
      const p = X0 + k * 0.10;
      svg.appendChild(el("line", { x1: X(p), x2: X(p), y1: H - b, y2: H - b + 6, stroke: "var(--grid)", "stroke-width": 1 }));
      svg.appendChild(el("text", { x: X(p), y: H - b + 22, "text-anchor": "middle", "font-size": 14, fill: "var(--muted)" }, p.toFixed(1)));
    }
    svg.appendChild(el("line", { x1: l, x2: W - r, y1: H - b, y2: H - b, stroke: "var(--ink)", "stroke-width": 1.5 }));
    svg.appendChild(el("text", { x: (l + W - r) / 2, y: H - 6, "text-anchor": "middle", "font-size": 15, fill: "var(--ink)" }, "밀도 (차 수 ÷ 칸 수)"));
    svg.appendChild(el("text", { x: 0, y: 18, "font-size": 16, fill: "var(--ink)" }, "판 크기에 따른 고정(모두 멈춤) 비율"));

    // 범례: 우리 반 막대 + 보이는 판 크기들
    const legend = [];
    const cls = lab.cls;
    if (cls && cls.total) legend.push({ kind: "bar", label: cls.label + " 5×5 무작위 실험" });
    SIZES.filter((L) => lab.revealed.has(L)).forEach((L) => legend.push({ kind: "line", L, label: L + "×" + L + (L === 5 ? " 컴퓨터" : "") }));
    let lx = l, ly = 44;
    legend.forEach((it) => {
      if (lx > W - 120) { lx = l; ly += 22; }
      if (it.kind === "bar") svg.appendChild(el("rect", { x: lx, y: ly - 11, width: 13, height: 13, fill: "var(--ink)" }));
      else svg.appendChild(el("line", { x1: lx, x2: lx + 20, y1: ly - 4, y2: ly - 4, stroke: "var(--loop)", "stroke-opacity": SERIES[it.L].op, "stroke-width": SERIES[it.L].w + (it.L === lab.L ? 1 : 0), "stroke-dasharray": it.L === 5 ? "5 4" : "" }));
      const tx = el("text", { x: lx + (it.kind === "bar" ? 18 : 25), y: ly + 1, "font-size": 13.5, fill: it.L === lab.L ? "var(--ink)" : "var(--muted)", "font-weight": it.L === lab.L ? 600 : 400 }, it.label);
      svg.appendChild(tx);
      lx += (it.kind === "bar" ? 18 : 25) + [...it.label].reduce((a, ch) => a + (/[ㄱ-힝]/.test(ch) ? 14 : 8.2), 0) + 16;
    });

    // 우리 반 5×5 막대
    if (cls && cls.total && lab.revealed.has(5)) {
      const bw = (X(0.04) - X(0)) * 0.62;
      Object.keys(cls.by).map(Number).forEach((n) => {
        const d = cls.by[n]; if (!d.n) return;
        const v = d.fixed / d.n, x = X(n / 25);
        const rect = el("rect", { x: x - bw / 2, y: Y(v), width: bw, height: Math.max(1, Y(0) - Y(v)), fill: "var(--ink)", "fill-opacity": 0.85, rx: 2 });
        rect.appendChild(el("title", {}, `${cls.label} 5×5 · ${n}대(밀도 ${(n / 25).toFixed(2)}) · ${d.n}번 중 ${d.fixed}번 고정`));
        svg.appendChild(rect);
      });
    }
    // 컴퓨터가 미리 해 본 곡선 (판을 키울 때마다 하나씩)
    SIZES.filter((L) => lab.revealed.has(L)).forEach((L) => {
      const pts = curve(L).filter(([p]) => p >= X0 - 1e-9 && p <= X1 + 1e-9);
      if (L !== 5) pts.push([X1, 1]);
      const st = SERIES[L], cur = L === lab.L;
      svg.appendChild(el("polyline", { points: pts.map(([p, v]) => X(p) + "," + Y(v)).join(" "), fill: "none", stroke: "var(--loop)", "stroke-opacity": st.op, "stroke-width": st.w + (cur ? 1 : 0), "stroke-linejoin": "round", "stroke-dasharray": L === 5 ? "5 4" : "" }));
      // 직접 해 본 실험(이 컴퓨터) — 같은 판 크기의 점
      recs.filter((q) => q.L === L).forEach((q) => {
        const c = el("circle", { cx: X(q.p), cy: Y(q.jam / q.n), r: 5, fill: "var(--surface)", stroke: "var(--loop)", "stroke-opacity": Math.max(0.6, st.op), "stroke-width": 2.2 });
        c.appendChild(el("title", {}, L + "×" + L + " · 밀도 " + q.p.toFixed(2) + " · 직접 " + q.n + "번 중 " + q.jam + "번 고정"));
        svg.appendChild(c);
      });
    });
    const hint = $("labHint");
    if (hint) {
      const shown = SIZES.filter((L) => lab.revealed.has(L) && L !== 5);
      hint.textContent = !shown.length
        ? (cls && cls.total ? `막대는 ${cls.label}이 5×5에서 모은 결과예요. 점선은 컴퓨터가 5×5에서 4000번씩 해 본 결과예요. '판 키우기'를 누르면 더 큰 판의 결과가 겹쳐져요.` : "대시보드에서 무작위 실험 결과가 모이면 5×5 막대가 여기에 들어와요. '판 키우기'를 누르면 더 큰 판의 결과가 겹쳐져요.")
        : "판이 커질수록 고정이 시작되는 밀도가 낮아지고(곡선이 왼쪽으로), 흐름에서 고정으로 바뀌는 구간이 좁아져요(곡선이 가팔라져요).";
    }
  }

  document.querySelectorAll("#labSize button").forEach((b) => b.addEventListener("click", () => setL(+b.dataset.size)));
  $("btnGrow").addEventListener("click", () => { const next = SIZES[SIZES.indexOf(lab.L) + 1]; if (next) setL(next); });
  $("btnRevealReset").addEventListener("click", () => { lab.revealed = new Set([5, lab.L]); renderResults(); });
  $("density").addEventListener("input", (e) => setP(parseFloat(e.target.value)));
  document.querySelectorAll("[data-nudge]").forEach((b) => b.addEventListener("click", () => {
    const v = parseFloat(b.dataset.nudge);
    setP(lab.p + (lab.L === 5 ? Math.sign(v) * (Math.abs(v) > 0.02 ? 4 : 2) / 25 : v));
  }));
  document.querySelectorAll("#labSpeed button").forEach((b) => b.addEventListener("click", () => {
    lab.speed = +b.dataset.speed;
    document.querySelectorAll("#labSpeed button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
  }));
  attachZoom($("labZoom"), $("labChart"), "판 크기에 따른 고정 비율");
  $("btnOne").addEventListener("click", startWatch);
  $("btnTen").addEventListener("click", () => startBatch(10));
  $("btnStop").addEventListener("click", stopRun);
  $("btnPause").addEventListener("click", () => { lab.paused = !lab.paused; renderControls(); });
  $("btnFinish").addEventListener("click", () => { lab.finishFast = true; lab.paused = false; renderControls(); });
  $("btnCopy").addEventListener("click", () => {
    const recs = Object.values(lab.records).sort((a, b) => a.L - b.L || a.p - b.p);
    const text = ["판\t밀도\t실험 횟수\t고정 횟수\t고정 비율\t평균 움직인 비율(%)"].concat(recs.map((r) => r.L + "×" + r.L + "\t" + r.p.toFixed(2) + "\t" + r.n + "\t" + r.jam + "\t" + (r.jam / r.n).toFixed(2) + "\t" + Math.round(r.vsum / r.n * 100))).join("\n");
    const msg = $("copyMsg"), fb = $("copyFallback");
    const fallback = () => { fb.hidden = false; fb.value = text; fb.focus(); fb.select(); msg.textContent = "아래 글상자의 내용을 직접 복사해 주세요(Ctrl+C)."; };
    try { navigator.clipboard.writeText(text).then(() => { fb.hidden = true; msg.textContent = "표를 복사했어요. 스프레드시트에 붙여 넣을 수 있어요."; }, fallback); } catch (e) { fallback(); }
  });
  $("btnWipe").addEventListener("click", () => { $("wipeConfirm").hidden = false; });
  $("btnWipeNo").addEventListener("click", () => { $("wipeConfirm").hidden = true; });
  $("btnWipeYes").addEventListener("click", () => {
    lab.records = {}; ls.set("bml-records", {});
    $("wipeConfirm").hidden = true; $("copyMsg").textContent = "기록을 지웠어요."; renderResults();
  });

  readColors();
  const onTheme = () => { readColors(); draw(); };
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("resize", () => { sizeCanvas(); draw(); });
  onRandom((d) => { lab.cls = d; if (lab.visible) renderResults(); });

  return {
    show() { lab.visible = true; sizeCanvas(); lab.p = snapP(lab.L, lab.p); if (!lab.sim) preview(); else draw(); renderResults(); renderControls(); },
    hide() { lab.visible = false; if (lab.mode === "watch") { lab.paused = true; renderControls(); } }
  };
}
