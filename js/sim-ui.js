// 판 하나를 한 차례씩 돌려 보는 화면 조각 — 규칙 익히기, 5×5 도전, 교사 대시보드에서 함께 씀
import { RED, BLUE, EMPTY, counts, serialize, halfStep, willMove, target } from "./core.js";

const COLS = "가나다라마바사";
const SVG_NS = "http://www.w3.org/2000/svg";

// ① 표시하기 단계의 표시: ○ 갈 수 있는 차, × 막힌 차
const MARK_GO = '<span class="mk go" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11"/><circle class="o" cx="12" cy="12" r="5.6"/></svg></span>';
const MARK_STOP = '<span class="mk stop" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11"/><path d="M7.8 7.8l8.4 8.4M16.2 7.8l-8.4 8.4"/></svg></span>';

export function carSvg(color) {
  return color === RED
    ? '<svg viewBox="0 0 100 100" aria-hidden="true"><polygon class="car-r" points="14,14 56,14 86,50 56,86 14,86"/></svg>'
    : '<svg viewBox="0 0 100 100" aria-hidden="true"><polygon class="car-b" points="14,14 86,14 86,56 50,86 14,56"/></svg>';
}

// 작은 판 그림(SVG)
export function miniBoard(g, L, opts = {}) {
  const s = 10, W = L * s;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${W}`);
  svg.setAttribute("class", "mini" + (opts.className ? " " + opts.className : ""));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", opts.label || "판 그림");
  let html = `<rect x="0" y="0" width="${W}" height="${W}" class="mini-bg"/>`;
  for (let k = 1; k < L; k++) html += `<line x1="${k * s}" y1="0" x2="${k * s}" y2="${W}" class="mini-grid"/><line x1="0" y1="${k * s}" x2="${W}" y2="${k * s}" class="mini-grid"/>`;
  for (let i = 0; i < g.length; i++) {
    if (!g[i]) continue;
    const x = (i % L) * s, y = ((i / L) | 0) * s;
    const pts = g[i] === RED
      ? [[1.4, 1.4], [5.6, 1.4], [8.6, 5], [5.6, 8.6], [1.4, 8.6]]
      : [[1.4, 1.4], [8.6, 1.4], [8.6, 5.6], [5, 8.6], [1.4, 5.6]];
    html += `<polygon class="${g[i] === RED ? "car-r" : "car-b"}" points="${pts.map(([a, b]) => (x + a).toFixed(1) + "," + (y + b).toFixed(1)).join(" ")}"/>`;
  }
  svg.innerHTML = html;
  return svg;
}

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === "class") e.className = attrs[k];
    else if (k === "text") e.textContent = attrs[k];
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

export class Simulator {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = Object.assign({ editable: true, autoDetect: true, showDetectToggle: true, maxRounds: 400, halfDelay: 800, checkStep: false, showCheckToggle: false }, opts);
    // 두 단계 진행: ① 이번 차례 색의 차를 갈 수 있는 차(○)와 막힌 차(×)로 표시 → ② ○ 차만 한꺼번에 옮기기
    this.checkStep = !!this.opts.checkStep;
    this.marked = false;
    // 차가 한 칸씩 미끄러져 가는 움직임 (움직임 줄이기 설정이면 처음에 꺼 둠)
    let reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { }
    this.motion = opts.motion !== undefined ? !!opts.motion : !reduce;
    this.pendingTimer = null;
    this.lastMove = null;
    this.brush = RED;
    this.preview = true;
    this.autoDetect = this.opts.autoDetect;
    this.revealed = false;
    this.timer = null;
    this.build();
    this.load(opts.board || new Int8Array((opts.L || 3) ** 2), opts.L || 3);
  }

  build() {
    const r = this.root;
    r.classList.add("sim");
    r.innerHTML = "";
    this.colEdge = h("div", { class: "edge cols", style: "grid-row:1" });
    this.colEdge2 = h("div", { class: "edge cols", style: "grid-row:3" });
    this.rowEdge = h("div", { class: "edge rows", style: "grid-column:1;grid-row:2" });
    this.rowEdge2 = h("div", { class: "edge rows", style: "grid-column:3;grid-row:2" });
    this.boardEl = h("div", { class: "board", role: "group", "aria-label": "판" });
    this.frame = h("div", { class: "board-frame" }, this.colEdge, this.rowEdge, this.boardEl, this.rowEdge2, this.colEdge2);

    this.brushSeg = h("div", { class: "seg", role: "group", "aria-label": "놓을 것 고르기" });
    [[RED, '<span class="sw r"></span>빨간 차'], [BLUE, '<span class="sw b"></span>파란 차'], [EMPTY, "지우기"]].forEach(([v, label]) => {
      const b = h("button", { type: "button", "aria-pressed": v === RED ? "true" : "false" });
      b.innerHTML = label;
      b.addEventListener("click", () => { this.brush = v; this.brushSeg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); });
      this.brushSeg.append(b);
    });
    this.btnClear = h("button", { type: "button", class: "btn", text: "모두 지우기", onclick: () => this.clearBoard() });
    this.editRow = h("div", { class: "edit-row" }, h("span", { class: "label", text: "배치 고치기" }), this.brushSeg, this.btnClear);
    this.hint = h("p", { class: "hint" });

    this.roundNum = h("span", { text: "0" });
    this.nextChip = h("span", { class: "chip" });
    this.countLine = h("div", { class: "meta" });
    this.btnHalf = h("button", { type: "button", class: "btn primary", onclick: () => { this.stopAuto(); this.halfClick(); } });
    this.btnRound = h("button", { type: "button", class: "btn", text: "1라운드 진행", onclick: () => { this.stopAuto(); this.stepRoundShow(); } });
    this.btnAuto = h("button", { type: "button", class: "btn", text: "자동 재생", onclick: () => this.toggleAuto() });
    this.btnUndo = h("button", { type: "button", class: "btn", text: "되돌리기", onclick: () => this.undo() });
    this.btnToEnd = h("button", { type: "button", class: "btn", text: "판정까지 한 번에", onclick: () => { this.stopAuto(); this.runToVerdict(); } });
    this.btnReset = h("button", { type: "button", class: "btn", text: "처음 배치로", onclick: () => this.reset() });
    this.chkPreview = h("input", { type: "checkbox", checked: "" });
    this.chkPreview.addEventListener("change", () => { this.preview = this.chkPreview.checked; this.render(); });
    this.chkCheck = h("input", { type: "checkbox" });
    this.chkCheck.checked = this.checkStep;
    this.chkCheck.addEventListener("change", () => { this.stopAuto(); this.checkStep = this.chkCheck.checked; this.marked = false; this.render(); });
    this.previewLabel = h("label", { class: "toggle" }, this.chkPreview, document.createTextNode(" 이번 차례에 움직일 차 표시"));
    this.chkMotion = h("input", { type: "checkbox" });
    this.chkMotion.checked = this.motion;
    this.chkMotion.addEventListener("change", () => { this.motion = this.chkMotion.checked; });
    this.chkDetect = h("input", { type: "checkbox" });
    this.chkDetect.checked = this.autoDetect;
    this.chkDetect.addEventListener("change", () => { this.autoDetect = this.chkDetect.checked; this.revealed = false; this.render(); });
    this.verdictBox = h("div", { class: "verdict", "aria-live": "polite" });
    this.btnReveal = h("button", { type: "button", class: "btn", text: "같은 모습 확인하기", onclick: () => { this.revealed = true; this.render(); } });

    const counter = h("div", { class: "counter" }, h("small", { text: "라운드" }), this.roundNum);
    this.controls = h("div", { class: "sim-controls" },
      h("div", { class: "statline" }, counter, this.nextChip),
      this.countLine,
      h("div", { class: "btn-grid" }, this.btnHalf, this.btnRound, this.btnAuto, this.btnUndo, this.btnToEnd, this.btnReset),
      h("div", { class: "toggles" },
        this.opts.showCheckToggle ? h("label", { class: "toggle" }, this.chkCheck, document.createTextNode(" 두 단계로 진행 (① ○× 표시 → ② ○ 차만 옮기기)")) : null,
        this.previewLabel,
        h("label", { class: "toggle" }, this.chkMotion, document.createTextNode(" 차가 움직이는 모습 보기")),
        this.opts.showDetectToggle ? h("label", { class: "toggle" }, this.chkDetect, document.createTextNode(" 같은 모습 자동으로 찾기")) : null),
      this.verdictBox, this.btnReveal);

    this.stripCount = h("span", { class: "meta" });
    this.strip = h("div", { class: "strip", role: "list", "aria-label": "라운드 기록" });
    this.stripWrap = h("section", { class: "strip-wrap" },
      h("div", { class: "strip-head" }, h("h3", { text: "라운드 기록" }), this.stripCount),
      this.strip);

    this.markLine = h("p", { class: "mark-line", "aria-live": "polite" });
    r.append(h("div", { class: "sim-top" }, h("div", { class: "sim-board" }, this.frame, this.markLine, this.editRow, this.hint), this.controls), this.stripWrap);
  }

  load(board, L) {
    this.stopAuto();
    this.L = L;
    this.start = Int8Array.from(board);
    this.frame.style.setProperty("--n", L);
    this.colEdge.innerHTML = this.colEdge2.innerHTML = [...COLS.slice(0, L)].map((c) => `<span>${c}</span>`).join("");
    this.rowEdge.innerHTML = this.rowEdge2.innerHTML = Array.from({ length: L }, (_, i) => `<span>${i + 1}</span>`).join("");
    this.boardEl.innerHTML = "";
    this.cells = [];
    for (let i = 0; i < L * L; i++) {
      const b = h("button", { type: "button", class: "cell" });
      b.addEventListener("click", () => this.editCell(i));
      this.boardEl.append(b);
      this.cells.push(b);
    }
    this.reset();
  }

  reset() {
    this.stopAuto();
    this.marked = false;
    this.cur = Int8Array.from(this.start);
    this.half = 0;
    this.pendingMr = null;
    this.rounds = [{ board: Int8Array.from(this.start), mr: null, mb: null }];
    this.undoStack = [];
    this.arrived = new Set();
    this.verdict = null;
    this.revealed = false;
    this.render();
  }

  get editable() { return this.opts.editable && this.undoStack.length === 0; }

  editCell(i) {
    if (!this.editable) return;
    const v = this.start[i] === this.brush ? EMPTY : this.brush;
    this.start[i] = v;
    if (this.opts.onEdit) this.opts.onEdit(Int8Array.from(this.start));
    this.reset();
  }
  clearBoard() {
    if (!this.editable) return;
    this.start = new Int8Array(this.L * this.L);
    if (this.opts.onEdit) this.opts.onEdit(Int8Array.from(this.start));
    this.reset();
  }

  stepHalf() {
    const { n } = counts(this.cur);
    if (n === 0) return false;
    if (this.half === 0 && this.rounds.length > this.opts.maxRounds) return false;
    this.marked = false;
    this.undoStack.push({ cur: Int8Array.from(this.cur), half: this.half, pendingMr: this.pendingMr, len: this.rounds.length, verdict: this.verdict, arrived: new Set(this.arrived) });
    const color = this.half === 0 ? RED : BLUE;
    const moves = [], blocked = [];
    for (let i = 0; i < this.cur.length; i++) {
      if (this.cur[i] !== color) continue;
      if (willMove(this.cur, this.L, i, color)) moves.push({ from: i, to: target(i, this.L, color) });
      else blocked.push(i);
    }
    this.lastMove = { color, moves, blocked };
    const next = new Int8Array(this.cur.length);
    const m = halfStep(this.cur, next, this.L, color);
    this.arrived = new Set();
    for (let i = 0; i < next.length; i++) if (next[i] === color && this.cur[i] !== color) this.arrived.add(i);
    this.cur = next;
    if (this.half === 0) { this.pendingMr = m; this.half = 1; }
    else {
      this.rounds.push({ board: Int8Array.from(this.cur), mr: this.pendingMr, mb: m });
      this.pendingMr = null; this.half = 0;
      if (!this.verdict) this.verdict = this.findRepeat();
    }
    return true;
  }
  stepRound() {
    if (!this.stepHalf()) return false;
    if (this.half === 1) this.stepHalf();
    return true;
  }
  // 한 차례 진행 + 화면 갱신 + (켜져 있으면) 움직임
  stepHalfShow(dur) {
    if (!this.stepHalf()) { this.render(); return false; }
    this.render();
    this.animateLast(dur || 450);
    return true;
  }
  // ① 표시하기: 이번 차례 색의 차마다 바로 앞 칸을 보고 ○(갈 수 있음) / ×(막힘) 표시
  markNow() {
    if (counts(this.cur).n === 0) return false;
    if (this.half === 0 && this.rounds.length > this.opts.maxRounds) return false;
    this.marked = true;
    this.render();
    return true;
  }
  halfClick() {
    if (this.checkStep && !this.marked) this.markNow();
    else this.stepHalfShow();
  }
  // 두 단계 진행일 때 1라운드: 표시 → 옮기기 → 표시 → 옮기기를 차례로 보여 줌
  runSteps(steps) {
    const next = () => {
      this.pendingTimer = null;
      const st = steps.shift();
      if (!st) return;
      const ok = st === "mark" ? this.markNow() : this.stepHalfShow();
      if (!ok || !steps.length) return;
      const wait = st === "mark" ? 1000 : (this.motion ? 650 : 350);
      this.pendingTimer = setTimeout(next, wait);
    };
    next();
  }
  // 1라운드: 빨강 차례를 보여 준 뒤 움직임이 끝나면 파랑 차례
  stepRoundShow() {
    if (this.checkStep) {
      const steps = [];
      if (!this.marked) steps.push("mark");
      steps.push("move");
      if (this.half === 0) steps.push("mark", "move");
      this.runSteps(steps);
      return true;
    }
    if (!this.stepHalfShow()) return false;
    if (this.half === 1) {
      const wait = this.motion ? 450 + 150 : 0;
      this.pendingTimer = setTimeout(() => { this.pendingTimer = null; this.stepHalfShow(); }, wait);
    }
    return true;
  }
  animateLast(dur) {
    const mv = this.lastMove;
    if (!this.motion || !mv || !(mv.moves.length || mv.blocked.length) || typeof Element.prototype.animate !== "function") return;
    const L = this.L, red = mv.color === RED;
    const a = this.cells[0].getBoundingClientRect();
    const stepX = L > 1 ? this.cells[1].getBoundingClientRect().left - a.left : a.width;
    const stepY = L > 1 ? this.cells[L].getBoundingClientRect().top - a.top : a.height;
    if (!stepX || !stepY) return;
    const opts = { duration: dur, easing: "cubic-bezier(.45,0,.25,1)" };
    const off = red ? `translateX(${-stepX}px)` : `translateY(${-stepY}px)`;
    const out = red ? `translateX(${stepX}px)` : `translateY(${stepY}px)`;
    for (const { from, to } of mv.moves) {
      const car = this.cells[to].querySelector("svg");
      if (car) car.animate([{ transform: off }, { transform: "none" }], opts);
      // 판 끝을 넘어가는 차: 끝 칸에서 밖으로 빠져나가는 모습도 함께 (반대쪽 끝에서는 밖에서 들어옴)
      const wrap = red ? to % L < from % L : to < from;
      if (wrap) {
        this.cells[from].insertAdjacentHTML("beforeend", carSvg(mv.color));
        const ghost = this.cells[from].lastElementChild;
        ghost.classList.add("ghost");
        const an = ghost.animate([{ transform: "none" }, { transform: out }], opts);
        an.onfinish = () => ghost.remove();
      }
    }
    // 앞이 막힌 차: 앞으로 가려다 막혀서 제자리로 돌아오는 모습
    const d = (red ? stepX : stepY) * 0.16;
    const ax = red ? "translateX" : "translateY";
    for (const i of mv.blocked) {
      const car = this.cells[i].querySelector("svg");
      if (!car) continue;
      car.animate([
        { transform: "none", offset: 0, easing: "cubic-bezier(.5,0,.9,.6)" },
        { transform: `${ax}(${d}px)`, offset: 0.38, easing: "ease-out" },
        { transform: `${ax}(${-d * 0.3}px)`, offset: 0.62, easing: "ease-in-out" },
        { transform: `${ax}(${d * 0.12}px)`, offset: 0.82 },
        { transform: "none", offset: 1 }
      ], { duration: dur });
    }
  }

  findRepeat() {
    const k = this.rounds.length - 1, cur = this.rounds[k].board;
    for (let j = 0; j < k; j++) {
      const b = this.rounds[j].board;
      let same = true;
      for (let i = 0; i < b.length; i++) if (b[i] !== cur[i]) { same = false; break; }
      if (!same) continue;
      const period = k - j;
      const { nr, nb } = counts(cur);
      const cyc = this.rounds.slice(j + 1, k + 1);
      const type = period === 1 ? "fixed" : cyc.every((r) => r.mr === nr && r.mb === nb) ? "free" : "partial";
      return { type, start: j, at: k, period };
    }
    return null;
  }
  runToVerdict() {
    this.marked = false;
    let guard = 0;
    while (!this.verdict && guard++ < this.opts.maxRounds * 2) { if (!this.stepHalf()) break; }
    if (this.half === 1) this.stepHalf();
    this.render();
  }
  undo() {
    this.stopAuto();
    if (this.marked) { this.marked = false; this.render(); return; }
    const s = this.undoStack.pop();
    if (!s) return;
    this.cur = s.cur; this.half = s.half; this.pendingMr = s.pendingMr; this.verdict = s.verdict; this.arrived = s.arrived;
    this.rounds.length = s.len;
    this.render();
  }
  stopAuto() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
    if (this.btnAuto) this.btnAuto.textContent = "자동 재생";
  }
  toggleAuto() {
    if (this.timer) { this.stopAuto(); return; }
    this.btnAuto.textContent = "멈춤";
    const delay = this.L >= 5 ? Math.round(this.opts.halfDelay * 0.7) : this.opts.halfDelay;
    const dur = Math.min(450, Math.round(delay * 0.6));
    this.timer = setInterval(() => {
      if (this.checkStep && !this.marked) { if (!this.markNow()) this.stopAuto(); return; }
      const had = !!this.verdict;
      if (!this.stepHalfShow(dur)) { this.stopAuto(); return; }
      if (!had && this.verdict && this.autoDetect) this.stopAuto();
    }, delay);
  }

  showVerdict() { return this.verdict && (this.autoDetect || this.revealed); }

  render() {
    const L = this.L, color = this.half === 0 ? RED : BLUE;
    const ed = this.editable;
    const marked = this.checkStep && this.marked;
    this.boardEl.classList.toggle("editable", ed);
    const dest = new Set();
    let nGo = 0, nStop = 0;
    if (marked) for (let i = 0; i < L * L; i++) {
      if (this.cur[i] !== color) continue;
      if (willMove(this.cur, L, i, color)) { nGo++; dest.add(target(i, L, color)); } else nStop++;
    }
    for (let i = 0; i < L * L; i++) {
      const c = this.cells[i], v = this.cur[i];
      const mk = marked && v === color ? (willMove(this.cur, L, i, color) ? "go" : "stop") : "";
      c.innerHTML = (v ? carSvg(v) : "") + (mk === "go" ? MARK_GO : mk === "stop" ? MARK_STOP : "");
      c.classList.toggle("mk-go", mk === "go");
      c.classList.toggle("mk-stop", mk === "stop");
      c.classList.toggle("dest", dest.has(i));
      c.classList.toggle("arrived", !marked && this.arrived.has(i));
      c.classList.toggle("go", this.preview && !this.checkStep && willMove(this.cur, L, i, color));
      c.setAttribute("aria-label", `${((i / L) | 0) + 1}줄 ${COLS[i % L]}열 ${v === RED ? "빨간 차" : v === BLUE ? "파란 차" : "빈칸"}`);
      c.tabIndex = ed ? 0 : -1;
    }
    const { nr, nb, n } = counts(this.cur);
    const round = this.rounds.length - 1;
    this.roundNum.textContent = round;
    this.nextChip.innerHTML = `<span class="sw ${color === RED ? "r" : "b"}"></span>다음: ${color === RED ? "빨강" : "파랑"} 차례`;
    this.countLine.textContent = `빨강 ${nr} · 파랑 ${nb} · 차 ${n}대 / ${L * L}칸 · 밀도 ${(n / (L * L)).toFixed(2)}`;
    const cname = color === RED ? "빨강" : "파랑";
    this.btnHalf.textContent = !this.checkStep ? `${cname} 차례 진행` : this.marked ? "② ○ 차만 한꺼번에 옮기기" : `① ${cname} 차 ○× 표시하기`;
    this.previewLabel.hidden = this.checkStep;
    this.markLine.hidden = !this.checkStep || n === 0;
    if (marked) this.markLine.innerHTML = `<b>${cname} 차례</b> ○ 갈 수 있는 차 <b>${nGo}</b>대 · × 막힌 차 <b>${nStop}</b>대 → ○ 차만 한꺼번에 한 칸씩`;
    else this.markLine.textContent = `${cname} 차례 · 먼저 ${cname} 차마다 바로 앞 칸을 봐요. 비어 있으면 ○, 막혀 있으면 ×. 표시할 때는 아직 아무 차도 옮기지 않아요.`;
    const empty = n === 0;
    [this.btnHalf, this.btnRound, this.btnAuto, this.btnToEnd].forEach((b) => { b.disabled = empty; });
    this.btnToEnd.disabled = empty || !!this.verdict && this.half === 0;
    this.btnUndo.disabled = this.undoStack.length === 0;
    this.btnReset.disabled = this.undoStack.length === 0;
    this.editRow.hidden = !ed;
    this.hint.textContent = !this.opts.editable ? "" : ed
      ? (empty ? "판이 비어 있어요. 칸을 눌러 차를 놓아 보세요." : "칸을 누르면 차를 놓거나 뺄 수 있어요. 돌리기 시작하면 고칠 수 없어요.")
      : "배치를 고치려면 '처음 배치로'를 누르세요.";

    // 판정
    const vb = this.verdictBox, v = this.verdict;
    if (this.showVerdict()) {
      const from = v.start === 0 ? "처음" : `${v.start}라운드`;
      vb.hidden = false;
      vb.className = "verdict " + v.type;
      if (v.type === "fixed") vb.innerHTML = `<strong>고정</strong>${v.at}라운드에 아무 차도 움직이지 못했어요. ${v.at}라운드 모습이 ${from} 모습과 같고, 이제 영원히 이 모습이에요.`;
      else if (v.type === "free") vb.innerHTML = `<strong>반복 · 모두 움직임</strong>${v.at}라운드 모습이 ${from} 모습과 같아요. 이제부터 ${v.period}라운드마다 같은 모습이 되풀이되고, 모든 차가 쉬지 않고 움직여요.`;
      else vb.innerHTML = `<strong>반복 · 몇 대는 기다림</strong>${v.at}라운드 모습이 ${from} 모습과 같아요. 이제부터 ${v.period}라운드마다 같은 모습이 되풀이되는데, 그동안 몇몇 차는 앞이 막혀 기다려요.`;
    } else vb.hidden = true;
    this.btnReveal.hidden = !(this.verdict && !this.autoDetect && !this.revealed);

    // 라운드 기록 띠
    const mark = this.showVerdict() ? this.verdict : null;
    this.strip.innerHTML = "";
    this.rounds.forEach((r, k) => {
      const tile = h("div", { class: "tile", role: "listitem" });
      if (k === round) tile.classList.add("now");
      if (mark && (k === mark.start || k === mark.at)) tile.classList.add("match", mark.type);
      tile.append(h("div", { class: "tile-label", text: k === 0 ? "처음" : `${k}라운드` }));
      tile.append(miniBoard(r.board, L, { label: `${k === 0 ? "처음" : k + "라운드"} 판` }));
      tile.append(h("div", { class: "tile-moves", text: k === 0 ? " " : `움직임 ${r.mr}·${r.mb}` }));
      if (mark && k === mark.at) tile.append(h("div", { class: "tile-badge", text: `= ${mark.start === 0 ? "처음" : mark.start + "라운드"}` }));
      this.strip.append(tile);
    });
    if (this.half === 1) {
      const tile = h("div", { class: "tile pending", role: "listitem" },
        h("div", { class: "tile-label", text: `${round + 1}라운드` }),
        h("div", { class: "tile-wait", text: "빨강 차례까지 진행" }),
        h("div", { class: "tile-moves", text: `빨강 ${this.pendingMr}대 움직임` }));
      this.strip.append(tile);
    }
    this.stripCount.textContent = round === 0 ? "라운드가 끝날 때마다 판 모습이 여기에 쌓여요. '움직임 2·1'은 빨강 2대, 파랑 1대가 움직였다는 뜻이에요." : `${round}라운드까지 · '움직임 2·1'은 빨강 2대, 파랑 1대가 움직였다는 뜻`;
    this.strip.scrollTop = this.strip.scrollHeight;

    if (this.opts.onChange) this.opts.onChange(this.state());
  }

  state() {
    const { nr, nb, n } = counts(this.start);
    return { L: this.L, start: Int8Array.from(this.start), board: serialize(this.start), nr, nb, n, verdict: this.verdict, round: this.rounds.length - 1, editing: this.editable };
  }
}
