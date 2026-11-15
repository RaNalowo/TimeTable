// static/js/scheduling/schedule.js
let scheduleData = { days: [], time_slots: [], cells: [], conflicts: [] };
let roomsCache = [];
let currentMoveEntry = null;
let scheduleIsAdmin = false;
let draggingEntryId = null;
let pendingSwap = null;
let scheduleGroupsCache = [];
let currentProgramFilter = "all";
let currentViewMode = "weekly";
let currentDayFilter = "Mon";
let currentRequestEntryId = null;
let autoScrollTimer = null;

function getProgramForGroup(groupCode) {
  if (!groupCode) return null;
  const baseCode = groupCode.split("-")[0] + "-" + groupCode.split("-")[1] + "-" + groupCode.split("-")[2];
  const g = scheduleGroupsCache.find(x => x.group_code === baseCode);
  return g ? g.program : null;
}

async function refreshGrid() {
  const res = await apiFetch(API + "/conflicts/grid", { headers: { "Authorization": "Bearer " + getToken() } });
  if (!res.ok) { console.error("Failed to load grid"); return; }
  scheduleData = await res.json();

  const statusBadge = document.getElementById("publishStatus");
  const publishBtn = document.getElementById("publishBtn");

  if (scheduleIsAdmin) {
      publishBtn.style.display = "inline-block";
      if (scheduleData.published) {
          publishBtn.style.display = "none";
          statusBadge.style.display = "inline-block";
          statusBadge.className = "badge";
          statusBadge.style.background = "#dcfce7";
          statusBadge.style.color = "#166534";
          statusBadge.textContent = "✅ Published";
      } else {
          statusBadge.style.display = "inline-block";
          statusBadge.className = "badge";
          statusBadge.style.background = "#fef3c7";
          statusBadge.style.color = "#92400e";
          statusBadge.textContent = "📝 Draft (Unpublished)";
      }
      loadChangeRequests();
  } else {
      publishBtn.style.display = "none";
  }

  renderScheduleGrid();
  renderConflicts();
  updateBanner();
}

async function rescanConflicts() {
  await refreshGrid();
}

async function publishTimetable() {
    const ok = await showConfirm("Publish Timetable", "Are you sure you want to publish this timetable? Students and teachers will be able to see it immediately.", "Publish");
    if (!ok) return;

    const res = await apiFetch(API + "/conflicts/publish", {
        method: "POST",
        headers: { "Authorization": "Bearer " + getToken() }
    });
    const data = await res.json();

    if (!res.ok) {
        showNotice(data.detail || "Publish failed.", "error");
        return;
    }

    showNotice("Timetable published successfully!", "success");
    await refreshGrid();
}

function onViewModeChange() {
    currentViewMode = document.getElementById("viewModeSelect").value;
    document.getElementById("dailyDaySelect").style.display = currentViewMode === "daily" ? "inline-block" : "none";
    renderScheduleGrid();
}

function onDailyDayChange() {
    currentDayFilter = document.getElementById("dailyDaySelect").value;
    renderScheduleGrid();
}

async function initSchedulePage() {
  const summaryEl = document.getElementById("summaryText");
  if (!summaryEl) return;
  const gridTable = document.getElementById("gridTable");
  if (!gridTable) return;

  const token = getToken();
  if (!token) { window.location.href = "/login.html"; return; }

  const meRes = await apiFetch(API + "/auth/me", { headers: { "Authorization": "Bearer " + token } });
  if (!meRes.ok) { localStorage.clear(); window.location.href = "/login.html"; return; }
  const me = await meRes.json();
  scheduleIsAdmin = me.roles.includes("admin");
  const isTeacher = me.roles.includes("teacher");

  if (!scheduleIsAdmin) {
      const refreshBtn = document.getElementById("refreshBtn");
      const rescanBtn = document.getElementById("rescanBtn");
      const summaryText = document.getElementById("summaryText");
      const conflictsPanel = document.getElementById("conflictsPanel");

      if (refreshBtn) refreshBtn.style.display = "none";
      if (rescanBtn) rescanBtn.style.display = "none";
      if (summaryText) summaryText.style.display = "none";
      if (conflictsPanel) conflictsPanel.style.display = "none";

      if (!isTeacher) {
          const progFilter = document.getElementById("programFilterWrapper");
          if (progFilter) progFilter.style.display = "none";
      }
  } else {
      toggleRequestPanel(false);
  }

  const roomsRes = await apiFetch(API + "/rooms", { headers: { "Authorization": "Bearer " + token } });
  if (roomsRes.ok) roomsCache = await roomsRes.json();

  const groupsRes = await apiFetch(API + "/student-groups", { headers: { "Authorization": "Bearer " + token } });
  if (groupsRes.ok) scheduleGroupsCache = await groupsRes.json();

  try {
    const progRes = await apiFetch(API + "/programs", { headers: { "Authorization": "Bearer " + token } });
    if (progRes.ok) {
      const progs = await progRes.json();
      const sel = document.getElementById("programFilter");
      if (sel) {
        let opts = `<option value="all">All Programs</option>`;
        progs.forEach(p => { opts += `<option value="${p.program_name}">${p.program_name}</option>`; });
        sel.innerHTML = opts;
      }
    }
  } catch (e) { console.error("Failed to load programs", e); }

  const daySel = document.getElementById("moveDay");
  const slotSel = document.getElementById("moveSlot");
  daySel.innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `<option value="${d}">${d}</option>`).join("");

  const slotsRes = await apiFetch(API + "/time-slots/active", { headers: { "Authorization": "Bearer " + token } });
  const slots = slotsRes.ok ? await slotsRes.json() : [];
  slotSel.innerHTML = slots.map(s => `<option value="${s}">${s}</option>`).join("");

  document.getElementById("moveRoom").innerHTML = roomsCache.map(r => `<option value="${r.id}">${r.building} · ${r.room_code} (cap ${r.capacity})</option>`).join("");

  await refreshGrid();

  checkUserNotifications();
}

function onScheduleFilterChange() {
  const sel = document.getElementById("programFilter");
  if (sel) currentProgramFilter = sel.value;
  renderScheduleGrid();
}

function handleCardClick(e, entryId, day, slot) {
    if (scheduleIsAdmin) {
        openMoveModal(entryId, e.course_code, day, slot);
    } else {
        openDetailsModal(entryId, e.course_code, e.course_name, e.session_type, day, slot, e.room_code, e.teacher_name, e.target_groups);
    }
}

function renderScheduleGrid() {
  const table = document.getElementById("gridTable");
  const { days, time_slots, cells } = scheduleData;

  let renderDays = days;
  if (currentViewMode === "daily") {
      renderDays = [currentDayFilter];
      table.style.maxWidth = "600px";
  } else {
      table.style.maxWidth = "1200px";
  }

  let html = "<thead><tr><th>Time</th>";
  renderDays.forEach(d => html += `<th>${d}</th>`);
  html += "</tr></thead><tbody>";

  time_slots.forEach(slot => {
    html += `<tr><td class="slot-label">${slot}</td>`;
    renderDays.forEach(day => {
      const cell = cells.find(c => c.day === day && c.time_slot === slot);
      let entries = cell ? cell.entries : [];

      if (currentProgramFilter !== "all") {
        entries = entries.filter(e => {
          const prog = getProgramForGroup(e.target_groups);
          return prog === currentProgramFilter;
        });
      }

      html += `<td data-day="${day}" data-slot="${slot}"
             ondragover="onCellDragOver(event, '${day}', '${slot}')"
             ondragleave="onCellDragLeave(event)"
             ondrop="onCellDrop(event, '${day}', '${slot}')">`;

      if (entries.length === 0) {
        html += `<span style="color:#d1d5db;font-size:11px;">—</span>`;
      } else {
          entries.forEach(e => {
          const cls = e.has_conflict ? "conflict-error" : "";
          const entryJson = escapeHTML(JSON.stringify(e)).replace(/'/g, "&#39;");

          // ★ 新增：只有管理员才绑定鼠标悬浮事件
          const hoverEvents = scheduleIsAdmin ? `onmouseenter="showEntryTooltip(event, ${e.id})" onmouseleave="hideTooltip()"` : '';

          html += `
            <div class="entry-card ${cls}"
                 data-entry-id="${e.id}"
                 draggable="true"
                 ondragstart="onDragStart(event, ${e.id})"
                 ondragend="onDragEnd(event)"
                 onclick='handleCardClick(${entryJson}, ${e.id}, "${day}", "${slot}")'
                 ${hoverEvents}>
                       <span class="alert-icon">${e.has_conflict ? "⚠" : ""}</span>
              <div class="course">${escapeHTML(e.course_code)} <span class="type">${escapeHTML(e.session_type)}</span></div>
              <div class="meta" style="font-size:11px; color:#4b5563; margin-bottom:3px; white-space: normal; word-wrap: break-word; line-height: 1.2;">
                ${escapeHTML(e.course_name || '')}
              </div>
              <div class="meta">${escapeHTML(e.room_code)} · ${escapeHTML(e.teacher_name || "-")}</div>
              <div class="meta" style="font-size:10px;color:#888;">${escapeHTML(e.target_groups || "")}</div>
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

  const wrapper = document.getElementById("gridWrapper");
  let overlay = document.getElementById("notPublishedOverlay");

  if (!scheduleIsAdmin && !scheduleData.published) {
      if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "notPublishedOverlay";
          overlay.className = "not-published-overlay";
          overlay.innerHTML = `<div>🔒 Timetable Not Published</div><div style="font-size:14px; font-weight:normal;">The administrator is still reviewing the schedule.</div>`;
          wrapper.appendChild(overlay);
      }
  } else {
      if (overlay) overlay.remove();
  }

  const errors = scheduleData.error_count || 0;
  const warnings = scheduleData.warning_count || 0;
  const total = scheduleData.total_entries || 0;
  document.getElementById("summaryText").textContent = `${total} sessions · ${errors} error(s) · ${warnings} warning(s)`;
}

function updateBanner() {
  const banner = document.getElementById("alertBanner");
  const errors = scheduleData.error_count || 0;
  const warnings = scheduleData.warning_count || 0;

  if (errors > 0) {
    banner.className = "show error";
    banner.innerHTML = `<span class="count">${errors}</span><span>hard-constraint conflict(s) detected. Click any red session for details.</span>`;
  } else if (warnings > 0) {
    banner.className = "show warning";
    banner.innerHTML = `<span class="count">${warnings}</span><span>warning(s) detected. Review the reported issues before approval.</span>`;
  } else {
    banner.className = "show success";
    banner.innerHTML = `No conflicts detected by the current checks. Review coverage and preferences separately.`;
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
      <b>${escapeHTML(c.message)}</b>
      ${c.details.courses ? `Courses involved: ${escapeHTML(c.details.courses.join(", "))}` : c.details.course ? `Course: ${escapeHTML(c.details.course)}` : ""}
      ${c.details.excess ? ` · Over capacity by ${c.details.excess} students` : ""}
    </div>
  `).join("");
}

// ★ 彻底移除了 showEntryTooltip, moveTooltip, hideTooltip 函数

function openMoveModal(entryId, courseCode, day, slot) {
  if (!scheduleIsAdmin) return;
  currentMoveEntry = entryId;
  document.getElementById("moveEntryLabel").textContent = `${courseCode} (entry #${entryId})`;
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
  const res = await apiFetch(API + "/conflicts/entries/" + currentMoveEntry, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
    body: JSON.stringify({ day, time_slot, room_id }),
  });
  const data = await res.json();

  if (!res.ok) {
      showNotice(data.detail || "Move failed.", "error");
      return;
  }
  closeMoveModal();
  await refreshGrid();
}

function onDragStart(evt, entryId) {
  if (!scheduleIsAdmin) { evt.preventDefault(); return; }
  draggingEntryId = entryId;
  evt.dataTransfer.effectAllowed = "move";
  evt.dataTransfer.setData("text/plain", String(entryId));
  evt.currentTarget.classList.add("dragging");
}

function onDragEnd(evt) {
  stopAutoScroll();
  evt.currentTarget.classList.remove("dragging");
  document.querySelectorAll("td.drop-target, td.drop-target-occupied, td.drop-invalid")
    .forEach(td => td.classList.remove("drop-target", "drop-target-occupied", "drop-invalid"));
  draggingEntryId = null;
}

function onCellDragOver(evt, day, slot) {
  if (!draggingEntryId) return;
  evt.preventDefault();
  const td = evt.currentTarget;
  document.querySelectorAll("td.drop-target, td.drop-target-occupied, td.drop-invalid").forEach(el => el.classList.remove("drop-target", "drop-target-occupied", "drop-invalid"));

  const cell = scheduleData.cells.find(c => c.day === day && c.time_slot === slot);
  const entries = (cell && cell.entries) || [];

  let draggedEntry = null;
  for (const c of scheduleData.cells) {
    const found = c.entries.find(e => e.id === draggingEntryId);
    if (found) { draggedEntry = found; break; }
  }

  const hasSameGroup = draggedEntry && entries.some(e => e.target_groups === draggedEntry.target_groups);
  if (hasSameGroup) {
    td.classList.add("drop-target-occupied");
  } else {
    td.classList.add("drop-target");
  }
  evt.dataTransfer.dropEffect = "move";
}

function onCellDragLeave(evt) {
  evt.currentTarget.classList.remove("drop-target", "drop-target-occupied", "drop-invalid");
}

async function onCellDrop(evt, day, slot) {
  evt.preventDefault();
  stopAutoScroll();
  const draggedId = draggingEntryId;
  if (!draggedId) return;

  const td = evt.currentTarget;
  td.classList.remove("drop-target", "drop-target-occupied", "drop-invalid");

  let draggedEntry = null;
  for (const c of scheduleData.cells) {
    const found = c.entries.find(e => e.id === draggedId);
    if (found) { draggedEntry = found; break; }
  }
  if (!draggedEntry) return;

  const cell = scheduleData.cells.find(c => c.day === day && c.time_slot === slot);
  const entries = (cell && cell.entries) || [];

  // 如果拖到了自己原来的格子里，什么都不做
  if (entries.some(e => e.id === draggedId)) return;

  // 检查目标格子里有没有【同一个学生组】的课
  const hasSameGroup = entries.some(e => e.target_groups === draggedEntry.target_groups);

  if (!hasSameGroup) {
    // 如果没有同组的课，直接放进去（即使格子里有其他专业的课）
    await moveEntryToSlot(draggedId, day, slot);
  } else {
    // 如果有同组的课，为了避免直接撞车，弹窗提示交换
    const targetEntry = entries.find(e => e.target_groups === draggedEntry.target_groups);
    openSwapModal(draggedId, targetEntry.id, targetEntry.course_code, day, slot);
  }
}

async function moveEntryToSlot(entryId, day, time_slot) {
  try {
    const res = await apiFetch(API + "/conflicts/entries/" + entryId, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify({ day, time_slot }),
    });

    const data = await res.json();

    if (!res.ok) {
        showNotice(data.detail || "Move failed.", "error");
        await refreshGrid();
        return;
    }
    await refreshGrid();
  } catch (err) {
    showNotice("Failed to save change. Network error.", "error");
    await refreshGrid();
  }
}

function openSwapModal(draggedId, targetId, targetCourse, targetDay, targetSlot) {
  pendingSwap = { draggedId, targetId };
  const draggedCell = scheduleData.cells.find(c => c.entries.some(e => e.id === draggedId));
  const draggedEntry = draggedCell.entries.find(e => e.id === draggedId);

  document.getElementById("swapLineA").innerHTML = `<b>${escapeHTML(draggedEntry.course_code)}</b> — ${draggedCell.day} ${draggedCell.time_slot} · Room ${escapeHTML(draggedEntry.room_code)}`;
  document.getElementById("swapLineB").innerHTML = `<b>${escapeHTML(targetCourse)}</b> — ${targetDay} ${targetSlot} · Room ${escapeHTML(scheduleData.cells.find(c => c.entries.some(e => e.id === targetId)).entries.find(e => e.id === targetId).room_code)}`;

  document.getElementById("swapModal").classList.add("open");
}

function closeSwapModal() {
  pendingSwap = null;
  document.getElementById("swapModal").classList.remove("open");
}

async function confirmSwap() {
  if (!pendingSwap) return;
  try {
    const res = await apiFetch(API + "/conflicts/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
      body: JSON.stringify({ entry_id_a: pendingSwap.draggedId, entry_id_b: pendingSwap.targetId }),
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
// ★ Timetable Export (US25)
// ============================================================
function exportTimetable() {
    if (typeof html2pdf === "undefined") {
        showNotice("Export library failed to load. Please check your internet connection and refresh.", "error");
        console.error("html2pdf is not defined. CDN may be blocked or failed to load.");
        return;
    }

    const element = document.getElementById("print-area");
    if (!element) return;

    if (!scheduleData || !scheduleData.cells || scheduleData.cells.every(c => c.entries.length === 0)) {
        showNotice("No classes to export.", "info");
        return;
    }

    const printTitle = document.getElementById("print-title");
    const printDate = document.getElementById("print-date");
    if (printTitle && printDate) {
        printTitle.style.display = "block";
        printDate.textContent = new Date().toLocaleString();
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const userRole = scheduleIsAdmin ? "Admin" : "Personal";
    const filename = `Timetable_${userRole}_${dateStr}.pdf`;

    const opt = {
        margin:       10,
        filename:     filename,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak:    { mode: ['css', 'legacy'], avoid: ['tr', 'td', '.entry-card'] }
    };

    element.classList.add("exporting");
    element.style.background = "#ffffff";

    showNotice("Generating PDF, please wait...", "info");

    html2pdf().set(opt).from(element).save().then(() => {
        element.classList.remove("exporting");
        element.style.background = "";
        if (printTitle) printTitle.style.display = "none";
        showNotice("PDF exported successfully!", "success");
    }).catch(err => {
        console.error("PDF Export Error: ", err);
        element.classList.remove("exporting");
        element.style.background = "";
        if (printTitle) printTitle.style.display = "none";
        showNotice("Failed to generate PDF. Check browser console for details.", "error");
    });
}

// ============================================================
// ★ Change Requests - User Side (US24)
// ============================================================
function openDetailsModal(entryId, courseCode, courseName, sessionType, day, slot, roomCode, teacherName, targetGroups) {
    currentRequestEntryId = entryId;

    document.getElementById("detailCourseName").textContent = `${courseCode} - ${courseName}`;
    document.getElementById("detailType").textContent = sessionType.toUpperCase();
    document.getElementById("detailTime").textContent = `${day}, ${slot}`;
    document.getElementById("detailRoom").textContent = roomCode;
    document.getElementById("detailTeacher").textContent = teacherName || "-";
    document.getElementById("detailGroup").textContent = targetGroups || "All";

    document.getElementById("detailRequestBtn").setAttribute("data-course", courseCode);

    document.getElementById("detailsModal").classList.add("open");
}

function closeDetailsModal() {
    document.getElementById("detailsModal").classList.remove("open");
    currentRequestEntryId = null;
}

function startRequestFromDetails() {
    const courseCode = document.getElementById("detailRequestBtn").getAttribute("data-course");

    const entryIdToRequest = currentRequestEntryId;

    closeDetailsModal();

    currentRequestEntryId = entryIdToRequest;

    document.getElementById("reqEntryLabel").textContent = `For class: ${courseCode}`;
    document.getElementById("reqReason").value = "";
    document.getElementById("requestModal").classList.add("open");
}

function closeRequestModal() {
    currentRequestEntryId = null;
    document.getElementById("requestModal").classList.remove("open");
}

async function submitChangeRequest() {
    if (!currentRequestEntryId) return;
    const reason = document.getElementById("reqReason").value.trim();
    if (!reason) {
        showNotice("Please provide a reason.", "error");
        return;
    }

    const res = await apiFetch(API + "/conflicts/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
        body: JSON.stringify({ entry_id: currentRequestEntryId, reason })
    });
    const data = await res.json();

    if (!res.ok) {
        showNotice(data.detail || "Failed to submit request.", "error");
        return;
    }

    closeRequestModal();
    showNotice("Request submitted successfully! The admin will review it.", "success");
}

// ============================================================
// ★ Change Requests - Admin Side (US24)
// ============================================================
function toggleRequestPanel(show) {
    const panel = document.getElementById("adminRequestPanel");
    const toggleBtn = document.getElementById("reqToggleBtn");
    if (!panel || !toggleBtn) return;

    if (show) {
        panel.style.display = "block";
        toggleBtn.style.display = "none";
        loadChangeRequests();
    } else {
        panel.style.display = "none";
        toggleBtn.style.display = "flex";
    }
}

async function loadChangeRequests() {
    const res = await apiFetch(API + "/conflicts/requests", { headers: { "Authorization": "Bearer " + getToken() } });
    if (!res.ok) return;
    const reqs = await res.json();

    const countEl = document.getElementById("reqCount");
    const badgeEl = document.getElementById("reqBadge");
    const listEl = document.getElementById("reqList");

    if (countEl) countEl.textContent = reqs.length;

    if (badgeEl) {
        badgeEl.textContent = reqs.length;
        badgeEl.style.display = reqs.length > 0 ? "inline-flex" : "none";
    }

    if (!listEl) return;

    if (reqs.length === 0) {
        listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: #6b7280; font-size: 13px;">No pending requests.</div>`;
        return;
    }

    listEl.innerHTML = reqs.map(r => `
        <div class="req-card" style="cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''" onclick="locateScheduleEntry(${r.entry_id})" title="Click to locate in grid">
            <div class="title">${escapeHTML(r.course_code)} - ${escapeHTML(r.course_name)}</div>
            <div class="meta">From: <b>${escapeHTML(r.requester_name)}</b> (${escapeHTML(r.requester_role)})</div>
            <div class="meta">Current: ${escapeHTML(r.day)} ${escapeHTML(r.time_slot)} · Room ${escapeHTML(r.room_code)}</div>
            <div class="reason">"${escapeHTML(r.reason)}"</div>
            <div class="req-actions">
                <!-- ★ 加上 event.stopPropagation() 防止点击按钮时触发卡片定位 -->
                <button class="approve" onclick="event.stopPropagation(); handleRequest(${r.id}, 'approved')">Approve</button>
                <button class="reject" onclick="event.stopPropagation(); handleRequest(${r.id}, 'rejected')">Reject</button>
            </div>
        </div>
    `).join("");
}

async function handleRequest(reqId, status) {
    const res = await apiFetch(API + `/conflicts/requests/${reqId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
        body: JSON.stringify({ status })
    });
    const data = await res.json();

    if (!res.ok) {
        showNotice(data.detail || "Failed to update request.", "error");
        return;
    }

    showNotice(`Request ${status}.`, "success");
    loadChangeRequests();
}

// ★ 升级版：点击申请卡片，在课表里定位并高亮对应的课
function locateScheduleEntry(entryId) {
    // 1. 清除所有已经存在的高亮
    document.querySelectorAll('.highlight-entry').forEach(el => el.classList.remove('highlight-entry'));

    let needsRender = false;

    // 2. 强制恢复“周视图”和“全部专业”，防止被过滤掉
    if (currentViewMode !== 'weekly') {
        currentViewMode = 'weekly';
        document.getElementById("viewModeSelect").value = 'weekly';
        document.getElementById("dailyDaySelect").style.display = "none";
        needsRender = true;
    }
    if (currentProgramFilter !== "all") {
        currentProgramFilter = "all";
        document.getElementById("programFilter").value = "all";
        needsRender = true;
    }
    if (needsRender) {
        renderScheduleGrid();
    }

    // 3. 寻找对应 id 的卡片
    const el = document.querySelector(`[data-entry-id="${entryId}"]`);

    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-entry');
        setTimeout(() => el.classList.remove('highlight-entry'), 3000);
    } else {
        // ★ 4. 如果没找到，说明页面数据可能过期了，强制刷新一次再找
        showNotice("Locating class...", "info");
        refreshGrid().then(() => {
            const newEl = document.querySelector(`[data-entry-id="${entryId}"]`);
            if (newEl) {
                newEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                newEl.classList.add('highlight-entry');
                setTimeout(() => newEl.classList.remove('highlight-entry'), 3000);
            } else {
                showNotice("This class has been updated or removed from the latest timetable. Please reject this request.", "warning");
            }
        });
    }
}

// ============================================================
// ★ User Notification System
// ============================================================
let currentNotifications = [];

async function checkUserNotifications() {
    if (scheduleIsAdmin) return; // 管理员不需要这个

    const res = await apiFetch(API + "/conflicts/requests/notifications", {
        headers: { "Authorization": "Bearer " + getToken() }
    });
    if (!res.ok) return;

    currentNotifications = await res.json();
    if (currentNotifications.length > 0) {
        showUserNotification();
    }
}

function showUserNotification() {
    const banner = document.getElementById("userNotificationBanner");
    const content = document.getElementById("userNotificationContent");
    if (!banner || !content) return;

    // 只显示第一条通知，避免太长
    const n = currentNotifications[0];
    const isApproved = n.status === "approved";

    const statusText = isApproved
        ? `<span style="color:#16a34a; font-weight:bold;">APPROVED</span>`
        : `<span style="color:#dc2626; font-weight:bold;">REJECTED</span>`;

    const adminNote = n.admin_note ? `<br><span style="font-size:12px; color:#64748b;">Admin note: ${escapeHTML(n.admin_note)}</span>` : '';

    content.innerHTML = `Your request for <b>${escapeHTML(n.course80_code)} - ${escapeHTML(n.course_name)}</b> has been ${statusText}.${adminNote}`;

    banner.style.display = "flex";
}

async function dismissNotification() {
    const banner = document.getElementById("userNotificationBanner");
    if (banner) banner.style.display = "none";

    if (currentNotifications.length === 0) return;

    // 把第一条标记为已读
    const n = currentNotifications[0];
    await apiFetch(API + `/conflicts/requests/${n.id}/read`, {
        method: "PUT",
        headers: { "Authorization": "Bearer " + getToken() }
    });

    // 从数组中移除，如果还有下一条，继续弹
    currentNotifications.shift();
    if (currentNotifications.length > 0) {
        showUserNotification();
    }
}

// ============================================================
// ★ Admin 专属冲突提示框
// ============================================================
function showEntryTooltip(evt, entryId) {
  // 双重保险：非管理员直接 return
  if (!scheduleIsAdmin) return;

  const tt = document.getElementById("tooltip");
  const cell = scheduleData.cells.find(c => c.entries.some(e => e.id === entryId));
  if (!cell) return;

  const entry = cell.entries.find(e => e.id === entryId);
  const conflicts = (scheduleData.conflicts || []).filter(c => c.entry_ids.includes(entryId));

  // 只有有冲突的时候才显示这个黑框，或者你想一直显示基础信息也可以
  if (conflicts.length === 0) return;

  let html = `
    <div class="tt-title">${escapeHTML(entry.course_code)} · ${escapeHTML(entry.session_type)}</div>
    <div class="tt-row"><span class="tt-label">Room</span>${escapeHTML(entry.room_code)}</div>
    <div class="tt-row"><span class="tt-label">Teacher</span>${escapeHTML(entry.teacher_name || "-")}</div>
    <div class="tt-row"><span class="tt-label">Groups</span>${escapeHTML(entry.target_groups || "-")}</div>
  `;

  if (conflicts.length > 0) {
    html += `<div class="tt-row" style="margin-top:8px;border-top:1px solid #374151;padding-top:6px;">`;
    conflicts.forEach(c => { html += `<div style="color:#fca5a5;">⚠ ${escapeHTML(c.message)}</div>`; });
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
  if (x + rect.width > window.innerWidth - 8) { x = evt.clientX - rect.width - padding; }
  if (y + rect.height > window.innerHeight - 8) { y = evt.clientY - rect.height - padding; }
  tt.style.left = x + "px";
  tt.style.top = y + "px";
}

function hideTooltip() {
    const tt = document.getElementById("tooltip");
    if (tt) tt.style.display = "none";
}
// ============================================================
// ★ 拖拽时边缘自动滚动
// ============================================================
function startAutoScroll(direction, speed) {
    if (autoScrollTimer) return;
    autoScrollTimer = setInterval(() => {
        window.scrollBy(0, direction * speed);
    }, 16); // 约 60fps 平滑滚动
}

function stopAutoScroll() {
    if (autoScrollTimer) {
        clearInterval(autoScrollTimer);
        autoScrollTimer = null;
    }
}

// 全局监听拖拽移动事件
document.addEventListener("dragover", function(e) {
    if (!draggingEntryId) return; // 只有正在拖拽卡片时才生效

    const threshold = 120; // 距离屏幕上下边缘多少像素时触发滚动（120px）
    const speed = 15;      // 滚动速度，数字越大滚得越快
    const y = e.clientY;
    const windowHeight = window.innerHeight;

    if (y < threshold) {
        // 靠近顶部，向上滚
        startAutoScroll(-1, speed);
    } else if (y > windowHeight - threshold) {
        // 靠近底部，向下滚
        startAutoScroll(1, speed);
    } else {
        // 在屏幕中间，停止滚动
        stopAutoScroll();
    }
});

// 防止在边缘外放手时还在滚
document.addEventListener("dragleave", stopAutoScroll);
document.addEventListener("drop", stopAutoScroll);

document.addEventListener("DOMContentLoaded", initSchedulePage);