/* =========================================================
   FLAREN — API client
   Talks to the Flask backend at API_BASE.
   For local dev, the backend runs on http://127.0.0.1:5000
   ========================================================= */

const API_BASE =
  location.hostname === "127.0.0.1" || location.hostname === "localhost"
    ? "http://127.0.0.1:5000"
    : "https://flaren.onrender.com"; /* we'll change this after deploy */

const TOKEN_KEY = "flaren_token";

/* ---------- token helpers ---------- */
function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/* ---------- low-level fetch ---------- */
async function api(path, { method = "GET", body = null, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const t = getToken();
    if (t) headers["Authorization"] = "Bearer " + t;
  }

  /* Show a "waking up" toast if the request takes more than 3 seconds */
  let wakingTimer = setTimeout(() => {
    if (typeof window !== "undefined" && window.__flarenWakingUp) {
      window.__flarenWakingUp(true);
    }
  }, 3000);

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    clearTimeout(wakingTimer);
    if (window.__flarenWakingUp) window.__flarenWakingUp(false);
    throw new Error("Network error — check your connection");
  }

  clearTimeout(wakingTimer);
  if (window.__flarenWakingUp) window.__flarenWakingUp(false);

  let data = null;
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    const msg = (data && data.error) || ("Request failed: " + res.status);
    throw new Error(msg);
  }
  return data;
}
/* ---------- API surface ---------- */
const FlarenAPI = {
  health:    ()                => api("/api/health"),
  register:  (email, username, password) =>
                                  api("/api/register", { method: "POST", body: { email, username, password } }),
  login:     (email, password) => api("/api/login",    { method: "POST", body: { email, password } }),
  me:        ()                => api("/api/me",       { auth: true }),
  pushSync:  (payload)         => api("/api/sync",     { method: "POST", body: { payload }, auth: true }),
  pullSync:  ()                => api("/api/sync",     { auth: true }),
  pushToken: (token)           => api("/api/push-token", { method: "POST", body: { token }, auth: true }),
  ntfyRegister: (topic)        => api("/api/ntfy/register", { method: "POST", body: { topic }, auth: true })
};

window.FlarenAPI = FlarenAPI;
window.FlarenToken = { get: getToken, set: setToken, clear: clearToken };
