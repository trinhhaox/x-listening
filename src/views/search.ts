import type { LiveSearchResult } from "../social_search.js";
import { uiIcon } from "../icons.js";
import { escapeHtml, formatWhen, layout } from "./layout.js";

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
