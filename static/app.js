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

// ---------- Login Page ----------
function initLoginPage() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  const identifierEl = document.getElementById("identifier");
  const passwordEl = document.getElementById("password");
  const identifierMsg = document.getElementById("identifierMsg");
  const passwordMsg = document.getElementById("passwordMsg");
  const errorEl = document.getElementById("error");

  identifierEl.addEventListener("input", () => {
    identifierMsg.textContent = "";
    identifierEl.classList.remove("field-error");
    errorEl.textContent = "";
  });
  passwordEl.addEventListener("input", () => {
    passwordMsg.textContent = "";
    passwordEl.classList.remove("field-error");
    errorEl.textContent = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    identifierMsg.textContent = "";
    passwordMsg.textContent = "";
    errorEl.textContent = "";
    identifierEl.classList.remove("field-error");
    passwordEl.classList.remove("field-error");

    const identifier = identifierEl.value.trim();
    const password = passwordEl.value;

    let hasError = false;

    if (!identifier) {
      identifierMsg.textContent = "Please enter your email, Student ID or Employee ID.";
      identifierEl.classList.add("field-error");
      hasError = true;
    }

    if (!password) {
      passwordMsg.textContent = "Please enter your password.";
      passwordEl.classList.add("field-error");
      hasError = true;
    } else if (password.length < 6) {
      passwordMsg.textContent = "Password must be at least 6 characters.";
      passwordEl.classList.add("field-error");
      hasError = true;
    }

    if (hasError) return;

    try {
      const res = await apiFetch(API + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        errorEl.textContent = data.detail || "Invalid email or password";
        return;
      }

      saveToken(data.access_token, data.user);
      window.location.href = "/dashboard.html";
    } catch (e) {
      errorEl.textContent = "Network error. Please try again.";
    }
  });
}

let userFormDepts = [];

function toggleUserRoleFields() {
  const role = document.getElementById("newRole").value;

  document.getElementById("studentFields").style.display = role === "student" ? "flex" : "none";
  document.getElementById("emailField").style.display = role === "student" ? "none" : "block";
}

function onAddUserDeptChange() {
  const dept = document.getElementById("newDepartment").value;
  const progSel = document.getElementById("newProgram");
  const trackSel = document.getElementById("newTrack");
  progSel.innerHTML = `<option value="">-- Select program --</option>`;
  trackSel.innerHTML = `<option value="">-- Select track --</option>`;
  if (!dept) return;
  const d = userFormDepts.find(x => x.name === dept);
  if (d) progSel.innerHTML += d.programs.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
}

function onAddUserProgChange() {
  const progId = parseInt(document.getElementById("newProgram").value);
  const trackSel = document.getElementById("newTrack");
  trackSel.innerHTML = `<option value="">-- Select track --</option>`;
  if (!progId) return;
  apiFetch(API + "/programs", { headers: { "Authorization": "Bearer " + getToken() } })
    .then(res => res.json())
    .then(progs => {
      const p = progs.find(x => x.id === progId);
      if (p && p.tracks) p.tracks.split(",").forEach(t => trackSel.innerHTML += `<option value="${t.trim()}">${t.trim()}</option>`);
    });
}

// 新增：表单校验工具函数
function validateUserField(id) {
  const el = document.getElementById(id);
  const msg = document.getElementById(id + "Msg");
  if (!el || !msg) return true;

  const v = el.value.trim();
  let err = "";

  if (!v) {
    err = "This field is required.";
  }

  msg.textContent = err;
  if (err) { el.classList.add("input-error"); el.style.border = "1px solid #dc2626"; return false; }
  el.classList.remove("input-error"); el.style.border = "1px solid #ccc";
  return true;
}

async function initDashboard() {
  const kpiGrid = document.getElementById("kpiGrid");
  if (!kpiGrid) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const res = await apiFetch(API + "/dashboard/summary", { headers: { "Authorization": "Bearer " + token } });
  if (!res.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const data = await res.json();

  document.getElementById("welcome").textContent = "Welcome, " + data.user.full_name;
  document.getElementById("userInfo").textContent = data.user.email + " · " + data.user.roles.join(", ");

  const renderCard = (label, value, color = "#111827", subtext = "") => `
    <div style="background:#fff; padding:20px; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.06); border-left: 4px solid ${color};">
      <div style="font-size:12px; color:#6b7280; text-transform:uppercase; font-weight:600; margin-bottom:8px;">${label}</div>
      <div style="font-size:28px; font-weight:bold; color:${color};">${value}</div>
      ${subtext ? `<div style="font-size:12px; color:#888; margin-top:4px;">${subtext}</div>` : ""}
    </div>
  `;

  const panel = document.getElementById("rolePanel");

  // 👑 管理员看板
  if (data.role === "admin") {
    const a = data.admin;
    kpiGrid.innerHTML = `
      ${renderCard("Active Conflicts", a.active_conflicts, a.active_conflicts > 0 ? "#dc2626" : "#16a34a", a.active_conflicts > 0 ? "Needs Attention" : "Healthy")}
      ${renderCard("Timetable Score", a.constraint_score + " / 100", "#2563eb")}
      ${renderCard("Room Utilization", a.utilization + "%", "#f59e0b")}
      ${renderCard("Total Courses", a.total_courses)}
      ${renderCard("Total Teachers", a.total_teachers)}
    `;
    panel.innerHTML = `
      <h2>System Status</h2>
      <p style="font-size:16px;">Generation: <b>${a.generation_status}</b></p>
      <p style="font-size:14px; color:#666;">Use the Admin Controls below to manage the scheduling lifecycle.</p>
    `;
    document.getElementById("adminPanel").style.display = "block";
  }

  // 👨‍🏫 老师看板
  else if (data.role === "teacher") {
    const t = data.teacher;
    kpiGrid.innerHTML = `
      ${renderCard("My Weekly Hours", t.weekly_hours, "#2563eb")}
      ${renderCard("Classes Today", t.today_classes, "#16a34a")}
      ${renderCard("Next Class Room", t.next_class.room, "#f59e0b")}
    `;
    const rows = t.weekly_schedule.map(x => `
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:10px;">${x.day}</td><td style="padding:10px;">${x.time}</td>
        <td style="padding:10px;"><b>${x.course}</b></td><td style="padding:10px;">${x.room}</td><td style="padding:10px;">${x.group}</td>
      </tr>
    `).join("");
    panel.innerHTML = `
      <h2>My Weekly Schedule</h2>
      <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:12px;">
        <thead><tr style="background:#f9fafb; text-align:left;"><th style="padding:10px;">Day</th><th style="padding:10px;">Time</th><th style="padding:10px;">Course</th><th style="padding:10px;">Room</th><th style="padding:10px;">Group</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="padding:10px; color:#888;">No classes scheduled.</td></tr>'}</tbody>
      </table>
    `;
  }

  // 👨‍🎓 学生看板
  else {
    const s = data.student;
    kpiGrid.innerHTML = `
      ${renderCard("Classes Today", s.today_classes, "#2563eb")}
      ${renderCard("Next Course", s.next_class.course, "#16a34a", `At ${s.next_class.time}`)}
      ${renderCard("Next Room", s.next_class.room, "#f59e0b")}
    `;
    const rows = s.today_schedule.map(x => `
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:10px;">${x.time}</td><td style="padding:10px;"><b>${x.course}</b></td>
        <td style="padding:10px;">${x.room}</td><td style="padding:10px;">${x.teacher}</td>
      </tr>
    `).join("");
    panel.innerHTML = `
      <h2>My Schedule Today</h2>
      <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:12px;">
        <thead><tr style="background:#f9fafb; text-align:left;"><th style="padding:10px;">Time</th><th style="padding:10px;">Course</th><th style="padding:10px;">Room</th><th style="padding:10px;">Teacher</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" style="padding:10px; color:#888;">No classes today!</td></tr>'}</tbody>
      </table>
    `;
  }

  if (data.role === "admin") {
    const adminPanel = document.getElementById("adminPanel");
    if (adminPanel) adminPanel.style.display = "block";

    try {
      const deptRes = await apiFetch(API + "/student-groups/departments", { headers: { "Authorization": "Bearer " + token } });
      if (deptRes.ok) {
        userFormDepts = await deptRes.json();
        const deptSel = document.getElementById("newDepartment");
        if (deptSel) {
          deptSel.innerHTML = `<option value="">-- Select department --</option>` +
            userFormDepts.map(d => `<option value="${d.name}">${d.name}</option>`).join("");
        }
      }
    } catch(e) { console.error(e); }

    toggleUserRoleFields();

    // 绑定实时校验
    ["newFullName", "newEmail", "newEnrollmentYear", "newDepartment", "newProgram"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, () => {
        validateUserField(id);
        document.getElementById("addUserMsg").textContent = "";
      });
    });

    const form = document.getElementById("addUserForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = document.getElementById("addUserMsg");
        msg.textContent = "";
        msg.style.color = "initial";

        const role = document.getElementById("newRole").value;

        // ★ 核心：手动校验必填项
        let okName = validateUserField("newFullName");
        let okEmail = true, okYear = true, okDept = true, okProg = true;

        if (role === "student") {
          okYear = validateUserField("newEnrollmentYear");
          okDept = validateUserField("newDepartment");
          okProg = validateUserField("newProgram");
        } else {
          okEmail = validateUserField("newEmail");
        }

        if (!okName || !okEmail || !okYear || !okDept || !okProg) {
          msg.style.color = "#dc2626";
          msg.textContent = "Please fix the errors above.";
          return;
        }

        const payload = {
          role: role,
          full_name: document.getElementById("newFullName").value.trim(),
        };

        if (role === "student") {
          payload.enrollment_year = parseInt(document.getElementById("newEnrollmentYear").value);
          payload.program_id = parseInt(document.getElementById("newProgram").value);
          payload.track = document.getElementById("newTrack").value;
        } else {
          payload.email = document.getElementById("newEmail").value.trim();
        }

        const r = await apiFetch(API + "/auth/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body: JSON.stringify(payload),
        });
        const result = await r.json();

        if (!r.ok) {
          msg.style.color = "#dc2626";
          msg.textContent = result.detail || "Failed to create user.";
          return;
        }

        msg.style.color = "#16a34a";
        if (role === "student") {
          // ★ 新增：展示 Group
          msg.innerHTML = `✅ Student created!<br>ID: <b>${result.user.student_id}</b><br>Email: <b>${result.user.email}</b><br>Password: <b>${result.user.default_password}</b><br>Assigned Group: <b>${result.user.group_code}</b>`;
        } else {
          msg.innerHTML = `✅ ${role} created!<br>Email: <b>${result.user.email}</b><br>Password: <b>${result.user.default_password}</b><br>Teacher profile auto-created.`;
        }

        form.reset();
        toggleUserRoleFields();
      });
    }
  }
}


// ---------- Admin: Load User List ----------
async function loadAdminUsers() {
  const box = document.getElementById("adminUsers");
  if (!box) return;

  const res = await apiFetch(API + "/auth/admin/users", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) { box.textContent = "Access denied"; return; }
  const users = await res.json();
  box.innerHTML = users.map(u => `<li>${u.email} — ${u.full_name} (${u.roles.join(", ")})</li>`).join("");
}

// ---------- Placeholder Navigation ----------
function go(page) {
  alert("Navigate to: " + page + " (not implemented yet)");
}

// ---------- Field Highlight ----------
function highlightField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.border = "2px solid #dc2626";
  setTimeout(() => { el.style.border = "1px solid #ccc"; }, 2000);
}

// ============================================================
// Manage Campus Rooms
// ============================================================
let editingRoomId = null;
let isAdmin = false;

function validateRoomField(fieldId) {
  const el = document.getElementById(fieldId);
  const msg = document.getElementById(fieldId + "Msg");
  if (!el || !msg) return true;

  const v = el.value.trim();
  let err = "";

  if (fieldId === "building" && !v) err = "Building is required.";
  if (fieldId === "room_code" && !v) err = "Room code is required.";
  if (fieldId === "capacity") {
    if (!v) err = "Capacity is required.";
    else {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) err = "Capacity must be a positive integer.";
    }
  }
  if (fieldId === "room_type" && !v) err = "Room type is required.";

  msg.textContent = err;
  if (err) { el.classList.add("input-error"); return false; }
  el.classList.remove("input-error");
  return true;
}

async function initRoomsPage() {
  const table = document.getElementById("roomTable");
  if (!table) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  isAdmin = me.roles.includes("admin");

  const typesRes = await apiFetch(API + "/rooms/types");
  const types = await typesRes.json();
  const typeSelect = document.getElementById("room_type");
  if (typeSelect) typeSelect.innerHTML = types.map(t => `<option value="${t}">${t}</option>`).join("");

  const formPanel = document.getElementById("formPanel");
  const accessMsg = document.getElementById("accessMsg");
  const actionCol = document.getElementById("actionCol");

  if (isAdmin) {
    if (formPanel) formPanel.style.display = "block";
    if (accessMsg) accessMsg.textContent = "";
  } else {
    if (formPanel) formPanel.style.display = "none";
    if (actionCol) actionCol.style.display = "none";
    if (accessMsg) accessMsg.textContent = "You have read-only access.";
  }

  const form = document.getElementById("roomForm");
  if (form) {
    ["building", "room_code", "capacity", "room_type"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => { validateRoomField(id); const fm = document.getElementById("formMsg"); if (fm) fm.textContent = ""; });
      el.addEventListener("change", () => validateRoomField(id));
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("formMsg");
      msg.textContent = "";

      const okB = validateRoomField("building");
      const okC = validateRoomField("room_code");
      const okCap = validateRoomField("capacity");
      const okT = validateRoomField("room_type");
      if (!okB || !okC || !okCap || !okT) return;

      const payload = {
        campus: document.getElementById("campus").value.trim() || null,
        building: document.getElementById("building").value.trim(),
        room_code: document.getElementById("room_code").value.trim(),
        capacity: parseInt(document.getElementById("capacity").value.trim(), 10),
        room_type: document.getElementById("room_type").value,
        equipment: document.getElementById("equipment").value.trim() || null,
      };

      const url = editingRoomId ? API + "/rooms/" + editingRoomId : API + "/rooms";
      const method = editingRoomId ? "PUT" : "POST";

      const r = await apiFetch(url, {
        method, headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
        body: JSON.stringify(payload),
      });
      const data = await r.json();

      if (!r.ok) {
        const detail = data.detail || "Failed";
        if (detail.toLowerCase().includes("already exists")) {
          document.getElementById("room_codeMsg").textContent = detail;
          document.getElementById("room_code").classList.add("input-error");
        } else {
          msg.style.color = "#dc2626"; msg.textContent = detail;
        }
        return;
      }

      msg.style.color = "#16a34a";
      msg.textContent = editingRoomId ? "Room updated successfully" : `Room ${data.room_code} added successfully`;

      editingRoomId = null;
      document.getElementById("formSubmitBtn").textContent = "Save Room";
      document.getElementById("formTitle").textContent = "Add Room";
      form.reset();
      ["building", "room_code", "capacity", "room_type"].forEach(id => {
        const m = document.getElementById(id + "Msg"); if (m) m.textContent = "";
        const el = document.getElementById(id); if (el) el.classList.remove("input-error");
      });
      loadRooms();
    });
  }
  loadRooms();
}

async function loadRooms() {
  const tbody = document.getElementById("roomTable");
  if (!tbody) return;

  const res = await apiFetch(API + "/rooms", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { tbody.innerHTML = `<tr><td colspan="7">Failed to load rooms</td></tr>`; return; }
  const rooms = await res.json();

  if (rooms.length === 0) { tbody.innerHTML = `<tr><td colspan="7" style="color:#888;">No rooms yet.</td></tr>`; return; }

  tbody.innerHTML = rooms.map(r => `
    <tr>
      <td>${r.campus || "-"}</td>
      <td>${r.building}</td>
      <td><b>${r.room_code}</b></td>
      <td>${r.capacity}</td>
      <td><span class="badge">${r.room_type}</span></td>
      <td>${r.equipment || "-"}</td>
      ${isAdmin ? `<td><button class="btn-edit" onclick="editRoom(${r.id})">Edit</button><button class="btn-del" onclick="deleteRoom(${r.id})">Delete</button></td>` : `<td></td>`}
    </tr>
  `).join("");
}

async function editRoom(id) {
  const res = await apiFetch(API + "/rooms", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) return;
  const rooms = await res.json();
  const room = rooms.find(r => r.id === id);
  if (!room) return;

  document.getElementById("campus").value = room.campus || "";
  document.getElementById("building").value = room.building;
  document.getElementById("room_code").value = room.room_code;
  document.getElementById("capacity").value = room.capacity;
  document.getElementById("room_type").value = room.room_type;
  document.getElementById("equipment").value = room.equipment || "";

  editingRoomId = id;
  document.getElementById("formTitle").textContent = "Edit Room";
  document.getElementById("formSubmitBtn").textContent = "Update Room";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteRoom(id) {
  const ok = await showConfirm("Delete Room", "Are you sure you want to delete this room? This cannot be undone.");
  if (!ok) return;

  const res = await apiFetch(API + "/rooms/" + id, { method: "DELETE", headers: { "Authorization": "Bearer " + getToken() } });
  const data = await res.json();
  if (!res.ok) { showNotice(data.detail || "Delete failed", "error"); return; }
  showNotice("Room deleted", "success");
  loadRooms();
}

function filterRooms() {
  const el = document.getElementById("roomFilter");
  if (!el) return;
  const q = el.value.toLowerCase();
  document.querySelectorAll("#roomTable tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

// ============================================================
// Manage Faculty Profiles (Merged Tag Input)
// ============================================================
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

// ============================================================
// Manage Course Curriculum
// ============================================================

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

// ============================================================
// Teacher Availability Preference
// ============================================================
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

// ============================================================
// Hard Constraints
// ============================================================
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

async function runDemoValidation() {
  const box = document.getElementById("validateBox");
  box.style.display = "block";
  box.textContent = "Running...";

  const entries = [
    { day: "Mon", time_slot: "08:30-10:00", room_id: 1, room_code: "C102", teacher_id: 1, teacher_name: "Dr. Arman", course_code: "CS201" },
    { day: "Mon", time_slot: "08:30-10:00", room_id: 1, room_code: "C102", teacher_id: 1, teacher_name: "Dr. Arman", course_code: "CS301" },
    { day: "Mon", time_slot: "12:00-13:30", room_id: 2, room_code: "G201", teacher_id: 2, teacher_name: "Prof. Dana", course_code: "MATH101" },
  ];

  const res = await apiFetch(API + "/constraints/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
    body: JSON.stringify({ entries }),
  });
  const data = await res.json();

  if (!res.ok) { box.textContent = "Error: " + (data.detail || "Unknown"); return; }

  if (data.valid) {
    box.innerHTML = `<div class="ok-item">No conflicts detected (${data.checked} entries checked).</div>`;
    return;
  }

  box.innerHTML = data.conflicts.map(c => `<div class="conflict-item"><b>[${c.type}]</b> ${escapeHTML(c.message)}</div>`).join("");
}

// ============================================================
// Soft Constraints
// ============================================================
let softCache = {};
let softIsAdmin = false;

async function initSoftConstraintsPage() {
  const listEl = document.getElementById("softList");
  if (!listEl) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  softIsAdmin = me.roles.includes("admin");

  const accessMsg = document.getElementById("accessMsg");
  if (!softIsAdmin) {
    accessMsg.textContent = "Read-only. Only admins can modify soft constraints.";
    document.querySelectorAll("button.btn").forEach(b => b.style.display = "none");
  }

  await loadSoftConstraints();
}

async function loadSoftConstraints() {
  const listEl = document.getElementById("softList");
  if (!listEl) return;

  const res = await apiFetch(API + "/soft-constraints", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { listEl.innerHTML = "Failed to load soft constraints."; return; }
  const list = await res.json();

  softCache = {};
  list.forEach(c => { softCache[c.constraint_key] = c; });

  listEl.innerHTML = list.map(c => `
    <div class="soft-card ${c.is_enabled ? "" : "disabled"}" id="card-${c.constraint_key}">
      <h3>${c.display_name}</h3>
      <p>${c.description || ""}</p>
      <p><code>${c.constraint_key}</code></p>

      <div class="weight-row">
        <span style="font-size:13px;color:#666;min-width:60px;">Weight</span>
        <input type="range" min="0" max="10" step="1" id="slider-${c.constraint_key}" value="${c.weight}" oninput="onWeightChange('${c.constraint_key}', this.value)" ${softIsAdmin ? "" : "disabled"} />
        <span class="weight-value" id="weight-${c.constraint_key}">${c.weight}</span>
      </div>

      <label class="enable-toggle">
        <input type="checkbox" id="enabled-${c.constraint_key}" ${c.is_enabled ? "checked" : ""} ${softIsAdmin ? "" : "disabled"} /> Enabled
      </label>
    </div>
  `).join("");
}

function onWeightChange(key, value) {
  const label = document.getElementById("weight-" + key);
  if (label) label.textContent = value;
  if (softCache[key]) softCache[key].weight = parseInt(value, 10);
}

async function saveAllWeights() {
  const msg = document.getElementById("msg");
  msg.textContent = "";
  let saved = 0;

  for (const key of Object.keys(softCache)) {
    const slider = document.getElementById("slider-" + key);
    const enabled = document.getElementById("enabled-" + key);
    if (!slider || !enabled) continue;

    const weight = parseInt(slider.value, 10);
    const is_enabled = enabled.checked;

    if (isNaN(weight) || weight < 0 || weight > 10) {
      msg.style.color = "#dc2626";
      msg.textContent = `Invalid weight for ${key}. Must be 0-10.`;
      return;
    }

    const res = await apiFetch(API + "/soft-constraints/" + key, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify({ weight, is_enabled }),
    });

    if (!res.ok) {
      const data = await res.json();
      msg.style.color = "#dc2626";
      msg.textContent = data.detail || "Failed to save";
      return;
    }

    const data = await res.json();
    softCache[key] = data;
    saved++;
  }

  msg.style.color = "#16a34a";
  msg.textContent = `Saved ${saved} soft constraint(s).`;
}

async function resetWeights() {
  if (!confirm("Reset all soft constraints to default weights?")) return;
  const msg = document.getElementById("msg");
  msg.textContent = "";

  const res = await apiFetch(API + "/soft-constraints/reset", { method: "POST", headers: { "Authorization": "Bearer " + getToken() } });
  const data = await res.json();

  if (!res.ok) { msg.style.color = "#dc2626"; msg.textContent = data.detail || "Reset failed"; return; }
  msg.style.color = "#16a34a";
  msg.textContent = "Soft constraints reset to defaults.";
  loadSoftConstraints();
}

async function runScorePreview() {
  const box = document.getElementById("scoreBox");
  box.style.display = "block";
  box.innerHTML = "Running...";

  const entries = [
    { day: "Mon", time_slot: "08:30-10:00", course_code: "MATH101", student_group: "CS-2301" },
    { day: "Mon", time_slot: "12:00-13:30", course_code: "CS201",   student_group: "CS-2301" },
    { day: "Mon", time_slot: "17:00-18:30", course_code: "CS102",   student_group: "CS-2301" },
    { day: "Tue", time_slot: "08:30-10:00", course_code: "PHYS101", student_group: "CS-2302" },
    { day: "Wed", time_slot: "10:15-11:45", course_code: "CS301",   student_group: "CS-2302" },
  ];

  const res = await apiFetch(API + "/soft-constraints/score", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
    body: JSON.stringify({ entries }),
  });
  const data = await res.json();

  if (!res.ok) { box.textContent = "Error: " + (data.detail || "Unknown"); return; }

  const scoreClass = data.total_score >= 70 ? "" : data.total_score >= 40 ? "mid" : "low";

  const breakdownHTML = data.breakdown.length === 0
    ? `<p style="font-size:13px;color:#888;">No active soft constraints.</p>`
    : data.breakdown.map(b => `
        <div class="breakdown-item">
          <span class="name">${escapeHTML(b.display_name)}</span>
          <span class="pill">weight ${b.weight}</span>
          <span class="pill">raw ${b.raw_penalty}</span>
          <span class="penalty">-${b.weighted_penalty}</span>
        </div>
      `).join("");

  box.innerHTML = `
    <div class="score-header">
      <span class="score-number ${scoreClass}">${data.total_score}</span>
      <span class="score-label">/ 100 &nbsp; · &nbsp; ${data.checked_entries} entries evaluated</span>
    </div>
    <div class="score-bar"><div style="width: ${data.total_score}%"></div></div>
    ${breakdownHTML}
  `;
}

// ============================================================
// AI Timetable Generator
// ============================================================

async function initGeneratorPage() {
  const btn = document.getElementById("generateBtn");
  if (!btn) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  const isAdmin = me.roles.includes("admin");

  if (!isAdmin) { btn.disabled = true; btn.textContent = "Admin only"; return; }

  loadExistingEntries();
}

async function loadExistingEntries() {
  const res = await apiFetch(API + "/generator/entries", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) return;
  const entries = await res.json();
  if (entries.length === 0) return;
  renderGeneratorEntries(entries);
  document.getElementById("entriesPanel").style.display = "block";
}

async function runGeneration() {
  const btn = document.getElementById("generateBtn");
  const progressWrap = document.getElementById("progressWrap");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const statusBanner = document.getElementById("statusBanner");

  btn.disabled = true;
  statusBanner.style.display = "none";
  progressWrap.style.display = "block";
  progressFill.style.width = "0%";
  progressText.textContent = "Starting generator...";

  let pct = 0;
  const timer = setInterval(() => {
    pct = Math.min(pct + 5, 90);
    progressFill.style.width = pct + "%";
    progressText.textContent = `Generating... ${pct}%`;
  }, 200);

  try {
    const res = await apiFetch(API + "/generator/generate", { method: "POST", headers: { "Authorization": "Bearer " + getToken() } });
    const data = await res.json();
    clearInterval(timer);

    if (!res.ok) {
      progressFill.style.width = "100%";
      progressFill.style.background = "#dc2626";
      progressText.textContent = "Failed.";
      showStatusBanner("error", data.detail || "Generation failed");
      btn.disabled = false;
      return;
    }

    progressFill.style.width = "100%";
    progressFill.style.background = "#16a34a";
    progressText.textContent = `Done in ${data.elapsed_seconds}s`;

    let msg;
    if (data.status === "success") {
      msg = `Generated all ${data.placed_count} sessions. Review the conflict scan before approval.`;
    } else if (data.status === "failed") {
      msg = `Generation failed: 0/${data.total_sessions} sessions could be placed. Check data.`;
    } else {
      const cov = data.coverage !== undefined ? data.coverage : "?";
      msg = `Generated ${data.placed_count}/${data.total_sessions} sessions (${cov}% coverage). ${data.failed_count} could not be placed.`;
    }
    showStatusBanner(data.status, msg);

    renderGeneratorScore(data);
    renderGeneratorLog(data.log);
    renderGeneratorEntries(data.entries);
    renderGeneratorFailed(data.failed_sessions);
  } catch (e) {
    clearInterval(timer);
    progressFill.style.width = "100%";
    progressFill.style.background = "#dc2626";
    progressText.textContent = "Network error";
    showStatusBanner("error", "Network error");
  }
  btn.disabled = false;
}

function showStatusBanner(type, text) {
  const el = document.getElementById("statusBanner");
  el.className = type;
  el.textContent = text;
  el.style.display = "block";
}

function renderGeneratorScore(data) {
  const panel = document.getElementById("scorePanel");
  const box = document.getElementById("scoreBox");
  panel.style.display = "block";

  const score = data.score;
  const scoreClass = score >= 70 ? "" : score >= 40 ? "mid" : "low";
  const coverage = (data.coverage !== undefined) ? data.coverage : null;
  const placed = data.placed_count;
  const total = data.total_sessions;

  const breakdownHTML = data.score_breakdown.length === 0
    ? `<p style="font-size:13px;color:#888;">No active soft constraints.</p>`
    : data.score_breakdown.map(b => `
        <div class="breakdown-item">
          <span>${escapeHTML(b.display_name)}</span>
          <span class="pill">weight ${b.weight}</span>
          <span class="pill">raw ${b.raw_penalty}</span>
          <span class="penalty">-${b.weighted_penalty}</span>
        </div>
      `).join("");

  const coverageHTML = coverage === null
    ? `<span class="score-label">/ 100 · ${placed} sessions placed</span>`
    : `<span class="score-label">/ 100 · ${placed}/${total} sessions placed (${coverage}% coverage)</span>`;

  box.innerHTML = `
    <div class="score-header">
      <span class="score-number ${scoreClass}">${score}</span>
      ${coverageHTML}
    </div>
    <div class="score-bar"><div style="width: ${score}%"></div></div>
    ${breakdownHTML}
  `;
}

function renderGeneratorLog(lines) {
  const panel = document.getElementById("logPanel");
  const box = document.getElementById("logBox");
  panel.style.display = "block";

  box.innerHTML = lines.map(l => {
    if (l.startsWith("[OK]"))   return `<div class="ok">${escapeHTML(l)}</div>`;
    if (l.startsWith("[FAIL]")) return `<div class="fail">${escapeHTML(l)}</div>`;
    return `<div>${escapeHTML(l)}</div>`;
  }).join("");
}

function generatorGroupLabel(entry) {
  if (entry.group_code) return entry.group_code;
  if (!entry.target_groups) return "—";
  return entry.sub_group ? `${entry.target_groups}-${entry.sub_group}` : entry.target_groups;
}

function renderGeneratorEntries(entries) {
  const panel = document.getElementById("entriesPanel");
  const tbody = document.getElementById("entriesBody");
  panel.style.display = "block";

  tbody.innerHTML = entries.map(e => `
    <tr>
      <td>${e.day}</td>
      <td>${e.time_slot}</td>
      <td><b>${escapeHTML(e.course_code)}</b></td>
      <td><span class="badge">${escapeHTML(e.session_type)}</span></td>
      <td>${escapeHTML(e.room_code)}</td>
      <td>${escapeHTML(e.teacher_name)}</td>
      <td>${escapeHTML(generatorGroupLabel(e))}</td>
    </tr>
  `).join("");
}

function renderGeneratorFailed(failed) {
  const box = document.getElementById("failedBox");
  if (!failed || failed.length === 0) { box.style.display = "none"; return; }
  box.style.display = "block";
  box.innerHTML = `
    <b>${failed.length} session(s) could not be placed:</b>
    <ul style="margin:6px 0 0 20px;">
      ${failed.map(f => `<li>${escapeHTML(f.course_code)} (${escapeHTML(f.session_type)})</li>`).join("")}
    </ul>
  `;
}

// ============================================================
// Real-Time Conflict Detection (Merged Filtering logic)
// ============================================================
let scheduleData = { days: [], time_slots: [], cells: [], conflicts: [] };
let roomsCache = [];
let currentMoveEntry = null;
let scheduleIsAdmin = false;
let draggingEntryId = null;
let pendingSwap = null;
let scheduleGroupsCache = [];
let currentProgramFilter = "all";

function getProgramForGroup(groupCode) {
  if (!groupCode) return null;
  const baseCode = groupCode.split("-")[0] + "-" + groupCode.split("-")[1] + "-" + groupCode.split("-")[2];
  const g = scheduleGroupsCache.find(x => x.group_code === baseCode);
  return g ? g.program : null;
}

async function refreshGrid() {
  const res = await apiFetch(API + "/conflicts/grid", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { console.error("Failed to load grid"); return; }
  scheduleData = await res.json();
  renderScheduleGrid();
  renderConflicts();
  updateBanner();
}

async function rescanConflicts() {
  await refreshGrid();
}

async function initSchedulePage() {
  const summaryEl = document.getElementById("summaryText");
  if (!summaryEl) return;
  const gridTable = document.getElementById("gridTable");
  if (!gridTable) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  scheduleIsAdmin = me.roles.includes("admin");

  const roomsRes = await apiFetch(API + "/rooms", { headers: { "Authorization": "Bearer " + token } });
  if (roomsRes.ok) roomsCache = await roomsRes.json();

  const groupsRes = await apiFetch(API + "/student-groups", { headers: { "Authorization": "Bearer " + token } });
  if (groupsRes.ok) scheduleGroupsCache = await groupsRes.json();

  // ★ 填充专业过滤下拉框
  try {
    const progRes = await apiFetch(API + "/programs", { headers: { "Authorization": "Bearer " + token } });
    if (progRes.ok) {
      const progs = await progRes.json();
      const sel = document.getElementById("programFilter");
      if (sel) {
        let opts = `<option value="all">All Programs</option>`;
        progs.forEach(p => {
          opts += `<option value="${p.program_name}">${p.program_name}</option>`;
        });
        sel.innerHTML = opts;
      }
    }
  } catch (e) { console.error("Failed to load programs", e); }

  const daySel = document.getElementById("moveDay");
  const slotSel = document.getElementById("moveSlot");
  daySel.innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `<option value="${d}">${d}</option>`).join("");

  const slotsRes = await apiFetch(API + "/time-slots/active", { headers: { "Authorization": "Bearer " + token } });
  const slots = slotsRes.ok ? await slotsRes.json() : [];
  slotSel.innerHTML = slots.map(s => `<option value="${s}">${s}</option>`).join("");

  document.getElementById("moveRoom").innerHTML = roomsCache.map(r => `<option value="${r.id}">${r.building} · ${r.room_code} (cap ${r.capacity})</option>`).join("");

  await refreshGrid();
}

function onScheduleFilterChange() {
  const sel = document.getElementById("programFilter");
  if (sel) currentProgramFilter = sel.value;
  renderScheduleGrid();
}

function renderScheduleGrid() {
  const table = document.getElementById("gridTable");
  const { days, time_slots, cells } = scheduleData;

  let html = "<thead><tr><th>Time</th>";
  days.forEach(d => html += `<th>${d}</th>`);
  html += "</tr></thead><tbody>";

  time_slots.forEach(slot => {
    html += `<tr><td class="slot-label">${slot}</td>`;
    days.forEach(day => {
      const cell = cells.find(c => c.day === day && c.time_slot === slot);
      let entries = cell ? cell.entries : [];

      if (currentProgramFilter !== "all") {
        entries = entries.filter(e => {
          const prog = getProgramForGroup(e.target_groups);
          return prog === currentProgramFilter;
        });
      }

      html += `<td data-day="${day}" data-slot="${slot}"
             ondragover="onCellDragOver(event, '${day}', '${slot}')"
             ondragleave="onCellDragLeave(event)"
             ondrop="onCellDrop(event, '${day}', '${slot}')">`;

      if (entries.length === 0) {
        html += `<span style="color:#d1d5db;font-size:11px;">—</span>`;
      } else {
        entries.forEach(e => {
          const cls = e.has_conflict ? "conflict-error" : "";
          html += `
            <div class="entry-card ${cls}"
                 draggable="true"
                 ondragstart="onDragStart(event, ${e.id})"
                 ondragend="onDragEnd(event)"
                 onclick="openMoveModal(${e.id}, ${escapeHTML(JSON.stringify(e.course_code))}, '${day}', '${slot}')"
                 onmouseenter="showEntryTooltip(event, ${e.id})"
                 onmouseleave="hideTooltip()">
              <span class="alert-icon">${e.has_conflict ? "⚠" : ""}</span>
              <div class="course">${escapeHTML(e.course_code)} <span class="type">${escapeHTML(e.session_type)}</span></div>
              <div class="meta">${escapeHTML(e.room_code)} · ${escapeHTML(e.teacher_name || "-")}</div>
              <div class="meta" style="font-size:10px;color:#888;">${escapeHTML(e.target_groups || "")}</div>
            </div>
          `;
        });
      }
      html += `</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody>";
  table.innerHTML = html;

  const errors = scheduleData.error_count || 0;
  const warnings = scheduleData.warning_count || 0;
  const total = scheduleData.total_entries || 0;
  document.getElementById("summaryText").textContent = `${total} sessions · ${errors} error(s) · ${warnings} warning(s)`;
}

function updateBanner() {
  const banner = document.getElementById("alertBanner");
  const errors = scheduleData.error_count || 0;
  const warnings = scheduleData.warning_count || 0;

  if (errors > 0) {
    banner.className = "show error";
    banner.innerHTML = `<span class="count">${errors}</span><span>hard-constraint conflict(s) detected. Click any red session for details.</span>`;
  } else if (warnings > 0) {
    banner.className = "show warning";
    banner.innerHTML = `<span class="count">${warnings}</span><span>warning(s) detected. Review the reported issues before approval.</span>`;
  } else {
    banner.className = "show success";
    banner.innerHTML = `No conflicts detected by the current checks. Review coverage and preferences separately.`;
  }
}

function renderConflicts() {
  const box = document.getElementById("conflictList");
  const conflicts = scheduleData.conflicts || [];

  if (conflicts.length === 0) {
    box.innerHTML = `<p style="font-size:13px;color:#888;">No conflicts detected.</p>`;
    return;
  }

  box.innerHTML = conflicts.map(c => `
    <div class="conflict-item ${c.severity}">
      <b>${escapeHTML(c.message)}</b>
      ${
        c.details.courses
          ? `Courses involved: ${escapeHTML(c.details.courses.join(", "))}`
          : c.details.course
          ? `Course: ${escapeHTML(c.details.course)}`
          : ""
      }
      ${c.details.excess ? ` · Over capacity by ${c.details.excess} students` : ""}
    </div>
  `).join("");
}

function showEntryTooltip(evt, entryId) {
  const tt = document.getElementById("tooltip");
  const cell = scheduleData.cells.find(c => c.entries.some(e => e.id === entryId));
  if (!cell) return;
  const entry = cell.entries.find(e => e.id === entryId);
  const conflicts = (scheduleData.conflicts || []).filter(c => c.entry_ids.includes(entryId));

  let html = `
    <div class="tt-title">${escapeHTML(entry.course_code)} · ${escapeHTML(entry.session_type)}</div>
    <div class="tt-row"><span class="tt-label">Room</span>${escapeHTML(entry.room_code)}</div>
    <div class="tt-row"><span class="tt-label">Teacher</span>${escapeHTML(entry.teacher_name || "-")}</div>
    <div class="tt-row"><span class="tt-label">Groups</span>${escapeHTML(entry.target_groups || "-")}</div>
  `;

  if (conflicts.length > 0) {
    html += `<div class="tt-row" style="margin-top:8px;border-top:1px solid #374151;padding-top:6px;">`;
    conflicts.forEach(c => { html += `<div style="color:#fca5a5;">⚠ ${escapeHTML(c.message)}</div>`; });
    html += `</div>`;
  }

  tt.innerHTML = html;
  tt.style.display = "block";
  moveTooltip(evt);
}

function moveTooltip(evt) {
  const tt = document.getElementById("tooltip");
  const padding = 14;
  let x = evt.clientX + padding;
  let y = evt.clientY + padding;
  const rect = tt.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - 8) { x = evt.clientX - rect.width - padding; }
  if (y + rect.height > window.innerHeight - 8) { y = evt.clientY - rect.height - padding; }
  tt.style.left = x + "px";
  tt.style.top = y + "px";
}

function hideTooltip() { document.getElementById("tooltip").style.display = "none"; }

function openMoveModal(entryId, courseCode, day, slot) {
  if (!scheduleIsAdmin) return;
  currentMoveEntry = entryId;
  document.getElementById("moveEntryLabel").textContent = `${courseCode} (entry #${entryId})`;
  document.getElementById("moveDay").value = day;
  document.getElementById("moveSlot").value = slot;
  document.getElementById("moveModal").classList.add("open");
}

function closeMoveModal() {
  currentMoveEntry = null;
  document.getElementById("moveModal").classList.remove("open");
}

async function submitMove() {
  if (!currentMoveEntry) return;
  const day = document.getElementById("moveDay").value;
  const time_slot = document.getElementById("moveSlot").value;
  const room_id = parseInt(document.getElementById("moveRoom").value, 10);
  const res = await apiFetch(API + "/conflicts/entries/" + currentMoveEntry, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
    body: JSON.stringify({ day, time_slot, room_id }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.detail || "Move failed"); return; }
  closeMoveModal();
  await refreshGrid();
}

// ============================================================
// Interactive Drag-and-Drop Grid
// ============================================================
function onDragStart(evt, entryId) {
  if (!scheduleIsAdmin) { evt.preventDefault(); return; }
  draggingEntryId = entryId;
  evt.dataTransfer.effectAllowed = "move";
  evt.dataTransfer.setData("text/plain", String(entryId));
  evt.currentTarget.classList.add("dragging");
}

function onDragEnd(evt) {
  evt.currentTarget.classList.remove("dragging");
  document.querySelectorAll("td.drop-target, td.drop-target-occupied, td.drop-invalid")
    .forEach(td => td.classList.remove("drop-target", "drop-target-occupied", "drop-invalid"));
  draggingEntryId = null;
}

function onCellDragOver(evt, day, slot) {
  if (!draggingEntryId) return;
  evt.preventDefault();
  const td = evt.currentTarget;
  document.querySelectorAll("td.drop-target, td.drop-target-occupied, td.drop-invalid").forEach(el => el.classList.remove("drop-target", "drop-target-occupied", "drop-invalid"));

  const cell = scheduleData.cells.find(c => c.day === day && c.time_slot === slot);
  const entries = (cell && cell.entries) || [];

  let draggedEntry = null;
  for (const c of scheduleData.cells) {
    const found = c.entries.find(e => e.id === draggingEntryId);
    if (found) { draggedEntry = found; break; }
  }

  const hasSameGroup = draggedEntry && entries.some(e => e.target_groups === draggedEntry.target_groups);
  if (hasSameGroup) {
    td.classList.add("drop-target-occupied");
  } else {
    td.classList.add("drop-target");
  }
  evt.dataTransfer.dropEffect = "move";
}

function onCellDragLeave(evt) {
  evt.currentTarget.classList.remove("drop-target", "drop-target-occupied", "drop-invalid");
}

async function onCellDrop(evt, day, slot) {
  evt.preventDefault();
  const draggedId = draggingEntryId;
  if (!draggedId) return;

  const td = evt.currentTarget;
  td.classList.remove("drop-target", "drop-target-occupied", "drop-invalid");

  let draggedEntry = null;
  for (const c of scheduleData.cells) {
    const found = c.entries.find(e => e.id === draggedId);
    if (found) { draggedEntry = found; break; }
  }
  if (!draggedEntry) return;

  const cell = scheduleData.cells.find(c => c.day === day && c.time_slot === slot);
  const entries = (cell && cell.entries) || [];

  if (entries.some(e => e.id === draggedId)) return;

  const hasSameGroup = entries.some(e => e.target_groups === draggedEntry.target_groups);

  if (!hasSameGroup) {
    await moveEntryToSlot(draggedId, day, slot);
  } else {
    const targetEntry = entries.find(e => e.target_groups === draggedEntry.target_groups);
    openSwapModal(draggedId, targetEntry.id, targetEntry.course_code, day, slot);
  }
}

async function moveEntryToSlot(entryId, day, time_slot) {
  try {
    const res = await apiFetch(API + "/conflicts/entries/" + entryId, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify({ day, time_slot }),
    });
    if (!res.ok) throw new Error("Move failed");
    await refreshGrid();
  } catch (err) {
    alert("Failed to save change. The card has been reverted.");
    await refreshGrid();
  }
}

function openSwapModal(draggedId, targetId, targetCourse, targetDay, targetSlot) {
  pendingSwap = { draggedId, targetId };
  const draggedCell = scheduleData.cells.find(c => c.entries.some(e => e.id === draggedId));
  const draggedEntry = draggedCell.entries.find(e => e.id === draggedId);

  document.getElementById("swapLineA").innerHTML = `<b>${escapeHTML(draggedEntry.course_code)}</b> — ${draggedCell.day} ${draggedCell.time_slot} · Room ${escapeHTML(draggedEntry.room_code)}`;
  document.getElementById("swapLineB").innerHTML = `<b>${escapeHTML(targetCourse)}</b> — ${targetDay} ${targetSlot} · Room ${escapeHTML(scheduleData.cells.find(c => c.entries.some(e => e.id === targetId)).entries.find(e => e.id === targetId).room_code)}`;

  document.getElementById("swapModal").classList.add("open");
}

function closeSwapModal() {
  pendingSwap = null;
  document.getElementById("swapModal").classList.remove("open");
}

async function confirmSwap() {
  if (!pendingSwap) return;
  try {
    const res = await apiFetch(API + "/conflicts/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify({ entry_id_a: pendingSwap.draggedId, entry_id_b: pendingSwap.targetId }),
    });
    if (!res.ok) throw new Error("Swap failed");
    closeSwapModal();
    await refreshGrid();
  } catch (err) {
    alert("Swap failed. The cards have been reverted.");
    closeSwapModal();
    await refreshGrid();
  }
}

// ============================================================
// Smart Room Auto-Fitting
// ============================================================
async function initRoomFittingPage() {
  const form = document.getElementById("fitForm");
  if (!form) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const groupsRes = await apiFetch(API + "/student-groups", { headers: { "Authorization": "Bearer " + token } });
  if (groupsRes.ok) {
    const groups = await groupsRes.json();
    const box = document.getElementById("groupsBox");
    groups.forEach(g => {
      const lbl = document.createElement("label");
      lbl.innerHTML = `<input type="checkbox" class="fit-group-check" value="${g.group_code}" />${g.group_code} <span style="color:#888;">(${g.student_count})</span>`;
      box.appendChild(lbl);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const session_type = document.getElementById("sessionType").value;
    const course_code = document.getElementById("courseCode").value.trim() || null;
    const target_groups = Array.from(document.querySelectorAll(".fit-group-check:checked")).map(cb => cb.value);

    if (target_groups.length === 0) { alert("Select at least one student group."); return; }

    const res = await apiFetch(API + "/room-fitting/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify({ session_type, target_groups, course_code }),
    });
    const data = await res.json();

    if (!res.ok) { alert(data.detail || "Failed"); return; }

    renderFitResults(data);
  });
}

function renderFitResults(data) {
  const panel = document.getElementById("resultPanel");
  const summary = document.getElementById("summary");
  const tbody = document.getElementById("resultBody");

  panel.style.display = "block";
  summary.innerHTML = `
    Session type: <b>${data.session_type}</b> ·
    Target groups: <b>${data.target_groups.join(", ")}</b> ·
    Total students: <b>${data.required_seats}</b>
    <br/>Required room types: <b>${data.required_room_types.join(" / ") || "any"}</b> ·
    Required equipment: <b>${data.required_equipment.join(", ") || "none"}</b>
  `;

  const bestId = data.candidates.length ? data.candidates[0].room_id : null;

  tbody.innerHTML = data.candidates.map(c => {
    const checks = [];
    if (c.capacity_ok) checks.push(`<span class="badge ok">capacity OK</span>`);
    else checks.push(`<span class="badge fail">overflow +${data.required_seats - c.capacity}</span>`);

    if (c.type_ok) checks.push(`<span class="badge ok">type OK</span>`);
    else checks.push(`<span class="badge fail">type mismatch</span>`);

    if (c.gear_ok) checks.push(`<span class="badge ok">gear OK</span>`);
    else checks.push(`<span class="badge fail">missing: ${c.missing_gear.join(", ")}</span>`);

    const rowClass = c.room_id === bestId ? "best" : (c.score < 0 ? "fail" : "");
    const scoreClass = c.score < 0 ? "negative" : "";

    return `
      <tr class="${rowClass}">
        <td><b>${c.room_code}</b></td>
        <td>${c.building}</td>
        <td><span class="badge info">${c.room_type}</span></td>
        <td>${c.capacity} ${c.excess_seats > 0 ? `<span style="color:#888;">(+${c.excess_seats})</span>` : ""}</td>
        <td>${c.equipment || "-"}</td>
        <td>${checks.join(" ")}</td>
        <td class="score-cell ${scoreClass}">${c.score}</td>
      </tr>
    `;
  }).join("");
}

// ============================================================
// Manage Academic Semesters
// ============================================================
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

// ============================================================
// Manage Student Groups
// ============================================================
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

// ============================================================
// Manage Time Slots
// ============================================================
let editingSlotId = null;
let slotIsAdmin = false;

function validateSlotField(fieldId) {
  const inputEl = document.getElementById(fieldId);
  const msgEl = document.getElementById(fieldId + "Msg");
  if (!inputEl || !msgEl) return true;

  const value = inputEl.value.trim();
  let errorMsg = "";

  if (fieldId === "slot_label") {
    if (!value) errorMsg = "Slot label is required.";
    else if (!/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(value)) errorMsg = "Format must be HH:MM-HH:MM (e.g., 08:30-09:20).";
  } else if (fieldId === "sort_order") {
    if (!value) errorMsg = "Sort order is required.";
    else {
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 1 || n > 10) errorMsg = "Sort order must be between 1 and 10.";
    }
  }

  msgEl.textContent = errorMsg;
  if (errorMsg) { inputEl.classList.add("input-error"); return false; }
  inputEl.classList.remove("input-error");
  return true;
}

async function initTimeSlotsPage() {
  const table = document.getElementById("slotTable");
  if (!table) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  slotIsAdmin = me.roles.includes("admin");

  const formPanel = document.getElementById("formPanel");
  const accessMsg = document.getElementById("accessMsg");
  const actionCol = document.getElementById("actionCol");

  if (slotIsAdmin) {
    formPanel.style.display = "block";
    accessMsg.textContent = "";
  } else {
    formPanel.style.display = "none";
    actionCol.style.display = "none";
    accessMsg.textContent = "Read-only. Only admins can modify time slots.";
  }

  const form = document.getElementById("slotForm");
  ["slot_label", "sort_order"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      validateSlotField(id);
      const fm = document.getElementById("formMsg");
      if (fm) fm.textContent = "";
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("formMsg");
    msg.textContent = "";

    const okLabel = validateSlotField("slot_label");
    const okSort = validateSlotField("sort_order");
    if (!okLabel || !okSort) return;

    const payload = {
      slot_label: document.getElementById("slot_label").value.trim(),
      sort_order: parseInt(document.getElementById("sort_order").value.trim(), 10),
      is_active: document.getElementById("is_active").value === "true",
    };

    const url = editingSlotId ? API + "/time-slots/" + editingSlotId : API + "/time-slots";
    const method = editingSlotId ? "PUT" : "POST";

    const r = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify(payload),
    });
    const data = await r.json();

    if (!r.ok) {
      const detail = data.detail || "Failed";
      if (detail.toLowerCase().includes("sort order")) {
        document.getElementById("sort_orderMsg").textContent = detail;
        document.getElementById("sort_order").classList.add("input-error");
      } else if (detail.toLowerCase().includes("time slot") || detail.toLowerCase().includes("format") || detail.toLowerCase().includes("minute")) {
        document.getElementById("slot_labelMsg").textContent = detail;
        document.getElementById("slot_label").classList.add("input-error");
      } else {
        msg.style.color = "#dc2626";
        msg.textContent = detail;
      }
      return;
    }

    msg.style.color = "#16a34a";
    msg.textContent = editingSlotId ? "Time slot updated" : "Time slot created";

    editingSlotId = null;
    document.getElementById("formSubmitBtn").textContent = "Save Slot";
    document.getElementById("formTitle").textContent = "Add Time Slot";
    form.reset();

    ["slot_label", "sort_order"].forEach((id) => {
      const msgEl = document.getElementById(id + "Msg");
      if (msgEl) msgEl.textContent = "";
      const inputEl = document.getElementById(id);
      if (inputEl) inputEl.classList.remove("input-error");
    });

    loadTimeSlots();
  });

  loadTimeSlots();
}

async function loadTimeSlots() {
  const tbody = document.getElementById("slotTable");
  if (!tbody) return;

  const res = await apiFetch(API + "/time-slots", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { tbody.innerHTML = `<tr><td colspan="4">Failed to load time slots</td></tr>`; return; }
  const slots = await res.json();

  document.getElementById("countLabel").textContent = `${slots.length} slot(s)`;

  if (slots.length === 0) { tbody.innerHTML = `<tr><td colspan="4" style="color:#888;">No time slots yet.</td></tr>`; return; }

  tbody.innerHTML = slots.map(s => `
    <tr data-slot-id="${s.id}">
      <td><b>${escapeHTML(s.slot_label)}</b></td>
      <td>${s.sort_order}</td>
      <td><span class="badge ${s.is_active ? "badge-active" : "badge-inactive"}">${s.is_active ? "Active" : "Inactive"}</span></td>
      ${slotIsAdmin ? `<td><button class="btn-edit" onclick="editSlot(${s.id})">Edit</button><button class="btn-del" onclick="deleteSlot(${s.id})">Delete</button></td>` : `<td></td>`}
    </tr>
  `).join("");
}

async function editSlot(id) {
  const res = await apiFetch(API + "/time-slots", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) return;
  const list = await res.json();
  const s = list.find(x => x.id === id);
  if (!s) return;

  document.getElementById("slot_label").value = s.slot_label;
  document.getElementById("sort_order").value = s.sort_order;
  document.getElementById("is_active").value = s.is_active ? "true" : "false";

  editingSlotId = id;
  document.getElementById("formTitle").textContent = "Edit Time Slot";
  document.getElementById("formSubmitBtn").textContent = "Update Slot";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteSlot(id) {
  const ok = await showConfirm("Delete Time Slot", "Are you sure you want to delete this time slot? This cannot be undone.");
  if (!ok) return;

  const res = await apiFetch(API + "/time-slots/" + id, { method: "DELETE", headers: { "Authorization": "Bearer " + getToken() } });
  const data = await res.json();
  if (!res.ok) { showNotice(data.detail || "Delete failed", "error"); return; }
  showNotice("Time slot deleted", "success");
  loadTimeSlots();
}

async function checkTimeSlotConsistency() {
  const resultEl = document.getElementById("checkResult");
  const listEl = document.getElementById("issueList");

  resultEl.textContent = "Checking...";
  resultEl.style.color = "#666";
  resultEl.style.fontWeight = "normal";
  listEl.style.display = "none";
  listEl.innerHTML = "";

  document.querySelectorAll("#slotTable tr").forEach(tr => {
    tr.classList.remove("row-error");
  });

  const res = await apiFetch(API + "/time-slots/validate", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { resultEl.style.color = "#dc2626"; resultEl.textContent = "Failed to validate"; return; }
  const data = await res.json();

  data.bad_slot_ids.forEach(id => {
    const row = document.querySelector(`#slotTable tr[data-slot-id="${id}"]`);
    if (row) row.classList.add("row-error");
  });

  if (data.is_valid) {
    resultEl.style.color = "#16a34a";
    resultEl.style.fontWeight = "600";
    resultEl.textContent = `✓ Consistent`;
    listEl.style.display = "block";
    listEl.innerHTML = `
      <div class="issue-card ok">
        <div class="icon">✓</div>
        <div class="body">
          <span class="type-tag">ok</span>
          <span class="msg">All ${data.total_active_slots} active time slots are consistent.</span>
        </div>
      </div>
    `;
    return;
  }

  resultEl.style.color = "#dc2626";
  resultEl.style.fontWeight = "600";
  resultEl.textContent = `✗ ${data.issues.length} issue${data.issues.length > 1 ? "s" : ""} found`;

  listEl.style.display = "block";
  listEl.innerHTML = data.issues.map(i => {
    const iconMap = { overlap: "⛔", duplicate_sort: "🔁", order_mismatch: "↕", invalid_format: "⚠" };
    const icon = iconMap[i.type] || "⚠";
    return `
      <div class="issue-card">
        <div class="icon">${icon}</div>
        <div class="body">
          <span class="type-tag">${i.type.replace("_", " ")}</span>
          <span class="msg">${escapeHTML(i.message)}</span>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================================
// Global UI helpers
// ============================================================
let confirmResolver = null;

function showConfirm(title, text, confirmLabel = "Delete") {
  return new Promise((resolve) => {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmText").textContent = text;
    document.getElementById("confirmBtn").textContent = confirmLabel;
    document.getElementById("confirmModal").style.display = "flex";
    confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  document.getElementById("confirmModal").style.display = "none";
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

function showNotice(message, type = "info") {
  const el = document.getElementById("pageNotice");
  if (!el) return;

  const colors = {
    info:    { bg: "#dbeafe", color: "#1e40af" },
    success: { bg: "#dcfce7", color: "#166534" },
    error:   { bg: "#fee2e2", color: "#991b1b" },
  };
  const c = colors[type] || colors.info;

  el.textContent = message;
  el.style.background = c.bg;
  el.style.color = c.color;
  el.style.display = "block";

  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.style.display = "none";
  }, 3000);
}

// ============================================================
// Manage Programs
// ============================================================
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

// ============================================================
// Prepare Scheduling Data (US-12)
// ============================================================

async function initValidationPage() {
  const btn = document.querySelector(".btn-check");
  if (!btn) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }
}

async function runValidation() {
  const summaryBox = document.getElementById("summaryBox");
  const summaryGrid = document.getElementById("summaryGrid");
  const banner = document.getElementById("resultBanner");
  const list = document.getElementById("issueList");

  banner.className = "banner";
  banner.textContent = "Running validation...";
  banner.classList.add("show", "ok");

  list.innerHTML = "";
  summaryBox.style.display = "none";

  const res = await apiFetch(API + "/validation/report", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();

  if (!res.ok) {
    banner.className = "banner show fail";
    banner.innerHTML = `<span>Failed to run validation.</span>`;
    return;
  }

  // Summary cards
  const s = data.summary;
  summaryGrid.innerHTML = `
    <div class="summary-card">
      <div class="label">Active Semester</div>
      <div class="value" style="font-size:14px;">${escapeHTML(s.active_semester || "None")}</div>
    </div>
    <div class="summary-card">
      <div class="label">Courses</div>
      <div class="value">${s.courses}</div>
    </div>
    <div class="summary-card">
      <div class="label">Teachers</div>
      <div class="value">${s.teachers}</div>
    </div>
    <div class="summary-card">
      <div class="label">Rooms</div>
      <div class="value">${s.rooms}</div>
    </div>
    <div class="summary-card">
      <div class="label">Student Groups</div>
      <div class="value">${s.student_groups}</div>
    </div>
    <div class="summary-card">
      <div class="label">Active Slots</div>
      <div class="value">${s.active_slots}</div>
    </div>
  `;
  summaryBox.style.display = "block";

  // Banner
  if (data.ok) {
    banner.className = "banner show ok";
    banner.textContent = data.warning_count ? `No blocking errors. Review ${data.warning_count} warning(s) before generating.` : "✓ All checks passed. Ready to generate.";
  } else {
    banner.className = "banner show fail";
    banner.innerHTML = `
      <span class="count">${data.error_count}</span>
      <span>error(s) found. Fix them before generating the timetable.</span>
    `;
  }

  // Issue list
  if (data.issues.length === 0) {
    list.innerHTML = `<p style="font-size:13px;color:#888;">No issues detected.</p>`;
    return;
  }

  list.innerHTML = data.issues.map(i => {
    const icon = i.severity === "error" ? "⛔" : "⚠";
    return `
      <div class="issue-item ${i.severity}">
        <div class="icon">${icon}</div>
        <div class="body">
          <span class="type">${escapeHTML(i.category)}</span>
          <span>${escapeHTML(i.message)}</span>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================================
// Shared Sidebar
// ============================================================

const SIDEBAR_ITEMS = [
  // ---- Sprint 1: Base Configuration ----
  { href: "/dashboard.html",        label: "Dashboard",             roles: ["admin", "teacher", "student"], sprint: 1 },
  { href: "/rooms.html",            label: "Manage Rooms",          roles: ["admin"],                       sprint: 1 },
  { href: "/teachers.html",         label: "Manage Faculty",        roles: ["admin"],                       sprint: 1 },
  { href: "/courses.html",          label: "Manage Curriculum",     roles: ["admin"],                       sprint: 1 },
  { href: "/availability.html",     label: "My Availability",       roles: ["admin", "teacher"],            sprint: 1 },

  // ---- Sprint 2: Academic Structure & Constraints ----
  { href: "/programs.html",         label: "Manage Programs",       roles: ["admin"],                       sprint: 2 },
  { href: "/semesters.html",        label: "Manage Semesters",      roles: ["admin"],                       sprint: 2 },
  { href: "/student-groups.html",   label: "Manage Student Groups", roles: ["admin"],                       sprint: 2 },
  { href: "/time-slots.html",       label: "Manage Time Slots",     roles: ["admin"],                       sprint: 2 },
  { href: "/constraints.html",      label: "Hard Constraints",      roles: ["admin"],                       sprint: 2 },
  { href: "/soft-constraints.html", label: "Soft Constraints",      roles: ["admin"],                       sprint: 2 },

  // ---- Sprint 3: Scheduling Engine (US-12 ~ US-16) ----
  { href: "/validation.html",       label: "Prepare Data",          roles: ["admin"],                       sprint: 3 },
  { href: "/generator.html",        label: "AI Generator",          roles: ["admin"],                       sprint: 3 },
  { href: "/schedule.html",         label: "Schedule Grid",         roles: ["admin"],                       sprint: 3 },

  // ---- Sprint 4: Interactive Grid & Review (US-17 ~ US-20) ----
  { href: "/personal-timetable.html", label: "My Timetable",        roles: ["teacher", "student"],          sprint: 4 },
  { href: "/room-fitting.html",     label: "Smart Room Fitting",    roles: ["admin"],                       sprint: 4 },

  // ---- Sprint 5: Analytics & System Management (US-27 ~ US-31) ----
  { href: "/analytics.html",        label: "Analytics & Reports",   roles: ["admin"],                       sprint: 5 },
  { href: "/audit-log.html",        label: "Audit Log",             roles: ["admin"],                       sprint: 5 },
];

const CURRENT_SPRINT = 3;
const SIDEBAR_ACTIONS = [];

const SIDEBAR_CSS = `
  .app-layout { display: flex; min-height: 100vh; }
  .sidebar {
    width: 220px; background: #1f2937; color: #fff;
    padding: 20px 0; flex-shrink: 0;
    position: sticky; top: 0; height: 100vh; overflow-y: auto;
  }
  .sidebar .brand {
    padding: 0 20px 20px; font-size: 16px; font-weight: bold;
    border-bottom: 1px solid #374151; margin-bottom: 12px;
  }
  .sidebar h3 {
    font-size: 11px; text-transform: uppercase; color: #9ca3af;
    padding: 12px 20px 6px; margin: 0; letter-spacing: 0.5px;
  }
  .sidebar button {
    display: block; width: 100%; text-align: left;
    padding: 10px 20px; background: transparent; color: #e5e7eb;
    border: none; font-size: 14px; cursor: pointer;
    transition: background 0.15s;
  }
  .sidebar button:hover { background: #374151; }
  .sidebar button.active { background: #2563eb; color: #fff; }
  .main-content { flex: 1; padding: 24px; max-width: 1100px; }

  @media (max-width: 768px) {
    .app-layout { flex-direction: column; }
    .sidebar {
      width: 100%; height: auto; position: static; padding: 12px 0;
    }
    .sidebar .brand { padding: 0 16px 12px; }
    .sidebar h3 { padding: 8px 16px 4px; }
    .sidebar button { padding: 8px 16px; }
    .main-content { padding: 12px; }
  }
`;

function renderSidebar() {
  const mount = document.getElementById("sidebar-mount");
  if (!mount) return;

  if (!document.getElementById("sidebar-style")) {
    const style = document.createElement("style");
    style.id = "sidebar-style";
    style.textContent = SIDEBAR_CSS;
    document.head.appendChild(style);
  }

  const user = getUser();
  const userRoles = (user && user.roles) ? user.roles : [];

  const hasRole = (item) => {
    if (!item.roles) return true;
    return item.roles.some(r => userRoles.includes(r));
  };

  const visibleItems = SIDEBAR_ITEMS.filter(item =>
    hasRole(item) && (item.sprint || 1) <= CURRENT_SPRINT
  );

  const current = window.location.pathname;

  const navHTML = visibleItems.map(item => {
    const isActive = current === item.href;
    return `<button class="${isActive ? "active" : ""}"
             onclick="window.location.href='${item.href}'">${item.label}</button>`;
  }).join("");

  mount.outerHTML = `
    <aside class="sidebar">
      <div class="brand">Timetable System</div>
      <h3>Navigation</h3>
      ${navHTML}
    </aside>
  `;
}

// ---------- Page Initialization ----------
document.addEventListener("DOMContentLoaded", () => {
  renderSidebar();
  initLoginPage();
  initDashboard();
  initRoomsPage();
  initTeachersPage();
  initCoursesPage();
  initStudentGroupsPage();
  initAvailabilityPage();
  initConstraintsPage();
  initSoftConstraintsPage();
  initGeneratorPage();
  initSchedulePage();
  initRoomFittingPage();
  initSemestersPage();
  initTimeSlotsPage();
  initProgramsPage();
  initValidationPage();
});