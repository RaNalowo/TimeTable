// static/js/core/dashboard.js
// Dashboard page (role dashboards + admin 'Add User' form).
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

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

document.addEventListener("DOMContentLoaded", initDashboard);
