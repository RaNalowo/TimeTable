const API = "";  // Same origin as backend

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
  return u ? JSON.parse(u) : null;
}

// ---------- Logout ----------
function logout() {
  fetch(API + "/auth/logout", {
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

  // Clear per-field messages on input
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

    // Reset messages
    identifierMsg.textContent = "";
    passwordMsg.textContent = "";
    errorEl.textContent = "";
    identifierEl.classList.remove("field-error");
    passwordEl.classList.remove("field-error");

    const identifier = identifierEl.value.trim();
    const password = passwordEl.value;

    // ---------- Custom validation ----------
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

    if (hasError) return;   // stop before sending request

    // ---------- Send login request ----------
    try {
      const res = await fetch(API + "/auth/login", {
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

// ---------- Dashboard ----------
async function initDashboard() {
  const cardsEl = document.getElementById("cards");
  if (!cardsEl) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const res = await fetch(API + "/dashboard/summary", {
    headers: { "Authorization": "Bearer " + token },
  });

  if (!res.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }

  const data = await res.json();

  document.getElementById("welcome").textContent = "Welcome, " + data.user.full_name;
  document.getElementById("userInfo").textContent =
    data.user.email + " · " + data.user.roles.join(", ");

  const c = data.cards;
  cardsEl.innerHTML = `
    <div class="card"><div class="label">Today's Classes</div><div class="value">${c.today_classes}</div></div>
    <div class="card"><div class="label">Next Room</div><div class="value">${c.next_room}</div></div>
    <div class="card"><div class="label">Pending Requests</div><div class="value">${c.pending_requests}</div></div>
    <div class="card"><div class="label">Timetable Status</div><div class="value"><span class="badge">${c.timetable_status}</span></div></div>
  `;

  const panel = document.getElementById("rolePanel");

  if (data.role === "student") {
    const rows = data.student.today_schedule.map(x => `
      <tr><td>${x.time}</td><td>${x.course}</td><td>${x.room}</td><td>${x.teacher}</td></tr>
    `).join("");
    const next = data.student.next_lecture;
    panel.innerHTML = `
      <h2>Student Schedule</h2>
      <p>Next lecture: <b>${next.course}</b> at <b>${next.time}</b> in <b>${next.room}</b></p>
      <table>
        <thead><tr><th>Time</th><th>Course</th><th>Room</th><th>Teacher</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } else if (data.role === "teacher") {
    const rows = data.teacher.weekly_schedule.map(x => `
      <tr><td>${x.day}</td><td>${x.time}</td><td>${x.course}</td><td>${x.room}</td><td>${x.group}</td></tr>
    `).join("");
    panel.innerHTML = `
      <h2>Teacher Workload</h2>
      <p>Weekly hours: <b>${data.teacher.weekly_hours}</b> ·
         Rooms: <b>${data.teacher.rooms.join(", ")}</b> ·
         Groups: <b>${data.teacher.groups.join(", ")}</b></p>
      <table>
        <thead><tr><th>Day</th><th>Time</th><th>Course</th><th>Room</th><th>Group</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } else {
    panel.innerHTML = `
      <h2>Admin Scheduling Control</h2>
      <p>Generation status: <b>${data.admin.generation_status}</b></p>
      <p>Constraint score: <b>${data.admin.constraint_score}</b> / 100</p>
      <p>Active conflicts: <b>${data.admin.active_conflicts}</b></p>
      <p>Room utilization: <b>${data.admin.utilization}%</b></p>
    `;
  }

  if (data.role === "admin") {
    const adminPanel = document.getElementById("adminPanel");
    adminPanel.style.display = "block";

    const form = document.getElementById("addUserForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("addUserMsg");
      msg.textContent = "";

      const payload = {
        email: document.getElementById("newEmail").value.trim(),
        full_name: document.getElementById("newFullName").value.trim(),
        password: document.getElementById("newPassword").value,
        role: document.getElementById("newRole").value,
        student_id: document.getElementById("newStudentId").value.trim() || null,
        employee_id: document.getElementById("newEmployeeId").value.trim() || null,
      };

      const r = await fetch(API + "/auth/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + getToken(),
        },
        body: JSON.stringify(payload),
      });
      const result = await r.json();

      if (!r.ok) {
        msg.style.color = "#dc2626";
        msg.textContent = result.detail || "Failed";
        return;
      }

      msg.style.color = "#16a34a";
      msg.textContent = "User created: " + result.user.email;
      form.reset();
    });
  }
}

// ---------- Admin: Load User List ----------
async function loadAdminUsers() {
  const box = document.getElementById("adminUsers");
  if (!box) return;

  const res = await fetch(API + "/auth/admin/users", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    box.textContent = "Access denied";
    return;
  }
  const users = await res.json();
  box.innerHTML = users.map(u =>
    `<li>${u.email} — ${u.full_name} (${u.roles.join(", ")})</li>`
  ).join("");
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

// ---------- Room field validators ----------
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


// ---------- Teacher field validators ----------
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


// ---------- Course field validators ----------
function validateCourseField(fieldId) {
  const el = document.getElementById(fieldId);
  const msg = document.getElementById(fieldId + "Msg");
  if (!el || !msg) return true;

  const v = el.value.trim();
  let err = "";

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

async function initRoomsPage() {
  const table = document.getElementById("roomTable");
  if (!table) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
  const me = await meRes.json();
  isAdmin = me.roles.includes("admin");

  const typesRes = await fetch(API + "/rooms/types");
  const types = await typesRes.json();
  const typeSelect = document.getElementById("room_type");
  if (typeSelect) {
    typeSelect.innerHTML = types.map(t => `<option value="${t}">${t}</option>`).join("");
  }

  const formPanel = document.getElementById("formPanel");
  const accessMsg = document.getElementById("accessMsg");
  const actionCol = document.getElementById("actionCol");

  if (isAdmin) {
    if (formPanel) formPanel.style.display = "block";
    if (accessMsg) accessMsg.textContent = "";
  } else {
    if (formPanel) formPanel.style.display = "none";
    if (actionCol) actionCol.style.display = "none";
    if (accessMsg) accessMsg.textContent = "You have read-only access. Only admins can modify rooms.";
  }

  const form = document.getElementById("roomForm");
  if (form) {
    // ★★★ 新增：实时验证 ★★★
    ["building", "room_code", "capacity", "room_type"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        validateRoomField(id);
        const fm = document.getElementById("formMsg");
        if (fm) fm.textContent = "";
      });
      el.addEventListener("change", () => validateRoomField(id));
    });

    // ---------- 提交 ----------
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

      const r = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + getToken(),
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json();

      if (!r.ok) {
        const detail = data.detail || "Failed";
        if (detail.toLowerCase().includes("already exists")) {
          document.getElementById("room_codeMsg").textContent = detail;
          document.getElementById("room_code").classList.add("input-error");
        } else {
          msg.style.color = "#dc2626";
          msg.textContent = detail;
        }
        return;
      }

      msg.style.color = "#16a34a";
      msg.textContent = editingRoomId
        ? "Room updated successfully"
        : `Room ${data.room_code} added successfully`;

      editingRoomId = null;
      document.getElementById("formSubmitBtn").textContent = "Save Room";
      document.getElementById("formTitle").textContent = "Add Room";
      form.reset();
      ["building", "room_code", "capacity", "room_type"].forEach(id => {
        const m = document.getElementById(id + "Msg");
        if (m) m.textContent = "";
        const el = document.getElementById(id);
        if (el) el.classList.remove("input-error");
      });
      loadRooms();
    });
  }

  loadRooms();
}

async function loadRooms() {
  const tbody = document.getElementById("roomTable");
  if (!tbody) return;

  const res = await fetch(API + "/rooms", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7">Failed to load rooms</td></tr>`;
    return;
  }
  const rooms = await res.json();

  if (rooms.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#888;">No rooms yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rooms.map(r => `
    <tr>
      <td>${r.campus || "-"}</td>
      <td>${r.building}</td>
      <td><b>${r.room_code}</b></td>
      <td>${r.capacity}</td>
      <td><span class="badge">${r.room_type}</span></td>
      <td>${r.equipment || "-"}</td>
      ${isAdmin ? `
        <td>
          <button class="btn-edit" onclick="editRoom(${r.id})">Edit</button>
          <button class="btn-del" onclick="deleteRoom(${r.id})">Delete</button>
        </td>
      ` : `<td></td>`}
    </tr>
  `).join("");
}

async function editRoom(id) {
  const res = await fetch(API + "/rooms", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
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
  const ok = await showConfirm(
    "Delete Room",
    "Are you sure you want to delete this room? This cannot be undone."
  );
  if (!ok) return;

  const res = await fetch(API + "/rooms/" + id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    showNotice(data.detail || "Delete failed", "error");
    return;
  }
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
// Manage Faculty Profiles
// ============================================================

let editingTeacherId = null;
let isAdminTeacher = false;

async function initTeachersPage() {
  const table = document.getElementById("teacherTable");
  if (!table) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
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
    if (accessMsg) accessMsg.textContent = "You have read-only access. Only admins can modify faculty profiles.";
  }

  const form = document.getElementById("teacherForm");
  if (form) {
    // Real-time validation
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

    // Submit
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("formMsg");
      msg.textContent = "";

      const fields = ["full_name", "email", "department", "max_weekly_hours", "max_daily_hours"];
      const ok = fields.every(f => validateTeacherField(f));
      if (!ok) return;

      const payload = {
        full_name: document.getElementById("full_name").value.trim(),
        email: document.getElementById("email").value.trim(),
        academic_title: document.getElementById("academic_title").value.trim() || null,
        department: document.getElementById("department").value.trim(),
        max_weekly_hours: parseInt(document.getElementById("max_weekly_hours").value.trim(), 10),
        max_daily_hours: parseInt(document.getElementById("max_daily_hours").value.trim(), 10),
        qualified_subjects: document.getElementById("qualified_subjects").value.trim() || null,
      };

      const url = editingTeacherId ? API + "/teachers/" + editingTeacherId : API + "/teachers";
      const method = editingTeacherId ? "PUT" : "POST";

      const r = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + getToken(),
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json();

      if (!r.ok) {
        const detail = data.detail || "Failed";
        if (detail.toLowerCase().includes("email")) {
          document.getElementById("emailMsg").textContent = detail;
          document.getElementById("email").classList.add("input-error");
        } else {
          msg.style.color = "#dc2626";
          msg.textContent = detail;
        }
        return;
      }

      msg.style.color = "#16a34a";
      msg.textContent = editingTeacherId
        ? "Faculty profile updated"
        : "Faculty profile saved";

      editingTeacherId = null;
      document.getElementById("formSubmitBtn").textContent = "Save Faculty";
      document.getElementById("formTitle").textContent = "Add Faculty";
      form.reset();

      fields.forEach(id => {
        const m = document.getElementById(id + "Msg");
        if (m) m.textContent = "";
        const el = document.getElementById(id);
        if (el) el.classList.remove("input-error");
      });

      loadTeachers();
    });
  }

  loadTeachers();
}

async function loadTeachers() {
  const tbody = document.getElementById("teacherTable");
  if (!tbody) return;

  const res = await fetch(API + "/teachers", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="8">Failed to load faculty</td></tr>`;
    return;
  }
  const teachers = await res.json();

  if (teachers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:#888;">No faculty yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = teachers.map(t => `
    <tr>
      <td><b>${t.full_name}</b></td>
      <td>${t.email}</td>
      <td>${t.academic_title || "-"}</td>
      <td><span class="badge">${t.department}</span></td>
      <td>${t.max_weekly_hours}</td>
      <td>${t.max_daily_hours}</td>
      <td>${t.qualified_subjects || "-"}</td>
      ${isAdminTeacher ? `
        <td>
          <button class="btn-edit" onclick="editTeacher(${t.id})">Edit</button>
          <button class="btn-del" onclick="deleteTeacher(${t.id})">Delete</button>
        </td>
      ` : `<td></td>`}
    </tr>
  `).join("");
}

async function editTeacher(id) {
  const res = await fetch(API + "/teachers", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
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
  document.getElementById("qualified_subjects").value = t.qualified_subjects || "";

  editingTeacherId = id;
  document.getElementById("formTitle").textContent = "Edit Faculty";
  document.getElementById("formSubmitBtn").textContent = "Update Faculty";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteTeacher(id) {
  const ok = await showConfirm(
    "Delete Faculty Profile",
    "Are you sure you want to delete this faculty profile? This cannot be undone."
  );
  if (!ok) return;

  const res = await fetch(API + "/teachers/" + id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    showNotice(data.detail || "Delete failed", "error");
    return;
  }
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

async function initCoursesPage() {
  const table = document.getElementById("courseTable");
  if (!table) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
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
    if (accessMsg) accessMsg.textContent = "You have read-only access. Only admins can modify curriculum.";
  }

  // ---------- Load unique PROGRAMS as checkboxes ----------
  try {
    const groupsRes = await fetch(API + "/student-groups", {
      headers: { "Authorization": "Bearer " + token },
    });
    const groups = await groupsRes.json();

    // 收集 program，按小写去重（避免 "Information System" 和 "Information Systems" 并存）
    const seen = new Map();
    groups.forEach(g => {
      if (!g.program) return;
      const key = g.program.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, g.program.trim());
    });
    const programs = [...seen.values()].sort();

    const groupList = document.getElementById("groupList");
    if (groupList) {
      groupList.innerHTML = programs.map(p => `
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" class="group-check" value="${p}" />
          ${p}
        </label>
      `).join("");
    }
  } catch (e) {
    console.error("Failed to load programs", e);
  }

  const form = document.getElementById("courseForm");
  if (form) {
    // Real-time validation
    ["course_code", "course_name", "credits", "total_hours", "lecture_hours", "practice_hours", "lab_hours"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        validateCourseField(id);
        const fm = document.getElementById("formMsg");
        if (fm) fm.textContent = "";
      });
    });

    // Submit
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("formMsg");
      msg.textContent = "";

      const fields = ["course_code", "course_name", "credits", "total_hours", "lecture_hours", "practice_hours", "lab_hours"];
      const ok = fields.every(f => validateCourseField(f));
      if (!ok) return;

      // Checkbox value: "Information Systems, Computer Science"
      const selectedPrograms = Array.from(document.querySelectorAll(".group-check:checked"))
        .map(cb => cb.value);

      const payload = {
        course_code: document.getElementById("course_code").value.trim(),
        course_name: document.getElementById("course_name").value.trim(),
        credits: parseInt(document.getElementById("credits").value.trim(), 10),
        semester_level: document.getElementById("semester_level").value.trim() || null,
        total_hours: parseInt(document.getElementById("total_hours").value.trim(), 10),
        lecture_hours: parseInt(document.getElementById("lecture_hours").value.trim() || "0", 10),
        practice_hours: parseInt(document.getElementById("practice_hours").value.trim() || "0", 10),
        lab_hours: parseInt(document.getElementById("lab_hours").value.trim() || "0", 10),
        target_groups: selectedPrograms.join(", ") || null,
        department: document.getElementById("department").value || null,
      };

      // Cross-field: hours sum must equal total
      const sum = payload.lecture_hours + payload.practice_hours + payload.lab_hours;
      if (sum !== payload.total_hours) {
        msg.style.color = "#dc2626";
        msg.textContent = `Total session hours (${sum}) do not match Total Hours (${payload.total_hours}).`;
        ["lecture_hours", "practice_hours", "lab_hours", "total_hours"].forEach(highlightField);
        return;
      }

      const url = editingCourseId ? API + "/courses/" + editingCourseId : API + "/courses";
      const method = editingCourseId ? "PUT" : "POST";

      const r = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + getToken(),
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json();

      if (!r.ok) {
        msg.style.color = "#dc2626";
        const detail = data.detail || "Failed";
        msg.textContent = detail;
        if (detail.toLowerCase().includes("code")) {
          highlightField("course_code");
        }
        return;
      }

      msg.style.color = "#16a34a";
      msg.textContent = editingCourseId
        ? "Course updated successfully"
        : "Course added successfully";

      editingCourseId = null;
      document.getElementById("formSubmitBtn").textContent = "Save Course";
      document.getElementById("formTitle").textContent = "Add Course";
      form.reset();

      fields.forEach(id => {
        const m = document.getElementById(id + "Msg");
        if (m) m.textContent = "";
        const el = document.getElementById(id);
        if (el) el.classList.remove("input-error");
      });
      document.querySelectorAll(".group-check").forEach(cb => cb.checked = false);

      loadCourses();
    });
  }

  loadCourses();
}

async function loadCourses() {
  const tbody = document.getElementById("courseTable");
  if (!tbody) return;

  const res = await fetch(API + "/courses", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="9">Failed to load courses</td></tr>`;
    return;
  }
  const courses = await res.json();

  if (courses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:#888;">No courses yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = courses.map(c => {
    const split = `${c.lecture_hours}L + ${c.practice_hours}P + ${c.lab_hours}Lab`;
    return `
      <tr>
        <td><b>${c.course_code}</b></td>
        <td>${c.course_name}</td>
        <td>${c.credits} ECTS</td>
        <td>${c.semester_level || "-"}</td>
        <td><span class="split">${split}</span></td>
        <td>${c.total_hours}h</td>
        <td>${c.target_groups || "-"}</td>
        <td>${c.department ? `<span class="badge">${c.department}</span>` : "-"}</td>
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
  const res = await fetch(API + "/courses", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) return;
  const courses = await res.json();
  const c = courses.find(x => x.id === id);
  if (!c) return;

  document.getElementById("course_code").value = c.course_code;
  document.getElementById("course_name").value = c.course_name;
  document.getElementById("credits").value = c.credits;
  document.getElementById("semester_level").value = c.semester_level || "";
  document.getElementById("total_hours").value = c.total_hours;
  document.getElementById("lecture_hours").value = c.lecture_hours;
  document.getElementById("practice_hours").value = c.practice_hours;
  document.getElementById("lab_hours").value = c.lab_hours;
  document.getElementById("department").value = c.department || "";

  // Restore checkbox state from comma-separated program list
  document.querySelectorAll(".group-check").forEach(cb => cb.checked = false);
  if (c.target_groups) {
    const selected = c.target_groups.split(",").map(s => s.trim());
    document.querySelectorAll(".group-check").forEach(cb => {
      if (selected.includes(cb.value)) cb.checked = true;
    });
  }

  editingCourseId = id;
  document.getElementById("formTitle").textContent = "Edit Course";
  document.getElementById("formSubmitBtn").textContent = "Update Course";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteCourse(id) {
  const ok = await showConfirm(
    "Delete Course",
    "Are you sure you want to delete this course? This cannot be undone."
  );
  if (!ok) return;

  const res = await fetch(API + "/courses/" + id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    showNotice(data.detail || "Delete failed", "error");
    return;
  }
  showNotice("Course deleted", "success");
  loadCourses();
}

function filterCourses() {
  const el = document.getElementById("courseFilter");
  if (!el) return;
  const q = el.value.toLowerCase();
  document.querySelectorAll("#courseTable tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

// ============================================================
// Teacher Availability Preference (User Story 6)
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
  if (!grid) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
  const me = await meRes.json();
  availIsAdmin = me.roles.includes("admin");
  availIsTeacher = me.roles.includes("teacher");

  const cfgRes = await fetch(API + "/availability/config", {
    headers: { "Authorization": "Bearer " + token },
  });
  availConfig = await cfgRes.json();

  const myRes = await fetch(API + "/availability/me", {
    headers: { "Authorization": "Bearer " + token },
  });
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

// RENAMED to avoid clash with User Story 10's renderGrid()
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

  const res = await fetch(API + "/availability/me", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + getToken(),
    },
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

// ---------- Admin ----------
function updateFreezeUI() {
  const el = document.getElementById("freezeStatus");
  el.textContent = availFrozen ? "FROZEN (read-only)" : "Open";
  el.style.color = availFrozen ? "#dc2626" : "#16a34a";
}

async function toggleFreeze() {
  const res = await fetch(API + "/availability/freeze", {
    method: "POST",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.detail || "Failed");
    return;
  }
  availFrozen = data.is_frozen;
  updateFreezeUI();
  window.location.reload();
}

async function loadTeacherList() {
  const res = await fetch(API + "/availability/teachers", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
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

  const res = await fetch(API + "/availability/teacher/" + id, {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    box.innerHTML = "Failed to load.";
    return;
  }
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
// Hard Constraints (User Story 7)
// ============================================================

let constraintCache = {};
let constraintIsAdmin = false;

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

async function initConstraintsPage() {
  const box = document.getElementById("card-no_overlap_rooms");
  if (!box) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
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
    dayChecks.innerHTML = ALL_DAYS.map(d => `
      <label>
        <input type="checkbox" class="day-check" value="${d}" checked />
        ${d}
      </label>
    `).join("");
  }

  await loadConstraints();
}

async function loadConstraints() {
  const res = await fetch(API + "/constraints", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) return;
  const list = await res.json();

  constraintCache = {};
  list.forEach(c => { constraintCache[c.constraint_type] = c; });

  for (const type of ["no_overlap_rooms", "no_overlap_teachers", "lunch_break"]) {
    const c = constraintCache[type];
    if (!c) continue;

    const toggle = document.getElementById("toggle-" + type);
    if (toggle) toggle.checked = c.is_active;

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
    config: type === "lunch_break"
      ? (constraintCache["lunch_break"]?.config || {
          start: "12:00", end: "13:00", days: ALL_DAYS,
        })
      : null,
  };

  const res = await fetch(API + "/constraints/" + type, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + getToken(),
    },
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
  const days = Array.from(document.querySelectorAll(".day-check:checked"))
    .map(cb => cb.value);

  const msg = document.getElementById("msg");
  msg.textContent = "";

  const res = await fetch(API + "/constraints/lunch_break", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + getToken(),
    },
    body: JSON.stringify({
      is_active: document.getElementById("toggle-lunch_break").checked,
      config: { start, end, days },
    }),
  });
  const data = await res.json();

  if (!res.ok) {
    msg.style.color = "#dc2626";
    msg.textContent = data.detail || "Failed to save lunch break";
    return;
  }

  constraintCache["lunch_break"] = data;
  msg.style.color = "#16a34a";
  msg.textContent = "Lunch break configuration saved.";
}

async function runDemoValidation() {
  const box = document.getElementById("validateBox");
  box.style.display = "block";
  box.textContent = "Running...";

  const entries = [
    {
      day: "Mon", time_slot: "08:30-10:00",
      room_id: 1, room_code: "C102",
      teacher_id: 1, teacher_name: "Dr. Arman",
      course_code: "CS201",
    },
    {
      day: "Mon", time_slot: "08:30-10:00",
      room_id: 1, room_code: "C102",
      teacher_id: 1, teacher_name: "Dr. Arman",
      course_code: "CS301",
    },
    {
      day: "Mon", time_slot: "12:00-13:30",
      room_id: 2, room_code: "G201",
      teacher_id: 2, teacher_name: "Prof. Dana",
      course_code: "MATH101",
    },
  ];

  const res = await fetch(API + "/constraints/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + getToken(),
    },
    body: JSON.stringify({ entries }),
  });
  const data = await res.json();

  if (!res.ok) {
    box.textContent = "Error: " + (data.detail || "Unknown");
    return;
  }

  if (data.valid) {
    box.innerHTML = `<div class="ok-item">No conflicts detected (${data.checked} entries checked).</div>`;
    return;
  }

  box.innerHTML = data.conflicts.map(c => `
    <div class="conflict-item">
      <b>[${c.type}]</b> ${c.message}
    </div>
  `).join("");
}

// ============================================================
// Soft Constraints (User Story 8)
// ============================================================

let softCache = {};
let softIsAdmin = false;

async function initSoftConstraintsPage() {
  const listEl = document.getElementById("softList");
  if (!listEl) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
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

  const res = await fetch(API + "/soft-constraints", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    listEl.innerHTML = "Failed to load soft constraints.";
    return;
  }
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
        <input type="range" min="0" max="10" step="1"
               id="slider-${c.constraint_key}"
               value="${c.weight}"
               oninput="onWeightChange('${c.constraint_key}', this.value)"
               ${softIsAdmin ? "" : "disabled"} />
        <span class="weight-value" id="weight-${c.constraint_key}">${c.weight}</span>
      </div>

      <label class="enable-toggle">
        <input type="checkbox" id="enabled-${c.constraint_key}"
               ${c.is_enabled ? "checked" : ""}
               ${softIsAdmin ? "" : "disabled"} />
        Enabled
      </label>
    </div>
  `).join("");
}

function onWeightChange(key, value) {
  const label = document.getElementById("weight-" + key);
  if (label) label.textContent = value;

  if (softCache[key]) {
    softCache[key].weight = parseInt(value, 10);
  }
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

    const res = await fetch(API + "/soft-constraints/" + key, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
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

  const res = await fetch(API + "/soft-constraints/reset", {
    method: "POST",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();

  if (!res.ok) {
    msg.style.color = "#dc2626";
    msg.textContent = data.detail || "Reset failed";
    return;
  }

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

  const res = await fetch(API + "/soft-constraints/score", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + getToken(),
    },
    body: JSON.stringify({ entries }),
  });
  const data = await res.json();

  if (!res.ok) {
    box.textContent = "Error: " + (data.detail || "Unknown");
    return;
  }

  const scoreClass = data.total_score >= 70 ? "" :
                     data.total_score >= 40 ? "mid" : "low";

  const breakdownHTML = data.breakdown.length === 0
    ? `<p style="font-size:13px;color:#888;">No active soft constraints.</p>`
    : data.breakdown.map(b => `
        <div class="breakdown-item">
          <span class="name">${b.display_name}</span>
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
    <div class="score-bar">
      <div style="width: ${data.total_score}%"></div>
    </div>
    ${breakdownHTML}
  `;
}

// ============================================================
// AI Timetable Generator (User Story 9)
// ============================================================

async function initGeneratorPage() {
  const btn = document.getElementById("generateBtn");
  if (!btn) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
  const me = await meRes.json();
  const isAdmin = me.roles.includes("admin");

  if (!isAdmin) {
    btn.disabled = true;
    btn.textContent = "Admin only";
    return;
  }

  loadExistingEntries();
}

async function loadExistingEntries() {
  const res = await fetch(API + "/generator/entries", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
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
    const res = await fetch(API + "/generator/generate", {
      method: "POST",
      headers: { "Authorization": "Bearer " + getToken() },
    });
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

    const msg = data.status === "success"
      ? `Generated ${data.placed_count} class sessions with zero hard-constraint violations.`
      : `Generated ${data.placed_count} sessions, but ${data.failed_count} could not be placed.`;
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

  const breakdownHTML = data.score_breakdown.length === 0
    ? `<p style="font-size:13px;color:#888;">No active soft constraints.</p>`
    : data.score_breakdown.map(b => `
        <div class="breakdown-item">
          <span>${b.display_name}</span>
          <span class="pill">weight ${b.weight}</span>
          <span class="pill">raw ${b.raw_penalty}</span>
          <span class="penalty">-${b.weighted_penalty}</span>
        </div>
      `).join("");

  box.innerHTML = `
    <div class="score-header">
      <span class="score-number ${scoreClass}">${score}</span>
      <span class="score-label">/ 100 · ${data.placed_count} sessions placed</span>
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
    if (l.startsWith("[OK]"))   return `<div class="ok">${l}</div>`;
    if (l.startsWith("[FAIL]")) return `<div class="fail">${l}</div>`;
    return `<div>${l}</div>`;
  }).join("");
}

function renderGeneratorEntries(entries) {
  const panel = document.getElementById("entriesPanel");
  const tbody = document.getElementById("entriesBody");
  panel.style.display = "block";

  tbody.innerHTML = entries.map(e => `
    <tr>
      <td>${e.day}</td>
      <td>${e.time_slot}</td>
      <td><b>${e.course_code}</b></td>
      <td><span class="badge">${e.session_type}</span></td>
      <td>${e.room_code}</td>
      <td>${e.teacher_name}</td>
      <td>${e.target_groups}</td>
    </tr>
  `).join("");
}

function renderGeneratorFailed(failed) {
  const box = document.getElementById("failedBox");
  if (!failed || failed.length === 0) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  box.innerHTML = `
    <b>${failed.length} session(s) could not be placed:</b>
    <ul style="margin:6px 0 0 20px;">
      ${failed.map(f => `<li>${f.course_code} (${f.session_type})</li>`).join("")}
    </ul>
  `;
}

// ============================================================
// Real-Time Conflict Detection (User Story 10)
// ============================================================

let scheduleData = { days: [], time_slots: [], cells: [], conflicts: [] };
let roomsCache = [];
let currentMoveEntry = null;
let scheduleIsAdmin = false;
let draggingEntryId = null;
let pendingSwap = null;

async function initSchedulePage() {
  // Guard: only run on schedule.html (which has summaryText)
  const summaryEl = document.getElementById("summaryText");
  if (!summaryEl) return;

  const gridTable = document.getElementById("gridTable");
  if (!gridTable) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
  const me = await meRes.json();
  scheduleIsAdmin = me.roles.includes("admin");

  const roomsRes = await fetch(API + "/rooms", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (roomsRes.ok) {
    roomsCache = await roomsRes.json();
  }

  const daySel = document.getElementById("moveDay");
  const slotSel = document.getElementById("moveSlot");
  daySel.innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    .map(d => `<option value="${d}">${d}</option>`).join("");
  slotSel.innerHTML = [
    "08:30-10:00",
    "10:15-11:45",
    "12:00-13:30",
    "13:30-15:00",
    "15:15-16:45",
    "17:00-18:30",
  ].map(s => `<option value="${s}">${s}</option>`).join("");
  document.getElementById("moveRoom").innerHTML = roomsCache
    .map(r => `<option value="${r.id}">${r.building} · ${r.room_code} (cap ${r.capacity})</option>`)
    .join("");

  await refreshGrid();
}

async function refreshGrid() {
  const res = await fetch(API + "/conflicts/grid", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    console.error("Failed to load grid");
    return;
  }
  scheduleData = await res.json();
  renderScheduleGrid();
  renderConflicts();
  updateBanner();
}

async function rescanConflicts() {
  await refreshGrid();
}

// RENAMED to avoid clash with User Story 6's renderGrid()
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
      const entries = cell ? cell.entries : [];

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
                 onclick="openMoveModal(${e.id}, '${e.course_code}', '${day}', '${slot}')"
                 onmouseenter="showEntryTooltip(event, ${e.id})"
                 onmouseleave="hideTooltip()">
              <span class="alert-icon">${e.has_conflict ? "⚠" : ""}</span>
              <div class="course">${e.course_code} <span class="type">${e.session_type}</span></div>
              <div class="meta">${e.room_code} · ${e.teacher_name || "-"}</div>
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
  document.getElementById("summaryText").textContent =
    `${total} sessions · ${errors} error(s) · ${warnings} warning(s)`;
}

function updateBanner() {
  const banner = document.getElementById("alertBanner");
  const errors = scheduleData.error_count || 0;
  const warnings = scheduleData.warning_count || 0;

  if (errors > 0) {
    banner.className = "show error";
    banner.innerHTML = `<span class="count">${errors}</span>
      <span>hard-constraint conflict(s) detected. Click any red session for details.</span>`;
  } else if (warnings > 0) {
    banner.className = "show warning";
    banner.innerHTML = `<span class="count">${warnings}</span>
      <span>capacity warning(s) detected. The schedule is valid but some rooms may be too small.</span>`;
  } else {
    banner.className = "show success";
    banner.innerHTML = `No conflicts. The schedule satisfies all hard constraints.`;
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
      <b>${c.message}</b>
      ${
        c.details.courses
          ? `Courses involved: ${c.details.courses.join(", ")}`
          : c.details.course
          ? `Course: ${c.details.course}`
          : ""
      }
      ${c.details.excess ? ` · Over capacity by ${c.details.excess} students` : ""}
    </div>
  `).join("");
}

// ---------- Tooltip ----------
function showEntryTooltip(evt, entryId) {
  const tt = document.getElementById("tooltip");

  const cell = scheduleData.cells.find(c =>
    c.entries.some(e => e.id === entryId)
  );
  if (!cell) return;
  const entry = cell.entries.find(e => e.id === entryId);

  const conflicts = (scheduleData.conflicts || []).filter(c =>
    c.entry_ids.includes(entryId)
  );

  let html = `
    <div class="tt-title">${entry.course_code} · ${entry.session_type}</div>
    <div class="tt-row"><span class="tt-label">Room</span>${entry.room_code}</div>
    <div class="tt-row"><span class="tt-label">Teacher</span>${entry.teacher_name || "-"}</div>
    <div class="tt-row"><span class="tt-label">Groups</span>${entry.target_groups || "-"}</div>
  `;

  if (conflicts.length > 0) {
    html += `<div class="tt-row" style="margin-top:8px;border-top:1px solid #374151;padding-top:6px;">`;
    conflicts.forEach(c => {
      html += `<div style="color:#fca5a5;">⚠ ${c.message}</div>`;
    });
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
  if (x + rect.width > window.innerWidth - 8) {
    x = evt.clientX - rect.width - padding;
  }
  if (y + rect.height > window.innerHeight - 8) {
    y = evt.clientY - rect.height - padding;
  }

  tt.style.left = x + "px";
  tt.style.top = y + "px";
}

function hideTooltip() {
  document.getElementById("tooltip").style.display = "none";
}

// ---------- Move modal ----------
function openMoveModal(entryId, courseCode, day, slot) {
  if (!scheduleIsAdmin) return;

  currentMoveEntry = entryId;
  document.getElementById("moveEntryLabel").textContent =
    `${courseCode} (entry #${entryId})`;
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

  const res = await fetch(API + "/conflicts/entries/" + currentMoveEntry, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + getToken(),
    },
    body: JSON.stringify({ day, time_slot, room_id }),
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.detail || "Move failed");
    return;
  }

  closeMoveModal();
  await refreshGrid();
}

// ============================================================
// Interactive Drag-and-Drop Grid (User Story 11)
// ============================================================

function onDragStart(evt, entryId) {
  if (!scheduleIsAdmin) {
    evt.preventDefault();
    return;
  }
  draggingEntryId = entryId;
  evt.dataTransfer.effectAllowed = "move";
  evt.dataTransfer.setData("text/plain", String(entryId));
  evt.currentTarget.classList.add("dragging");
}

function onDragEnd(evt) {
  evt.currentTarget.classList.remove("dragging");
  document.querySelectorAll("td.drop-target, td.drop-target-occupied, td.drop-invalid")
    .forEach(td => td.classList.remove(
      "drop-target", "drop-target-occupied", "drop-invalid"
    ));
  draggingEntryId = null;
}

function onCellDragOver(evt, day, slot) {
  if (!draggingEntryId) return;
  evt.preventDefault();

  const td = evt.currentTarget;
  document.querySelectorAll("td.drop-target, td.drop-target-occupied, td.drop-invalid")
    .forEach(el => el.classList.remove(
      "drop-target", "drop-target-occupied", "drop-invalid"
    ));

  const cell = scheduleData.cells.find(c => c.day === day && c.time_slot === slot);
  const occupied = cell && cell.entries && cell.entries.length > 0;

  if (occupied) {
    td.classList.add("drop-target-occupied");
  } else {
    td.classList.add("drop-target");
  }
  evt.dataTransfer.dropEffect = "move";
}

function onCellDragLeave(evt) {
  evt.currentTarget.classList.remove(
    "drop-target", "drop-target-occupied", "drop-invalid"
  );
}

async function onCellDrop(evt, day, slot) {
  evt.preventDefault();
  const draggedId = draggingEntryId;
  if (!draggedId) return;

  const td = evt.currentTarget;
  td.classList.remove("drop-target", "drop-target-occupied", "drop-invalid");

  const cell = scheduleData.cells.find(c => c.day === day && c.time_slot === slot);
  const entries = (cell && cell.entries) || [];

  if (entries.some(e => e.id === draggedId)) return;

  if (entries.length === 0) {
    await moveEntryToSlot(draggedId, day, slot);
  } else {
    const targetId = entries[0].id;
    openSwapModal(draggedId, targetId, entries[0].course_code, day, slot);
  }
}

async function moveEntryToSlot(entryId, day, time_slot) {
  try {
    const res = await fetch(API + "/conflicts/entries/" + entryId, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
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

  const draggedCell = scheduleData.cells.find(c =>
    c.entries.some(e => e.id === draggedId));
  const draggedEntry = draggedCell.entries.find(e => e.id === draggedId);

  document.getElementById("swapLineA").innerHTML =
    `<b>${draggedEntry.course_code}</b> — ${draggedCell.day} ${draggedCell.time_slot} · Room ${draggedEntry.room_code}`;
  document.getElementById("swapLineB").innerHTML =
    `<b>${targetCourse}</b> — ${targetDay} ${targetSlot} · Room ${scheduleData.cells.find(c => c.entries.some(e => e.id === targetId)).entries.find(e => e.id === targetId).room_code}`;

  document.getElementById("swapModal").classList.add("open");
}

function closeSwapModal() {
  pendingSwap = null;
  document.getElementById("swapModal").classList.remove("open");
}

async function confirmSwap() {
  if (!pendingSwap) return;

  try {
    const res = await fetch(API + "/conflicts/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify({
        entry_id_a: pendingSwap.draggedId,
        entry_id_b: pendingSwap.targetId,
      }),
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
// Smart Room Auto-Fitting (User Story 12)
// ============================================================

async function initRoomFittingPage() {
  const form = document.getElementById("fitForm");
  if (!form) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const groupsRes = await fetch(API + "/student-groups", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (groupsRes.ok) {
    const groups = await groupsRes.json();
    const box = document.getElementById("groupsBox");
    groups.forEach(g => {
      const lbl = document.createElement("label");
      lbl.innerHTML = `
        <input type="checkbox" class="fit-group-check" value="${g.group_code}" />
        ${g.group_code} <span style="color:#888;">(${g.student_count})</span>
      `;
      box.appendChild(lbl);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const session_type = document.getElementById("sessionType").value;
    const course_code = document.getElementById("courseCode").value.trim() || null;
    const target_groups = Array.from(document.querySelectorAll(".fit-group-check:checked"))
      .map(cb => cb.value);

    if (target_groups.length === 0) {
      alert("Select at least one student group.");
      return;
    }

    const res = await fetch(API + "/room-fitting/suggest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify({ session_type, target_groups, course_code }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.detail || "Failed");
      return;
    }

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
    <br/>
    Required room types: <b>${data.required_room_types.join(" / ") || "any"}</b> ·
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
// Manage Academic Semesters (US-07)
// ============================================================

let editingSemesterId = null;
let semesterIsAdmin = false;

// ---------- Semester field validators ----------
function validateSemesterField(fieldId) {
  const inputEl = document.getElementById(fieldId);
  const msgEl = document.getElementById(fieldId + "Msg");
  if (!inputEl || !msgEl) return true;

  const value = inputEl.value.trim();
  let errorMsg = "";

    if (fieldId === "name") {
    if (!value) {
      errorMsg = "Semester name is required.";
    } else if (!/^(\d{4})\s+(Fall|Spring|Summer)$/i.test(value)) {
      errorMsg = "Format must be like '2025 Fall' or '2026 Spring'.";
    }
  } else if (fieldId === "start_date" || fieldId === "end_date") {
    if (!value) {
      errorMsg = fieldId === "start_date" ? "Start date is required." : "End date is required.";
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errorMsg = "Date must be in format YYYY-MM-DD (e.g., 2026-09-01).";
    }
  }

  msgEl.textContent = errorMsg;
  if (errorMsg) {
    inputEl.classList.add("input-error");
    return false;
  }
  inputEl.classList.remove("input-error");
  return true;
}


async function initSemestersPage() {
  const table = document.getElementById("semesterTable");
  if (!table) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
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

  // Live validation
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

    // Validate all fields
    const okName = validateSemesterField("name");
    const okStart = validateSemesterField("start_date");
    const okEnd = validateSemesterField("end_date");
    if (!okName || !okStart || !okEnd) return;

        const name = document.getElementById("name").value.trim();
    const start_date = document.getElementById("start_date").value.trim();
    const end_date = document.getElementById("end_date").value.trim();

    // Cross-field check
    if (start_date >= end_date) {
      document.getElementById("end_dateMsg").textContent =
        "End date must be after start date.";
      document.getElementById("end_date").classList.add("input-error");
      return;
    }

    // Parse name like "2025 Fall" → academic_year=2025, term="Fall"
    const m = name.match(/^(\d{4})\s+(Fall|Spring|Summer)$/i);
    if (!m) {
      document.getElementById("nameMsg").textContent =
        "Semester name must be like '2025 Fall' or '2026 Spring'.";
      document.getElementById("name").classList.add("input-error");
      return;
    }
    const academic_year = parseInt(m[1], 10);
    const term = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();

    const payload = {
      name,
      academic_year,
      term,
      start_date,
      end_date,
    };

    const url = editingSemesterId
      ? API + "/semesters/" + editingSemesterId
      : API + "/semesters";
    const method = editingSemesterId ? "PUT" : "POST";

    const r = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();

        if (!r.ok) {
      // 422: FastAPI validation error
      if (r.status === 422 && Array.isArray(data.detail)) {
        const field = data.detail[0].loc[data.detail[0].loc.length - 1];
        const map = {
          "name": "nameMsg",
          "academic_year": "nameMsg",
          "term": "nameMsg",
          "start_date": "start_dateMsg",
          "end_date": "end_dateMsg",
        };
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
    formMsg.textContent = editingSemesterId
      ? "Semester updated successfully"
      : "Semester created successfully";

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

  const res = await fetch(API + "/semesters", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="5">Failed to load semesters</td></tr>`;
    return;
  }
  const semesters = await res.json();

  // Update active label
  const active = semesters.find(s => s.is_active);
  document.getElementById("activeSemesterLabel").textContent =
    active ? `Active: ${active.name}` : "No active semester";

  if (semesters.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#888;">No semesters yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = semesters.map(s => `
    <tr>
      <td><b>${s.name}</b></td>
      <td>${s.start_date}</td>
      <td>${s.end_date}</td>
      <td>
        <span class="badge ${s.is_active ? "badge-active" : "badge-inactive"}">
          ${s.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      ${semesterIsAdmin ? `
        <td>
          <button class="btn-edit" onclick="editSemester(${s.id})">Edit</button>
          <button class="btn-activate" onclick="activateSemester(${s.id})"
                  ${s.is_active ? "disabled" : ""}>
            ${s.is_active ? "Active" : "Set Active"}
          </button>
          <button class="btn-del" onclick="deleteSemester(${s.id})">Delete</button>
        </td>
      ` : `<td></td>`}
    </tr>
  `).join("");
}

async function editSemester(id) {
  const res = await fetch(API + "/semesters", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
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
  const res = await fetch(API + "/semesters/" + id + "/activate", {
    method: "POST",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.detail || "Failed to activate");
    return;
  }
  loadSemesters();
}

async function deleteSemester(id) {
  const ok = await showConfirm(
    "Delete Semester",
    "Are you sure you want to delete this semester? This cannot be undone."
  );
  if (!ok) return;

  const res = await fetch(API + "/semesters/" + id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    showNotice(data.detail || "Delete failed", "error");
    return;
  }
  showNotice("Semester deleted", "success");
  loadSemesters();
}

// ============================================================
// Manage Student Groups (US-08)
// ============================================================

let editingGroupId = null;
let groupIsAdmin = false;

let departmentsCache = [];

function onDepartmentChange() {
  const deptName = document.getElementById("department").value;
  const progSel = document.getElementById("program");
  const dept = departmentsCache.find(d => d.name === deptName);

  if (!dept) {
    progSel.innerHTML = `<option value="">-- Select program --</option>`;
    return;
  }

  progSel.innerHTML = `<option value="">-- Select program --</option>` +
    dept.programs.map(p => `<option value="${p.name}">${p.name}</option>`).join("");
}

function validateGroupField(fieldId) {
  const inputEl = document.getElementById(fieldId);
  const msgEl = document.getElementById(fieldId + "Msg");
  if (!inputEl || !msgEl) return true;

  const value = inputEl.value.trim();
  let errorMsg = "";

  if (fieldId === "group_code") {
    if (!value) {
      errorMsg = "Group code is required.";
    } else if (!/^(IS|CS)-\d{2}-[A-Z]$/.test(value)) {
      errorMsg = "Format must be like IS-23-A or CS-24-B (2 letters, 2-digit year, 1 letter).";
    }
  } else if (fieldId === "department") {
    if (!value) {
      errorMsg = "Please select a department.";
    }
  } else if (fieldId === "program") {
    if (!value) {
      errorMsg = "Please select a program.";
    }
  } else if (fieldId === "year_override") {
    if (value) {
      const y = parseInt(value, 10);
      if (isNaN(y) || y < 1 || y > 10) {
        errorMsg = "Year override must be between 1 and 10 (leave empty to auto-calculate).";
      }
    }
  } else if (fieldId === "student_count") {
    if (!value) {
      errorMsg = "Student count is required.";
    } else {
      const c = parseInt(value, 10);
      if (isNaN(c) || c < 1 || c > 25) {
        errorMsg = "Student count must be between 1 and 25.";
      }
    }
  }

  msgEl.textContent = errorMsg;
  if (errorMsg) {
    inputEl.classList.add("input-error");
    return false;
  }
  inputEl.classList.remove("input-error");
  return true;
}

async function initStudentGroupsPage() {
  const table = document.getElementById("groupTable");
  if (!table) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
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

  // ---------- Load departments and their nested programs ----------
  try {
    const deptRes = await fetch(API + "/student-groups/departments", {
      headers: { "Authorization": "Bearer " + token },
    });
    if (deptRes.ok) {
      departmentsCache = await deptRes.json();

      const deptSel = document.getElementById("department");
      if (deptSel) {
        deptSel.innerHTML = `<option value="">-- Select department --</option>` +
          departmentsCache.map(d => `<option value="${d.name}">${d.name}</option>`).join("");
      }

      const progSel = document.getElementById("program");
      if (progSel) {
        progSel.innerHTML = `<option value="">-- Select program --</option>`;
      }
    }
  } catch (e) {
    console.error("Failed to load departments", e);
  }

  const form = document.getElementById("groupForm");

  // ---------- Live validation ----------
  ["group_code", "department", "program", "year_override", "student_count"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, () => {
      validateGroupField(id);
      const fm = document.getElementById("formMsg");
      if (fm) fm.textContent = "";
    });
  });

  // ---------- Submit ----------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formMsg = document.getElementById("formMsg");
    formMsg.textContent = "";

    // Validate all fields
    const okCode = validateGroupField("group_code");
    const okDept = validateGroupField("department");
    const okProgram = validateGroupField("program");
    const okYear = validateGroupField("year_override");
    const okCount = validateGroupField("student_count");
    if (!okCode || !okDept || !okProgram || !okYear || !okCount) return;

    const groupCode = document.getElementById("group_code").value.trim();
    const program = document.getElementById("program").value;
    const yearOverrideStr = document.getElementById("year_override").value.trim();
    const studentCountStr = document.getElementById("student_count").value.trim();

    // Auto-derive enrollment year from group_code: "IS-23-A" → 2023
    const parts = groupCode.split("-");
    const enrollment_year = parts.length >= 2
      ? 2000 + parseInt(parts[1], 10)
      : null;

    const year_override = yearOverrideStr ? parseInt(yearOverrideStr, 10) : null;
    const student_count = parseInt(studentCountStr, 10);

    const payload = {
      group_code: groupCode,
      program: program || null,
      enrollment_year: enrollment_year,
      year_override: year_override,
      student_count: student_count,
    };

    const url = editingGroupId
      ? API + "/student-groups/" + editingGroupId
      : API + "/student-groups";
    const method = editingGroupId ? "PUT" : "POST";

    const r = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();

    if (!r.ok) {
      const detail = data.detail || "Failed";
      if (detail.toLowerCase().includes("group code")) {
        document.getElementById("group_codeMsg").textContent = detail;
        document.getElementById("group_code").classList.add("input-error");
      } else {
        formMsg.style.color = "#dc2626";
        formMsg.textContent = detail;
      }
      return;
    }

    formMsg.style.color = "#16a34a";
    formMsg.textContent = editingGroupId
      ? "Student group updated"
      : "Student group created";

    editingGroupId = null;
    document.getElementById("formSubmitBtn").textContent = "Save Group";
    document.getElementById("formTitle").textContent = "Add Student Group";
    form.reset();

    // Clear all error states
    ["group_code", "department", "program", "year_override", "student_count"].forEach((id) => {
      const msgEl = document.getElementById(id + "Msg");
      if (msgEl) msgEl.textContent = "";
      const inputEl = document.getElementById(id);
      if (inputEl) inputEl.classList.remove("input-error");
    });

    // Reset program dropdown
    onDepartmentChange();

    loadStudentGroups();
  });

  loadStudentGroups();
}

async function loadStudentGroups() {
  const tbody = document.getElementById("groupTable");
  if (!tbody) return;

  const res = await fetch(API + "/student-groups", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7">Failed to load groups</td></tr>`;
    return;
  }
  const groups = await res.json();

  document.getElementById("countLabel").textContent = `${groups.length} group(s)`;

  if (groups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#888;">No groups yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = groups.map(g => {
    let currentYear = g.current_year ? `Year ${g.current_year}` : "-";
    if (g.year_override) {
      currentYear += ` <span style="color:#dc2626;font-size:11px;">(override)</span>`;
    }

    return `
      <tr>
        <td><b>${g.group_code}</b></td>
        <td>${g.program ? `<span class="badge">${g.program}</span>` : "-"}</td>
        <td>${g.department ? `<span class="badge-dept">${g.department}</span>` : "-"}</td>
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

async function deleteGroup(id) {
  const ok = await showConfirm(
    "Delete Student Group",
    "Are you sure you want to delete this group? This cannot be undone."
  );
  if (!ok) return;

  const res = await fetch(API + "/student-groups/" + id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    showNotice(data.detail || "Delete failed", "error");
    return;
  }
  showNotice("Student group deleted", "success");
  loadStudentGroups();
}

async function editGroup(id) {
  const res = await fetch(API + "/student-groups", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) return;
  const list = await res.json();
  const g = list.find(x => x.id === id);
  if (!g) return;

  document.getElementById("group_code").value = g.group_code;
  document.getElementById("student_count").value = g.student_count;
  document.getElementById("year_override").value = g.year_override || "";

  // Pick the department this program belongs to
  const progName = g.program;
  const dept = departmentsCache.find(d =>
    d.programs.some(p => p.name === progName)
  );
  document.getElementById("department").value = dept ? dept.name : "";
  onDepartmentChange();
  document.getElementById("program").value = progName || "";

  editingGroupId = id;
  document.getElementById("formTitle").textContent = "Edit Student Group";
  document.getElementById("formSubmitBtn").textContent = "Update Group";
  window.scrollTo({ top: 0, behavior: "smooth" });
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
// Manage Time Slots (US-09)
// ============================================================

let editingSlotId = null;
let slotIsAdmin = false;

// ---------- Time Slot field validators ----------
function validateSlotField(fieldId) {
  const inputEl = document.getElementById(fieldId);
  const msgEl = document.getElementById(fieldId + "Msg");
  if (!inputEl || !msgEl) return true;

  const value = inputEl.value.trim();
  let errorMsg = "";

  if (fieldId === "slot_label") {
    if (!value) {
      errorMsg = "Slot label is required.";
    } else if (!/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(value)) {
      errorMsg = "Format must be HH:MM-HH:MM (e.g., 08:30-09:20).";
    }
  } else if (fieldId === "sort_order") {
    if (!value) {
      errorMsg = "Sort order is required.";
    } else {
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 1 || n > 10) {
        errorMsg = "Sort order must be between 1 and 10.";
      }
    }
  }

  msgEl.textContent = errorMsg;
  if (errorMsg) {
    inputEl.classList.add("input-error");
    return false;
  }
  inputEl.classList.remove("input-error");
  return true;
}


async function initTimeSlotsPage() {
  const table = document.getElementById("slotTable");
  if (!table) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
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

  // Live validation
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

    // Validate
    const okLabel = validateSlotField("slot_label");
    const okSort = validateSlotField("sort_order");
    if (!okLabel || !okSort) return;

    const payload = {
      slot_label: document.getElementById("slot_label").value.trim(),
      sort_order: parseInt(document.getElementById("sort_order").value.trim(), 10),
      is_active: document.getElementById("is_active").value === "true",
    };

    const url = editingSlotId
      ? API + "/time-slots/" + editingSlotId
      : API + "/time-slots";
    const method = editingSlotId ? "PUT" : "POST";

    const r = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();

    if (!r.ok) {
      const detail = data.detail || "Failed";

      // Map server error to the right field
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

  const res = await fetch(API + "/time-slots", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="4">Failed to load time slots</td></tr>`;
    return;
  }
  const slots = await res.json();

  document.getElementById("countLabel").textContent = `${slots.length} slot(s)`;

  if (slots.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#888;">No time slots yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = slots.map(s => `
    <tr data-slot-id="${s.id}">
      <td><b>${s.slot_label}</b></td>
      <td>${s.sort_order}</td>
      <td>
        <span class="badge ${s.is_active ? "badge-active" : "badge-inactive"}">
          ${s.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      ${slotIsAdmin ? `
        <td>
          <button class="btn-edit" onclick="editSlot(${s.id})">Edit</button>
          <button class="btn-del" onclick="deleteSlot(${s.id})">Delete</button>
        </td>
      ` : `<td></td>`}
    </tr>
  `).join("");
}

async function editSlot(id) {
  const res = await fetch(API + "/time-slots", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
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
  const ok = await showConfirm(
    "Delete Time Slot",
    "Are you sure you want to delete this time slot? This cannot be undone."
  );
  if (!ok) return;

  const res = await fetch(API + "/time-slots/" + id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  const data = await res.json();
  if (!res.ok) {
    showNotice(data.detail || "Delete failed", "error");
    return;
  }
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

  // Clear old highlights
  document.querySelectorAll("#slotTable tr").forEach(tr => {
    tr.classList.remove("row-error");
  });

  const res = await fetch(API + "/time-slots/validate", {
    headers: { "Authorization": "Bearer " + getToken() },
  });

  if (!res.ok) {
    resultEl.style.color = "#dc2626";
    resultEl.textContent = "Failed to validate";
    return;
  }

  const data = await res.json();

  // Highlight bad rows
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
    const iconMap = {
      overlap: "⛔",
      duplicate_sort: "🔁",
      order_mismatch: "↕",
      invalid_format: "⚠",
    };
    const icon = iconMap[i.type] || "⚠";
    return `
      <div class="issue-card">
        <div class="icon">${icon}</div>
        <div class="body">
          <span class="type-tag">${i.type.replace("_", " ")}</span>
          <span class="msg">${i.message}</span>
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
    if (!value) {
      errorMsg = "Program code is required.";
    } else if (!/^\d{4}$/.test(value)) {
      errorMsg = "Program code must be 4 digits (e.g., 0105).";
    }
  } else if (fieldId === "program_name") {
    if (!value) {
      errorMsg = "Program name is required.";
    }
  } else if (fieldId === "department_id") {
    if (!value) {
      errorMsg = "Please select a department.";
    }
  }

  msgEl.textContent = errorMsg;
  if (errorMsg) {
    el.classList.add("input-error");
    return false;
  }
  el.classList.remove("input-error");
  return true;
}


async function initProgramsPage() {
  const table = document.getElementById("programTable");
  if (!table) return;

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const meRes = await fetch(API + "/auth/me", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (!meRes.ok) {
    localStorage.clear();
    window.location.href = "/login.html";
    return;
  }
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

  // Load departments
  try {
    const deptRes = await fetch(API + "/programs/departments", {
      headers: { "Authorization": "Bearer " + token },
    });
    if (deptRes.ok) {
      const depts = await deptRes.json();
      const sel = document.getElementById("department_id");
      if (sel) {
        sel.innerHTML = `<option value="">-- Select department --</option>` +
          depts.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
      }
    }
  } catch (e) {
    console.error("Failed to load departments", e);
  }

  const form = document.getElementById("programForm");

  // Live validation
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

  // Submit
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
    };

    const url = editingProgramId
      ? API + "/programs/" + editingProgramId
      : API + "/programs";
    const method = editingProgramId ? "PUT" : "POST";

    const r = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();

    if (!r.ok) {
      const detail = data.detail || "Failed";
      if (detail.toLowerCase().includes("code")) {
        document.getElementById("program_codeMsg").textContent = detail;
        document.getElementById("program_code").classList.add("input-error");
      } else if (detail.toLowerCase().includes("name")) {
        document.getElementById("program_nameMsg").textContent = detail;
        document.getElementById("program_name").classList.add("input-error");
      } else {
        formMsg.style.color = "#dc2626";
        formMsg.textContent = detail;
      }
      return;
    }

    formMsg.style.color = "#16a34a";
    formMsg.textContent = editingProgramId ? "Program updated" : "Program created";
    showNotice(editingProgramId ? "Program updated" : "Program created", "success");

    editingProgramId = null;
    document.getElementById("formSubmitBtn").textContent = "Save Program";
    document.getElementById("formTitle").textContent = "Add Program";
    form.reset();

    ["program_code", "program_name", "department_id"].forEach((id) => {
      const msgEl = document.getElementById(id + "Msg");
      if (msgEl) msgEl.textContent = "";
      const inputEl = document.getElementById(id);
      if (inputEl) inputEl.classList.remove("input-error");
    });

    loadPrograms();
  });

  loadPrograms();
}


async function loadPrograms() {
  const tbody = document.getElementById("programTable");
  if (!tbody) return;

  const res = await fetch(API + "/programs", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="5">Failed to load programs</td></tr>`;
    return;
  }
  const programs = await res.json();

  document.getElementById("countLabel").textContent = `${programs.length} program(s)`;

  if (programs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#888;">No programs yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = programs.map(p => `
    <tr>
      <td><span class="badge-code">${p.program_code}</span></td>
      <td><b>${p.program_name}</b></td>
      <td><span class="badge-dept">${p.department_name || "-"}</span></td>
      <td>${p.group_count}</td>
      ${programIsAdmin ? `
        <td>
          <button class="btn-edit" onclick="editProgram(${p.id})">Edit</button>
          <button class="btn-del" onclick="deleteProgram(${p.id})">Delete</button>
        </td>
      ` : `<td></td>`}
    </tr>
  `).join("");
}


async function editProgram(id) {
  const res = await fetch(API + "/programs", {
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) return;
  const list = await res.json();
  const p = list.find(x => x.id === id);
  if (!p) return;

  document.getElementById("program_code").value = p.program_code;
  document.getElementById("program_name").value = p.program_name;
  document.getElementById("department_id").value = p.department_id;

  editingProgramId = id;
  document.getElementById("formTitle").textContent = "Edit Program";
  document.getElementById("formSubmitBtn").textContent = "Update Program";
  window.scrollTo({ top: 0, behavior: "smooth" });
}


async function deleteProgram(id) {
  const ok = await showConfirm(
    "Delete Program",
    "Are you sure you want to delete this program? This cannot be undone."
  );
  if (!ok) return;

  const res = await fetch(API + "/programs/" + id, {
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
// Shared Sidebar
// ============================================================

const SIDEBAR_ITEMS = [
  // ---- Sprint 1 ----
  { href: "/dashboard.html",        label: "Dashboard",             roles: ["admin", "teacher", "student"], sprint: 1 },
  { href: "/availability.html",     label: "My Availability",       roles: ["admin", "teacher"],            sprint: 1 },
  { href: "/rooms.html",            label: "Manage Rooms",          roles: ["admin"],                       sprint: 1 },
  { href: "/teachers.html",         label: "Manage Faculty",        roles: ["admin"],                       sprint: 1 },
  { href: "/courses.html",          label: "Manage Curriculum",     roles: ["admin"],                       sprint: 1 },

  // ---- Sprint 2 ----
  { href: "/programs.html",         label: "Manage Programs",       roles: ["admin"],                       sprint: 2 },
  { href: "/semesters.html",        label: "Manage Semesters",      roles: ["admin"],                       sprint: 2 },
  { href: "/student-groups.html",   label: "Manage Student Groups", roles: ["admin"],                       sprint: 2 },
  { href: "/time-slots.html",       label: "Manage Time Slots",     roles: ["admin"],                       sprint: 2 },
  { href: "/constraints.html",      label: "Hard Constraints",      roles: ["admin"],                       sprint: 2 },
  { href: "/soft-constraints.html", label: "Soft Constraints",      roles: ["admin"],                       sprint: 2 },

  // ---- Sprint 3 (hidden until unlocked) ----
  { href: "/generator.html",        label: "AI Generator",          roles: ["admin"],                       sprint: 3 },
  { href: "/room-fitting.html",     label: "Room Fitting",          roles: ["admin"],                       sprint: 3 },

  // ---- Sprint 4 (hidden until unlocked) ----
  { href: "/schedule.html",         label: "Schedule Grid",         roles: ["admin", "teacher", "student"], sprint: 4 },
];

// Change this number to unlock more sprints.
// 2 = show only Sprint 1 + 2 (current demo)
// 3 = show Sprint 3 features too
// 4 = show everything (full system)
const CURRENT_SPRINT = 2;

const SIDEBAR_ACTIONS = [
  { action: "timetable", label: "View Timetable", roles: ["admin", "teacher", "student"] },
  { action: "export",    label: "Export",         roles: ["admin", "teacher"] },
  { action: "requests",  label: "Requests",       roles: ["admin"] },
];

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

  const visibleActions = SIDEBAR_ACTIONS.filter(hasRole);

  const actionsHTML = visibleActions.map(a =>
    `<button onclick="go('${a.action}')">${a.label}</button>`
  ).join("");

  mount.outerHTML = `
    <aside class="sidebar">
      <div class="brand">Timetable System</div>
      <h3>Navigation</h3>
      ${navHTML}
      <h3>Actions</h3>
      ${actionsHTML}
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
});