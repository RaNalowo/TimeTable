// static/js/master_data/student_groups.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

let editingGroupId = null;

let groupIsAdmin = false;

let departmentsCache = [];

let programsCache = [];

function onDepartmentChange() {
  const deptName = document.getElementById("department").value;
  const progSel = document.getElementById("program");
  const trackSel = document.getElementById("track");

  progSel.innerHTML = `<option value="">-- Select program --</option>`;
  trackSel.innerHTML = `<option value="">-- Select track --</option>`;
  trackSel.disabled = true;

  if (!deptName) return;

  const dept = departmentsCache.find(d => d.name === deptName);
  if (dept) {
    progSel.innerHTML += dept.programs.map(p => `<option value="${p.name}">${p.name}</option>`).join("");
  }
}

function onGroupProgramChange() {
  const progName = document.getElementById("program").value;
  const trackSel = document.getElementById("track");
  trackSel.innerHTML = `<option value="">-- Select track --</option>`;

  if (!progName) { trackSel.disabled = true; return; }

  const prog = programsCache.find(p => p.program_name === progName);
  if (prog && prog.tracks) {
    const tracks = prog.tracks.split(",").map(t => t.trim()).filter(Boolean);
    if (tracks.length > 0) {
      tracks.forEach(t => {
        trackSel.innerHTML += `<option value="${t}">${t}</option>`;
      });
      trackSel.disabled = false;
    } else {
      trackSel.disabled = true;
    }
  } else {
    trackSel.disabled = true;
  }
}

function validateGroupField(fieldId) {
  const el = document.getElementById(fieldId);
  const msg = document.getElementById(fieldId + "Msg");
  if (!el || !msg) return true;

  const v = el.value.trim();
  let err = "";

  if (fieldId === "group_code") {
    if (!v) err = "Group code is required.";
    else if (!/^(IS|CS)-\d{2}-[A-Z]+$/i.test(v)) err = "Format must be like IS-23-AI or CS-24-BACK.";
  } else if (fieldId === "department") {
    if (!v) err = "Please select a department.";
  } else if (fieldId === "program") {
    if (!v) err = "Please select a program.";
  } else if (fieldId === "year_override") {
    if (v) {
      const y = parseInt(v, 10);
      if (isNaN(y) || y < 1 || y > 10) err = "Year override must be between 1 and 10.";
    }
  } else if (fieldId === "student_count") {
    if (!v) err = "Student count is required.";
    else {
      const c = parseInt(v, 10);
      if (isNaN(c) || c < 1 || c > 500) err = "Student count must be between 1 and 500.";
    }
  }

  msg.textContent = err;
  if (err) { el.classList.add("input-error"); return false; }
  el.classList.remove("input-error");
  return true;
}

async function initStudentGroupsPage() {
  const table = document.getElementById("groupTable");
  if (!table) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  groupIsAdmin = me.roles.includes("admin");

  const formPanel = document.getElementById("formPanel");
  const accessMsg = document.getElementById("accessMsg");
  const actionCol = document.getElementById("actionCol");

  if (groupIsAdmin) {
    formPanel.style.display = "block";
    accessMsg.textContent = "";
  } else {
    formPanel.style.display = "none";
    actionCol.style.display = "none";
    accessMsg.textContent = "Read-only. Only admins can modify student groups.";
  }

  try {
    const deptRes = await apiFetch(API + "/student-groups/departments", { headers: { "Authorization": "Bearer " + token } });
    if (deptRes.ok) {
      departmentsCache = await deptRes.json();
      const deptSel = document.getElementById("department");
      deptSel.innerHTML = `<option value="">-- Select department --</option>` +
        departmentsCache.map(d => `<option value="${d.name}">${d.name}</option>`).join("");
    }

    const progRes = await apiFetch(API + "/programs", { headers: { "Authorization": "Bearer " + token } });
    if (progRes.ok) {
      programsCache = await progRes.json();
    }
  } catch (e) { console.error(e); }

  const form = document.getElementById("groupForm");
  ["group_code", "department", "program", "student_count"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, () => {
      validateGroupField(id);
      const fm = document.getElementById("formMsg");
      if (fm) fm.textContent = "";
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formMsg = document.getElementById("formMsg");
    formMsg.textContent = "";

    const okCode = validateGroupField("group_code");
    const okDept = validateGroupField("department");
    const okProgram = validateGroupField("program");
    const okCount = validateGroupField("student_count");
    if (!okCode || !okDept || !okProgram || !okCount) return;

    const groupCode = document.getElementById("group_code").value.trim();
    const programName = document.getElementById("program").value;
    const track = document.getElementById("track").value.trim() || null;
    const yearOverrideStr = document.getElementById("year_override").value.trim();
    const studentCountStr = document.getElementById("student_count").value.trim();

    const parts = groupCode.split("-");
    const enrollment_year = parts.length >= 2 ? 2000 + parseInt(parts[1], 10) : null;
    const year_override = yearOverrideStr ? parseInt(yearOverrideStr, 10) : null;
    const student_count = parseInt(studentCountStr, 10);

    const payload = {
      group_code: groupCode,
      program: programName || null,
      track: track,
      enrollment_year: enrollment_year,
      year_override: year_override,
      student_count: student_count,
      sub_group_count: Number(document.getElementById("sub_group_count").value),
    };

    const url = editingGroupId ? API + "/student-groups/" + editingGroupId : API + "/student-groups";
    const method = editingGroupId ? "PUT" : "POST";

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
    formMsg.textContent = editingGroupId ? "Student group updated" : "Student group created";

    editingGroupId = null;
    document.getElementById("formSubmitBtn").textContent = "Save Group";
    document.getElementById("formTitle").textContent = "Add Student Group";
    form.reset();
    onDepartmentChange();

    loadStudentGroups();
  });

  loadStudentGroups();
}

async function loadStudentGroups() {
  const tbody = document.getElementById("groupTable");
  if (!tbody) return;

  const res = await apiFetch(API + "/student-groups", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { tbody.innerHTML = `<tr><td colspan="8">Failed to load groups</td></tr>`; return; }
  const groups = await res.json();

  document.getElementById("countLabel").textContent = `${groups.length} group(s)`;

  if (groups.length === 0) { tbody.innerHTML = `<tr><td colspan="8" style="color:#888;">No groups yet.</td></tr>`; return; }

  tbody.innerHTML = groups.map(g => {
    let currentYear = g.current_year ? `Year ${g.current_year}` : "-";
    if (g.year_override) currentYear += ` <span style="color:#dc2626;font-size:11px;">(override)</span>`;

    return `
      <tr>
        <td><b>${escapeHTML(g.group_code)}</b></td>
        <td>${g.program ? `<span class="badge">${escapeHTML(g.program)}</span>` : "-"}</td>
        <td>${g.track ? `<span class="badge badge-track">${escapeHTML(g.track)}</span>` : "-"}</td>
        <td>${g.department ? `<span class="badge badge-dept">${escapeHTML(g.department)}</span>` : "-"}</td>
        <td>${g.enrollment_year || "-"}</td>
        <td>${currentYear}</td>
        <td>${g.student_count}</td>
        ${groupIsAdmin ? `
          <td>
            <button class="btn-edit" onclick="editGroup(${g.id})">Edit</button>
            <button class="btn-del" onclick="deleteGroup(${g.id})">Delete</button>
          </td>
        ` : `<td></td>`}
      </tr>
    `;
  }).join("");
}

async function editGroup(id) {
  const res = await apiFetch(API + "/student-groups", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) return;
  const list = await res.json();
  const g = list.find(x => x.id === id);
  if (!g) return;

  document.getElementById("group_code").value = g.group_code;
  document.getElementById("student_count").value = g.student_count;
  document.getElementById("sub_group_count").value = g.sub_group_count;
  document.getElementById("year_override").value = g.year_override || "";

  const dept = departmentsCache.find(d => d.programs.some(p => p.name === g.program));
  document.getElementById("department").value = dept ? dept.name : "";
  onDepartmentChange();

  document.getElementById("program").value = g.program || "";
  onGroupProgramChange();

  document.getElementById("track").value = g.track || "";

  editingGroupId = id;
  document.getElementById("formTitle").textContent = "Edit Student Group";
  document.getElementById("formSubmitBtn").textContent = "Update Group";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteGroup(id) {
  const ok = await showConfirm("Delete Student Group", "Are you sure you want to delete this group? This cannot be undone.");
  if (!ok) return;

  const res = await apiFetch(API + "/student-groups/" + id, { method: "DELETE", headers: { "Authorization": "Bearer " + getToken() } });
  const data = await res.json();
  if (!res.ok) { showNotice(data.detail || "Delete failed", "error"); return; }
  showNotice("Student group deleted", "success");
  loadStudentGroups();
}

function filterGroups() {
  const el = document.getElementById("groupFilter");
  if (!el) return;
  const q = el.value.toLowerCase();
  document.querySelectorAll("#groupTable tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

document.addEventListener("DOMContentLoaded", initStudentGroupsPage);
