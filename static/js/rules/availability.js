// static/js/rules/availability.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

let availConfig = { days: [], time_slots: [], slot_hours: 1.5 };

let availMatrix = {};

let availFrozen = false;

let availMaxHours = 20;

let availIsAdmin = false;

let availIsTeacher = false;

const AVAIL_CYCLE = ["preferred", "neutral", "blocked"];

async function initAvailabilityPage() {
  const grid = document.getElementById("gridTable");
  if (!grid || !document.getElementById("teacherSelect")) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  availIsAdmin = me.roles.includes("admin");
  availIsTeacher = me.roles.includes("teacher");

  const cfgRes = await apiFetch(API + "/availability/config", { headers: { "Authorization": "Bearer " + token } });
  if (!cfgRes.ok) return;
  availConfig = await cfgRes.json();

  const myRes = await apiFetch(API + "/availability/me", { headers: { "Authorization": "Bearer " + token } });
  if (!myRes.ok) return;
  const myData = await myRes.json();
  availMatrix = myData.matrix;
  availFrozen = myData.is_frozen;
  availMaxHours = myData.max_hours;

  if (!availIsTeacher) {
    document.getElementById("actions").style.display = "none";
    document.getElementById("hint").textContent = "You have read-only access. Only teachers can submit preferences.";
  }

  if (availIsAdmin) {
    document.getElementById("adminTools").style.display = "block";
    updateFreezeUI();
    loadTeacherList();
  }

  renderAvailabilityGrid();
  updateStats();
}

function renderAvailabilityGrid() {
  const grid = document.getElementById("gridTable");
  const { days, time_slots } = availConfig;

  let html = "<thead><tr><th>Time</th>";
  days.forEach(d => html += `<th>${d}</th>`);
  html += "</tr></thead><tbody>";

  time_slots.forEach(slot => {
    html += `<tr><td class="slot-label">${slot}</td>`;
    days.forEach(day => {
      const status = (availMatrix[day] && availMatrix[day][slot]) || "neutral";
      html += `<td class="cell ${status}" data-day="${day}" data-slot="${slot}" onclick="cycleCell(this)"></td>`;
    });
    html += "</tr>";
  });
  html += "</tbody>";
  grid.innerHTML = html;

  if (availFrozen) {
    grid.classList.add("readonly");
    document.getElementById("actions").style.display = "none";
    document.getElementById("hint").textContent = "Preference submission period is closed.";
  }
}

function cycleCell(td) {
  if (availFrozen) return;
  if (!availIsTeacher) return;

  const current = AVAIL_CYCLE.find(s => td.classList.contains(s)) || "neutral";
  const next = AVAIL_CYCLE[(AVAIL_CYCLE.indexOf(current) + 1) % AVAIL_CYCLE.length];

  AVAIL_CYCLE.forEach(s => td.classList.remove(s));
  td.classList.add(next);

  const day = td.dataset.day;
  const slot = td.dataset.slot;
  if (!availMatrix[day]) availMatrix[day] = {};
  availMatrix[day][slot] = next;

  updateStats();
}

function computeClientStats() {
  const { days, time_slots, slot_hours } = availConfig;
  let available = 0;
  days.forEach(d => {
    time_slots.forEach(s => {
      const st = (availMatrix[d] && availMatrix[d][s]) || "neutral";
      if (st !== "blocked") available++;
    });
  });
  const availableHours = available * slot_hours;
  const requiredHours = availMaxHours * 1.5;
  return { available, availableHours, requiredHours, ok: availableHours >= requiredHours };
}

function updateStats() {
  const s = computeClientStats();
  const row = document.getElementById("statsRow");
  row.innerHTML = `
    <span class="stat">Required max: ${availMaxHours}h / week</span>
    <span class="stat">Minimum availability: ${s.requiredHours.toFixed(1)}h (150%)</span>
    <span class="stat ${s.ok ? "ok" : "bad"}">Currently available: ${s.availableHours.toFixed(1)}h</span>
  `;
}

async function saveAvailability() {
  const msg = document.getElementById("msg");
  msg.textContent = "";

  const s = computeClientStats();
  if (!s.ok) {
    msg.style.color = "#dc2626";
    msg.textContent = `Available timeslots must cover at least ${s.requiredHours} hours (150% of ${availMaxHours}h load).`;
    return;
  }

  const res = await apiFetch(API + "/availability/me", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
    body: JSON.stringify({ matrix: availMatrix }),
  });
  const data = await res.json();

  if (!res.ok) {
    msg.style.color = "#dc2626";
    msg.textContent = data.detail || "Failed to save";
    return;
  }

  msg.style.color = "#16a34a";
  msg.textContent = "Availability preferences saved";
}

function resetMatrix() {
  const { days, time_slots } = availConfig;
  const fresh = {};
  days.forEach(d => {
    fresh[d] = {};
    time_slots.forEach(s => fresh[d][s] = "neutral");
  });
  availMatrix = fresh;
  renderAvailabilityGrid();
  updateStats();
}

function updateFreezeUI() {
  const el = document.getElementById("freezeStatus");
  el.textContent = availFrozen ? "FROZEN (read-only)" : "Open";
  el.style.color = availFrozen ? "#dc2626" : "#16a34a";
}

async function toggleFreeze() {
  const res = await apiFetch(API + "/availability/freeze", { method: "POST", headers: { "Authorization": "Bearer " + getToken() } });
  const data = await res.json();
  if (!res.ok) { alert(data.detail || "Failed"); return; }
  availFrozen = data.is_frozen;
  updateFreezeUI();
  window.location.reload();
}

async function loadTeacherList() {
  const res = await apiFetch(API + "/availability/teachers", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) return;
  const list = await res.json();
  const sel = document.getElementById("teacherSelect");
  sel.innerHTML = `<option value="">— Select a teacher —</option>` +
    list.map(t => `<option value="${t.id}">${t.full_name} (${t.email})</option>`).join("");
}

async function viewTeacherAvailability() {
  const id = document.getElementById("teacherSelect").value;
  const box = document.getElementById("teacherView");
  if (!id) { box.innerHTML = ""; return; }

  const res = await apiFetch(API + "/availability/teacher/" + id, { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { box.innerHTML = "Failed to load."; return; }
  const data = await res.json();

  const { days, time_slots } = availConfig;
  let html = `<p style="margin-top:12px;"><b>${data.full_name}</b> (Max ${data.max_hours}h/week) — Available: ${data.stats.available_hours}h</p>`;
  html += `<table class="grid readonly"><thead><tr><th>Time</th>`;
  days.forEach(d => html += `<th>${d}</th>`);
  html += `</tr></thead><tbody>`;
  time_slots.forEach(slot => {
    html += `<tr><td class="slot-label">${slot}</td>`;
    days.forEach(day => {
      const st = (data.matrix[day] && data.matrix[day][slot]) || "neutral";
      html += `<td class="cell ${st}"></td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  box.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", initAvailabilityPage);
