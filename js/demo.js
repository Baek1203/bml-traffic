// 교사 화면의 시연 탭 — 규칙 익히기(3×3·4×4·5×5 배치 돌려 보기)와 큰 판 실험실, 탭 전환
import { PRESETS, parse, serialize } from "./core.js";
import { Simulator } from "./sim-ui.js";
import { initLab } from "./lab.js";

const $ = (id) => document.getElementById(id);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};

/* ---------- 규칙 익히기 ---------- */
const GROUP_NOTE = {
  e: "규칙 ④ 예제: '① ○× 표시하기'를 누르기 전에 학생들에게 어느 차가 갈 수 있는지 먼저 물어보세요. 앞차가 이번 차례에 떠나더라도 뒤차는 ×예요. 표시는 차례가 시작될 때의 판을 보고 하니까요. 그다음 '② ○ 차만 한꺼번에 옮기기'를 눌러요.",
  d: "시연 ①②③: 라운드가 끝날 때마다 아래 '라운드 기록'에 판 모습이 쌓여요. '같은 모습 자동으로 찾기'를 끄고 학생들이 먼저 같은 모습을 찾게 해 보세요.",
  p: "활동지 '손으로 돌려 보기'의 연습 가·나·다예요. 학생들이 판 위에서 직접 해 본 뒤 한 라운드씩 함께 돌리며 점검하세요.",
  q: "활동지 '4×4 예상하고 확인하기'의 배치예요. 학생들이 예상을 적은 뒤 함께 돌려 확인하세요.",
  c: "칸을 눌러 마음대로 배치해 보세요. 배치는 이 컴퓨터에 저장돼요."
};
const rules = { L: 3, preset: "d1" };
const rulesSim = new Simulator($("simRules"), {
  L: 3,
  checkStep: true,
  showCheckToggle: true,
  onEdit: (b) => {
    ls.set("bml-custom-" + rules.L, serialize(b));
    if (rules.preset !== "custom") { rules.preset = "custom"; renderPresetButtons(); }
  }
});
function presetList(L) { return PRESETS[L].concat([{ id: "custom", label: "직접 배치", board: null }]); }
function renderPresetButtons() {
  const box = $("rulesPresets");
  box.innerHTML = "";
  for (const p of presetList(rules.L)) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = p.label; b.dataset.preset = p.id;
    b.setAttribute("aria-pressed", p.id === rules.preset ? "true" : "false");
    b.addEventListener("click", () => loadRules(rules.L, p.id));
    box.append(b);
  }
  $("presetNote").textContent = GROUP_NOTE[rules.preset === "custom" ? "c" : rules.preset[0]] || "";
}
function loadRules(L, presetId) {
  rules.L = L; rules.preset = presetId;
  document.querySelectorAll("#rulesSize button").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.size === L ? "true" : "false"));
  let board;
  if (presetId === "custom") {
    const saved = ls.get("bml-custom-" + L, null);
    board = saved && saved.length === L * L ? parse(saved, L) : new Int8Array(L * L);
  } else board = parse(PRESETS[L].find((p) => p.id === presetId).board, L);
  rulesSim.load(board, L);
  renderPresetButtons();
}
document.querySelectorAll("#rulesSize button").forEach((b) => b.addEventListener("click", () => {
  const L = +b.dataset.size;
  loadRules(L, PRESETS[L].length ? PRESETS[L][0].id : "custom");
}));

/* ---------- 탭 전환 ---------- */
const TABS = ["dash", "rules", "lab"];
let lab = null;
function showView(name) {
  if (!TABS.includes(name)) name = "dash";
  for (const t of TABS) {
    $("tab-" + t).setAttribute("aria-selected", t === name ? "true" : "false");
    $("view-" + t).hidden = t !== name;
  }
  $("clsBox").hidden = name !== "dash";
  if (name !== "rules") rulesSim.stopAuto();
  if (name === "lab") { if (!lab) lab = initLab(); lab.show(); } else if (lab) lab.hide();
  try { history.replaceState(null, "", name === "dash" ? location.pathname : "#" + name); } catch (e) { }
}
TABS.forEach((t) => $("tab-" + t).addEventListener("click", () => showView(t)));

loadRules(3, "e1");
showView((location.hash || "").replace("#", ""));
