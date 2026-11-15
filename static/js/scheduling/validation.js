// static/js/scheduling/validation.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

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

document.addEventListener("DOMContentLoaded", initValidationPage);
