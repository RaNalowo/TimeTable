// static/js/master_data/time_slots.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

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

document.addEventListener("DOMContentLoaded", initTimeSlotsPage);
