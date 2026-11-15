// static/js/scheduling/generator.js
// Page script.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

let generatorAIStatus = null;

let generatorIsAdmin = false;

let generationInProgress = false;

function updateGenerationMode() {
  const mode = document.getElementById("generationMode").value;
  const ai = mode === "ai_assisted";
  const status = document.getElementById("aiConnectionStatus");
  document.getElementById("aiPreferences").disabled = !ai || generationInProgress;
  document.getElementById("aiDataNotice").style.display = ai ? "block" : "none";
  document.getElementById("generationMode").disabled = generationInProgress;
  const ready = generatorAIStatus && generatorAIStatus.configured;
  document.getElementById("generateBtn").disabled = !generatorIsAdmin || generationInProgress || (ai && !ready);
  if (!ai) {
    status.textContent = "Algorithm only: no AI model will be called. This mode uses the configured soft-constraint weights.";
  } else if (!generatorAIStatus) {
    status.textContent = "AI configuration is unavailable. Retry the page or choose Algorithm only.";
  } else if (!ready) {
    status.textContent = "AI is not configured yet. Configure the server API key, then restart and reload. Algorithm only is available separately.";
  } else {
    status.textContent = `AI configured: ${generatorAIStatus.provider} / ${generatorAIStatus.model}. Model access is verified when you generate; a successful call may incur API charges.`;
  }
}

function renderGenerationMethod(generation) {
  const panel = document.getElementById("aiDecisionPanel");
  const box = document.getElementById("aiDecisionBox");
  panel.style.display = "block";
  if (!generation) {
    box.textContent = "This saved draft has no recorded AI selection. Generate in AI-assisted mode to record model usage.";
    return;
  }
  if (!generation.ai_used) {
    box.textContent = "Algorithm only. No AI model was used for this draft.";
    return;
  }
  const selection = generation.selection;
  const candidates = generation.candidates || [];
  box.innerHTML = `
    <p><b>AI used:</b> ${escapeHTML(selection.provider)} / ${escapeHTML(selection.model)}</p>
    <p><b>Selected:</b> ${escapeHTML(selection.candidate_id)}</p>
    <p><b>Reason:</b> ${escapeHTML(selection.reason)}</p>
    <p><b>Preferences:</b> ${escapeHTML(generation.preferences || "Use configured preferences")}</p>
    ${(selection.tradeoffs || []).length ? `<p><b>Tradeoffs:</b> ${selection.tradeoffs.map(escapeHTML).join("; ")}</p>` : ""}
    <p style="font-size:12px;color:#666;">Only candidates with the highest placement count were eligible for AI selection. Scores are soft-preference measures. The model selects from measured candidates; it does not guarantee an optimal timetable.</p>
    <div style="overflow-x:auto;"><table>
      <thead><tr><th>Candidate</th><th>Strategy</th><th>Coverage</th><th>Score</th><th>Early</th><th>Late</th><th>Gap slots</th><th>Avg days per subgroup</th><th>Selected</th></tr></thead>
      <tbody>${candidates.map(c => `<tr>
        <td>${escapeHTML(c.candidate_id)}</td><td>${escapeHTML(c.strategy)}</td>
        <td>${escapeHTML(c.coverage)}%</td><td>${escapeHTML(c.score)}</td>
        <td>${escapeHTML(c.early_sessions)}</td><td>${escapeHTML(c.late_sessions)}</td>
        <td>${escapeHTML(c.gap_slots)}</td><td>${escapeHTML(c.average_days_per_subgroup)}</td>
        <td>${c.candidate_id === selection.candidate_id ? "AI selected" : "—"}</td>
      </tr>`).join("")}</tbody>
    </table></div>
  `;
}

async function initGeneratorPage() {
  const btn = document.getElementById("generateBtn");
  if (!btn) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  const isAdmin = me.roles.includes("admin");
  generatorIsAdmin = isAdmin;

  if (!isAdmin) { btn.disabled = true; btn.textContent = "Admin only"; return; }

  const aiRes = await apiFetch(API + "/generator/ai-status", {
    headers: { "Authorization": "Bearer " + token },
  });
  generatorAIStatus = aiRes.ok ? await aiRes.json() : null;
  updateGenerationMode();
  await loadExistingEntries();
  const lastRun = await apiFetch(API + "/generator/last-run", {
    headers: { "Authorization": "Bearer " + token },
  });
  if (lastRun.ok) renderGenerationMethod((await lastRun.json()).generation);
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

  const mode = document.getElementById("generationMode").value;
  const preferences = mode === "ai_assisted" ? document.getElementById("aiPreferences").value.trim() : "";
  generationInProgress = true;
  updateGenerationMode();
  btn.disabled = true;
  statusBanner.style.display = "none";
  progressWrap.style.display = "block";
  progressFill.style.width = "0%";
  progressFill.style.background = "#2563eb";
  progressText.textContent = mode === "ai_assisted" ? "Building and checking candidates, then asking AI to select..." : "Building timetable with the algorithm only...";

  let pct = 0;
  const timer = setInterval(() => {
    pct = Math.min(pct + 5, 90);
    progressFill.style.width = pct + "%";
  }, 200);

  try {
    const res = await apiFetch(API + "/generator/generate", {
      method: "POST",
      headers: { "Authorization": "Bearer " + getToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ mode, preferences }),
    });
    const data = await res.json();
    clearInterval(timer);

    if (!res.ok) {
      progressFill.style.width = "100%";
      progressFill.style.background = "#dc2626";
      progressText.textContent = "Failed.";
      showStatusBanner("error", data.detail || "Generation failed");
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
    renderGenerationMethod(data.generation);
  } catch (e) {
    clearInterval(timer);
    progressFill.style.width = "100%";
    progressFill.style.background = "#dc2626";
    progressText.textContent = "Network error";
    showStatusBanner("error", "Network error");
  } finally {
    clearInterval(timer);
    generationInProgress = false;
    updateGenerationMode();
  }
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

document.addEventListener("DOMContentLoaded", initGeneratorPage);
