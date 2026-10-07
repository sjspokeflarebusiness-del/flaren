/* =========================================================
   FLAREN — Pill Reminder
   Track medications, get notified at the right time.
   NOT medical advice. Always follow your doctor's instructions.
   ========================================================= */

(function () {
  "use strict";

  const PILL_KEY = "flaren_pills_v1";

  const DEFAULT_DATA = {
    pills: [],           /* [{ id, name, dose, times:[], notes, streak, lastTaken }] */
    history: {},         /* { "pillId|YYYY-MM-DD|HH:MM": true } */
    reminders: false,
    lastReminderCheck: 0
  };

  let data = load();
  let _timer = null;

  /* ---------- storage ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(PILL_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_DATA));
      const p = JSON.parse(raw);
      return Object.assign(JSON.parse(JSON.stringify(DEFAULT_DATA)), p);
    } catch { return JSON.parse(JSON.stringify(DEFAULT_DATA)); }
  }
  function save() {
    localStorage.setItem(PILL_KEY, JSON.stringify(data));
    try {
      const st = JSON.parse(localStorage.getItem("flaren_v1") || "{}");
      st.pills = data;
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
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function escapeHTML(str) {
    return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  /* ---------- reminder check ---------- */
  function checkNow() {
    if (!data.reminders) return;
    const now = new Date();
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const today = todayKey();

    data.pills.forEach(pill => {
      (pill.times || []).forEach(t => {
        if (t !== hhmm) return;
        const key = `${pill.id}|${today}|${t}`;
        if (data.history[key]) return;

        /* Notify */
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            const n = new Notification("💊 " + pill.name, {
              body: pill.dose ? `${pill.dose} — take now` : "Time to take your medication",
              icon: "images/logo.png",
              tag: "pill-" + key,
              requireInteraction: true
            });
            n.onclick = () => { window.focus(); n.close(); };
          } catch {}
        }

        /* Also push to ntfy via backend if signed in */
        try {
          if (window.FlarenAPI && window.FlarenToken.get()) {
            window.FlarenAPI.api("/api/pill-reminder", {
              method: "POST",
              auth: true,
              body: { pillName: pill.name, dose: pill.dose, time: t }
            }).catch(() => {});
          }
        } catch {}

        if (typeof window.__flarenToast === "function") {
          window.__flarenToast("💊 Time for " + pill.name);
        }
      });
    });
  }

  function start() {
    if (_timer) clearInterval(_timer);
    checkNow();
    _timer = setInterval(checkNow, 60 * 1000);   /* every minute */
  }
  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  /* ---------- streak ---------- */
  function pillStreak(pill) {
    /* Count consecutive days where all times were marked */
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 90; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const allTaken = (pill.times || []).every(t => data.history[`${pill.id}|${key}|${t}`]);
      if (allTaken) streak++;
      else if (i === 0) continue;    /* today might not be complete yet */
      else break;
    }
    return streak;
  }

  /* ---------- render ---------- */
  function render(el) {
    start();
    draw(el);
  }

  function draw(el) {
    const pills = data.pills || [];
    const takenToday = (pill) => (pill.times || []).filter(t => data.history[`${pill.id}|${todayKey()}|${t}`]).length;
    const totalDoses = pills.reduce((s, p) => s + (p.times || []).length, 0);
    const takenDoses = pills.reduce((s, p) => s + takenToday(p), 0);

    el.innerHTML = `
      <header class="topbar">
        <div>
          <h2>Pill Reminder 💊</h2>
          <p>Never miss a dose. Track your streak.</p>
        </div>
        <button class="btn btn-primary" id="addPill">+ Add medication</button>
      </header>

      <!-- SAFETY DISCLAIMER — DO NOT REMOVE -->
      <div class="pill-disclaimer">
        <span class="pill-disclaimer-icon">⚠️</span>
        <div>
          <strong>Not medical advice.</strong>
          <p>This tool reminds you but does not guarantee delivery. Always follow your doctor's instructions. Never stop or change medication without consulting a physician.</p>
        </div>
      </div>

      ${pills.length === 0 ? `
        <div class="empty">
          <p style="margin-bottom:14px">No medications added yet.</p>
          <button class="btn btn-primary" id="firstPill">+ Add your first medication</button>
        </div>
      ` : `
        <div class="pill-summary">
          <div class="pill-summary-item">
            <div class="pill-summary-num">${takenDoses}<span>/${totalDoses}</span></div>
            <div class="pill-summary-label">Today's doses</div>
          </div>
          <div class="pill-summary-item">
            <div class="pill-summary-num">${pills.length}</div>
            <div class="pill-summary-label">Medications</div>
          </div>
          <div class="pill-summary-item">
            <div class="pill-summary-num">${data.reminders ? "On" : "Off"}</div>
            <div class="pill-summary-label">Reminders</div>
          </div>
        </div>

        <div class="pill-actions-row">
          <label class="pomo-check">
            <input type="checkbox" id="pillRemindersToggle" ${data.reminders ? "checked" : ""} />
            Enable pill reminders
          </label>
        </div>

        <div class="pill-list">
          ${pills.map(pill => {
            const taken = takenToday(pill);
            const total = (pill.times || []).length;
            const done = total > 0 && taken === total;
            const streak = pillStreak(pill);
            return `
              <div class="pill-card ${done ? "done" : ""}">
                <div class="pill-card-head">
                  <div class="pill-icon">💊</div>
                  <div class="pill-info">
                    <h4>${escapeHTML(pill.name)}</h4>
                    <p>${escapeHTML(pill.dose || "")}${pill.notes ? " · " + escapeHTML(pill.notes) : ""}</p>
                  </div>
                  <div class="pill-streak">
                    <span class="pill-streak-num">${streak}</span>
                    <span class="pill-streak-lbl">day${streak === 1 ? "" : "s"}</span>
                  </div>
                  <button class="pill-menu" data-edit="${pill.id}" title="Edit">✎</button>
                  <button class="pill-menu pill-danger" data-del="${pill.id}" title="Delete">×</button>
                </div>
                <div class="pill-times">
                  ${(pill.times || []).map(t => {
                    const takenKey = `${pill.id}|${todayKey()}|${t}`;
                    const isTaken = !!data.history[takenKey];
                    return `
                      <button class="pill-time ${isTaken ? "taken" : ""}" data-pill="${pill.id}" data-time="${t}">
                        <span class="pill-time-hh">${t}</span>
                        <span class="pill-time-status">${isTaken ? "✓ taken" : "tap to mark"}</span>
                      </button>
                    `;
                  }).join("")}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `}
    `;

    if (pills.length === 0) {
      const btn = document.getElementById("firstPill");
      if (btn) btn.addEventListener("click", () => openPillModal());
    }
    $("#addPill").addEventListener("click", () => openPillModal());

    const toggle = document.getElementById("pillRemindersToggle");
    if (toggle) {
      toggle.addEventListener("change", async () => {
        data.reminders = toggle.checked;
        if (data.reminders && typeof Notification !== "undefined" && Notification.permission !== "granted") {
          try { await Notification.requestPermission(); } catch {}
        }
        save();
        draw(el);
      });
    }

    $$(".pill-menu[data-edit]").forEach(b => b.addEventListener("click", () => {
      const p = data.pills.find(x => x.id === b.dataset.edit);
      if (p) openPillModal(p);
    }));
    $$(".pill-menu[data-del]").forEach(b => b.addEventListener("click", () => {
      if (!confirm("Delete this medication?")) return;
      data.pills = data.pills.filter(x => x.id !== b.dataset.del);
      save(); draw(el);
    }));

    $$(".pill-time").forEach(btn => btn.addEventListener("click", () => {
      const key = `${btn.dataset.pill}|${todayKey()}|${btn.dataset.time}`;
      if (data.history[key]) delete data.history[key];
      else data.history[key] = true;
      save(); draw(el);
    }));
  }

  /* ---------- modal ---------- */
  function openPillModal(existing) {
    const isEdit = !!existing;
    const p = existing || { id: uid(), name: "", dose: "", times: ["08:00"], notes: "" };

    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal">
        <h3>${isEdit ? "Edit" : "Add"} medication</h3>
        <div class="form-col"><input id="pillName" placeholder="Medication name (e.g. Vitamin D)" value="${escapeHTML(p.name)}" /></div>
        <div class="form-col"><input id="pillDose" placeholder="Dose (e.g. 1 tablet, 500mg)" value="${escapeHTML(p.dose || "")}" /></div>
        <div class="form-col">
          <label class="auth-label">Reminder times</label>
          <div id="pillTimes">
            ${(p.times || []).map(t => timeRowHTML(t)).join("")}
          </div>
          <button type="button" class="btn btn-small btn-secondary" id="addTime" style="margin-top:10px">+ Add time</button>
        </div>
        <div class="form-col"><input id="pillNotes" placeholder="Notes (optional)" value="${escapeHTML(p.notes || "")}" /></div>
        <p class="pill-modal-warning">⚠️ This is a reminder tool, not medical advice. Only take medications as prescribed by your doctor.</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="pillCancel">Cancel</button>
          <button class="btn btn-primary" id="pillSave">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.body.classList.add("modal-open");

    function timeRowHTML(t) {
      return `<div class="pill-time-row">
        <input type="time" class="pill-time-input" value="${t}" />
        <button type="button" class="btn btn-small btn-danger pill-time-remove">×</button>
      </div>`;
    }
    function bindTimeRows() {
      $$(".pill-time-remove", modal).forEach(b => b.addEventListener("click", () => {
        b.parentElement.remove();
      }));
    }
    bindTimeRows();

    $("#addTime", modal).addEventListener("click", () => {
      const div = document.createElement("div");
      div.innerHTML = timeRowHTML("12:00");
      $("#pillTimes", modal).appendChild(div.firstElementChild);
      bindTimeRows();
    });

    function close() {
      modal.remove();
      if (!document.querySelector(".modal-backdrop")) document.body.classList.remove("modal-open");
    }
    $("#pillCancel", modal).addEventListener("click", close);
    $("#pillSave", modal).addEventListener("click", async () => {
      const name = $("#pillName", modal).value.trim();
      if (!name) { alert("Name is required"); return; }
      const times = $$(".pill-time-input", modal).map(i => i.value).filter(Boolean);

      const updated = {
        name,
        dose: $("#pillDose", modal).value.trim(),
        times,
        notes: $("#pillNotes", modal).value.trim()
      };

      if (isEdit) Object.assign(p, updated);
      else data.pills.push({ id: p.id, ...updated });

      if (times.length > 0) {
        data.reminders = true;
        if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
          try { await Notification.requestPermission(); } catch {}
        }
      }

      save();
      close();
      draw(document.getElementById("pageContent"));
    });
  }

  /* ---------- public ---------- */
  window.FlarenPill = {
    render: render,
    stop: stop,
    getData: () => data
  };
})();
