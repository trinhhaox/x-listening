import { uiIcon } from "../icons.js";
import { OWNER, ROLE_HINTS, ROLE_LABELS, currentViewer, formatPhone } from "../users.js";
import { escapeHtml, layout } from "./layout.js";

export function loginPage(error = "", phone = ""): string {
  return layout(
    "Đăng nhập",
    `<div class="login-wrapper">
      <form class="login-card heroui-card" method="post" action="/login">
        <div class="deck-brand">
          <div class="brand-badge-row">
            <span class="heroui-chip heroui-chip-success"><i class="heroui-dot"></i> Trực tuyến</span>
            <span class="heroui-chip heroui-chip-default">xListening v2.0</span>
          </div>
          <h1>xListening</h1>
          <p class="deck-subtitle">Hệ thống Giám sát Truyền thông & Cảnh báo Dư luận</p>
        </div>
        <div class="login-body">
          <label class="heroui-label">Số điện thoại
            <input class="heroui-input" type="tel" name="phone" inputmode="tel" autocomplete="username" value="${escapeHtml(phone)}" placeholder="VD: 0912 345 678" />
          </label>
          <label class="heroui-label">Mật khẩu
            <input class="heroui-input" type="password" name="password" autocomplete="current-password" required minlength="8" placeholder="Nhập mật khẩu..." />
          </label>
          <p class="hint login-hint">Chủ hệ thống: để trống số điện thoại và nhập mật khẩu quản trị.</p>
          ${error ? `<div class="deck-alert error">${uiIcon("alert")} ${escapeHtml(error)}</div>` : ""}
          <button type="submit" class="btn btn-primary btn-block btn-lg">Đăng nhập vào Hệ thống</button>
        </div>
      </form>
    </div>`,
    "login",
  );
}

function pageHeader(title: string, subtitle: string): string {
  return `<div class="deck-page-header">
      <div class="page-header-title"><h1>${title}</h1><p class="text-muted">${escapeHtml(subtitle)}</p></div>
      <div class="page-header-actions"><a class="btn btn-outline" href="/">← Quay lại Tổng quan</a></div>
    </div>`;
}

export function forbiddenPage(message: string): string {
  return layout(
    "Không có quyền",
    `${pageHeader(`${uiIcon("shield", 22)} Không có quyền`, "Tài khoản của bạn không làm được thao tác này.")}
    <div class="deck-alert warning">${uiIcon("alert")} ${escapeHtml(message)} Nếu cần, hãy nhờ người quản trị đổi vai trò cho bạn.</div>`,
    "",
  );
}

export function accountPage(notice = ""): string {
  const viewer = currentViewer() ?? OWNER;
  const isOwner = viewer.id === OWNER.id;
  return layout(
    "Tài khoản của tôi",
    `${pageHeader(`${uiIcon("user", 22)} Tài khoản của tôi`, "Thông tin đăng nhập và đổi mật khẩu.")}
    ${notice ? `<div class="deck-alert info">${uiIcon("info")} ${escapeHtml(notice)}</div>` : ""}
    <div class="settings-grid account-grid">
      <div class="settings-card heroui-card">
        <div class="settings-card-head"><span class="platform-icon">${uiIcon("user", 22)}</span><div><h3>${escapeHtml(viewer.name)}</h3>
          <p class="hint">${isOwner ? "Đăng nhập bằng mật khẩu quản trị" : `Số điện thoại: ${escapeHtml(formatPhone(viewer.phone))}`}</p></div></div>
        <p><span class="heroui-chip role-chip role-${viewer.role}">${ROLE_LABELS[viewer.role]}</span></p>
        <p class="hint">${escapeHtml(ROLE_HINTS[viewer.role])}</p>
      </div>
      <div class="settings-card heroui-card">
        <div class="settings-card-head"><span class="platform-icon">${uiIcon("shield", 22)}</span><div><h3>Đổi mật khẩu</h3>
          <p class="hint">Đổi xong, các thiết bị khác đang đăng nhập sẽ bị đăng xuất.</p></div></div>
        ${
          isOwner
            ? `<p class="hint">Mật khẩu quản trị nằm trong file <code>.env</code> (ADMIN_PASSWORD) trên máy chủ, không đổi ở đây được.</p>`
            : `<form class="admin-form" method="post" action="/account/password">
          <label class="heroui-label">Mật khẩu hiện tại<input class="heroui-input" type="password" name="current" autocomplete="current-password" required /></label>
          <label class="heroui-label">Mật khẩu mới (ít nhất 8 ký tự)<input class="heroui-input" type="password" name="password" autocomplete="new-password" required minlength="8" /></label>
          <label class="heroui-label">Nhập lại mật khẩu mới<input class="heroui-input" type="password" name="confirm" autocomplete="new-password" required minlength="8" /></label>
          <button class="btn btn-primary" type="submit">Đổi mật khẩu</button>
        </form>`
        }
      </div>
    </div>`,
    "account",
  );
}
