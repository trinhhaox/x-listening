import type { Topic } from "../db.js";
import type { Brief, DayCount } from "../digest.js";
import { uiIcon } from "../icons.js";
import { escapeHtml, layout } from "./layout.js";

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
