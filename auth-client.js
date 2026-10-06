/* =========================================================
   FLAREN — API client
   Talks to the Flask backend at API_BASE.
   For local dev, the backend runs on http://127.0.0.1:5000
   ========================================================= */

const API_BASE =
  location.hostname === "127.0.0.1" || location.hostname === "localhost"
    ? "http://127.0.0.1:5000"
    : "https://flaren-backend.onrender.com"; /* we'll change this after deploy */

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

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

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
  pushToken: (token)           => api("/api/push-token", { method: "POST", body: { token }, auth: true })
};

window.FlarenAPI = FlarenAPI;
window.FlarenToken = { get: getToken, set: setToken, clear: clearToken };