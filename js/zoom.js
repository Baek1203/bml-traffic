// 그래프 크게 보기 — 같은 SVG를 전체 화면 창으로 옮겼다가 닫으면 제자리로 돌려놓는다.
// 요소를 복사하지 않고 옮기므로, 창이 열려 있는 동안에도 새 제출·새 실험이 그대로 다시 그려진다.
export function attachZoom(btn, svg, title) {
  let dlg = null, home = null, next = null;
  const close = () => { if (dlg && dlg.open) dlg.close(); };
  btn.addEventListener("click", () => {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "zoom";
      dlg.setAttribute("aria-label", title + " 크게 보기");
      const head = document.createElement("div");
      head.className = "zoom-head";
      const h = document.createElement("h2");
      h.textContent = title;
      const x = document.createElement("button");
      x.type = "button";
      x.className = "btn";
      x.textContent = "닫기 (Esc)";
      x.addEventListener("click", close);
      head.append(h, x);
      const body = document.createElement("div");
      body.className = "zoom-body";
      dlg.append(head, body);
      dlg.addEventListener("close", () => {
        if (home) home.insertBefore(svg, next && next.parentNode === home ? next : null);
        btn.focus();
      });
      // 창 바깥(어두운 부분)을 눌러도 닫힘
      dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
      document.body.append(dlg);
    }
    home = svg.parentNode;
    next = svg.nextSibling;
    dlg.querySelector(".zoom-body").append(svg);
    dlg.showModal();
  });
}
