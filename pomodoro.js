/* =========================================================
   FLAREN — Pomodoro Focus Timer
   Self-contained module. Only needs:
     - a #pageContent element (provided by app.js)
     - window.FlarenToken + window.FlarenAPI for optional sync
   ========================================================= */

(function () {
  const POMO_KEY = "flaren_pomodoro_v1";

  const DEFAULT_POMO = {
    focusMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    longBreakEvery: 4,        /* after 4 focus sessions, take a long break */
    autoStartBreak: true,
    autoStartFocus: false,
    sound: true,
    todayFocusCount: 0,
    todayFocusMinutes: 0,
    lastDay: "",              /* YYYY-MM-DD for daily reset */
    streak: 0
  };

  let pomo = loadPomo();
  let phase = "focus";        /* "focus" | "short" | "long" */
  let remaining = pomo.focusMin * 60;
  let running = false;
  let interval = null;

  /* ---------- storage ---------- */
  function loadPomo() {
    try {
      const raw = localStorage.getItem(POMO_KEY);
      if (!raw) return { ...DEFAULT_POMO };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_POMO, ...parsed };
    } catch { return { ...DEFAULT_POMO }; }
  }
  function savePomo() {
    localStorage.setItem(POMO_KEY, JSON.stringify(pomo));
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function rollDayIfNeeded() {
    const k = todayKey();
    if (pomo.lastDay !== k) {
      /* increment streak if yesterday was productive */
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yk = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
      if (pomo.lastDay === yk && pomo.todayFocusCount > 0) {
        pomo.streak = (pomo.streak || 0) + 1;
      } else if (pomo.todayFocusCount === 0) {
        pomo.streak = 0;
      }
      pomo.todayFocusCount = 0;
      pomo.todayFocusMinutes = 0;
      pomo.lastDay = k;
      savePomo();
    }
  }

  /* ---------- helpers ---------- */
  const $ = (sel) => document.querySelector(sel);
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmt(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${pad(m)}:${pad(s)}`;
  }
  function phaseSeconds(p) {
    if (p === "focus") return pomo.focusMin * 60;
    if (p === "short") return pomo.shortBreakMin * 60;
    return pomo.longBreakMin * 60;
  }
  function phaseLabel(p) {
    if (p === "focus") return "Focus";
    if (p === "short") return "Short break";
    return "Long break";
  }

  /* ---------- sound ---------- */
  let _ctx = null;
  function chime(kind) {
    if (!pomo.sound) return;
    try {
      if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (_ctx.state === "suspended") _ctx.resume();
      const now = _ctx.currentTime;

      let tones;
      if (kind === "focus-end") {
        tones = [{ f: 660, t: 0.00, d: 0.20 }, { f: 880, t: 0.22, d: 0.20 }, { f: 1320, t: 0.44, d: 0.30 }];
      } else if (kind === "break-end") {
        tones = [{ f: 1320, t: 0.00, d: 0.15 }, { f: 990, t: 0.18, d: 0.15 }, { f: 660, t: 0.36, d: 0.25 }];
      } else {
        tones = [{ f: 880, t: 0.00, d: 0.12 }];
      }
      tones.forEach(t => {
        const o = _ctx.createOscillator();
        const g = _ctx.createGain();
        o.type = "sine";
        o.frequency.value = t.f;
        g.gain.setValueAtTime(0.0001, now + t.t);
        g.gain.exponentialRampToValueAtTime(0.28, now + t.t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t.t + t.d);
        o.connect(g); g.connect(_ctx.destination);
        o.start(now + t.t); o.stop(now + t.t + t.d + 0.05);
      });
    } catch {}
  }

  function notify(title, body) {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const n = new Notification(title, { body: body || "", icon: "images/logo.png", tag: "flaren-pomodoro" });
        n.onclick = () => { window.focus(); n.close(); };
      }
    } catch {}
  }

  /* ---------- timer loop ---------- */
  function tick() {
    if (!running) return;
    remaining -= 1;
    render();
    if (remaining <= 0) {
      completePhase();
    }
  }

  function startTimer() {
    if (running) return;
    running = true;
    if (interval) clearInterval(interval);
    interval = setInterval(tick, 1000);
    render();
  }
  function pauseTimer() {
    running = false;
    if (interval) clearInterval(interval);
    render();
  }
  function resetTimer() {
    running = false;
    if (interval) clearInterval(interval);
    remaining = phaseSeconds(phase);
    render();
  }

  function completePhase() {
    running = false;
    if (interval) clearInterval(interval);

    if (phase === "focus") {
      pomo.todayFocusCount = (pomo.todayFocusCount || 0) + 1;
      pomo.todayFocusMinutes = (pomo.todayFocusMinutes || 0) + pomo.focusMin;
      savePomo();
            /* trigger the pop animation on the counter */
      setTimeout(() => {
        const el = document.querySelector(".pomo-stat-num");
        if (el) { el.classList.add("pop"); setTimeout(() => el.classList.remove("pop"), 600); }
      }, 30);
      chime("focus-end");
      notify("🎯 Focus session complete", "Time for a break. Well done.");
      /* choose break type */
      if (pomo.todayFocusCount % pomo.longBreakEvery === 0) phase = "long";
      else phase = "short";
      remaining = phaseSeconds(phase);
      render();
      if (pomo.autoStartBreak) startTimer();
    } else {
      chime("break-end");
      notify("☕ Break over", "Ready for the next focus session?");
      phase = "focus";
      remaining = phaseSeconds(phase);
      render();
      if (pomo.autoStartFocus) startTimer();
    }
  }

  function skipPhase() {
    completePhase();
  }

  /* ---------- rendering ---------- */
  function render() {
    const el = document.getElementById("pomodoroRoot");
    if (!el) return;

    rollDayIfNeeded();

    const total = phaseSeconds(phase);
    const pct = total > 0 ? ((total - remaining) / total) * 100 : 0;
    const circumference = 2 * Math.PI * 130;
    const dash = circumference * (pct / 100);

    el.innerHTML = `
      <header class="topbar">
        <div>
          <h2>Focus Timer ⏱️</h2>
          <p>One task. 25 minutes. No distractions.</p>
        </div>
      </header>

      <div class="pomo-wrap">

        <div class="pomo-card">
          <div class="pomo-phase">${phaseLabel(phase)}</div>

                      <div class="pomo-ring-wrap ${running ? "running" : ""}">>
            <svg class="pomo-ring" viewBox="0 0 300 300">
              <circle cx="150" cy="150" r="130" class="ring-track" />
              <circle cx="150" cy="150" r="130" class="ring-fill"
                      stroke-dasharray="${circumference}"
                      stroke-dashoffset="${circumference - dash}" />
            </svg>
            <div class="pomo-time ${remaining <= 10 && phase === "focus" ? "ending" : ""}">${fmt(remaining)}</div>          </div>

          <div class="pomo-actions">
            ${running
              ? `<button class="btn btn-secondary btn-lg" id="pomoPause">Pause</button>`
              : `<button class="btn btn-primary btn-lg" id="pomoStart">Start</button>`}
            <button class="btn btn-secondary btn-lg" id="pomoReset">Reset</button>
            <button class="btn btn-secondary btn-lg" id="pomoSkip">Skip</button>
          </div>
        </div>

        <aside class="pomo-side">
          <div class="pomo-stat">
            <div class="pomo-stat-num">${pomo.todayFocusCount || 0}</div>
            <div class="pomo-stat-lbl">Sessions today</div>
          </div>
          <div class="pomo-stat">
            <div class="pomo-stat-num">${pomo.todayFocusMinutes || 0}<small>m</small></div>
            <div class="pomo-stat-lbl">Focused today</div>
          </div>
          <div class="pomo-stat">
            <div class="pomo-stat-num">${pomo.streak || 0}<small>d</small></div>
            <div class="pomo-stat-lbl">Streak</div>
          </div>
        </aside>
      </div>

      <div class="list-item" style="margin-top:24px">
        <h4>Settings</h4>
        <div class="form-row" style="margin-top:12px">
          <label class="auth-label">Focus minutes
            <input id="cfgFocus" type="number" min="1" max="120" value="${pomo.focusMin}" />
          </label>
          <label class="auth-label">Short break
            <input id="cfgShort" type="number" min="1" max="60" value="${pomo.shortBreakMin}" />
          </label>
        </div>
        <div class="form-row">
          <label class="auth-label">Long break
            <input id="cfgLong" type="number" min="1" max="60" value="${pomo.longBreakMin}" />
          </label>
          <label class="auth-label">Long break every
            <input id="cfgEvery" type="number" min="2" max="10" value="${pomo.longBreakEvery}" />
          </label>
        </div>
        <div style="margin-top:12px">
          <label class="pomo-check">
            <input type="checkbox" id="cfgAutoBreak" ${pomo.autoStartBreak ? "checked" : ""} />
            Auto-start break
          </label>
          <label class="pomo-check">
            <input type="checkbox" id="cfgAutoFocus" ${pomo.autoStartFocus ? "checked" : ""} />
            Auto-start next focus
          </label>
          <label class="pomo-check">
            <input type="checkbox" id="cfgSound" ${pomo.sound ? "checked" : ""} />
            Play a sound when a session ends
          </label>
        </div>
      </div>
    `;

    document.getElementById("pomoStart")?.addEventListener("click", startTimer);
    document.getElementById("pomoPause")?.addEventListener("click", pauseTimer);
    document.getElementById("pomoReset")?.addEventListener("click", resetTimer);
    document.getElementById("pomoSkip")?.addEventListener("click", skipPhase);

    ["cfgFocus","cfgShort","cfgLong","cfgEvery"].forEach(id => {
      const inp = document.getElementById(id);
      if (!inp) return;
      inp.addEventListener("change", () => {
        pomo.focusMin = Math.max(1, Math.min(120, parseInt(document.getElementById("cfgFocus").value, 10) || 25));
        pomo.shortBreakMin = Math.max(1, Math.min(60, parseInt(document.getElementById("cfgShort").value, 10) || 5));
        pomo.longBreakMin = Math.max(1, Math.min(60, parseInt(document.getElementById("cfgLong").value, 10) || 15));
        pomo.longBreakEvery = Math.max(2, Math.min(10, parseInt(document.getElementById("cfgEvery").value, 10) || 4));
        savePomo();
        if (!running) { remaining = phaseSeconds(phase); }
        render();
      });
    });
    document.getElementById("cfgAutoBreak")?.addEventListener("change", e => { pomo.autoStartBreak = e.target.checked; savePomo(); });
    document.getElementById("cfgAutoFocus")?.addEventListener("change", e => { pomo.autoStartFocus = e.target.checked; savePomo(); });
    document.getElementById("cfgSound")?.addEventListener("change", e => { pomo.sound = e.target.checked; savePomo(); });

    /* Update page title with the remaining time — nice touch */
    if (running) document.title = `${fmt(remaining)} — ${phaseLabel(phase)} · Flaren`;
    else document.title = "Flaren — Dashboard";
  }

  /* ---------- public API ---------- */
  window.FlarenPomodoro = {
    render: function (el) {
      rollDayIfNeeded();
      /* Convert the page-content area into a container for us */
      el.innerHTML = `<div id="pomodoroRoot"></div>`;
      render();
    },
    stop: function () {
      running = false;
      if (interval) clearInterval(interval);
      document.title = "Flaren — Dashboard";
    }
  };
})();