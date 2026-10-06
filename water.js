/* =========================================================
   FLAREN — Water Tracker v2
   - Daily reset at midnight
   - Animated water bottle + 5-stage plant
   - Goal calculator (weight / age / activity / climate)
   - Streak + garden
   - Once-per-day reminder + new-day greeting
   ========================================================= */

(function () {
  "use strict";

  const WATER_KEY = "flaren_water_v1";
  const LAST_SEEN_KEY = "flaren_water_last_seen_day";

  const DEFAULT_WATER = {
    weightKg: 65,
    age: 25,
    activityMin: 30,
    climate: "temperate",
    goalMl: 2500,
    goalOverride: false,
    unit: "ml",
    today: "",
    todayMl: 0,
    logs: [],
    history: [],
    streak: 0,
    reminders: false,
    reminderIntervalMin: 90,
    lastReminder: 0,
    lastNewDayPopup: ""
  };

  let water = load();
  let _reminderTimer = null;

  /* ---------- storage ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(WATER_KEY);
      if (!raw) return { ...DEFAULT_WATER, today: todayKey() };
      const p = JSON.parse(raw);
      const merged = { ...DEFAULT_WATER, ...p };
      merged.today = merged.today || todayKey();
      merged.logs = Array.isArray(merged.logs) ? merged.logs : [];
      merged.history = Array.isArray(merged.history) ? merged.history : [];
      return merged;
    } catch { return { ...DEFAULT_WATER, today: todayKey() }; }
  }
  function save() {
    localStorage.setItem(WATER_KEY, JSON.stringify(water));
    try {
      const st = JSON.parse(localStorage.getItem("flaren_v1") || "{}");
      st.water = water;
      localStorage.setItem("flaren_v1", JSON.stringify(st));
      if (typeof window.__flarenSaveData === "function") window.__flarenSaveData();
    } catch {}
  }

  /* ---------- helpers ---------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function escapeHTML(str) {
    return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  /* ---------- goal calculator ---------- */
  function calculateGoal(w) {
    const kg = Math.max(20, Math.min(200, Number(w.weightKg) || 65));
    let baseMlPerKg = 30;
    if (kg < 30) baseMlPerKg = 35;
    if (kg > 80) baseMlPerKg = 30;

    let goalMl = kg * baseMlPerKg;

    const age = Number(w.age) || 25;
    if (age < 14) goalMl = Math.min(goalMl, 2000);
    else if (age >= 60) goalMl = Math.max(1500, goalMl * 0.9);

    const actMin = Math.max(0, Number(w.activityMin) || 0);
    goalMl += Math.floor(actMin / 30) * 350;

    if (w.climate === "hot") goalMl += 500;
    else if (w.climate === "cold") goalMl -= 100;
    else if (w.climate === "high") goalMl += 300;

    goalMl = Math.max(1200, Math.min(6000, Math.round(goalMl / 50) * 50));
    return goalMl;
  }

  function computeGoalIfNeeded() {
    if (!water.goalOverride) {
      const calc = calculateGoal(water);
      if (calc !== water.goalMl) {
        water.goalMl = calc;
        save();
      }
    }
  }

  /* ---------- daily roll-over ---------- */
  /* Fires when the calendar day changes (midnight or first open next day). */
  function rollDayIfNeeded() {
    const k = todayKey();
    if (water.today === k) return;

    const prevDay = water.today;

    /* Finalize the previous day */
    if (prevDay) {
      const complete = water.todayMl >= water.goalMl;
      water.history.push({
        date: prevDay,
        ml: water.todayMl,
        goal: water.goalMl,
        complete
      });
      if (complete) water.streak = (water.streak || 0) + 1;
      else water.streak = 0;

      if (water.history.length > 90) water.history = water.history.slice(-90);
    }

    /* Reset for the new day */
    water.today = k;
    water.todayMl = 0;
    water.logs = [];
    water.lastReminder = 0;
    save();

    /* Fire new-day greeting once per day */
    if (water.lastNewDayPopup !== k) {
      water.lastNewDayPopup = k;
      save();
      showToast("🌱 New day, new plant", "Drink up to grow today's plant.");
      /* If reminders are on, arm the first one for this new day */
      if (water.reminders) {
        /* nothing extra needed — checkReminders handles timing */
      }
    }
  }

  /* ---------- plant health ---------- */
  function pctOfGoal() {
    if (!water.goalMl) return 0;
    return water.todayMl / water.goalMl;
  }
  function plantStage() {
    const p = pctOfGoal();
    if (p < 0.25) return 0;
    if (p < 0.50) return 1;
    if (p < 0.75) return 2;
    if (p < 1.00) return 3;
    return 4;
  }
  function stageLabel() {
    const s = plantStage();
    return ["Thirsty — drink up","Growing","Getting strong","Blooming","Thriving!"][s];
  }

  /* ---------- plant SVG (5 stages) ---------- */
  function plantSVG(stage) {
    const soil = `
      <ellipse cx="100" cy="200" rx="70" ry="14" fill="#5B3A1E" opacity=".9"/>
      <ellipse cx="100" cy="196" rx="66" ry="10" fill="#7A4F2A"/>
    `;

    if (stage === 0) {
      return `
        <svg viewBox="0 0 200 220" class="plant-svg">
          <defs>
            <radialGradient id="drySoil" cx="50%" cy="30%" r="80%">
              <stop offset="0%" stop-color="#C89A64"/>
              <stop offset="100%" stop-color="#8A5F2E"/>
            </radialGradient>
          </defs>
          <ellipse cx="100" cy="200" rx="80" ry="16" fill="url(#drySoil)"/>
          <path d="M30 200 L50 194 L70 200 M110 198 L140 192 L170 200 M60 204 L90 198 L120 204" stroke="#3D2817" stroke-width="2" fill="none" opacity=".55"/>
          <ellipse cx="100" cy="188" rx="10" ry="7" fill="#3D2817"/>
          <ellipse cx="98" cy="186" rx="3" ry="2" fill="#5B3A1E" opacity=".7"/>
          <text x="100" y="140" text-anchor="middle" font-size="13" fill="#8A5F2E" font-weight="600">Needs water…</text>
        </svg>
      `;
    }

    if (stage === 1) {
      return `
        <svg viewBox="0 0 200 220" class="plant-svg">
          <g class="plant-sway">
            ${soil}
            <path d="M100 190 Q100 165 100 145" stroke="#4E7A2E" stroke-width="4" fill="none" stroke-linecap="round"/>
            <path d="M100 155 Q85 145 75 150 Q80 165 100 160 Z" fill="#6FBF3B"/>
            <path d="M100 148 Q118 140 128 148 Q120 160 100 155 Z" fill="#8BD14A"/>
            <ellipse cx="100" cy="192" rx="20" ry="3" fill="#4E7A2E" opacity=".25"/>
          </g>
        </svg>
      `;
    }

    if (stage === 2) {
      return `
        <svg viewBox="0 0 200 220" class="plant-svg">
          <g class="plant-sway">
            ${soil}
            <path d="M100 190 Q97 145 100 110" stroke="#4E7A2E" stroke-width="5" fill="none" stroke-linecap="round"/>
            <path d="M100 150 Q78 138 66 148 Q78 168 100 158 Z" fill="#6FBF3B"/>
            <path d="M100 135 Q126 122 140 134 Q126 156 100 144 Z" fill="#8BD14A"/>
            <path d="M100 118 Q84 108 76 116 Q84 132 100 124 Z" fill="#6FBF3B"/>
            <path d="M100 108 Q116 100 124 108 Q116 124 100 116 Z" fill="#8BD14A"/>
            <ellipse cx="100" cy="192" rx="34" ry="4" fill="#4E7A2E" opacity=".3"/>
          </g>
        </svg>
      `;
    }

    if (stage === 3) {
      return `
        <svg viewBox="0 0 200 220" class="plant-svg">
          <g class="plant-sway">
            ${soil}
            <path d="M100 190 Q96 135 100 90" stroke="#4E7A2E" stroke-width="5" fill="none" stroke-linecap="round"/>
            <path d="M100 150 Q74 138 60 150 Q74 172 100 158 Z" fill="#6FBF3B"/>
            <path d="M100 130 Q128 116 146 130 Q128 154 100 140 Z" fill="#8BD14A"/>
            <path d="M100 112 Q80 100 70 110 Q80 128 100 118 Z" fill="#6FBF3B"/>
            <path d="M100 96 Q120 86 130 96 Q120 116 100 106 Z" fill="#8BD14A"/>
            <g class="plant-bloom">
              <circle cx="100" cy="78" r="12" fill="#FFB300"/>
              <circle cx="88" cy="70" r="7" fill="#FF7A18"/>
              <circle cx="112" cy="70" r="7" fill="#FF7A18"/>
              <circle cx="88" cy="88" r="7" fill="#FF7A18"/>
              <circle cx="112" cy="88" r="7" fill="#FF7A18"/>
              <circle cx="100" cy="70" r="6" fill="#FFD54F"/>
              <circle cx="100" cy="90" r="6" fill="#FFD54F"/>
            </g>
            <ellipse cx="100" cy="192" rx="40" ry="5" fill="#4E7A2E" opacity=".3"/>
          </g>
        </svg>
      `;
    }

    return `
      <svg viewBox="0 0 200 220" class="plant-svg thriving">
        <g class="plant-sway">
          ${soil}
          <path d="M100 190 Q95 130 100 80" stroke="#4E7A2E" stroke-width="6" fill="none" stroke-linecap="round"/>
          <path d="M100 155 Q70 140 55 155 Q72 178 100 162 Z" fill="#6FBF3B"/>
          <path d="M100 135 Q130 120 148 135 Q130 160 100 145 Z" fill="#8BD14A"/>
          <path d="M100 115 Q76 100 62 115 Q80 138 100 122 Z" fill="#6FBF3B"/>
          <path d="M100 95 Q126 82 140 96 Q124 120 100 104 Z" fill="#8BD14A"/>
          <path d="M100 80 Q82 70 74 80 Q84 96 100 88 Z" fill="#6FBF3B"/>
          <path d="M100 78 Q118 68 126 78 Q116 94 100 86 Z" fill="#8BD14A"/>
          <g class="plant-bloom">
            <circle cx="100" cy="65" r="14" fill="#FFB300"/>
            <circle cx="86" cy="56" r="8" fill="#FF7A18"/>
            <circle cx="114" cy="56" r="8" fill="#FF7A18"/>
            <circle cx="86" cy="76" r="8" fill="#FF7A18"/>
            <circle cx="114" cy="76" r="8" fill="#FF7A18"/>
            <circle cx="100" cy="56" r="7" fill="#FFD54F"/>
            <circle cx="100" cy="78" r="7" fill="#FFD54F"/>
          </g>
          <g class="sparkles">
            <circle cx="52" cy="70" r="2" fill="#FFD54F" class="s1"/>
            <circle cx="150" cy="60" r="2.5" fill="#FFD54F" class="s2"/>
            <circle cx="46" cy="110" r="1.8" fill="#FFD54F" class="s3"/>
            <circle cx="158" cy="120" r="2.2" fill="#FFD54F" class="s4"/>
          </g>
        </g>
      </svg>
    `;
  }

  /* ---------- bottle SVG ---------- */
  function bottleSVG(pct) {
    const p = Math.max(0, Math.min(1, pct));
    const top = 40 + (1 - p) * 220;
    return `
      <svg viewBox="0 0 140 320" class="bottle-svg">
        <defs>
          <linearGradient id="bottleWater" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4FC3F7"/>
            <stop offset="100%" stop-color="#0277BD"/>
          </linearGradient>
          <clipPath id="bottleClip">
            <path d="M45 40 L45 70 Q30 78 30 100 L30 280 Q30 300 50 300 L90 300 Q110 300 110 280 L110 100 Q110 78 95 70 L95 40 Z"/>
          </clipPath>
        </defs>
        <path d="M45 40 L45 70 Q30 78 30 100 L30 280 Q30 300 50 300 L90 300 Q110 300 110 280 L110 100 Q110 78 95 70 L95 40 Z"
              fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
        <g clip-path="url(#bottleClip)">
          <rect x="30" y="${top}" width="80" height="300" fill="url(#bottleWater)" opacity=".95"/>
          <g class="water-ripple">
            <path d="M30 ${top} Q55 ${top - 6} 70 ${top} T 110 ${top}" stroke="#8FE3FF" stroke-width="2" fill="none" opacity=".7"/>
          </g>
          <circle cx="55" cy="${top + 30}" r="3" fill="#B3ECFF" opacity=".6" class="bubble b1"/>
          <circle cx="80" cy="${top + 60}" r="2" fill="#B3ECFF" opacity=".5" class="bubble b2"/>
          <circle cx="65" cy="${top + 90}" r="2.5" fill="#B3ECFF" opacity=".55" class="bubble b3"/>
        </g>
        <rect x="42" y="26" width="56" height="16" rx="4" fill="#22D3EE" opacity=".9"/>
        <line x1="112" y1="100" x2="120" y2="100" stroke="rgba(255,255,255,.4)" stroke-width="1"/>
        <line x1="112" y1="170" x2="120" y2="170" stroke="rgba(255,255,255,.4)" stroke-width="1"/>
        <line x1="112" y1="240" x2="120" y2="240" stroke="rgba(255,255,255,.4)" stroke-width="1"/>
        <text x="124" y="104" font-size="9" fill="rgba(255,255,255,.5)">100%</text>
        <text x="124" y="174" font-size="9" fill="rgba(255,255,255,.5)">50%</text>
        <text x="124" y="244" font-size="9" fill="rgba(255,255,255,.5)">0%</text>
      </svg>
    `;
  }

  /* ---------- reminders ---------- */
  function checkReminders() {
    if (!water.reminders) return;
    const now = Date.now();
    const gap = water.reminderIntervalMin * 60 * 1000;
    if (now - (water.lastReminder || 0) < gap) return;
    if (water.todayMl >= water.goalMl) return;

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const remaining = Math.max(0, water.goalMl - water.todayMl);
        const n = new Notification("💧 Time to drink water", {
          body: `${Math.round(water.todayMl)} / ${water.goalMl} ml. ${remaining} ml to go.`,
          icon: "images/logo.png",
          tag: "flaren-water"
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch {}
    }
    water.lastReminder = now;
    save();
  }

  function startReminders() {
    if (_reminderTimer) clearInterval(_reminderTimer);
    checkReminders();
    _reminderTimer = setInterval(checkReminders, 60 * 1000);
  }
  function stopReminders() {
    if (_reminderTimer) { clearInterval(_reminderTimer); _reminderTimer = null; }
  }

  /* ---------- animations ---------- */
  function playPourAnimation(ml) {
    const wrap = document.getElementById("waterBottleWrap");
    if (!wrap) return;
    wrap.classList.remove("pouring");
    void wrap.offsetWidth;
    wrap.classList.add("pouring");
    const badge = document.createElement("div");
    badge.className = "water-plus-badge";
    badge.textContent = "+" + ml + " ml";
    wrap.appendChild(badge);
    setTimeout(() => badge.remove(), 1400);
  }

  /* ---------- actions ---------- */
  function addWater(ml) {
    rollDayIfNeeded();
    ml = Math.max(1, Number(ml) || 0);
    water.todayMl += ml;
    water.logs.push({ date: water.today, ml, at: Date.now() });
    save();
    playPourAnimation(ml);
    render(document.getElementById("pageContent"));

    if (water.todayMl - ml < water.goalMl && water.todayMl >= water.goalMl) {
      showToast("🌱 Goal complete!", "Your plant is thriving. Great job.");
    }
  }

  function undoLast() {
    rollDayIfNeeded();
    if (!water.logs.length) return;
    const last = water.logs.pop();
    water.todayMl = Math.max(0, water.todayMl - last.ml);
    save();
    render(document.getElementById("pageContent"));
  }

  function showToast(title, message) {
    let c = document.getElementById("flaren-toast-container");
    if (!c) {
      c = document.createElement("div");
      c.id = "flaren-toast-container";
      c.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;";
      document.body.appendChild(c);
    }
    const t = document.createElement("div");
    t.style.cssText = "background:#111827;color:#fff;padding:12px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.35);max-width:280px;font-size:13px;line-height:1.3;";
    t.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px">${escapeHTML(title)}</div>
      <div style="opacity:.9">${escapeHTML(message)}</div>
    `;
    c.appendChild(t);
    setTimeout(() => {
      t.style.transition = "opacity .25s ease, transform .25s ease";
      t.style.opacity = "0";
      t.style.transform = "translateY(6px)";
      setTimeout(() => t.remove(), 260);
    }, 3500);
  }

  /* ---------- render ---------- */
  function render(el) {
    rollDayIfNeeded();
    computeGoalIfNeeded();
    startReminders();
    draw(el);
  }
  function stop() { stopReminders(); }

  function draw(el) {
    const pct = water.goalMl ? (water.todayMl / water.goalMl) : 0;
    const pctClamped = Math.max(0, Math.min(1, pct));
    const pctLabel = Math.round(pct * 100);
    const remaining = Math.max(0, water.goalMl - water.todayMl);
    const stage = plantStage();

    el.innerHTML = `
      <header class="topbar">
        <div>
          <h2>Water 💧</h2>
          <p>Drink. Grow. Repeat.</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-secondary" id="waterSettings">⚙ Goal settings</button>
        </div>
      </header>

      <div class="water-layout">

        <div class="water-card">
          <div class="water-bottle-wrap" id="waterBottleWrap">
            ${bottleSVG(pctClamped)}
            <div class="bottle-labels">
              <div class="bottle-ml">${Math.round(water.todayMl)}<small>ml</small></div>
              <div class="bottle-goal">of ${water.goalMl} ml</div>
            </div>
          </div>

          <div class="water-progress">
            <div class="water-progress-bar">
              <div class="water-progress-fill" style="width:${Math.min(100, pctLabel)}%"></div>
            </div>
            <div class="water-progress-lbl">
              <strong>${pctLabel}%</strong>
              <span>${remaining} ml remaining</span>
            </div>
          </div>

          <div class="water-quick">
            <button class="btn btn-primary water-add" data-ml="250">+250 ml</button>
            <button class="btn btn-primary water-add" data-ml="500">+500 ml</button>
            <button class="btn btn-primary water-add" data-ml="750">+750 ml</button>
            <button class="btn btn-secondary" id="waterCustom">Custom…</button>
            <button class="btn btn-secondary" id="waterUndo" ${water.logs.length === 0 ? "disabled" : ""}>↶ Undo</button>
          </div>
        </div>

        <div class="water-plant-card">
          <div class="plant-stage-label">${stageLabel()}</div>
          <div class="plant-wrap">
            ${plantSVG(stage)}
          </div>
          <div class="plant-stats">
            <div class="plant-stat">
              <div class="plant-stat-num">${water.streak || 0}</div>
              <div class="plant-stat-lbl">Day streak</div>
            </div>
            <div class="plant-stat">
              <div class="plant-stat-num">${(water.history || []).filter(h => h.complete).length}</div>
              <div class="plant-stat-lbl">Plants grown</div>
            </div>
          </div>
        </div>
      </div>

      <div class="water-garden-card">
        <h3>Your garden 🌱</h3>
        <p class="water-garden-sub">One plant for every completed day.</p>
        <div class="water-garden">
          ${renderGarden()}
        </div>
      </div>

      <div class="list-item" style="margin-top:24px">
        <h4>Reminders</h4>
        <label class="pomo-check" style="margin-top:10px">
          <input type="checkbox" id="waterRemind" ${water.reminders ? "checked" : ""} />
          Remind me to drink water
        </label>
        <div class="form-row" style="margin-top:10px">
          <label class="auth-label">Reminder every
            <select id="waterRemindInterval">
              <option value="60" ${water.reminderIntervalMin === 60 ? "selected" : ""}>Every 60 minutes</option>
              <option value="90" ${water.reminderIntervalMin === 90 ? "selected" : ""}>Every 90 minutes</option>
              <option value="120" ${water.reminderIntervalMin === 120 ? "selected" : ""}>Every 2 hours</option>
              <option value="180" ${water.reminderIntervalMin === 180 ? "selected" : ""}>Every 3 hours</option>
            </select>
          </label>
        </div>
      </div>

      <div class="list-item" style="margin-top:24px">
        <h4>Last 7 days</h4>
        ${renderHistory()}
      </div>
    `;

    $$(".water-add", el).forEach(b => b.addEventListener("click", () => addWater(Number(b.dataset.ml))));
    $("#waterCustom", el).addEventListener("click", () => {
      const v = prompt("How many ml?", "300");
      if (v === null) return;
      const n = parseInt(v, 10);
      if (!n || n <= 0) return;
      addWater(n);
    });
    $("#waterUndo", el).addEventListener("click", undoLast);
    $("#waterSettings", el).addEventListener("click", openWaterSettings);
    $("#waterRemind", el).addEventListener("change", async (e) => {
      water.reminders = e.target.checked;
      if (water.reminders && typeof Notification !== "undefined" && Notification.permission !== "granted") {
        try { await Notification.requestPermission(); } catch {}
      }
      save();
      startReminders();
    });
    $("#waterRemindInterval", el).addEventListener("change", (e) => {
      water.reminderIntervalMin = Number(e.target.value) || 90;
      save();
    });
  }

 function renderGarden() {
  const days = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    let record = (water.history || []).find(h => h.date === key);
    const isToday = key === water.today;
    if (isToday) {
      record = { date: key, ml: water.todayMl, goal: water.goalMl, complete: water.todayMl >= water.goalMl };
    }
    let pct = 0;
    if (record && record.goal) pct = Math.min(1, record.ml / record.goal);
    else if (record && record.ml > 0) pct = 0.1;

    /* Honest plant stage for that day */
    let icon = "·";
    let cls = "empty";
    if (pct > 0) {
      if (pct < 0.25)      { icon = "·"; cls = "seed"; }
      else if (pct < 0.50) { icon = "🌱"; cls = "sprout"; }
      else if (pct < 0.75) { icon = "🌿"; cls = "growing"; }
      else if (pct < 1.00) { icon = "🪴"; cls = "almost"; }
      else                 { icon = "🌸"; cls = "complete"; }
    }

    days.push({ key, cls, icon, pct, isToday, ml: record ? record.ml : 0, goal: record ? record.goal : 0 });
  }
  return days.map(d => `
    <div class="garden-cell ${d.cls} ${d.isToday ? "today" : ""}"
         title="${d.key} — ${Math.round(d.pct * 100)}%${
           d.ml ? ` (${Math.round(d.ml)}/${d.goal} ml)` : ""
         }">
      ${d.icon}
    </div>
  `).join("");
}

  function renderHistory() {
    const last7 = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const rec = key === water.today
        ? { date: key, ml: water.todayMl, goal: water.goalMl, complete: water.todayMl >= water.goalMl }
        : (water.history || []).find(h => h.date === key);
      last7.push({ key, rec });
    }
    return `
      <div class="water-history">
        ${last7.map(({ key, rec }) => `
          <div class="water-history-row">
            <span class="water-history-day">${key}</span>
            <span class="water-history-ml">${rec ? Math.round(rec.ml) + " / " + rec.goal + " ml" : "—"}</span>
            <span class="water-history-badge ${rec && rec.complete ? "ok" : "no"}">${rec && rec.complete ? "Complete" : rec && rec.ml > 0 ? "Partial" : "Missed"}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* ---------- settings modal ---------- */
  function openWaterSettings() {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal">
        <h3>Goal settings</h3>
        <div class="form-row">
          <label class="auth-label">Weight (kg)
            <input id="wwWeight" type="number" min="20" max="200" value="${water.weightKg}" />
          </label>
          <label class="auth-label">Age
            <input id="wwAge" type="number" min="1" max="120" value="${water.age}" />
          </label>
        </div>
        <div class="form-row">
          <label class="auth-label">Exercise per day (min)
            <input id="wwAct" type="number" min="0" max="300" value="${water.activityMin}" />
          </label>
          <label class="auth-label">Climate
            <select id="wwClimate">
              <option value="temperate" ${water.climate === "temperate" ? "selected" : ""}>Temperate</option>
              <option value="hot" ${water.climate === "hot" ? "selected" : ""}>Hot</option>
              <option value="cold" ${water.climate === "cold" ? "selected" : ""}>Cold</option>
              <option value="high" ${water.climate === "high" ? "selected" : ""}>High altitude</option>
            </select>
          </label>
        </div>
        <div class="list-item" style="margin:14px 0">
          <label class="pomo-check">
            <input type="checkbox" id="wwOverride" ${water.goalOverride ? "checked" : ""} />
            Set my own daily goal
          </label>
          <label class="auth-label" style="margin-top:10px">Daily goal (ml)
            <input id="wwGoal" type="number" min="500" max="8000" value="${water.goalMl}" />
          </label>
        </div>
        <div class="goal-preview" id="wwPreview">Recommended goal: ${water.goalMl} ml</div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="wwCancel">Cancel</button>
          <button class="btn btn-primary" id="wwSave">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.body.classList.add("modal-open");

    const updatePreview = () => {
      const candidate = {
        weightKg: Number($("#wwWeight", modal).value) || 65,
        age: Number($("#wwAge", modal).value) || 25,
        activityMin: Number($("#wwAct", modal).value) || 0,
        climate: $("#wwClimate", modal).value
      };
      const calc = calculateGoal(candidate);
      $("#wwPreview", modal).textContent = `Recommended goal: ${calc} ml`;
      if (!$("#wwOverride", modal).checked) {
        $("#wwGoal", modal).value = calc;
      }
    };
    ["wwWeight","wwAge","wwAct","wwClimate","wwOverride"].forEach(id => {
      const el = $("#" + id, modal);
      if (el) el.addEventListener("input", updatePreview);
    });
    updatePreview();

    function close() {
      modal.remove();
      if (!document.querySelector(".modal-backdrop")) document.body.classList.remove("modal-open");
    }
    $("#wwCancel", modal).addEventListener("click", close);
    $("#wwSave", modal).addEventListener("click", () => {
      water.weightKg = Math.max(20, Math.min(200, Number($("#wwWeight", modal).value) || 65));
      water.age = Math.max(1, Math.min(120, Number($("#wwAge", modal).value) || 25));
      water.activityMin = Math.max(0, Math.min(300, Number($("#wwAct", modal).value) || 0));
      water.climate = $("#wwClimate", modal).value;
      water.goalOverride = $("#wwOverride", modal).checked;
      water.goalMl = Math.max(500, Math.min(8000, Number($("#wwGoal", modal).value) || calculateGoal(water)));
      save();
      close();
      render(document.getElementById("pageContent"));
    });
  }

  /* ---------- public API ---------- */
  window.FlarenWater = {
    render: function (el) { render(el); },
    stop: function () { stop(); },
    getData: function () { return water; },
    mergeFromServer: function (remote) {
      if (!remote || typeof remote !== "object") return;
      water = { ...DEFAULT_WATER, ...remote };
      save();
    },
    /* Manually trigger a roll-over check (e.g. from app.js on visibility change) */
    tick: function () { rollDayIfNeeded(); }
  };
})();