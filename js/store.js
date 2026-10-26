// Firestore 읽기·쓰기를 한곳에 모음
//   config/main        : { classes: [반 이름], density: { on: 무작위 실험 열림, cars: 쓰지 않음 }, resetAt: { 반: 밀리초 }, updatedAt }
//   submissions/{자동} : { cls, sid, mode, size, board, nr, nb, n, result, start, period, densityCars, createdAt, hidden }
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, collection, onSnapshot, setDoc, addDoc, updateDoc,
  query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export const DEFAULT_CONFIG = { classes: [], density: { on: false, cars: 16 }, resetAt: {} };

function normConfig(d) {
  const c = Object.assign({}, DEFAULT_CONFIG, d || {});
  c.classes = Array.isArray(c.classes) ? c.classes.filter((x) => typeof x === "string") : [];
  c.density = Object.assign({ on: false, cars: 16 }, c.density || {});
  c.resetAt = c.resetAt || {};
  return c;
}

export function watchConfig(cb, onError) {
  return onSnapshot(doc(db, "config", "main"),
    (snap) => cb(normConfig(snap.exists() ? snap.data() : null)),
    (err) => onError && onError(err));
}

export function saveConfig(cfg) {
  const c = normConfig(cfg);
  return setDoc(doc(db, "config", "main"), {
    classes: c.classes, density: { on: !!c.density.on, cars: c.density.cars | 0 }, resetAt: c.resetAt, updatedAt: serverTimestamp()
  });
}

export function addSubmission(s) {
  const data = {
    cls: s.cls, sid: s.sid, mode: s.mode, size: 5, board: s.board,
    nr: s.nr, nb: s.nb, n: s.n, result: s.result, start: s.start, period: s.period,
    createdAt: serverTimestamp(), hidden: false
  };
  if (s.mode === "density") data.densityCars = s.densityCars;
  return addDoc(collection(db, "submissions"), data);
}

// cls가 없으면 모든 반
export function watchSubmissions(cls, cb, onError) {
  const col = collection(db, "submissions");
  const q = cls ? query(col, where("cls", "==", cls)) : col;
  return onSnapshot(q, (snap) => {
    const list = [];
    snap.forEach((d) => {
      const v = d.data();
      const t = v.createdAt && v.createdAt.toMillis ? v.createdAt.toMillis() : Date.now();
      list.push(Object.assign({ id: d.id }, v, { createdAt: t }));
    });
    list.sort((a, b) => a.createdAt - b.createdAt);
    cb(list);
  }, (err) => onError && onError(err));
}

export function setHidden(id, hidden) {
  return updateDoc(doc(db, "submissions", id), { hidden: !!hidden });
}
