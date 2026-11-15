// static/js/master_data/courses.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

let editingCourseId = null;

let isAdminCourse = false;

let courseDeptCache = []; // 存放 Departments 和它们的嵌套 Programs

let allCoursesCache = []; // 存放所有课程，用于前端过滤

function validateCourseField(fieldId) {
  const el = document.getElementById(fieldId);
  const msg = document.getElementById(fieldId + "Msg");
  if (!el || !msg) return true;

  const v = el.value.trim();
  let err = "";

  if (fieldId === "department" && !v) err = "Please select a department.";
  if (fieldId === "program_id" && !v) err = "Please select a program.";
  if (fieldId === "course_code" && !v) err = "Course code is required.";
  if (fieldId === "course_name" && !v) err = "Course name is required.";

  if (fieldId === "credits") {
    if (!v) err = "Credits is required.";
    else {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1 || n > 30) err = "Credits must be between 1 and 30.";
    }
  }
  if (fieldId === "total_hours") {
    if (!v) err = "Total hours is required.";
    else {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1 || n > 20) err = "Total hours must be between 1 and 20.";
    }
  }
  if (["lecture_hours", "practice_hours", "lab_hours"].includes(fieldId)) {
    if (v) {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0 || n > 20) err = "Must be between 0 and 20.";
    }
  }

  msg.textContent = err;
  if (err) { el.classList.add("input-error"); return false; }
  el.classList.remove("input-error");
  return true;
}

// 联动：Department -> Program
function onCourseDeptChange() {
  const deptName = document.getElementById("department").value;
  const progSel = document.getElementById("program_id");
  const trackSel = document.getElementById("track");

  progSel.innerHTML = `<option value="">-- Select program --</option>`;
  trackSel.innerHTML = `<option value="">-- Select track --</option>`;

  if (!deptName) return;

  const dept = courseDeptCache.find(d => d.name === deptName);
  if (dept) {
    progSel.innerHTML += dept.programs.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
  }
}

// 联动：Program -> Track
function onCourseProgramChange() {
  const progId = parseInt(document.getElementById("program_id").value, 10);
  const trackSel = document.getElementById("track");
  trackSel.innerHTML = `<option value="">-- Select track --</option>`;

  if (!progId) return;

  apiFetch(API + "/programs", { headers: { "Authorization": "Bearer " + getToken() } })
    .then(res => res.json())
    .then(progs => {
      const prog = progs.find(p => p.id === progId);
      if (prog && prog.tracks) {
        const tracks = prog.tracks.split(",").map(t => t.trim()).filter(Boolean);
        tracks.forEach(t => {
          trackSel.innerHTML += `<option value="${t}">${t}</option>`;
        });
      }
    });
}

function onElectiveChange() {
  const isChecked = document.getElementById("is_elective").checked;
  const trackSel = document.getElementById("track");

  if (isChecked) {
    trackSel.disabled = false;
    onCourseProgramChange();
  } else {
    trackSel.disabled = true;
    trackSel.value = "";
    document.getElementById("trackMsg").textContent = "";
  }
}

async function initCoursesPage() {
  const table = document.getElementById("courseTable");
  if (!table) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  isAdminCourse = me.roles.includes("admin");

  const formPanel = document.getElementById("formPanel");
  const accessMsg = document.getElementById("accessMsg");
  const actionCol = document.getElementById("actionCol");

  if (isAdminCourse) {
    if (formPanel) formPanel.style.display = "block";
    if (accessMsg) accessMsg.textContent = "";
  } else {
    if (formPanel) formPanel.style.display = "none";
    if (actionCol) actionCol.style.display = "none";
    if (accessMsg) accessMsg.textContent = "You have read-only access.";
  }

  try {
    const deptRes = await apiFetch(API + "/student-groups/departments", { headers: { "Authorization": "Bearer " + token } });
    if (deptRes.ok) {
      courseDeptCache = await deptRes.json();
    }

    const filterSel = document.getElementById("filterProgram");
    if (filterSel) {
      const uniqueProgs = new Map();
      courseDeptCache.forEach(d => d.programs.forEach(p => uniqueProgs.set(p.id, p.name)));
      uniqueProgs.forEach((name) => {
        filterSel.innerHTML += `<option value="${name}">${name}</option>`;
      });
    }
  } catch (e) {
    console.error("Failed to load departments", e);
  }

  const form = document.getElementById("courseForm");
  if (form) {
    ["course_code", "course_name", "program_id", "credits", "total_hours", "lecture_hours", "practice_hours", "lab_hours"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, () => {
        validateCourseField(id);
        const fm = document.getElementById("formMsg");
        if (fm) fm.textContent = "";
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("formMsg");
      msg.textContent = "";

      const fields = ["course_code", "course_name", "department", "program_id", "credits", "total_hours", "lecture_hours", "practice_hours", "lab_hours"];
      let hasError = false;
      fields.forEach(f => {
        if (!validateCourseField(f)) hasError = true;
      });
      if (hasError) {
        msg.style.color = "#dc2626";
        msg.textContent = "Please fix the errors above before saving.";
        return;
      }

      const payload = {
        course_code: document.getElementById("course_code").value.trim(),
        course_name: document.getElementById("course_name").value.trim(),
        program_id: parseInt(document.getElementById("program_id").value, 10),
        credits: parseInt(document.getElementById("credits").value.trim(), 10),
        semester_level: document.getElementById("semester_level").value.trim() || null,
        total_hours: parseInt(document.getElementById("total_hours").value.trim(), 10),
        lecture_hours: parseInt(document.getElementById("lecture_hours").value.trim() || "0", 10),
        practice_hours: parseInt(document.getElementById("practice_hours").value.trim() || "0", 10),
        lab_hours: parseInt(document.getElementById("lab_hours").value.trim() || "0", 10),
        is_elective: document.getElementById("is_elective").checked,
        track: document.getElementById("is_elective").checked ? (document.getElementById("track").value.trim() || null) : null,
        department: document.getElementById("department").value || null,
      };

      const sum = payload.lecture_hours + payload.practice_hours + payload.lab_hours;
      if (sum !== payload.total_hours) {
        msg.style.color = "#dc2626";
        msg.textContent = `Total session hours (${sum}) do not match Total Hours (${payload.total_hours}).`;
        ["lecture_hours", "practice_hours", "lab_hours", "total_hours"].forEach(highlightField);
        return;
      }

      const url = editingCourseId ? API + "/courses/" + editingCourseId : API + "/courses";
      const method = editingCourseId ? "PUT" : "POST";

      const r = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
        body: JSON.stringify(payload),
      });
      const data = await r.json();

      if (!r.ok) {
        msg.style.color = "#dc2626";
        msg.textContent = data.detail || "Failed";
        return;
      }

      msg.style.color = "#16a34a";
      msg.textContent = editingCourseId ? "Course updated successfully" : "Course added successfully";

      editingCourseId = null;
      document.getElementById("formSubmitBtn").textContent = "Save Course";
      document.getElementById("formTitle").textContent = "Add Course";
      form.reset();
      onCourseDeptChange();
      onElectiveChange();

      fields.forEach(id => {
        const m = document.getElementById(id + "Msg");
        if (m) m.textContent = "";
        const el = document.getElementById(id);
        if (el) el.classList.remove("input-error");
      });

      loadCourses();
    });
  }

  loadCourses();
}

async function loadCourses() {
  const tbody = document.getElementById("courseTable");
  if (!tbody) return;

  const res = await apiFetch(API + "/courses", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { tbody.innerHTML = `<tr><td colspan="10">Failed to load courses</td></tr>`; return; }
  allCoursesCache = await res.json();

  applyCourseFilters();
}

function applyCourseFilters() {
  const tbody = document.getElementById("courseTable");
  if (!tbody) return;

  const searchQ = document.getElementById("courseFilter").value.toLowerCase();
  const filterProg = document.getElementById("filterProgram").value;

  let filtered = allCoursesCache;

  if (filterProg !== "all") {
    filtered = filtered.filter(c => c.program_name === filterProg);
  }
  if (searchQ) {
    filtered = filtered.filter(c =>
      c.course_code.toLowerCase().includes(searchQ) ||
      c.course_name.toLowerCase().includes(searchQ)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="color:#888;">No courses found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const split = `${c.lecture_hours}L + ${c.practice_hours}P + ${c.lab_hours}Lab`;
    const typeBadge = c.is_elective
        ? `<span class="badge" style="background:#dcfce7;color:#166534;">Elective</span>`
        : `<span class="badge" style="background:#f3f4f6;color:#4b5563;">Core</span>`;
    const trackBadge = c.track ? `<span class="badge" style="background:#fef3c7;color:#92400e;">${c.track}</span>` : "-";

    return `
      <tr>
        <td><b>${escapeHTML(c.course_code)}</b></td>
        <td>${escapeHTML(c.course_name)}</td>
        <td><span class="badge">${escapeHTML(c.program_name || "-")}</span></td>
        <td>${c.credits} ECTS</td>
        <td>${escapeHTML(c.semester_level || "-")}</td>
        <td><span class="split">${escapeHTML(split)}</span></td>
        <td>${typeBadge}</td>
        <td>${trackBadge}</td>
        <td>${c.department ? `<span class="badge">${escapeHTML(c.department)}</span>` : "-"}</td>
        ${isAdminCourse ? `
          <td>
            <button class="btn-edit" onclick="editCourse(${c.id})">Edit</button>
            <button class="btn-del" onclick="deleteCourse(${c.id})">Delete</button>
          </td>
        ` : `<td></td>`}
      </tr>
    `;
  }).join("");
}

async function editCourse(id) {
  const c = allCoursesCache.find(x => x.id === id);
  if (!c) return;

  let targetDept = "";
  courseDeptCache.forEach(d => {
    if (d.programs.some(p => p.id === c.program_id)) {
      targetDept = d.name;
    }
  });
  document.getElementById("department").value = targetDept || "";
  onCourseDeptChange();

  document.getElementById("program_id").value = c.program_id || "";

  document.getElementById("course_code").value = c.course_code;
  document.getElementById("course_name").value = c.course_name;
  document.getElementById("credits").value = c.credits;
  document.getElementById("semester_level").value = c.semester_level || "";
  document.getElementById("total_hours").value = c.total_hours;
  document.getElementById("lecture_hours").value = c.lecture_hours;
  document.getElementById("practice_hours").value = c.practice_hours;
  document.getElementById("lab_hours").value = c.lab_hours;
  document.getElementById("is_elective").checked = c.is_elective;

  onElectiveChange();
  document.getElementById("track").value = c.track || "";

  editingCourseId = id;
  document.getElementById("formTitle").textContent = "Edit Course";
  document.getElementById("formSubmitBtn").textContent = "Update Course";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteCourse(id) {
  const ok = await showConfirm("Delete Course", "Are you sure you want to delete this course? This cannot be undone.");
  if (!ok) return;
  const res = await apiFetch(API + "/courses/" + id, { method: "DELETE", headers: { "Authorization": "Bearer " + getToken() } });
  const data = await res.json();
  if (!res.ok) { showNotice(data.detail || "Delete failed", "error"); return; }
  showNotice("Course deleted", "success");
  loadCourses();
}

function filterCourses() {
  applyCourseFilters();
}

document.addEventListener("DOMContentLoaded", initCoursesPage);
