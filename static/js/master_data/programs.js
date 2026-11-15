// static/js/master_data/programs.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

let editingProgramId = null;

let programIsAdmin = false;

function validateProgramField(fieldId) {
  const el = document.getElementById(fieldId);
  const msgEl = document.getElementById(fieldId + "Msg");
  if (!el || !msgEl) return true;

  const value = el.value.trim();
  let errorMsg = "";

  if (fieldId === "program_code") {
    if (!value) errorMsg = "Program code is required.";
    else if (!/^\d{4}$/.test(value)) errorMsg = "Program code must be 4 digits (e.g., 0105).";
  } else if (fieldId === "program_name") {
    if (!value) errorMsg = "Program name is required.";
  } else if (fieldId === "department_id") {
    if (!value) errorMsg = "Please select a department.";
  }

  msgEl.textContent = errorMsg;
  if (errorMsg) { el.classList.add("input-error"); return false; }
  el.classList.remove("input-error");
  return true;
}

async function initProgramsPage() {
  const table = document.getElementById("programTable");
  if (!table) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  programIsAdmin = me.roles.includes("admin");

  const formPanel = document.getElementById("formPanel");
  const accessMsg = document.getElementById("accessMsg");
  const actionCol = document.getElementById("actionCol");

  if (programIsAdmin) {
    formPanel.style.display = "block";
    accessMsg.textContent = "";
  } else {
    formPanel.style.display = "none";
    actionCol.style.display = "none";
    accessMsg.textContent = "Read-only. Only admins can modify programs.";
  }

  try {
    const deptRes = await apiFetch(API + "/programs/departments", { headers: { "Authorization": "Bearer " + token } });
    if (deptRes.ok) {
      const depts = await deptRes.json();
      const sel = document.getElementById("department_id");
      if (sel) sel.innerHTML = `<option value="">-- Select department --</option>` + depts.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
    }
  } catch (e) { console.error(e); }

  const form = document.getElementById("programForm");
  ["program_code", "program_name", "department_id"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, () => {
      validateProgramField(id);
      const fm = document.getElementById("formMsg");
      if (fm) fm.textContent = "";
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formMsg = document.getElementById("formMsg");
    formMsg.textContent = "";

    const okCode = validateProgramField("program_code");
    const okName = validateProgramField("program_name");
    const okDept = validateProgramField("department_id");
    if (!okCode || !okName || !okDept) return;

    const payload = {
      program_code: document.getElementById("program_code").value.trim(),
      program_name: document.getElementById("program_name").value.trim(),
      department_id: parseInt(document.getElementById("department_id").value, 10),
      tracks: document.getElementById("tracks").value.trim() || null,
    };

    const url = editingProgramId ? API + "/programs/" + editingProgramId : API + "/programs";
    const method = editingProgramId ? "PUT" : "POST";

    const r = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify(payload),
    });
    const data = await r.json();

    if (!r.ok) {
      formMsg.style.color = "#dc2626";
      formMsg.textContent = data.detail || "Failed";
      return;
    }

    formMsg.style.color = "#16a34a";
    formMsg.textContent = editingProgramId ? "Program updated" : "Program created";
    editingProgramId = null;
    document.getElementById("formSubmitBtn").textContent = "Save Program";
    document.getElementById("formTitle").textContent = "Add Program";
    form.reset();
    loadPrograms();
  });

  loadPrograms();
}

async function loadPrograms() {
  const tbody = document.getElementById("programTable");
  if (!tbody) return;

  const res = await apiFetch(API + "/programs", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { tbody.innerHTML = `<tr><td colspan="6">Failed to load</td></tr>`; return; }
  const programs = await res.json();

  document.getElementById("countLabel").textContent = `${programs.length} program(s)`;

  tbody.innerHTML = programs.map(p => `
    <tr>
      <td><span class="badge badge-code">${escapeHTML(p.program_code)}</span></td>
      <td><b>${escapeHTML(p.program_name)}</b></td>
      <td><span class="badge badge-dept">${escapeHTML(p.department_name || "-")}</span></td>
      <td>${p.tracks ? `<span class="badge" style="background:#dcfce7;color:#166534;">${escapeHTML(p.tracks)}</span>` : "-"}</td>
      <td>${p.group_count}</td>
      ${programIsAdmin ? `<td><button class="btn-edit" onclick="editProgram(${p.id})">Edit</button><button class="btn-del" onclick="deleteProgram(${p.id})">Delete</button></td>` : `<td></td>`}
    </tr>
  `).join("");
}

async function editProgram(id) {
  const res = await apiFetch(API + "/programs", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) return;
  const list = await res.json();
  const p = list.find(x => x.id === id);
  if (!p) return;

  document.getElementById("program_code").value = p.program_code;
  document.getElementById("program_name").value = p.program_name;
  document.getElementById("department_id").value = p.department_id;
  document.getElementById("tracks").value = p.tracks || "";

  editingProgramId = id;
  document.getElementById("formTitle").textContent = "Edit Program";
  document.getElementById("formSubmitBtn").textContent = "Update Program";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteProgram(id) {
  const ok = await showConfirm("Delete Program", "Are you sure you want to delete this program? This cannot be undone.");
  if (!ok) return;

  const res = await apiFetch(API + "/programs/" + id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    showNotice(data.detail || "Delete failed", "error");
    return;
  }
  showNotice("Program deleted", "success");
  loadPrograms();
}

document.addEventListener("DOMContentLoaded", initProgramsPage);
