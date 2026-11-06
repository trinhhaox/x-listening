import { fillTemplate } from "../ai.js";
import type { AlertHitRow, AlertRule, MentionRow, MentionView, ResponseTemplate, Topic, Voice } from "../db.js";
import type { WordCloudItem, TopicCluster } from "../cloud.js";
import { uiIcon } from "../icons.js";
import { escapeHtml, queueButton, formatWhen, layout } from "./layout.js";

type DashboardModel = {
  topics: Topic[];
  /** Nguồn đang bật mà lỗi liên tiếp nhiều lượt. */
  failing?: { name: string; source: string; error: string; count: number }[];
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

  // Mỗi luồng chỉ hiện sẵn STREAM_PREVIEW bài, phần còn lại gói trong "Xem thêm" để trang không dài vô tận.
  const STREAM_PREVIEW = 12;
  const renderStream = (list: MentionRow[], isCritical: boolean) => {
    if (!list.length) return "";
    const head = list.slice(0, STREAM_PREVIEW).map((m, i) => renderCard(m, i, isCritical)).join("");
    const rest = list.slice(STREAM_PREVIEW);
    if (!rest.length) return head;
    return `${head}
      <details class="stream-more">
        <summary class="btn btn-outline btn-sm">Xem thêm ${rest.length} bài</summary>
        <div class="stream-more-list">${rest.map((m) => renderCard(m, 0, isCritical)).join("")}</div>
      </details>`;
  };
  const criticalCards = renderStream(criticalMentions, true);
  const naturalCards = renderStream(naturalMentions, false);

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
    ${model.failing?.length
      ? `<div class="deck-alert error">${uiIcon("alert")}<div class="alert-lines"><span><strong>${model.failing.length} nguồn đang không quét được.</strong> Bài mới từ các nguồn này đang bị bỏ lỡ. Thường do cookie hoặc token hết hạn: vào <a href="/settings">Cài đặt</a> để cập nhật.</span>${model.failing
          .map((f) => `<span>• ${escapeHtml(f.name)} (${escapeHtml(f.source)}), lỗi ${f.count} lượt liền: ${escapeHtml(f.error.slice(0, 180))}</span>`)
          .join("")}</div></div>`
      : ""}
    ${model.spike ? `<div class="deck-alert warning">${uiIcon("zap")} <strong>Đột biến phát hiện:</strong> ${escapeHtml(model.spike)}</div>` : ""}
    ${(() => {
      const items = [
        model.xNotice,
        model.hasFacebook ? "" : 'Chưa có cấu hình Facebook Cookie. Vào mục <a href="/settings">Cấu hình kết nối</a> để thêm.',
      ].filter(Boolean);
      if (!items.length) return "";
      return `<div class="deck-alert warning">${uiIcon("alert")}<div class="alert-lines">${items.map((item) => `<span>${item}</span>`).join("")}</div></div>`;
    })()}

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
    <section class="deck-dual-streams ${!criticalMentions.length || !naturalMentions.length ? "has-empty" : ""}">
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

export function renderMentionCard(
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

  const source = mention.sentiment_source ?? "lexicon";
  const sentimentTitle =
    source === "ai"
      ? `AI chấm${mention.sentiment_reason ? `: ${mention.sentiment_reason}` : ""}`
      : source === "manual"
        ? "Người vận hành đã sửa tay"
        : "Đếm theo từ vựng, chưa được AI xem";
  const sourceMark = source === "ai" ? `<small class="sent-src">AI</small>` : source === "manual" ? `<small class="sent-src">sửa tay</small>` : "";
  const chipClass = mention.sentiment === "positive" ? "heroui-chip-success" : mention.sentiment === "negative" ? "heroui-chip-danger" : "heroui-chip-default";
  const chipLabel = mention.sentiment === "positive" ? "Tích cực" : mention.sentiment === "negative" ? "Tiêu cực" : "Trung tính";
  const sentimentChip = `<span class="heroui-chip ${chipClass}" title="${escapeHtml(sentimentTitle)}"><i class="heroui-dot"></i> ${chipLabel}${sourceMark}</span>`;

  return `
  <article id="m-${escapeHtml(mention.topic_id)}-${escapeHtml(mention.id)}" class="deck-mention-card heroui-card ${isCritical ? "is-critical" : ""} ${mention.starred ? "starred" : ""}" style="animation-delay:${Math.min(index * 30, 300)}ms">
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

    </div>

    <details class="card-more">
      <summary>${uiIcon("tag", 12)} Phân loại, gán người & ghi chú</summary>
      <div class="inline-forms">
        <form class="inline-form" method="post" action="${action}/auto-classify">${backFields}
          <button class="btn btn-xs btn-outline btn-ai-tag" type="submit" title="AI tự động phân loại nhãn và gán người xử lý cho riêng bài này">${uiIcon("zap", 12)} AI Gán</button>
        </form>

        <form class="inline-form" method="post" action="${action}/sentiment">${backFields}
          <select class="heroui-select heroui-select-sm" name="sentiment" onchange="this.form.submit()" title="Sửa cảm xúc nếu máy chấm sai">
            <option value="positive"${mention.sentiment === "positive" ? " selected" : ""}>Tích cực</option>
            <option value="neutral"${mention.sentiment === "neutral" ? " selected" : ""}>Trung tính</option>
            <option value="negative"${mention.sentiment === "negative" ? " selected" : ""}>Tiêu cực</option>
          </select>
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
      <form class="card-note-form" method="post" action="${action}/note">${backFields}
        <input class="heroui-input heroui-input-sm" name="note" maxlength="280" value="${escapeHtml(mention.note)}" placeholder="Nhập ghi chú nội bộ cho ca xử lý này..." />
        <button class="btn btn-xs btn-outline" type="submit">Lưu ghi chú</button>
      </form>
    </details>
    ${replyBox(mention, action, backFields, templates)}
  </article>`;
}

function replyBox(mention: MentionRow, action: string, backFields: string, templates: ResponseTemplate[]): string {
  const draft = mention.reply_draft ?? "";
  const options = templates
    .map((tpl) => `<option value="${escapeHtml(fillTemplate(tpl.content, mention.author_name))}">${escapeHtml(tpl.name)}</option>`)
    .join("");
  const picker = templates.length
    ? `<select class="heroui-select heroui-select-sm" title="Chèn một mẫu câu vào ô soạn" onchange="if(this.value){this.form.reply_draft.value=this.value;this.selectedIndex=0}"><option value="">Chèn mẫu câu…</option>${options}</select>`
    : "";
  return `
    <details class="card-reply" id="reply-${escapeHtml(mention.topic_id)}-${escapeHtml(mention.id)}"${draft ? " open" : ""}>
      <summary>${uiIcon("message", 12)} Soạn câu trả lời${draft ? ` <span class="draft-mark">có nháp</span>` : ""}</summary>
      <form class="reply-form" method="post" action="${action}/reply">${backFields}
        <textarea class="heroui-input reply-text" name="reply_draft" rows="3" maxlength="2000" placeholder="Viết câu trả lời, chèn mẫu câu, hoặc bấm “AI viết nháp”. Có sẵn nháp thì AI sẽ viết lại cho tốt hơn.">${escapeHtml(draft)}</textarea>
        <div class="reply-actions">
          ${picker}
          <button class="btn btn-xs btn-outline btn-ai-tag" type="submit" name="op" value="ai" title="AI viết nháp theo nội dung bài và giọng của các mẫu câu">${uiIcon("zap", 12)} AI viết nháp</button>
          <button class="btn btn-xs btn-outline" type="submit" name="op" value="save">Lưu nháp</button>
          <button class="btn btn-xs btn-outline" type="button" onclick="navigator.clipboard.writeText(this.form.reply_draft.value).then(()=>{this.textContent='Đã chép ✓'})">Sao chép</button>
          <button class="btn btn-xs btn-primary" type="submit" name="op" value="done" title="Lưu nháp và chuyển bài sang Đã xong">Lưu & Đã xong</button>
        </div>
      </form>
    </details>`;
}
