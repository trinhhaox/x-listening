import { formatDuration, OVERDUE_HOURS, type ResponseStats } from "../response.js";
import type { Topic } from "../db.js";
import { riskLabel, shiftDay, splitRisk, type Brief, type DayCount, type DigestPost } from "../digest.js";
import { uiIcon } from "../icons.js";
import { escapeHtml, formatWhen, layout } from "./layout.js";
import { renderMarkdown } from "./markdown.js";

const SENTIMENT_LABEL: Record<string, string> = { positive: "Tích cực", negative: "Tiêu cực", neutral: "Trung tính" };

function vnDay(day: string): string {
  return day.split("-").reverse().join("/");
}

function delta(now: number, before: number | undefined, worseWhenUp = false): string {
  if (before === undefined) return "";
  const diff = now - before;
  if (diff === 0) return `<small class="kpi-delta flat">= hôm trước</small>`;
  const up = diff > 0;
  const bad = worseWhenUp ? up : false;
  return `<small class="kpi-delta ${bad ? "bad" : up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(diff)} so với hôm trước</small>`;
}

function postItem(post: DigestPost, kind: "neg" | "starred"): string {
  const engagement = post.engagement ? `<span class="text-muted">${post.engagement} tương tác</span>` : "";
  const link = post.url
    ? `<a class="heroui-link" href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">Xem bài gốc ${uiIcon("external", 12)}</a>`
    : "";
  return `
      <li class="brief-item ${kind} heroui-card-sub">
        <div class="brief-item-head">
          <strong>@${escapeHtml(post.authorUsername)}</strong>
          <span class="source-topic-tag heroui-chip heroui-chip-bordered">${escapeHtml(post.topicName)}</span>
        </div>
        <p>${escapeHtml(post.text)}</p>
        <div class="brief-item-meta"><span class="text-muted">${escapeHtml(formatWhen(post.createdAt))}</span>${engagement}${link}</div>
      </li>`;
}

/** Khối nhận định AI. Dùng cả khi trang tải và khi tải riêng sau. */
export function aiBriefCard(brief: Brief, options: { hasAiKey: boolean; pending?: boolean }): string {
  const dayField = `<input type="hidden" name="day" value="${escapeHtml(brief.day)}" />`;
  const regenerate = options.hasAiKey
    ? `<form method="post" action="/brief/regenerate" class="ai-regen-form">${dayField}<button class="btn btn-sm btn-outline" type="submit">${uiIcon("refresh", 14)} Viết lại nhận định</button></form>`
    : "";

  let body: string;
  let riskChip = "";
  if (!options.hasAiKey) {
    body = `<p class="text-muted">Chưa có nhận định AI. Thêm khóa mô hình AI ở <a class="heroui-link" href="/settings">Cấu hình kết nối</a> để bản tin có phần đánh giá rủi ro và việc cần làm.</p>`;
  } else if (!brief.aiSummary) {
    body = options.pending
      ? `<div class="ai-pending" data-ai-pending="${escapeHtml(brief.day)}"><span class="ai-spinner"></span> AI đang đọc ${brief.posts} bài và viết nhận định, thường mất 10–30 giây…</div>`
      : brief.ai?.error
        ? `<div class="deck-alert warning">${uiIcon("alert")} Chưa viết được nhận định: ${escapeHtml(brief.ai.error)}</div>`
        : `<p class="text-muted">Chưa có nhận định cho ngày này.</p>`;
  } else {
    const { risk, reason, body: rest } = splitRisk(brief.aiSummary);
    if (risk) {
      riskChip = `<div class="risk-banner risk-${risk}"><strong>Mức rủi ro: ${riskLabel(risk)}</strong>${reason ? `<span>${escapeHtml(reason)}</span>` : ""}</div>`;
    }
    const refs = (brief.aiRefs ?? [])
      .map(
        (ref) => `
          <li id="post-${ref.n}" class="ai-ref">
            <span class="ai-ref-n">#${ref.n}</span>
            <div>
              <div class="ai-ref-head"><strong>@${escapeHtml(ref.author)}</strong> · ${escapeHtml(ref.topic)} · <span class="sent-${escapeHtml(ref.sentiment)}">${SENTIMENT_LABEL[ref.sentiment] ?? escapeHtml(ref.sentiment)}</span>${ref.url ? ` · <a class="heroui-link" href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer">Xem bài</a>` : ""}</div>
              <p>${escapeHtml(ref.text)}</p>
            </div>
          </li>`,
      )
      .join("");
    const notes: string[] = [];
    if (brief.ai?.stale && !options.pending) notes.push("Dữ liệu ngày này đã thay đổi sau lần viết; bấm “Viết lại nhận định” để cập nhật.");
    if (brief.ai?.error) notes.push(`Lần viết lại gần nhất lỗi: ${brief.ai.error}`);
    body = `
      ${riskChip}
      ${notes.map((n) => `<div class="deck-alert info">${uiIcon("info")} ${escapeHtml(n)}</div>`).join("")}
      ${options.pending ? `<div class="ai-pending" data-ai-pending="${escapeHtml(brief.day)}"><span class="ai-spinner"></span> Đang cập nhật theo dữ liệu mới…</div>` : ""}
      <div class="ai-markdown">${renderMarkdown(rest || brief.aiSummary)}</div>
      ${refs ? `<details class="ai-refs" open><summary>Bài được dẫn chứng (${brief.aiRefs!.length})</summary><ol class="ai-ref-list">${refs}</ol></details>` : ""}`;
  }

  const meta =
    brief.ai?.generatedAt && brief.aiSummary
      ? `<small class="text-muted ai-meta">Viết lúc ${escapeHtml(formatWhen(brief.ai.generatedAt))} · ${escapeHtml(brief.ai.model)} · dựa trên ${brief.ai.basedOn} bài</small>`
      : "";

  return `
    <section id="ai-brief-card" class="ai-brief-card heroui-card">
      <div class="ai-brief-head">
        <div>
          <span class="ai-badge heroui-chip heroui-chip-primary">${uiIcon("bot", 14)} Nhận định AI</span>
          <h2>Đánh giá rủi ro & việc cần làm</h2>
          ${meta}
        </div>
        ${regenerate}
      </div>
      <div class="ai-brief-content">${body}</div>
    </section>`;
}

export function briefPage(
  brief: Brief,
  notice: string | undefined,
  options: { today: string; hasAiKey: boolean; pending?: boolean },
): string {
  const negative = brief.negative.map((post) => postItem(post, "neg")).join("");
  const starred = brief.starred.map((post) => postItem(post, "starred")).join("");
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

  const prevDay = shiftDay(brief.day, -1);
  const nextDay = shiftDay(brief.day, 1);
  const isToday = brief.day >= options.today;
  const dayQuery = isToday ? "" : `?day=${encodeURIComponent(brief.day)}`;
  const dayField = `<input type="hidden" name="day" value="${escapeHtml(brief.day)}" />`;

  const total = Math.max(1, brief.posts);
  const pct = (n: number) => Math.round((n / total) * 100);
  const s = brief.sentiment;
  const sentimentBar = brief.posts
    ? `<div class="sent-bar" role="img" aria-label="Tích cực ${s.positive}, trung tính ${s.neutral}, tiêu cực ${s.negative}">
        <span class="seg pos" style="width:${pct(s.positive)}%"></span><span class="seg neu" style="width:${pct(s.neutral)}%"></span><span class="seg neg" style="width:${pct(s.negative)}%"></span>
      </div>
      <div class="sent-legend"><span><i class="dot pos"></i>Tích cực ${s.positive}</span><span><i class="dot neu"></i>Trung tính ${s.neutral}</span><span><i class="dot neg"></i>Tiêu cực ${s.negative}</span></div>`
    : `<p class="text-muted">Không có bài viết trong ngày.</p>`;
  const topics = brief.topics
    .slice(0, 6)
    .map(
      (t) => `<li><span>${escapeHtml(t.name)}</span><strong>${t.posts}</strong>${t.negative ? `<small class="text-danger">${t.negative} tiêu cực</small>` : ""}</li>`,
    )
    .join("");

  const prev = brief.previous;
  const script = options.pending
    ? `<script>
(() => {
  const el = document.querySelector("[data-ai-pending]");
  if (!el) return;
  const body = new URLSearchParams({ day: el.getAttribute("data-ai-pending") || "" });
  fetch("/brief/ai", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((html) => { const card = document.getElementById("ai-brief-card"); if (card) card.outerHTML = html; })
    .catch(() => { el.textContent = "Không tải được nhận định. Tải lại trang hoặc bấm “Viết lại nhận định”."; });
})();
</script>`
    : "";

  return layout(
    "Báo cáo AI hàng ngày",
    `
    <div class="deck-page-header">
      <div class="page-header-title">
        <div class="title-with-badge">
          <h1>${uiIcon("report", 22)} Báo cáo ngày ${escapeHtml(vnDay(brief.day))}</h1>
          ${isToday ? `<span class="heroui-chip heroui-chip-primary">Hôm nay</span>` : ""}
        </div>
        <p class="text-muted">Số liệu trong ngày, nhận định rủi ro của AI và các bài cần lưu ý</p>
      </div>
      <div class="page-header-actions">
        <a class="btn btn-outline" href="/brief.md${dayQuery}">${uiIcon("download")} Tải .md</a>
        <form method="post" action="/brief/send-webhook" style="display:inline-block;">${dayField}<button class="btn btn-primary" type="submit">${uiIcon("send")} Gửi qua Webhook</button></form>
      </div>
    </div>

    <nav class="brief-day-nav heroui-card" aria-label="Chọn ngày">
      <a class="btn btn-sm btn-outline" href="/brief?day=${encodeURIComponent(prevDay)}">‹ ${escapeHtml(vnDay(prevDay).slice(0, 5))}</a>
      <form method="get" action="/brief" class="brief-day-form">
        <input class="heroui-input" type="date" name="day" value="${escapeHtml(brief.day)}" max="${escapeHtml(options.today)}" />
        <button class="btn btn-sm btn-outline" type="submit">Xem</button>
      </form>
      ${isToday ? `<span class="btn btn-sm btn-outline is-disabled" aria-disabled="true">${escapeHtml(vnDay(nextDay).slice(0, 5))} ›</span>` : `<a class="btn btn-sm btn-outline" href="/brief?day=${encodeURIComponent(nextDay)}">${escapeHtml(vnDay(nextDay).slice(0, 5))} ›</a>`}
      ${isToday ? "" : `<a class="btn btn-sm btn-primary" href="/brief">Hôm nay</a>`}
    </nav>

    ${notice ? `<div class="deck-alert info">${uiIcon("info")} ${escapeHtml(notice)}</div>` : ""}

    <section class="brief-kpis">
      <div class="kpi-box heroui-card">
        <span class="kpi-label">Tổng bài viết</span>
        <strong class="kpi-val">${brief.posts.toLocaleString("vi-VN")}</strong>
        ${delta(brief.posts, prev?.posts)}
        ${prev ? `<small class="text-muted">TB 7 ngày: ${prev.avg7.toLocaleString("vi-VN")}/ngày</small>` : ""}
      </div>
      <div class="kpi-box heroui-card">
        <span class="kpi-label">Ý kiến tiêu cực</span>
        <strong class="kpi-val text-danger">${brief.negative.length}</strong>
        ${delta(brief.negative.length, prev?.negative, true)}
      </div>
      <div class="kpi-box heroui-card">
        <span class="kpi-label">Tác giả mới</span>
        <strong class="kpi-val">${brief.newAuthors.length}</strong>
      </div>
      <div class="kpi-box heroui-card">
        <span class="kpi-label">Bài đang lưu ý</span>
        <strong class="kpi-val text-success">${brief.starred.length}</strong>
      </div>
    </section>

    <div class="brief-main-grid">
      ${aiBriefCard(brief, { hasAiKey: options.hasAiKey, pending: options.pending })}
      <aside class="brief-side">
        <div class="brief-col heroui-card">
          <h3>Cảm xúc trong ngày</h3>
          ${sentimentBar}
        </div>
        ${responseCard(brief.response)}
        <div class="brief-col heroui-card">
          <h3>Theo nguồn theo dõi</h3>
          ${topics ? `<ul class="topic-split">${topics}</ul>` : `<p class="text-muted">Không có dữ liệu.</p>`}
        </div>
      </aside>
    </div>

    <section class="brief-columns-grid">
      <div class="brief-col heroui-card">
        <h3><span class="stat-dot neg"></span> Ý kiến tiêu cực (${brief.negative.length})</h3>
        <ul class="brief-list">
          ${negative || `<li class="empty-brief text-muted">Không có bài viết tiêu cực nào trong ngày.</li>`}
        </ul>
      </div>

      <div class="brief-col heroui-card">
        <h3>${uiIcon("user", 16)} Tác giả mới (${brief.newAuthors.length})</h3>
        <ul class="brief-list">
          ${authors || `<li class="empty-brief text-muted">Không có người viết mới trong ngày.</li>`}
        </ul>
      </div>

      <div class="brief-col heroui-card">
        <h3>${uiIcon("starFilled", 16)} Đang lưu ý (${brief.starred.length})</h3>
        <ul class="brief-list">
          ${starred || `<li class="empty-brief text-muted">Không có bài viết nào được đánh dấu sao.</li>`}
        </ul>
      </div>
    </section>
    ${script}
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

export function responseCard(stats: ResponseStats | undefined): string {
  if (!stats) return "";
  if (stats.negative === 0) {
    return `<div class="brief-col heroui-card response-card"><h3>Xử lý bài tiêu cực</h3><p class="text-muted">Không có bài tiêu cực nào trong ${stats.days} ngày.</p></div>`;
  }
  const rate = Math.round((stats.done / stats.negative) * 100);
  const people = stats.byAssignee
    .slice(0, 6)
    .map(
      (p) =>
        `<li><span>${escapeHtml(p.name)}</span><strong>${p.done}/${p.done + p.open}</strong><small class="text-muted">${p.done ? `TV ${escapeHtml(formatDuration(p.medianMinutes))}` : "chưa xong bài nào"}</small></li>`,
    )
    .join("");
  return `
        <div class="brief-col heroui-card response-card">
          <h3>Xử lý bài tiêu cực <small class="text-muted">${stats.days} ngày</small></h3>
          <div class="response-kpis">
            <div><span class="kpi-label">Đã xong</span><strong>${stats.done}/${stats.negative}</strong><small class="text-muted">${rate}%</small></div>
            <div><span class="kpi-label">Thời gian trung vị</span><strong>${escapeHtml(formatDuration(stats.medianMinutes))}</strong><small class="text-muted">90%: ${escapeHtml(formatDuration(stats.p90Minutes))}</small></div>
            <div><span class="kpi-label">Còn mở</span><strong class="${stats.overdue ? "text-danger" : ""}">${stats.open}</strong><small class="${stats.overdue ? "text-danger" : "text-muted"}">${stats.overdue ? `${stats.overdue} chờ quá ${OVERDUE_HOURS} giờ` : "không bài nào quá hạn"}</small></div>
          </div>
          <ul class="topic-split">${people}</ul>
          <small class="text-muted">Tính từ lúc hệ thống thấy bài đến lúc bấm Đã xong. TV: trung vị.</small>
          ${stats.open ? `<a class="heroui-link" href="/?view=new&amp;sentiment=negative">Mở các bài tiêu cực chưa đọc →</a>` : ""}
        </div>`;
}
