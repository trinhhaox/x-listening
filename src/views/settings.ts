import type { AppConfig } from "../config.js";
import { uiIcon } from "../icons.js";
import { escapeHtml, formatWhen, layout } from "./layout.js";

export function xRouteWarning(route: { route: string; cookieConfigured: boolean; at: string } | undefined): string {
  if (!route || !route.cookieConfigured || route.route === "direct") return "";
  const when = escapeHtml(formatWhen(route.at));
  const what =
    route.route === "web-index"
      ? "X không trả bài qua cookie phiên nên đang lấy tạm qua chỉ mục Bing/DuckDuckGo (ít bài và chậm hơn)"
      : "X không trả bài qua cookie phiên và chỉ mục web cũng không có kết quả";
  return `Lượt quét X lúc ${when}: ${what}. Thường do cookie auth_token/ct0 đã hết hạn, IP máy chủ bị X chặn, hoặc X đổi mã truy vấn. Thử lấy cookie mới trong <a href="/settings">Cài đặt</a>.`;
}

/** Khóa bí mật không bao giờ được in lại ra HTML; chỉ báo đã lưu và cho phép xóa. */
function savedSecretHint(value: string, name: string, missingText = ""): string {
  if (value.trim()) {
    return `<span style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:4px; font-size:0.78rem;">
              <span style="color:var(--heroui-success); font-weight:600;">${uiIcon("check", 12)} Đã lưu (${value.trim().length} ký tự) · để trống để giữ nguyên</span>
              <span class="check-label" style="font-size:0.78rem;"><input type="checkbox" name="clear_${escapeHtml(name)}" value="1" aria-label="Xóa giá trị đã lưu" /> Xóa giá trị đã lưu</span>
            </span>`;
  }
  if (!missingText) return "";
  return `<span style="display:block; margin-top:4px; color:var(--heroui-danger); font-size:0.78rem;">${uiIcon("alert", 12)} ${escapeHtml(missingText)}</span>`;
}

export function settingsPage(
  config: AppConfig,
  notice?: string,
  extra: {
    unreadableSecrets?: string[];
    xRoute?: { route: string; cookieConfigured: boolean; at: string };
    lastReport?: { at: string; day: string; error: string };
    aiSentiment?: { status?: { at: string; scored: number; changed: number; model: string; error?: string }; pending: number };
  } = {},
): string {
  const report = extra.lastReport;
  const reportStatus = report
    ? report.error
      ? `<p class="hint" style="color:var(--heroui-danger);">Lần gửi lúc ${escapeHtml(formatWhen(report.at))} lỗi: ${escapeHtml(report.error)}</p>`
      : `<p class="hint" style="color:var(--heroui-success);">${uiIcon("check", 12)} Đã gửi bản tin ngày ${escapeHtml(report.day.split("-").reverse().join("/"))} lúc ${escapeHtml(formatWhen(report.at))}.</p>`
    : "";
  const unreadable = extra.unreadableSecrets ?? [];
  const xWarn = xRouteWarning(extra.xRoute);
  const xOk = extra.xRoute?.route === "direct" ? `<p class="hint" style="color:var(--heroui-success);">${uiIcon("check", 12)} Lượt quét X lúc ${escapeHtml(formatWhen(extra.xRoute.at))} đọc thẳng bằng cookie phiên.</p>` : "";
  return layout(
    "Cài đặt Bàn nghe & Cấu hình",
    `
    <div class="deck-page-header">
      <div class="page-header-title">
        <div class="title-with-badge">
          <h1>${uiIcon("settings", 22)} Cài đặt Bàn nghe & Cấu hình Hệ thống</h1>
          <span class="heroui-chip heroui-chip-primary">Cấu hình Hệ thống</span>
        </div>
        <p class="text-muted">Cấu hình kết nối Mạng xã hội, Cookie phiên, Trí tuệ Nhân tạo AI và Nhận thông báo tự động</p>
      </div>
      <div class="page-header-actions">
        <a class="btn btn-outline" href="/">← Quay lại Tổng quan</a>
      </div>
    </div>

    ${notice ? `<div class="deck-alert info">${uiIcon("info")} ${escapeHtml(notice)}</div>` : ""}
    ${unreadable.length ? `<div class="deck-alert error">${uiIcon("alert")} Không giải mã được: ${unreadable.map((k) => `<code>${escapeHtml(k)}</code>`).join(", ")}. Có thể SECRETS_KEY hoặc ADMIN_PASSWORD đã đổi; hãy nhập lại các giá trị này.</div>` : ""}

    <form class="settings-form" method="post" action="/settings">
      <div class="settings-grid">
        <div class="settings-card heroui-card">
          <div class="settings-card-head">
            <span class="platform-icon">${uiIcon("twitter", 22)}</span>
            <div>
              <h3>X (Twitter)</h3>
              <p class="hint">Khuyến nghị dùng Cookie để không phát sinh chi phí gói API $100/tháng.</p>
            </div>
          </div>
          ${xWarn ? `<div class="deck-alert warning">${uiIcon("alert")} ${xWarn}</div>` : xOk}
          <label class="heroui-label">Cookie auth_token
            <input class="heroui-input" type="password" name="TWITTER_AUTH_TOKEN" value="" autocomplete="off" placeholder="F12 -> Cookies -> auth_token" />
            ${savedSecretHint(config.TWITTER_AUTH_TOKEN, "TWITTER_AUTH_TOKEN", "Chưa có - Lấy từ F12 -> Cookies -> auth_token")}
          </label>
          <label class="heroui-label">Cookie ct0 (CSRF token)
            <input class="heroui-input" type="password" name="TWITTER_CT0" value="" autocomplete="off" placeholder="F12 -> Cookies -> ct0" />
            ${savedSecretHint(config.TWITTER_CT0, "TWITTER_CT0", "Chưa có - Bắt buộc cần ct0 để quét bài trên X")}
          </label>
          <label class="heroui-label">Hoặc Bearer Token X API v2 (Nếu có)
            <input class="heroui-input" type="password" name="X_BEARER_TOKEN" value="" autocomplete="off" placeholder="Bearer token chính thức..." />
            ${savedSecretHint(config.X_BEARER_TOKEN, "X_BEARER_TOKEN")}
          </label>
        </div>

        <div class="settings-card heroui-card">
          <div class="settings-card-head">
            <span class="platform-icon">${uiIcon("facebook", 22)}</span>
            <div>
              <h3>Facebook Fanpage & Group</h3>
              <p class="hint">Khuyến nghị dùng Cookie để đọc bài viết công khai không cần App Review phức tạp.</p>
            </div>
          </div>
          <label class="heroui-label">Cookie Facebook (c_user & xs)
            <textarea class="heroui-textarea" name="FACEBOOK_COOKIE" rows="3" placeholder="c_user=...; xs=...;"></textarea>
            ${savedSecretHint(config.FACEBOOK_COOKIE, "FACEBOOK_COOKIE", "Chưa cấu hình")}
          </label>
          <label class="heroui-label">Hoặc Page Access Token (Nếu có)
            <input class="heroui-input" type="password" name="FACEBOOK_ACCESS_TOKEN" value="" autocomplete="off" placeholder="Token Graph API..." />
            ${savedSecretHint(config.FACEBOOK_ACCESS_TOKEN, "FACEBOOK_ACCESS_TOKEN")}
          </label>
        </div>

        <div class="settings-card heroui-card">
          <div class="settings-card-head">
            <span class="platform-icon">${uiIcon("threads", 22)}</span>
            <div>
              <h3>Meta Threads & YouTube</h3>
              <p class="hint">Tích hợp đa nguồn dữ liệu mạng xã hội.</p>
            </div>
          </div>
          <label class="heroui-label">Threads User Access Token
            <input class="heroui-input" type="password" name="THREADS_ACCESS_TOKEN" value="" autocomplete="off" placeholder="Threads Graph API Token..." />
            ${savedSecretHint(config.THREADS_ACCESS_TOKEN, "THREADS_ACCESS_TOKEN")}
          </label>
          <label class="heroui-label">YouTube Data API v3 Key
            <input class="heroui-input" type="password" name="YOUTUBE_API_KEY" value="" autocomplete="off" placeholder="AIzaSy..." />
            ${savedSecretHint(config.YOUTUBE_API_KEY, "YOUTUBE_API_KEY")}
          </label>
        </div>

        <div class="settings-card heroui-card">
          <div class="settings-card-head">
            <span class="platform-icon">${uiIcon("bot", 22)}</span>
            <div>
              <h3>Trí tuệ Nhân tạo & Tóm tắt AI</h3>
              <p class="hint">Hỗ trợ Anthropic Claude, OpenAI, Gemini, Groq, Ollama.</p>
            </div>
          </div>
          <label class="heroui-label">LLM API Key
            <input class="heroui-input" type="password" name="LLM_API_KEY" value="" autocomplete="off" placeholder="sk-... hoặc ant-api-..." />
            ${savedSecretHint(config.LLM_API_KEY, "LLM_API_KEY")}
          </label>
          <label class="heroui-label">Base URL
            <input class="heroui-input" type="text" name="LLM_BASE_URL" value="${escapeHtml(config.LLM_BASE_URL)}" placeholder="https://api.openai.com/v1 hoặc https://api.anthropic.com" />
          </label>
          <label class="heroui-label">Tên Model
            <input class="heroui-input" type="text" name="LLM_MODEL" value="${escapeHtml(config.LLM_MODEL)}" placeholder="gpt-4o-mini hoặc claude-3-5-sonnet-20241022" />
          </label>
          <label class="check-label">
            <input type="checkbox" name="AI_SENTIMENT" value="1"${config.AI_SENTIMENT !== "0" ? " checked" : ""} />
            Dùng AI chấm cảm xúc bài mới sau mỗi lượt quét (hiểu mỉa mai, phủ định tốt hơn đếm từ)
          </label>
          ${aiSentimentStatus(config, extra.aiSentiment)}
        </div>

        <div class="settings-card heroui-card">
          <div class="settings-card-head">
            <span class="platform-icon">${uiIcon("bell", 22)}</span>
            <div>
              <h3>Thông báo Cảnh báo & Webhook</h3>
              <p class="hint">Nhận thông báo tức thời qua Discord, Slack, Telegram khi có khủng hoảng.</p>
            </div>
          </div>
          <label class="heroui-label">Webhook URL (Discord, Slack, Telegram Bot)
            <input class="heroui-input" type="url" name="ALERT_WEBHOOK_URL" value="" autocomplete="off" placeholder="https://discord.com/api/webhooks/... hoặc Webhook URL..." />
            ${savedSecretHint(config.ALERT_WEBHOOK_URL, "ALERT_WEBHOOK_URL")}
          </label>
          <p class="hint">Telegram: <code>https://api.telegram.org/bot&lt;TOKEN&gt;/sendMessage?chat_id=&lt;CHAT_ID&gt;</code></p>
          <label class="heroui-label">Gửi bản tin tự động lúc (giờ Việt Nam, để trống là tắt)
            <input class="heroui-input" type="time" name="DAILY_REPORT_TIME" value="${escapeHtml(config.DAILY_REPORT_TIME)}" />
          </label>
          <p class="hint">Hẹn trước 12:00 thì gửi bản tin của hôm qua; từ 12:00 trở đi thì gửi bản tin của hôm nay. Gửi qua webhook ở trên.</p>
          ${reportStatus}
          <label class="check-label">
            <input type="checkbox" name="DESKTOP_NOTIFY" value="1"${config.DESKTOP_NOTIFY === "1" ? " checked" : ""} />
            Bật thông báo nổi trên màn hình máy tính (Desktop Notification)
          </label>
        </div>

        <div class="settings-card heroui-card">
          <div class="settings-card-head">
            <span class="platform-icon">${uiIcon("clock", 22)}</span>
            <div>
              <h3>Chu kỳ Quét tự động & Giới hạn</h3>
              <p class="hint">Tần suất làm mới dữ liệu chạy ngầm.</p>
            </div>
          </div>
          <label class="heroui-label">Khoảng cách quét tự động (phút, tối thiểu 5)
            <input class="heroui-input" type="number" name="LISTEN_INTERVAL_MINUTES" min="5" max="1440" value="${config.LISTEN_INTERVAL_MINUTES}" />
          </label>
          <label class="heroui-label">Số bài viết tối đa mỗi lần quét (10 – 100)
            <input class="heroui-input" type="number" name="SEARCH_MAX_RESULTS" min="10" max="100" value="${config.SEARCH_MAX_RESULTS}" />
          </label>
          <label class="heroui-label">Giữ bài trong bao nhiêu ngày (0 là giữ mãi, tối thiểu 7)
            <input class="heroui-input" type="number" name="RETENTION_DAYS" min="0" max="3650" value="${config.RETENTION_DAYS}" />
          </label>
          <p class="hint">Mỗi ngày dọn một lần. Bài đã ghim, có ghi chú hoặc đang xử lý luôn được giữ.</p>
        </div>
      </div>

      <div class="settings-footer-actions">
        <button class="btn btn-primary btn-lg" type="submit">${uiIcon("save")} Lưu cấu hình hệ thống</button>
        <span class="hint text-muted">Cấu hình được lưu vào SQLite và áp dụng ngay lập tức mà không cần khởi động lại dịch vụ.</span>
      </div>
    </form>
    `,
    "settings",
  );
}

function aiSentimentStatus(
  config: AppConfig,
  info: { status?: { at: string; scored: number; changed: number; model: string; error?: string }; pending: number } | undefined,
): string {
  if (!config.LLM_API_KEY.trim() || config.AI_SENTIMENT === "0") return "";
  const st = info?.status;
  const line = st
    ? st.error
      ? `<p class="hint" style="color:var(--heroui-danger);">Lần chấm lúc ${escapeHtml(formatWhen(st.at))} lỗi: ${escapeHtml(st.error)}</p>`
      : `<p class="hint" style="color:var(--heroui-success);">${uiIcon("check", 12)} Lần chấm lúc ${escapeHtml(formatWhen(st.at))}: ${st.scored} bài, sửa nhãn ${st.changed} bài (${escapeHtml(st.model)}).</p>`
    : "";
  const pending = info?.pending ?? 0;
  const button = pending > 0
    ? `<button class="btn btn-sm btn-outline" type="submit" formaction="/sentiment/ai-run" formmethod="post">${uiIcon("zap", 12)} Chấm ngay ${pending} bài 7 ngày qua</button>`
    : `<p class="hint">Mọi bài trong 7 ngày qua đã được AI hoặc người chấm.</p>`;
  return `${line}${button}`;
}
