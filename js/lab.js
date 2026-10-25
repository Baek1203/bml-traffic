// 큰 판 실험실 — 무작위 배치를 여러 번 돌려 밀도별 정체 비율을 보는 화면 (기록은 이 컴퓨터에만)
import { halfStep } from "./core.js";

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
const $ = (id) => document.getElementById(id);
const MAXR = 3000;
const STATUS_TEXT = { ready: "대기", run: "진행 중", jam: "정체", flow: "계속 흐름", timeout: "3000라운드 끝" };

export function initLab() {
  const saved = ls.get("bml-lab", {});
  const lab = {
    L: [16, 32, 64].includes(saved.L) ? saved.L : 32,
    p: typeof saved.p === "number" ? saved.p : 0.30,
    speed: 6, mode: "idle", paused: false, sim: null, raf: 0,
    batch: null, records: ls.get("bml-records", {}), finishFast: false
  };
  const canvas = $("labCanvas"), ctx = canvas.getContext("2d");
  let colors = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    colors = { cell: cs.getPropertyValue("--cell").trim(), r: cs.getPropertyValue("--car-r").trim(), b: cs.getPropertyValue("--car-b").trim() };
  }
  function sizeCanvas() {
    const box = canvas.parentElement.getBoundingClientRect();
    if (!box.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.max(100, Math.round(box.width * dpr));
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  }
  function newSim(L, p) {
    const n = L * L, cars = Math.round(p * n), nr = Math.floor(cars / 2), nb = cars - nr;
    const idx = new Int32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    for (let k = 0; k < cars; k++) { const j = k + Math.floor(Math.random() * (n - k)); const t = idx[k]; idx[k] = idx[j]; idx[j] = t; }
    const g = new Int8Array(n);
    for (let k = 0; k < nr; k++) g[idx[k]] = 1;
    for (let k = nr; k < cars; k++) g[idx[k]] = 2;
    return { L, p, g, t: new Int8Array(n), nr, nb, round: 0, streak: 0, ring: new Float32Array(100), ringN: 0, ringI: 0, status: "ready", lastV: null };
  }
  function stepSim(s) {
    let tmp;
    const mr = halfStep(s.g, s.t, s.L, 1); tmp = s.g; s.g = s.t; s.t = tmp;
    const mb = halfStep(s.g, s.t, s.L, 2); tmp = s.g; s.g = s.t; s.t = tmp;
    s.round++;
    const v = (mr + mb) / (s.nr + s.nb);
    s.lastV = v; s.ring[s.ringI] = v; s.ringI = (s.ringI + 1) % 100; if (s.ringN < 100) s.ringN++;
    if (mr + mb === 0) s.status = "jam";
    else if (mr === s.nr && mb === s.nb) { if (++s.streak >= s.L) s.status = "flow"; }
    else s.streak = 0;
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
  function draw() {
    const s = lab.sim; if (!s || !canvas.width) return;
    const W = canvas.width, L = s.L, c = W / L;
    ctx.fillStyle = colors.cell; ctx.fillRect(0, 0, W, W);
    const gap = c >= 9 ? Math.max(1, c * 0.08) : c >= 5 ? 0.6 : 0;
    const g = s.g;
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
    $("lStatus").className = "chip status-chip " + (st === "ready" ? "" : st);
    $("lMoving").textContent = s && s.lastV !== null ? "이번 라운드 움직인 차 " + Math.round(s.lastV * 100) + "%" : "움직인 차 —";
  }
  function renderControls() {
    const busy = lab.mode !== "idle";
    $("densityNum").textContent = lab.p.toFixed(2);
    $("density").value = lab.p.toFixed(2);
    const n = lab.L * lab.L, cars = Math.round(lab.p * n), nr = Math.floor(cars / 2);
    $("carCount").textContent = "차 " + cars + "대 · 빨강 " + nr + " · 파랑 " + (cars - nr) + " / " + n + "칸";
    document.querySelectorAll("#labSize button").forEach((b) => { b.setAttribute("aria-pressed", +b.dataset.size === lab.L ? "true" : "false"); b.disabled = busy; });
    $("density").disabled = busy;
    document.querySelectorAll("[data-nudge]").forEach((b) => { b.disabled = busy; });
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
  function setP(v) { lab.p = Math.min(0.60, Math.max(0.10, Math.round(v * 100) / 100)); preview(); }
  function startWatch() {
    lab.sim = newSim(lab.L, lab.p); lab.sim.status = "run";
    lab.mode = "watch"; lab.paused = false; lab.finishFast = false;
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
        const n = lab.finishFast ? 1e9 : lab.speed;
        for (let k = 0; k < n && s.status === "run"; k++) { stepSim(s); if (lab.finishFast && performance.now() - t0 > 14) break; }
      }
      draw(); renderStatus();
      if (s.status !== "run") {
        record(s); lab.mode = "idle";
        $("progress").textContent = "기록했어요: 밀도 " + s.p.toFixed(2) + " → " + STATUS_TEXT[s.status] + " (" + s.round + "라운드)";
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
      $("progress").textContent = "실험 " + Math.min(b.done + 1, b.total) + " / " + b.total + " · 지금까지 정체 " + b.jam + "번";
      if (b.done >= b.total) {
        lab.mode = "idle";
        $("progress").textContent = "10번 실험 끝: 밀도 " + lab.p.toFixed(2) + "에서 정체 " + b.jam + "번";
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
      : '<tr><td colspan="6" class="empty" style="text-align:center">아직 기록이 없어요. 밀도를 고르고 실험 10번을 눌러 보세요.</td></tr>';
    const svg = $("labChart");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = 640, H = 360, l = 58, r = 18, t = 52, b = 52;
    const X = (p) => l + (p - 0.10) / 0.50 * (W - l - r);
    const Y = (v) => H - b - v * (H - t - b);
    for (let k = 0; k <= 5; k++) {
      const v = k / 5;
      svg.appendChild(el("line", { x1: l, x2: W - r, y1: Y(v), y2: Y(v), stroke: "var(--line)", "stroke-width": 1 }));
      svg.appendChild(el("text", { x: l - 10, y: Y(v) + 4, "text-anchor": "end", "font-size": 12, fill: "var(--muted)" }, v.toFixed(1)));
    }
    for (let k = 0; k <= 10; k++) {
      const p = 0.10 + k * 0.05;
      svg.appendChild(el("line", { x1: X(p), x2: X(p), y1: H - b, y2: H - b + (k % 2 ? 4 : 7), stroke: "var(--grid)", "stroke-width": 1 }));
      if (k % 2 === 0) svg.appendChild(el("text", { x: X(p), y: H - b + 22, "text-anchor": "middle", "font-size": 12, fill: "var(--muted)" }, p.toFixed(2)));
    }
    svg.appendChild(el("line", { x1: l, x2: W - r, y1: H - b, y2: H - b, stroke: "var(--ink)", "stroke-width": 1.5 }));
    svg.appendChild(el("text", { x: (l + W - r) / 2, y: H - 10, "text-anchor": "middle", "font-size": 13, fill: "var(--ink)" }, "밀도"));
    svg.appendChild(el("text", { x: l, y: 18, "font-size": 13, fill: "var(--ink)" }, "정체 비율 (정체 횟수 ÷ 실험 횟수)"));
    if (!recs.length) {
      svg.appendChild(el("text", { x: (l + W - r) / 2, y: (t + H - b) / 2, "text-anchor": "middle", "font-size": 14, fill: "var(--muted)" }, "실험을 하면 여기에 점이 찍혀요"));
      return;
    }
    const sizes = [...new Set(recs.map((x) => x.L))].sort((a, c) => (a === lab.L ? 1 : 0) - (c === lab.L ? 1 : 0) || a - c);
    const legend = [];
    for (const L of sizes) {
      const cur = L === lab.L;
      const pts = recs.filter((x) => x.L === L);
      const col = cur ? "var(--ink)" : "var(--grid)";
      const g = el("g", {});
      if (pts.length > 1) g.appendChild(el("polyline", { points: pts.map((q) => X(q.p) + "," + Y(q.jam / q.n)).join(" "), fill: "none", stroke: col, "stroke-width": cur ? 2.5 : 1.5, "stroke-dasharray": cur ? "" : "5 4" }));
      for (const q of pts) {
        const c = el("circle", { cx: X(q.p), cy: Y(q.jam / q.n), r: cur ? 5.5 : 4.5, fill: cur ? col : "var(--surface)", stroke: col, "stroke-width": 2 });
        c.appendChild(el("title", {}, L + "×" + L + " · 밀도 " + q.p.toFixed(2) + " · " + q.n + "번 중 " + q.jam + "번 정체"));
        g.appendChild(c);
      }
      svg.appendChild(g);
      legend.push({ L, cur, col });
    }
    let lx = W - r;
    legend.sort((a, c) => c.L - a.L).forEach((it) => {
      const label = it.L + "×" + it.L + (it.cur ? " (지금 판)" : "");
      const w = [...label].reduce((a, ch) => a + (/[ㄱ-힝]/.test(ch) ? 12.5 : 7.4), 0) + 26;
      lx -= w;
      svg.appendChild(el("circle", { cx: lx + 6, cy: 36, r: 5, fill: it.cur ? it.col : "var(--surface)", stroke: it.col, "stroke-width": 2 }));
      svg.appendChild(el("text", { x: lx + 16, y: 40, "font-size": 12, fill: "var(--muted)" }, label));
      lx -= 6;
    });
  }

  document.querySelectorAll("#labSize button").forEach((b) => b.addEventListener("click", () => { lab.L = +b.dataset.size; preview(); renderResults(); }));
  $("density").addEventListener("input", (e) => setP(parseFloat(e.target.value)));
  document.querySelectorAll("[data-nudge]").forEach((b) => b.addEventListener("click", () => setP(lab.p + parseFloat(b.dataset.nudge))));
  document.querySelectorAll("#labSpeed button").forEach((b) => b.addEventListener("click", () => {
    lab.speed = +b.dataset.speed;
    document.querySelectorAll("#labSpeed button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
  }));
  $("btnOne").addEventListener("click", startWatch);
  $("btnTen").addEventListener("click", () => startBatch(10));
  $("btnStop").addEventListener("click", stopRun);
  $("btnPause").addEventListener("click", () => { lab.paused = !lab.paused; renderControls(); });
  $("btnFinish").addEventListener("click", () => { lab.finishFast = true; lab.paused = false; renderControls(); });
  $("btnCopy").addEventListener("click", () => {
    const recs = Object.values(lab.records).sort((a, b) => a.L - b.L || a.p - b.p);
    const text = ["판\t밀도\t실험 횟수\t정체 횟수\t정체 비율\t평균 움직인 비율(%)"].concat(recs.map((r) => r.L + "×" + r.L + "\t" + r.p.toFixed(2) + "\t" + r.n + "\t" + r.jam + "\t" + (r.jam / r.n).toFixed(2) + "\t" + Math.round(r.vsum / r.n * 100))).join("\n");
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

  return {
    show() { sizeCanvas(); if (!lab.sim) preview(); else draw(); renderResults(); renderControls(); },
    hide() { if (lab.mode === "watch") { lab.paused = true; renderControls(); } }
  };
}
