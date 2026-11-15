// static/js/core/sidebar.js
// Core: shared sidebar navigation.
// Plain script (no modules): functions stay global because the HTML uses inline onclick="..." handlers.
// Shared helpers: core/api.js, core/ui.js, core/sidebar.js. Split out of the former static/app.js.

const SIDEBAR_ITEMS = [
  // ---- Sprint 1: Base Configuration ----
  { href: "/dashboard.html",        label: "Dashboard",             roles: ["admin", "teacher", "student"], sprint: 1 },
  { href: "/rooms.html",            label: "Manage Rooms",          roles: ["admin"],                       sprint: 1 },
  { href: "/teachers.html",         label: "Manage Faculty",        roles: ["admin"],                       sprint: 1 },
  { href: "/courses.html",          label: "Manage Curriculum",     roles: ["admin"],                       sprint: 1 },
  { href: "/availability.html",     label: "My Availability",       roles: ["admin", "teacher"],            sprint: 1 },

  // ---- Sprint 2: Academic Structure & Constraints ----
  { href: "/programs.html",         label: "Manage Programs",       roles: ["admin"],                       sprint: 2 },
  { href: "/semesters.html",        label: "Manage Semesters",      roles: ["admin"],                       sprint: 2 },
  { href: "/student-groups.html",   label: "Manage Student Groups", roles: ["admin"],                       sprint: 2 },
  { href: "/time-slots.html",       label: "Manage Time Slots",     roles: ["admin"],                       sprint: 2 },
  { href: "/constraints.html",      label: "Hard Constraints",      roles: ["admin"],                       sprint: 2 },
  { href: "/soft-constraints.html", label: "Soft Constraints",      roles: ["admin"],                       sprint: 2 },

  // ---- Sprint 3: Scheduling Engine (US-12 ~ US-16) ----
  { href: "/validation.html",       label: "Prepare Data",          roles: ["admin"],                       sprint: 3 },
  { href: "/generator.html",        label: "AI Generator",          roles: ["admin"],                       sprint: 3 },
  { href: "/schedule.html",         label: "Schedule Grid",         roles: ["admin"],                       sprint: 3 },

  // ---- Sprint 4: Interactive Grid & Review (US-17 ~ US-20) ----
  { href: "/schedule.html",         label: "My Timetable",          roles: ["teacher", "student"],          sprint: 4 },
  { href: "/room-fitting.html",     label: "Smart Room Fitting",    roles: ["admin"],                       sprint: 4 },

  // ---- Sprint 5: Analytics & System Management (US-27 ~ US-31) ----
  { href: "/analytics.html",        label: "Analytics & Reports",   roles: ["admin"],                       sprint: 5 },
  { href: "/audit-log.html",        label: "Audit Log",             roles: ["admin"],                       sprint: 5 },
];

const CURRENT_SPRINT = 4;

const SIDEBAR_ACTIONS = [];

const SIDEBAR_CSS = `
  .app-layout { display: flex; min-height: 100vh; }
  .sidebar {
    width: 220px; background: #1f2937; color: #fff;
    padding: 20px 0; flex-shrink: 0;
    position: sticky; top: 0; height: 100vh; overflow-y: auto;
  }
  .sidebar .brand {
    padding: 0 20px 20px; font-size: 16px; font-weight: bold;
    border-bottom: 1px solid #374151; margin-bottom: 12px;
  }
  .sidebar h3 {
    font-size: 11px; text-transform: uppercase; color: #9ca3af;
    padding: 12px 20px 6px; margin: 0; letter-spacing: 0.5px;
  }
  .sidebar button {
    display: block; width: 100%; text-align: left;
    padding: 10px 20px; background: transparent; color: #e5e7eb;
    border: none; font-size: 14px; cursor: pointer;
    transition: background 0.15s;
  }
  .sidebar button:hover { background: #374151; }
  .sidebar button.active { background: #2563eb; color: #fff; }
  .main-content { flex: 1; padding: 24px; max-width: 1100px; }

  @media (max-width: 768px) {
    .app-layout { flex-direction: column; }
    .sidebar {
      width: 100%; height: auto; position: static; padding: 12px 0;
    }
    .sidebar .brand { padding: 0 16px 12px; }
    .sidebar h3 { padding: 8px 16px 4px; }
    .sidebar button { padding: 8px 16px; }
    .main-content { padding: 12px; }
  }
`;

function renderSidebar() {
  const mount = document.getElementById("sidebar-mount");
  if (!mount) return;

  if (!document.getElementById("sidebar-style")) {
    const style = document.createElement("style");
    style.id = "sidebar-style";
    style.textContent = SIDEBAR_CSS;
    document.head.appendChild(style);
  }

  const user = getUser();
  const userRoles = (user && user.roles) ? user.roles : [];

  const hasRole = (item) => {
    if (!item.roles) return true;
    return item.roles.some(r => userRoles.includes(r));
  };

  const visibleItems = SIDEBAR_ITEMS.filter(item =>
    hasRole(item) && (item.sprint || 1) <= CURRENT_SPRINT
  );

  const current = window.location.pathname;

  const navHTML = visibleItems.map(item => {
    const isActive = current === item.href;
    return `<button class="${isActive ? "active" : ""}"
             onclick="window.location.href='${item.href}'">${item.label}</button>`;
  }).join("");

  mount.outerHTML = `
    <aside class="sidebar">
      <div class="brand">Timetable System</div>
      <h3>Navigation</h3>
      ${navHTML}
    </aside>
  `;
}

document.addEventListener("DOMContentLoaded", renderSidebar);
