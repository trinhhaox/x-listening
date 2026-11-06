import type { Topic } from "../db.js";
import type { HashtagAnalyticsResult } from "../hashtags.js";
import { uiIcon } from "../icons.js";
import { escapeHtml, layout } from "./layout.js";

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
