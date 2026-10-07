/* =========================================================
   FLAREN — full product (localStorage + browser notifications)
   ========================================================= */

const STORAGE_KEY = "flaren_v1";
const NOTIFIED_KEY = "flaren_notified_v1";
const LOCAL_UPDATED_KEY = "flaren_local_updated_v1";

const DEFAULT_SERVICES = [
  { id: "google", name: "Google", description: "Search the web", icon: "🔍", url: "https://www.google.com", category: "Search", favorite: true },
  { id: "youtube", name: "YouTube", description: "Watch videos", icon: "▶️", url: "https://www.youtube.com", category: "Entertainment", favorite: true },
  { id: "whatsapp", name: "WhatsApp Web", description: "Open WhatsApp in browser", icon: "💬", url: "https://web.whatsapp.com", category: "Communication", favorite: true },
  { id: "github", name: "GitHub", description: "Manage code and projects", icon: "🐙", url: "https://github.com", category: "Coding", favorite: false },
  { id: "chatgpt", name: "AI Assistant", description: "AI for learning and work", icon: "🤖", url: "https://chatgpt.com", category: "AI", favorite: true }
];

const DEFAULT_DATA = {
  services: DEFAULT_SERVICES,
  notes: [],
  tasks: [],
  settings: {
    theme: "dark",
    username: "User",
    openNewTab: true,
    searchEngine: "google",
    notificationsEnabled: false,
    notificationSound: true
  },
  onboarded: false
};

/* =========================================================
   CLOUD PUSH (debounced) — declared early so saveData() can call it
   ========================================================= */
let _pushTimer = null;
let _lastPushError = null;

function _setSyncStatus(cls, text) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.classList.remove("syncing", "error");
  if (cls) el.classList.add(cls);
  const t = el.querySelector(".sync-text");
  if (t) t.textContent = text;
}

function schedulePush() {
  if (!signedIn() || !currentUser) return;
  if (!window.FlarenAPI) return;

  _setSyncStatus("syncing", "Syncing…");

  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(async () => {
    try {
      await window.FlarenAPI.pushSync(state);
      _lastPushError = null;
      _setSyncStatus(null, "Synced");
    } catch (err) {
      _lastPushError = err.message || "Sync failed";
      _setSyncStatus("error", "Sync failed");
      console.warn("Cloud push failed:", err);
    }
  }, 1500);
}

/* Global modal helper — locks background scroll */
function openModal(modalEl) {
  document.body.appendChild(modalEl);
  document.body.classList.add("modal-open");
}
function closeModal(modalEl) {
  modalEl.remove();
  if (!document.querySelector(".modal-backdrop")) {
    document.body.classList.remove("modal-open");
  }
}

/* ---------- storage ---------- */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_DATA));
    const parsed = JSON.parse(raw);
    const merged = {
      ...DEFAULT_DATA,
      ...parsed,
      settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) }
    };
    /* migrate old tasks: due → dueDate */
    merged.tasks = (merged.tasks || []).map(t => ({
      id: t.id,
      title: t.title,
      description: t.description || "",
      priority: t.priority || "medium",
      dueDate: t.dueDate || t.due || "",
      dueTime: t.dueTime || "",
      reminder: !!t.reminder,
      completed: !!t.completed,
      createdAt: t.createdAt || Date.now()
    }));
    return merged;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(LOCAL_UPDATED_KEY, String(Date.now()));
  schedulePush();
}
window.__flarenSaveData = saveData;

/* ---------- Cloud PULL ----------
   Called right after login/register and on boot when already signed in.
   - If server has no data    → push local up
   - If server newer          → replace local with server
   - If local newer           → keep local, push instead
*/
async function pullSyncIfAvailable() {
  if (!signedIn() || !currentUser || !window.FlarenAPI) return;

  let remote = null;
  try {
    remote = await window.FlarenAPI.pullSync();
  } catch (err) {
    console.warn("Cloud pull failed:", err);
    return;
  }

  if (!remote || !remote.payload) {
    /* No server data. Push local up so the account starts with something. */
    try { await window.FlarenAPI.pushSync(state); } catch {}
    return;
  }

  const serverTs = remote.updated_at || 0;
  const localTs  = getLocalUpdatedAt();



  if (serverTs > localTs) {
    /* Server newer — adopt it. */
    state = Object.assign({}, DEFAULT_DATA, remote.payload, {
      settings: Object.assign({}, DEFAULT_DATA.settings, (remote.payload.settings || {}))
    });
    state.tasks = (state.tasks || []).map(t => ({
      id: t.id,
      title: t.title,
      description: t.description || "",
      priority: t.priority || "medium",
      dueDate: t.dueDate || t.due || "",
      dueTime: t.dueTime || "",
      reminder: !!t.reminder,
      completed: !!t.completed,
      createdAt: t.createdAt || Date.now()
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(LOCAL_UPDATED_KEY, String(serverTs));
    toast("Restored from cloud");
  } else if (localTs > serverTs) {
    /* Local newer — keep and push. */
    try { await window.FlarenAPI.pushSync(state); } catch {}
  }
}

function getLocalUpdatedAt() {
  const v = localStorage.getItem(LOCAL_UPDATED_KEY);
  return v ? parseInt(v, 10) : 0;
}

function loadNotifiedSet() {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function saveNotifiedSet(set) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set]));
}

/* ---------- state ---------- */
let state = loadData();
let currentPage = "dashboard";
let notifiedSet = loadNotifiedSet();
let currentUser = null;      /* null = guest / not signed in */
let authView = "login";      /* "login" or "register" */

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function escapeHTML(str) {
  return String(str)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
/* ---------- Waking-up indicator for cold starts ---------- */
let _wakeToast = null;
window.__flarenWakingUp = function (show) {
  if (show) {
    if (_wakeToast) return;
    _wakeToast = document.createElement("div");
    _wakeToast.className = "toast waking";
    _wakeToast.innerHTML = `
      <span class="waking-spinner"></span>
      Waking up server… first time takes ~30 sec
    `;
    document.body.appendChild(_wakeToast);
  } else {
    if (_wakeToast) { _wakeToast.remove(); _wakeToast = null; }
  }
};
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
function openURL(url) {
  if (state.settings.openNewTab) window.open(url, "_blank");
  else window.location.href = url;
}
/* ---------- user session ---------- */
function setUser(user) {
  currentUser = user;
  if (user) localStorage.setItem("flaren_user", JSON.stringify(user));
  else localStorage.removeItem("flaren_user");
}
function loadStoredUser() {
  try {
    const raw = localStorage.getItem("flaren_user");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function signedIn() {
  /* Either a real signed-in user OR a returning guest */
  if (currentUser && window.FlarenToken.get()) return true;
  return localStorage.getItem("flaren_guest") === "1";
}
function signOut() {
  window.FlarenToken.clear();
  localStorage.removeItem("flaren_guest");
  setUser(null);
  renderAuth();
}

/* ---------- notification sound (Web Audio) ---------- */
let _audioCtx = null;
function playNotificationSound() {
  if (!state.settings.notificationSound) return;
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === "suspended") _audioCtx.resume();

    const now = _audioCtx.currentTime;
    const tones = [
      { freq: 880, start: 0.00, dur: 0.14 },
      { freq: 1320, start: 0.16, dur: 0.22 }
    ];
    tones.forEach(t => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;
      gain.gain.setValueAtTime(0.0001, now + t.start);
      gain.gain.exponentialRampToValueAtTime(0.25, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t.start + t.dur);
      osc.connect(gain);
      gain.connect(_audioCtx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.05);
    });
  } catch (e) { /* ignore */ }
}

/* ---------- notification permission ---------- */
function notificationsSupported() {
  return "Notification" in window;
}
function notificationPermission() {
  return notificationsSupported() ? Notification.permission : "unsupported";
}
async function requestNotificationPermission() {
  if (!notificationsSupported()) { toast("Notifications not supported in this browser"); return false; }
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") { toast("Notifications are blocked in browser settings"); return false; }
  try {
    const res = await Notification.requestPermission();
    if (res === "granted") {
      state.settings.notificationsEnabled = true;
      saveData();
      toast("Notifications enabled");
      return true;
    } else {
      toast("Notifications not enabled");
      return false;
    }
  } catch { return false; }
}


/* ---------- NTFY PUSH SUBSCRIPTION ---------- */
function getOrCreateNtfyTopic() {
  let topic = localStorage.getItem("flaren_ntfy_topic");
  if (!topic) {
    const rnd = () => Math.random().toString(36).slice(2, 10);
    topic = "flaren-" + rnd() + rnd();
    localStorage.setItem("flaren_ntfy_topic", topic);
  }
  return topic;
}

async function registerNtfyPush() {
  if (!signedIn() || !currentUser) return null;
  const topic = getOrCreateNtfyTopic();
  try {
      await window.FlarenAPI.ntfyRegister(topic);
    return topic;
  } catch (err) {
    console.warn("ntfy register failed:", err);
    return null;
  }
}


function showNotification(title, body) {
  if (notificationPermission() !== "granted") return;
  try {
    const n = new Notification(title, {
      body: body || "",
      icon: "images/logo.png",
      badge: "images/logo.png",
      tag: "flaren-task",
      renotify: true
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) { /* ignore */ }
}

/* ---------- task reminder engine ---------- */
function taskDateTime(t) {
  if (!t.dueDate) return null;
  const time = t.dueTime && /^\d{2}:\d{2}$/.test(t.dueTime) ? t.dueTime : "09:00";
  const [y, m, d] = t.dueDate.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function checkReminders() {
  if (notificationPermission() !== "granted") return;
  const now = Date.now();
  let fired = false;

  state.tasks.forEach(t => {
    if (t.completed || !t.reminder) return;
    const when = taskDateTime(t);
    if (!when) return;
    if (when.getTime() <= now && !notifiedSet.has(t.id)) {
      showNotification("⏰ " + t.title, t.description || "Task reminder from Flaren");
      playNotificationSound();
      notifiedSet.add(t.id);
      fired = true;
    }
  });

  if (fired) saveNotifiedSet(notifiedSet);
}

let _reminderInterval = null;
function startReminderLoop() {
  if (_reminderInterval) clearInterval(_reminderInterval);
  checkReminders();
  _reminderInterval = setInterval(checkReminders, 30 * 1000);
}

/* ---------- app shell ---------- */
const app = document.getElementById("app");

function renderShell() {
  app.innerHTML = `
    <div class="app-layout">
      <aside class="sidebar">
        <div class="brand">
          <img class="brand-logo-img" src="images/logo.png" alt="Flaren" />
          <div><h1>Flaren</h1><p>Your digital workspace</p></div>
        </div>
        <nav class="sidebar-menu">
          ${menuBtn("dashboard", "🏠", "Dashboard")}
          ${menuBtn("services", "🧩", "Services")}
          ${menuBtn("favorites", "⭐", "Favorites")}
          ${menuBtn("notes", "📝", "Notes")}
          ${menuBtn("tasks", "✅", "Tasks")}
          ${menuBtn("focus", "⏱️", "Focus")}
          ${menuBtn("calendar", "📅", "Calendar")}
          ${menuBtn("water", "💧", "Water")}
          ${menuBtn("workout", "🔥", "Workout")}
          ${menuBtn("ask", "🤖", "Ask Flaren")}
          ${menuBtn("games", "🎮", "Games")}
          ${menuBtn("settings", "⚙️", "Settings")}
        </nav>
        <div class="sidebar-user">
          ${currentUser
            ? `<div class="user-chip">
                 <div class="user-avatar">${escapeHTML((currentUser.username || "U").charAt(0).toUpperCase())}</div>
                 <div class="user-meta">
                   <strong>${escapeHTML(currentUser.username || "User")}</strong>
                   <small>${escapeHTML(currentUser.email || "")}</small>
                 </div>
               </div>
               <button class="btn btn-secondary" id="signOutBtn" style="width:100%;margin-top:10px">Sign out</button>`
            : `<div class="user-chip guest">
                 <div class="user-avatar">G</div>
                 <div class="user-meta">
                   <strong>Guest mode</strong>
                   <small>Data stays on this device</small>
                 </div>
               </div>
               <button class="btn btn-primary" id="signInBtn" style="width:100%;margin-top:10px">Sign in to sync →</button>`}
        </div>
        <button class="btn btn-secondary" id="backHome" style="margin-top:12px;width:100%">← Back to home</button>
      </aside>
      <main class="main-content" id="pageContent"></main>
    </div>

    <button class="app-burger" id="appBurger" aria-label="Toggle menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
  `;

  $$(".menu-button").forEach(btn => {
    btn.addEventListener("click", () => {
      currentPage = btn.dataset.page;
      $$(".menu-button").forEach(b => b.classList.toggle("active", b === btn));
      renderPage();
      if (window.innerWidth <= 760) closeDrawer();
    });
  });

    const signOutBtn = document.getElementById("signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", () => {
    if (confirm("Sign out of Flaren?")) signOut();
  });

  const signInBtn = document.getElementById("signInBtn");
  if (signInBtn) signInBtn.addEventListener("click", () => {
    authView = "login";
    renderAuth();
  });

  $("#backHome").addEventListener("click", () => { window.location.href = "index.html"; });

  const burger = document.getElementById("appBurger");
  const sidebar = document.querySelector(".sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");

  function closeDrawer() {
    sidebar.classList.remove("open");
    burger.classList.remove("open");
    backdrop.classList.remove("show");
    burger.setAttribute("aria-expanded", "false");
  }
  function toggleDrawer() {
    const open = !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", open);
    burger.classList.toggle("open", open);
    backdrop.classList.toggle("show", open);
    burger.setAttribute("aria-expanded", open);
  }
  burger.addEventListener("click", toggleDrawer);
  backdrop.addEventListener("click", closeDrawer);
}

function menuBtn(page, icon, label) {
  return `<button class="menu-button ${page === currentPage ? "active" : ""}" data-page="${page}">${icon} <span>${label}</span></button>`;
}

/* ---------- router ---------- */
function renderPage() {
  applyTheme();

  /* Stop any module timers from the previous page */
  if (currentPage !== "focus"    && window.FlarenPomodoro) window.FlarenPomodoro.stop();
  if (currentPage !== "calendar" && window.FlarenCalendar) window.FlarenCalendar.stop();
  if (currentPage !== "water"    && window.FlarenWater)    window.FlarenWater.stop();
  if (currentPage !== "workout"  && window.FlarenWorkout)  window.FlarenWorkout.stop();
  if (currentPage !== "ask"      && window.FlarenAsk)      window.FlarenAsk.stop();

  const pageContent = $("#pageContent");
  const pages = {
    dashboard: renderDashboard,
    services: renderServices,
    favorites: renderFavorites,
    notes: renderNotes,
    tasks: renderTasks,
    focus: renderFocus,
    calendar: renderCalendar,
    water: renderWater,
    workout: renderWorkout,
    ask: renderAsk,
    games: renderGames,
    settings: renderSettings
  };

  if (typeof pages[currentPage] !== "function") {
    console.error("Unknown page:", currentPage);
    pageContent.innerHTML = `<div class="empty">Page not found: ${currentPage}</div>`;
    return;
  }

  pages[currentPage](pageContent);
}

function applyTheme() {
  document.body.classList.toggle("light-mode", state.settings.theme === "light");
}

/* =========================================================
   AUTH (login + register)
   ========================================================= */
function renderAuth() {
  const isLogin = authView === "login";

  app.innerHTML = `
    <div class="auth-page">
      <div class="auth-bg" aria-hidden="true">
        <span class="orb orb-flame"></span>
        <span class="orb orb-cyan"></span>
      </div>

      <div class="auth-card glass">
        <div class="auth-brand">
          <img class="brand-logo-img" src="images/logo.png" alt="Flaren" />
          <div>
            <h1>Flaren</h1>
            <p>${isLogin ? "Welcome back" : "Create your account"}</p>
          </div>
        </div>

        <div class="auth-tabs">
          <button class="auth-tab ${isLogin ? "active" : ""}" data-view="login">Sign in</button>
          <button class="auth-tab ${!isLogin ? "active" : ""}" data-view="register">Create account</button>
        </div>

        ${isLogin ? loginFormHTML() : registerFormHTML()}

        <p class="auth-alt">
          ${isLogin
            ? `No account? <a href="#" id="toRegister">Create one</a>`
            : `Already have an account? <a href="#" id="toLogin">Sign in</a>`}
        </p>

        <div class="auth-divider"><span>or</span></div>

        <button class="btn btn-secondary" style="width:100%" id="guestBtn">
          Continue as guest →
        </button>
        <p class="auth-hint">
          Guest mode stores everything on this device only.
        </p>
      </div>
    </div>  
  `;

  /* Tab switching */
  document.querySelectorAll(".auth-tab").forEach(t => {
    t.addEventListener("click", () => {
      authView = t.dataset.view;
      renderAuth();
    });
  });

  /* Switch link inside form */
  const toRegister = document.getElementById("toRegister");
  const toLogin = document.getElementById("toLogin");
  if (toRegister) toRegister.addEventListener("click", e => { e.preventDefault(); authView = "register"; renderAuth(); });
  if (toLogin) toLogin.addEventListener("click", e => { e.preventDefault(); authView = "login"; renderAuth(); });

  /* Guest mode */
  document.getElementById("guestBtn").addEventListener("click", () => {
  /* Guests have no user object, but we mark them as "guest" so
     a refresh goes straight back into the dashboard. */
  localStorage.setItem("flaren_guest", "1");
  setUser(null);
  enterApp();
});

  /* ---------- Real auth wiring (Step 2.2) ---------- */
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  function showAuthError(formEl, message) {
    /* Remove any old error first */
    const old = formEl.querySelector(".auth-error");
    if (old) old.remove();

    const box = document.createElement("div");
    box.className = "auth-error";
    box.textContent = message;
    formEl.prepend(box);
  }

  function setBusy(formEl, busy) {
    const btn = formEl.querySelector('button[type="submit"]');
    if (!btn) return;
    btn.disabled = busy;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = busy ? "Please wait…" : btn.dataset.originalText;
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async e => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;

      if (!email || !password) {
        showAuthError(loginForm, "Please fill in both fields.");
        return;
      }

      setBusy(loginForm, true);
      try {
        const res = await window.FlarenAPI.login(email, password);
        window.FlarenToken.set(res.token);
        setUser(res.user);
        localStorage.removeItem("flaren_guest");

        await pullSyncIfAvailable();

        toast("Welcome back, " + (res.user.username || "user"));
        enterApp();
      } catch (err) {
        setBusy(loginForm, false);
        showAuthError(loginForm, err.message || "Could not sign in.");
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async e => {
      e.preventDefault();
      const username = document.getElementById("regUsername").value.trim();
      const email = document.getElementById("regEmail").value.trim();
      const password = document.getElementById("regPassword").value;

      if (!username || !email || !password) {
        showAuthError(registerForm, "Please fill in all fields.");
        return;
      }
      if (password.length < 8) {
        showAuthError(registerForm, "Password must be at least 8 characters.");
        return;
      }

      setBusy(registerForm, true);
      try {
        const res = await window.FlarenAPI.register(email, username, password);
        window.FlarenToken.set(res.token);
        setUser(res.user);
        localStorage.removeItem("flaren_guest");
        toast("Account created. Welcome, " + (res.user.username || "user"));
        enterApp();
      } catch (err) {
        setBusy(registerForm, false);
        showAuthError(registerForm, err.message || "Could not create account.");
      }
    });
  }
}

function loginFormHTML() {
  return `
    <form id="loginForm" class="auth-form">
      <label class="auth-label">Email
        <input id="loginEmail" type="email" placeholder="you@example.com" autocomplete="email" required />
      </label>
      <label class="auth-label">Password
        <input id="loginPassword" type="password" placeholder="Your password" autocomplete="current-password" required />
      </label>
      <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Sign in</button>
    </form>
  `;
}

function registerFormHTML() {
  return `
    <form id="registerForm" class="auth-form">
      <label class="auth-label">Name
        <input id="regUsername" type="text" placeholder="Your name" autocomplete="name" required minlength="2" />
      </label>
      <label class="auth-label">Email
        <input id="regEmail" type="email" placeholder="you@example.com" autocomplete="email" required />
      </label>
      <label class="auth-label">Password
        <input id="regPassword" type="password" placeholder="At least 8 characters" autocomplete="new-password" required minlength="8" />
      </label>
      <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Create account</button>
      <p class="auth-legal">By creating an account you agree that Flaren stores your data on its server. You can delete your account anytime.</p>
    </form>
  `;
}

function enterApp() {
  renderShell();
  renderPage();
  if (!state.onboarded) showOnboarding();
  if (notificationPermission() === "granted") startReminderLoop();
  /* Ensure water rolls the day if the app is opened after midnight */
  if (window.FlarenWater && typeof window.FlarenWater.tick === "function") {
    window.FlarenWater.tick();
  }
}
/* =========================================================
   DASHBOARD
   ========================================================= */
function renderDashboard(el) {
  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? "Good night" :
    hour < 12 ? "Good morning" :
    hour < 18 ? "Good afternoon" :
    hour < 22 ? "Good evening" : "Good night";

  el.innerHTML = `
    <header class="topbar">
      <div>
        <h2>${greeting}, ${escapeHTML(state.settings.username)} 👋</h2>
        <p>All your favourite services in one place.</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <input id="dashSearch" type="text" placeholder="Filter favourites..." style="max-width:280px" />
        <button class="btn" id="dashAdd">+ Quick add</button>
      </div>
    </header>

    <section class="dash-hero">
      <div class="dash-clock">
        <div class="time" id="clockTime">--:--</div>
        <div class="date" id="clockDate">Loading...</div>
      </div>
      <div class="dash-hero-inner">
        <h2>Search the web</h2>
        <p>Quick search using your default engine.</p>
        <form class="dash-search-wrap" id="searchForm">
          <select id="engineSelect">
            <option value="google">Google</option>
            <option value="bing">Bing</option>
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="youtube">YouTube</option>
          </select>
          <input id="searchBox" type="text" placeholder="Type something and press Enter..." />
          <button type="submit">Search</button>
        </form>
      </div>
    </section>

    <div class="section-title"><h2>Favourite services</h2><span id="favCount"></span></div>
    <div id="favGrid" class="service-grid"></div>

    <div class="section-title"><h2>Notes preview</h2><span>${state.notes.length} notes</span></div>
    <div id="notesPreview"></div>

    <div class="section-title"><h2>Tasks</h2><span>${state.tasks.filter(t => !t.completed).length} open</span></div>
    <div id="tasksPreview"></div>
  `;

  const favGrid = $("#favGrid");
  const favCount = $("#favCount");
  const search = $("#dashSearch");

  function renderFavs(filter = "") {
    const list = state.services.filter(s => s.favorite && (
      s.name.toLowerCase().includes(filter) || s.description.toLowerCase().includes(filter)
    ));
    favCount.textContent = `${list.length} services`;
    if (!list.length) {
      favGrid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <p style="margin-bottom:14px">No favourite services yet.</p>
          <button class="btn" id="emptyAdd">＋ Add your first service</button>
        </div>
      `;
      const b = document.getElementById("emptyAdd");
      if (b) b.addEventListener("click", () => serviceModal());
      return;
    }
    favGrid.innerHTML = list.map(s => serviceCardHTML(s)).join("");
    $$(".open-button", favGrid).forEach(btn => btn.addEventListener("click", () => openURL(btn.dataset.url)));
  }

  search.addEventListener("input", () => renderFavs(search.value.toLowerCase()));
  renderFavs();
  $("#dashAdd").addEventListener("click", () => serviceModal());

  const engines = {
    google: "https://www.google.com/search?q=",
    bing: "https://www.bing.com/search?q=",
    duckduckgo: "https://duckduckgo.com/?q=",
    youtube: "https://www.youtube.com/results?search_query="
  };

  const engineSelect = $("#engineSelect");
  engineSelect.value = state.settings.searchEngine || "google";

  $("#searchForm").addEventListener("submit", e => {
    e.preventDefault();
    const q = $("#searchBox").value.trim();
    if (!q) return;
    const engine = engineSelect.value;
    state.settings.searchEngine = engine;
    saveData();
    window.open(engines[engine] + encodeURIComponent(q), "_blank");
    $("#searchBox").value = "";
  });

  function tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const timeEl = document.getElementById("clockTime");
    const dateEl = document.getElementById("clockDate");
    if (timeEl) timeEl.textContent = `${hh}:${mm}:${ss}`;
    if (dateEl) dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: "long", day: "numeric", month: "short"
    });
  }
  tick();
  if (window._flarenClock) clearInterval(window._flarenClock);
  window._flarenClock = setInterval(tick, 1000);

  const notesPreview = $("#notesPreview");
  if (!state.notes.length) notesPreview.innerHTML = `<div class="empty">No notes yet.</div>`;
  else notesPreview.innerHTML = state.notes.slice(0, 3).map(n => `
    <div class="list-item"><h4>${escapeHTML(n.title)}</h4><p>${escapeHTML(n.body).slice(0, 120)}</p></div>
  `).join("");

  const tasksPreview = $("#tasksPreview");
  if (!state.tasks.length) tasksPreview.innerHTML = `<div class="empty">No tasks yet.</div>`;
  else tasksPreview.innerHTML = state.tasks.slice(0, 3).map(t => `
    <div class="list-item ${t.completed ? "task-done" : ""}">
      <h4>${escapeHTML(t.title)}</h4>
      <span class="badge badge-${t.priority}">${t.priority}</span>
    </div>
  `).join("");
}

function serviceCardHTML(s) {
  return `
    <article class="service-card">
      <button class="fav-star" data-fav="${s.id}" title="Toggle favourite">${s.favorite ? "⭐" : "☆"}</button>
      <div class="service-icon">${escapeHTML(s.icon)}</div>
      <h3>${escapeHTML(s.name)}</h3>
      <p>${escapeHTML(s.description)}</p>
      <div class="card-actions">
        <button class="btn btn-small open-button" data-url="${escapeHTML(s.url)}">Open →</button>
        <button class="btn btn-small btn-secondary" data-edit="${s.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-del="${s.id}">Delete</button>
      </div>
    </article>
  `;
}

/* =========================================================
   SERVICES
   ========================================================= */
function renderServices(el) {
  el.innerHTML = `
    <header class="topbar">
      <div><h2>Services 🧩</h2><p>Add, edit and organise your links.</p></div>
      <button class="btn" id="addService">+ Add service</button>
    </header>
    <input id="serviceSearch" placeholder="Search services..." style="margin-bottom:16px" />
    <div id="serviceGrid" class="service-grid"></div>
  `;
  const grid = $("#serviceGrid");
  const search = $("#serviceSearch");

  function draw() {
    const q = search.value.toLowerCase();
    const list = state.services.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      (s.category || "").toLowerCase().includes(q)
    );
    if (!list.length) { grid.innerHTML = `<div class="empty">No services found.</div>`; return; }
    grid.innerHTML = list.map(s => serviceCardHTML(s)).join("");
    bindCardEvents(grid);
  }
  search.addEventListener("input", draw);
  $("#addService").addEventListener("click", () => serviceModal());
  draw();
}

function bindCardEvents(root) {
  $$(".open-button", root).forEach(b => b.addEventListener("click", () => openURL(b.dataset.url)));
  $$("[data-edit]", root).forEach(b => b.addEventListener("click", () => {
    const s = state.services.find(x => x.id === b.dataset.edit);
    serviceModal(s);
  }));
  $$("[data-del]", root).forEach(b => b.addEventListener("click", () => {
    if (confirm("Delete this service?")) {
      state.services = state.services.filter(x => x.id !== b.dataset.del);
      saveData(); renderPage(); toast("Service deleted");
    }
  }));
  $$("[data-fav]", root).forEach(b => b.addEventListener("click", () => {
    const s = state.services.find(x => x.id === b.dataset.fav);
    s.favorite = !s.favorite; saveData(); renderPage();
  }));
}

function serviceModal(existing) {
  const isEdit = !!existing;
  const s = existing || { id: uid(), name: "", description: "", icon: "🔗", url: "", category: "Other", favorite: false };

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? "Edit" : "Add"} service</h3>
      <div class="form-col"><input id="mName" placeholder="Name" value="${escapeHTML(s.name)}" /></div>
      <div class="form-col"><input id="mDesc" placeholder="Description" value="${escapeHTML(s.description)}" /></div>
      <div class="form-row">
        <input id="mIcon" placeholder="Icon (emoji)" value="${escapeHTML(s.icon)}" />
        <input id="mCat" placeholder="Category" value="${escapeHTML(s.category)}" />
      </div>
      <div class="form-col"><input id="mUrl" placeholder="https://..." value="${escapeHTML(s.url)}" /></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="mCancel">Cancel</button>
        <button class="btn btn-primary" id="mSave">Save</button>
      </div>
    </div>
  `;
  openModal(modal);
  
  $("#mCancel", modal).addEventListener("click", () => modal.remove());
  $("#mSave", modal).addEventListener("click", () => {
    const name = $("#mName", modal).value.trim();
    const url = $("#mUrl", modal).value.trim();
    if (!name || !url) { toast("Name and URL are required"); return; }
    const data = {
      name,
      description: $("#mDesc", modal).value.trim(),
      icon: $("#mIcon", modal).value.trim() || "🔗",
      url,
      category: $("#mCat", modal).value.trim() || "Other",
      favorite: s.favorite
    };
    if (isEdit) Object.assign(s, data);
    else state.services.push({ id: s.id, ...data });
    saveData(); closeModal(modal); renderPage();
    toast(isEdit ? "Service updated" : "Service added");
  });
}

/* =========================================================
   FAVORITES
   ========================================================= */
function renderFavorites(el) {
  const favs = state.services.filter(s => s.favorite);
  el.innerHTML = `
    <header class="topbar"><div><h2>Favorites ⭐</h2><p>Your starred services.</p></div></header>
    <div class="service-grid" id="favGrid"></div>
  `;
  const grid = $("#favGrid");
  if (!favs.length) { grid.innerHTML = `<div class="empty">No favourites yet. Star a service to see it here.</div>`; return; }
  grid.innerHTML = favs.map(s => serviceCardHTML(s)).join("");
  bindCardEvents(grid);
}

/* =========================================================
   NOTES
   ========================================================= */
function renderNotes(el) {
  el.innerHTML = `
    <header class="topbar">
      <div><h2>Notes 📝</h2><p>Write and pin important notes.</p></div>
      <button class="btn" id="addNote">+ New note</button>
    </header>
    <input id="noteSearch" placeholder="Search notes..." style="margin-bottom:16px" />
    <div id="notesList"></div>
  `;
  const list = $("#notesList");
  const search = $("#noteSearch");

  function draw() {
    const q = search.value.toLowerCase();
    const notes = [...state.notes]
      .filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    if (!notes.length) { list.innerHTML = `<div class="empty">No notes yet.</div>`; return; }

    list.innerHTML = notes.map(n => `
      <div class="list-item">
        <h4>${n.pinned ? "📌 " : ""}${escapeHTML(n.title)}</h4>
        <p>${escapeHTML(n.body)}</p>
        <div class="card-actions">
          <button class="btn btn-small btn-secondary" data-pin="${n.id}">${n.pinned ? "Unpin" : "Pin"}</button>
          <button class="btn btn-small" data-edit="${n.id}">Edit</button>
          <button class="btn btn-small btn-danger" data-del="${n.id}">Delete</button>
        </div>
      </div>
    `).join("");

    $$("[data-pin]", list).forEach(b => b.addEventListener("click", () => {
      const n = state.notes.find(x => x.id === b.dataset.pin);
      n.pinned = !n.pinned; saveData(); draw();
    }));
    $$("[data-edit]", list).forEach(b => b.addEventListener("click", () => noteModal(state.notes.find(x => x.id === b.dataset.edit))));
    $$("[data-del]", list).forEach(b => b.addEventListener("click", () => {
      if (confirm("Delete this note?")) {
        state.notes = state.notes.filter(x => x.id !== b.dataset.del);
        saveData(); draw(); toast("Note deleted");
      }
    }));
  }

  search.addEventListener("input", draw);
  $("#addNote").addEventListener("click", () => noteModal());
  draw();
}

function noteModal(existing) {
  const isEdit = !!existing;
  const n = existing || { id: uid(), title: "", body: "", pinned: false };

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? "Edit" : "New"} note</h3>
      <div class="form-col"><input id="nTitle" placeholder="Title" value="${escapeHTML(n.title)}" /></div>
      <div class="form-col"><textarea id="nBody" placeholder="Write your note...">${escapeHTML(n.body)}</textarea></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="nCancel">Cancel</button>
        <button class="btn btn-primary" id="nSave">Save</button>
      </div>
    </div>
  `;
  openModal(modal);
  
  $("#nCancel", modal).addEventListener("click", () => modal.remove());
  $("#nSave", modal).addEventListener("click", () => {
    const title = $("#nTitle", modal).value.trim();
    const body = $("#nBody", modal).value.trim();
    if (!title) { toast("Title is required"); return; }
    if (isEdit) Object.assign(n, { title, body });
    else state.notes.push({ id: n.id, title, body, pinned: false });
    saveData(); closeModal(modal); renderPage();
    toast(isEdit ? "Note updated" : "Note added");
  });
}

/* =========================================================
   TASKS
   ========================================================= */
function renderTasks(el) {
  const perm = notificationPermission();
  const showBanner = notificationsSupported() && perm !== "granted";

  el.innerHTML = `
    <header class="topbar">
      <div><h2>Tasks ✅</h2><p>Stay productive. Get reminded on time.</p></div>
      <button class="btn btn-primary" id="addTask">+ New task</button>
    </header>

    ${showBanner ? `
      <div class="notif-banner">
        <p>🔔 Turn on notifications so Flaren can remind you when a task is due.</p>
        <button class="btn btn-primary" id="enableNotif">Enable notifications</button>
      </div>
    ` : ""}

    <div id="tasksList"></div>
  `;

  if (showBanner) {
    $("#enableNotif").addEventListener("click", async () => {
      const ok = await requestNotificationPermission();
      if (ok) { startReminderLoop(); renderPage(); }
    });
  }

  const list = $("#tasksList");

  function dueLabel(t) {
    const when = taskDateTime(t);
    if (!when) return null;
    const now = new Date();
    const isToday = when.toDateString() === now.toDateString();
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = when.toDateString() === tomorrow.toDateString();

    const hh = String(when.getHours()).padStart(2, "0");
    const mm = String(when.getMinutes()).padStart(2, "0");
    let text = "";
    if (isToday) text = `Today ${hh}:${mm}`;
    else if (isTomorrow) text = `Tomorrow ${hh}:${mm}`;
    else text = `${when.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${hh}:${mm}`;

    let cls = "";
    if (t.completed) cls = "done";
    else if (when.getTime() < now.getTime()) cls = "overdue";
    else if (when.getTime() - now.getTime() < 3600 * 1000) cls = "soon";
    return `<span class="task-due ${cls}">🕒 ${text}</span>`;
  }

  function draw() {
    if (!state.tasks.length) {
      list.innerHTML = `<div class="empty">No tasks yet. Click "New task" to add one.</div>`;
      return;
    }

    const sorted = [...state.tasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const da = taskDateTime(a)?.getTime() ?? Infinity;
      const db = taskDateTime(b)?.getTime() ?? Infinity;
      return da - db;
    });

    list.innerHTML = sorted.map(t => {
      const when = taskDateTime(t);
      const overdue = !t.completed && when && when.getTime() < Date.now();
      return `
        <div class="task-card ${t.completed ? "done" : ""} ${overdue ? "overdue" : ""}">
          <div class="task-head">
            <button class="task-check ${t.completed ? "checked" : ""}" data-done="${t.id}">
              ${t.completed ? "✓" : ""}
            </button>
            <div class="task-body">
              <h4>${escapeHTML(t.title)}</h4>
              ${t.description ? `<p>${escapeHTML(t.description)}</p>` : ""}
              <div class="task-meta">
                <span class="badge badge-${t.priority}">${t.priority}</span>
                ${dueLabel(t) || ""}
                ${t.reminder ? `<span class="task-due"><span class="bell-icon">🔔</span> reminder</span>` : ""}
              </div>
              <div class="task-actions">
                <button class="btn btn-small btn-secondary" data-edit="${t.id}">Edit</button>
                <button class="btn btn-small btn-danger" data-del="${t.id}">Delete</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    $$("[data-done]", list).forEach(b => b.addEventListener("click", () => {
      const t = state.tasks.find(x => x.id === b.dataset.done);
      t.completed = !t.completed;
      if (t.completed) notifiedSet.add(t.id);
      saveData(); saveNotifiedSet(notifiedSet); draw();
    }));
    $$("[data-edit]", list).forEach(b => b.addEventListener("click", () => taskModal(state.tasks.find(x => x.id === b.dataset.edit))));
    $$("[data-del]", list).forEach(b => b.addEventListener("click", () => {
      if (confirm("Delete this task?")) {
        const id = b.dataset.del;
        state.tasks = state.tasks.filter(x => x.id !== id);
        notifiedSet.delete(id);
        saveData(); saveNotifiedSet(notifiedSet); draw(); toast("Task deleted");
      }
    }));
  }

  $("#addTask").addEventListener("click", () => taskModal());
  draw();
}

function taskModal(existing) {
  const isEdit = !!existing;
  const t = existing || {
    id: uid(), title: "", description: "", priority: "medium",
    dueDate: "", dueTime: "", reminder: false, completed: false, createdAt: Date.now()
  };

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? "Edit" : "New"} task</h3>
      <div class="form-col"><input id="tTitle" placeholder="Task title" value="${escapeHTML(t.title)}" /></div>
      <div class="form-col"><textarea id="tDesc" placeholder="Description (optional)">${escapeHTML(t.description)}</textarea></div>
      <div class="form-row">
        <select id="tPriority">
          <option value="low" ${t.priority === "low" ? "selected" : ""}>Low</option>
          <option value="medium" ${t.priority === "medium" ? "selected" : ""}>Medium</option>
          <option value="high" ${t.priority === "high" ? "selected" : ""}>High</option>
        </select>
        <input id="tDueDate" type="date" value="${escapeHTML(t.dueDate)}" />
      </div>
      <div class="form-row">
        <input id="tDueTime" type="time" value="${escapeHTML(t.dueTime)}" />
        <label style="display:flex;gap:10px;align-items:center;padding:0 4px">
          <input type="checkbox" id="tReminder" ${t.reminder ? "checked" : ""} style="width:auto" />
          Remind me
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="tCancel">Cancel</button>
        <button class="btn btn-primary" id="tSave">Save</button>
      </div>
    </div>
  `;
  openModal(modal);
  
  $("#tCancel", modal).addEventListener("click", () => modal.remove());
  $("#tSave", modal).addEventListener("click", async () => {
    const title = $("#tTitle", modal).value.trim();
    if (!title) { toast("Title is required"); return; }
    const wantsReminder = $("#tReminder", modal).checked;
    const dueDate = $("#tDueDate", modal).value;
    const dueTime = $("#tDueTime", modal).value;

    const data = {
      title,
      description: $("#tDesc", modal).value.trim(),
      priority: $("#tPriority", modal).value,
      dueDate,
      dueTime,
      reminder: wantsReminder && !!dueDate
    };

    if (data.reminder) {
      const ok = await requestNotificationPermission();
      if (!ok) {
        data.reminder = false;
        toast("Reminder off — notifications not allowed");
      }
    }

    if (isEdit) {
      Object.assign(t, data);
      notifiedSet.delete(t.id);
    } else {
      const newTask = { id: t.id, ...data, completed: false, createdAt: Date.now() };
      state.tasks.push(newTask);
    }

    saveData(); saveNotifiedSet(notifiedSet);
    closeModal(modal); renderPage();
    toast(isEdit ? "Task updated" : "Task added");
  });
}

/* =========================================================
   FOCUS TIMER (Pomodoro) — delegate to pomodoro.js
   ========================================================= */
function renderFocus(el) {
  if (window.FlarenPomodoro) {
    window.FlarenPomodoro.render(el);
  } else {
    el.innerHTML = `<div class="empty">Pomodoro module failed to load. Check the console.</div>`;
  }
}

/* =========================================================
   CALENDAR — delegate to calendar.js
   ========================================================= */
function renderCalendar(el) {
  if (window.FlarenCalendar) {
    window.FlarenCalendar.render(el);
  } else {
    el.innerHTML = `<div class="empty">Calendar module failed to load.</div>`;
  }
}
 
/* =========================================================
   WATER TRACKER — delegate to water.js
   ========================================================= */
function renderWater(el) {
  if (window.FlarenWater) {
    window.FlarenWater.render(el);
  } else {
    el.innerHTML = `<div class="empty">Water module failed to load.</div>`;
  }
}
/* =========================================================
   WORKOUT — delegate to workout.js
   ========================================================= */
function renderWorkout(el) {
  if (window.FlarenWorkout) {
    window.FlarenWorkout.render(el);
  } else {
    el.innerHTML = `<div class="empty">Workout module failed to load.</div>`;
  }
}
/* =========================================================
   ASK FLAREN — delegate to ask.js
   ========================================================= */
function renderAsk(el) {
  if (window.FlarenAsk) {
    window.FlarenAsk.render(el);
  } else {
    el.innerHTML = `<div class="empty">Ask Flaren module failed to load.</div>`;
  }
}

/* Bridge functions used by ask.js to operate the app */
window.__flarenGetState = () => state;
window.__flarenReRender = () => { renderPage(); };

window.__flarenNavigate = (page) => {
  const allowed = ["dashboard","services","favorites","notes","tasks","focus","calendar","water","ask","games","settings"];
  if (!allowed.includes(page)) return;
  currentPage = page;
  /* keep sidebar in sync */
  $$(".menu-button").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  renderPage();
};

/* =========================================================
   GAMES
   ========================================================= */
function renderGames(el) {
  el.innerHTML = `
    <header class="topbar"><div><h2>Games 🎮</h2><p>Quick breaks while you work.</p></div></header>
    <div class="games-grid">
      <div class="game-card">
        <h3>🐍 Snake</h3><p>Arrow keys to move. Eat the red square.</p>
        <canvas id="snakeCanvas" width="400" height="400"></canvas>
        <div class="game-actions">
          <button class="btn" id="snakeStart">Start</button>
          <span class="game-score" id="snakeScore">Score: 0</span>
        </div>
      </div>
      <div class="game-card">
        <h3>🧠 Memory</h3><p>Match the pairs. Fewest moves wins.</p>
        <div id="memoryBoard" class="memory-board"></div>
        <div class="game-actions">
          <button class="btn" id="memoryReset">New game</button>
          <span class="game-score" id="memoryScore">Moves: 0</span>
        </div>
      </div>
      <div class="game-card">
        <h3>⏱️ Reaction timer</h3><p>Click when the box turns green.</p>
        <div id="reactionBox" class="reaction-box">Click "Start"</div>
        <div class="game-actions">
          <button class="btn" id="reactionStart">Start</button>
          <span class="game-score" id="reactionScore">—</span>
        </div>
      </div>
    </div>
  `;
  setupSnake(); setupMemory(); setupReaction();
}

function setupSnake() {
  const canvas = document.getElementById("snakeCanvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("snakeScore");
  const grid = 20, tile = canvas.width / grid;
  let snake, dir, nextDir, food, score, gameOver, timer;

  function reset() {
    snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
    food = { x: 15, y: 10 }; score = 0; gameOver = false;
    scoreEl.textContent = "Score: 0";
    draw();
    if (timer) clearInterval(timer);
  }
  function draw() {
    ctx.fillStyle = "#0A0F1E";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#FF7A18";
    snake.forEach(p => ctx.fillRect(p.x * tile, p.y * tile, tile - 1, tile - 1));
    ctx.fillStyle = "#22D3EE";
    ctx.fillRect(food.x * tile, food.y * tile, tile - 1, tile - 1);
    if (gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "white";
      ctx.font = "bold 26px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Game Over", canvas.width / 2, canvas.height / 2 - 10);
      ctx.font = "16px sans-serif";
      ctx.fillText("Score: " + score, canvas.width / 2, canvas.height / 2 + 22);
    }
  }
  function step() {
    if (gameOver) return;
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.x >= grid || head.y < 0 || head.y >= grid ||
        snake.some(p => p.x === head.x && p.y === head.y)) {
      gameOver = true; draw(); return;
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score++; scoreEl.textContent = "Score: " + score;
      food = { x: Math.floor(Math.random() * grid), y: Math.floor(Math.random() * grid) };
    } else snake.pop();
    draw();
  }

  if (!window._snakeKeyBound) {
    window._snakeKeyBound = true;
    document.addEventListener("keydown", e => {
      if (currentPage !== "games") return;
      const map = {
        ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }
      };
      const d = map[e.key];
      if (!d) return;
      e.preventDefault();
      const g = window._snakeGame;
      if (!g) return;
      if (g.dir.x + d.x === 0 && g.dir.y + d.y === 0) return;
      g.nextDir = d;
    });
  }
  window._snakeGame = {
    get dir() { return dir; },
    set nextDir(v) { nextDir = v; }
  };
  document.getElementById("snakeStart").addEventListener("click", () => {
    reset(); timer = setInterval(step, 120);
  });
  reset();
}

function setupMemory() {
  const board = document.getElementById("memoryBoard");
  const scoreEl = document.getElementById("memoryScore");
  const emojis = ["🐶", "🐱", "🦊", "🐼", "🦁", "🐸", "🐵", "🦄"];
  let cards = [], flipped = [], moves = 0, lock = false;

  function reset() {
    cards = [...emojis, ...emojis]
      .map((e, i) => ({ id: i, emoji: e, matched: false, open: false }))
      .sort(() => Math.random() - 0.5);
    flipped = []; moves = 0; lock = false;
    scoreEl.textContent = "Moves: 0";
    draw();
  }
  function draw() {
    board.innerHTML = cards.map((c, i) => `
      <div class="memory-card ${c.open || c.matched ? "open" : ""}" data-i="${i}">${c.open || c.matched ? c.emoji : "?"}</div>
    `).join("");
    board.querySelectorAll(".memory-card").forEach(el => {
      el.addEventListener("click", () => click(parseInt(el.dataset.i)));
    });
  }
  function click(i) {
    if (lock) return;
    const c = cards[i];
    if (c.open || c.matched) return;
    c.open = true; flipped.push(i); draw();
    if (flipped.length === 2) {
      moves++; scoreEl.textContent = "Moves: " + moves;
      const [a, b] = flipped;
      if (cards[a].emoji === cards[b].emoji) {
        cards[a].matched = cards[b].matched = true;
        flipped = []; draw();
        if (cards.every(x => x.matched)) setTimeout(() => alert("You won in " + moves + " moves!"), 200);
      } else {
        lock = true;
        setTimeout(() => {
          cards[a].open = cards[b].open = false;
          flipped = []; lock = false; draw();
        }, 700);
      }
    }
  }
  document.getElementById("memoryReset").addEventListener("click", reset);
  reset();
}

function setupReaction() {
  const box = document.getElementById("reactionBox");
  const scoreEl = document.getElementById("reactionScore");
  let started = false, timeoutId;

  function reset() {
    started = false; box.style.background = "";
    box.textContent = 'Click "Start"'; scoreEl.textContent = "—";
    clearTimeout(timeoutId);
  }
  document.getElementById("reactionStart").addEventListener("click", () => {
    reset();
    box.style.background = "#f59e0b";
    box.textContent = "Wait for green...";
    const delay = 1000 + Math.random() * 3000;
    timeoutId = setTimeout(() => {
      started = true;
      box.style.background = "#22c55e";
      box.textContent = "CLICK!";
      const startTime = performance.now();
      box.onclick = () => {
        const ms = Math.round(performance.now() - startTime);
        scoreEl.textContent = ms + " ms";
        box.style.background = "";
        box.textContent = "Nice! Click Start again.";
        box.onclick = null; started = false;
      };
    }, delay);
  });
  box.onclick = () => {
    if (!started && box.textContent === "Wait for green...") {
      box.textContent = "Too early! Try again.";
      box.style.background = "";
      clearTimeout(timeoutId);
    }
  };
}

/* =========================================================
   SETTINGS
   ========================================================= */
function renderSettings(el) {
  const perm = notificationPermission();
  const permLabel =
    perm === "granted" ? "✅ Enabled" :
    perm === "denied" ? "🚫 Blocked in browser settings" :
    perm === "unsupported" ? "❌ Not supported in this browser" :
    "⚪ Not enabled yet";

  el.innerHTML = `
    <header class="topbar"><div><h2>Settings ⚙️</h2><p>Customize Flaren.</p></div></header>

    <div class="list-item">
      <h4>Profile</h4>
      <div class="form-col" style="margin-top:10px"><input id="setName" value="${escapeHTML(state.settings.username)}" placeholder="Your name" /></div>
    </div>

    <div class="list-item">
      <h4>Theme</h4>
      <div class="form-col" style="margin-top:10px">
        <select id="setTheme">
          <option value="dark" ${state.settings.theme === "dark" ? "selected" : ""}>Dark (Flame)</option>
          <option value="light" ${state.settings.theme === "light" ? "selected" : ""}>Light</option>
        </select>
      </div>
    </div>

    <div class="list-item">
      <h4>Behaviour</h4>
      <label style="display:flex;gap:10px;align-items:center;margin-top:10px">
        <input type="checkbox" id="setNewTab" ${state.settings.openNewTab ? "checked" : ""} style="width:auto" />
        Open services in a new tab
      </label>
      <label style="display:flex;gap:10px;align-items:center;margin-top:10px">
        <input type="checkbox" id="setSound" ${state.settings.notificationSound ? "checked" : ""} style="width:auto" />
        Play a sound when a notification fires
      </label>
    </div>

        <div class="list-item">
      <h4>Notifications</h4>
      <p style="color:var(--muted);font-size:13px;margin:8px 0 12px">Status: ${permLabel}</p>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${perm !== "granted" && perm !== "unsupported" ? `<button class="btn btn-primary" id="enableNotif">Enable notifications</button>` : ""}
        <button class="btn btn-secondary" id="testNotif">Send test notification</button>
      </div>

      <!-- NEW: The Guide for Closed-App Notifications -->
      <div style="margin-top:20px; padding:16px; background:rgba(34,211,238,.06); border:1px solid rgba(34,211,238,.25); border-radius:12px;">
        <p style="font-size:13px; font-weight:700; margin:0 0 8px; color:var(--text);">📲 Get alerts even when Flaren is closed:</p>
        <p style="font-size:12px; color:var(--muted); margin:0 0 12px;">To receive reminders on your phone when the app is shut, install the free <strong>ntfy</strong> app and subscribe to your personal code.</p>

        <p style="font-size:12px; font-weight:600; margin:0 0 6px;">Your code:</p>
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:14px;">
          <code id="ntfyTopicCode" style="flex:1; padding:10px; background:rgba(0,0,0,.4); border-radius:8px; font-size:13px; overflow:hidden; text-overflow:ellipsis; color:var(--cyan-1); font-weight:700;">Loading…</code>
          <button class="btn btn-small btn-secondary" id="copyNtfy">Copy</button>
        </div>

        <p style="font-size:12px; font-weight:600; margin:0 0 6px;">1. Get the app:</p>
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" class="btn btn-small btn-secondary" style="flex:1; justify-content:center;">Android</a>
          <a href="https://apps.apple.com/us/app/ntfy/id1625396347" target="_blank" class="btn btn-small btn-secondary" style="flex:1; justify-content:center;">iPhone</a>
        </div>

        <p style="font-size:12px; font-weight:600; margin:0 0 6px;">2. Open ntfy, tap +, paste your code.</p>
        <p style="font-size:12px; color:var(--muted); margin:0;">3. Done. Test it by creating a task due in 2 minutes.</p>
      </div>

      <p style="color:var(--muted-2);font-size:12px;margin-top:14px">
         Flaren must send the notification through ntfy for it to arrive when the app is closed.
      </p>
    </div>

    <div style="margin-top:22px; display:flex; gap:10px;">
      <button class="btn btn-primary btn-lg" id="saveSettings">Save settings</button>
    </div>
  `;

  const enableBtn = document.getElementById("enableNotif");
  if (enableBtn) {
    enableBtn.addEventListener("click", async () => {
      const ok = await requestNotificationPermission();
      if (ok) { startReminderLoop(); renderPage(); }
    });
  }

  $("#testNotif").addEventListener("click", async () => {
    const ok = await requestNotificationPermission();
    if (!ok) return;
    showNotification("🔔 Flaren test", "This is what a reminder looks like.");
    playNotificationSound();
  });

     /* --- Show the ntfy topic code --- */
  const topicEl = document.getElementById("ntfyTopicCode");
  if (topicEl) {
    const topic = getOrCreateNtfyTopic();
    topicEl.textContent = topic;
    if (signedIn()) registerNtfyPush();
  }

  /* --- Copy topic button --- */
  const copyBtn = document.getElementById("copyNtfy");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const topic = getOrCreateNtfyTopic();
      navigator.clipboard.writeText(topic).then(() => {
        toast("Code copied to clipboard");
      }).catch(() => {
        toast("Copy failed — please copy manually");
      });
    });
  }


  $("#saveSettings").addEventListener("click", () => {
    state.settings.username = $("#setName").value.trim() || "User";
    state.settings.theme = $("#setTheme").value;
    state.settings.openNewTab = $("#setNewTab").checked;
    state.settings.notificationSound = $("#setSound").checked;
    saveData(); applyTheme(); toast("Settings saved");
  });
}

/* =========================================================
   ONBOARDING
   ========================================================= */
function showOnboarding() {
  if (state.onboarded) return;

  const steps = [
    { icon: "👋", title: "Welcome to Flaren", body: "One clean place for all your services, notes and tasks. Let's take 30 seconds." },
    { icon: "🧩", title: "Add your services", body: "Google, GitHub, WhatsApp, your bank, your email — anything you open daily. One click and you're there." },
    { icon: "🔔", title: "Never miss a task", body: "Add a task with a due time and turn on the reminder. Flaren will notify you and play a sound when it's time." },
    { icon: "🚀", title: "You're ready", body: "Use Notes, Tasks, Games — everything stays on your device." }
  ];

  let current = 0;
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal onboarding-modal">
      <div class="onb-icon" id="onbIcon">${steps[0].icon}</div>
      <h3 id="onbTitle">${steps[0].title}</h3>
      <p class="onb-body" id="onbBody">${steps[0].body}</p>
      <div class="onb-dots" id="onbDots">
        ${steps.map((_, i) => `<span class="${i === 0 ? "active" : ""}"></span>`).join("")}
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="onbSkip">Skip</button>
        <button class="btn btn-primary" id="onbNext">Next</button>
      </div>
    </div>
  `;
  openModal(modal);
  document.body.classList.add("modal-open");

  function renderStep() {
    document.getElementById("onbIcon").textContent = steps[current].icon;
    document.getElementById("onbTitle").textContent = steps[current].title;
    document.getElementById("onbBody").textContent = steps[current].body;
    document.querySelectorAll("#onbDots span").forEach((d, i) => {
      d.classList.toggle("active", i === current);
    });
    document.getElementById("onbNext").textContent =
      current === steps.length - 1 ? "Start using Flaren" : "Next";
  }
  function finish() {
    state.onboarded = true;
    saveData();
    closeModal(modal);
  }
  document.getElementById("onbSkip").addEventListener("click", finish);
  document.getElementById("onbNext").addEventListener("click", () => {
    if (current === steps.length - 1) return finish();
    current++; renderStep();
  });
}

/* ---------- BOOT ---------- */
setUser(loadStoredUser());

/* Guest shortcut: if URL contains ?try=1, skip login and enter as guest */
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("try") === "1" && !signedIn()) {
  localStorage.setItem("flaren_guest", "1");
  setUser(null);
}

if (signedIn()) {
  renderShell();
  renderPage();
  if (!state.onboarded) showOnboarding();
  if (notificationPermission() === "granted") startReminderLoop();
  pullSyncIfAvailable();
}
else {
  /* Show login screen */
  authView = "login";
  renderAuth();
}

/* Re-check when the tab becomes visible again */
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && signedIn()) {
    checkReminders();
    /* Ask the water module to check for a new day (midnight roll-over) */
    if (window.FlarenWater && typeof window.FlarenWater.tick === "function") {
      window.FlarenWater.tick();
    }
  }
});
