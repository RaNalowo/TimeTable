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

// ============================================================
// Manage Campus Rooms
// ============================================================

let editingRoomId = null;
let isAdmin = false;

async function initRoomsPage() {
  const table = document.getElementById("roomTable");
  if (!table) return;  // 不是 rooms 页面

  const token = getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  // 1. 判断当前用户是否 admin
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

  // 2. 加载房间类型下拉
  const typesRes = await fetch(API + "/rooms/types");
  const types = await typesRes.json();
  const typeSelect = document.getElementById("room_type");
  if (typeSelect) {
    typeSelect.innerHTML = types.map(t => `<option value="${t}">${t}</option>`).join("");
  }

  // 3. 权限控制：非管理员隐藏表单和操作列
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

  // 4. 表单提交
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

// ---------- 页面初始化 ----------
document.addEventListener("DOMContentLoaded", () => {
  initLoginPage();
  initDashboard();
  initForgotPage();
  initResetPage();
  initRoomsPage();
});