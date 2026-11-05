import type { AlertHitRow, AlertRule, MentionRow, MentionView, ResponseTemplate, Topic, Voice } from "./db.js";
import type { Brief, DayCount } from "./digest.js";
import type { AppConfig } from "./config.js";
import type { WordCloudItem, TopicCluster } from "./cloud.js";
import type { HashtagAnalyticsResult, HashtagStat } from "./hashtags.js";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type DashboardModel = {
  topics: Topic[];
  mentions: MentionRow[];
  templates: ResponseTemplate[];
  activeTopic: string;
  view: MentionView;
  search?: string;
  sentimentFilter?: string;
  minLikesFilter?: number;
  assignedToFilter?: string;
  tagFilter?: string;
  hasToken: boolean;
  xNotice?: string;
  hasFacebook: boolean;
  hasThreads: boolean;
  hasYoutube: boolean;
  notice: string;
  stats: { mentions: number; authors: number; engagement: number; positive: number; negative: number; neutral: number };
  days: { day: string; count: number }[];
  alerts: AlertRule[];
  hits: AlertHitRow[];
  voices: Voice[];
  muted: string[];
  queueNew: number;
  spike: string | null;
  lexicon: { word: string; polarity: string }[];
  outbound: string;
  notifyError: string;
  wordCloud?: { words: WordCloudItem[]; clusters: TopicCluster[] };
  adminOpen?: boolean;
};

export function loginPage(error = ""): string {
  return layout(
    "Đăng nhập",
    `<div class="login-wrapper">
      <form class="login-card" method="post" action="/login">
        <div class="deck-brand">
          <span class="live-indicator"><i class="pulse"></i> Trực tuyến</span>
          <h1>xListening</h1>
          <p class="deck-subtitle">Bàn nghe & Tình báo Truyền thông</p>
        </div>
        <div class="login-body">
          <label>Mật khẩu người vận hành
            <input type="password" name="password" autocomplete="current-password" required minlength="8" placeholder="Nhập mật khẩu truy cập..." />
          </label>
          ${error ? `<div class="alert-box error">${escapeHtml(error)}</div>` : ""}
          <button type="submit" class="btn btn-primary btn-block">Vào Bàn nghe</button>
        </div>
      </form>
    </div>`,
  );
}

export function dashboardPage(model: DashboardModel): string {
  const totalFeel = model.stats.positive + model.stats.negative + model.stats.neutral;
  const pct = (n: number) => (totalFeel === 0 ? 0 : Math.round((n / totalFeel) * 100));
  const maxDay = Math.max(1, ...model.days.map((day) => day.count));

  const topicOptions = model.topics
    .map(
      (topic) =>
        `<option value="${escapeHtml(topic.id)}"${topic.id === model.activeTopic ? " selected" : ""}>${escapeHtml(topic.name)}</option>`,
    )
    .join("");

  const backFields = [
    `<input type="hidden" name="topic" value="${escapeHtml(model.activeTopic)}" />`,
    `<input type="hidden" name="view" value="${escapeHtml(model.view)}" />`,
    model.search ? `<input type="hidden" name="search" value="${escapeHtml(model.search)}" />` : "",
    model.sentimentFilter ? `<input type="hidden" name="sentiment" value="${escapeHtml(model.sentimentFilter)}" />` : "",
    model.minLikesFilter ? `<input type="hidden" name="min_likes" value="${model.minLikesFilter}" />` : "",
    model.assignedToFilter ? `<input type="hidden" name="assigned_to" value="${escapeHtml(model.assignedToFilter)}" />` : "",
    model.tagFilter ? `<input type="hidden" name="tag" value="${escapeHtml(model.tagFilter)}" />` : "",
  ].filter(Boolean).join("");

  // Tách 2 luồng xử lý: Luồng nguy cơ cao (negative hoặc được đánh dấu) và Luồng thảo luận tự nhiên
  const isNegative = (m: MentionRow) => m.sentiment === "negative";
  let criticalMentions: MentionRow[] = [];
  let naturalMentions: MentionRow[] = [];

  if (model.sentimentFilter === "negative") {
    criticalMentions = model.mentions;
  } else if (model.sentimentFilter === "positive" || model.sentimentFilter === "neutral") {
    naturalMentions = model.mentions;
  } else {
    for (const m of model.mentions) {
      if (isNegative(m)) {
        criticalMentions.push(m);
      } else {
        naturalMentions.push(m);
      }
    }
  }

  const renderCard = (mention: MentionRow, idx: number, isCritical: boolean) =>
    renderMentionCard(mention, idx, backFields, model.templates, isCritical);

  const criticalCards = criticalMentions.map((m, i) => renderCard(m, i, true)).join("");
  const naturalCards = naturalMentions.map((m, i) => renderCard(m, i, false)).join("");

  const hits = model.hits
    .map(
      (hit) => `
      <div class="alarm-item">
        <div class="alarm-content">
          <div class="alarm-header">
            <span class="alarm-badge">🚨 ${escapeHtml(hit.alert_name)}</span>
            <span class="alarm-meta">${escapeHtml(hit.author_name)} · ${escapeHtml(hit.topic_name)}</span>
          </div>
          <p class="alarm-text">${escapeHtml(hit.text)}</p>
          <small class="alarm-reason">${escapeHtml(hit.reason)}</small>
        </div>
        <form method="post" action="/alerts/hits/${escapeHtml(hit.id)}/seen">
          ${backFields}
          <button class="btn btn-sm btn-outline" type="submit">Đã xem</button>
        </form>
      </div>`,
    )
    .join("");

  const bars = model.days
    .map((day) => {
      const height = Math.max(10, Math.round((day.count / maxDay) * 100));
      return `
        <div class="radar-bar-col" title="${escapeHtml(day.day)}: ${day.count} bài">
          <div class="radar-bar-track">
            <div class="radar-bar-fill" style="height: ${height}%"></div>
          </div>
          <span class="radar-bar-val">${day.count}</span>
          <span class="radar-bar-lbl">${escapeHtml(day.day.slice(5))}</span>
        </div>`;
    })
    .join("");

  const voices = model.voices
    .slice(0, 8)
    .map(
      (v) => `
      <span class="voice-chip" title="${escapeHtml(v.author_name)} (@${escapeHtml(v.author_username)})">
        <strong>${escapeHtml(v.author_name)}</strong>
        <small>${v.posts} bài</small>
      </span>`,
    )
    .join("");

  const viewLink = (view: MentionView, label: string) => {
    const params = new URLSearchParams();
    if (model.activeTopic) params.set("topic", model.activeTopic);
    if (view !== "wire") params.set("view", view);
    if (model.search) params.set("search", model.search);
    if (model.sentimentFilter) params.set("sentiment", model.sentimentFilter);
    if (model.minLikesFilter) params.set("min_likes", String(model.minLikesFilter));
    if (model.tagFilter) params.set("tag", model.tagFilter);
    if (model.assignedToFilter) params.set("assigned_to", model.assignedToFilter);
    const query = params.toString();
    return `<a class="tab-link ${model.view === view ? "active" : ""}" href="/${query ? `?${query}` : ""}">${label}</a>`;
  };

  const topicItems = model.topics
    .map((topic) => {
      const state = topic.active ? "Đang nghe" : "Tạm dừng";
      const sourceLabel =
        topic.source === "facebook"
          ? "Facebook"
          : topic.source === "threads"
            ? "Threads"
            : topic.source === "youtube"
              ? "YouTube"
              : "X";
      return `
      <div class="tool-list-row ${topic.active ? "active" : "inactive"}">
        <div class="tool-list-info">
          <div class="tool-title-wrap">
            <strong>${escapeHtml(topic.name)}</strong>
            <span class="source-pill ${topic.source}">${sourceLabel}</span>
            <span class="status-dot ${topic.active ? "online" : "offline"}"></span>
            <small>${state}${topic.last_listened_at ? ` · ${escapeHtml(formatWhen(topic.last_listened_at))}` : ""}</small>
          </div>
          <code>${escapeHtml(topic.query)}${topic.phrase ? ` · “${escapeHtml(topic.phrase)}”` : ""}</code>
          ${topic.last_error ? `<p class="tool-error">${escapeHtml(topic.last_error)}</p>` : ""}
        </div>
        <div class="tool-list-actions">
          <form method="post" action="/topics/${escapeHtml(topic.id)}/toggle">
            <button class="btn btn-sm btn-outline" type="submit">${topic.active ? "Dừng" : "Nghe"}</button>
          </form>
          <form method="post" action="/topics/${escapeHtml(topic.id)}/backfill">
            <button class="btn btn-sm btn-outline" type="submit">Lấy 7 ngày</button>
          </form>
          <form method="post" action="/topics/${escapeHtml(topic.id)}/delete" onsubmit="return confirm('Gỡ chủ đề này và toàn bộ tin đã lưu?')">
            <button class="btn btn-sm btn-danger-outline" type="submit">Gỡ</button>
          </form>
        </div>
      </div>`;
    })
    .join("");

  const alertRules = model.alerts
    .map((rule) => {
      const detail =
        rule.kind === "phrase"
          ? `Cụm: “${rule.phrase}”`
          : rule.kind === "likes"
            ? `≥ ${rule.min_likes} thích`
            : rule.kind === "velocity"
              ? `Gia tốc: ${rule.threshold_count || 3} bài xấu / ${rule.time_window_minutes || 60}p`
              : "Mọi bài nghiêng xấu";
      return `
      <div class="tool-list-row">
        <div class="tool-list-info">
          <strong>${escapeHtml(rule.name)}</strong>
          <small>${escapeHtml(detail)}</small>
        </div>
        <form method="post" action="/alerts/${escapeHtml(rule.id)}/delete">
          ${backFields}
          <button class="btn btn-sm btn-danger-outline" type="submit">Gỡ</button>
        </form>
      </div>`;
    })
    .join("");

  const alertTopics = model.topics
    .map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.name)}</option>`)
    .join("");

  const templateItems = (model.templates ?? [])
    .map(
      (tpl) => `
      <div class="tool-list-row">
        <div class="tool-list-info">
          <strong>${escapeHtml(tpl.name)}</strong>
          <p class="tool-text-preview">${escapeHtml(tpl.content)}</p>
        </div>
        <form method="post" action="/templates/${escapeHtml(tpl.id)}/delete">
          ${backFields}
          <button class="btn btn-sm btn-danger-outline" type="submit">Gỡ</button>
        </form>
      </div>`,
    )
    .join("");

  const mutedItems = model.muted
    .map(
      (username) => `
      <div class="tool-list-row">
        <div class="tool-list-info">
          <strong>@${escapeHtml(username)}</strong>
        </div>
        <form method="post" action="/mutes/${encodeURIComponent(username)}/delete">
          ${backFields}
          <button class="btn btn-sm btn-outline" type="submit">Bỏ tắt</button>
        </form>
      </div>`,
    )
    .join("");

  return layout(
    "Bàn nghe",
    `
    <!-- TOP HEADER / NAV -->
    <header class="deck-top-bar">
      <div class="deck-top-left">
        <div class="brand-row">
          <span class="live-dot"><i class="pulse"></i></span>
          <span class="brand-title">xListening</span>
          <span class="env-badge">Executive Deck</span>
        </div>
        <p class="brand-desc">Lắng nghe & Phản ứng khủng hoảng trên X, Facebook, Threads, YouTube</p>
      </div>
      <div class="deck-top-right">
        <nav class="deck-nav">
          <a class="nav-btn active" href="/">Bàn nghe</a>
          <a class="nav-btn" href="javascript:void(0)" onclick="const p=document.getElementById('deck-admin-panel'); if(p){ p.open=true; p.scrollIntoView({behavior:'smooth'}); }">⚙️ Tần số & Chuông</a>
          <a class="nav-btn" href="/brief">Bản tin AI</a>
          <a class="nav-btn" href="/hashtags">Hashtags & Từ khóa</a>
          <a class="nav-btn" href="/compare">So tần số</a>
          <a class="nav-btn" href="/settings">Cài đặt kết nối</a>
        </nav>
        <div class="top-actions">
          <form method="post" action="/listen">
            <button class="btn btn-primary" type="submit">⚡ Lắng nghe ngay</button>
          </form>
          <form method="post" action="/logout">
            <button class="btn btn-outline" type="submit">Thoát</button>
          </form>
        </div>
      </div>
    </header>

    ${model.notice ? `<div class="deck-alert info">ℹ️ ${escapeHtml(model.notice)}</div>` : ""}
    ${model.spike ? `<div class="deck-alert warning">⚡ <strong>Đột biến phát hiện:</strong> ${escapeHtml(model.spike)}</div>` : ""}
    ${model.xNotice ? `<div class="deck-alert warning">⚠️ ${model.xNotice}</div>` : ""}
    ${model.hasFacebook ? "" : `<div class="deck-alert warning">⚠️ Chưa có cấu hình Facebook Cookie. Vào mục <a href="/settings">Cài đặt</a> để thêm.</div>`}

    <!-- KHU VỰC 1: RADAR TÌNH BÁO & CẢNH BÁO KHỦNG HOẢNG (NỬA TRÊN) -->
    <section class="executive-radar">
      <!-- Cột 1: Chỉ số 24h & Feelbar -->
      <div class="radar-card radar-kpi-card">
        <div class="radar-card-head">
          <h3>📊 Chỉ số biến động 24h</h3>
          <span class="radar-sub">Thời gian thực</span>
        </div>
        <div class="kpi-grid">
          <div class="kpi-box">
            <span class="kpi-label">Tổng bài viết</span>
            <strong class="kpi-val">${model.stats.mentions.toLocaleString("vi-VN")}</strong>
          </div>
          <div class="kpi-box">
            <span class="kpi-label">Tài khoản</span>
            <strong class="kpi-val">${model.stats.authors.toLocaleString("vi-VN")}</strong>
          </div>
          <div class="kpi-box">
            <span class="kpi-label">Tổng tương tác</span>
            <strong class="kpi-val">${model.stats.engagement.toLocaleString("vi-VN")}</strong>
          </div>
        </div>

        <div class="feel-container">
          <div class="feel-header">
            <span class="feel-title">Phổ cảm xúc truyền thông</span>
            <span class="feel-percent">
              <span class="feel-stat-pos">🟢 ${pct(model.stats.positive)}% Tốt</span> · 
              <span class="feel-stat-neg">🔴 ${pct(model.stats.negative)}% Xấu</span> · 
              <span class="feel-stat-neu">⚪ ${pct(model.stats.neutral)}% K.xác định</span>
            </span>
          </div>
          <div class="feel-bar-track">
            <div class="feel-bar-pos" style="width: ${pct(model.stats.positive)}%" title="Tốt: ${model.stats.positive} bài"></div>
            <div class="feel-bar-neg" style="width: ${pct(model.stats.negative)}%" title="Xấu: ${model.stats.negative} bài"></div>
            <div class="feel-bar-neu" style="width: ${pct(model.stats.neutral)}%" title="Trung tính: ${model.stats.neutral} bài"></div>
          </div>
          <div class="feel-sub">
            <span>${model.stats.positive} bài tốt</span>
            <span>${model.stats.negative} bài xấu</span>
            <span>${model.stats.neutral} trung tính</span>
          </div>
        </div>
      </div>

      <!-- Cột 2: Nhịp độ 7 ngày & Tiếng nói hàng đầu -->
      <div class="radar-card radar-trend-card">
        <div class="radar-card-head">
          <h3>📈 Nhịp độ thảo luận 7 ngày</h3>
          <span class="radar-sub">Biến động theo ngày</span>
        </div>
        <div class="radar-chart-area">
          <div class="radar-bars-wrapper">
            ${bars || `<p class="empty-radar">Chưa đủ dữ liệu 7 ngày để vẽ cột.</p>`}
          </div>
        </div>
        <div class="voices-tray">
          <span class="tray-title">Nhắc nhiều nhất:</span>
          <div class="voices-chips">
            ${voices || `<small class="text-muted">Chưa có người viết</small>`}
          </div>
        </div>
      </div>

      <!-- Cột 3: Báo động nóng / Chuông gia tốc (Crisis Alarms) -->
      <div class="radar-card radar-alarms-card">
        <div class="radar-card-head">
          <h3>🚨 Báo động nóng & Gia tốc</h3>
          <span class="radar-pill-counter">${model.hits.length} hồi chuông</span>
        </div>
        <div class="alarms-scroll-area">
          ${
            hits ||
            `<div class="empty-alarms">
              <span class="shield-icon">🛡️</span>
              <p><strong>Trạng thái bình ổn</strong></p>
              <small>Không có chuông cảnh báo hay bài viết bùng nổ tiêu cực nào trong khung giờ này.</small>
            </div>`
          }
        </div>
      </div>
    </section>

    ${renderWordCloudSection(model.wordCloud, model.activeTopic)}

    ${renderAdminPanel(model, topicItems, alertTopics, alertRules, templateItems, mutedItems, backFields)}

    <!-- KHU VỰC 2: THANH BỘ LỌC DÂY TIN & ĐIỀU PHỐI TOÀN CỤC -->
    <section class="deck-ribbon">
      <div class="ribbon-tabs">
        ${viewLink("wire", "Dây tin")}
        ${viewLink("new", `Mới ${model.queueNew ? `(${model.queueNew})` : ""}`)}
        ${viewLink("reading", "Đang xử lý")}
        ${viewLink("done", "Đã xong")}
        ${viewLink("starred", "Đã ghim ⭐")}
        ${viewLink("hidden", "Đã giấu")}
      </div>

      <form class="ribbon-filter-bar" method="get" action="/">
        <input type="hidden" name="view" value="${escapeHtml(model.view === "wire" ? "" : model.view)}" />
        <div class="filter-group">
          <select name="topic" title="Tần số">
            <option value="">Tất cả tần số</option>
            ${topicOptions}
          </select>
          <select name="sentiment" title="Sắc thái">
            <option value="">Tất cả sắc thái</option>
            <option value="positive"${model.sentimentFilter === "positive" ? " selected" : ""}>🟢 Nghiêng tốt</option>
            <option value="negative"${model.sentimentFilter === "negative" ? " selected" : ""}>🔴 Nghiêng xấu</option>
            <option value="neutral"${model.sentimentFilter === "neutral" ? " selected" : ""}>⚪ Trung tính</option>
          </select>
          <input class="search-input" type="search" name="search" value="${escapeHtml(model.search ?? "")}" placeholder="Tìm từ khóa, tác giả..." />
          <input class="tag-input" type="text" name="tag" value="${escapeHtml(model.tagFilter ?? "")}" placeholder="#nhãn" />
          <input class="assignee-input" type="text" name="assigned_to" value="${escapeHtml(model.assignedToFilter ?? "")}" placeholder="👤 gán ai" />
          <input class="likes-input" type="number" name="min_likes" value="${model.minLikesFilter ?? ""}" min="0" placeholder="≥ Thích" />
          <button class="btn btn-sm btn-primary" type="submit">Lọc</button>
          ${
            model.search || model.sentimentFilter || model.minLikesFilter || model.tagFilter || model.assignedToFilter || model.activeTopic
              ? `<a class="btn-clear" href="/${model.view !== "wire" ? `?view=${encodeURIComponent(model.view)}` : ""}">Bỏ lọc</a>`
              : ""
          }
        </div>
        <div class="ribbon-export" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <button class="btn btn-sm btn-outline" type="button" onclick="const p=document.getElementById('deck-admin-panel'); if(p){ p.open=!p.open; if(p.open) p.scrollIntoView({behavior:'smooth'}); }" title="Mở bảng cấu hình Tần số, Chuông cảnh báo, Từ điển">⚙️ Tần số & Chuông (${model.topics.length})</button>
          <button class="btn btn-sm btn-primary" type="submit" form="auto-classify-form" title="Tự động phân loại tag và gán người xử lý cho các bài viết chưa được gán">⚡ AI Phân loại & Điều phối</button>
          <a class="btn btn-sm btn-outline" href="/export.csv?${(() => {
            const p = new URLSearchParams();
            if (model.activeTopic) p.set("topic", model.activeTopic);
            if (model.search) p.set("search", model.search);
            if (model.sentimentFilter) p.set("sentiment", model.sentimentFilter);
            if (model.minLikesFilter) p.set("min_likes", String(model.minLikesFilter));
            if (model.tagFilter) p.set("tag", model.tagFilter);
            if (model.assignedToFilter) p.set("assigned_to", model.assignedToFilter);
            return p.toString();
          })()}">📥 Tải CSV</a>
        </div>
      </form>
      <form id="auto-classify-form" method="post" action="/mentions/auto-classify" style="display:none;">
        <input type="hidden" name="topic" value="${escapeHtml(model.activeTopic)}" />
        <input type="hidden" name="view" value="${escapeHtml(model.view === "wire" ? "" : model.view)}" />
      </form>
    </section>

    <!-- KHU VỰC 3: DUAL-STREAM PROCESSING (NỬA DƯỚI - CHIA 2 LUỒNG XỬ LÝ) -->
    <section class="deck-dual-streams">
      <!-- CỘT TRÁI: LUỒNG NGUY CƠ CAO (CẦN CAN THIỆP GẤP) -->
      <div class="stream-column stream-critical">
        <div class="stream-header critical-head">
          <div class="stream-title-wrap">
            <span class="stream-badge-icon">🔥</span>
            <h2>BÀI NGUY CƠ CAO & TIÊU CỰC</h2>
          </div>
          <span class="stream-counter critical-counter">${criticalMentions.length} bài</span>
        </div>
        <p class="stream-subtitle">Ý kiến tiêu cực, khiếu nại dịch vụ và cảnh báo cần đội ngũ can thiệp.</p>

        <div class="stream-cards-list">
          ${
            criticalCards ||
            `<div class="stream-empty safe">
              <span class="empty-icon">🛡️</span>
              <p><strong>Không có bài viết nguy cơ cao</strong></p>
              <small>Thương hiệu đang an toàn trong phạm vi lọc hiện tại.</small>
            </div>`
          }
        </div>
      </div>

      <!-- CỘT PHẢI: LUỒNG THẢO LUẬN TỰ NHIÊN (TÍCH CỰC & TRUNG TÍNH) -->
      <div class="stream-column stream-natural">
        <div class="stream-header natural-head">
          <div class="stream-title-wrap">
            <span class="stream-badge-icon">💬</span>
            <h2>THẢO LUẬN TỰ NHIÊN & TÍCH CỰC</h2>
          </div>
          <span class="stream-counter natural-counter">${naturalMentions.length} bài</span>
        </div>
        <p class="stream-subtitle">Luồng tương tác thường nhật, câu hỏi và lời khen ngợi từ cộng đồng.</p>

        <div class="stream-cards-list">
          ${
            naturalCards ||
            `<div class="stream-empty">
              <span class="empty-icon">📭</span>
              <p><strong>Chưa có bài viết phù hợp</strong></p>
              <small>Thử mở rộng bộ lọc hoặc chọn tất cả tần số để xem thêm tin tức.</small>
            </div>`
          }
        </div>
      </div>
    </section>
    `,
  );
}

function renderAdminPanel(
  model: DashboardModel,
  topicItems: string,
  alertTopics: string,
  alertRules: string,
  templateItems: string,
  mutedItems: string,
  backFields: string,
): string {
  return `
    <!-- BẢNG ĐIỀU KHIỂN & CẤU HÌNH TẦN SỐ / CHUÔNG (VỊ TRÍ TRÊN LUỒNG BÀI VIẾT) -->
    <details id="deck-admin-panel" class="deck-admin-details" ${model.adminOpen ? "open" : ""}>
      <summary class="deck-admin-summary">
        <div class="admin-summary-content">
          <div class="admin-summary-title">
            <span class="admin-gear-icon">⚙️</span>
            <strong>Quản lý Tần số, Chuông cảnh báo, Từ điển & Mẫu phản hồi</strong>
          </div>
          <div class="admin-summary-badges">
            <span class="admin-pill">📡 ${model.topics.length} tần số</span>
            <span class="admin-pill">🔔 ${model.alerts.length} chuông</span>
            <span class="admin-pill">📚 ${model.lexicon.length} từ</span>
            <span class="admin-pill">💬 ${model.templates.length} mẫu</span>
            <span class="admin-pill-action">Bấm để cấu hình ▾</span>
          </div>
        </div>
        <span class="summary-arrow">▾</span>
      </summary>

      <div class="deck-admin-grid">
        <!-- Card 1: Quản lý Tần số -->
        <div class="admin-card">
          <div class="admin-card-head">
            <h3>📡 Tần số Lắng nghe</h3>
          </div>
          <form class="admin-form" method="post" action="/topics">
            <div class="form-row">
              <label>Tên gọi<input name="name" required maxlength="80" placeholder="VD: Khách hàng phản ánh" /></label>
              <label>Kênh theo dõi
                <select name="source">
                  <option value="x">X / Twitter (Từ khóa hoặc #Hashtag)</option>
                  <option value="facebook">Facebook (Fanpage hoặc #Hashtag/Từ khóa)</option>
                  <option value="threads">Threads (Tài khoản hoặc #Hashtag/Từ khóa)</option>
                  <option value="youtube">YouTube (Video theo từ khóa/Hashtag)</option>
                  <option value="web">Báo chí & Diễn đàn (Google News & RSS)</option>
                </select>
              </label>
            </div>
            <label>Từ khóa, #Hashtag, hoặc Link Fanpage/Profile
              <textarea name="query" required maxlength="300" rows="2" placeholder="Ví dụ: #rueco, &quot;mỹ phẩm rueco&quot;, link Fanpage hoặc tài khoản Threads"></textarea>
            </label>
            <div class="form-row">
              <label>Cụm giữ lại (FB/Threads)<input name="phrase" maxlength="80" placeholder="Để trống nếu lấy hết" /></label>
              <label class="check-label"><input type="checkbox" name="exclude_reposts" checked /> Bỏ bài đăng lại (X)</label>
            </div>
            <button class="btn btn-sm btn-primary" type="submit">+ Thêm tần số</button>
          </form>
          <div class="admin-tool-list">
            ${topicItems || `<p class="empty-small">Chưa có tần số nào.</p>`}
          </div>
        </div>

        <!-- Card 2: Chuông cảnh báo & Bùng nổ gia tốc -->
        <div class="admin-card">
          <div class="admin-card-head">
            <h3>🔔 Chuông & Gia tốc (Velocity)</h3>
          </div>
          <form class="admin-form" method="post" action="/alerts">
            <div class="form-row">
              <label>Tên chuông<input name="name" required maxlength="80" placeholder="VD: Khủng hoảng tẩy chay" /></label>
              <label>Loại chuông
                <select name="kind">
                  <option value="negative">Mọi bài nghiêng xấu</option>
                  <option value="velocity">Bùng nổ bài tiêu cực (Velocity)</option>
                  <option value="phrase">Chứa cụm từ nhạy cảm</option>
                  <option value="likes">Đủ lượt thích tối thiểu</option>
                </select>
              </label>
            </div>
            <div class="form-row">
              <label>Cụm từ (nếu có)<input name="phrase" maxlength="80" placeholder="thất vọng, lừa đảo..." /></label>
              <label>Lượt thích tối thiểu<input name="min_likes" type="number" min="1" max="1000000" value="20" /></label>
            </div>
            <div class="form-row">
              <label>Số bài xấu (Velocity)<input name="threshold_count" type="number" min="2" max="1000" value="3" /></label>
              <label>Khung giờ (phút)<input name="time_window_minutes" type="number" min="5" max="1440" value="60" /></label>
            </div>
            <label>Áp dụng cho
              <select name="topic_id"><option value="">Tất cả tần số</option>${alertTopics}</select>
            </label>
            <button class="btn btn-sm btn-primary" type="submit">+ Đặt chuông cảnh báo</button>
          </form>
          <div class="admin-tool-list">
            ${alertRules || `<p class="empty-small">Chưa có chuông nào.</p>`}
          </div>
        </div>

        <!-- Card 3: Từ điển sắc thái riêng & Mẫu CSKH -->
        <div class="admin-card">
          <div class="admin-card-head">
            <h3>📚 Từ điển Sắc thái & Mẫu phản hồi</h3>
          </div>
          <form class="admin-form" method="post" action="/lexicon">
            <div class="form-row">
              <label>Từ hoặc cụm ngữ cảnh<input name="word" required maxlength="40" placeholder="ngon, xịn, lag..." /></label>
              <label>Sắc thái
                <select name="polarity">
                  <option value="positive">Nghiêng tốt</option>
                  <option value="negative">Nghiêng xấu</option>
                </select>
              </label>
            </div>
            <button class="btn btn-sm btn-primary" type="submit">+ Thêm từ</button>
          </form>
          <hr class="admin-divider" />
          <form class="admin-form" method="post" action="/templates">
            ${backFields}
            <label>Tên mẫu trả lời nhanh<input name="name" required maxlength="80" placeholder="VD: Lời xin lỗi sự cố mạng" /></label>
            <label>Nội dung mẫu
              <textarea name="content" required maxlength="1000" rows="2" placeholder="Chào bạn, mình xin phép inbox để hỗ trợ ngay ạ..."></textarea>
            </label>
            <button class="btn btn-sm btn-primary" type="submit">+ Thêm mẫu trả lời</button>
          </form>
          <div class="admin-tool-list">
            ${templateItems || `<p class="empty-small">Chưa có mẫu trả lời nhanh.</p>`}
          </div>
        </div>

        <!-- Card 4: Tắt tiếng & Dữ liệu mẫu -->
        <div class="admin-card">
          <div class="admin-card-head">
            <h3>🔇 Đã tắt tiếng & Thử nghiệm</h3>
          </div>
          <div class="admin-tool-list">
            ${mutedItems || `<p class="empty-small">Chưa tắt tiếng tài khoản nào.</p>`}
          </div>
          <div class="sample-actions">
            <form method="post" action="/samples"><button class="btn btn-sm btn-outline" type="submit">Nạp dữ liệu mẫu</button></form>
            <form method="post" action="/samples/clear"><button class="btn btn-sm btn-danger-outline" type="submit">Xóa dữ liệu mẫu</button></form>
          </div>
        </div>
      </div>
    </details>
  `;
}

function renderWordCloudSection(
  wordCloud?: { words: WordCloudItem[]; clusters: TopicCluster[] },
  activeTopic = "",
): string {
  if (!wordCloud || (!wordCloud.words.length && !wordCloud.clusters.length)) {
    return "";
  }

  const { words, clusters } = wordCloud;
  const counts = words.map((w) => w.count);
  const maxCount = counts.length > 0 ? Math.max(...counts) : 1;
  const minCount = counts.length > 0 ? Math.min(...counts) : 1;

  const clusterPills = clusters
    .map((c) => {
      const topicParam = activeTopic ? `&topic=${encodeURIComponent(activeTopic)}` : "";
      return `<a href="/?search=${encodeURIComponent(c.keywords[0] ?? c.name)}${topicParam}" class="cloud-cluster-badge ${c.sentiment}" title="Cụm ${escapeHtml(c.name)}: ${c.keywords.join(", ")}">
        <span class="cluster-icon">${c.icon}</span>
        <span class="cluster-title">${escapeHtml(c.name)}</span>
        <span class="cluster-num">${c.count} bài</span>
      </a>`;
    })
    .join("");

  const wordChips = words
    .map((w) => {
      const ratio = maxCount === minCount ? 0.5 : (w.count - minCount) / Math.max(1, maxCount - minCount);
      const fontSize = (0.84 + ratio * 0.72).toFixed(2);
      const topicParam = activeTopic ? `&topic=${encodeURIComponent(activeTopic)}` : "";
      const searchParam = encodeURIComponent(w.text);
      const sentimentLabel = w.sentiment === "positive" ? "Tốt" : w.sentiment === "negative" ? "Tiêu cực" : "Trung tính";
      return `<a href="/?search=${searchParam}${topicParam}" class="cloud-word-chip ${w.sentiment}" style="font-size: ${fontSize}rem;" title="Từ '${escapeHtml(w.text)}' xuất hiện ${w.count} lần (${sentimentLabel}). Nhấn để lọc bài viết.">
        <span class="chip-text">${escapeHtml(w.text)}</span>
        <span class="chip-count">${w.count}</span>
      </a>`;
    })
    .join("");

  return `
  <!-- KHU VỰC: ĐÁM MÂY TỪ KHÓA & CỤM CHỦ ĐỀ DƯ LUẬN (7 NGÀY) -->
  <section class="radar-cloud-card">
    <div class="cloud-card-header">
      <div class="cloud-card-title">
        <span class="cloud-icon">☁️</span>
        <div>
          <h3>Đám mây Từ khóa Dư luận & Cụm chủ đề</h3>
          <span class="cloud-sub">Dữ liệu 7 ngày qua · Nhấn vào từ khóa hoặc nhóm chủ đề để lọc nhanh</span>
        </div>
      </div>
      <div class="cloud-clusters-tray">
        ${clusterPills}
      </div>
    </div>
    <div class="cloud-words-wrapper">
      ${wordChips || `<p class="empty-cloud">Chưa có bài viết trong 7 ngày để tổng hợp đám mây từ khóa.</p>`}
    </div>
  </section>`;
}

function renderMentionCard(
  mention: MentionRow,
  index: number,
  backFields: string,
  templates: ResponseTemplate[],
  isCritical: boolean,
): string {
  const username = mention.author_username;
  const href =
    mention.url ||
    (/^\d+$/.test(mention.id) ? `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(mention.id)}` : "");
  const openLabel =
    href.includes("facebook.com") || href.includes("fb.com")
      ? "Facebook"
      : href.includes("threads.net")
        ? "Threads"
        : href.includes("youtube.com") || href.includes("youtu.be")
          ? "YouTube"
          : "X";

  const action = `/mentions/${encodeURIComponent(mention.topic_id)}/${encodeURIComponent(mention.id)}`;
  const sample = mention.sample ? `<span class="stamp-pill">MẪU</span>` : "";
  const note = mention.note ? `<div class="card-note-box"><strong>Ghi chú:</strong> ${escapeHtml(mention.note)}</div>` : "";
  const tagBadge = mention.tag ? `<span class="tag-badge">🏷️ ${escapeHtml(mention.tag)}</span>` : "";
  const assigneeBadge = mention.assigned_to
    ? `<span class="assignee-badge">👤 ${escapeHtml(mention.assigned_to)}</span>`
    : "";

  const sentimentClass = mention.sentiment === "positive" ? "pos" : mention.sentiment === "negative" ? "neg" : "neu";
  const sentimentLabel =
    mention.sentiment === "positive" ? "🟢 Tốt" : mention.sentiment === "negative" ? "🔴 Nghiêng xấu" : "⚪ Trung tính";

  return `
  <article class="deck-mention-card ${isCritical ? "is-critical" : ""} ${mention.starred ? "starred" : ""}" style="animation-delay:${Math.min(index * 30, 300)}ms">
    <div class="card-top-row">
      <div class="author-info">
        <span class="avatar-letter">${escapeHtml((mention.author_name || "A").slice(0, 1).toUpperCase())}</span>
        <div class="author-names">
          <strong class="author-name">${escapeHtml(mention.author_name)}</strong>
          <span class="author-handle">@${escapeHtml(username)}</span>
        </div>
      </div>
      <div class="card-top-badges">
        <span class="sentiment-pill ${sentimentClass}">${sentimentLabel}</span>
        ${assigneeBadge}
        ${tagBadge}
        <time class="card-time">${escapeHtml(formatWhen(mention.created_at))}</time>
      </div>
    </div>

    <div class="card-body-text">
      <p>${escapeHtml(mention.text)}</p>
    </div>
    ${note}

    <div class="card-meta-row">
      <span class="source-topic-tag">📡 ${escapeHtml(mention.topic_name)}</span>
      ${sample}
      <span class="stats-counter">❤️ ${mention.like_count} · 💬 ${mention.reply_count} · 🔁 ${mention.repost_count}</span>
      ${mention.sample || !href ? "" : `<a class="out-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Mở trên ${openLabel} ↗</a>`}
    </div>

    <!-- Tác vụ xử lý điều hành & CSKH -->
    <div class="card-actions-bar">
      <div class="queue-btns">
        ${queueButton(action, backFields, "new", "Mới", mention.queue)}
        ${queueButton(action, backFields, "reading", "Đang xử lý", mention.queue)}
        ${queueButton(action, backFields, "done", "Xong", mention.queue)}
      </div>

      <div class="util-btns">
        <form method="post" action="${action}/star">${backFields}<button class="btn-icon" title="${mention.starred ? "Bỏ ghim" : "Ghim"}" type="submit">${mention.starred ? "⭐" : "☆"}</button></form>
        <form method="post" action="${action}/hide">${backFields}<button class="btn-icon" title="${mention.hidden ? "Hiện lại" : "Giấu bài"}" type="submit">${mention.hidden ? "👁️" : "🚫"}</button></form>
        <form method="post" action="/mutes">${backFields}<input type="hidden" name="username" value="${escapeHtml(username)}" /><button class="btn-icon" title="Tắt tiếng tài khoản này" type="submit">🔇</button></form>
      </div>

      <div class="inline-forms">
        <form class="inline-form" method="post" action="${action}/auto-classify">${backFields}
          <button class="btn btn-xs btn-outline btn-ai-tag" type="submit" title="AI tự động phân loại và gán người xử lý cho riêng bài này">⚡ AI Gán</button>
        </form>

        <form class="inline-form" method="post" action="${action}/tag">${backFields}
          <select name="tag" onchange="this.form.submit()" title="Gắn nhãn nhanh">
            <option value="">🏷️ Nhãn</option>
            <option value="Giao hàng"${mention.tag === "Giao hàng" ? " selected" : ""}>📦 Giao hàng</option>
            <option value="Dịch vụ"${mention.tag === "Dịch vụ" ? " selected" : ""}>🎧 Dịch vụ</option>
            <option value="Sản phẩm"${mention.tag === "Sản phẩm" ? " selected" : ""}>💎 Sản phẩm</option>
            <option value="Giá cả"${mention.tag === "Giá cả" ? " selected" : ""}>🏷️ Giá cả</option>
            <option value="Khen ngợi"${mention.tag === "Khen ngợi" ? " selected" : ""}>🌟 Khen ngợi</option>
            <option value="Truyền thông"${mention.tag === "Truyền thông" ? " selected" : ""}>📢 Truyền thông</option>
            <option value="Chung"${mention.tag === "Chung" ? " selected" : ""}>💬 Chung</option>
            <option value="Khác"${mention.tag === "Khác" ? " selected" : ""}>Khác</option>
          </select>
        </form>

        <form class="inline-form" method="post" action="${action}/assign">${backFields}
          <input name="assigned_to" maxlength="40" value="${escapeHtml(mention.assigned_to)}" placeholder="👤 Gán người..." />
          <button class="btn btn-xs btn-outline" type="submit">Gán</button>
        </form>
      </div>
    </div>

    <!-- Form ghi chú nội bộ -->
    <form class="card-note-form" method="post" action="${action}/note">${backFields}
      <input name="note" maxlength="280" value="${escapeHtml(mention.note)}" placeholder="Thêm ghi chú nội bộ cho ca này..." />
      <button class="btn btn-xs btn-outline" type="submit">Lưu</button>
    </form>
  </article>`;
}

export function mentionsCsv(rows: MentionRow[]): string {
  const header = ["id", "topic", "created_at", "author", "username", "sentiment", "likes", "replies", "reposts", "sample", "text"];
  const lines = rows.map((row) =>
    [row.id, row.topic_name, row.created_at, row.author_name, row.author_username, row.sentiment, row.like_count, row.reply_count, row.repost_count, row.sample, row.text]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function briefPage(brief: Brief, notice?: string): string {
  const negative = brief.negative
    .map(
      (post) => `
      <li class="brief-item neg">
        <div class="brief-item-head">
          <strong>@${escapeHtml(post.authorUsername)}</strong>
          <span class="source-topic-tag">${escapeHtml(post.topicName)}</span>
        </div>
        <p>${escapeHtml(post.text)}</p>
      </li>`,
    )
    .join("");

  const authors = brief.newAuthors
    .map(
      (author) => `
      <li class="brief-item">
        <div class="brief-item-head">
          <strong>@${escapeHtml(author.username)}</strong>
          <small>${escapeHtml(author.name)}</small>
        </div>
        <span>${author.posts} bài viết</span>
      </li>`,
    )
    .join("");

  const starred = brief.starred
    .map(
      (post) => `
      <li class="brief-item starred">
        <div class="brief-item-head">
          <strong>@${escapeHtml(post.authorUsername)}</strong>
        </div>
        <p>${escapeHtml(post.text)}</p>
      </li>`,
    )
    .join("");

  return layout(
    "Bản tin Điều hành",
    `
    <header class="deck-top-bar">
      <div class="deck-top-left">
        <div class="brand-row">
          <span class="live-dot"><i class="pulse"></i></span>
          <span class="brand-title">xListening</span>
          <span class="env-badge">Daily Executive Digest</span>
        </div>
        <p class="brand-desc">Bản tin tổng hợp tình hình truyền thông ngày ${escapeHtml(brief.day.split("-").reverse().join("/"))}</p>
      </div>
      <div class="deck-top-right">
        <nav class="deck-nav">
          <a class="nav-btn" href="/">Bàn nghe</a>
          <a class="nav-btn active" href="/brief">Bản tin AI</a>
          <a class="nav-btn" href="/hashtags">Hashtags & Từ khóa</a>
          <a class="nav-btn" href="/compare">So tần số</a>
          <a class="nav-btn" href="/settings">Cài đặt kết nối</a>
        </nav>
        <div class="top-actions">
          <a class="btn btn-outline" href="/brief.md">Tải Markdown</a>
          <form method="post" action="/brief/send-webhook"><button class="btn btn-primary" type="submit">Gửi Webhook</button></form>
        </div>
      </div>
    </header>

    ${notice ? `<div class="deck-alert info">${escapeHtml(notice)}</div>` : ""}

    <!-- Chỉ số tóm tắt -->
    <section class="executive-radar" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 24px;">
      <div class="kpi-box" style="background:var(--card); padding:16px; border-radius:12px; border:1px solid var(--line);">
        <span class="kpi-label">Tổng bài trong ngày</span>
        <strong class="kpi-val">${brief.posts.toLocaleString("vi-VN")}</strong>
      </div>
      <div class="kpi-box" style="background:var(--card); padding:16px; border-radius:12px; border:1px solid var(--line);">
        <span class="kpi-label">Ý kiến nghiêng xấu</span>
        <strong class="kpi-val" style="color:var(--copper);">${brief.negative.length}</strong>
      </div>
      <div class="kpi-box" style="background:var(--card); padding:16px; border-radius:12px; border:1px solid var(--line);">
        <span class="kpi-label">Người viết mới</span>
        <strong class="kpi-val">${brief.newAuthors.length}</strong>
      </div>
      <div class="kpi-box" style="background:var(--card); padding:16px; border-radius:12px; border:1px solid var(--line);">
        <span class="kpi-label">Đang ghim quan trọng</span>
        <strong class="kpi-val" style="color:var(--moss);">${brief.starred.length}</strong>
      </div>
    </section>

    <!-- Tóm tắt AI -->
    ${
      brief.aiSummary
        ? `
      <section class="ai-executive-box">
        <div class="ai-box-head">
          <span class="ai-badge">🤖 AI Executive Summary</span>
          <h3>Tóm tắt & Đánh giá Khủng hoảng</h3>
        </div>
        <div class="ai-box-body">
          ${escapeHtml(brief.aiSummary).replaceAll("\n", "<br />")}
        </div>
      </section>`
        : ""
    }

    <!-- Chi tiết 3 danh mục -->
    <div class="deck-admin-grid" style="margin-top: 24px;">
      <div class="admin-card">
        <div class="admin-card-head">
          <h3 style="color:var(--copper);">🔴 Ý kiến Nghiêng xấu (${brief.negative.length})</h3>
        </div>
        <ul class="brief-list">${negative || `<li class="empty-small">Không có bài viết tiêu cực nào hôm nay.</li>`}</ul>
      </div>

      <div class="admin-card">
        <div class="admin-card-head">
          <h3>👤 Người viết lần đầu (${brief.newAuthors.length})</h3>
        </div>
        <ul class="brief-list">${authors || `<li class="empty-small">Không có người viết mới.</li>`}</ul>
      </div>

      <div class="admin-card">
        <div class="admin-card-head">
          <h3>⭐ Đang ghim theo dõi (${brief.starred.length})</h3>
        </div>
        <ul class="brief-list">${starred || `<li class="empty-small">Không có bài ghim.</li>`}</ul>
      </div>
    </div>
    `,
  );
}

export function comparePage(model: { topics: Topic[]; left: string; right: string; series: { day: string; left: DayCount; right: DayCount }[] }): string {
  const options = (selected: string) =>
    model.topics
      .map((topic) => `<option value="${escapeHtml(topic.id)}"${topic.id === selected ? " selected" : ""}>${escapeHtml(topic.name)}</option>`)
      .join("");
  const leftName = model.topics.find((topic) => topic.id === model.left)?.name ?? "Tần số A";
  const rightName = model.topics.find((topic) => topic.id === model.right)?.name ?? "Tần số B";
  const max = Math.max(1, ...model.series.flatMap((row) => [row.left.posts, row.right.posts]));

  const bars = model.series
    .map((row) => {
      const leftHeight = Math.max(8, Math.round((row.left.posts / max) * 100));
      const rightHeight = Math.max(8, Math.round((row.right.posts / max) * 100));
      return `
        <div class="compare-bar-col" title="${escapeHtml(row.day)}">
          <div class="compare-bars-pair">
            <div class="cbar left-bar" style="height:${leftHeight}%" title="${escapeHtml(leftName)}: ${row.left.posts} bài"></div>
            <div class="cbar right-bar" style="height:${rightHeight}%" title="${escapeHtml(rightName)}: ${row.right.posts} bài"></div>
          </div>
          <span class="cbar-date">${escapeHtml(row.day.slice(5))}</span>
          <small class="cbar-detail">${row.left.posts} vs ${row.right.posts}</small>
        </div>`;
    })
    .join("");

  return layout(
    "So tần số",
    `
    <header class="deck-top-bar">
      <div class="deck-top-left">
        <div class="brand-row">
          <span class="live-dot"><i class="pulse"></i></span>
          <span class="brand-title">xListening</span>
          <span class="env-badge">Benchmarking</span>
        </div>
        <p class="brand-desc">So sánh biến động thảo luận 7 ngày giữa hai tần số</p>
      </div>
      <div class="deck-top-right">
        <nav class="deck-nav">
          <a class="nav-btn" href="/">Bàn nghe</a>
          <a class="nav-btn" href="/brief">Bản tin AI</a>
          <a class="nav-btn" href="/hashtags">Hashtags & Từ khóa</a>
          <a class="nav-btn active" href="/compare">So tần số</a>
          <a class="nav-btn" href="/settings">Cài đặt kết nối</a>
        </nav>
      </div>
    </header>

    <div class="admin-card" style="margin-bottom: 24px;">
      <form class="compare-select-form" method="get" action="/compare">
        <label>Tần số A (Màu Cam)
          <select name="left">${options(model.left)}</select>
        </label>
        <label>Tần số B (Màu Xanh Rêu)
          <select name="right">${options(model.right)}</select>
        </label>
        <button class="btn btn-primary" type="submit">So sánh ngay</button>
      </form>
    </div>

    <div class="radar-card" style="margin-bottom: 24px;">
      <div class="compare-legend">
        <span><i class="dot-legend left"></i> <strong>${escapeHtml(leftName)}</strong></span>
        <span><i class="dot-legend right"></i> <strong>${escapeHtml(rightName)}</strong></span>
      </div>
      <div class="compare-chart-wrapper">
        ${bars}
      </div>
    </div>
    `,
  );
}

export type HashtagsPageModel = {
  analytics: HashtagAnalyticsResult;
  days: number;
  activeTopic?: string;
  topics: Topic[];
  notice?: string;
};

export function hashtagsPage(model: HashtagsPageModel): string {
  const { analytics, days, activeTopic, topics, notice } = model;

  const topicOptions = topics
    .map(
      (t) =>
        `<option value="${escapeHtml(t.id)}"${t.id === activeTopic ? " selected" : ""}>${escapeHtml(t.name)}</option>`,
    )
    .join("");

  const rows = analytics.list
    .map((h, i) => {
      const statusBadge =
        h.sentimentStatus === "warning"
          ? `<span class="tag-status-badge warning" title="Tỷ lệ tiêu cực ≥ 30%">🚨 Cảnh báo (${h.negPct}% xấu)</span>`
          : h.sentimentStatus === "positive"
            ? `<span class="tag-status-badge pos">🟢 Tích cực (${h.posPct}%)</span>`
            : `<span class="tag-status-badge neu">⚪ Trung tính</span>`;

      const authors = h.topAuthors.length > 0 ? h.topAuthors.map((a) => `@${escapeHtml(a)}`).join(", ") : "—";

      return `
      <tr class="hashtag-tr" style="animation-delay:${Math.min(i * 20, 250)}ms">
        <td class="col-hashtag">
          <a class="hashtag-link-badge" href="/?search=${encodeURIComponent(h.tag)}${activeTopic ? `&topic=${encodeURIComponent(activeTopic)}` : ""}" title="Xem các bài viết chứa ${escapeHtml(h.tag)}">
            <span class="hash-symbol">#</span>${escapeHtml(h.cleanTag)}
          </a>
        </td>
        <td class="col-status">${statusBadge}</td>
        <td class="col-posts">
          <strong>${h.totalPosts.toLocaleString("vi-VN")}</strong> bài
        </td>
        <td class="col-sentiment">
          <div class="mini-feelbar-wrap" title="Tốt: ${h.positivePosts} (${h.posPct}%) · Xấu: ${h.negativePosts} (${h.negPct}%) · Trung tính: ${h.neutralPosts} (${h.neuPct}%)">
            <div class="mini-feelbar-track">
              <div class="mini-bar-pos" style="width:${h.posPct}%"></div>
              <div class="mini-bar-neg" style="width:${h.negPct}%"></div>
              <div class="mini-bar-neu" style="width:${h.neuPct}%"></div>
            </div>
            <div class="mini-feelbar-labels">
              <span class="lbl-pos">${h.posPct}%</span>
              <span class="lbl-neg">${h.negPct}%</span>
              <span class="lbl-neu">${h.neuPct}%</span>
            </div>
          </div>
        </td>
        <td class="col-engagement">❤️ ${h.engagement.toLocaleString("vi-VN")}</td>
        <td class="col-authors">${authors}</td>
        <td class="col-actions">
          <div class="hashtag-action-btns">
            <a class="btn btn-xs btn-outline" href="/?search=${encodeURIComponent(h.tag)}${activeTopic ? `&topic=${encodeURIComponent(activeTopic)}` : ""}">🔍 Xem tin</a>
            <form method="post" action="/topics" style="display:inline-block;">
              <input type="hidden" name="name" value="Theo dõi ${escapeHtml(h.tag)}" />
              <input type="hidden" name="source" value="x" />
              <input type="hidden" name="query" value="${escapeHtml(h.tag)}" />
              <button class="btn btn-xs btn-primary" type="submit" title="Tạo tần số lắng nghe riêng cho hashtag này">+ Tần số</button>
            </form>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  return layout(
    "Phân tích Hashtags & Từ khóa",
    `
    <header class="deck-top-bar">
      <div class="deck-top-left">
        <div class="brand-row">
          <span class="live-dot"><i class="pulse"></i></span>
          <span class="brand-title">xListening</span>
          <span class="env-badge">Hashtag Intelligence</span>
        </div>
        <p class="brand-desc">Lắng nghe, đo lường và dự báo rủi ro theo Từ khóa & Hashtags đa nền tảng</p>
      </div>
      <div class="deck-top-right">
        <nav class="deck-nav">
          <a class="nav-btn" href="/">Bàn nghe</a>
          <a class="nav-btn" href="/brief">Bản tin AI</a>
          <a class="nav-btn active" href="/hashtags">Hashtags & Từ khóa</a>
          <a class="nav-btn" href="/compare">So tần số</a>
          <a class="nav-btn" href="/settings">Cài đặt kết nối</a>
        </nav>
        <div class="top-actions">
          <form method="post" action="/listen">
            <button class="btn btn-primary" type="submit">⚡ Lắng nghe ngay</button>
          </form>
          <form method="post" action="/logout">
            <button class="btn btn-outline" type="submit">Thoát</button>
          </form>
        </div>
      </div>
    </header>

    ${notice ? `<div class="deck-alert info">ℹ️ ${escapeHtml(notice)}</div>` : ""}

    <!-- KHU VỰC BỘ LỌC THỜI GIAN VÀ TẦN SỐ -->
    <section class="deck-ribbon" style="margin-bottom: 20px;">
      <form class="ribbon-filter-bar" method="get" action="/hashtags" style="width: 100%; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div class="filter-group">
          <label style="font-size:0.82rem; font-weight:600; color:var(--ink-soft); display:flex; align-items:center; gap:6px;">
            <span>Khung thời gian:</span>
            <select name="days" onchange="this.form.submit()">
              <option value="1"${days === 1 ? " selected" : ""}>24 giờ qua</option>
              <option value="7"${days === 7 ? " selected" : ""}>7 ngày qua</option>
              <option value="30"${days === 30 ? " selected" : ""}>30 ngày qua</option>
            </select>
          </label>

          <label style="font-size:0.82rem; font-weight:600; color:var(--ink-soft); display:flex; align-items:center; gap:6px;">
            <span>Tần số:</span>
            <select name="topic" onchange="this.form.submit()">
              <option value="">Tất cả tần số</option>
              ${topicOptions}
            </select>
          </label>
        </div>
        <div class="ribbon-export">
          <a class="btn btn-sm btn-outline" href="/api/hashtags?days=${days}${activeTopic ? `&topic=${encodeURIComponent(activeTopic)}` : ""}" target="_blank">📥 Xuất JSON</a>
        </div>
      </form>
    </section>

    <!-- THẺ KPI HASHTAG INTELLIGENCE -->
    <section class="executive-radar" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); margin-bottom: 22px;">
      <div class="radar-card">
        <span class="kpi-label">Tổng số Hashtag ghi nhận</span>
        <strong class="kpi-val">${analytics.totalHashtagsCount.toLocaleString("vi-VN")}</strong>
        <span class="radar-sub">Xuất hiện trong ${days} ngày qua</span>
      </div>
      <div class="radar-card">
        <span class="kpi-label">🚀 Hashtag thịnh hành nhất</span>
        <strong class="kpi-val" style="font-size:1.35rem; color:var(--moss);">${analytics.topHashtag ? escapeHtml(analytics.topHashtag.tag) : "Chưa có"}</strong>
        <span class="radar-sub">${analytics.topHashtag ? `${analytics.topHashtag.totalPosts} bài viết · ❤️ ${analytics.topHashtag.engagement} tương tác` : "Chưa ghi nhận hashtag"}</span>
      </div>
      <div class="radar-card">
        <span class="kpi-label">🚨 Điểm nóng cần chú ý</span>
        <strong class="kpi-val" style="font-size:1.35rem; color:${analytics.riskyHashtag ? "var(--copper)" : "var(--moss)"};">${analytics.riskyHashtag ? escapeHtml(analytics.riskyHashtag.tag) : "Trạng thái bình ổn"}</strong>
        <span class="radar-sub">${analytics.riskyHashtag ? `${analytics.riskyHashtag.negPct}% bài nghiêng xấu (${analytics.riskyHashtag.negativePosts} bài)` : "Không có hashtag rủi ro cao"}</span>
      </div>
      <div class="radar-card">
        <span class="kpi-label">💬 Tổng tương tác Hashtag</span>
        <strong class="kpi-val">${analytics.list.reduce((acc, h) => acc + h.engagement, 0).toLocaleString("vi-VN")}</strong>
        <span class="radar-sub">Likes, Shares, Comments</span>
      </div>
    </section>

    <!-- BẢNG MA TRẬN HASHTAG & TỪ KHÓA CHI TIẾT -->
    <section class="hashtag-table-container">
      <div class="hashtag-table-head">
        <div>
          <h3>Bảng Xếp hạng & Đánh giá Sắc thái Hashtag</h3>
          <p class="table-sub">Phát hiện sớm các trào lưu mới, đánh giá rủi ro truyền thông và kích hoạt tần số theo dõi tự động</p>
        </div>
      </div>
      <div class="table-responsive">
        <table class="hashtag-table">
          <thead>
            <tr>
              <th>Hashtag</th>
              <th>Đánh giá</th>
              <th>Thảo luận</th>
              <th style="min-width: 140px;">Phổ cảm xúc (% Tốt / Xấu / Trung tính)</th>
              <th>Tương tác</th>
              <th>Tài khoản tiêu biểu</th>
              <th style="text-align: right;">Hành động</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows ||
              `<tr>
                <td colspan="7" class="table-empty">
                  <p>Chưa ghi nhận hashtag nào trong khung thời gian này.</p>
                  <small>Thử chọn khung thời gian 30 ngày hoặc thêm các bài viết chứa #hashtag để phân tích.</small>
                </td>
              </tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
    `,
  );
}

export function settingsPage(config: AppConfig, notice?: string): string {
  return layout(
    "Cài đặt Bàn nghe",
    `
    <header class="deck-top-bar">
      <div class="deck-top-left">
        <div class="brand-row">
          <span class="live-dot"><i class="pulse"></i></span>
          <span class="brand-title">xListening</span>
          <span class="env-badge">System Settings</span>
        </div>
        <p class="brand-desc">Cấu hình kết nối API, Cookie phiên, AI Model và Thông báo tự động</p>
      </div>
      <div class="deck-top-right">
        <nav class="deck-nav">
          <a class="nav-btn" href="/">Bàn nghe</a>
          <a class="nav-btn" href="/brief">Bản tin AI</a>
          <a class="nav-btn" href="/hashtags">Hashtags & Từ khóa</a>
          <a class="nav-btn active" href="/settings">Cài đặt kết nối</a>
        </nav>
        <form method="post" action="/logout"><button class="btn btn-outline" type="submit">Thoát</button></form>
      </div>
    </header>

    ${notice ? `<div class="deck-alert info">${escapeHtml(notice)}</div>` : ""}

    <form class="settings-form" method="post" action="/settings">
      <div class="settings-grid">
        <div class="settings-card">
          <div class="settings-card-head">
            <span class="platform-icon">🐦</span>
            <div>
              <h3>X (Twitter)</h3>
              <p class="hint">Khuyến nghị dùng Cookie để không cần chi phí $100/tháng.</p>
            </div>
          </div>
          <label>Cookie auth_token
            <input type="password" name="TWITTER_AUTH_TOKEN" value="${escapeHtml(config.TWITTER_AUTH_TOKEN)}" placeholder="F12 -> Cookies -> auth_token" />
            ${config.TWITTER_AUTH_TOKEN.trim() ? `<span style="display:block; margin-top:4px; color:var(--moss); font-size:0.76rem; font-weight:600;">✓ Đã lưu (${config.TWITTER_AUTH_TOKEN.trim().length} ký tự)</span>` : `<span style="display:block; margin-top:4px; color:var(--copper); font-size:0.76rem;">⚠️ Chưa có - Lấy từ F12 -> Cookies -> auth_token</span>`}
          </label>
          <label>Cookie ct0 (CSRF token)
            <input type="password" name="TWITTER_CT0" value="${escapeHtml(config.TWITTER_CT0)}" placeholder="F12 -> Cookies -> ct0" />
            ${config.TWITTER_CT0.trim() ? `<span style="display:block; margin-top:4px; color:var(--moss); font-size:0.76rem; font-weight:600;">✓ Đã lưu (${config.TWITTER_CT0.trim().length} ký tự)</span>` : `<span style="display:block; margin-top:4px; color:var(--copper); font-size:0.76rem; font-weight:600;">⚠️ Chưa có - X bắt buộc cần cả ct0 để quét bài (F12 -> Cookies -> ct0)</span>`}
          </label>
          <label>Hoặc Bearer Token X API v2 (Nếu có)
            <input type="password" name="X_BEARER_TOKEN" value="${escapeHtml(config.X_BEARER_TOKEN)}" placeholder="Bearer token chính thức" />
          </label>
        </div>

        <div class="settings-card">
          <div class="settings-card-head">
            <span class="platform-icon">👤</span>
            <div>
              <h3>Facebook Fanpage</h3>
              <p class="hint">Khuyến nghị dùng Cookie để đọc bài công khai không cần App Review.</p>
            </div>
          </div>
          <label>Cookie Facebook (c_user & xs)
            <textarea name="FACEBOOK_COOKIE" rows="3" placeholder="c_user=...; xs=...;">${escapeHtml(config.FACEBOOK_COOKIE)}</textarea>
            ${config.FACEBOOK_COOKIE.trim() ? `<span style="display:block; margin-top:4px; color:var(--moss); font-size:0.76rem; font-weight:600;">✓ Đã lưu (${config.FACEBOOK_COOKIE.trim().length} ký tự)</span>` : `<span style="display:block; margin-top:4px; color:var(--copper); font-size:0.76rem;">Chưa có</span>`}
          </label>
          <label>Hoặc Page Access Token (Nếu có)
            <input type="password" name="FACEBOOK_ACCESS_TOKEN" value="${escapeHtml(config.FACEBOOK_ACCESS_TOKEN)}" placeholder="Token Graph API" />
          </label>
        </div>

        <div class="settings-card">
          <div class="settings-card-head">
            <span class="platform-icon">🧵</span>
            <div>
              <h3>Meta Threads & YouTube</h3>
              <p class="hint">Tích hợp đa nguồn dữ liệu.</p>
            </div>
          </div>
          <label>Threads User Access Token
            <input type="password" name="THREADS_ACCESS_TOKEN" value="${escapeHtml(config.THREADS_ACCESS_TOKEN)}" placeholder="Threads Graph API Token" />
          </label>
          <label>YouTube Data API v3 Key
            <input type="password" name="YOUTUBE_API_KEY" value="${escapeHtml(config.YOUTUBE_API_KEY)}" placeholder="AIzaSy..." />
          </label>
        </div>

        <div class="settings-card">
          <div class="settings-card-head">
            <span class="platform-icon">🤖</span>
            <div>
              <h3>Trí tuệ Nhân tạo & Tóm tắt AI</h3>
              <p class="hint">Hỗ trợ OpenAI, Gemini, Groq, Ollama.</p>
            </div>
          </div>
          <label>LLM API Key
            <input type="password" name="LLM_API_KEY" value="${escapeHtml(config.LLM_API_KEY)}" placeholder="sk-..." />
          </label>
          <label>Base URL
            <input type="text" name="LLM_BASE_URL" value="${escapeHtml(config.LLM_BASE_URL)}" placeholder="https://api.openai.com/v1" />
          </label>
          <label>Tên Model
            <input type="text" name="LLM_MODEL" value="${escapeHtml(config.LLM_MODEL)}" placeholder="gpt-4o-mini" />
          </label>
        </div>

        <div class="settings-card">
          <div class="settings-card-head">
            <span class="platform-icon">🔔</span>
            <div>
              <h3>Chuông & Webhook Outbound</h3>
              <p class="hint">Nhận thông báo tự động khi có khủng hoảng.</p>
            </div>
          </div>
          <label>Webhook URL (Discord, Slack, Generic)
            <input type="url" name="ALERT_WEBHOOK_URL" value="${escapeHtml(config.ALERT_WEBHOOK_URL)}" placeholder="https://discord.com/api/webhooks/... hoặc https://hooks.slack.com/..." />
          </label>
          <label class="check-label">
            <input type="checkbox" name="DESKTOP_NOTIFY" value="1"${config.DESKTOP_NOTIFY === "1" ? " checked" : ""} />
            Bật thông báo trên máy tính (Desktop Notification)
          </label>
        </div>

        <div class="settings-card">
          <div class="settings-card-head">
            <span class="platform-icon">⏱️</span>
            <div>
              <h3>Chu kỳ Lắng nghe & Giới hạn</h3>
              <p class="hint">Tần suất làm mới dữ liệu nền.</p>
            </div>
          </div>
          <label>Khoảng cách quét tự động (phút, tối thiểu 5)
            <input type="number" name="LISTEN_INTERVAL_MINUTES" min="5" max="1440" value="${config.LISTEN_INTERVAL_MINUTES}" />
          </label>
          <label>Số bài tối đa mỗi lần hỏi X (10 – 100)
            <input type="number" name="SEARCH_MAX_RESULTS" min="10" max="100" value="${config.SEARCH_MAX_RESULTS}" />
          </label>
        </div>
      </div>

      <div class="settings-footer-actions">
        <button class="btn btn-primary" type="submit">💾 Lưu cài đặt hệ thống</button>
        <span class="hint">Cài đặt được lưu vào SQLite và áp dụng ngay lập tức mà không cần khởi động lại dịch vụ.</span>
      </div>
    </form>
    `,
  );
}

function queueButton(action: string, backFields: string, queue: string, label: string, current: string): string {
  const selected = current === queue ? " active" : "";
  return `<form class="queue-btn-form" method="post" action="${action}/queue">${backFields}<input type="hidden" name="queue" value="${queue}" /><button class="btn-q${selected}" type="submit">${label}</button></form>`;
}

function formatWhen(iso: string): string {
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

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · xListening Executive Deck</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #f8f6f0;
      --paper: #faf8f4;
      --card: #ffffff;
      --ink: #1c1917;
      --ink-soft: #44403c;
      --muted: #78716c;
      --line: #e6dfd5;
      --line-subtle: #f0ebe2;
      --copper: #c2410c;
      --copper-bg: #fff7ed;
      --copper-border: #fed7aa;
      --moss: #15803d;
      --moss-bg: #f0fdf4;
      --moss-border: #bbf7d0;
      --clay: #991b1b;
      --primary: #292524;
      --primary-hover: #1c1917;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.04);
      --shadow-lg: 0 10px 25px rgba(0,0,0,0.07);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      color: var(--ink);
      font-family: "Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      background:
        radial-gradient(circle at 10% -5%, #fdebd7 0, transparent 40%),
        radial-gradient(circle at 90% 10%, #eef4eb 0, transparent 35%),
        linear-gradient(180deg, #fdfbf7 0%, var(--bg) 40%, #f4f0e6 100%);
    }

    /* SUBTLE MESH PATTERN */
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image: repeating-linear-gradient(0deg, transparent, transparent 31px, rgba(28, 25, 23, 0.025) 32px);
      z-index: 0;
    }

    main {
      position: relative;
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px 28px 80px;
      z-index: 1;
    }

    /* TOP BAR / NAV */
    .deck-top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 20px;
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .live-dot {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .pulse {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--moss);
      display: inline-block;
      box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.2);
      animation: beat 2s ease-in-out infinite;
    }
    @keyframes beat { 50% { transform: scale(0.8); opacity: 0.6; } }
    .brand-title {
      font-size: 1.45rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--ink);
    }
    .env-badge {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.72rem;
      font-weight: 600;
      background: #f0ebe2;
      color: var(--ink-soft);
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid var(--line);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .brand-desc {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 0.88rem;
    }

    .deck-top-right {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
    }
    .deck-nav {
      display: flex;
      gap: 6px;
      background: rgba(230, 223, 213, 0.45);
      padding: 4px;
      border-radius: 999px;
      border: 1px solid var(--line);
    }
    .nav-btn {
      color: var(--ink-soft);
      text-decoration: none;
      font-size: 0.86rem;
      font-weight: 500;
      padding: 6px 14px;
      border-radius: 999px;
      transition: all 0.15s ease;
    }
    .nav-btn:hover {
      background: rgba(255, 255, 255, 0.6);
      color: var(--ink);
    }
    .nav-btn.active {
      background: var(--card);
      color: var(--ink);
      font-weight: 600;
      box-shadow: var(--shadow-sm);
    }
    .top-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    /* BUTTONS */
    .btn {
      font-family: inherit;
      font-size: 0.88rem;
      font-weight: 500;
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      text-decoration: none;
      transition: all 0.15s ease;
    }
    .btn-primary {
      background: var(--primary);
      color: #faf8f4;
      border-color: var(--primary);
    }
    .btn-primary:hover {
      background: var(--primary-hover);
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
    }
    .btn-outline {
      background: var(--card);
      color: var(--ink);
      border-color: var(--line);
    }
    .btn-outline:hover {
      background: #f7f3ec;
      border-color: #d1c5b5;
    }
    .btn-danger-outline {
      background: var(--card);
      color: var(--clay);
      border-color: #fca5a5;
    }
    .btn-danger-outline:hover {
      background: #fef2f2;
      border-color: var(--clay);
    }
    .btn-sm {
      padding: 5px 10px;
      font-size: 0.82rem;
      border-radius: 6px;
    }
    .btn-xs {
      padding: 3px 8px;
      font-size: 0.78rem;
      border-radius: 4px;
    }
    .btn-block {
      width: 100%;
    }

    /* ALERTS */
    .deck-alert {
      padding: 10px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .deck-alert.info {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e40af;
    }
    .deck-alert.warning {
      background: var(--copper-bg);
      border: 1px solid var(--copper-border);
      color: var(--copper);
    }
    .deck-alert a {
      color: inherit;
      font-weight: 600;
    }

    /* KHU VỰC 1: RADAR TÌNH BÁO (NỬA TRÊN) */
    .executive-radar {
      display: grid;
      grid-template-columns: 1.15fr 1fr 1.15fr;
      gap: 18px;
      margin-bottom: 22px;
    }
    .radar-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 18px 20px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
    }
    .radar-card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }
    .radar-card-head h3 {
      margin: 0;
      font-size: 0.98rem;
      font-weight: 600;
      color: var(--ink);
    }
    .radar-sub {
      font-size: 0.78rem;
      color: var(--muted);
      font-family: "IBM Plex Mono", monospace;
    }
    .radar-pill-counter {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.74rem;
      font-weight: 600;
      background: var(--copper-bg);
      color: var(--copper);
      border: 1px solid var(--copper-border);
      padding: 2px 8px;
      border-radius: 999px;
    }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    .kpi-box {
      background: var(--bg);
      border: 1px solid var(--line-subtle);
      border-radius: 8px;
      padding: 10px 12px;
    }
    .kpi-label {
      display: block;
      font-size: 0.76rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .kpi-val {
      font-family: "IBM Plex Mono", monospace;
      font-size: 1.55rem;
      font-weight: 600;
      line-height: 1.1;
      color: var(--ink);
    }

    /* Feel Bar */
    .feel-container {
      background: var(--bg);
      border: 1px solid var(--line-subtle);
      border-radius: 8px;
      padding: 12px;
    }
    .feel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.82rem;
      margin-bottom: 6px;
    }
    .feel-title {
      font-weight: 500;
      color: var(--ink-soft);
    }
    .feel-percent {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.78rem;
    }
    .feel-bar-track {
      display: flex;
      height: 10px;
      background: #e5ded5;
      border-radius: 999px;
      overflow: hidden;
      margin: 8px 0;
    }
    .feel-bar-pos { background: var(--moss); }
    .feel-bar-neg { background: var(--copper); }
    .feel-bar-neu { background: #a8a29e; }
    .feel-sub {
      display: flex;
      justify-content: space-between;
      font-size: 0.76rem;
      color: var(--muted);
    }

    /* 7 Days Trend */
    .radar-chart-area {
      flex: 1;
      display: flex;
      align-items: flex-end;
      min-height: 110px;
      padding-bottom: 6px;
    }
    .radar-bars-wrapper {
      display: flex;
      gap: 8px;
      width: 100%;
      height: 100px;
      align-items: flex-end;
    }
    .radar-bar-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
      justify-content: flex-end;
    }
    .radar-bar-track {
      width: 100%;
      max-width: 22px;
      height: 70px;
      background: #f0ebe2;
      border-radius: 4px;
      display: flex;
      align-items: flex-end;
      overflow: hidden;
    }
    .radar-bar-fill {
      width: 100%;
      background: #d97706;
      border-radius: 3px 3px 0 0;
      transition: height 0.3s ease;
    }
    .radar-bar-val {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--ink);
      margin-top: 4px;
    }
    .radar-bar-lbl {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.68rem;
      color: var(--muted);
    }
    .voices-tray {
      border-top: 1px solid var(--line-subtle);
      padding-top: 10px;
      margin-top: 10px;
      font-size: 0.8rem;
    }
    .tray-title {
      font-weight: 500;
      color: var(--muted);
      margin-right: 6px;
    }
    .voices-chips {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .voice-chip {
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 2px 7px;
      font-size: 0.74rem;
      display: inline-flex;
      gap: 4px;
    }
    .voice-chip strong { color: var(--ink); }
    .voice-chip small { color: var(--muted); }

    /* Alarms Area */
    .alarms-scroll-area {
      flex: 1;
      overflow-y: auto;
      max-height: 240px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .alarm-item {
      background: var(--copper-bg);
      border: 1px solid var(--copper-border);
      border-left: 4px solid var(--copper);
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
    }
    .alarm-header {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 4px;
    }
    .alarm-badge {
      font-weight: 600;
      font-size: 0.82rem;
      color: var(--copper);
    }
    .alarm-meta {
      font-size: 0.78rem;
      color: var(--muted);
    }
    .alarm-text {
      margin: 0;
      font-size: 0.86rem;
      color: var(--ink);
      line-height: 1.35;
    }
    .alarm-reason {
      color: var(--copper);
      font-size: 0.74rem;
      font-style: italic;
    }
    .empty-alarms {
      text-align: center;
      padding: 30px 16px;
      color: var(--muted);
    }
    .shield-icon {
      font-size: 1.8rem;
      display: block;
      margin-bottom: 6px;
    }

    /* Word Cloud & Topic Clusters */
    .radar-cloud-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 16px 20px;
      box-shadow: var(--shadow-sm);
      margin-bottom: 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .cloud-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      border-bottom: 1px solid var(--line-subtle);
      padding-bottom: 12px;
    }
    .cloud-card-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .cloud-card-title h3 {
      margin: 0;
      font-size: 0.96rem;
      font-weight: 600;
      color: var(--ink);
    }
    .cloud-icon { font-size: 1.2rem; }
    .cloud-sub {
      font-size: 0.78rem;
      color: var(--muted);
      display: block;
      margin-top: 2px;
    }
    .cloud-clusters-tray {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .cloud-cluster-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 500;
      background: var(--bg);
      border: 1px solid var(--line);
      color: var(--ink-soft);
      transition: all 0.15s ease;
    }
    .cloud-cluster-badge:hover {
      border-color: var(--moss);
      background: #f0fdf4;
      color: var(--moss);
      transform: translateY(-1px);
    }
    .cloud-cluster-badge.positive {
      border-color: #bbf7d0;
      background: #f0fdf4;
      color: #15803d;
    }
    .cloud-cluster-badge.negative {
      border-color: #fecaca;
      background: #fef2f2;
      color: #b91c1c;
    }
    .cluster-num {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.72rem;
      opacity: 0.85;
      background: rgba(0,0,0,0.06);
      padding: 1px 5px;
      border-radius: 6px;
    }
    .cloud-words-wrapper {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
      justify-content: flex-start;
      min-height: 60px;
      padding: 4px 0;
    }
    .cloud-word-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      padding: 4px 10px;
      border-radius: 8px;
      font-weight: 500;
      line-height: 1.2;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .cloud-word-chip:hover {
      transform: scale(1.06);
      box-shadow: var(--shadow-sm);
    }
    .cloud-word-chip.positive {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }
    .cloud-word-chip.negative {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }
    .cloud-word-chip.neutral {
      background: #f8fafc;
      color: #334155;
      border: 1px solid #e2e8f0;
    }
    .chip-count {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.72em;
      opacity: 0.75;
      background: rgba(0,0,0,0.07);
      padding: 1px 5px;
      border-radius: 4px;
    }
    .empty-cloud {
      color: var(--muted);
      font-size: 0.84rem;
      margin: 0;
    }
    .btn-ai-dispatch {
      background: linear-gradient(135deg, #15803d, #047857);
      border-color: #047857;
      color: #fff !important;
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(4, 120, 87, 0.3);
    }
    .btn-ai-dispatch:hover {
      background: linear-gradient(135deg, #166534, #065f46);
    }
    .btn-ai-tag {
      font-size: 0.72rem !important;
      padding: 3px 6px !important;
      background: #eff6ff !important;
      color: #1d4ed8 !important;
      border-color: #bfdbfe !important;
      font-weight: 600;
    }
    .btn-ai-tag:hover {
      background: #dbeafe !important;
      border-color: #93c5fd !important;
    }

    /* KHU VỰC 2: RIBBON FILTER BAR */
    .deck-ribbon {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px 18px;
      margin-bottom: 22px;
      box-shadow: var(--shadow-sm);
    }
    .ribbon-tabs {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line-subtle);
      margin-bottom: 12px;
    }
    .tab-link {
      color: var(--muted);
      text-decoration: none;
      font-size: 0.86rem;
      font-weight: 500;
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid transparent;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .tab-link:hover {
      background: var(--bg);
      color: var(--ink);
    }
    .tab-link.active {
      background: var(--primary);
      color: #faf8f4;
      font-weight: 600;
    }

    .ribbon-filter-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .filter-group {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      flex: 1;
    }
    .filter-group select, .filter-group input {
      font-family: inherit;
      font-size: 0.84rem;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--bg);
      color: var(--ink);
    }
    .filter-group select:focus, .filter-group input:focus {
      outline: none;
      border-color: #a8a29e;
      background: #ffffff;
    }
    .filter-group .search-input { min-width: 180px; flex: 1; }
    .filter-group .tag-input { max-width: 90px; }
    .filter-group .assignee-input { max-width: 110px; }
    .filter-group .likes-input { max-width: 85px; }
    .btn-clear {
      font-size: 0.82rem;
      color: var(--muted);
      text-decoration: none;
      padding: 4px 8px;
    }
    .btn-clear:hover {
      text-decoration: underline;
      color: var(--ink);
    }

    /* KHU VỰC 3: DUAL-STREAM PROCESSING */
    .deck-dual-streams {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 22px;
      margin-bottom: 28px;
    }
    .stream-column {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .stream-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      border-radius: 10px 10px 0 0;
      border: 1px solid var(--line);
      border-bottom: 0;
    }
    .critical-head {
      background: #fef2f2;
      border-color: #fecaca;
    }
    .natural-head {
      background: #f0fdf4;
      border-color: #bbf7d0;
    }
    .stream-title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stream-header h2 {
      margin: 0;
      font-size: 0.88rem;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .critical-head h2 { color: #991b1b; }
    .natural-head h2 { color: #166534; }
    .stream-counter {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.76rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
    }
    .critical-counter {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fca5a5;
    }
    .natural-counter {
      background: #dcfce7;
      color: #166534;
      border: 1px solid #86efac;
    }
    .stream-subtitle {
      margin: 0;
      padding: 6px 14px;
      font-size: 0.78rem;
      color: var(--muted);
      background: var(--card);
      border-left: 1px solid var(--line);
      border-right: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    .stream-cards-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 12px;
    }

    /* MENTION CARD */
    .deck-mention-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 16px;
      box-shadow: var(--shadow-sm);
      animation: rise 0.35s ease both;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
    .deck-mention-card.is-critical {
      border-left: 4px solid var(--copper);
    }
    .deck-mention-card.starred {
      border-left: 4px solid #f59e0b;
      background: #fffdfa;
    }
    .card-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .author-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .avatar-letter {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: #e7dfd5;
      color: var(--ink);
      font-weight: 600;
      font-size: 0.76rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .author-name {
      font-size: 0.92rem;
      color: var(--ink);
      margin-right: 4px;
    }
    .author-handle {
      font-size: 0.8rem;
      color: var(--muted);
    }
    .card-top-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .card-time {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.74rem;
      color: var(--muted);
    }

    /* Sentiment & Tag Pills */
    .sentiment-pill {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 999px;
    }
    .sentiment-pill.pos { background: var(--moss-bg); color: var(--moss); border: 1px solid var(--moss-border); }
    .sentiment-pill.neg { background: var(--copper-bg); color: var(--copper); border: 1px solid var(--copper-border); }
    .sentiment-pill.neu { background: #f5f5f4; color: #78716c; border: 1px solid #e7e5e4; }
    .assignee-badge {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.72rem;
      font-weight: 500;
      background: #e0f2fe;
      color: #0369a1;
      border: 1px solid #bae6fd;
      padding: 2px 7px;
      border-radius: 999px;
    }
    .tag-badge {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.72rem;
      font-weight: 500;
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
      padding: 2px 7px;
      border-radius: 999px;
    }

    .card-body-text p {
      margin: 0;
      font-size: 0.98rem;
      line-height: 1.5;
      color: var(--ink);
      word-break: break-word;
    }
    .card-note-box {
      background: #fefce8;
      border-left: 3px solid #eab308;
      padding: 6px 10px;
      font-size: 0.84rem;
      color: #854d0e;
      border-radius: 4px;
    }

    .card-meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      font-size: 0.8rem;
      color: var(--muted);
      border-top: 1px solid var(--line-subtle);
      padding-top: 8px;
      flex-wrap: wrap;
    }
    .source-topic-tag {
      font-weight: 500;
      color: var(--ink-soft);
    }
    .stamp-pill {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.68rem;
      font-weight: 600;
      background: #e7e5e4;
      color: #57534e;
      padding: 1px 5px;
      border-radius: 4px;
    }
    .stats-counter {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.76rem;
    }
    .out-link {
      color: var(--ink-soft);
      text-decoration: none;
      font-weight: 500;
      font-size: 0.8rem;
    }
    .out-link:hover {
      text-decoration: underline;
      color: var(--ink);
    }

    /* Actions Bar */
    .card-actions-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      background: var(--bg);
      border-radius: 6px;
      padding: 6px 10px;
    }
    .queue-btns {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .queue-btn-form { margin: 0; }
    .btn-q {
      font-family: inherit;
      font-size: 0.74rem;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid var(--line);
      background: #ffffff;
      color: var(--ink-soft);
      cursor: pointer;
    }
    .btn-q.active {
      background: var(--primary);
      color: #faf8f4;
      border-color: var(--primary);
    }
    .util-btns {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .btn-icon {
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      font-size: 0.86rem;
      padding: 3px 6px;
      border-radius: 4px;
    }
    .btn-icon:hover {
      background: #e7dfd5;
    }
    .inline-forms {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .inline-form {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 0;
    }
    .inline-form select, .inline-form input {
      font-family: inherit;
      font-size: 0.76rem;
      padding: 3px 6px;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: #ffffff;
      color: var(--ink);
      width: auto;
    }
    .card-note-form {
      display: flex;
      gap: 6px;
      margin: 0;
    }
    .card-note-form input {
      flex: 1;
      font-family: inherit;
      font-size: 0.78rem;
      padding: 5px 8px;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: var(--bg);
    }

    .stream-empty {
      background: var(--card);
      border: 1px dashed var(--line);
      border-radius: 10px;
      text-align: center;
      padding: 40px 20px;
      color: var(--muted);
    }
    .stream-empty.safe {
      background: #f0fdf4;
      border-color: #bbf7d0;
      color: #166534;
    }
    .empty-icon {
      font-size: 2rem;
      display: block;
      margin-bottom: 8px;
    }

    /* BẢNG ĐIỀU KHIỂN & CẤU HÌNH (ACCORDION / DETAILS) */
    .deck-admin-details {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      margin-bottom: 22px;
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
    }
    .deck-admin-details[open] {
      box-shadow: var(--shadow-md);
      border-color: #cbd5e1;
    }
    .deck-admin-summary {
      padding: 14px 20px;
      background: #f8fafc;
      font-weight: 600;
      font-size: 0.95rem;
      color: var(--ink);
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
      transition: background 0.15s ease;
    }
    .deck-admin-summary:hover {
      background: #f1f5f9;
    }
    .admin-summary-content {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .admin-summary-title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--ink);
      font-size: 0.94rem;
    }
    .admin-gear-icon {
      font-size: 1.15rem;
    }
    .admin-summary-badges {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .admin-pill {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.74rem;
      background: #ffffff;
      border: 1px solid var(--line);
      padding: 2px 8px;
      border-radius: 999px;
      color: var(--ink-soft);
      font-weight: 500;
    }
    .admin-pill-action {
      font-size: 0.74rem;
      color: var(--moss);
      font-weight: 600;
      text-decoration: underline;
    }
    .summary-arrow {
      font-size: 1.1rem;
      color: var(--muted);
      transition: transform 0.2s ease;
    }
    .deck-admin-details[open] .summary-arrow {
      transform: rotate(180deg);
    }
    .deck-admin-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
      padding: 20px;
      background: var(--bg);
    }
    .admin-card {
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 18px;
    }
    .admin-card-head {
      margin-bottom: 12px;
      border-bottom: 1px solid var(--line-subtle);
      padding-bottom: 8px;
    }
    .admin-card-head h3 {
      margin: 0;
      font-size: 0.94rem;
      font-weight: 600;
      color: var(--ink);
    }
    .admin-form label {
      display: block;
      margin-bottom: 10px;
      font-size: 0.82rem;
      color: var(--muted);
    }
    .admin-form input, .admin-form select, .admin-form textarea {
      width: 100%;
      margin-top: 4px;
      padding: 7px 10px;
      font-family: inherit;
      font-size: 0.86rem;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--bg);
      color: var(--ink);
    }
    .form-row {
      display: flex;
      gap: 10px;
    }
    .form-row > * { flex: 1; }
    .check-label {
      display: flex !important;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      margin-top: 24px;
    }
    .check-label input { width: auto !important; margin: 0 !important; }
    .admin-tool-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 14px;
      max-height: 220px;
      overflow-y: auto;
    }
    .tool-list-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 8px;
      background: var(--bg);
      border-radius: 6px;
      border: 1px solid var(--line-subtle);
    }
    .tool-title-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .source-pill {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.68rem;
      padding: 1px 5px;
      border-radius: 4px;
      background: #e7e5e4;
    }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
    }
    .status-dot.online { background: var(--moss); }
    .status-dot.offline { background: var(--muted); }
    .tool-list-info code {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.74rem;
      color: var(--muted);
      display: block;
      margin-top: 2px;
    }
    .tool-error {
      color: var(--clay);
      font-size: 0.74rem;
      margin: 2px 0 0;
    }
    .tool-list-actions {
      display: flex;
      gap: 4px;
    }
    .tool-text-preview {
      margin: 2px 0 0;
      font-size: 0.78rem;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 240px;
    }
    .admin-divider {
      border: 0;
      border-top: 1px solid var(--line-subtle);
      margin: 14px 0;
    }
    .empty-small {
      color: var(--muted);
      font-size: 0.8rem;
      text-align: center;
      margin: 10px 0;
    }
    .sample-actions {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }

    /* AI EXECUTIVE BOX */
    .ai-executive-box {
      background: #ffffff;
      border: 1px solid #d4c2a8;
      border-left: 5px solid #d97706;
      border-radius: 12px;
      padding: 22px;
      box-shadow: var(--shadow-md);
      margin-bottom: 24px;
    }
    .ai-box-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .ai-badge {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.76rem;
      font-weight: 600;
      background: #fef3c7;
      color: #92400e;
      padding: 3px 8px;
      border-radius: 6px;
    }
    .ai-box-head h3 {
      margin: 0;
      font-size: 1.1rem;
      color: var(--ink);
    }
    .ai-box-body {
      font-size: 0.96rem;
      line-height: 1.65;
      color: var(--ink-soft);
    }

    /* BRIEF LIST */
    .brief-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .brief-item {
      padding: 10px;
      background: var(--bg);
      border-radius: 6px;
      border: 1px solid var(--line-subtle);
    }
    .brief-item.neg {
      border-left: 3px solid var(--copper);
    }
    .brief-item.starred {
      border-left: 3px solid #f59e0b;
    }
    .brief-item-head {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      font-size: 0.82rem;
    }
    .brief-item p {
      margin: 0;
      font-size: 0.88rem;
    }

    /* COMPARE PAGE */
    .compare-select-form {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 14px;
      align-items: flex-end;
    }
    .compare-select-form label {
      display: block;
      font-size: 0.84rem;
      color: var(--muted);
    }
    .compare-select-form select {
      width: 100%;
      margin-top: 4px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--bg);
      font-family: inherit;
    }
    .compare-legend {
      display: flex;
      gap: 20px;
      margin-bottom: 16px;
      font-size: 0.88rem;
    }
    .dot-legend {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 3px;
      margin-right: 6px;
    }
    .dot-legend.left { background: #d97706; }
    .dot-legend.right { background: var(--moss); }
    .compare-chart-wrapper {
      display: flex;
      gap: 12px;
      align-items: flex-end;
      height: 140px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 8px;
    }
    .compare-bar-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
      justify-content: flex-end;
    }
    .compare-bars-pair {
      display: flex;
      gap: 4px;
      align-items: flex-end;
      height: 90px;
      width: 100%;
      justify-content: center;
    }
    .cbar {
      width: 14px;
      border-radius: 3px 3px 0 0;
    }
    .cbar.left-bar { background: #d97706; }
    .cbar.right-bar { background: var(--moss); }
    .cbar-date {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.72rem;
      color: var(--muted);
      margin-top: 4px;
    }
    .cbar-detail {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.68rem;
      color: var(--ink-soft);
    }

    /* SETTINGS PAGE */
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 20px;
      margin-top: 18px;
    }
    .settings-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 22px;
      box-shadow: var(--shadow-sm);
    }
    .settings-card-head {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--line-subtle);
      padding-bottom: 12px;
    }
    .platform-icon { font-size: 1.6rem; }
    .settings-card-head h3 { margin: 0; font-size: 1.05rem; }
    .hint { color: var(--muted); font-size: 0.8rem; margin: 2px 0 0; }
    .settings-card label {
      display: block;
      margin-bottom: 12px;
      font-size: 0.84rem;
      color: var(--ink-soft);
      font-weight: 500;
    }
    .settings-card input, .settings-card textarea {
      width: 100%;
      margin-top: 6px;
      padding: 9px 12px;
      font-family: inherit;
      font-size: 0.88rem;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--bg);
      color: var(--ink);
    }
    .settings-card input:focus, .settings-card textarea:focus {
      outline: none;
      border-color: #a8a29e;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(168, 162, 158, 0.15);
    }
    .settings-footer-actions {
      margin-top: 24px;
      display: flex;
      gap: 14px;
      align-items: center;
      flex-wrap: wrap;
    }

    /* LOGIN PAGE */
    .login-wrapper {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 70vh;
    }
    .login-card {
      width: 100%;
      max-width: 400px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 32px 28px;
      box-shadow: var(--shadow-md);
    }
    .deck-brand {
      text-align: center;
      margin-bottom: 24px;
    }
    .live-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.74rem;
      color: var(--moss);
      background: var(--moss-bg);
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid var(--moss-border);
      margin-bottom: 10px;
    }
    .deck-brand h1 {
      margin: 0;
      font-size: 1.8rem;
      letter-spacing: -0.03em;
    }
    .deck-subtitle {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 0.88rem;
    }
    .login-body label {
      display: block;
      font-size: 0.86rem;
      color: var(--ink-soft);
      font-weight: 500;
      margin-bottom: 16px;
    }
    .login-body input {
      width: 100%;
      margin-top: 6px;
      padding: 10px 12px;
      font-family: inherit;
      font-size: 0.92rem;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--bg);
    }
    .alert-box.error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: var(--clay);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.84rem;
      margin-bottom: 14px;
    }

    /* HASHTAG & KEYWORD ANALYTICS TABLE */
    .hashtag-table-container {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      margin-bottom: 24px;
    }
    .hashtag-table-head {
      padding: 16px 20px;
      border-bottom: 1px solid var(--line-subtle);
      background: #faf6f0;
    }
    .hashtag-table-head h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--ink);
    }
    .table-sub {
      margin: 4px 0 0;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .hashtag-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    .hashtag-table th {
      text-align: left;
      padding: 12px 16px;
      background: var(--bg);
      font-weight: 600;
      font-size: 0.78rem;
      color: var(--muted);
      border-bottom: 1px solid var(--line);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .hashtag-table td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line-subtle);
      vertical-align: middle;
    }
    .hashtag-tr:hover {
      background: #faf7f2;
    }
    .hashtag-link-badge {
      font-family: "IBM Plex Mono", monospace;
      font-weight: 600;
      font-size: 0.94rem;
      color: #0284c7;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      padding: 4px 10px;
      border-radius: 8px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      transition: all 0.15s ease;
    }
    .hashtag-link-badge:hover {
      background: #e0f2fe;
      border-color: #7dd3fc;
      transform: translateY(-1px);
    }
    .hash-symbol {
      opacity: 0.6;
      font-weight: 400;
    }
    .tag-status-badge {
      display: inline-flex;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 0.74rem;
      font-weight: 600;
    }
    .tag-status-badge.pos { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
    .tag-status-badge.warning { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .tag-status-badge.neu { background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; }
    .mini-feelbar-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
      max-width: 180px;
    }
    .mini-feelbar-track {
      display: flex;
      height: 6px;
      border-radius: 999px;
      background: #e5ded5;
      overflow: hidden;
    }
    .mini-bar-pos { background: var(--moss); }
    .mini-bar-neg { background: var(--copper); }
    .mini-bar-neu { background: #a8a29e; }
    .mini-feelbar-labels {
      display: flex;
      justify-content: space-between;
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.7rem;
      color: var(--muted);
    }
    .lbl-pos { color: var(--moss); font-weight: 600; }
    .lbl-neg { color: var(--copper); font-weight: 600; }
    .lbl-neu { color: #78716c; }
    .hashtag-action-btns {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
      align-items: center;
    }
    .table-empty {
      text-align: center;
      padding: 40px 20px;
      color: var(--muted);
    }

    /* RESPONSIVE */
    @media (max-width: 1024px) {
      .executive-radar {
        grid-template-columns: 1fr;
      }
      .deck-dual-streams {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 768px) {
      main { padding: 16px 14px 60px; }
      .deck-top-bar { flex-direction: column; align-items: flex-start; }
      .deck-top-right { width: 100%; justify-content: space-between; }
      .kpi-grid { grid-template-columns: 1fr; }
      .ribbon-filter-bar { flex-direction: column; align-items: stretch; }
      .filter-group { flex-direction: column; align-items: stretch; }
      .filter-group select, .filter-group input { width: 100% !important; max-width: none !important; }
      .compare-select-form { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pulse, .deck-mention-card { animation: none; }
    }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}
