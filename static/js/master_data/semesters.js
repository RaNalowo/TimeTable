// static/js/master_data/semesters.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

let editingSemesterId = null;

let semesterIsAdmin = false;

function validateSemesterField(fieldId) {
  const inputEl = document.getElementById(fieldId);
  const msgEl = document.getElementById(fieldId + "Msg");
  if (!inputEl || !msgEl) return true;

  const value = inputEl.value.trim();
  let errorMsg = "";

  if (fieldId === "name") {
    if (!value) errorMsg = "Semester name is required.";
    else if (!/^(\d{4})\s+(Fall|Spring|Summer)$/i.test(value)) errorMsg = "Format must be like '2025 Fall' or '2026 Spring'.";
  } else if (fieldId === "start_date" || fieldId === "end_date") {
    if (!value) errorMsg = fieldId === "start_date" ? "Start date is required." : "End date is required.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) errorMsg = "Date must be in format YYYY-MM-DD (e.g., 2026-09-01).";
  }

  msgEl.textContent = errorMsg;
  if (errorMsg) { inputEl.classList.add("input-error"); return false; }
  inputEl.classList.remove("input-error");
  return true;
}

async function initSemestersPage() {
  const table = document.getElementById("semesterTable");
  if (!table) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  semesterIsAdmin = me.roles.includes("admin");

  const formPanel = document.getElementById("formPanel");
  const accessMsg = document.getElementById("accessMsg");
  const actionCol = document.getElementById("actionCol");

  if (semesterIsAdmin) {
    formPanel.style.display = "block";
    accessMsg.textContent = "";
  } else {
    formPanel.style.display = "none";
    actionCol.style.display = "none";
    accessMsg.textContent = "Read-only. Only admins can modify semesters.";
  }

  const form = document.getElementById("semesterForm");
  ["name", "start_date", "end_date"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      validateSemesterField(id);
      const fm = document.getElementById("formMsg");
      if (fm) fm.textContent = "";
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formMsg = document.getElementById("formMsg");
    formMsg.textContent = "";

    const okName = validateSemesterField("name");
    const okStart = validateSemesterField("start_date");
    const okEnd = validateSemesterField("end_date");
    if (!okName || !okStart || !okEnd) return;

    const name = document.getElementById("name").value.trim();
    const start_date = document.getElementById("start_date").value.trim();
    const end_date = document.getElementById("end_date").value.trim();

    if (start_date >= end_date) {
      document.getElementById("end_dateMsg").textContent = "End date must be after start date.";
      document.getElementById("end_date").classList.add("input-error");
      return;
    }

    const m = name.match(/^(\d{4})\s+(Fall|Spring|Summer)$/i);
    if (!m) {
      document.getElementById("nameMsg").textContent = "Semester name must be like '2025 Fall' or '2026 Spring'.";
      document.getElementById("name").classList.add("input-error");
      return;
    }
    const academic_year = parseInt(m[1], 10);
    const term = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();

    const payload = { name, academic_year, term, start_date, end_date };

    const url = editingSemesterId ? API + "/semesters/" + editingSemesterId : API + "/semesters";
    const method = editingSemesterId ? "PUT" : "POST";

    const r = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify(payload),
    });
    const data = await r.json();

    if (!r.ok) {
      if (r.status === 422 && Array.isArray(data.detail)) {
        const field = data.detail[0].loc[data.detail[0].loc.length - 1];
        const map = { "name": "nameMsg", "academic_year": "nameMsg", "term": "nameMsg", "start_date": "start_dateMsg", "end_date": "end_dateMsg" };
        const msgId = map[field] || "nameMsg";
        const inputId = msgId.replace("Msg", "");
        document.getElementById(msgId).textContent = data.detail[0].msg;
        document.getElementById(inputId).classList.add("input-error");
      } else {
        const detail = typeof data.detail === "string" ? data.detail : "Failed";
        if (detail.toLowerCase().includes("name")) {
          document.getElementById("nameMsg").textContent = detail;
          document.getElementById("name").classList.add("input-error");
        } else {
          formMsg.style.color = "#dc2626";
          formMsg.textContent = detail;
        }
      }
      return;
    }

    formMsg.style.color = "#16a34a";
    formMsg.textContent = editingSemesterId ? "Semester updated successfully" : "Semester created successfully";

    editingSemesterId = null;
    document.getElementById("formSubmitBtn").textContent = "Save Semester";
    document.getElementById("formTitle").textContent = "Add Semester";
    form.reset();

    ["name", "start_date", "end_date"].forEach((id) => {
      const msgEl = document.getElementById(id + "Msg");
      if (msgEl) msgEl.textContent = "";
      const inputEl = document.getElementById(id);
      if (inputEl) inputEl.classList.remove("input-error");
    });

    loadSemesters();
  });

  loadSemesters();
}

async function loadSemesters() {
  const tbody = document.getElementById("semesterTable");
  if (!tbody) return;

  const res = await apiFetch(API + "/semesters", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { tbody.innerHTML = `<tr><td colspan="5">Failed to load semesters</td></tr>`; return; }
  const semesters = await res.json();

  const active = semesters.find(s => s.is_active);
  document.getElementById("activeSemesterLabel").textContent = active ? `Active: ${active.name}` : "No active semester";

  if (semesters.length === 0) { tbody.innerHTML = `<tr><td colspan="5" style="color:#888;">No semesters yet.</td></tr>`; return; }

  tbody.innerHTML = semesters.map(s => `
    <tr>
      <td><b>${escapeHTML(s.name)}</b></td>
      <td>${s.start_date}</td>
      <td>${s.end_date}</td>
      <td><span class="badge ${s.is_active ? "badge-active" : "badge-inactive"}">${s.is_active ? "Active" : "Inactive"}</span></td>
      ${semesterIsAdmin ? `
        <td>
          <button class="btn-edit" onclick="editSemester(${s.id})">Edit</button>
          <button class="btn-activate" onclick="activateSemester(${s.id})" ${s.is_active ? "disabled" : ""}>${s.is_active ? "Active" : "Set Active"}</button>
          <button class="btn-del" onclick="deleteSemester(${s.id})">Delete</button>
        </td>
      ` : `<td></td>`}
    </tr>
  `).join("");
}

async function editSemester(id) {
  const res = await apiFetch(API + "/semesters", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) return;
  const list = await res.json();
  const s = list.find(x => x.id === id);
  if (!s) return;

  document.getElementById("name").value = s.name;
  document.getElementById("start_date").value = s.start_date;
  document.getElementById("end_date").value = s.end_date;

  editingSemesterId = id;
  document.getElementById("formTitle").textContent = "Edit Semester";
  document.getElementById("formSubmitBtn").textContent = "Update Semester";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function activateSemester(id) {
  const res = await apiFetch(API + "/semesters/" + id + "/activate", { method: "POST", headers: { "Authorization": "Bearer " + getToken() } });
  const data = await res.json();
  if (!res.ok) { alert(data.detail || "Failed to activate"); return; }
  loadSemesters();
}

async function deleteSemester(id) {
  const ok = await showConfirm("Delete Semester", "Are you sure you want to delete this semester? This cannot be undone.");
  if (!ok) return;

  const res = await apiFetch(API + "/semesters/" + id, { method: "DELETE", headers: { "Authorization": "Bearer " + getToken() } });
  const data = await res.json();
  if (!res.ok) { showNotice(data.detail || "Delete failed", "error"); return; }
  showNotice("Semester deleted", "success");
  loadSemesters();
}

document.addEventListener("DOMContentLoaded", initSemestersPage);
