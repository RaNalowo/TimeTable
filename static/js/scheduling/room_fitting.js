// static/js/scheduling/room_fitting.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

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

document.addEventListener("DOMContentLoaded", initRoomFittingPage);
