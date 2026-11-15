// static/js/core/ui.js
// Core: shared UI helpers (confirm dialog, notice bar, field highlight).
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

// ---------- Field Highlight ----------
function highlightField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.border = "2px solid #dc2626";
  setTimeout(() => { el.style.border = "1px solid #ccc"; }, 2000);
}

// Create the shared notice bar and confirm dialog on demand, so pages do not have to copy their HTML.
function ensureGlobalUi() {
  if (!document.getElementById("pageNotice")) {
    const notice = document.createElement("div");
    notice.id = "pageNotice";
    notice.style.cssText = "display:none; position:fixed; top:20px; left:50%; transform:translateX(-50%); " +
      "padding:12px 20px; border-radius:8px; z-index:3000; box-shadow:0 4px 12px rgba(0,0,0,0.15); " +
      "font-size:14px; font-weight:600;";
    document.body.appendChild(notice);
  }
  if (!document.getElementById("confirmModal")) {
    const modal = document.createElement("div");
    modal.id = "confirmModal";
    modal.style.cssText = "display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:2500; " +
      "align-items:center; justify-content:center;";
    modal.innerHTML = `
      <div style="background:#fff; padding:24px; border-radius:12px; width:380px; max-width:90%; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
        <h3 id="confirmTitle" style="margin-top:0; font-size:18px;">Confirm</h3>
        <p id="confirmText" style="font-size:14px; color:#555; margin:12px 0 24px;"></p>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button onclick="closeConfirm(false)" style="padding:8px 16px; background:#f3f4f6; color:#374151; border:none; border-radius:6px; cursor:pointer; font-size:14px;">Cancel</button>
          <button id="confirmBtn" onclick="closeConfirm(true)" style="padding:8px 16px; background:#dc2626; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:14px;">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
}

let confirmResolver = null;

function showConfirm(title, text, confirmLabel = "Delete") {
  ensureGlobalUi();
  return new Promise((resolve) => {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmText").textContent = text;
    document.getElementById("confirmBtn").textContent = confirmLabel;
    document.getElementById("confirmBtn").style.background = confirmLabel === "Delete" ? "#dc2626" : "#8b5cf6";
    document.getElementById("confirmModal").style.display = "flex";
    confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  document.getElementById("confirmModal").style.display = "none";
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

function showNotice(message, type = "info") {
  ensureGlobalUi();
  const el = document.getElementById("pageNotice");
  if (!el) return;

  const colors = {
    info:    { bg: "#dbeafe", color: "#1e40af" },
    success: { bg: "#dcfce7", color: "#166534" },
    error:   { bg: "#fee2e2", color: "#991b1b" },
  };
  const c = colors[type] || colors.info;

  el.textContent = message;
  el.style.background = c.bg;
  el.style.color = c.color;
  el.style.display = "block";

  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.style.display = "none";
  }, 3000);
}
