// 교사 화면 안에서 대시보드(teacher.js)와 큰 판 실험실(lab.js)이 함께 쓰는 값
// 우리 반 무작위 실험 결과: { label, by: { 차수: { n, fixed } } }
const listeners = new Set();
let last = null;
export function publishRandom(d) { last = d; listeners.forEach((f) => f(d)); }
export function onRandom(f) { listeners.add(f); if (last) f(last); return () => listeners.delete(f); }
