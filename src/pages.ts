import type { AlertHitRow, AlertRule, MentionRow, MentionView, ResponseTemplate, Topic, Voice } from "./db.js";
import type { Brief, DayCount } from "./digest.js";
import type { AppConfig } from "./config.js";
import type { WordCloudItem, TopicCluster } from "./cloud.js";
import type { HashtagAnalyticsResult, HashtagStat } from "./hashtags.js";
import type { LiveSearchResult, LiveSearchItem } from "./social_search.js";
import { uiIcon } from "./icons.js";

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
      <div class="alarm-item heroui-card">
        <div class="alarm-content">
          <div class="alarm-header">
            <span class="heroui-chip heroui-chip-danger">${uiIcon("alert", 13)} ${escapeHtml(hit.alert_name)}</span>
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
      <span class="voice-chip heroui-chip heroui-chip-bordered" title="${escapeHtml(v.author_name)} (@${escapeHtml(v.author_username)})">
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
      const state = topic.active ? "Đang quét" : "Tạm dừng";
      const sourceLabel =
        topic.source === "facebook"
          ? "Facebook"
          : topic.source === "threads"
            ? "Threads"
            : topic.source === "youtube"
              ? "YouTube"
              : topic.source === "web"
                ? "Báo chí"
                : "X (Twitter)";
      return `
      <div class="tool-list-row heroui-card ${topic.active ? "active" : "inactive"}">
        <div class="tool-list-info">
          <div class="tool-title-wrap">
            <strong>${escapeHtml(topic.name)}</strong>
            <span class="source-pill ${topic.source}">${sourceLabel}</span>
            <span class="heroui-chip ${topic.active ? "heroui-chip-success" : "heroui-chip-default"}">
              <i class="heroui-dot"></i> ${state}
            </span>
            ${topic.last_listened_at ? `<small class="text-muted">Quét lúc ${escapeHtml(formatWhen(topic.last_listened_at))}</small>` : ""}
          </div>
          <code>${escapeHtml(topic.query)}${topic.phrase ? ` · bắt buộc: “${escapeHtml(topic.phrase)}”` : ""}</code>
          ${topic.last_error ? `<p class="tool-error">${escapeHtml(topic.last_error)}</p>` : ""}
        </div>
        <div class="tool-list-actions">
          <form method="post" action="/topics/${escapeHtml(topic.id)}/toggle">
            <button class="btn btn-sm btn-outline" type="submit">${topic.active ? "Tạm dừng" : "Bật quét"}</button>
          </form>
          <form method="post" action="/topics/${escapeHtml(topic.id)}/backfill">
            <button class="btn btn-sm btn-outline" type="submit">Lấy 7 ngày</button>
          </form>
          <form method="post" action="/topics/${escapeHtml(topic.id)}/delete" onsubmit="return confirm('Xóa nguồn theo dõi này và toàn bộ tin tức liên quan?')">
            <button class="btn btn-sm btn-danger-flat" type="submit">Xóa</button>
          </form>
        </div>
      </div>`;
    })
    .join("");

  const alertRules = model.alerts
    .map((rule) => {
      const detail =
        rule.kind === "phrase"
          ? `Chứa cụm từ: “${rule.phrase}”`
          : rule.kind === "likes"
            ? `Tương tác ≥ ${rule.min_likes} thích`
            : rule.kind === "velocity"
              ? `Khủng hoảng bùng nổ: ${rule.threshold_count || 3} bài xấu / ${rule.time_window_minutes || 60} phút`
              : "Báo động mọi bài tiêu cực";
      return `
      <div class="tool-list-row heroui-card">
        <div class="tool-list-info">
          <strong>${escapeHtml(rule.name)}</strong>
          <small class="text-muted">${escapeHtml(detail)}</small>
        </div>
        <form method="post" action="/alerts/${escapeHtml(rule.id)}/delete">
          ${backFields}
          <button class="btn btn-sm btn-danger-flat" type="submit">Xóa cảnh báo</button>
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
      <div class="tool-list-row heroui-card">
        <div class="tool-list-info">
          <strong>${escapeHtml(tpl.name)}</strong>
          <p class="tool-text-preview">${escapeHtml(tpl.content)}</p>
        </div>
        <form method="post" action="/templates/${escapeHtml(tpl.id)}/delete">
          ${backFields}
          <button class="btn btn-sm btn-danger-flat" type="submit">Xóa mẫu</button>
        </form>
      </div>`,
    )
    .join("");

  const mutedItems = model.muted
    .map(
      (username) => `
      <div class="tool-list-row heroui-card">
        <div class="tool-list-info">
          <strong>@${escapeHtml(username)}</strong>
        </div>
        <form method="post" action="/mutes/${encodeURIComponent(username)}/delete">
          ${backFields}
          <button class="btn btn-sm btn-outline" type="submit">Bỏ qua / Theo dõi lại</button>
        </form>
      </div>`,
    )
    .join("");

  return layout(
    "Tổng quan & Tin tức",
    `
    <!-- PAGE HERO HEADER (NẰM DƯỚI NAVBAR, KHÔNG BỊ ĐÈ) -->
    <div class="deck-page-header">
      <div class="page-header-title">
        <div class="title-with-badge">
          <h1>${uiIcon("dashboard", 22)} Tổng quan & Dây tin Dư luận</h1>
          <span class="heroui-chip heroui-chip-primary">Giám sát Đa nền tảng</span>
        </div>
        <p class="text-muted">Theo dõi và phân tích cảm xúc thời gian thực trên Facebook, X, Threads, YouTube & Báo chí</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-outline" type="button" onclick="const p=document.getElementById('deck-admin-panel'); if(p){ p.open=!p.open; if(p.open) p.scrollIntoView({behavior:'smooth'}); }">${uiIcon("settings")} Nguồn theo dõi & Cảnh báo (${model.topics.length})</button>
      </div>
    </div>

    ${model.notice ? `<div class="deck-alert info">${uiIcon("info")} ${escapeHtml(model.notice)}</div>` : ""}
    ${model.spike ? `<div class="deck-alert warning">${uiIcon("zap")} <strong>Đột biến phát hiện:</strong> ${escapeHtml(model.spike)}</div>` : ""}
    ${model.xNotice ? `<div class="deck-alert warning">${uiIcon("alert")} ${model.xNotice}</div>` : ""}
    ${model.hasFacebook ? "" : `<div class="deck-alert warning">${uiIcon("alert")} Chưa có cấu hình Facebook Cookie. Vào mục <a href="/settings">Cấu hình kết nối</a> để thêm.</div>`}

    <!-- KHU VỰC 1: RADAR TÌNH BÁO & CẢNH BÁO KHỦNG HOẢNG (NỬA TRÊN) -->
    <section class="executive-radar">
      <!-- Cột 1: Chỉ số 24h & Feelbar -->
      <div class="radar-card radar-kpi-card heroui-card">
        <div class="radar-card-head">
          <div>
            <h3>${uiIcon("chart", 18)} Thống kê tin tức trong 24 giờ qua</h3>
            <span class="radar-sub">Dữ liệu cập nhật thời gian thực</span>
          </div>
          <span class="heroui-chip heroui-chip-success"><i class="heroui-dot"></i> Đang hoạt động</span>
        </div>
        <div class="kpi-grid">
          <div class="kpi-box heroui-card-sub">
            <span class="kpi-label">Tổng số bài viết</span>
            <strong class="kpi-val">${model.stats.mentions.toLocaleString("vi-VN")}</strong>
          </div>
          <div class="kpi-box heroui-card-sub">
            <span class="kpi-label">Số tác giả thảo luận</span>
            <strong class="kpi-val">${model.stats.authors.toLocaleString("vi-VN")}</strong>
          </div>
          <div class="kpi-box heroui-card-sub">
            <span class="kpi-label">Tổng lượt tương tác</span>
            <strong class="kpi-val">${model.stats.engagement.toLocaleString("vi-VN")}</strong>
          </div>
        </div>

        <div class="feel-container">
          <div class="feel-header">
            <span class="feel-title">Tỷ lệ cảm xúc dư luận</span>
            <span class="feel-percent">
              <span class="feel-stat-pos"><span class="stat-dot pos"></span>${pct(model.stats.positive)}% Tích cực</span> · 
              <span class="feel-stat-neg"><span class="stat-dot neg"></span>${pct(model.stats.negative)}% Tiêu cực</span> · 
              <span class="feel-stat-neu"><span class="stat-dot neu"></span>${pct(model.stats.neutral)}% Trung tính</span>
            </span>
          </div>
          <div class="feel-bar-track">
            <div class="feel-bar-pos" style="width: ${pct(model.stats.positive)}%" title="Tích cực: ${model.stats.positive} bài"></div>
            <div class="feel-bar-neg" style="width: ${pct(model.stats.negative)}%" title="Tiêu cực: ${model.stats.negative} bài"></div>
            <div class="feel-bar-neu" style="width: ${pct(model.stats.neutral)}%" title="Trung tính: ${model.stats.neutral} bài"></div>
          </div>
          <div class="feel-sub">
            <span>${model.stats.positive} bài tích cực</span>
            <span>${model.stats.negative} bài tiêu cực</span>
            <span>${model.stats.neutral} bài trung tính</span>
          </div>
        </div>
      </div>

      <!-- Cột 2: Nhịp độ 7 ngày & Tiếng nói hàng đầu -->
      <div class="radar-card radar-trend-card heroui-card">
        <div class="radar-card-head">
          <div>
            <h3>${uiIcon("activity", 18)} Biểu đồ lượng bài 7 ngày qua</h3>
            <span class="radar-sub">Xu hướng biến động theo ngày</span>
          </div>
          <span class="heroui-chip heroui-chip-primary">7 ngày</span>
        </div>
        <div class="radar-chart-area">
          <div class="radar-bars-wrapper">
            ${bars || `<p class="empty-radar">Chưa có bài viết trong 7 ngày để dựng biểu đồ.</p>`}
          </div>
        </div>
        <div class="voices-tray">
          <span class="tray-title">Tác giả thảo luận sôi nổi nhất:</span>
          <div class="voices-chips">
            ${voices || `<small class="text-muted">Chưa ghi nhận tác giả tiêu biểu</small>`}
          </div>
        </div>
      </div>

      <!-- Cột 3: Báo động nóng & Cảnh báo khẩn -->
      <div class="radar-card radar-alarms-card heroui-card">
        <div class="radar-card-head">
          <div>
            <h3>${uiIcon("alert", 18)} Cảnh báo khẩn & Điểm nóng</h3>
            <span class="radar-sub">Các bài viết vi phạm điều kiện an toàn</span>
          </div>
          <span class="heroui-chip ${model.hits.length > 0 ? "heroui-chip-danger" : "heroui-chip-success"}">
            ${model.hits.length} cảnh báo
          </span>
        </div>
        <div class="alarms-scroll-area">
          ${
            hits ||
            `<div class="empty-alarms">
              <span class="shield-icon">${uiIcon("shieldCheck", 36)}</span>
              <p><strong>Tình hình bình ổn</strong></p>
              <small>Không có bài viết tiêu cực bùng nổ hay kích hoạt cảnh báo rủi ro nào.</small>
            </div>`
          }
        </div>
      </div>
    </section>

    ${renderWordCloudSection(model.wordCloud, model.activeTopic)}

    ${renderAdminPanel(model, topicItems, alertTopics, alertRules, templateItems, mutedItems, backFields)}

    <!-- KHU VỰC 2: THANH BỘ LỌC BÀI VIẾT & ĐIỀU PHỐI (HEROUI RIBBON) -->
    <section class="deck-ribbon heroui-card">
      <div class="ribbon-tabs">
        ${viewLink("wire", "Tất cả bài viết")}
        ${viewLink("new", `Chưa đọc ${model.queueNew ? `(${model.queueNew})` : ""}`)}
        ${viewLink("reading", "Đang theo dõi")}
        ${viewLink("done", "Đã giải quyết")}
        ${viewLink("starred", `Đã lưu ý ${uiIcon("starFilled", 13)}`)}
        ${viewLink("hidden", "Đã ẩn")}
      </div>

      <form class="ribbon-filter-bar" method="get" action="/">
        <input type="hidden" name="view" value="${escapeHtml(model.view === "wire" ? "" : model.view)}" />
        <div class="filter-group">
          <select class="heroui-select" name="topic" title="Nguồn theo dõi">
            <option value="">Tất cả nguồn tin</option>
            ${topicOptions}
          </select>
          <select class="heroui-select" name="sentiment" title="Cảm xúc">
            <option value="">Tất cả cảm xúc</option>
            <option value="positive"${model.sentimentFilter === "positive" ? " selected" : ""}>Tích cực</option>
            <option value="negative"${model.sentimentFilter === "negative" ? " selected" : ""}>Tiêu cực</option>
            <option value="neutral"${model.sentimentFilter === "neutral" ? " selected" : ""}>Trung tính</option>
          </select>
          <input class="heroui-input search-input" type="search" name="search" value="${escapeHtml(model.search ?? "")}" placeholder="Tìm nội dung, tác giả..." />
          <input class="heroui-input tag-input" type="text" name="tag" value="${escapeHtml(model.tagFilter ?? "")}" placeholder="Nhãn phân loại..." />
          <input class="heroui-input assignee-input" type="text" name="assigned_to" value="${escapeHtml(model.assignedToFilter ?? "")}" placeholder="Người phụ trách..." />
          <input class="heroui-input likes-input" type="number" name="min_likes" value="${model.minLikesFilter ?? ""}" min="0" placeholder="Lượt thích ≥" />
          <button class="btn btn-sm btn-primary" type="submit">${uiIcon("filter")} Lọc tin</button>
          ${
            model.search || model.sentimentFilter || model.minLikesFilter || model.tagFilter || model.assignedToFilter || model.activeTopic
              ? `<a class="btn-clear" href="/${model.view !== "wire" ? `?view=${encodeURIComponent(model.view)}` : ""}">Xóa bộ lọc</a>`
              : ""
          }
        </div>
        <div class="ribbon-export">
          <button class="btn btn-sm btn-outline" type="button" onclick="const p=document.getElementById('deck-admin-panel'); if(p){ p.open=!p.open; if(p.open) p.scrollIntoView({behavior:'smooth'}); }" title="Mở bảng cấu hình Nguồn theo dõi, Cảnh báo, Từ điển">${uiIcon("settings")} Nguồn theo dõi (${model.topics.length})</button>
          <button class="btn btn-sm btn-primary" type="submit" form="auto-classify-form" title="Tự động phân loại nhãn và gán người xử lý cho các bài viết chưa gán">${uiIcon("zap")} Tự động phân loại bằng AI</button>
          <a class="btn btn-sm btn-outline" href="/export.csv?${(() => {
            const p = new URLSearchParams();
            if (model.activeTopic) p.set("topic", model.activeTopic);
            if (model.search) p.set("search", model.search);
            if (model.sentimentFilter) p.set("sentiment", model.sentimentFilter);
            if (model.minLikesFilter) p.set("min_likes", String(model.minLikesFilter));
            if (model.tagFilter) p.set("tag", model.tagFilter);
            if (model.assignedToFilter) p.set("assigned_to", model.assignedToFilter);
            return p.toString();
          })()}">${uiIcon("download")} Xuất file Excel / CSV</a>
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
      <div class="stream-column stream-critical heroui-card">
        <div class="stream-header critical-head">
          <div class="stream-title-wrap">
            <span class="stream-badge-icon">${uiIcon("flame", 18)}</span>
            <h2>BÀI VIẾT TIÊU CỰC CẦN XỬ LÝ GẤP</h2>
          </div>
          <span class="heroui-chip heroui-chip-danger">${criticalMentions.length} bài</span>
        </div>
        <p class="stream-subtitle">Ý kiến khiếu nại, sự cố, phản ánh xấu cần đội ngũ can thiệp ngay.</p>

        <div class="stream-cards-list">
          ${
            criticalCards ||
            `<div class="stream-empty safe">
              <span class="empty-icon">${uiIcon("shieldCheck", 36)}</span>
              <p><strong>Không có bài viết nguy cơ cao</strong></p>
              <small>Thương hiệu đang an toàn trong phạm vi theo dõi hiện tại.</small>
            </div>`
          }
        </div>
      </div>

      <!-- CỘT PHẢI: LUỒNG THẢO LUẬN TỰ NHIÊN (TÍCH CỰC & TRUNG TÍNH) -->
      <div class="stream-column stream-natural heroui-card">
        <div class="stream-header natural-head">
          <div class="stream-title-wrap">
            <span class="stream-badge-icon">${uiIcon("message", 18)}</span>
            <h2>THẢO LUẬN TỰ NHIÊN & KHEN NGỢI</h2>
          </div>
          <span class="heroui-chip heroui-chip-success">${naturalMentions.length} bài</span>
        </div>
        <p class="stream-subtitle">Ý kiến hài lòng, câu hỏi tư vấn và tương tác thường nhật của cộng đồng.</p>

        <div class="stream-cards-list">
          ${
            naturalCards ||
            `<div class="stream-empty">
              <span class="empty-icon">${uiIcon("inbox", 36)}</span>
              <p><strong>Chưa có bài viết phù hợp</strong></p>
              <small>Thử mở rộng bộ lọc hoặc chọn tất cả nguồn tin để xem thêm bài viết.</small>
            </div>`
          }
        </div>
      </div>
    </section>
    `,
    "dashboard",
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
    <!-- BẢNG ĐIỀU KHIỂN & CẤU HÌNH NGUỒN THEO DÕI / CẢNH BÁO (HEROUI ACCORDION 2 CỘT RỘNG RÃI) -->
    <details id="deck-admin-panel" class="deck-admin-details heroui-card" ${model.adminOpen ? "open" : ""}>
      <summary class="deck-admin-summary">
        <div class="admin-summary-content">
          <div class="admin-summary-title">
            <span class="admin-gear-icon">${uiIcon("settings", 20)}</span>
            <strong>Quản lý Nguồn theo dõi, Thông báo cảnh báo & Mẫu câu phản hồi</strong>
          </div>
          <div class="admin-summary-badges">
            <span class="heroui-chip heroui-chip-primary">${uiIcon("radio", 13)} ${model.topics.length} nguồn tin</span>
            <span class="heroui-chip heroui-chip-warning">${uiIcon("bell", 13)} ${model.alerts.length} cảnh báo</span>
            <span class="heroui-chip heroui-chip-default">${uiIcon("book", 13)} ${model.lexicon.length} từ điển</span>
            <span class="heroui-chip heroui-chip-default">${uiIcon("message", 13)} ${model.templates.length} mẫu câu</span>
            <span class="admin-pill-action">Bấm để mở cấu hình ▾</span>
          </div>
        </div>
        <span class="summary-arrow">▾</span>
      </summary>

      <div class="deck-admin-grid">
        <!-- Card 1: Quản lý Nguồn theo dõi -->
        <div class="admin-card heroui-card-sub">
          <div class="admin-card-head">
            <h3>${uiIcon("radio", 18)} Kênh & Nguồn đang theo dõi</h3>
          </div>
          <form class="admin-form" method="post" action="/topics">
            <div class="form-row">
              <label class="heroui-label">Tên gợi nhớ<input class="heroui-input" name="name" required maxlength="80" placeholder="VD: Khách hàng phản ánh dịch vụ" /></label>
              <label class="heroui-label">Mạng xã hội / Nguồn tin
                <select class="heroui-select" name="source">
                  <option value="facebook">Facebook (Fanpage, Nhóm hoặc Từ khóa/Hashtag)</option>
                  <option value="x">X / Twitter (Từ khóa hoặc #Hashtag)</option>
                  <option value="threads">Threads (Tài khoản hoặc #Hashtag/Từ khóa)</option>
                  <option value="youtube">YouTube (Video theo từ khóa/Hashtag)</option>
                  <option value="web">Báo chí & Diễn đàn (Google News tiếng Việt)</option>
                </select>
              </label>
            </div>
            <label class="heroui-label">Từ khóa, #Hashtag, hoặc Đường dẫn Fanpage/Profile
              <textarea class="heroui-textarea" name="query" required maxlength="300" rows="2" placeholder="Ví dụ: #rueco, &quot;mỹ phẩm rueco&quot;, link Fanpage hoặc tài khoản Threads..."></textarea>
            </label>
            <div class="form-row">
              <label class="heroui-label">Từ khóa bắt buộc có (Lọc lại)<input class="heroui-input" name="phrase" maxlength="80" placeholder="Để trống nếu muốn lấy tất cả" /></label>
              <label class="check-label"><input type="checkbox" name="exclude_reposts" checked /> Bỏ qua bài đăng lại (Retweets)</label>
            </div>
            <button class="btn btn-sm btn-primary" type="submit">+ Thêm nguồn theo dõi mới</button>
          </form>
          <div class="admin-tool-list">
            ${topicItems || `<p class="empty-small text-muted">Chưa có nguồn theo dõi nào. Hãy thêm nguồn đầu tiên ở trên.</p>`}
          </div>
        </div>

        <!-- Card 2: Chuông cảnh báo & Bùng nổ gia tốc -->
        <div class="admin-card heroui-card-sub">
          <div class="admin-card-head">
            <h3>${uiIcon("bell", 18)} Thiết lập Điều kiện cảnh báo tự động</h3>
          </div>
          <form class="admin-form" method="post" action="/alerts">
            <div class="form-row">
              <label class="heroui-label">Tên cảnh báo<input class="heroui-input" name="name" required maxlength="80" placeholder="VD: Cảnh báo tẩy chay / Lừa đảo" /></label>
              <label class="heroui-label">Điều kiện kích hoạt
                <select class="heroui-select" name="kind">
                  <option value="negative">Khi có bất kỳ bài viết tiêu cực nào</option>
                  <option value="velocity">Bùng nổ bài tiêu cực (Khủng hoảng bùng phát)</option>
                  <option value="phrase">Chứa cụm từ nhạy cảm khẩn cấp</option>
                  <option value="likes">Đạt số lượt thích tối thiểu</option>
                </select>
              </label>
            </div>
            <div class="form-row">
              <label class="heroui-label">Cụm từ nhạy cảm (nếu có)<input class="heroui-input" name="phrase" maxlength="80" placeholder="thất vọng, lừa đảo, tẩy chay..." /></label>
              <label class="heroui-label">Lượt thích tối thiểu<input class="heroui-input" name="min_likes" type="number" min="1" max="1000000" value="20" /></label>
            </div>
            <div class="form-row">
              <label class="heroui-label">Số bài xấu tối đa (Khủng hoảng)<input class="heroui-input" name="threshold_count" type="number" min="2" max="1000" value="3" /></label>
              <label class="heroui-label">Khung thời gian (phút)<input class="heroui-input" name="time_window_minutes" type="number" min="5" max="1440" value="60" /></label>
            </div>
            <label class="heroui-label">Áp dụng cho
              <select class="heroui-select" name="topic_id"><option value="">Tất cả nguồn tin</option>${alertTopics}</select>
            </label>
            <button class="btn btn-sm btn-primary" type="submit">+ Thiết lập cảnh báo mới</button>
          </form>
          <div class="admin-tool-list">
            ${alertRules || `<p class="empty-small text-muted">Chưa có điều kiện cảnh báo nào.</p>`}
          </div>
        </div>

        <!-- Card 3: Từ điển sắc thái riêng & Mẫu CSKH -->
        <div class="admin-card heroui-card-sub">
          <div class="admin-card-head">
            <h3>${uiIcon("book", 18)} Từ điển Cảm xúc & Mẫu phản hồi nhanh</h3>
          </div>
          <form class="admin-form" method="post" action="/lexicon">
            <div class="form-row">
              <label class="heroui-label">Từ ngữ đặc thù ngành<input class="heroui-input" name="word" required maxlength="40" placeholder="ngon, xịn, mượt, lag, ẩu..." /></label>
              <label class="heroui-label">Đánh giá cảm xúc
                <select class="heroui-select" name="polarity">
                  <option value="positive">Tích cực (Tốt)</option>
                  <option value="negative">Tiêu cực (Xấu)</option>
                </select>
              </label>
            </div>
            <button class="btn btn-sm btn-primary" type="submit">+ Thêm vào từ điển</button>
          </form>
          <hr class="admin-divider" />
          <form class="admin-form" method="post" action="/templates">
            ${backFields}
            <label class="heroui-label">Tên mẫu câu trả lời nhanh<input class="heroui-input" name="name" required maxlength="80" placeholder="VD: Mẫu xin lỗi sự cố giao hàng chậm" /></label>
            <label class="heroui-label">Nội dung mẫu phản hồi
              <textarea class="heroui-textarea" name="content" required maxlength="1000" rows="2" placeholder="Chào bạn, shop rất tiếc vì sự cố này. Mình xin phép nhắn tin qua inbox để giải quyết ngay ạ..."></textarea>
            </label>
            <button class="btn btn-sm btn-primary" type="submit">+ Thêm mẫu câu phản hồi</button>
          </form>
          <div class="admin-tool-list">
            ${templateItems || `<p class="empty-small text-muted">Chưa có mẫu câu phản hồi nhanh nào.</p>`}
          </div>
        </div>

        <!-- Card 4: Tắt tiếng & Dữ liệu mẫu -->
        <div class="admin-card heroui-card-sub">
          <div class="admin-card-head">
            <h3>${uiIcon("mute", 18)} Tài khoản bỏ qua & Dữ liệu mẫu</h3>
          </div>
          <div class="admin-tool-list">
            ${mutedItems || `<p class="empty-small text-muted">Chưa có tài khoản nào trong danh sách bỏ qua.</p>`}
          </div>
          <div class="sample-actions">
            <form method="post" action="/samples"><button class="btn btn-sm btn-outline" type="submit">Nạp dữ liệu mẫu thử nghiệm</button></form>
            <form method="post" action="/samples/clear"><button class="btn btn-sm btn-danger-flat" type="submit">Xóa sạch dữ liệu mẫu</button></form>
          </div>
        </div>
      </div>
    </details>
  `;
}

function getClusterIcon(id: string): string {
  switch (id) {
    case "shipping":
      return uiIcon("package", 13);
    case "service":
      return uiIcon("headphones", 13);
    case "product":
      return uiIcon("gem", 13);
    case "pricing":
      return uiIcon("tag", 13);
    case "praise":
      return uiIcon("starFilled", 13);
    case "pr":
      return uiIcon("megaphone", 13);
    default:
      return uiIcon("hash", 13);
  }
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
      return `<a href="/?search=${encodeURIComponent(c.keywords[0] ?? c.name)}${topicParam}" class="cloud-cluster-badge heroui-chip ${c.sentiment === "positive" ? "heroui-chip-success" : c.sentiment === "negative" ? "heroui-chip-danger" : "heroui-chip-default"}" title="Nhóm ${escapeHtml(c.name)}: ${c.keywords.join(", ")}">
        <span class="cluster-icon">${getClusterIcon(c.id)}</span>
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
      const sentimentLabel = w.sentiment === "positive" ? "Tích cực" : w.sentiment === "negative" ? "Tiêu cực" : "Trung tính";
      const chipVariant = w.sentiment === "positive" ? "pos" : w.sentiment === "negative" ? "neg" : "neu";
      return `<a href="/?search=${searchParam}${topicParam}" class="cloud-word-chip ${chipVariant}" style="font-size: ${fontSize}rem;" title="Từ '${escapeHtml(w.text)}' xuất hiện ${w.count} lần (${sentimentLabel}). Bấm để lọc bài viết.">
        <span class="chip-text">${escapeHtml(w.text)}</span>
        <span class="chip-count">${w.count}</span>
      </a>`;
    })
    .join("");

  return `
  <!-- KHU VỰC: ĐÁM MÂY TỪ KHÓA & CỤM CHỦ ĐỀ DƯ LUẬN (7 NGÀY) -->
  <section class="radar-cloud-card heroui-card">
    <div class="cloud-card-header">
      <div class="cloud-card-title">
        <span class="cloud-icon">${uiIcon("cloud", 20)}</span>
        <div>
          <h3>Từ khóa & Chủ đề thảo luận sôi nổi nhất</h3>
          <span class="cloud-sub">Dữ liệu 7 ngày qua · Bấm vào từ khóa hoặc chủ đề để lọc bài viết nhanh chóng</span>
        </div>
      </div>
      <div class="cloud-clusters-tray">
        ${clusterPills}
      </div>
    </div>
    <div class="cloud-words-wrapper">
      ${wordChips || `<p class="empty-cloud text-muted">Chưa đủ dữ liệu bài viết để tổng hợp đám mây từ khóa.</p>`}
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
          : href.includes("google.com") || href.includes("news")
            ? "Báo chí"
            : "X";

  const action = `/mentions/${encodeURIComponent(mention.topic_id)}/${encodeURIComponent(mention.id)}`;
  const sample = mention.sample ? `<span class="heroui-chip heroui-chip-default">MẪU DỮ LIỆU</span>` : "";
  const note = mention.note ? `<div class="card-note-box"><strong>Ghi chú nội bộ:</strong> ${escapeHtml(mention.note)}</div>` : "";
  const tagBadge = mention.tag ? `<span class="heroui-chip heroui-chip-primary">${uiIcon("tag", 12)} ${escapeHtml(mention.tag)}</span>` : "";
  const assigneeBadge = mention.assigned_to
    ? `<span class="heroui-chip heroui-chip-bordered">${uiIcon("user", 12)} ${escapeHtml(mention.assigned_to)}</span>`
    : "";

  const sentimentChip =
    mention.sentiment === "positive"
      ? `<span class="heroui-chip heroui-chip-success"><i class="heroui-dot"></i> Tích cực</span>`
      : mention.sentiment === "negative"
        ? `<span class="heroui-chip heroui-chip-danger"><i class="heroui-dot"></i> Tiêu cực</span>`
        : `<span class="heroui-chip heroui-chip-default"><i class="heroui-dot"></i> Trung tính</span>`;

  return `
  <article class="deck-mention-card heroui-card ${isCritical ? "is-critical" : ""} ${mention.starred ? "starred" : ""}" style="animation-delay:${Math.min(index * 30, 300)}ms">
    <div class="card-top-row">
      <div class="author-info">
        <span class="avatar-letter">${escapeHtml((mention.author_name || "A").slice(0, 1).toUpperCase())}</span>
        <div class="author-names">
          <strong class="author-name">${escapeHtml(mention.author_name)}</strong>
          <span class="author-handle">@${escapeHtml(username)}</span>
        </div>
      </div>
      <div class="card-top-badges">
        ${sentimentChip}
        ${assigneeBadge}
        ${tagBadge}
        <time class="card-time text-muted">${escapeHtml(formatWhen(mention.created_at))}</time>
      </div>
    </div>

    <div class="card-body-text">
      <p>${escapeHtml(mention.text)}</p>
    </div>
    ${note}

    <div class="card-meta-row">
      <span class="source-topic-tag heroui-chip heroui-chip-bordered">${uiIcon("radio", 12)} ${escapeHtml(mention.topic_name)}</span>
      ${sample}
      <span class="stats-counter text-muted"><span class="stats-item">${uiIcon("heart", 13)} ${mention.like_count}</span> · <span class="stats-item">${uiIcon("message", 13)} ${mention.reply_count}</span> · <span class="stats-item">${uiIcon("share", 13)} ${mention.repost_count}</span></span>
      ${mention.sample || !href ? "" : `<a class="out-link heroui-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Xem trên ${openLabel} ${uiIcon("external", 11)}</a>`}
    </div>

    <!-- Tác vụ xử lý điều hành & CSKH -->
    <div class="card-actions-bar">
      <div class="queue-btns heroui-btn-group">
        ${queueButton(action, backFields, "new", "Chưa đọc", mention.queue)}
        ${queueButton(action, backFields, "reading", "Đang xử lý", mention.queue)}
        ${queueButton(action, backFields, "done", "Đã xong", mention.queue)}
      </div>

      <div class="util-btns">
        <form method="post" action="${action}/star">${backFields}<button class="btn-icon" title="${mention.starred ? "Bỏ lưu ý" : "Lưu ý quan trọng"}" type="submit">${mention.starred ? uiIcon("starFilled", 14) : uiIcon("star", 14)}</button></form>
        <form method="post" action="${action}/hide">${backFields}<button class="btn-icon" title="${mention.hidden ? "Hiện lại" : "Ẩn bài này"}" type="submit">${mention.hidden ? uiIcon("eye", 14) : uiIcon("eyeOff", 14)}</button></form>
        <form method="post" action="/mutes">${backFields}<input type="hidden" name="username" value="${escapeHtml(username)}" /><button class="btn-icon" title="Bỏ qua tài khoản này" type="submit">${uiIcon("mute", 14)}</button></form>
      </div>

      <div class="inline-forms">
        <form class="inline-form" method="post" action="${action}/auto-classify">${backFields}
          <button class="btn btn-xs btn-outline btn-ai-tag" type="submit" title="AI tự động phân loại nhãn và gán người xử lý cho riêng bài này">${uiIcon("zap", 12)} AI Gán</button>
        </form>

        <form class="inline-form" method="post" action="${action}/tag">${backFields}
          <select class="heroui-select heroui-select-sm" name="tag" onchange="this.form.submit()" title="Gắn nhãn phân loại nhanh">
            <option value="">Nhãn</option>
            <option value="Giao hàng"${mention.tag === "Giao hàng" ? " selected" : ""}>Vận chuyển</option>
            <option value="Dịch vụ"${mention.tag === "Dịch vụ" ? " selected" : ""}>Dịch vụ & CSKH</option>
            <option value="Sản phẩm"${mention.tag === "Sản phẩm" ? " selected" : ""}>Chất lượng sản phẩm</option>
            <option value="Giá cả"${mention.tag === "Giá cả" ? " selected" : ""}>Giá & Ưu đãi</option>
            <option value="Khen ngợi"${mention.tag === "Khen ngợi" ? " selected" : ""}>Khen ngợi</option>
            <option value="Truyền thông"${mention.tag === "Truyền thông" ? " selected" : ""}>Truyền thông</option>
            <option value="Chung"${mention.tag === "Chung" ? " selected" : ""}>Thảo luận chung</option>
            <option value="Khác"${mention.tag === "Khác" ? " selected" : ""}>Khác</option>
          </select>
        </form>

        <form class="inline-form" method="post" action="${action}/assign">${backFields}
          <input class="heroui-input heroui-input-sm" name="assigned_to" maxlength="40" value="${escapeHtml(mention.assigned_to)}" placeholder="Gán người..." />
          <button class="btn btn-xs btn-outline" type="submit">Gán</button>
        </form>
      </div>
    </div>

    <!-- Form ghi chú nội bộ -->
    <form class="card-note-form" method="post" action="${action}/note">${backFields}
      <input class="heroui-input heroui-input-sm" name="note" maxlength="280" value="${escapeHtml(mention.note)}" placeholder="Nhập ghi chú nội bộ cho ca xử lý này..." />
      <button class="btn btn-xs btn-outline" type="submit">Lưu ghi chú</button>
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
  return [header.join(","), ...lines].join("\r\n");
}

function csvCell(value: unknown): string {
  const text = String(value ?? "").replaceAll('"', '""');
  return `"${text}"`;
}

export function briefPage(brief: Brief, notice?: string): string {
  const negative = brief.negative
    .map(
      (post) => `
      <li class="brief-item neg heroui-card-sub">
        <div class="brief-item-head">
          <strong>@${escapeHtml(post.authorUsername)}</strong>
          <span class="source-topic-tag heroui-chip heroui-chip-bordered">${escapeHtml(post.topicName)}</span>
        </div>
        <p>${escapeHtml(post.text)}</p>
      </li>`,
    )
    .join("");

  const authors = brief.newAuthors
    .map(
      (author) => `
      <li class="brief-item heroui-card-sub">
        <div class="brief-item-head">
          <strong>@${escapeHtml(author.username)}</strong>
          <small class="text-muted">${escapeHtml(author.name)}</small>
        </div>
        <span class="heroui-chip heroui-chip-default">${author.posts} bài viết</span>
      </li>`,
    )
    .join("");

  const starred = brief.starred
    .map(
      (post) => `
      <li class="brief-item starred heroui-card-sub">
        <div class="brief-item-head">
          <strong>@${escapeHtml(post.authorUsername)}</strong>
          <span class="heroui-chip heroui-chip-warning">${uiIcon("starFilled", 13)} Đã lưu ý</span>
        </div>
        <p>${escapeHtml(post.text)}</p>
      </li>`,
    )
    .join("");

  return layout(
    "Báo cáo AI hàng ngày",
    `
    <div class="deck-page-header">
      <div class="page-header-title">
        <div class="title-with-badge">
          <h1>${uiIcon("report", 22)} Báo cáo Tổng hợp Truyền thông Ngày ${escapeHtml(brief.day.split("-").reverse().join("/"))}</h1>
          <span class="heroui-chip heroui-chip-primary">Báo cáo Tổng hợp AI</span>
        </div>
        <p class="text-muted">Đánh giá rủi ro, phân loại ý kiến tiêu cực và đề xuất hành động từ trợ lý AI</p>
      </div>
      <div class="page-header-actions">
        <a class="btn btn-outline" href="/brief.md">${uiIcon("download")} Tải file Markdown (.md)</a>
        <form method="post" action="/brief/send-webhook" style="display:inline-block;"><button class="btn btn-primary" type="submit">${uiIcon("send")} Gửi qua Webhook</button></form>
      </div>
    </div>

    ${notice ? `<div class="deck-alert info">${uiIcon("info")} ${escapeHtml(notice)}</div>` : ""}

    <!-- Chỉ số tóm tắt -->
    <section class="executive-radar" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 24px;">
      <div class="kpi-box heroui-card" style="padding:16px;">
        <span class="kpi-label">Tổng bài viết ghi nhận</span>
        <strong class="kpi-val">${brief.posts.toLocaleString("vi-VN")}</strong>
      </div>
      <div class="kpi-box heroui-card" style="padding:16px;">
        <span class="kpi-label">Ý kiến tiêu cực cần lưu ý</span>
        <strong class="kpi-val text-danger">${brief.negative.length}</strong>
      </div>
      <div class="kpi-box heroui-card" style="padding:16px;">
        <span class="kpi-label">Tác giả mới xuất hiện</span>
        <strong class="kpi-val">${brief.newAuthors.length}</strong>
      </div>
      <div class="kpi-box heroui-card" style="padding:16px;">
        <span class="kpi-label">Bài viết đang lưu ý</span>
        <strong class="kpi-val text-success">${brief.starred.length}</strong>
      </div>
    </section>

    <!-- Khối Executive AI Summary -->
    <section class="ai-brief-card heroui-card" style="margin-bottom: 24px;">
      <div class="ai-brief-head">
        <span class="ai-badge heroui-chip heroui-chip-primary">${uiIcon("bot", 14)} Trợ lý AI Phân tích</span>
        <h2>Tóm tắt Tình hình & Đánh giá Rủi ro Truyền thông</h2>
      </div>
      <div class="ai-brief-content">
        <p>${escapeHtml(brief.aiSummary ?? "").replaceAll("\n", "<br />")}</p>
      </div>
    </section>

    <!-- 3 Cột chi tiết -->
    <section class="brief-columns-grid">
      <div class="brief-col heroui-card">
        <h3><span class="stat-dot neg"></span> Ý kiến tiêu cực (${brief.negative.length})</h3>
        <ul class="brief-list">
          ${negative || `<li class="empty-brief text-muted">Không có bài viết tiêu cực nào trong ngày hôm nay.</li>`}
        </ul>
      </div>

      <div class="brief-col heroui-card">
        <h3>${uiIcon("user", 16)} Tác giả mới thảo luận (${brief.newAuthors.length})</h3>
        <ul class="brief-list">
          ${authors || `<li class="empty-brief text-muted">Không có người viết mới phát sinh trong ngày.</li>`}
        </ul>
      </div>

      <div class="brief-col heroui-card">
        <h3>${uiIcon("starFilled", 16)} Đang lưu ý theo dõi (${brief.starred.length})</h3>
        <ul class="brief-list">
          ${starred || `<li class="empty-brief text-muted">Không có bài viết nào được đánh dấu sao.</li>`}
        </ul>
      </div>
    </section>
    `,
    "brief",
  );
}

export function comparePage(model: { topics: Topic[]; left: string; right: string; series: { day: string; left: DayCount; right: DayCount }[] }): string {
  const options = (selected: string) =>
    model.topics
      .map((topic) => `<option value="${escapeHtml(topic.id)}"${topic.id === selected ? " selected" : ""}>${escapeHtml(topic.name)}</option>`)
      .join("");
  const leftName = model.topics.find((topic) => topic.id === model.left)?.name ?? "Nguồn A";
  const rightName = model.topics.find((topic) => topic.id === model.right)?.name ?? "Nguồn B";
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
    "So sánh nguồn tin",
    `
    <div class="deck-page-header">
      <div class="page-header-title">
        <div class="title-with-badge">
          <h1>${uiIcon("compare", 22)} So sánh Đối chuẩn giữa 2 Nguồn theo dõi</h1>
          <span class="heroui-chip heroui-chip-primary">So sánh Đối chuẩn</span>
        </div>
        <p class="text-muted">So sánh khối lượng và xu hướng thảo luận trong 7 ngày qua</p>
      </div>
    </div>

    <div class="admin-card heroui-card" style="margin-bottom: 24px;">
      <form class="compare-select-form" method="get" action="/compare">
        <label class="heroui-label">Nguồn tin thứ nhất (Xanh dương)
          <select class="heroui-select" name="left">${options(model.left)}</select>
        </label>
        <label class="heroui-label">Nguồn tin thứ hai (Xanh lá)
          <select class="heroui-select" name="right">${options(model.right)}</select>
        </label>
        <button class="btn btn-primary" type="submit">So sánh ngay</button>
      </form>
    </div>

    <div class="radar-card heroui-card" style="margin-bottom: 24px;">
      <div class="compare-legend">
        <span><i class="dot-legend left"></i> <strong>${escapeHtml(leftName)}</strong></span>
        <span><i class="dot-legend right"></i> <strong>${escapeHtml(rightName)}</strong></span>
      </div>
      <div class="compare-chart-wrapper">
        ${bars}
      </div>
    </div>
    `,
    "compare",
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
          ? `<span class="heroui-chip heroui-chip-danger" title="Tỷ lệ tiêu cực ≥ 30%">${uiIcon("alert", 12)} Rủi ro (${h.negPct}% tiêu cực)</span>`
          : h.sentimentStatus === "positive"
            ? `<span class="heroui-chip heroui-chip-success"><span class="stat-dot pos"></span>Tích cực (${h.posPct}%)</span>`
            : `<span class="heroui-chip heroui-chip-default"><span class="stat-dot neu"></span>Trung tính</span>`;

      const authors = h.topAuthors.length > 0 ? h.topAuthors.map((a) => `@${escapeHtml(a)}`).join(", ") : "—";

      return `
      <tr class="hashtag-tr" style="animation-delay:${Math.min(i * 20, 250)}ms">
        <td class="col-hashtag">
          <a class="hashtag-link-badge heroui-link" href="/?search=${encodeURIComponent(h.tag)}${activeTopic ? `&topic=${encodeURIComponent(activeTopic)}` : ""}" title="Xem các bài viết chứa ${escapeHtml(h.tag)}">
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
        <td class="col-engagement"><span class="stats-item">${uiIcon("heart", 13)} ${h.engagement.toLocaleString("vi-VN")}</span></td>
        <td class="col-authors text-muted">${authors}</td>
        <td class="col-actions">
          <div class="hashtag-action-btns">
            <a class="btn btn-xs btn-outline" href="/?search=${encodeURIComponent(h.tag)}${activeTopic ? `&topic=${encodeURIComponent(activeTopic)}` : ""}">${uiIcon("search", 12)} Xem bài viết</a>
            <form method="post" action="/topics" style="display:inline-block;">
              <input type="hidden" name="name" value="Theo dõi ${escapeHtml(h.tag)}" />
              <input type="hidden" name="source" value="x" />
              <input type="hidden" name="query" value="${escapeHtml(h.tag)}" />
              <button class="btn btn-xs btn-primary" type="submit" title="Tạo nguồn theo dõi tự động cho từ khóa/hashtag này">${uiIcon("plus", 12)} Đưa vào giám sát</button>
            </form>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  return layout(
    "Xu hướng & Từ khóa nóng",
    `
    <div class="deck-page-header">
      <div class="page-header-title">
        <div class="title-with-badge">
          <h1>${uiIcon("flame", 22)} Phân tích Xu hướng, Từ khóa & Hashtags</h1>
          <span class="heroui-chip heroui-chip-primary">Xu hướng & Từ khóa Dư luận</span>
        </div>
        <p class="text-muted">Đo lường, phát hiện sớm rủi ro và xu hướng theo Từ khóa & Hashtags đa nền tảng</p>
      </div>
      <div class="page-header-actions">
        <a class="btn btn-outline" href="/">← Quay lại Tổng quan</a>
      </div>
    </div>

    ${notice ? `<div class="deck-alert info">${uiIcon("info")} ${escapeHtml(notice)}</div>` : ""}

    <!-- KHU VỰC BỘ LỌC THỜI GIAN VÀ NGUỒN TIN -->
    <section class="deck-ribbon heroui-card" style="margin-bottom: 20px;">
      <form class="ribbon-filter-bar" method="get" action="/hashtags" style="width: 100%; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div class="filter-group">
          <label style="font-size:0.85rem; font-weight:600; color:var(--ink-soft); display:flex; align-items:center; gap:8px;">
            <span>Khung thời gian:</span>
            <select class="heroui-select" name="days" onchange="this.form.submit()">
              <option value="1"${days === 1 ? " selected" : ""}>24 giờ qua</option>
              <option value="3"${days === 3 ? " selected" : ""}>3 ngày qua</option>
              <option value="7"${days === 7 ? " selected" : ""}>7 ngày qua</option>
              <option value="14"${days === 14 ? " selected" : ""}>14 ngày qua</option>
              <option value="30"${days === 30 ? " selected" : ""}>30 ngày qua</option>
            </select>
          </label>
          <label style="font-size:0.85rem; font-weight:600; color:var(--ink-soft); display:flex; align-items:center; gap:8px;">
            <span>Lọc theo nguồn tin:</span>
            <select class="heroui-select" name="topic" onchange="this.form.submit()">
              <option value="">Tất cả nguồn tin</option>
              ${topicOptions}
            </select>
          </label>
        </div>
      </form>
    </section>

    <!-- THẺ KPI TỔNG HỢP HASHTAGS -->
    <section class="executive-radar" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: 24px;">
      <div class="kpi-box heroui-card">
        <span class="kpi-label">Tổng từ khóa & Hashtag</span>
        <strong class="kpi-val">${analytics.totalHashtagsCount.toLocaleString("vi-VN")}</strong>
      </div>
      <div class="kpi-box heroui-card">
        <span class="kpi-label">Điểm nóng rủi ro cao (≥ 30% xấu)</span>
        <strong class="kpi-val text-danger">${analytics.list.filter((h) => h.sentimentStatus === "warning").length.toLocaleString("vi-VN")}</strong>
      </div>
      <div class="kpi-box heroui-card">
        <span class="kpi-label">Tổng lượt tương tác cộng đồng</span>
        <strong class="kpi-val">${analytics.list.reduce((acc, h) => acc + h.engagement, 0).toLocaleString("vi-VN")}</strong>
      </div>
    </section>

    <!-- BẢNG BÁO CÁO CHI TIẾT HASHTAGS -->
    <section class="hashtag-table-wrapper heroui-card">
      <div class="hashtag-table-header">
        <div>
          <h3>Bảng xếp hạng Từ khóa & Hashtags thảo luận nhiều nhất</h3>
          <span class="text-muted" style="font-size:0.85rem;">Phân tích tự động sắc thái dư luận, tỷ lệ tiêu cực và các tác giả dẫn dắt dư luận</span>
        </div>
      </div>
      <div class="table-responsive">
        <table class="hashtag-table">
          <thead>
            <tr>
              <th>Từ khóa / Hashtag</th>
              <th>Trạng thái rủi ro</th>
              <th>Tổng bài viết</th>
              <th style="min-width: 140px;">Phổ cảm xúc</th>
              <th>Lượt tương tác</th>
              <th>Tác giả tiêu biểu</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="7" class="text-center text-muted" style="padding: 40px;">Chưa tìm thấy từ khóa hoặc hashtag nào trong khung thời gian này.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    `,
    "hashtags",
  );
}

export type SearchPageModel = {
  query: string;
  selectedChannels: string[];
  result?: LiveSearchResult;
  notice?: string;
};

export function searchPage(model: SearchPageModel): string {
  const q = model.query ?? "";
  const selected = model.selectedChannels.length > 0 ? model.selectedChannels : ["web", "x", "facebook", "threads", "youtube"];
  const isChecked = (ch: string) => (selected.includes(ch) ? " checked" : "");

  const total = model.result ? model.result.counts.total : 0;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  const cards = (model.result?.items ?? [])
    .map((item, idx) => {
      const sourceLabel =
        item.source === "facebook"
          ? "Facebook"
          : item.source === "threads"
            ? "Threads"
            : item.source === "youtube"
              ? "YouTube"
              : item.source === "web"
                ? "Báo chí"
                : "X (Twitter)";

      const sentimentChip =
        item.sentiment === "positive"
          ? `<span class="heroui-chip heroui-chip-success"><i class="heroui-dot"></i> Tích cực</span>`
          : item.sentiment === "negative"
            ? `<span class="heroui-chip heroui-chip-danger"><i class="heroui-dot"></i> Tiêu cực</span>`
            : `<span class="heroui-chip heroui-chip-default"><i class="heroui-dot"></i> Trung tính</span>`;

      return `
      <article class="deck-mention-card heroui-card ${item.sentiment === "negative" ? "is-critical" : ""}" style="animation-delay:${Math.min(idx * 20, 250)}ms">
        <div class="card-top-row">
          <div class="author-info">
            <span class="avatar-letter">${escapeHtml((item.author_name || "A").slice(0, 1).toUpperCase())}</span>
            <div class="author-names">
              <strong class="author-name">${escapeHtml(item.author_name)}</strong>
              <span class="author-handle">@${escapeHtml(item.author_username)}</span>
            </div>
          </div>
          <div class="card-top-badges">
            <span class="source-pill ${item.source}">${sourceLabel}</span>
            ${sentimentChip}
            <time class="card-time text-muted">${escapeHtml(formatWhen(item.created_at))}</time>
          </div>
        </div>

        <div class="card-body-text">
          <p>${escapeHtml(item.text)}</p>
        </div>

        <div class="card-meta-row">
          <span class="stats-counter text-muted">
            <span class="stats-item">${uiIcon("heart", 13)} ${item.like_count}</span> · 
            <span class="stats-item">${uiIcon("message", 13)} ${item.reply_count}</span> · 
            <span class="stats-item">${uiIcon("share", 13)} ${item.repost_count}</span>
          </span>
          ${item.url ? `<a class="out-link heroui-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Xem bài gốc trên ${sourceLabel} ${uiIcon("external", 11)}</a>` : ""}
        </div>
      </article>`;
    })
    .join("");

  return layout(
    "Tra cứu Nhanh Đa Kênh Tức thời",
    `
    <div class="deck-page-header">
      <div class="page-header-title">
        <div class="title-with-badge">
          <h1>${uiIcon("search", 22)} Tra cứu Nhanh Đa Kênh Tức thời</h1>
          <span class="heroui-chip heroui-chip-primary">Quét tức thì · Không lưu DB</span>
        </div>
        <p class="text-muted">Quét tìm kiếm trực tiếp theo từ khóa hoặc #hashtag trên Facebook, X, Threads, YouTube và Báo chí. Kết quả hiển thị tức thời để xem nhanh.</p>
      </div>
      <div class="page-header-actions">
        <a class="btn btn-outline" href="/">← Quay lại Tổng quan</a>
      </div>
    </div>

    ${model.notice ? `<div class="deck-alert info">${uiIcon("info")} ${escapeHtml(model.notice)}</div>` : ""}

    <!-- FORM TRA CỨU ĐA KÊNH -->
    <div class="admin-card heroui-card" style="margin-bottom: 24px;">
      <form class="admin-form" method="get" action="/search">
        <label class="heroui-label" style="font-size:1rem; font-weight:600;">Nhập từ khóa hoặc #Hashtag cần tìm
          <div style="display:flex; gap:10px; margin-top:6px;">
            <input class="heroui-input" style="font-size:1.05rem; padding:10px 16px;" type="search" name="q" value="${escapeHtml(q)}" required placeholder="Ví dụ: #rueco, 'mỹ phẩm rueco', lừa đảo, bảo hành..." />
            <button class="btn btn-primary btn-lg" type="submit">${uiIcon("search")} Quét tìm kiếm ngay</button>
          </div>
        </label>

        <div style="margin-top: 14px;">
          <span style="font-size:0.86rem; font-weight:600; color:var(--ink-soft); display:block; margin-bottom:8px;">Chọn các kênh muốn quét:</span>
          <div style="display:flex; flex-wrap:wrap; gap:16px;">
            <label class="check-label" style="font-weight:500;">
              <input type="checkbox" name="channel" value="web"${isChecked("web")} /> 📰 Báo chí & Tin tức
            </label>
            <label class="check-label" style="font-weight:500;">
              <input type="checkbox" name="channel" value="facebook"${isChecked("facebook")} /> 👤 Facebook (Fanpage/Bài viết)
            </label>
            <label class="check-label" style="font-weight:500;">
              <input type="checkbox" name="channel" value="x"${isChecked("x")} /> 🐦 X (Twitter)
            </label>
            <label class="check-label" style="font-weight:500;">
              <input type="checkbox" name="channel" value="threads"${isChecked("threads")} /> 🧵 Threads
            </label>
            <label class="check-label" style="font-weight:500;">
              <input type="checkbox" name="channel" value="youtube"${isChecked("youtube")} /> ▶️ YouTube Video
            </label>
          </div>
        </div>
      </form>
    </div>

    <!-- KẾT QUẢ TÌM KIẾM TRỰC TIẾP -->
    ${
      model.result
        ? `
    <div class="radar-card heroui-card" style="margin-bottom: 24px; padding: 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
        <div>
          <h3 style="margin:0; font-size:1.15rem;">Kết quả tìm kiếm cho “${escapeHtml(model.result.query)}”</h3>
          <span class="text-muted" style="font-size:0.86rem;">Tìm thấy ${model.result.counts.total.toLocaleString("vi-VN")} bài viết liên quan trên các kênh đã chọn</span>
        </div>
        <form method="post" action="/topics" style="margin:0;">
          <input type="hidden" name="name" value="Giám sát ${escapeHtml(model.result.query)}" />
          <input type="hidden" name="source" value="${selected[0] ?? "x"}" />
          <input type="hidden" name="query" value="${escapeHtml(model.result.query)}" />
          <button class="btn btn-sm btn-outline" type="submit" title="Tạo nguồn theo dõi cố định từ từ khóa này">+ Đưa vào Giám sát Định kỳ</button>
        </form>
      </div>

      ${
        total > 0
          ? `
      <div class="feel-container" style="margin-top:0;">
        <div class="feel-header">
          <span class="feel-title">Phổ cảm xúc các bài tìm thấy</span>
          <span class="feel-percent">
            <span class="feel-stat-pos"><span class="stat-dot pos"></span>${pct(model.result.counts.positive)}% Tích cực</span> · 
            <span class="feel-stat-neg"><span class="stat-dot neg"></span>${pct(model.result.counts.negative)}% Tiêu cực</span> · 
            <span class="feel-stat-neu"><span class="stat-dot neu"></span>${pct(model.result.counts.neutral)}% Trung tính</span>
          </span>
        </div>
        <div class="feel-bar-track">
          <div class="feel-bar-pos" style="width: ${pct(model.result.counts.positive)}%"></div>
          <div class="feel-bar-neg" style="width: ${pct(model.result.counts.negative)}%"></div>
          <div class="feel-bar-neu" style="width: ${pct(model.result.counts.neutral)}%"></div>
        </div>
      </div>
      `
          : ""
      }
    </div>

    <!-- DANH SÁCH BÀI VIẾT -->
    <div style="display:flex; flex-direction:column; gap:16px;">
      ${
        cards ||
        `<div class="heroui-card" style="padding:48px; text-align:center;">
          <span style="font-size:2rem; display:block; margin-bottom:12px;">${uiIcon("search", 40)}</span>
          <p><strong>Không tìm thấy bài viết liên quan nào</strong></p>
          <small class="text-muted">Hãy thử rút gọn từ khóa tìm kiếm hoặc chọn thêm các kênh nguồn khác ở trên.</small>
        </div>`
      }
    </div>
    `
        : `
    <div class="heroui-card" style="padding:48px; text-align:center; color:var(--muted);">
      <span style="font-size:2.5rem; display:block; margin-bottom:12px;">${uiIcon("search", 48)}</span>
      <p style="font-size:1.05rem; margin-bottom:4px; color:var(--ink-soft);"><strong>Sẵn sàng quét tìm kiếm thời gian thực</strong></p>
      <small>Nhập từ khóa hoặc #hashtag ở trên và bấm "Quét tìm kiếm ngay" để tìm bài viết từ các kênh mạng xã hội.</small>
    </div>
    `
    }
    `,
    "search",
  );
}

/**
 * Cảnh báo khi lượt quét X gần nhất không đọc được thẳng bằng cookie mà phải lấy qua Bing/DuckDuckGo.
 * Trả về HTML an toàn (đã escape) hoặc chuỗi rỗng.
 */
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
  extra: { unreadableSecrets?: string[]; xRoute?: { route: string; cookieConfigured: boolean; at: string } } = {},
): string {
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

function renderNavbar(activeTab: string): string {
  if (activeTab === "login") return "";
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
        <a class="nav-item ${activeTab === "settings" ? "active" : ""}" href="/settings">${uiIcon("settings")} Cấu hình</a>
      </nav>

      <div class="navbar-actions">
        <form method="post" action="/listen" style="display:inline-block; margin:0;">
          <button class="btn btn-sm btn-primary" type="submit" title="Quét tin tức mới ngay trên tất cả các kênh">${uiIcon("refresh")} Quét tin</button>
        </form>
        <form method="post" action="/logout" style="display:inline-block; margin:0;">
          <button class="btn btn-sm btn-outline" type="submit" title="Đăng xuất khỏi hệ thống">${uiIcon("logout")} Đăng xuất</button>
        </form>
      </div>
    </div>
  </header>`;
}

function layout(title: string, body: string, activeTab = "dashboard"): string {
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
    :root {
      /* HeroUI Modern Palette */
      --heroui-primary: #006FEE;
      --heroui-primary-50: #E6F1FE;
      --heroui-primary-100: #CCE3FD;
      --heroui-primary-200: #99C7FB;
      --heroui-primary-600: #005BC4;
      --heroui-primary-700: #004493;

      --heroui-success: #17C964;
      --heroui-success-50: #E8FAF0;
      --heroui-success-100: #D1F4E0;
      --heroui-success-600: #12A150;

      --heroui-warning: #F5A524;
      --heroui-warning-50: #FEF7EC;
      --heroui-warning-100: #FDEFD9;
      --heroui-warning-600: #C4841D;

      --heroui-danger: #F31260;
      --heroui-danger-50: #FEE7EF;
      --heroui-danger-100: #FDD0DF;
      --heroui-danger-600: #C20E4D;

      --heroui-secondary: #7828C8;
      --heroui-secondary-50: #F2EAFA;

      --bg: #FAFAFA;
      --paper: #FFFFFF;
      --card: #FFFFFF;
      --card-subtle: #F9FAFB;
      --ink: #11181C;
      --ink-soft: #3F3F46;
      --muted: #71717A;
      --line: #E4E4E7;
      --line-subtle: #F4F4F5;

      /* Radii */
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 20px;
      --radius-full: 9999px;

      /* Shadows */
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04);
      --shadow-primary: 0 4px 14px 0 rgba(0, 111, 238, 0.35);
      --shadow-danger: 0 4px 14px 0 rgba(243, 18, 96, 0.35);
      --shadow-success: 0 4px 14px 0 rgba(23, 201, 100, 0.35);
    }

    * { box-sizing: border-box; }
    html {
      scroll-padding-top: 80px;
      scroll-behavior: smooth;
    }
    body {
      margin: 0;
      min-height: 100dvh;
      color: var(--ink);
      font-family: "Inter", "Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14.5px;
      line-height: 1.5;
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }

    /* SCROLL MARGIN TRÁNH BỊ NAVBAR ĐÈ LÊN KHI NHẢY TỚI ANCHOR */
    #deck-admin-panel, .executive-radar, .deck-ribbon, .deck-dual-streams, .radar-cloud-card, .deck-page-header {
      scroll-margin-top: 80px;
    }

    /* HEROUI STICKY NAVBAR - DUY NHẤT 1 HÀNG 64PX */
    .deck-top-navbar {
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      width: 100%;
      height: 64px;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--line);
      z-index: 100;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.03);
    }
    .navbar-container {
      max-width: 1440px;
      height: 100%;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    /* BRAND */
    .navbar-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .brand-link {
      display: flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      color: var(--ink);
    }
    .brand-title {
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .brand-badge {
      display: inline-block;
    }

    .live-dot {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .heroui-pulse {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--heroui-success);
      display: inline-block;
      box-shadow: 0 0 0 3px rgba(23, 201, 100, 0.25);
      animation: beat 2s ease-in-out infinite;
    }
    @keyframes beat { 50% { transform: scale(0.8); opacity: 0.6; } }

    /* NAV ITEMS (PILL TABS) */
    .navbar-nav {
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--line-subtle);
      padding: 4px;
      border-radius: var(--radius-full);
      border: 1px solid var(--line);
      overflow-x: auto;
      white-space: nowrap;
    }
    .nav-item {
      text-decoration: none;
      font-size: 0.84rem;
      font-weight: 500;
      color: var(--muted);
      padding: 6px 14px;
      border-radius: var(--radius-full);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .nav-item:hover {
      color: var(--ink);
      background: rgba(0, 0, 0, 0.04);
    }
    .nav-item.active {
      color: #ffffff;
      background: var(--heroui-primary);
      box-shadow: 0 2px 8px rgba(0, 111, 238, 0.35);
      font-weight: 600;
    }

    /* NAVBAR ACTIONS */
    .navbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    /* PAGE MAIN WRAPPER */
    main {
      position: relative;
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px 24px 80px;
      z-index: 1;
    }

    /* PAGE HERO HEADER (SUBHEADER) */
    .deck-page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      padding: 18px 24px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      margin-bottom: 24px;
      box-shadow: var(--shadow-sm);
    }
    .title-with-badge {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .deck-page-header h1 {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--ink);
    }
    .deck-page-header p {
      margin: 4px 0 0;
      font-size: 0.86rem;
      color: var(--muted);
    }
    .page-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* HEROUI BUTTONS */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 16px;
      font-size: 0.88rem;
      font-weight: 500;
      border-radius: var(--radius-md);
      border: 1px solid transparent;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;
      user-select: none;
    }
    .btn:active {
      transform: scale(0.97);
    }
    .btn-primary {
      background: var(--heroui-primary);
      color: #ffffff;
      box-shadow: var(--shadow-primary);
    }
    .btn-primary:hover {
      background: var(--heroui-primary-600);
    }
    .btn-outline {
      background: #ffffff;
      border-color: var(--line);
      color: var(--ink);
      box-shadow: var(--shadow-sm);
    }
    .btn-outline:hover {
      background: var(--line-subtle);
      border-color: #d4d4d8;
    }
    .btn-danger {
      background: var(--heroui-danger);
      color: #ffffff;
      box-shadow: var(--shadow-danger);
    }
    .btn-danger:hover {
      background: var(--heroui-danger-600);
    }
    .btn-danger-flat {
      background: var(--heroui-danger-50);
      color: var(--heroui-danger);
    }
    .btn-danger-flat:hover {
      background: var(--heroui-danger-100);
    }
    .btn-sm {
      padding: 6px 12px;
      font-size: 0.82rem;
      border-radius: 10px;
    }
    .btn-xs {
      padding: 4px 8px;
      font-size: 0.76rem;
      border-radius: 8px;
    }
    .btn-lg {
      padding: 12px 24px;
      font-size: 0.96rem;
      border-radius: var(--radius-md);
      font-weight: 600;
    }
    .btn-block {
      width: 100%;
    }

    /* HEROUI CARDS */
    .heroui-card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
      transition: all 0.2s ease;
    }
    .heroui-card:hover {
      box-shadow: var(--shadow-md);
    }
    .heroui-card-sub {
      background: var(--card-subtle);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
    }

    /* HEROUI CHIPS / BADGES */
    .heroui-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      font-size: 0.74rem;
      font-weight: 600;
      border-radius: var(--radius-full);
      text-decoration: none;
      line-height: 1.4;
      white-space: nowrap;
    }
    .heroui-chip-primary {
      background: var(--heroui-primary-50);
      color: var(--heroui-primary);
    }
    .heroui-chip-success {
      background: var(--heroui-success-50);
      color: var(--heroui-success);
    }
    .heroui-chip-warning {
      background: var(--heroui-warning-50);
      color: var(--heroui-warning);
    }
    .heroui-chip-danger {
      background: var(--heroui-danger-50);
      color: var(--heroui-danger);
    }
    .heroui-chip-default {
      background: var(--line-subtle);
      color: var(--muted);
    }
    .heroui-chip-bordered {
      background: #ffffff;
      border: 1px solid var(--line);
      color: var(--ink-soft);
    }
    .heroui-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: currentColor;
      display: inline-block;
    }

    /* HEROUI INPUTS & SELECTS */
    .heroui-input, .heroui-select, .heroui-textarea {
      width: 100%;
      padding: 9px 12px;
      font-size: 0.88rem;
      font-family: inherit;
      color: var(--ink);
      background: var(--line-subtle);
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      transition: all 0.2s ease;
      outline: none;
      text-overflow: ellipsis;
    }
    .heroui-input:hover, .heroui-select:hover, .heroui-textarea:hover {
      background: #f0f0f2;
    }
    .heroui-input:focus, .heroui-select:focus, .heroui-textarea:focus {
      background: #ffffff;
      border-color: var(--heroui-primary);
      box-shadow: 0 0 0 3px rgba(0, 111, 238, 0.15);
    }
    .heroui-input-sm, .heroui-select-sm {
      padding: 5px 8px;
      font-size: 0.78rem;
      border-radius: 8px;
    }
    .heroui-label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--ink-soft);
      margin-bottom: 12px;
      min-width: 0;
    }
    .heroui-link {
      color: var(--heroui-primary);
      text-decoration: none;
      font-weight: 500;
    }
    .heroui-link:hover {
      text-decoration: underline;
    }

    /* ALERTS */
    .deck-alert {
      padding: 12px 16px;
      border-radius: var(--radius-md);
      font-size: 0.88rem;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .deck-alert.info {
      background: var(--heroui-primary-50);
      color: var(--heroui-primary-700);
      border: 1px solid var(--heroui-primary-100);
    }
    .deck-alert.warning {
      background: var(--heroui-warning-50);
      color: var(--heroui-warning-600);
      border: 1px solid var(--heroui-warning-100);
    }
    .deck-alert.error {
      background: var(--heroui-danger-50);
      color: var(--heroui-danger-600);
      border: 1px solid var(--heroui-danger-100);
    }

    /* EXECUTIVE RADAR GRID */
    .executive-radar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .radar-card {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .radar-card-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    .radar-card-head h3 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .radar-sub {
      font-size: 0.78rem;
      color: var(--muted);
    }

    /* KPI BOXES */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .kpi-box {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .kpi-label {
      font-size: 0.74rem;
      color: var(--muted);
      font-weight: 500;
    }
    .kpi-val {
      font-size: 1.55rem;
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.03em;
    }

    /* FEELBAR */
    .feel-container {
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .feel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
    }
    .feel-title {
      font-weight: 600;
      color: var(--ink-soft);
    }
    .feel-percent {
      font-size: 0.78rem;
      color: var(--muted);
    }
    .feel-bar-track {
      height: 8px;
      background: var(--line-subtle);
      border-radius: var(--radius-full);
      overflow: hidden;
      display: flex;
    }
    .feel-bar-pos { background: var(--heroui-success); }
    .feel-bar-neg { background: var(--heroui-danger); }
    .feel-bar-neu { background: #A1A1AA; }
    .feel-sub {
      display: flex;
      justify-content: space-between;
      font-size: 0.74rem;
      color: var(--muted);
    }

    /* BARS CHART */
    .radar-chart-area {
      min-height: 110px;
      display: flex;
      align-items: flex-end;
    }
    .radar-bars-wrapper {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      width: 100%;
      height: 100px;
    }
    .radar-bar-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      height: 100%;
      justify-content: flex-end;
    }
    .radar-bar-track {
      width: 100%;
      height: 70px;
      display: flex;
      align-items: flex-end;
      border-radius: 6px;
      background: var(--line-subtle);
      overflow: hidden;
    }
    .radar-bar-fill {
      width: 100%;
      background: linear-gradient(180deg, var(--heroui-primary) 0%, var(--heroui-primary-600) 100%);
      border-radius: 6px 6px 0 0;
      transition: height 0.4s ease;
    }
    .radar-bar-val {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--ink);
    }
    .radar-bar-lbl {
      font-size: 0.68rem;
      color: var(--muted);
    }
    .voices-tray {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tray-title {
      font-size: 0.76rem;
      font-weight: 600;
      color: var(--muted);
    }
    .voices-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .empty-radar {
      font-size: 0.85rem;
      color: var(--muted);
      margin: auto;
    }

    /* ALARMS */
    .alarms-scroll-area {
      max-height: 230px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-right: 4px;
    }
    .alarm-item {
      padding: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .alarm-content {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .alarm-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .alarm-meta {
      font-size: 0.74rem;
      color: var(--muted);
    }
    .alarm-text {
      margin: 0;
      font-size: 0.82rem;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .alarm-reason {
      font-size: 0.72rem;
      color: var(--heroui-danger);
    }
    .empty-alarms {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 30px 16px;
      color: var(--muted);
    }
    .shield-icon {
      font-size: 2rem;
      margin-bottom: 8px;
    }

    /* WORD CLOUD & TOPICS */
    .radar-cloud-card {
      padding: 20px;
      margin-bottom: 24px;
    }
    .cloud-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 16px;
    }
    .cloud-card-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .cloud-icon {
      font-size: 1.8rem;
    }
    .cloud-card-title h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 700;
    }
    .cloud-sub {
      font-size: 0.78rem;
      color: var(--muted);
    }
    .cloud-clusters-tray {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .cloud-words-wrapper {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
    }
    .cloud-word-chip {
      text-decoration: none;
      padding: 4px 12px;
      border-radius: var(--radius-full);
      font-weight: 600;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .cloud-word-chip:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-sm);
    }
    .cloud-word-chip.pos {
      background: var(--heroui-success-50);
      color: var(--heroui-success-600);
      border: 1px solid var(--heroui-success-100);
    }
    .cloud-word-chip.neg {
      background: var(--heroui-danger-50);
      color: var(--heroui-danger-600);
      border: 1px solid var(--heroui-danger-100);
    }
    .cloud-word-chip.neu {
      background: var(--line-subtle);
      color: var(--ink-soft);
      border: 1px solid var(--line);
    }
    .chip-count {
      font-size: 0.72rem;
      padding: 2px 6px;
      border-radius: var(--radius-full);
      background: rgba(0, 0, 0, 0.06);
    }

    /* ADMIN ACCORDION PANEL - 2 CỘT RỘNG RÃI */
    .deck-admin-details {
      margin-bottom: 24px;
      overflow: hidden;
    }
    .deck-admin-summary {
      padding: 16px 20px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
      list-style: none;
      transition: background 0.2s ease;
    }
    .deck-admin-summary::-webkit-details-marker { display: none; }
    .deck-admin-summary:hover {
      background: var(--line-subtle);
    }
    .admin-summary-content {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
    }
    .admin-summary-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.98rem;
    }
    .admin-summary-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .admin-pill-action {
      font-size: 0.76rem;
      color: var(--heroui-primary);
      font-weight: 600;
    }
    .summary-arrow {
      font-size: 1.1rem;
      color: var(--muted);
      transition: transform 0.2s ease;
    }
    details[open] .summary-arrow {
      transform: rotate(180deg);
    }
    .deck-admin-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(460px, 1fr));
      gap: 20px;
      padding: 20px;
      background: var(--line-subtle);
      border-top: 1px solid var(--line);
    }
    @media (max-width: 640px) {
      .deck-admin-grid {
        grid-template-columns: 1fr;
      }
    }
    .admin-card {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .admin-card-head h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
      color: var(--ink);
      line-height: 1.4;
    }
    .form-row {
      display: flex;
      gap: 12px;
    }
    @media (max-width: 520px) {
      .form-row {
        flex-direction: column;
        gap: 8px;
      }
    }
    .form-row > * {
      flex: 1;
      min-width: 0;
    }
    .check-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      color: var(--ink-soft);
      cursor: pointer;
    }
    .admin-tool-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 280px;
      overflow-y: auto;
    }
    .tool-list-row {
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .tool-list-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      min-width: 0;
    }
    .tool-title-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .source-pill {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      text-transform: uppercase;
    }
    .source-pill.facebook { background: #1877F2; color: #ffffff; }
    .source-pill.x { background: #000000; color: #ffffff; }
    .source-pill.threads { background: #333333; color: #ffffff; }
    .source-pill.youtube { background: #FF0000; color: #ffffff; }
    .source-pill.web { background: #0F9D58; color: #ffffff; }
    .tool-error {
      margin: 0;
      font-size: 0.74rem;
      color: var(--heroui-danger);
    }
    .tool-list-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .admin-divider {
      border: 0;
      border-top: 1px solid var(--line);
      margin: 4px 0;
    }
    .sample-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }

    /* RIBBON FILTER BAR */
    .deck-ribbon {
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .ribbon-tabs {
      display: flex;
      gap: 4px;
      background: var(--line-subtle);
      padding: 4px;
      border-radius: var(--radius-full);
      width: fit-content;
      border: 1px solid var(--line);
      flex-wrap: wrap;
    }
    .tab-link {
      text-decoration: none;
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--muted);
      padding: 6px 14px;
      border-radius: var(--radius-full);
      transition: all 0.2s ease;
    }
    .tab-link:hover {
      color: var(--ink);
    }
    .tab-link.active {
      color: #ffffff;
      background: var(--heroui-primary);
      box-shadow: 0 2px 6px rgba(0, 111, 238, 0.3);
      font-weight: 600;
    }
    .ribbon-filter-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .filter-group {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      flex: 1;
    }
    .search-input { width: 220px; }
    .tag-input { width: 130px; }
    .assignee-input { width: 140px; }
    .likes-input { width: 110px; }
    .btn-clear {
      font-size: 0.8rem;
      color: var(--heroui-danger);
      text-decoration: none;
      font-weight: 500;
      padding: 6px 10px;
    }
    .btn-clear:hover {
      text-decoration: underline;
    }
    .ribbon-export {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    /* DUAL-STREAM LAYOUT */
    .deck-dual-streams {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 960px) {
      .deck-dual-streams {
        grid-template-columns: 1fr;
      }
    }
    .stream-column {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .stream-column.stream-critical {
      border-color: rgba(243, 18, 96, 0.3);
      background: #FFFDFD;
    }
    .stream-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .stream-title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stream-title-wrap h2 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .stream-subtitle {
      margin: 0;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .stream-cards-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .stream-empty {
      padding: 40px 16px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      color: var(--muted);
    }
    .empty-icon {
      font-size: 2.2rem;
      margin-bottom: 8px;
    }

    /* MENTION CARDS */
    .deck-mention-card {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: fadeIn 0.3s ease both;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .deck-mention-card.is-critical {
      border-left: 4px solid var(--heroui-danger);
    }
    .deck-mention-card.starred {
      border-left: 4px solid var(--heroui-warning);
    }
    .card-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .author-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .avatar-letter {
      width: 34px;
      height: 34px;
      border-radius: var(--radius-full);
      background: var(--line-subtle);
      border: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.88rem;
      color: var(--heroui-primary);
    }
    .author-names {
      display: flex;
      flex-direction: column;
    }
    .author-name {
      font-size: 0.88rem;
      color: var(--ink);
    }
    .author-handle {
      font-size: 0.74rem;
      color: var(--muted);
    }
    .card-top-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .card-time {
      font-size: 0.74rem;
    }
    .card-body-text p {
      margin: 0;
      font-size: 0.92rem;
      line-height: 1.55;
      word-break: break-word;
    }
    .card-note-box {
      background: var(--heroui-warning-50);
      border-left: 3px solid var(--heroui-warning);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.82rem;
      color: var(--ink-soft);
    }
    .card-meta-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 0.78rem;
      padding-top: 4px;
      border-top: 1px dashed var(--line);
    }
    .card-actions-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 4px;
    }
    .heroui-btn-group {
      display: inline-flex;
      border-radius: var(--radius-md);
      overflow: hidden;
      border: 1px solid var(--line);
    }
    .queue-btn-form { display: inline; }
    .btn-q {
      background: #ffffff;
      border: 0;
      border-right: 1px solid var(--line);
      padding: 5px 10px;
      font-size: 0.76rem;
      color: var(--muted);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-q:last-child { border-right: 0; }
    .btn-q:hover { background: var(--line-subtle); color: var(--ink); }
    .btn-q.active {
      background: var(--heroui-primary);
      color: #ffffff;
      font-weight: 600;
    }
    .util-btns {
      display: flex;
      gap: 4px;
    }
    .btn-icon {
      background: transparent;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.15s ease;
    }
    .btn-icon:hover {
      background: var(--line-subtle);
      border-color: #d4d4d8;
    }
    .inline-forms {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .inline-form {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .card-note-form {
      display: flex;
      gap: 6px;
      margin-top: 2px;
    }

    /* BRIEF PAGE */
    .ai-brief-card {
      padding: 24px;
      background: linear-gradient(180deg, #FFFFFF 0%, #F9FAFB 100%);
    }
    .ai-brief-head {
      margin-bottom: 16px;
    }
    .ai-brief-head h2 {
      margin: 8px 0 0;
      font-size: 1.25rem;
      font-weight: 700;
    }
    .ai-brief-content {
      font-size: 0.95rem;
      line-height: 1.65;
      color: var(--ink-soft);
    }
    .brief-columns-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
    }
    .brief-col {
      padding: 20px;
    }
    .brief-col h3 {
      margin: 0 0 14px;
      font-size: 1rem;
      font-weight: 700;
    }
    .brief-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .brief-item {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .brief-item p {
      margin: 0;
      font-size: 0.86rem;
      line-height: 1.45;
    }
    .brief-item.neg { border-left: 3px solid var(--heroui-danger); }
    .brief-item.starred { border-left: 3px solid var(--heroui-warning); }

    /* COMPARE PAGE */
    .compare-select-form {
      display: flex;
      gap: 16px;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .compare-select-form label {
      flex: 1;
      min-width: 200px;
    }
    .compare-legend {
      display: flex;
      gap: 20px;
      font-size: 0.88rem;
      margin-bottom: 16px;
    }
    .dot-legend {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      display: inline-block;
      margin-right: 6px;
    }
    .dot-legend.left { background: var(--heroui-primary); }
    .dot-legend.right { background: var(--heroui-success); }
    .compare-chart-wrapper {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      height: 180px;
      padding-top: 20px;
    }
    .compare-bar-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      height: 100%;
      justify-content: flex-end;
    }
    .compare-bars-pair {
      display: flex;
      gap: 4px;
      align-items: flex-end;
      width: 100%;
      height: 120px;
      justify-content: center;
    }
    .cbar {
      width: 14px;
      border-radius: 4px 4px 0 0;
      transition: height 0.3s ease;
    }
    .cbar.left-bar { background: var(--heroui-primary); }
    .cbar.right-bar { background: var(--heroui-success); }
    .cbar-date { font-size: 0.72rem; color: var(--muted); }
    .cbar-detail { font-size: 0.68rem; font-weight: 600; }

    /* HASHTAGS TABLE */
    .hashtag-table-wrapper {
      padding: 20px;
    }
    .hashtag-table-header {
      margin-bottom: 16px;
    }
    .hashtag-table-header h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 700;
    }
    .table-responsive {
      overflow-x: auto;
    }
    .hashtag-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    .hashtag-table th {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-weight: 600;
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .hashtag-table td {
      padding: 12px;
      border-bottom: 1px solid var(--line-subtle);
      vertical-align: middle;
    }
    .hashtag-link-badge {
      font-weight: 700;
      font-size: 0.95rem;
    }
    .hash-symbol {
      color: var(--heroui-primary);
      margin-right: 2px;
    }
    .mini-feelbar-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .mini-feelbar-track {
      height: 6px;
      background: var(--line-subtle);
      border-radius: var(--radius-full);
      overflow: hidden;
      display: flex;
    }
    .mini-bar-pos { background: var(--heroui-success); }
    .mini-bar-neg { background: var(--heroui-danger); }
    .mini-bar-neu { background: #A1A1AA; }
    .mini-feelbar-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.68rem;
      color: var(--muted);
    }
    .hashtag-action-btns {
      display: flex;
      gap: 6px;
    }

    /* SETTINGS PAGE */
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .settings-card {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .settings-card-head {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }
    .platform-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      border-radius: var(--radius-md);
      background: var(--heroui-primary-50);
      color: var(--heroui-primary);
      flex-shrink: 0;
    }

    /* SVG VECTOR ICONS (HEROUI / LUCIDE STYLE) */
    .ui-icon {
      display: inline-block;
      vertical-align: -0.16em;
      flex-shrink: 0;
    }
    .btn .ui-icon, .nav-item .ui-icon, .heroui-chip .ui-icon {
      margin-right: 5px;
    }
    .btn-icon .ui-icon {
      margin: 0;
    }
    .stat-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 999px;
      margin-right: 5px;
      vertical-align: middle;
    }
    .stat-dot.pos { background: var(--heroui-success); }
    .stat-dot.neg { background: var(--heroui-danger); }
    .stat-dot.neu { background: #a1a1aa; }

    .stats-item {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .stats-item .ui-icon {
      vertical-align: middle;
    }
    .settings-card-head h3 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
    }
    .hint {
      margin: 2px 0 0;
      font-size: 0.78rem;
      color: var(--muted);
    }
    .settings-footer-actions {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 20px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
    }

    /* LOGIN PAGE */
    .login-wrapper {
      min-height: 80dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .login-card {
      width: 100%;
      max-width: 420px;
      padding: 32px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .deck-brand h1 {
      margin: 8px 0 4px;
      font-size: 1.8rem;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .deck-subtitle {
      margin: 0;
      font-size: 0.88rem;
      color: var(--muted);
    }
    .brand-badge-row {
      display: flex;
      gap: 6px;
    }

    /* UTILITY HELPERS */
    .text-muted { color: var(--muted); }
    .text-danger { color: var(--heroui-danger); }
    .text-success { color: var(--heroui-success); }
    .text-center { text-align: center; }
  </style>
</head>
<body>
  ${renderNavbar(activeTab)}
  <main>
    ${body}
  </main>
</body>
</html>`;
}
