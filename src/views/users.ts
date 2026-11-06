import { uiIcon } from "../icons.js";
import type { UserRow } from "../db.js";
import { ROLES, ROLE_HINTS, ROLE_LABELS, currentViewer, formatPhone, type Role } from "../users.js";
import { escapeHtml, formatWhen, layout } from "./layout.js";

export function roleOptions(selected: Role): string {
  return ROLES.map((role) => `<option value="${role}"${role === selected ? " selected" : ""}>${ROLE_LABELS[role]}</option>`).join("");
}

export function userRow(user: UserRow, selfId: string, backUrl = "/users"): string {
  const id = escapeHtml(user.id);
  const self = user.id === selfId;
  const backInput = backUrl ? `<input type="hidden" name="back" value="${escapeHtml(backUrl)}" />` : "";
  return `<tr class="${user.active ? "" : "user-locked"}">
    <td>
      <form id="u-${id}" method="post" action="/users/${id}">${backInput}</form>
      <input form="u-${id}" class="heroui-input heroui-input-sm" name="name" value="${escapeHtml(user.name)}" maxlength="60" required />
      ${self ? `<span class="hint" style="color:var(--heroui-primary); font-weight:600;">(bạn)</span>` : ""}
    </td>
    <td><input form="u-${id}" class="heroui-input heroui-input-sm" name="phone" type="tel" value="${escapeHtml(formatPhone(user.phone))}" required /></td>
    <td><select form="u-${id}" class="heroui-input heroui-input-sm" name="role"${self ? " disabled" : ""}>${roleOptions(user.role)}</select></td>
    <td><label class="user-active"><input form="u-${id}" type="checkbox" name="active" value="1"${user.active ? " checked" : ""}${self ? " disabled" : ""} /> ${user.active ? "Đang hoạt động" : "Đã khóa"}</label></td>
    <td class="hint">${user.last_login_at ? escapeHtml(formatWhen(user.last_login_at)) : "Chưa đăng nhập"}</td>
    <td class="user-actions">
      <button form="u-${id}" class="btn btn-sm btn-outline" type="submit" title="Lưu thay đổi">${uiIcon("save", 14)} Lưu</button>
      <details class="user-reset"><summary class="btn btn-sm btn-outline">${uiIcon("shield", 13)} Đổi mật khẩu</summary>
        <form method="post" action="/users/${id}/password">
          ${backInput}
          <input class="heroui-input heroui-input-sm" type="password" name="password" minlength="8" required autocomplete="new-password" placeholder="Mật khẩu mới (≥8 ký tự)" />
          <button class="btn btn-sm btn-primary" type="submit">Đặt</button>
        </form>
      </details>
      ${self ? "" : `<form method="post" action="/users/${id}/delete" onsubmit="return confirm('Xóa tài khoản nhân viên ${escapeHtml(user.name)}? Bạn có thể khóa thay vì xóa vĩnh viễn.')">${backInput}<button class="btn btn-sm btn-danger-flat" type="submit" title="Xóa tài khoản">${uiIcon("trash", 14)}</button></form>`}
    </td>
  </tr>`;
}

export function renderUserManagementSection(users: UserRow[], notice = "", backUrl = "/users"): string {
  const selfId = currentViewer()?.id ?? "";
  const backInput = backUrl ? `<input type="hidden" name="back" value="${escapeHtml(backUrl)}" />` : "";
  const adminCount = users.filter((u) => u.active && u.role === "admin").length;
  const editorCount = users.filter((u) => u.active && u.role === "editor").length;
  const viewerCount = users.filter((u) => u.active && u.role === "viewer").length;

  return `
    <div class="user-management-block">
      <div class="settings-card heroui-card" style="margin-bottom: 20px;">
        <div class="settings-card-head">
          <span class="platform-icon" style="background:var(--heroui-primary-50); color:var(--heroui-primary);">${uiIcon("userPlus", 22)}</span>
          <div>
            <h3 style="margin:0;">Thêm tài khoản nhân viên mới</h3>
            <p class="hint" style="margin-top:2px;">Tạo tài khoản bằng số điện thoại và cấp mật khẩu ban đầu. Nhân viên có thể tự đổi mật khẩu sau khi đăng nhập.</p>
          </div>
        </div>
        <form class="user-add-form" method="post" action="/users">
          ${backInput}
          <label class="heroui-label">Họ tên nhân viên
            <input class="heroui-input" name="name" maxlength="60" required placeholder="VD: Nguyễn Văn An" />
          </label>
          <label class="heroui-label">Số điện thoại đăng nhập
            <input class="heroui-input" name="phone" type="tel" inputmode="tel" required placeholder="0912 345 678" />
          </label>
          <label class="heroui-label">Mật khẩu ban đầu (≥ 8 ký tự)
            <input class="heroui-input" name="password" type="password" minlength="8" required autocomplete="new-password" placeholder="Nhập mật khẩu..." />
          </label>
          <label class="heroui-label">Phân quyền
            <select class="heroui-input" name="role">${roleOptions("editor")}</select>
          </label>
          <div style="display:flex; align-items:flex-end;">
            <button class="btn btn-primary" type="submit" style="width:100%; justify-content:center;">${uiIcon("userPlus", 15)} Thêm nhân viên</button>
          </div>
        </form>
        <div class="role-legend-box" style="margin-top:16px; padding:12px; border-radius:10px; background:var(--heroui-default-50, #f8fafc); border:1px solid var(--heroui-default-200, #e2e8f0);">
          <div style="font-size:12px; font-weight:600; text-transform:uppercase; color:var(--heroui-default-500); margin-bottom:8px; letter-spacing:0.5px;">Quyền hạn theo vai trò:</div>
          <ul class="role-legend" style="margin:0;">
            ${ROLES.map((role) => `<li style="display:flex; align-items:center; gap:8px;"><span class="heroui-chip role-chip role-${role}">${ROLE_LABELS[role]}</span> <span>${escapeHtml(ROLE_HINTS[role])}</span></li>`).join("")}
          </ul>
        </div>
      </div>

      <div class="settings-card heroui-card users-card">
        <div class="settings-card-head" style="justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:12px;">
            <span class="platform-icon">${uiIcon("users", 22)}</span>
            <div>
              <h3 style="margin:0;">Danh sách tài khoản nhân viên</h3>
              <p class="hint" style="margin-top:2px;">Tổng cộng ${users.length} tài khoản · <span class="heroui-chip role-chip role-admin">Quản trị: ${adminCount}</span> · <span class="heroui-chip role-chip role-editor">Xử lý: ${editorCount}</span> · <span class="heroui-chip role-chip role-viewer">Chỉ xem: ${viewerCount}</span></p>
            </div>
          </div>
        </div>
        ${
          users.length
            ? `<div class="table-scroll" style="margin-top:14px;"><table class="users-table">
          <thead><tr><th>Họ tên</th><th>Số điện thoại</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th style="text-align:right;">Thao tác</th></tr></thead>
          <tbody>${users.map((u) => userRow(u, selfId, backUrl)).join("")}</tbody>
        </table></div>`
            : `<p class="hint" style="padding:16px; text-align:center;">Chưa có tài khoản nhân viên nào. Hãy thêm tài khoản nhân viên đầu tiên ở trên.</p>`
        }
      </div>
    </div>
  `;
}

export function usersPage(users: UserRow[], notice = ""): string {
  const counts = ROLES.map((role) => `${ROLE_LABELS[role]}: ${users.filter((u) => u.active && u.role === role).length}`).join(" · ");
  return layout(
    "Quản lý Nhân viên & Phân quyền",
    `<div class="deck-page-header">
      <div class="page-header-title">
        <div class="title-with-badge">
          <h1>${uiIcon("users", 22)} Quản lý Nhân viên & Phân quyền</h1>
          <span class="heroui-chip heroui-chip-primary">Nhân sự</span>
        </div>
        <p class="text-muted">Tạo tài khoản và phân quyền cho nhân viên theo số điện thoại cá nhân. (${escapeHtml(counts)})</p>
      </div>
      <div class="page-header-actions">
        <a class="btn btn-outline" href="/account">${uiIcon("user", 14)} Tài khoản của tôi</a>
        <a class="btn btn-outline" href="/settings">${uiIcon("settings", 14)} Cấu hình</a>
        <a class="btn btn-outline" href="/">← Quay lại Tổng quan</a>
      </div>
    </div>
    ${notice ? `<div class="deck-alert info">${uiIcon("info")} ${escapeHtml(notice)}</div>` : ""}
    ${renderUserManagementSection(users, notice, "/users")}`,
    "users",
  );
}
