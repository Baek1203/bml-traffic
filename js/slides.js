// 수업 슬라이드 — 1920×1080 무대를 화면에 맞춰 키우고, 키보드·클릭으로 넘김. 판 그림은 보이는 장에서만 움직임
import { AnimBoard, startBoards } from "./slide-board.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const sections = [...stage.querySelectorAll(":scope > section")];
const boards = new Map(sections.map((s) => [s, [...s.querySelectorAll(".bb")].map((h) => new AnimBoard(h))]));
let cur = -1, clock = null;

const titleOf = (s) => {
  const h = s.querySelector("h1, h2");
  return h ? h.textContent.replace(/\s+/g, " ").trim() : s.id;
};
$("jump").innerHTML = sections.map((s, i) => `<option value="${i}">${i + 1}. ${titleOf(s)}</option>`).join("");

function show(i) {
  i = Math.max(0, Math.min(sections.length - 1, i));
  if (i === cur) return;
  if (clock) clock.stop();
  if (cur >= 0) sections[cur].classList.remove("active");
  cur = i;
  const s = sections[i];
  s.classList.add("active");
  clock = startBoards(s, boards.get(s));
  $("count").textContent = `${i + 1} / ${sections.length}`;
  $("jump").value = String(i);
  $("progress").style.width = `${((i + 1) / sections.length) * 100}%`;
  const aside = s.querySelector("aside");
  $("notesText").innerHTML = aside ? aside.innerHTML : "<span class=\"muted\">이 장에는 메모가 없어요.</span>";
  if (location.hash.slice(1) !== s.id) history.replaceState(null, "", "#" + s.id);
}
const next = () => show(cur + 1), prev = () => show(cur - 1);
function restart() { const s = sections[cur]; if (clock) clock.stop(); clock = startBoards(s, boards.get(s)); }

function fromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const k = sections.findIndex((s) => s.id === id);
  return k >= 0 ? k : /^\d+$/.test(id) ? +id - 1 : 0;
}

function fit() {
  const sc = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${sc})`;
}
window.addEventListener("resize", fit);
fit();

function toggleNotes(force) {
  const n = $("notes");
  n.hidden = typeof force === "boolean" ? !force : !n.hidden;
  $("btnNotes").setAttribute("aria-pressed", n.hidden ? "false" : "true");
}
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

document.addEventListener("keydown", (e) => {
  if (e.target.closest("select, input, textarea")) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const k = e.key;
  if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter" || k === "ArrowDown") { e.preventDefault(); next(); }
  else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace" || k === "ArrowUp") { e.preventDefault(); prev(); }
  else if (k === "Home") show(0);
  else if (k === "End") show(sections.length - 1);
  else if (k === "f" || k === "F") toggleFull();
  else if (k === "n" || k === "N") toggleNotes();
  else if (k === "r" || k === "R") restart();
  else if (k === "Escape") toggleNotes(false);
});
$("viewport").addEventListener("click", (e) => { if (!e.target.closest(".controls, #notes")) next(); });
$("btnPrev").addEventListener("click", prev);
$("btnNext").addEventListener("click", next);
$("btnNotes").addEventListener("click", () => toggleNotes());
$("btnFull").addEventListener("click", toggleFull);
$("btnRestart").addEventListener("click", restart);
$("jump").addEventListener("change", (e) => { show(+e.target.value); e.target.blur(); });
window.addEventListener("hashchange", () => show(fromHash()));

// 마우스를 움직이면 조작 막대가 나타나고, 가만히 두면 숨음
let idle = null;
function wake() {
  document.body.classList.remove("idle");
  clearTimeout(idle);
  idle = setTimeout(() => { if (!document.querySelector(".controls:hover, .controls :focus")) document.body.classList.add("idle"); }, 2500);
}
document.addEventListener("mousemove", wake);
wake();

// 손으로 밀어서 넘기기
let sx = null;
$("viewport").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
$("viewport").addEventListener("touchend", (e) => {
  if (sx === null) return;
  const dx = e.changedTouches[0].clientX - sx; sx = null;
  if (Math.abs(dx) > 60) { e.preventDefault(); dx < 0 ? next() : prev(); }
});

document.fonts && document.fonts.ready.then(fit);
show(fromHash());
