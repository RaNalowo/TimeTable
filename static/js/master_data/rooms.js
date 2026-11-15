// static/js/master_data/rooms.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

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

document.addEventListener("DOMContentLoaded", initRoomsPage);
