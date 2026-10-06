/* =========================================================
   FLAREN — Calendar v2 (fixed)
   Month/Week/Day, recurring events, DnD, search, filters,
   multiple reminders, import/export, toasts + notifications.
   ========================================================= */

(function () {
  "use strict";

  const CAL_KEY = "flaren_calendar_v2";
  const LEGACY_KEY = "flaren_calendar_v1";
  const NOTIFIED_KEY = "flaren_cal_notified_v2";

  const COLOURS = [
    { id: "flame",  label: "Flame",  hex: "#FF7A18" },
    { id: "cyan",   label: "Cyan",   hex: "#22D3EE" },
    { id: "violet", label: "Violet", hex: "#A855F7" },
    { id: "pink",   label: "Pink",   hex: "#EC4899" },
    { id: "green",  label: "Green",  hex: "#22C55E" },
    { id: "amber",  label: "Amber",  hex: "#F59E0B" }
  ];

  const RECURRENCE_PRESETS = [
    { id: "none",     label: "Does not repeat" },
    { id: "daily",    label: "Daily" },
    { id: "weekly",   label: "Weekly" },
    { id: "weekdays", label: "Weekdays (Mon–Fri)" },
    { id: "custom",   label: "Custom (select days)" }
  ];

  /* ---------- State ---------- */
  let events = [];
  let notified = new Set();
  let viewYear, viewMonth, viewDay;
  let viewMode = "month";
  let selectedDay = null;
  let searchQuery = "";
  let filterColours = new Set();
  let dragEventId = null;
  let _interval = null;

  /* ---------- Storage ---------- */
  function load() {
    try {
      let raw = localStorage.getItem(CAL_KEY);
      if (!raw) {
        /* migrate from v1 */
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          const parsed = JSON.parse(legacy);
          /* v1 events lack recurrence/reminders — normalize them */
          return (Array.isArray(parsed) ? parsed : []).map(ev => ({
            id: ev.id || uid(),
            title: ev.title || "",
            date: ev.date || "",
            time: ev.time || "",
            colour: ev.colour || "flame",
            notes: ev.notes || "",
            recurrence: "none",
            recurrenceDays: [],
            reminders: ev.reminder ? [{ type: "before", minutes: 10 }] : []
          }));
        }
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function save() {
    localStorage.setItem(CAL_KEY, JSON.stringify(events));
    try {
      const st = JSON.parse(localStorage.getItem("flaren_v1") || "{}");
      st.calendar = events;
      localStorage.setItem("flaren_v1", JSON.stringify(st));
      if (typeof window.__flarenSaveData === "function") window.__flarenSaveData();
    } catch {}
  }
  function loadNotified() {
    try {
      const raw = localStorage.getItem(NOTIFIED_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  }
  function saveNotified() {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notified]));
  }

  /* ---------- Helpers ---------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function pad(n) { return String(n).padStart(2, "0"); }
  function dayKey(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
  function todayKey() {
    const d = new Date();
    return dayKey(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function monthName(m) {
    return ["January","February","March","April","May","June","July",
            "August","September","October","November","December"][m];
  }
  function dayNameShort(d) { return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]; }
  function escapeHTML(str) {
    return String(str)
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }
  function colourHex(id) {
    const c = COLOURS.find(x => x.id === id);
    return c ? c.hex : "#FF7A18";
  }
  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return { y, m: m - 1, d };
  }
  function addDays(key, delta) {
    const { y, m, d } = parseDateKey(key);
    const dt = new Date(y, m, d + delta);
    return dayKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }
  function isToday(key) { return key === todayKey(); }
  function weekdayIndex(key) {
    const { y, m, d } = parseDateKey(key);
    return new Date(y, m, d).getDay();
  }
  function isWeekday(key) {
    const wd = weekdayIndex(key);
    return wd >= 1 && wd <= 5;
  }

  /* ---------- Recurrence ---------- */
  function matchesRecurrence(event, key) {
    const rec = event.recurrence || "none";
    if (rec === "none") return key === event.date;
    if (rec === "daily") return true;
    if (rec === "weekly") return weekdayIndex(key) === weekdayIndex(event.date);
    if (rec === "weekdays") return isWeekday(key);
    if (rec === "custom") {
      const days = event.recurrenceDays || [];
      return days.includes(weekdayIndex(key));
    }
    return false;
  }

  function expandEventInstances(event, startKey, endKey) {
    if (!event.recurrence || event.recurrence === "none") {
      if (event.date >= startKey && event.date <= endKey) {
        return [{ ...event, masterId: event.id }];
      }
      return [];
    }

    const out = [];
    let cursor = new Date(event.date + "T00:00:00");
    const end = new Date(endKey + "T23:59:59");
    let safety = 0;
    while (cursor <= end && safety < 3000) {
      safety++;
      const cKey = dayKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      if (cKey >= event.date && cKey >= startKey && cKey <= endKey && matchesRecurrence(event, cKey)) {
        out.push({ ...event, date: cKey, masterId: event.id });
      }
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    return out;
  }

  function allExpandedInstances(startKey, endKey) {
    const list = [];
    events.forEach(ev => list.push(...expandEventInstances(ev, startKey, endKey)));
    return list;
  }

  function applyFilters(list) {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e =>
        (e.title || "").toLowerCase().includes(q) ||
        (e.notes || "").toLowerCase().includes(q)
      );
    }
    if (filterColours.size > 0) {
      list = list.filter(e => filterColours.has(e.colour));
    }
    return list;
  }

  function eventsForDay(key, startKey, endKey) {
    const s = startKey || key;
    const e = endKey || key;
    let list = allExpandedInstances(s, e).filter(x => x.date === key);
    list = applyFilters(list);
    list.sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    return list;
  }

  function upcomingEvents(fromKey, limit) {
    const endKey = addDays(fromKey, 60);
    let list = allExpandedInstances(fromKey, endKey)
      .filter(e => e.date >= fromKey)
      .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    list = applyFilters(list);
    return list.slice(0, limit || 10);
  }

  /* ---------- Notifications ---------- */
  function instanceNotifiedKey(ev) {
    return `${ev.masterId || ev.id}|${ev.date}`;
  }

  function checkEventReminders() {
    const now = new Date();
    const nowTs = now.getTime();
    const windowMs = 5 * 60 * 1000;
    let fired = false;

    const startKey = dayKey(now.getFullYear(), now.getMonth(), now.getDate());
    const endKey = addDays(startKey, 1);
    const candidates = allExpandedInstances(startKey, endKey);

    candidates.forEach(e => {
      if (!Array.isArray(e.reminders) || e.reminders.length === 0) return;
      if (!e.date || !e.time) return;

      const [y, m, d] = e.date.split("-").map(Number);
      const [hh, mm] = e.time.split(":").map(Number);
      const when = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();

      e.reminders.forEach(off => {
        if (!off || typeof off.minutes !== "number") return;
        const trig = off.type === "before" ? when - off.minutes * 60000 : when + off.minutes * 60000;
        const key = instanceNotifiedKey(e) + `|${off.type}|${off.minutes}`;
        if (trig <= nowTs && trig > nowTs - windowMs && !notified.has(key)) {
          sendNotification(e, off, when);
          notified.add(key);
          fired = true;
        }
      });
    });

    if (fired) saveNotified();
  }

  function sendNotification(ev, reminder, eventTimeMs) {
    const whenStr = new Date(eventTimeMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const label = reminder.type === "before"
      ? `in ${reminder.minutes} min`
      : `${reminder.minutes} min after start`;
    const body = `${ev.title} · ${ev.time || ""} (${label})`.trim();

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const n = new Notification("📅 " + ev.title, {
          body, icon: "images/logo.png",
          tag: "flaren-event-" + (ev.masterId || ev.id) + "-" + ev.date
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch {}
    }
    showToast(`📅 ${ev.title} · ${whenStr}`, body);
  }

  function startReminders() {
    if (_interval) clearInterval(_interval);
    checkEventReminders();
    _interval = setInterval(checkEventReminders, 30 * 1000);
  }

  function stop() {
    if (_interval) { clearInterval(_interval); _interval = null; }
  }

  /* ---------- Toasts ---------- */
  function showToast(title, message) {
    let container = document.getElementById("flaren-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "flaren-toast-container";
      container.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;";
      document.body.appendChild(container);
    }
    const t = document.createElement("div");
    t.style.cssText = "background:#111827;color:#fff;padding:12px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.35);max-width:260px;font-size:13px;line-height:1.3;";
    t.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px">${escapeHTML(title)}</div>
      <div style="opacity:0.9;white-space:pre-wrap">${escapeHTML(message)}</div>
    `;
    container.appendChild(t);
    setTimeout(() => {
      t.style.transition = "opacity .25s ease, transform .25s ease";
      t.style.opacity = "0";
      t.style.transform = "translateY(6px)";
      setTimeout(() => t.remove(), 260);
    }, 3500);
  }

  /* ---------- Public render ---------- */
  function render(el) {
    /* FIX: load events + notified every time the page opens */
    events = load();
    notified = loadNotified();

    const now = new Date();
    if (viewYear == null) {
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      viewDay = now.getDate();
    }
    selectedDay = selectedDay || todayKey();
    startReminders();
    setupGlobalShortcuts();
    draw(el);
  }

  /* ---------- Keyboard shortcuts ---------- */
  function setupGlobalShortcuts() {
    if (window.__flarenCalendarShortcutsSetup) return;
    window.__flarenCalendarShortcutsSetup = true;

    document.addEventListener("keydown", (e) => {
      if (document.getElementById("pageContent")?.querySelector(".cal-v2") == null) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || e.isComposing) return;

      const k = e.key.toLowerCase();
      if (k === "m") { viewMode = "month"; draw(document.getElementById("pageContent")); e.preventDefault(); }
      else if (k === "w") { viewMode = "week"; draw(document.getElementById("pageContent")); e.preventDefault(); }
      else if (k === "d") { viewMode = "day"; draw(document.getElementById("pageContent")); e.preventDefault(); }
      else if (k === "arrowleft")  { moveFocus(-1); e.preventDefault(); }
      else if (k === "arrowright") { moveFocus(1); e.preventDefault(); }
      else if (k === "t") { goToToday(); e.preventDefault(); }
      else if (k === "n") { openEventModal(); e.preventDefault(); }
      else if (k === "f") {
        const inp = document.getElementById("calSearch");
        if (inp) { inp.focus(); e.preventDefault(); }
      }
    });
  }

  function moveFocus(delta) {
    const base = selectedDay || todayKey();
    const nk = addDays(base, delta);
    const { y, m, d } = parseDateKey(nk);
    viewYear = y; viewMonth = m; viewDay = d;
    selectedDay = nk;
    draw(document.getElementById("pageContent"));
  }

  function goToToday() {
    const t = new Date();
    viewYear = t.getFullYear();
    viewMonth = t.getMonth();
    viewDay = t.getDate();
    selectedDay = todayKey();
    draw(document.getElementById("pageContent"));
  }

  /* ---------- drawBase ---------- */
  /* FIX: named drawBase so we can safely wrap it with a draw() that binds events */
  function drawBase(el) {
    el.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "cal-v2";

    wrapper.innerHTML = `
      <header class="cal-topbar">
        <div class="cal-head-left">
          <h2>Calendar 📅</h2>
          <p>Plan your days, colour your events.</p>
        </div>
        <div class="cal-head-right">
          <div class="cal-search-wrap">
            <input id="calSearch" type="text" placeholder="Search events..." value="${escapeHTML(searchQuery)}" />
          </div>
          <button class="btn btn-primary" id="calAdd">+ New event</button>
          <button class="btn btn-secondary" id="calExport">⬇ Export</button>
          <label class="btn btn-secondary" for="calImport" style="cursor:pointer">⬆ Import</label>
          <input id="calImport" type="file" accept=".json,.ics" style="display:none" />
        </div>
      </header>

      <div class="cal-toolbar">
        <div class="cal-view-tabs">
          <button class="cal-tab ${viewMode === "month" ? "active" : ""}" data-mode="month">Month</button>
          <button class="cal-tab ${viewMode === "week" ? "active" : ""}" data-mode="week">Week</button>
          <button class="cal-tab ${viewMode === "day" ? "active" : ""}" data-mode="day">Day</button>
        </div>

        <div class="cal-nav-group">
          <button class="cal-nav-btn" id="calPrev" aria-label="Previous">‹</button>
          <button class="cal-nav-btn" id="calTodayBtn">Today</button>
          <button class="cal-nav-btn" id="calNext" aria-label="Next">›</button>
          <h3 class="cal-title">${buildTitleText()}</h3>
        </div>

        <div class="cal-filters">
          <div class="cal-colour-filters">
            ${COLOURS.map(c => `
              <button type="button"
                      class="cal-filter-chip ${filterColours.has(c.id) ? "active" : ""}"
                      data-c="${c.id}"
                      style="border-color:${colourHex(c.id)};color:${colourHex(c.id)}"
                      title="${c.label}">
                ${c.label}
              </button>
            `).join("")}
            <button class="btn btn-small btn-secondary" id="calClearFilters">Clear</button>
          </div>
        </div>
      </div>

      <div class="cal-layout">
        <div class="cal-main">
          ${viewMode === "month" ? renderMonthView() : viewMode === "week" ? renderWeekView() : renderDayView()}
        </div>

        <aside class="cal-side">
          <h4>${selectedDay ? "Events for " + selectedDay : "Upcoming"}</h4>
          <div class="cal-side-list" id="calSideList">
            ${renderSideList()}
          </div>
          <div class="cal-side-hints">
            <small>
              Shortcuts: M/W/D = views, ←/→ = move, T = today, N = new event, F = search.
            </small>
          </div>
        </aside>
      </div>
    `;

    el.appendChild(wrapper);
  }

  /* FIX: draw() wraps drawBase() and binds all handlers */
  function draw(el) {
    drawBase(el);

    /* Top bar bindings */
    const addBtn = $("#calAdd", el);
    if (addBtn) addBtn.addEventListener("click", () => openEventModal());
    const expBtn = $("#calExport", el);
    if (expBtn) expBtn.addEventListener("click", () => exportData());
    const impFile = $("#calImport", el);
    if (impFile) impFile.addEventListener("change", (e) => importData(e.target.files[0]));

    /* Navigation */
    $("#calPrev", el)?.addEventListener("click", () => {
      if (viewMode === "month") {
        viewMonth--;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      } else {
        const base = selectedDay || todayKey();
        const nk = addDays(base, viewMode === "week" ? -7 : -1);
        const { y, m, d } = parseDateKey(nk);
        viewYear = y; viewMonth = m; viewDay = d;
        selectedDay = nk;
      }
      draw(el);
    });
    $("#calNext", el)?.addEventListener("click", () => {
      if (viewMode === "month") {
        viewMonth++;
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      } else {
        const base = selectedDay || todayKey();
        const nk = addDays(base, viewMode === "week" ? 7 : 1);
        const { y, m, d } = parseDateKey(nk);
        viewYear = y; viewMonth = m; viewDay = d;
        selectedDay = nk;
      }
      draw(el);
    });
    $("#calTodayBtn", el)?.addEventListener("click", goToToday);

    /* View tabs */
    $$(".cal-tab", el).forEach(btn => {
      btn.addEventListener("click", () => {
        viewMode = btn.dataset.mode;
        draw(el);
      });
    });

    /* Colour filter chips */
    $$(".cal-filter-chip", el).forEach(btn => {
      btn.addEventListener("click", () => {
        const c = btn.dataset.c;
        if (filterColours.has(c)) filterColours.delete(c);
        else filterColours.add(c);
        draw(el);
      });
    });
    $("#calClearFilters", el)?.addEventListener("click", () => {
      filterColours.clear();
      searchQuery = "";
      draw(el);
    });

    /* Search */
    const searchInput = $("#calSearch", el);
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value;
        /* keep focus on this input after re-render */
        const caret = searchInput.selectionStart;
        draw(el);
        const ni = $("#calSearch", el);
        if (ni) { ni.focus(); ni.setSelectionRange(caret, caret); }
      });
    }

    /* Month cells — click, click-to-add via hover, drag-over highlight */
    $$(".cal-cell", el).forEach(btn => {
      const key = btn.dataset.key;
      btn.addEventListener("click", () => {
        selectedDay = (selectedDay === key) ? null : key;
        if (viewMode === "month") {
          const { y, m } = parseDateKey(key);
          viewYear = y; viewMonth = m;
        } else {
          const { y, m, d } = parseDateKey(key);
          viewYear = y; viewMonth = m; viewDay = d;
        }
        draw(el);
      });
      btn.addEventListener("dragover", (e) => { e.preventDefault(); btn.classList.add("drag-over"); });
      btn.addEventListener("dragleave", () => btn.classList.remove("drag-over"));
      btn.addEventListener("drop", (e) => {
        e.preventDefault();
        btn.classList.remove("drag-over");
        if (!dragEventId) return;
        const ev = events.find(x => x.id === dragEventId);
        if (!ev || ev.date === key) return;
        ev.date = key;
        save();
        dragEventId = null;
        draw(el);
      });
    });

    /* Week columns */
    $$(".cal-week-day-col", el).forEach(col => {
      col.addEventListener("click", () => {
        selectedDay = col.dataset.key;
        const { y, m, d } = parseDateKey(selectedDay);
        viewYear = y; viewMonth = m; viewDay = d;
        viewMode = "day";
        draw(el);
      });
    });

    /* Week events */
    $$(".cal-week-event", el).forEach(card => {
      const id = card.dataset.id;
      card.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-del]")) return;
        const e = events.find(x => x.id === id);
        if (e) openEventModal(e);
      });
      card.draggable = true;
      card.addEventListener("dragstart", (e) => {
        dragEventId = id;
        e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => {
        dragEventId = null;
        $$(".cal-cell", el).forEach(c => c.classList.remove("drag-over"));
      });
    });

    /* Day events */
    $$(".cal-day-event", el).forEach(card => {
      const id = card.dataset.id;
      card.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-del]")) return;
        const e = events.find(x => x.id === id);
        if (e) openEventModal(e);
      });
    });

    /* Side list — delete + edit */
    $$("#calSideList [data-del]", el).forEach(b => {
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const id = b.dataset.del;
        if (!events.find(x => x.id === id)) return;
        if (confirm("Delete this event? This will remove all future occurrences.")) {
          events = events.filter(x => x.id !== id);
          save();
          draw(el);
        }
      });
    });
    $$("#calSideList .cal-item", el).forEach(item => {
      item.addEventListener("click", (ev) => {
        if (ev.target.dataset.del) return;
        const id = item.dataset.id;
        const e = events.find(x => x.id === id);
        if (e) openEventModal(e);
      });
    });
  }

  function buildTitleText() {
    if (viewMode === "month") return `${monthName(viewMonth)} ${viewYear}`;
    if (viewMode === "week") {
      const base = selectedDay || todayKey();
      const { y, m, d } = parseDateKey(base);
      const dt = new Date(y, m, d);
      const s = new Date(dt); s.setDate(dt.getDate() - dt.getDay());
      const e = new Date(s); e.setDate(s.getDate() + 6);
      return `${dayNameShort(s.getDay())} ${s.getDate()} ${monthName(s.getMonth())} – ${dayNameShort(e.getDay())} ${e.getDate()} ${monthName(e.getMonth())} ${e.getFullYear()}`;
    }
    const key = selectedDay || todayKey();
    const { y, m, d } = parseDateKey(key);
    return `${dayNameShort(new Date(y, m, d).getDay())}, ${d} ${monthName(m)} ${y}`;
  }

  /* ---------- Month view ---------- */
  function renderMonthView() {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
    const tKey = todayKey();

    let cells = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      cells.push({ y: viewMonth === 0 ? viewYear - 1 : viewYear, m: viewMonth === 0 ? 11 : viewMonth - 1, d: prevMonthDays - i, dim: true });
    }
    for (let d = 1; d <= daysInMonth; d++) cells.push({ y: viewYear, m: viewMonth, d, dim: false });
    while (cells.length < 42) {
      const last = cells[cells.length - 1];
      let ny = last.y, nm = last.m + 1, nd = 1;
      if (nm > 11) { nm = 0; ny++; }
      cells.push({ y: ny, m: nm, d: nd, dim: true });
    }

    const startKey = dayKey(cells[0].y, cells[0].m, cells[0].d);
    const endKey = dayKey(cells[cells.length - 1].y, cells[cells.length - 1].m, cells[cells.length - 1].d);

    return `
      <div class="cal-head">
        <div class="cal-weekdays">
          ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(n => `<div class="cal-wd">${n}</div>`).join("")}
        </div>
      </div>
      <div class="cal-grid">
        ${cells.map(c => {
          const key = dayKey(c.y, c.m, c.d);
          const evs = eventsForDay(key, startKey, endKey);
          return `
            <button class="cal-cell ${c.dim ? "dim" : ""} ${key === tKey ? "today" : ""} ${key === selectedDay ? "sel" : ""}"
                    data-key="${key}" draggable="true">
              <span class="cal-num">${c.d}</span>
              <span class="cal-events">
                ${evs.slice(0, 4).map(e => `<span class="cal-dot" style="background:${colourHex(e.colour)}" title="${escapeHTML(e.title)} ${e.time || ""}"></span>`).join("")}
                ${evs.length > 4 ? `<span class="cal-more">+${evs.length - 4}</span>` : ""}
              </span>
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  /* ---------- Week view ---------- */
  function renderWeekView() {
    const base = selectedDay || todayKey();
    const { y, m, d } = parseDateKey(base);
    const dt = new Date(y, m, d);
    const s = new Date(dt); s.setDate(dt.getDate() - dt.getDay());
    const days = [];
    for (let i = 0; i < 7; i++) {
      const cur = new Date(s); cur.setDate(s.getDate() + i);
      days.push({
        key: dayKey(cur.getFullYear(), cur.getMonth(), cur.getDate()),
        label: `${dayNameShort(cur.getDay())} ${cur.getDate()}`
      });
    }
    const startKey = days[0].key;
    const endKey = days[6].key;

    return `
      <div class="cal-week-view">
        <div class="cal-week-header">
          ${days.map(d => `
            <div class="cal-week-day-col ${d.key === todayKey() ? "today" : ""} ${d.key === selectedDay ? "sel" : ""}" data-key="${d.key}">
              <div class="cal-week-day-label">${d.label}</div>
            </div>
          `).join("")}
        </div>
        <div class="cal-week-body">
          ${days.map(d => {
            const evs = eventsForDay(d.key, startKey, endKey);
            return `
              <div class="cal-week-day-cells" data-key="${d.key}">
                ${evs.map(e => `
                  <div class="cal-week-event" data-id="${e.masterId || e.id}" style="border-left-color:${colourHex(e.colour)}">
                    <div class="cal-week-event-title">${escapeHTML(e.title)}</div>
                    ${e.time ? `<div class="cal-week-event-time">${e.time}</div>` : ""}
                  </div>
                `).join("")}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  /* ---------- Day view ---------- */
  function renderDayView() {
    const key = selectedDay || todayKey();
    const { y, m, d } = parseDateKey(key);
    const evs = eventsForDay(key, key, key);

    return `
      <div class="cal-day-view">
        <div class="cal-day-header ${key === todayKey() ? "today" : ""}">
          <div class="cal-day-label">${dayNameShort(new Date(y, m, d).getDay())}, ${d} ${monthName(m)} ${y}</div>
        </div>
        <div class="cal-day-events">
          ${evs.length === 0 ? `<div class="empty">No events for this day.</div>` : ""}
          ${evs.map(e => `
            <div class="cal-day-event" data-id="${e.masterId || e.id}" style="border-left-color:${colourHex(e.colour)}">
              <div class="cal-day-event-head">
                <strong>${escapeHTML(e.title)}</strong>
                ${e.time ? `<span class="cal-day-event-time">${e.time}</span>` : ""}
              </div>
              ${e.notes ? `<div class="cal-day-event-notes">${escapeHTML(e.notes)}</div>` : ""}
              <div class="cal-day-event-meta">
                ${e.recurrence && e.recurrence !== "none" ? `<span class="tag">Repeats: ${recurrenceLabel(e.recurrence)}</span>` : ""}
                ${Array.isArray(e.reminders) && e.reminders.length > 0 ? `<span class="tag">Reminders: ${e.reminders.length}</span>` : ""}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function recurrenceLabel(rec) {
    const p = RECURRENCE_PRESETS.find(x => x.id === rec);
    return p ? p.label : rec;
  }

  /* ---------- Side list ---------- */
  function renderSideList() {
    const list = selectedDay
      ? eventsForDay(selectedDay, selectedDay, selectedDay)
      : upcomingEvents(selectedDay || todayKey(), 10);

    if (!list.length) return `<div class="empty">Nothing scheduled.</div>`;
    return list.map(e => `
      <div class="cal-item" data-id="${e.masterId || e.id}">
        <span class="cal-colour" style="background:${colourHex(e.colour)}"></span>
        <div class="cal-item-body">
          <strong>${escapeHTML(e.title)}</strong>
          <small>${e.date}${e.time ? " · " + e.time : ""}</small>
        </div>
        <button class="cal-item-del" data-del="${e.masterId || e.id}" title="Delete">×</button>
      </div>
    `).join("");
  }

  /* ---------- Event modal ---------- */
  function openEventModal(existing) {
    const isEdit = !!existing;
    const baseDate = selectedDay || todayKey();

    const e = existing || {
      id: uid(),
      title: "",
      date: baseDate,
      time: "",
      colour: "flame",
      notes: "",
      recurrence: "none",
      recurrenceDays: [],
      reminders: [{ type: "before", minutes: 10 }]
    };

    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal modal-wide">
        <h3>${isEdit ? "Edit" : "New"} event</h3>
        <div class="form-col"><label class="auth-label">Title<input id="ceTitle" placeholder="Event title" value="${escapeHTML(e.title)}" /></label></div>
        <div class="form-row">
          <label class="auth-label">Date<input id="ceDate" type="date" value="${e.date}" /></label>
          <label class="auth-label">Time<input id="ceTime" type="time" value="${e.time}" /></label>
        </div>
        <div class="form-col">
          <label class="auth-label">Colour</label>
          <div class="cal-colours" id="ceColours">
            ${COLOURS.map(c => `<button type="button" class="cal-colour-opt ${c.id === e.colour ? "sel" : ""}" data-c="${c.id}" style="background:${c.hex}" title="${c.label}"></button>`).join("")}
          </div>
        </div>
        <div class="form-row">
          <label class="auth-label" style="flex:1">Recurrence
            <select id="ceRecurrence">
              ${RECURRENCE_PRESETS.map(p => `<option value="${p.id}" ${p.id === e.recurrence ? "selected" : ""}>${p.label}</option>`).join("")}
            </select>
          </label>
        </div>
        <div id="ceRecDaysWrap" class="form-col" style="display:${e.recurrence === "custom" ? "block" : "none"}">
          <label class="auth-label">Repeat on</label>
          <div class="cal-rec-days">
            ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((n, i) => `
              <label class="cal-rec-day-chip">
                <input type="checkbox" value="${i}" ${e.recurrenceDays.includes(i) ? "checked" : ""} />
                <span>${n}</span>
              </label>
            `).join("")}
          </div>
        </div>
        <div class="form-col">
          <label class="auth-label">Reminders</label>
          <div id="ceRemindersList"></div>
          <button class="btn btn-small btn-secondary" id="ceAddReminder">+ Add reminder</button>
        </div>
        <div class="form-col"><label class="auth-label">Notes<textarea id="ceNotes" placeholder="Additional details...">${escapeHTML(e.notes)}</textarea></label></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="ceCancel">Cancel</button>
          <button class="btn btn-primary" id="ceSave">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.body.classList.add("modal-open");

    let colour = e.colour;
    $$(".cal-colour-opt", modal).forEach(b => {
      b.addEventListener("click", () => {
        colour = b.dataset.c;
        $$(".cal-colour-opt", modal).forEach(x => x.classList.toggle("sel", x === b));
      });
    });

    const recSelect = $("#ceRecurrence", modal);
    const recDaysWrap = $("#ceRecDaysWrap", modal);
    recSelect.addEventListener("change", () => {
      recDaysWrap.style.display = recSelect.value === "custom" ? "block" : "none";
    });

    const remindersList = $("#ceRemindersList", modal);
    let localReminders = Array.isArray(e.reminders) ? e.reminders.map(r => ({ ...r })) : [];

    function renderReminders() {
      if (!localReminders.length) {
        remindersList.innerHTML = `<div class="empty">No reminders yet.</div>`;
        return;
      }
      remindersList.innerHTML = localReminders.map((r, i) => `
        <div class="cal-reminder-row">
          <select data-idx="${i}" class="cal-rem-type">
            <option value="before" ${r.type === "before" ? "selected" : ""}>Before</option>
            <option value="after" ${r.type === "after" ? "selected" : ""}>After</option>
          </select>
          <input type="number" min="0" step="1" value="${r.minutes}" data-idx="${i}" class="cal-rem-min" />
          <span>minutes</span>
          <button class="btn btn-small btn-secondary cal-rem-del" data-idx="${i}">Remove</button>
        </div>
      `).join("");
      $$(".cal-rem-type", remindersList).forEach(sel => sel.addEventListener("change", () => { localReminders[+sel.dataset.idx].type = sel.value; }));
      $$(".cal-rem-min", remindersList).forEach(inp => inp.addEventListener("input", () => { localReminders[+inp.dataset.idx].minutes = Number(inp.value) || 0; }));
      $$(".cal-rem-del", remindersList).forEach(btn => btn.addEventListener("click", () => { localReminders.splice(+btn.dataset.idx, 1); renderReminders(); }));
    }
    renderReminders();
    $("#ceAddReminder", modal).addEventListener("click", () => { localReminders.push({ type: "before", minutes: 10 }); renderReminders(); });

    function close() {
      modal.remove();
      if (!document.querySelector(".modal-backdrop")) document.body.classList.remove("modal-open");
    }
    $("#ceCancel", modal).addEventListener("click", close);

    $("#ceSave", modal).addEventListener("click", async () => {
      const title = $("#ceTitle", modal).value.trim();
      const date = $("#ceDate", modal).value;
      const time = $("#ceTime", modal).value;
      const notes = $("#ceNotes", modal).value.trim();
      const recurrence = recSelect.value;
      const recurrenceDays = recurrence === "custom"
        ? $$(".cal-rec-day-chip input:checked", modal).map(cb => +cb.value)
        : [];

      if (!title) { alert("Title is required"); return; }
      if (!date)  { alert("Date is required"); return; }

      const data = { title, date, time, colour, notes, recurrence, recurrenceDays, reminders: localReminders };

      if (isEdit) Object.assign(e, data);
      else events.push({ id: e.id, ...data });

      save();

      if (data.reminders && data.reminders.length) {
        if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
          try { await Notification.requestPermission(); } catch {}
        }
      }

      close();
      draw(document.getElementById("pageContent"));
    });
  }

  /* ---------- Import / Export ---------- */
  function exportData() {
    const payload = { version: 2, exportedAt: new Date().toISOString(), events };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flaren-calendar-export.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        let imported = [];
        if (file.name.endsWith(".ics")) {
          imported = parseIcsToEvents(text);
        } else {
          const data = JSON.parse(text);
          if (Array.isArray(data.events)) imported = data.events;
          else if (Array.isArray(data)) imported = data;
          else throw new Error("Invalid JSON structure");
        }
        if (!imported.length) { alert("No events found in file."); return; }
        if (!confirm(`Import ${imported.length} events? They will be merged with your calendar.`)) return;
        const existingIds = new Set(events.map(e => e.id));
        imported.forEach(ev => {
          if (!ev.id) ev.id = uid();
          if (!existingIds.has(ev.id)) events.push(ev);
        });
        save();
        draw(document.getElementById("pageContent"));
        showToast("Import successful", `${imported.length} events added.`);
      } catch (err) {
        alert("Failed to import: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  function parseIcsToEvents(text) {
    /* Unfold lines: lines starting with space/tab continue previous */
    const raw = text.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
    const out = [];
    let cur = null;
    function finish() {
      if (!cur) return;
      if (cur.title && cur.date) out.push({
        id: uid(),
        title: cur.title,
        date: cur.date,
        time: cur.time || "",
        colour: "flame",
        notes: cur.notes || "",
        recurrence: "none",
        recurrenceDays: [],
        reminders: []
      });
      cur = null;
    }
    for (const line of raw) {
      if (line === "BEGIN:VEVENT") cur = {};
      else if (line === "END:VEVENT") finish();
      else if (cur) {
        if (line.startsWith("SUMMARY:")) cur.title = line.slice(8).replace(/\\,/g, ",").replace(/\\n/g, "\n");
        else if (line.startsWith("DESCRIPTION:")) cur.notes = line.slice(12).replace(/\\,/g, ",").replace(/\\n/g, "\n");
        else if (line.startsWith("DTSTART;VALUE=DATE:")) {
          const d = line.slice(19);
          if (/^\d{8}$/.test(d)) cur.date = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
        } else if (line.startsWith("DTSTART:")) {
          const raw = line.slice(8).replace("Z", "");
          if (/^\d{8}T\d{6}$/.test(raw)) {
            cur.date = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
            cur.time = `${raw.slice(9,11)}:${raw.slice(11,13)}`;
          }
        }
      }
    }
    finish();
    return out;
  }

  /* ---------- Public API ---------- */
  window.FlarenCalendar = {
    render: function (el) { render(el); },
    stop: function () { stop(); },
    mergeFromServer: function (remoteEvents) {
      if (!Array.isArray(remoteEvents)) return;
      events = remoteEvents;
      localStorage.setItem(CAL_KEY, JSON.stringify(events));
    },
    getAll: function () { return events; }
  };
})();