/* =========================================================
   FLAREN — Workout Tracker (6-level progression)
   Honest streak system. Pulsing flame visual.
   ========================================================= */

(function () {
  "use strict";

  const WORKOUT_KEY = "flaren_workout_v1";

  /* ---------- The 6 Levels ---------- */
  const LEVELS = [
    {
      id: 1, name: "Beginner",
      tagline: "Start where you are. Just move.",
      tasks: [
        { id: "walk",  label: "Walk",          target: 10, unit: "min", icon: "🚶" },
        { id: "knee",  label: "Knee push-ups", target: 5,  unit: "reps", icon: "💪" },
        { id: "stretch", label: "Stretch",     target: 5,  unit: "min", icon: "🧘" }
      ]
    },
    {
      id: 2, name: "Novice",
      tagline: "Building the habit.",
      tasks: [
        { id: "walk",  label: "Walk",       target: 20, unit: "min", icon: "🚶" },
        { id: "push",  label: "Push-ups",   target: 10, unit: "reps", icon: "💪" },
        { id: "squat", label: "Squats",     target: 15, unit: "reps", icon: "🦵" }
      ]
    },
    {
      id: 3, name: "Intermediate",
      tagline: "You're in. Now get stronger.",
      tasks: [
        { id: "exercise", label: "Any exercise", target: 30, unit: "min", icon: "🏃" },
        { id: "push",     label: "Push-ups",     target: 15, unit: "reps", icon: "💪" },
        { id: "squat",    label: "Squats",       target: 25, unit: "reps", icon: "🦵" }
      ]
    },
    {
      id: 4, name: "Advanced",
      tagline: "Real training. Real results.",
      tasks: [
        { id: "exercise", label: "Any exercise", target: 45, unit: "min", icon: "🏃" },
        { id: "push",     label: "Push-ups",     target: 30, unit: "reps", icon: "💪" },
        { id: "squat",    label: "Squats",       target: 50, unit: "reps", icon: "🦵" },
        { id: "run",      label: "Run",          target: 2,  unit: "km",  icon: "🏃" }
      ]
    },
    {
      id: 5, name: "Athlete",
      tagline: "You train like it matters.",
      tasks: [
        { id: "exercise", label: "Any exercise", target: 60, unit: "min", icon: "🏃" },
        { id: "push",     label: "Push-ups",     target: 50, unit: "reps", icon: "💪" },
        { id: "squat",    label: "Squats",       target: 100, unit: "reps", icon: "🦵" },
        { id: "run",      label: "Run",          target: 5,  unit: "km",  icon: "🏃" }
      ]
    },
    {
      id: 6, name: "Elite",
      tagline: "Beyond limits.",
      tasks: [
        { id: "exercise", label: "Training", target: 90, unit: "min", icon: "🔥" },
        { id: "push",     label: "Push-ups", target: 100, unit: "reps", icon: "💪" },
        { id: "squat",    label: "Squats",   target: 200, unit: "reps", icon: "🦵" },
        { id: "run",      label: "Run",      target: 10, unit: "km",  icon: "🏃" },
        { id: "custom",   label: "Skill work", target: 20, unit: "min", icon: "🎯" }
      ]
    }
  ];

  /* ---------- Storage ---------- */
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  const DEFAULT = {
    levelId: 1,
    today: todayKey(),
    todayLogs: {},   /* { taskId: amount } */
    history: [],     /* [{ date, levelId, logs, complete }] */
    streak: 0,
    lastStreakCheck: ""
  };

  let data = load();
  let editingLevel = false;

  function load() {
    try {
      const raw = localStorage.getItem(WORKOUT_KEY);
      if (!raw) return { ...DEFAULT, today: todayKey() };
      const p = JSON.parse(raw);
      const merged = { ...DEFAULT, ...p };
      merged.today = merged.today || todayKey();
      merged.todayLogs = merged.todayLogs || {};
      merged.history = Array.isArray(merged.history) ? merged.history : [];
      return merged;
    } catch { return { ...DEFAULT, today: todayKey() }; }
  }
  function save() {
    localStorage.setItem(WORKOUT_KEY, JSON.stringify(data));
    try {
      const st = JSON.parse(localStorage.getItem("flaren_v1") || "{}");
      st.workout = data;
      localStorage.setItem("flaren_v1", JSON.stringify(st));
      if (typeof window.__flarenSaveData === "function") window.__flarenSaveData();
    } catch {}
  }

  function currentLevel() {
    return LEVELS.find(l => l.id === data.levelId) || LEVELS[0];
  }

  /* ---------- Daily reset ---------- */
  function rollDayIfNeeded() {
    const k = todayKey();
    if (data.today === k) return;

    /* Finalize previous day */
    const prev = data.today;
    if (prev) {
      const lvl = LEVELS.find(l => l.id === data.levelId) || LEVELS[0];
      const complete = isCompleteForDay(prev, data.todayLogs, lvl);
      data.history.push({
        date: prev,
        levelId: data.levelId,
        logs: { ...data.todayLogs },
        complete
      });
      if (data.history.length > 180) data.history = data.history.slice(-180);

      if (complete) data.streak = (data.streak || 0) + 1;
      else data.streak = 0;
    }
    data.today = k;
    data.todayLogs = {};
    save();
  }

  function isCompleteForDay(dateKey, logs, lvl) {
    /* Complete = at least 1 task fully met */
    return lvl.tasks.some(t => (logs[t.id] || 0) >= t.target);
  }

  /* ---------- Progress ---------- */
  function todayProgress() {
    const lvl = currentLevel();
    if (!lvl.tasks.length) return 0;
    let sum = 0;
    lvl.tasks.forEach(t => {
      const have = Math.min(data.todayLogs[t.id] || 0, t.target);
      sum += t.target ? have / t.target : 0;
    });
    return sum / lvl.tasks.length;
  }

  function todayComplete() {
    return todayProgress() >= 1;
  }

  function flameSVG(pct) {
    const p = Math.max(0, Math.min(1.5, pct));

    /* Flame scales from 0.4 to 1.0 as pct goes 0 -> 1 */
    const scale = 0.4 + Math.min(1, p) * 0.6;
    const glow  = 0.3 + Math.min(1, p) * 0.7;

    return `
      <svg viewBox="0 0 200 320" class="flame-svg" style="filter:drop-shadow(0 0 ${24 * glow}px rgba(255,122,24,${glow}));">
        <defs>
          <radialGradient id="flameOuter" cx="50%" cy="80%" r="70%">
            <stop offset="0%"   stop-color="#FFEAA7"/>
            <stop offset="30%"  stop-color="#FFB347"/>
            <stop offset="65%"  stop-color="#FF7A18"/>
            <stop offset="100%" stop-color="#C1351F"/>
          </radialGradient>
          <radialGradient id="flameInner" cx="50%" cy="70%" r="50%">
            <stop offset="0%"   stop-color="#FFF7DB"/>
            <stop offset="60%"  stop-color="#FFEAA7"/>
            <stop offset="100%" stop-color="#FFB347"/>
          </radialGradient>
          ${p > 1.0 ? `
          <radialGradient id="flameBlue" cx="50%" cy="75%" r="50%">
            <stop offset="0%"   stop-color="#E0F7FF"/>
            <stop offset="60%"  stop-color="#7FDBFF"/>
            <stop offset="100%" stop-color="#22D3EE"/>
          </radialGradient>` : ""}
        </defs>

        <ellipse cx="100" cy="295" rx="${44 * scale}" ry="7" fill="#FF7A18" opacity="${0.15 + Math.min(1, p) * 0.35}"/>

        <g transform="translate(100 290) scale(${scale}) translate(-100 -290)">
          <path class="flame-flicker"
                d="M100 40
                   C 130 90, 150 140, 145 185
                   C 140 225, 130 260, 100 285
                   C 70 260, 60 225, 55 185
                   C 50 140, 70 90, 100 40 Z"
                fill="url(#flameOuter)"/>

          <path class="flame-core"
                d="M100 110
                   C 118 145, 128 175, 124 205
                   C 120 235, 112 260, 100 275
                   C 88 260, 80 235, 76 205
                   C 72 175, 82 145, 100 110 Z"
                fill="url(#flameInner)"
                opacity="0.85"/>

          ${p > 1.0 ? `
            <ellipse class="flame-blue" cx="100" cy="220" rx="26" ry="40" fill="url(#flameBlue)" opacity="0.85"/>
          ` : ""}
        </g>
      </svg>
    `;
  }

  /* ---------- Rendering ---------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  function escapeHTML(str) {
    return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  function render(el) {
    rollDayIfNeeded();
    draw(el);
  }
  function stop() {}

  function draw(el) {
    const lvl = currentLevel();
    const pct = todayProgress();
    const pctPct = Math.round(pct * 100);
    const complete = todayComplete();

    el.innerHTML = `
      <header class="topbar">
        <div>
          <h2>Workout 🔥</h2>
          <p>Train. Track. Level up.</p>
        </div>
        <button class="btn btn-secondary" id="woChangeLevel">Level: ${lvl.name} ⚙</button>
      </header>

      <div class="wo-layout">

        <div class="wo-flame-card">
          <div class="wo-flame-wrap">
            ${flameSVG(pct)}
          </div>
          <div class="wo-progress">
            <div class="wo-progress-bar">
              <div class="wo-progress-fill" style="width:${Math.min(100, pctPct)}%"></div>
            </div>
            <div class="wo-progress-lbl">
              <strong>${pctPct}%</strong>
              <span>${complete ? "Daily goal reached 🔥" : "Keep going"}</span>
            </div>
          </div>
        </div>

        <div class="wo-log-card">
          <h3>Today — ${escapeHTML(lvl.name)}</h3>
          <p class="wo-tagline">${escapeHTML(lvl.tagline)}</p>

          <div class="wo-tasks">
            ${lvl.tasks.map(t => {
              const have = data.todayLogs[t.id] || 0;
              const done = have >= t.target;
              const pctTask = Math.min(100, (have / t.target) * 100);
              return `
                <div class="wo-task ${done ? "done" : ""}">
                  <div class="wo-task-head">
                    <span class="wo-task-icon">${t.icon}</span>
                    <span class="wo-task-label">${escapeHTML(t.label)}</span>
                    <span class="wo-task-target">${have} / ${t.target} ${t.unit}</span>
                  </div>
                  <div class="wo-task-bar">
                    <div class="wo-task-fill" style="width:${pctTask}%"></div>
                  </div>
                  <div class="wo-task-actions">
                    <button class="btn btn-small btn-primary wo-log" data-id="${t.id}" data-amt="${t.unit === "reps" ? 5 : (t.unit === "km" ? 1 : 5)}">
                      +${t.unit === "reps" ? 5 : (t.unit === "km" ? 1 : 5)} ${t.unit}
                    </button>
                    <button class="btn btn-small btn-secondary wo-log" data-id="${t.id}" data-amt="${t.unit === "reps" ? 10 : (t.unit === "km" ? 2 : 10)}">
                      +${t.unit === "reps" ? 10 : (t.unit === "km" ? 2 : 10)} ${t.unit}
                    </button>
                    <button class="btn btn-small btn-secondary wo-custom" data-id="${t.id}">Custom</button>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </div>

            ${data.todayLogs && Object.keys(data.todayLogs).length > 0 ? `
      <div class="wo-undobar">
        <button class="btn btn-secondary" id="woUndo">↶ Undo last log</button>
        <button class="btn btn-secondary" id="woReset">Reset today</button>
        ${todayComplete() ? `<span class="wo-complete-badge">✓ Day complete</span>` : ""}
      </div>
      ` : ""}

      <div class="wo-history-card">
        <h3>Last 30 days 🔥</h3>
        <p class="wo-sub">Bigger flame = more you did that day.</p>
        <div class="wo-heatmap">
          ${renderHeatmap()}
        </div>
              <div class="wo-stats">
          <div class="wo-stat">
            <div class="wo-stat-num">${(data.streak || 0) + (todayComplete() ? 1 : 0)}</div>
            <div class="wo-stat-lbl">Day streak</div>
          </div>
          <div class="wo-stat">
            <div class="wo-stat-num">${(data.history || []).filter(h => h.complete).length + (todayComplete() ? 1 : 0)}</div>
            <div class="wo-stat-lbl">Days completed</div>
          </div>
          <div class="wo-stat">
            <div class="wo-stat-num">${lvl.id}/6</div>
            <div class="wo-stat-lbl">Current level</div>
          </div>
        </div>
    `;

    /* Bind actions */
    $$(".wo-log", el).forEach(b => b.addEventListener("click", () => {
      logAmount(b.dataset.id, Number(b.dataset.amt));
    }));
    $$(".wo-custom", el).forEach(b => b.addEventListener("click", () => {
      const v = prompt("How much?", "10");
      if (v === null) return;
      const n = parseInt(v, 10);
      if (!n || n <= 0) return;
      logAmount(b.dataset.id, n);
    }));

    const undoBtn = document.getElementById("woUndo");
    if (undoBtn) undoBtn.addEventListener("click", undoLastLog);
    const resetBtn = document.getElementById("woReset");
    if (resetBtn) resetBtn.addEventListener("click", () => {
      if (!confirm("Reset today's log? This will clear all of today's entries.")) return;
      data.todayLogs = {};
      save();
      draw(document.getElementById("pageContent"));
    });
    $("#woChangeLevel", el).addEventListener("click", () => openLevelPicker());
  }

   function undoLastLog() {
    /* Remove the most recent single log entry by deleting one task's last add.
       We track by popping the highest-value task's last increment. */
    const keys = Object.keys(data.todayLogs);
    if (!keys.length) return;
    const last = keys[keys.length - 1];
    const lvl = currentLevel();
    const task = lvl.tasks.find(t => t.id === last);
    if (!task) return;
    const step = task.unit === "reps" ? 5 : (task.unit === "km" ? 1 : 5);
    data.todayLogs[last] = Math.max(0, (data.todayLogs[last] || 0) - step);
    if (data.todayLogs[last] === 0) delete data.todayLogs[last];
    save();
    draw(document.getElementById("pageContent"));
    if (typeof toast === "function") toast("Undone");
  }
  

  function logAmount(taskId, amount) {
    rollDayIfNeeded();
    data.todayLogs[taskId] = (data.todayLogs[taskId] || 0) + amount;
    save();
    draw(document.getElementById("pageContent"));
  }

  function renderHeatmap() {
    const days = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      let record = (data.history || []).find(h => h.date === key);
      let pct = 0;
      if (key === data.today) {
        pct = todayProgress();
      } else if (record) {
        const lvl = LEVELS.find(l => l.id === record.levelId) || LEVELS[0];
        let sum = 0;
        lvl.tasks.forEach(t => {
          const have = Math.min((record.logs[t.id] || 0), t.target);
          sum += t.target ? have / t.target : 0;
        });
        pct = sum / lvl.tasks.length;
      }
      const intensity = Math.min(1, pct);
      days.push({ key, pct: intensity, isToday: key === data.today });
    }
    return days.map(d => `
      <div class="wo-heat-cell ${d.isToday ? "today" : ""}"
           style="--intensity:${d.pct}"
           title="${d.key} — ${Math.round(d.pct * 100)}%"></div>
    `).join("");
  }

  /* ---------- Level picker ---------- */
  function openLevelPicker() {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal">
        <h3>Choose your level</h3>
        <p style="color:var(--muted);font-size:13px;margin-bottom:14px">
          Be honest. You can change this anytime.
        </p>
        ${LEVELS.map(l => `
          <button class="wo-level-option ${l.id === data.levelId ? "sel" : ""}" data-id="${l.id}">
            <strong>Level ${l.id} — ${l.name}</strong>
            <small>${l.tagline}</small>
          </button>
        `).join("")}
        <div class="modal-actions">
          <button class="btn btn-secondary" id="woCancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.body.classList.add("modal-open");

    $$(".wo-level-option", modal).forEach(b => {
      b.addEventListener("click", () => {
        data.levelId = parseInt(b.dataset.id, 10);
        save();
        modal.remove();
        document.body.classList.remove("modal-open");
        draw(document.getElementById("pageContent"));
      });
    });
    $("#woCancel", modal).addEventListener("click", () => {
      modal.remove();
      document.body.classList.remove("modal-open");
    });
  }

  /* ---------- Public API ---------- */
  window.FlarenWorkout = {
    render: render,
    stop: stop,
    tick: rollDayIfNeeded,
    getData: () => data
  };
})();
