// static/js/rules/hard_constraints.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

let constraintCache = {};

let constraintIsAdmin = false;

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

async function initConstraintsPage() {
  const box = document.getElementById("card-no_overlap_rooms");
  if (!box) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  constraintIsAdmin = me.roles.includes("admin");

  const accessMsg = document.getElementById("accessMsg");
  if (!constraintIsAdmin) {
    accessMsg.textContent = "Read-only. Only admins can modify hard constraints.";
    document.querySelectorAll(".switch input").forEach(i => i.disabled = true);
    document.querySelectorAll("button.btn").forEach(b => b.style.display = "none");
  }

  const dayChecks = document.getElementById("dayChecks");
  if (dayChecks) {
    dayChecks.innerHTML = ALL_DAYS.map(d => `<label><input type="checkbox" class="day-check" value="${d}" checked />${d}</label>`).join("");
  }
  await loadConstraints();
}

async function loadConstraints() {
  const res = await apiFetch(API + "/constraints", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) return;
  const list = await res.json();

  constraintCache = {};
  list.forEach(c => { constraintCache[c.constraint_type] = c; });

  for (const type of ["no_overlap_rooms", "no_overlap_teachers", "lunch_break"]) {
    const c = constraintCache[type];
    if (!c) continue;

    const toggle = document.getElementById("toggle-" + type);
    if (toggle) {
      toggle.checked = c.is_active;
      toggle.disabled = !constraintIsAdmin || (type !== "lunch_break" && c.is_active);
      if (type !== "lunch_break") toggle.title = "Mandatory rule: overlap prevention stays enabled";
    }

    const card = document.getElementById("card-" + type);
    if (card) card.classList.toggle("active", c.is_active);
  }

  const lb = constraintCache["lunch_break"];
  const lunchConfig = document.getElementById("lunchConfig");
  if (lb && lunchConfig) {
    if (lb.is_active) lunchConfig.classList.add("show");
    else lunchConfig.classList.remove("show");

    const cfg = lb.config || {};
    if (cfg.start) document.getElementById("lunchStart").value = cfg.start;
    if (cfg.end) document.getElementById("lunchEnd").value = cfg.end;

    const selectedDays = new Set(cfg.days || ALL_DAYS);
    document.querySelectorAll(".day-check").forEach(cb => {
      cb.checked = selectedDays.has(cb.value);
    });
  }
}

async function onToggle(type, value) {
  if (!constraintIsAdmin) return;
  const msg = document.getElementById("msg");
  msg.textContent = "";

  const payload = {
    is_active: value,
    config: type === "lunch_break" ? (constraintCache["lunch_break"]?.config || { start: "12:00", end: "13:00", days: ALL_DAYS }) : null,
  };

  const res = await apiFetch(API + "/constraints/" + type, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    msg.style.color = "#dc2626";
    msg.textContent = data.detail || "Failed to save";
    document.getElementById("toggle-" + type).checked = !value;
    return;
  }

  msg.style.color = "#16a34a";
  msg.textContent = `Constraint '${type}' ${value ? "activated" : "deactivated"}.`;

  constraintCache[type] = data;

  const card = document.getElementById("card-" + type);
  if (card) card.classList.toggle("active", value);

  if (type === "lunch_break") {
    const lunchConfig = document.getElementById("lunchConfig");
    if (lunchConfig) lunchConfig.classList.toggle("show", value);
  }
}

async function saveLunchConfig() {
  const start = document.getElementById("lunchStart").value;
  const end = document.getElementById("lunchEnd").value;
  const days = Array.from(document.querySelectorAll(".day-check:checked")).map(cb => cb.value);

  const msg = document.getElementById("msg");
  msg.textContent = "";

  const res = await apiFetch(API + "/constraints/lunch_break", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
    body: JSON.stringify({
      is_active: document.getElementById("toggle-lunch_break").checked,
      config: { start, end, days },
    }),
  });
  const data = await res.json();

  if (!res.ok) { msg.style.color = "#dc2626"; msg.textContent = data.detail || "Failed to save lunch break"; return; }
  constraintCache["lunch_break"] = data;
  msg.style.color = "#16a34a";
  msg.textContent = "Lunch break configuration saved.";
}

document.addEventListener("DOMContentLoaded", initConstraintsPage);
