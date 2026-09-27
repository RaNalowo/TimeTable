const API = "";  // 前后端同源

// ---------- 存储 ----------
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

// ---------- 登出 ----------
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

// ---------- 登录页 ----------
function initLoginPage() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("error");
    err.textContent = "";

    const identifier = document.getElementById("identifier").value.trim();
    const password = document.getElementById("password").value;

    try {
      const res = await fetch(API + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        err.textContent = data.detail || "Login failed";
        return;
      }

      saveToken(data.access_token, data.user);
      window.location.href = "/dashboard.html";
    } catch (e) {
      err.textContent = "Network error";
    }
  });
}

// ---------- 仪表盘 ----------
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

// ---------- 管理员：加载用户列表 ----------
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

// ---------- 快捷操作占位 ----------
function go(page) {
  alert("Navigate to: " + page + " (not implemented yet)");
}

// ---------- 忘记密码 ----------
function initForgotPage() {
  const form = document.getElementById("forgotForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const msg = document.getElementById("message");
    msg.textContent = "";

    const res = await fetch(API + "/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    msg.textContent = data.message || "Check your email.";
  });
}

// ---------- 重置密码 ----------
function initResetPage() {
  const form = document.getElementById("resetForm");
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const new_password = document.getElementById("newPassword").value;
    const msg = document.getElementById("message");
    msg.textContent = "";

    const res = await fetch(API + "/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, new_password }),
    });
    const data = await res.json();
    msg.textContent = data.message || data.detail || "Done";
  });
}

// ---------- 通用：字段高亮 ----------
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
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("formMsg");
      msg.textContent = "";

      const payload = {
        campus: document.getElementById("campus").value.trim() || null,
        building: document.getElementById("building").value.trim(),
        room_code: document.getElementById("room_code").value.trim(),
        capacity: parseInt(document.getElementById("capacity").value, 10),
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
        msg.style.color = "#dc2626";
        msg.textContent = data.detail || "Failed";
        if ((data.detail || "").toLowerCase().includes("already exists")) {
          highlightField("room_code");
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
  if (!confirm("Delete this room?")) return;

  const res = await fetch(API + "/rooms/" + id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.detail || "Delete failed");
    return;
  }
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
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("formMsg");
      msg.textContent = "";

      const payload = {
        full_name: document.getElementById("full_name").value.trim(),
        email: document.getElementById("email").value.trim(),
        academic_title: document.getElementById("academic_title").value.trim() || null,
        department: document.getElementById("department").value.trim(),
        max_weekly_hours: parseInt(document.getElementById("max_weekly_hours").value, 10),
        max_daily_hours: parseInt(document.getElementById("max_daily_hours").value, 10),
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
        msg.style.color = "#dc2626";

        if (r.status === 422 && Array.isArray(data.detail)) {
          const field = data.detail[0].loc[data.detail[0].loc.length - 1];
          if (field === "max_weekly_hours") {
            msg.textContent = "Maximum teaching hours cannot exceed 40 hours per week";
            highlightField("max_weekly_hours");
          } else if (field === "max_daily_hours") {
            msg.textContent = "Maximum daily hours must be between 1 and 12";
            highlightField("max_daily_hours");
          } else {
            msg.textContent = data.detail[0].msg;
          }
        } else {
          msg.textContent = data.detail || "Failed";
          if ((data.detail || "").toLowerCase().includes("email")) {
            highlightField("email");
          }
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
  if (!confirm("Delete this faculty profile?")) return;

  const res = await fetch(API + "/teachers/" + id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.detail || "Delete failed");
    return;
  }
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

  // 加载学生组到 checkbox 列表
  try {
    const groupsRes = await fetch(API + "/student-groups", {
      headers: { "Authorization": "Bearer " + token },
    });
    const groups = await groupsRes.json();
    const groupList = document.getElementById("groupList");
    if (groupList) {
      groupList.innerHTML = groups.map(g => `
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" class="group-check" value="${g.group_code}" />
          ${g.group_code}
        </label>
      `).join("");
    }
  } catch (e) {
    console.error("Failed to load student groups", e);
  }

  const form = document.getElementById("courseForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("formMsg");
      msg.textContent = "";

      const payload = {
        course_code: document.getElementById("course_code").value.trim(),
        course_name: document.getElementById("course_name").value.trim(),
        credits: parseInt(document.getElementById("credits").value, 10),
        semester_level: document.getElementById("semester_level").value.trim() || null,
        total_hours: parseInt(document.getElementById("total_hours").value, 10),
        lecture_hours: parseInt(document.getElementById("lecture_hours").value, 10),
        practice_hours: parseInt(document.getElementById("practice_hours").value, 10),
        lab_hours: parseInt(document.getElementById("lab_hours").value, 10),
        target_groups: Array.from(document.querySelectorAll(".group-check:checked"))
          .map(cb => cb.value).join(", ") || null,
        department: document.getElementById("department").value.trim() || null,
      };

      const sum = payload.lecture_hours + payload.practice_hours + payload.lab_hours;
      if (sum !== payload.total_hours) {
        msg.style.color = "#dc2626";
        msg.textContent = `Total session hours (${sum}) exceed course credit limit (${payload.total_hours})`;
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
        if (detail.toLowerCase().includes("hour") || detail.toLowerCase().includes("exceed")) {
          ["lecture_hours", "practice_hours", "lab_hours", "total_hours"].forEach(highlightField);
        }
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

  // 回填学生组勾选
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
  if (!confirm("Delete this course?")) return;

  const res = await fetch(API + "/courses/" + id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + getToken() },
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.detail || "Delete failed");
    return;
  }
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
// Teacher Availability Preference
// ============================================================

let availConfig = { days: [], time_slots: [], slot_hours: 1.5 };
let availMatrix = {};
let availFrozen = false;
let availMaxHours = 20;
let availIsAdmin = false;
let availIsTeacher = false;

const CYCLE = ["preferred", "neutral", "blocked"];

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

  renderGrid();
  updateStats();
}

function renderGrid() {
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

  const current = CYCLE.find(s => td.classList.contains(s)) || "neutral";
  const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];

  CYCLE.forEach(s => td.classList.remove(s));
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
  renderGrid();
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
// Shared Sidebar (所有页面共用)
// ============================================================

const SIDEBAR_ITEMS = [
  { href: "/dashboard.html",   label: "Dashboard" },
  { href: "/rooms.html",       label: "Manage Rooms" },
  { href: "/teachers.html",    label: "Manage Faculty" },
  { href: "/courses.html",     label: "Manage Curriculum" },
  { href: "/availability.html", label: "My Availability" },
];

const SIDEBAR_ACTIONS = [
  { action: "timetable", label: "View Timetable" },
  { action: "export",    label: "Export" },
  { action: "requests",  label: "Requests" },
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
  // 只在有 sidebar-mount 的页面渲染
  const mount = document.getElementById("sidebar-mount");
  if (!mount) return;

  // 注入 CSS（只注入一次）
  if (!document.getElementById("sidebar-style")) {
    const style = document.createElement("style");
    style.id = "sidebar-style";
    style.textContent = SIDEBAR_CSS;
    document.head.appendChild(style);
  }

  const current = window.location.pathname;

  const navHTML = SIDEBAR_ITEMS.map(item => {
    const isActive = current === item.href;
    return `<button class="${isActive ? "active" : ""}"
             onclick="window.location.href='${item.href}'">${item.label}</button>`;
  }).join("");

  const actionsHTML = SIDEBAR_ACTIONS.map(a =>
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

// ---------- 页面初始化 ----------
document.addEventListener("DOMContentLoaded", () => {
  renderSidebar();
  initLoginPage();
  initDashboard();
  initForgotPage();
  initResetPage();
  initRoomsPage();
  initTeachersPage();
  initCoursesPage();
  initAvailabilityPage();
});