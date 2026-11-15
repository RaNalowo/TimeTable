// static/js/core/api.js
// Core: API calls, request errors, token storage, HTML escaping.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

const API = "";  // Same origin as backend

// Present failed requests consistently, including offline/non-JSON responses.
function showRequestError(message) {
  let banner = document.getElementById("requestError");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "requestError";
    banner.setAttribute("role", "alert");
    banner.style.cssText = "padding:12px;margin:12px;background:#fee2e2;color:#991b1b;border:1px solid #ef4444;white-space:pre-wrap;cursor:pointer";
    banner.title = "Click to dismiss";
    banner.onclick = () => banner.remove();
    (document.querySelector("main") || document.body).prepend(banner);
  }
  banner.textContent = message;
}

async function apiFetch(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    const detail = "Cannot reach the server. Check that it is running, then retry.";
    if (!String(url).endsWith("/auth/login")) {
        showRequestError(detail);
    }
    return new Response(JSON.stringify({ detail }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
  if (response.ok) return response;
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  let detail = payload.detail;
  if (Array.isArray(detail)) detail = detail.map(item => `${(item.loc || []).slice(1).join(".")}: ${item.msg}`).join("; ");
  if (typeof detail !== "string") detail = `Request failed (${response.status}). Please retry or check the server terminal.`;
  if (!String(url).endsWith("/auth/login")) {
        showRequestError(detail);
    }
  if (response.status === 401 && !String(url).endsWith("/auth/login")) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login.html";
  }
  return new Response(JSON.stringify({ ...payload, detail }), { status: response.status, headers: { "Content-Type": "application/json" } });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[ch]));
}

// ---------- Storage ----------
function saveToken(token, user) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

function getToken() {
  return localStorage.getItem("token");
}

function getUser() {
  const u = localStorage.getItem("user");
  try { return u ? JSON.parse(u) : null; } catch { localStorage.removeItem("user"); return null; }
}

// ---------- Logout ----------
function logout() {
  apiFetch(API + "/auth/logout", {
    method: "POST",
    headers: { "Authorization": "Bearer " + getToken() },
  }).finally(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login.html";
  });
}
