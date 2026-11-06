import { uiIcon } from "../icons.js";
import { escapeHtml, layout } from "./layout.js";

export function loginPage(error = ""): string {
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
          <label class="heroui-label">Mật khẩu người vận hành
            <input class="heroui-input" type="password" name="password" autocomplete="current-password" required minlength="8" placeholder="Nhập mật khẩu truy cập hệ thống..." />
          </label>
          ${error ? `<div class="deck-alert error">${uiIcon("alert")} ${escapeHtml(error)}</div>` : ""}
          <button type="submit" class="btn btn-primary btn-block btn-lg">Đăng nhập vào Hệ thống</button>
        </div>
      </form>
    </div>`,
    "login",
  );
}
