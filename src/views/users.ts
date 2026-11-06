import { uiIcon } from "../icons.js";
import type { UserRow } from "../db.js";
import { ROLES, ROLE_HINTS, ROLE_LABELS, currentViewer, formatPhone, type Role } from "../users.js";
import { escapeHtml, formatWhen, layout } from "./layout.js";

function roleOptions(selected: Role): string {
  return ROLES.map((role) => `<option value="${role}"${role === selected ? " selected" : ""}>${ROLE_LABELS[role]}</option>`).join("");
}

function userRow(user: UserRow, selfId: string): string {
  const id = escapeHtml(user.id);
  const self = user.id === selfId;
  return `<tr class="${user.active ? "" : "user-locked"}">
    <td>
      <form id="u-${id}" method="post" action="/users/${id}"></form>
      <input form="u-${id}" class="heroui-input heroui-input-sm" name="name" value="${escapeHtml(user.name)}" maxlength="60" required />
      ${self ? `<span class="hint">(bạn)</span>` : ""}
    </td>
    <td><input form="u-${id}" class="heroui-input heroui-input-sm" name="phone" type="tel" value="${escapeHtml(formatPhone(user.phone))}" required /></td>
    <td><select form="u-${id}" class="heroui-input heroui-input-sm" name="role"${self ? " disabled" : ""}>${roleOptions(user.role)}</select></td>
    <td><label class="user-active"><input form="u-${id}" type="checkbox" name="active" value="1"${user.active ? " checked" : ""}${self ? " disabled" : ""} /> ${user.active ? "Đang dùng" : "Đã khóa"}</label></td>
    <td class="hint">${user.last_login_at ? escapeHtml(formatWhen(user.last_login_at)) : "Chưa đăng nhập"}</td>
    <td class="user-actions">
      <button form="u-${id}" class="btn btn-sm btn-outline" type="submit">${uiIcon("save", 14)} Lưu</button>
      <details class="user-reset"><summary class="btn btn-sm btn-outline">Đặt lại mật khẩu</summary>
        <form method="post" action="/users/${id}/password">
          <input class="heroui-input heroui-input-sm" type="password" name="password" minlength="8" required autocomplete="new-password" placeholder="Mật khẩu mới" />
          <button class="btn btn-sm btn-primary" type="submit">Đặt</button>
        </form>
      </details>
      ${self ? "" : `<form method="post" action="/users/${id}/delete" onsubmit="return confirm('Xóa tài khoản này? Có thể khóa thay vì xóa.')"><button class="btn btn-sm btn-danger-flat" type="submit" title="Xóa tài khoản">${uiIcon("trash", 14)}</button></form>`}
    </td>
  </tr>`;
}

export function usersPage(users: UserRow[], notice = ""): string {
  const selfId = currentViewer()?.id ?? "";
  const counts = ROLES.map((role) => `${ROLE_LABELS[role]}: ${users.filter((u) => u.active && u.role === role).length}`).join(" · ");
  return layout(
    "Tài khoản & phân quyền",
    `<div class="deck-page-header">
      <div class="page-header-title">
        <h1>${uiIcon("shield", 22)} Tài khoản & phân quyền</h1>
        <p class="text-muted">Mỗi người đăng nhập bằng số điện thoại và mật khẩu riêng. ${escapeHtml(counts)}</p>
      </div>
      <div class="page-header-actions"><a class="btn btn-outline" href="/settings">← Cấu hình</a></div>
    </div>
    ${notice ? `<div class="deck-alert info">${uiIcon("info")} ${escapeHtml(notice)}</div>` : ""}

    <div class="settings-card heroui-card">
      <div class="settings-card-head"><span class="platform-icon">${uiIcon("plus", 22)}</span><div><h3>Thêm tài khoản</h3>
        <p class="hint">Gửi số điện thoại và mật khẩu cho người đó; họ có thể tự đổi mật khẩu ở mục “Tài khoản của tôi”.</p></div></div>
      <form class="user-add-form" method="post" action="/users">
        <label class="heroui-label">Họ tên<input class="heroui-input" name="name" maxlength="60" required placeholder="VD: Nguyễn Lan" /></label>
        <label class="heroui-label">Số điện thoại<input class="heroui-input" name="phone" type="tel" inputmode="tel" required placeholder="0912 345 678" /></label>
        <label class="heroui-label">Mật khẩu (ít nhất 8 ký tự)<input class="heroui-input" name="password" type="password" minlength="8" required autocomplete="new-password" /></label>
        <label class="heroui-label">Vai trò<select class="heroui-input" name="role">${roleOptions("editor")}</select></label>
        <button class="btn btn-primary" type="submit">${uiIcon("plus", 14)} Thêm</button>
      </form>
      <ul class="role-legend">${ROLES.map((role) => `<li><span class="heroui-chip role-chip role-${role}">${ROLE_LABELS[role]}</span> ${escapeHtml(ROLE_HINTS[role])}</li>`).join("")}</ul>
    </div>

    <div class="settings-card heroui-card users-card">
      ${
        users.length
          ? `<div class="table-scroll"><table class="users-table">
        <thead><tr><th>Họ tên</th><th>Số điện thoại</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th></th></tr></thead>
        <tbody>${users.map((u) => userRow(u, selfId)).join("")}</tbody>
      </table></div>`
          : `<p class="hint">Chưa có tài khoản nào. Hiện chỉ đăng nhập được bằng mật khẩu quản trị.</p>`
      }
    </div>`,
    "settings",
  );
}
