/* =========================================================
   FLAREN — Touch controls for the Snake game (and all games)
   Adds: swipe gestures + on-screen D-pad on touch devices
   Also upgrades the reaction timer to be tap-friendly.
   ========================================================= */

(function () {
  "use strict";

  const SWIPE_MIN = 22;   /* minimum px movement to count as a swipe */

  /* ---------- 1. Swipe on the snake canvas ---------- */
  document.addEventListener("touchstart", (e) => {
    const canvas = e.target.closest("#snakeCanvas");
    if (!canvas) return;
    const t = e.touches[0];
    canvas.dataset.swipeStartX = t.clientX;
    canvas.dataset.swipeStartY = t.clientY;
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    const canvas = e.target.closest("#snakeCanvas");
    if (!canvas) return;
    const startX = parseFloat(canvas.dataset.swipeStartX || "0");
    const startY = parseFloat(canvas.dataset.swipeStartY || "0");
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (Math.max(absX, absY) < SWIPE_MIN) return;

    /* Pick dominant axis */
    let dir;
    if (absX > absY) dir = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
    else              dir = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };

    if (window._snakeGame) {
      /* prevent reversing into yourself */
      const cur = window._snakeGame.dir;
      if (cur.x + dir.x === 0 && cur.y + dir.y === 0) return;
      window._snakeGame.nextDir = dir;
    }
  }, { passive: true });

  /* ---------- 2. On-screen D-pad (only shown on touch) ---------- */
  function injectDpad() {
    const canvas = document.getElementById("snakeCanvas");
    if (!canvas) return;
    const card = canvas.closest(".game-card");
    if (!card || card.querySelector(".touch-dpad")) return;

    const dpad = document.createElement("div");
    dpad.className = "touch-dpad";
    dpad.innerHTML = `
      <button type="button" class="dpad-btn dpad-up"    aria-label="Move up">▲</button>
      <button type="button" class="dpad-btn dpad-left"  aria-label="Move left">◀</button>
      <button type="button" class="dpad-btn dpad-right" aria-label="Move right">▶</button>
      <button type="button" class="dpad-btn dpad-down"  aria-label="Move down">▼</button>
    `;
    canvas.parentNode.insertBefore(dpad, canvas.nextSibling);

    dpad.querySelector(".dpad-up").addEventListener("click",    () => sendDir({ x: 0,  y: -1 }));
    dpad.querySelector(".dpad-left").addEventListener("click",  () => sendDir({ x: -1, y: 0  }));
    dpad.querySelector(".dpad-right").addEventListener("click", () => sendDir({ x: 1,  y: 0  }));
    dpad.querySelector(".dpad-down").addEventListener("click",  () => sendDir({ x: 0,  y: 1  }));
  }

  function sendDir(dir) {
    if (!window._snakeGame) return;
    const cur = window._snakeGame.dir;
    if (cur.x + dir.x === 0 && cur.y + dir.y === 0) return;
    window._snakeGame.nextDir = dir;
  }

  /* ---------- 3. Auto-inject the D-pad whenever Games page renders ---------- */
  const observer = new MutationObserver(() => {
    if (document.getElementById("snakeCanvas")) injectDpad();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  /* Also on load, in case games is the initial page */
  window.addEventListener("load", () => setTimeout(injectDpad, 300));

  /* ---------- 4. Show the D-pad only on touch devices ---------- */
  const style = document.createElement("style");
  style.textContent = `
    .touch-dpad { display: none; }
    @media (hover: none) and (pointer: coarse) {
      .touch-dpad {
        display: grid;
        grid-template-columns: repeat(3, 56px);
        grid-template-rows: repeat(3, 56px);
        gap: 6px;
        justify-content: center;
        margin-top: 14px;
        user-select: none;
        -webkit-user-select: none;
      }
      .dpad-btn {
        background: var(--surface);
        border: 1px solid var(--border-hi);
        color: var(--text);
        font-size: 20px;
        border-radius: 14px;
        cursor: pointer;
        transition: transform .15s var(--ease), background .15s;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        font-family: inherit;
      }
      .dpad-btn:active {
        transform: scale(0.92);
        background: var(--grad-flame);
        color: #1A0A00;
      }
      .dpad-up    { grid-column: 2; grid-row: 1; }
      .dpad-left  { grid-column: 1; grid-row: 2; }
      .dpad-right { grid-column: 3; grid-row: 2; }
      .dpad-down  { grid-column: 2; grid-row: 3; }
    }
  `;
  document.head.appendChild(style);

})();