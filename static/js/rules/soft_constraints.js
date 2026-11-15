// static/js/rules/soft_constraints.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

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

document.addEventListener("DOMContentLoaded", initSoftConstraintsPage);
