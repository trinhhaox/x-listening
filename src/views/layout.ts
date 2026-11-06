import { uiIcon } from "../icons.js";
import { STYLES } from "./styles.js";
import { ROLE_LABELS, currentViewer, teamNames } from "../users.js";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function queueButton(action: string, backFields: string, queue: string, label: string, current: string): string {
  const selected = current === queue ? " active" : "";
  return `<form class="queue-btn-form" method="post" action="${action}/queue">${backFields}<input type="hidden" name="queue" value="${queue}" /><button class="btn-q${selected}" type="submit">${label}</button></form>`;
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function renderNavbar(activeTab: string): string {
  if (activeTab === "login") return "";
  const viewer = currentViewer();
  const isAdmin = !viewer || viewer.role === "admin";
  const canWork = !viewer || viewer.role !== "viewer";
  return `
  <!-- HEROUI STICKY TOP NAVBAR (CỐ ĐỊNH, KHÔNG BAO GIỜ BỊ ĐÈ NỘI DUNG) -->
  <header class="deck-top-navbar">
    <div class="navbar-container">
      <div class="navbar-brand">
        <a href="/" class="brand-link">
          <span class="live-dot"><i class="heroui-pulse"></i></span>
          <span class="brand-title">xListening</span>
        </a>
        <span class="heroui-chip heroui-chip-primary brand-badge">Giám sát Dư luận</span>
      </div>

      <nav class="navbar-nav">
        <a class="nav-item ${activeTab === "dashboard" ? "active" : ""}" href="/">${uiIcon("dashboard")} Tổng quan</a>
        <a class="nav-item ${activeTab === "search" ? "active" : ""}" href="/search">${uiIcon("search")} Tra cứu</a>
        <a class="nav-item ${activeTab === "brief" ? "active" : ""}" href="/brief">${uiIcon("report")} Báo cáo AI</a>
        <a class="nav-item ${activeTab === "hashtags" ? "active" : ""}" href="/hashtags">${uiIcon("flame")} Xu hướng</a>
        <a class="nav-item ${activeTab === "compare" ? "active" : ""}" href="/compare">${uiIcon("compare")} So sánh</a>
        ${isAdmin ? `<a class="nav-item ${activeTab === "users" ? "active" : ""}" href="/users">${uiIcon("users")} Nhân viên</a>` : ""}
        ${isAdmin ? `<a class="nav-item ${activeTab === "settings" ? "active" : ""}" href="/settings">${uiIcon("settings")} Cấu hình</a>` : ""}
      </nav>

      <div class="navbar-actions">
        ${canWork ? `<form method="post" action="/listen" style="display:inline-block; margin:0;">
          <button class="btn btn-sm btn-primary" type="submit" title="Quét tin tức mới ngay trên tất cả các kênh">${uiIcon("refresh")} Quét tin</button>
        </form>` : ""}
        ${viewer ? `<a class="nav-user${activeTab === "account" ? " active" : ""}" href="/account" title="Tài khoản của tôi">${uiIcon("user", 14)}<span class="btn-label"> ${escapeHtml(viewer.name)}</span> <span class="heroui-chip role-chip role-${viewer.role}">${ROLE_LABELS[viewer.role]}</span></a>` : ""}
        <form method="post" action="/logout" style="display:inline-block; margin:0;">
          <button class="btn btn-sm btn-outline" type="submit" title="Đăng xuất khỏi hệ thống" aria-label="Đăng xuất">${uiIcon("logout")}<span class="btn-label"> Đăng xuất</span></button>
        </form>
      </div>
    </div>
  </header>`;
}

function teamDatalist(): string {
  const names = teamNames();
  return names.length ? `<datalist id="team-names">${names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("")}</datalist>` : "";
}

export function layout(title: string, body: string, activeTab = "dashboard"): string {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · xListening</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Be+Vietnam+Pro:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
${STYLES}
  </style>
</head>
<body data-role="${currentViewer()?.role ?? "admin"}">
  ${renderNavbar(activeTab)}
  <main>
    ${body}
  </main>
  ${teamDatalist()}
</body>
</html>`;
}
