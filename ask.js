/* =========================================================
   FLAREN — Ask Flaren (rule-based assistant)
   Works offline. No API key. Free forever.
   ========================================================= */

(function () {
  "use strict";

  const HISTORY_KEY = "flaren_ask_history_v1";
  const MAX_HISTORY = 40;

  let history = load();
  let _panelOpen = false;

  /* ---------- storage ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function save() {
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  /* ---------- helpers ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function dayKeyFromDate(dt) {
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }
  function escapeHTML(str) {
    return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- date parsing ---------- */
  /* Returns { date: "YYYY-MM-DD", time: "HH:MM"|null, rest: "text without date words" } */
  function parseDateAndTime(text) {
    const original = text;
    let date = null;
    let time = null;
    let cleaned = text;

    const lower = text.toLowerCase();

    /* today / tomorrow / day after tomorrow */
    if (/\btomorrow\b/.test(lower)) {
      const d = new Date(); d.setDate(d.getDate() + 1);
      date = dayKeyFromDate(d);
      cleaned = cleaned.replace(/tomorrow/i, "").trim();
    } else if (/\btoday\b/.test(lower)) {
      date = todayKey();
      cleaned = cleaned.replace(/\btoday\b/i, "").trim();
    } else if (/\bday after tomorrow\b/.test(lower)) {
      const d = new Date(); d.setDate(d.getDate() + 2);
      date = dayKeyFromDate(d);
      cleaned = cleaned.replace(/day after tomorrow/i, "").trim();
    }

    /* weekday names */
    if (!date) {
      const weekdays = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
      const match = lower.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
      if (match) {
        const target = weekdays[match[1]];
        const now = new Date();
        let delta = (target - now.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        const d = new Date(); d.setDate(d.getDate() + delta);
        date = dayKeyFromDate(d);
        cleaned = cleaned.replace(new RegExp("\\b" + match[1] + "\\b", "i"), "").trim();
      }
    }

    /* explicit dates like "oct 12" or "12 oct" or "12/10" or "2026-10-12" */
    if (!date) {
      const monthNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
      let m;
      m = cleaned.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
      if (m) {
        date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
        cleaned = cleaned.replace(m[0], "").trim();
      }
      if (!date) {
        m = cleaned.match(new RegExp("\\b(" + monthNames.join("|") + ")[a-z]*\\s+(\\d{1,2})\\b", "i"));
        if (m) {
          const mo = monthNames.indexOf(m[1].slice(0,3).toLowerCase());
          const day = parseInt(m[2], 10);
          const now = new Date();
          let year = now.getFullYear();
          if (mo < now.getMonth()) year++;
          date = `${year}-${pad(mo + 1)}-${pad(day)}`;
          cleaned = cleaned.replace(m[0], "").trim();
        }
      }
      if (!date) {
        m = cleaned.match(/\b(\d{1,2})\/(\d{1,2})\b/);
        if (m) {
          const now = new Date();
          date = `${now.getFullYear()}-${pad(m[2])}-${pad(m[1])}`;
          cleaned = cleaned.replace(m[0], "").trim();
        }
      }
    }

    /* time like 3pm, 3 pm, 15:30, 3:30pm */
    const timeMatch = cleaned.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (timeMatch) {
      let hh = parseInt(timeMatch[1], 10);
      const mm = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const ap = (timeMatch[3] || "").toLowerCase();
      if (ap === "pm" && hh < 12) hh += 12;
      if (ap === "am" && hh === 12) hh = 0;
      if (ap || timeMatch[2]) {
        time = `${pad(hh)}:${pad(mm)}`;
        cleaned = cleaned.replace(timeMatch[0], "").trim();
      }
    }

    return { date, time, rest: cleaned.trim() || original.trim() };
  }

  /* ---------- reply builder ---------- */
  function reply(text, action, data) {
    return { text, action: action || null, data: data || null };
  }

  /* ---------- command parser ---------- */
  function parse(input) {
    const raw = input.trim();
    const lower = raw.toLowerCase();

    /* HELP */
    if (/^(help|commands|what can you do)\b/i.test(lower)) {
      return reply(
        "Here's what I can do:\n" +
        "• add task <title> [date] [time]\n" +
        "• add event <title> [date] [time]\n" +
        "• new note: <text>\n" +
        "• list my notes\n" +
        "• search notes for <word>\n" +
        "• add water <ml>\n" +
        "• how much water today\n" +
        "• how many plants grown\n" +
        "• what's my streak\n" +
        "• how many tasks completed today\n" +
        "• clear completed tasks\n" +
        "• what's on my calendar today\n" +
        "• start focus timer\n" +
        "• how focused was I today\n" +
        "• list services\n" +
        "• go to <dashboard|tasks|notes|water|calendar|focus|services|settings|games>"
      );
    }

    /* NAVIGATION */
    let m = lower.match(/^(go to|open|show me|navigate to)\s+(\w+)/);
    if (m) {
      const page = m[2];
      const allowed = ["dashboard","tasks","notes","water","calendar","focus","services","settings","games","favorites"];
      if (allowed.includes(page)) {
        return reply(`Opening ${page}…`, "navigate", { page });
      }
    }

    /* ADD TASK */
    m = raw.match(/^(?:add|create|new)\s+task\s+(.+)$/i);
    if (m) {
      const parsed = parseDateAndTime(m[1]);
      const title = parsed.rest || "Untitled task";
      return reply(`Task added: "${title}"${parsed.date ? ` on ${parsed.date}` : ""}${parsed.time ? ` at ${parsed.time}` : ""}.`, "add_task", {
        title,
        dueDate: parsed.date || "",
        dueTime: parsed.time || "",
        priority: "medium"
      });
    }

    /* ADD EVENT */
    m = raw.match(/^(?:add|create|new)\s+(?:event|appointment|meeting)\s+(.+)$/i);
    if (m) {
      const parsed = parseDateAndTime(m[1]);
      const title = parsed.rest || "Untitled event";
      if (!parsed.date) {
        return reply(`I need a date for "${title}". Try "add event ${title} tomorrow 3pm".`);
      }
      return reply(`Event added: "${title}" on ${parsed.date}${parsed.time ? ` at ${parsed.time}` : ""}.`, "add_event", {
        title,
        date: parsed.date,
        time: parsed.time || "",
        colour: "flame",
        notes: "",
        recurrence: "none",
        recurrenceDays: [],
        reminders: parsed.time ? [{ type: "before", minutes: 10 }] : []
      });
    }

    /* NEW NOTE */
    m = raw.match(/^(?:new note|add note|create note)[:\s]+(.+)$/i);
    if (m) {
      const body = m[1].trim();
      const title = body.split(/\s+/).slice(0, 6).join(" ").slice(0, 60);
      return reply(`Note saved: "${title}".`, "add_note", { title, body });
    }

    /* LIST NOTES */
    if (/^(?:list|show)\s+(?:my\s+)?notes\b/i.test(lower)) {
      return reply("Here are your notes.", "list_notes");
    }

    /* SEARCH NOTES */
    m = raw.match(/^search notes for\s+(.+)$/i);
    if (m) {
      return reply(`Filtering notes for "${m[1]}".`, "search_notes", { query: m[1] });
    }

    /* ADD WATER */
    m = raw.match(/^(?:add|log)\s+water\s+(\d+)\s*(?:ml|milliliters?)?\s*$/i);
    if (m) {
      const ml = parseInt(m[1], 10);
      return reply(`Logged ${ml} ml of water. 💧`, "add_water", { ml });
    }

    /* WATER STATUS */
    if (/(?:how much water|water today|my water)/i.test(lower)) {
      return reply("Checking your water intake…", "water_status");
    }

    /* PLANTS GROWN */
    if (/(?:how many plants|plants grown|how many blooms|garden)/i.test(lower)) {
      return reply("Checking your garden…", "plants_status");
    }

    /* STREAK */
    if (/(?:my streak|streak\b|how many days in a row)/i.test(lower)) {
      return reply("Checking your streak…", "streak_status");
    }

    /* TASKS COMPLETED TODAY */
    if (/(?:how many tasks (?:did i )?complete|tasks completed today|tasks done today)/i.test(lower)) {
      return reply("Counting completed tasks…", "tasks_completed_today");
    }

    /* CLEAR COMPLETED TASKS */
    if (/^(?:clear|remove|delete)\s+(?:all\s+)?completed\s+tasks$/i.test(lower)) {
      return reply("Do you want me to delete all completed tasks? Click Confirm below.", "confirm_clear_completed");
    }

    /* CALENDAR TODAY */
    if (/(?:what'?s on my calendar|calendar today|my events today|schedule today)/i.test(lower)) {
      return reply("Checking today's calendar…", "calendar_today");
    }

    /* FOCUS TIMER */
    if (/^(?:start|begin|launch)\s+focus(?:\s+(?:timer|session|pomodoro))?$/i.test(lower)) {
      return reply("Opening Focus and starting a session…", "start_focus");
    }

    /* FOCUS STATS */
    if (/(?:how focused|focus stats|how many focus|focus today)/i.test(lower)) {
      return reply("Checking your focus stats…", "focus_status");
    }

    /* SERVICES */
    if (/^(?:list|show)\s+(?:my\s+)?services\b/i.test(lower)) {
      return reply("Here are your services.", "list_services");
    }

    /* FALLBACK */
    return reply(
      "I didn't quite catch that. Try \"help\" to see what I can do.\n" +
      "Example: \"add task buy milk tomorrow 6pm\""
    );
  }

  /* ---------- action runner ---------- */
  function runAction(action, data) {
    if (!action) return null;

    /* everything below reads/writes the Flaren app state */
    const state = (typeof window.__flarenGetState === "function") ? window.__flarenGetState() : null;
    const save = (typeof window.__flarenSaveData === "function") ? window.__flarenSaveData : (() => {});

    switch (action) {

      case "navigate": {
        if (typeof window.__flarenNavigate === "function") {
          window.__flarenNavigate(data.page);
          return `Opened ${data.page}.`;
        }
        return `Navigation is not available right now.`;
      }

      case "add_task": {
        if (!state) return "Couldn't reach the app data.";
        state.tasks.push({
          id: uid(),
          title: data.title,
          description: "",
          priority: data.priority || "medium",
          dueDate: data.dueDate || "",
          dueTime: data.dueTime || "",
          reminder: false,
          completed: false,
          createdAt: Date.now()
        });
        save();
        if (typeof window.__flarenReRender === "function") window.__flarenReRender();
        return null;
      }

      case "add_event": {
        if (!state) return "Couldn't reach the app data.";
        const cal = state.calendar || [];
        cal.push({
          id: uid(),
          title: data.title,
          date: data.date,
          time: data.time,
          colour: data.colour || "flame",
          notes: data.notes || "",
          recurrence: "none",
          recurrenceDays: [],
          reminders: data.reminders || []
        });
        state.calendar = cal;
        save();
        try {
          localStorage.setItem("flaren_calendar_v2", JSON.stringify(cal));
        } catch {}
        if (typeof window.__flarenReRender === "function") window.__flarenReRender();
        return null;
      }

      case "add_note": {
        if (!state) return "Couldn't reach the app data.";
        state.notes.push({
          id: uid(),
          title: data.title,
          body: data.body,
          pinned: false
        });
        save();
        if (typeof window.__flarenReRender === "function") window.__flarenReRender();
        return null;
      }

      case "list_notes": {
        if (!state) return "Couldn't reach the app data.";
        const notes = state.notes || [];
        if (!notes.length) return "You have no notes yet.";
        return "Your notes:\n" + notes.slice(0, 10).map(n => "• " + n.title).join("\n") +
               (notes.length > 10 ? `\n…and ${notes.length - 10} more.` : "");
      }

      case "search_notes": {
        const q = (data.query || "").toLowerCase();
        if (typeof window.__flarenNavigate === "function") window.__flarenNavigate("notes");
        setTimeout(() => {
          const inp = document.getElementById("noteSearch");
          if (inp) { inp.value = data.query; inp.dispatchEvent(new Event("input")); }
        }, 200);
        return `Filtering notes for "${data.query}".`;
      }

      case "add_water": {
        if (window.FlarenWater && typeof window.FlarenWater.addWater === "function") {
          window.FlarenWater.addWater(data.ml);
          return null;
        }
        /* fallback: write directly */
        try {
          const w = JSON.parse(localStorage.getItem("flaren_water_v1") || "{}");
          w.today = w.today || todayKey();
          w.todayMl = (w.todayMl || 0) + data.ml;
          w.logs = w.logs || [];
          w.logs.push({ date: w.today, ml: data.ml, at: Date.now() });
          localStorage.setItem("flaren_water_v1", JSON.stringify(w));
          if (typeof window.__flarenReRender === "function") window.__flarenReRender();
        } catch {}
        return null;
      }

      case "water_status": {
        const w = JSON.parse(localStorage.getItem("flaren_water_v1") || "{}");
        if (w.today !== todayKey()) {
          return `You haven't logged any water yet today. Goal: ${w.goalMl || 2500} ml.`;
        }
        const ml = w.todayMl || 0;
        const goal = w.goalMl || 2500;
        const pct = Math.round((ml / goal) * 100);
        const remaining = Math.max(0, goal - ml);
        return `Today: ${ml} / ${goal} ml (${pct}%). ${remaining > 0 ? remaining + " ml to go." : "Goal reached! 🌸"}`;
      }

      case "plants_status": {
        const w = JSON.parse(localStorage.getItem("flaren_water_v1") || "{}");
        const grown = (w.history || []).filter(h => h.complete).length;
        const total = (w.history || []).length;
        return `You've grown ${grown} full plants from ${total} logged days. 🌱`;
      }

      case "streak_status": {
        const w = JSON.parse(localStorage.getItem("flaren_water_v1") || "{}");
        const s = w.streak || 0;
        return s === 0
          ? "No active streak yet. Hit 100% of your water goal today to start one."
          : `You're on a ${s}-day streak. Keep it going!`;
      }

      case "tasks_completed_today": {
        if (!state) return "Couldn't reach the app data.";
        const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
        const count = (state.tasks || []).filter(t => t.completed && (t.createdAt || 0) >= startOfDay.getTime()).length;
        const total = (state.tasks || []).filter(t => t.completed).length;
        return `Completed today: ${count}. Total completed: ${total}.`;
      }

      case "confirm_clear_completed": {
        const confirmed = confirm("Delete all completed tasks? This cannot be undone.");
        if (!confirmed) return "Cancelled.";
        if (!state) return "Couldn't reach the app data.";
        const before = (state.tasks || []).length;
        state.tasks = (state.tasks || []).filter(t => !t.completed);
        const removed = before - state.tasks.length;
        save();
        if (typeof window.__flarenReRender === "function") window.__flarenReRender();
        return `Removed ${removed} completed task${removed === 1 ? "" : "s"}.`;
      }

      case "calendar_today": {
        if (!state) return "Couldn't reach the app data.";
        const key = todayKey();
        const list = (state.calendar || []).filter(e => e.date === key);
        if (!list.length) return "Nothing on your calendar today.";
        return "Today:\n" + list
          .sort((a,b) => (a.time||"").localeCompare(b.time||""))
          .map(e => `• ${e.time || "all day"} — ${e.title}`)
          .join("\n");
      }

      case "start_focus": {
        if (typeof window.__flarenNavigate === "function") window.__flarenNavigate("focus");
        setTimeout(() => {
          const btn = document.getElementById("pomoStart");
          if (btn) btn.click();
        }, 250);
        return "Focus timer started. Get to work. 🎯";
      }

      case "focus_status": {
        const p = JSON.parse(localStorage.getItem("flaren_pomodoro_v1") || "{}");
        const count = p.todayFocusCount || 0;
        const min = p.todayFocusMinutes || 0;
        if (count === 0) return "No focus sessions yet today.";
        return `Today: ${count} session${count === 1 ? "" : "s"} — ${min} minutes focused.`;
      }

      case "list_services": {
        if (!state) return "Couldn't reach the app data.";
        const svc = state.services || [];
        if (!svc.length) return "You have no services yet.";
        return "Your services:\n" + svc.slice(0, 15).map(s => `• ${s.name}`).join("\n") +
               (svc.length > 15 ? `\n…and ${svc.length - 15} more.` : "");
      }
    }
    return null;
  }

  /* ---------- public: ask once ---------- */
  function askOnce(input) {
    const userMsg = { role: "user", text: input, at: Date.now() };
    history.push(userMsg);

    const parsed = parse(input);
    let botText = parsed.text;

    /* If an action needs to run and it's a data-fetch action, we get the final text from runAction.
       For mutating actions, runAction returns null and we keep the pre-written confirmation. */
    try {
      const result = runAction(parsed.action, parsed.data);
      if (result && typeof result === "string") botText = result;
    } catch (e) {
      console.warn("Ask action failed:", e);
      botText = "Something went wrong running that. Try rephrasing.";
    }

    const botMsg = { role: "bot", text: botText, at: Date.now() };
    history.push(botMsg);
    save();
    return botMsg;
  }

  /* ---------- rendering ---------- */
  function render(el) {
    el.innerHTML = `
      <header class="topbar">
        <div>
          <h2>Ask Flaren 🤖</h2>
          <p>Your assistant. Type a command. It just works.</p>
        </div>
        <button class="btn btn-secondary" id="askClear">Clear chat</button>
      </header>

      <div class="ask-thread" id="askThread">
        ${history.length ? history.map(renderMessage).join("") : renderWelcome()}
      </div>

      <form class="ask-composer" id="askForm">
        <input id="askInput" type="text" placeholder="Try: add task buy milk tomorrow 6pm" autocomplete="off" />
        <button type="submit" class="btn btn-primary">Send</button>
      </form>

      <div class="ask-suggestions" id="askSuggestions">
        ${["help","add task buy milk tomorrow","add event dentist friday 3pm","add water 500","how much water today","what's on my calendar today","start focus timer","list my notes","how many plants grown"].map(s =>
          `<button class="ask-chip" data-cmd="${escapeHTML(s)}">${escapeHTML(s)}</button>`
        ).join("")}
      </div>
    `;

    const thread = $("#askThread", el);
    const input = $("#askInput", el);
    const form = $("#askForm", el);

    function scrollBottom() {
      if (thread) thread.scrollTop = thread.scrollHeight;
    }
    scrollBottom();

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";

      /* show user msg immediately */
      if (history.length === 0) thread.innerHTML = "";
      thread.insertAdjacentHTML("beforeend", renderMessage({ role: "user", text, at: Date.now() }));

      /* typing indicator */
      const typingId = "typing-" + Date.now();
      thread.insertAdjacentHTML("beforeend", `
        <div class="ask-msg bot typing" id="${typingId}">
          <div class="ask-bubble">
            <span class="ask-dot"></span><span class="ask-dot"></span><span class="ask-dot"></span>
          </div>
        </div>
      `);
      scrollBottom();

      /* simulate thinking for UX clarity (250ms) */
      await new Promise(r => setTimeout(r, 250));

      const botMsg = askOnce(text);
      document.getElementById(typingId)?.remove();
      thread.insertAdjacentHTML("beforeend", renderMessage(botMsg));
      scrollBottom();

      /* clear welcome-only state */
      if (history.length === 1) { /* nothing */ }
    });

    $$(".ask-chip", el).forEach(b => b.addEventListener("click", () => {
      input.value = b.dataset.cmd;
      input.focus();
      form.dispatchEvent(new Event("submit", { cancelable: true }));
    }));

    $("#askClear", el).addEventListener("click", () => {
      if (!confirm("Clear the conversation?")) return;
      history = [];
      save();
      render(el);
    });
  }

  function renderMessage(msg) {
    if (msg.role === "user") {
      return `
        <div class="ask-msg user">
          <div class="ask-bubble">${escapeHTML(msg.text)}</div>
        </div>
      `;
    }
    return `
      <div class="ask-msg bot">
        <div class="ask-bubble">${escapeHTML(msg.text).replace(/\n/g, "<br/>")}</div>
      </div>
    `;
  }

  function renderWelcome() {
    return `
      <div class="ask-msg bot">
        <div class="ask-bubble">
          Hi 👋 I'm Flaren's assistant.<br/>
          Type <strong>help</strong> to see what I can do, or tap a suggestion below.
        </div>
      </div>
    `;
  }

  function stop() { /* no timers */ }

  /* ---------- public API ---------- */
  window.FlarenAsk = {
    render: function (el) { render(el); },
    stop: stop,
    ask: askOnce
  };
})();