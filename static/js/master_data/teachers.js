// static/js/master_data/teachers.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

let editingTeacherId = null;

let isAdminTeacher = false;

let allCoursesForTeacher = [];

let selectedTeacherCourses = [];

function renderSelectedCourses() {
  const container = document.getElementById("selectedCoursesContainer");
  if (!container) return;

  container.innerHTML = selectedTeacherCourses.map(c => `
    <div class="tag" style="display:inline-flex; align-items:center; background:#e0e7ff; color:#3730a3; padding:4px 10px; border-radius:16px; font-size:13px; font-weight:600; border:1px solid #c7d2fe;">
      ${c.code} - ${c.name}
      <span class="tag-close" onclick="removeCourseTag('${c.code}')" style="margin-left:8px; cursor:pointer; font-size:16px; line-height:1; color:#dc2626;">&times;</span>
    </div>
  `).join("");
}

function removeCourseTag(code) {
  selectedTeacherCourses = selectedTeacherCourses.filter(c => c.code !== code);
  renderSelectedCourses();
}

function addCourseTag(code, name) {
  selectedTeacherCourses.push({ code, name });
  renderSelectedCourses();

  const input = document.getElementById("courseSearchInput");
  if (input) input.value = "";
  const suggest = document.getElementById("courseSuggestions");
  if (suggest) suggest.style.display = "none";
}

function validateTeacherField(fieldId) {
  const el = document.getElementById(fieldId);
  const msg = document.getElementById(fieldId + "Msg");
  if (!el || !msg) return true;

  const v = el.value.trim();
  let err = "";

  if (fieldId === "full_name" && !v) err = "Full name is required.";
  if (fieldId === "email") {
    if (!v) err = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) err = "Enter a valid email address.";
  }
  if (fieldId === "department" && !v) err = "Department is required.";
  if (fieldId === "max_weekly_hours") {
    if (!v) err = "Max weekly hours is required.";
    else {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1 || n > 40) err = "Max weekly hours must be between 1 and 40.";
    }
  }
  if (fieldId === "max_daily_hours") {
    if (!v) err = "Max daily hours is required.";
    else {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1 || n > 12) err = "Max daily hours must be between 1 and 12.";
    }
  }

  msg.textContent = err;
  if (err) { el.classList.add("input-error"); return false; }
  el.classList.remove("input-error");
  return true;
}

async function initTeachersPage() {
  const table = document.getElementById("teacherTable");
  if (!table) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  isAdminTeacher = me.roles.includes("admin");

  const formPanel = document.getElementById("formPanel");
  const accessMsg = document.getElementById("accessMsg");
  const actionCol = document.getElementById("actionCol");

  if (isAdminTeacher) {
    if (formPanel) formPanel.style.display = "block";
    if (accessMsg) accessMsg.textContent = "";
  } else {
    if (formPanel) formPanel.style.display = "none";
    if (actionCol) actionCol.style.display = "none";
    if (accessMsg) accessMsg.textContent = "You have read-only access.";
  }

  try {
    const courseRes = await apiFetch(API + "/courses", { headers: { "Authorization": "Bearer " + token } });
    if (courseRes.ok) allCoursesForTeacher = await courseRes.json();
  } catch (e) { console.error(e); }

  const searchInput = document.getElementById("courseSearchInput");
  const suggestBox = document.getElementById("courseSuggestions");

  if (searchInput && suggestBox) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) { suggestBox.style.display = "none"; return; }

      const matches = allCoursesForTeacher.filter(c =>
        !selectedTeacherCourses.some(sc => sc.code === c.course_code) &&
        (c.course_code.toLowerCase().includes(q) || c.course_name.toLowerCase().includes(q))
      );

      if (matches.length === 0) {
        suggestBox.innerHTML = `<div style="padding:10px; color:#888; font-size:13px;">No courses found</div>`;
      } else {
        suggestBox.innerHTML = matches.slice(0, 15).map(c => `
          <div onclick="addCourseTag('${c.course_code}', '${c.course_name.replace(/'/g, "\\'")}')"
               style="padding:10px; cursor:pointer; border-bottom:1px solid #eee; font-size:13px;"
               onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='#fff'">
            <b>${c.course_code}</b> - ${c.course_name}
          </div>
        `).join("");
      }
      suggestBox.style.display = "block";
    });

    searchInput.addEventListener("focus", () => {
      if (searchInput.value.trim() && suggestBox.innerHTML.trim()) suggestBox.style.display = "block";
    });

    document.addEventListener("click", (e) => {
      if (!searchInput.contains(e.target) && !suggestBox.contains(e.target)) {
        suggestBox.style.display = "none";
      }
    });
  }

  const form = document.getElementById("teacherForm");
  if (form) {
    ["full_name", "email", "department", "max_weekly_hours", "max_daily_hours"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, () => {
        validateTeacherField(id);
        const fm = document.getElementById("formMsg");
        if (fm) fm.textContent = "";
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("formMsg");
      msg.textContent = "";

      const fields = ["full_name", "email", "department", "max_weekly_hours", "max_daily_hours"];
      let hasErr = false;
      fields.forEach(f => { if (!validateTeacherField(f)) hasErr = true; });
      if (hasErr) return;

      const subjectsStr = selectedTeacherCourses.map(c => c.code).join(", ");

      const payload = {
        full_name: document.getElementById("full_name").value.trim(),
        email: document.getElementById("email").value.trim(),
        academic_title: document.getElementById("academic_title").value.trim() || null,
        department: document.getElementById("department").value.trim(),
        max_weekly_hours: parseInt(document.getElementById("max_weekly_hours").value.trim(), 10),
        max_daily_hours: parseInt(document.getElementById("max_daily_hours").value.trim(), 10),
        qualified_subjects: subjectsStr || null,
      };

      const url = editingTeacherId ? API + "/teachers/" + editingTeacherId : API + "/teachers";
      const method = editingTeacherId ? "PUT" : "POST";

      try {
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
        msg.textContent = editingTeacherId ? "Faculty updated" : "Faculty saved";

        editingTeacherId = null;
        selectedTeacherCourses = [];
        renderSelectedCourses();
        document.getElementById("formSubmitBtn").textContent = "Save Faculty";
        document.getElementById("formTitle").textContent = "Add Faculty";
        form.reset();

        fields.forEach(id => {
          const m = document.getElementById(id + "Msg"); if (m) m.textContent = "";
          const el = document.getElementById(id); if (el) el.classList.remove("input-error");
        });

        loadTeachers();
      } catch (err) {
        msg.style.color = "#dc2626";
        msg.textContent = "Network error occurred.";
      }
    });
  }
  loadTeachers();
}

async function loadTeachers() {
  const tbody = document.getElementById("teacherTable");
  if (!tbody) return;

  const res = await apiFetch(API + "/teachers", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { tbody.innerHTML = `<tr><td colspan="8">Failed to load faculty</td></tr>`; return; }
  const teachers = await res.json();

  if (teachers.length === 0) { tbody.innerHTML = `<tr><td colspan="8" style="color:#888;">No faculty yet.</td></tr>`; return; }

  tbody.innerHTML = teachers.map(t => {
    // 把 "CSS 105, MAT 156" 变成多行显示
    let subjectsHtml = "-";
    if (t.qualified_subjects) {
      const codes = t.qualified_subjects.split(",").map(s => s.trim()).filter(Boolean);
      subjectsHtml = codes.map(code => {
        const found = allCoursesForTeacher.find(c => c.course_code === code);
        const name = found ? found.course_name : "Unknown";
        return `<div style="font-size:12px; margin-bottom:2px;"><b>${escapeHTML(code)}</b> - ${escapeHTML(name)}</div>`;
      }).join("");
    }

    return `
      <tr>
        <td><b>${escapeHTML(t.full_name)}</b></td>
        <td>${escapeHTML(t.email)}</td>
        <td>${escapeHTML(t.academic_title || "-")}</td>
        <td><span class="badge">${escapeHTML(t.department)}</span></td>
        <td>${t.max_weekly_hours}</td>
        <td>${t.max_daily_hours}</td>
        <td>${subjectsHtml}</td>
        ${isAdminTeacher ? `
          <td>
            <button class="btn-edit" onclick="editTeacher(${t.id})">Edit</button>
            <button class="btn-del" onclick="deleteTeacher(${t.id})">Delete</button>
          </td>
        ` : `<td></td>`}
      </tr>
    `;
  }).join("");
}

async function editTeacher(id) {
  const res = await apiFetch(API + "/teachers", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) return;
  const teachers = await res.json();
  const t = teachers.find(x => x.id === id);
  if (!t) return;

  document.getElementById("full_name").value = t.full_name;
  document.getElementById("email").value = t.email;
  document.getElementById("academic_title").value = t.academic_title || "";
  document.getElementById("department").value = t.department;
  document.getElementById("max_weekly_hours").value = t.max_weekly_hours;
  document.getElementById("max_daily_hours").value = t.max_daily_hours;

  // 回填标签
  selectedTeacherCourses = [];
  if (t.qualified_subjects) {
    const codes = t.qualified_subjects.split(",").map(s => s.trim());
    codes.forEach(code => {
      const found = allCoursesForTeacher.find(c => c.course_code === code);
      if (found) {
        selectedTeacherCourses.push({ code: found.course_code, name: found.course_name });
      } else {
        selectedTeacherCourses.push({ code: code, name: "Legacy Subject" });
      }
    });
  }
  renderSelectedCourses();

  editingTeacherId = id;
  document.getElementById("formTitle").textContent = "Edit Faculty";
  document.getElementById("formSubmitBtn").textContent = "Update Faculty";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteTeacher(id) {
  const ok = await showConfirm("Delete Faculty Profile", "Are you sure you want to delete this faculty profile? This cannot be undone.");
  if (!ok) return;

  const res = await apiFetch(API + "/teachers/" + id, { method: "DELETE", headers: { "Authorization": "Bearer " + getToken() } });
  const data = await res.json();
  if (!res.ok) { showNotice(data.detail || "Delete failed", "error"); return; }
  showNotice("Faculty deleted", "success");
  loadTeachers();
}

function filterTeachers() {
  const el = document.getElementById("teacherFilter");
  if (!el) return;
  const q = el.value.toLowerCase();
  document.querySelectorAll("#teacherTable tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

document.addEventListener("DOMContentLoaded", initTeachersPage);
