import type { AlertHitRow, AlertRule, MentionRow, MentionView, Topic, Voice } from "./db.js";
import type { Brief, DayCount } from "./digest.js";

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
  activeTopic: string;
  view: MentionView;
  hasToken: boolean;
  hasFacebook: boolean;
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
};

export function loginPage(error = ""): string {
  return layout(
    "Đăng nhập",
    `<form class="login" method="post" action="/login">
      <p class="kicker">Bàn nghe</p>
      <h1>Chỉ người vận hành vào được phòng này.</h1>
      <label>Mật khẩu<input type="password" name="password" autocomplete="current-password" required minlength="8" /></label>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <button type="submit">Vào bàn nghe</button>
    </form>`,
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

  const topicList = model.topics
    .map((topic) => {
      const state = topic.active ? "đang nghe" : "tạm dừng";
      const error = topic.last_error ? `<p class="error">${escapeHtml(topic.last_error)}</p>` : "";
      return `<li class="${topic.active ? "on" : "off"}">
        <div>
          <strong>${escapeHtml(topic.name)}</strong>
          <span>${state}${topic.last_listened_at ? ` · ${escapeHtml(formatWhen(topic.last_listened_at))}` : ""}</span>
          <code>${topic.source === "facebook" ? "Facebook" : "X"} · ${escapeHtml(topic.query)}${topic.phrase ? ` · “${escapeHtml(topic.phrase)}”` : ""}</code>
          ${error}
        </div>
        <form method="post" action="/topics/${escapeHtml(topic.id)}/toggle">
          <button type="submit">${topic.active ? "Tạm dừng" : "Nghe lại"}</button>
        </form>
        <form method="post" action="/topics/${escapeHtml(topic.id)}/backfill">
          <button class="quiet" type="submit">Lấy 7 ngày</button>
        </form>
        <form method="post" action="/topics/${escapeHtml(topic.id)}/delete" onsubmit="return confirm('Gỡ chủ đề này và toàn bộ tin đã lưu?')">
          <button type="submit" class="quiet">Gỡ</button>
        </form>
      </li>`;
    })
    .join("");

  const backFields = `<input type="hidden" name="topic" value="${escapeHtml(model.activeTopic)}" /><input type="hidden" name="view" value="${escapeHtml(model.view)}" />`;
  const rows = model.mentions
    .map((mention, index) => {
      const username = mention.author_username;
      const href = mention.url || ( /^\d+$/.test(mention.id) ? `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(mention.id)}` : "");
      const openLabel = href.includes("facebook.com") || href.includes("fb.com") ? "Mở trên Facebook" : "Mở trên X";
      const action = `/mentions/${encodeURIComponent(mention.topic_id)}/${encodeURIComponent(mention.id)}`;
      const sample = mention.sample ? `<em class="stamp">Mẫu</em>` : "";
      const note = mention.note ? `<p class="note">${escapeHtml(mention.note)}</p>` : "";
      return `<article class="${mention.starred ? "starred" : ""}" style="animation-delay:${index * 40}ms">
        <header>
          <div>
            <b>${escapeHtml(mention.author_name)}</b>
            <span>@${escapeHtml(username)}</span>
          </div>
          <time>${escapeHtml(formatWhen(mention.created_at))}</time>
        </header>
        <p>${escapeHtml(mention.text)}</p>
        ${note}
        <footer>
          <span class="feel ${escapeHtml(mention.sentiment)}">${labelSentiment(mention.sentiment)}</span>
          <span>${escapeHtml(mention.topic_name)}</span>
          ${sample}
          <span class="counts">${mention.like_count} thích · ${mention.reply_count} trả lời · ${mention.repost_count} đăng lại</span>
          ${mention.sample || !href ? "" : `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${openLabel}</a>`}
        </footer>
        <div class="actions">
          ${queueButton(action, backFields, "new", "Mới", mention.queue)}
          ${queueButton(action, backFields, "reading", "Đang xử lý", mention.queue)}
          ${queueButton(action, backFields, "done", "Xong", mention.queue)}
          <form method="post" action="${action}/star">${backFields}<button class="quiet" type="submit">${mention.starred ? "Bỏ ghim" : "Ghim"}</button></form>
          <form method="post" action="${action}/hide">${backFields}<button class="quiet" type="submit">${mention.hidden ? "Hiện lại" : "Giấu"}</button></form>
          <form method="post" action="/mutes">${backFields}<input type="hidden" name="username" value="${escapeHtml(username)}" /><button class="quiet" type="submit">Tắt tiếng</button></form>
          <form class="note-form" method="post" action="${action}/note">${backFields}<input name="note" maxlength="280" value="${escapeHtml(mention.note)}" placeholder="Ghi chú nội bộ" /><button class="quiet" type="submit">Lưu chú</button></form>
        </div>
      </article>`;
    })
    .join("");

  const alertTopics = model.topics
    .map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.name)}</option>`)
    .join("");
  const hits = model.hits
    .map(
      (hit) => `<li>
        <div>
          <strong>${escapeHtml(hit.alert_name)}</strong>
          <span>${escapeHtml(hit.reason)} · ${escapeHtml(hit.author_name)} · ${escapeHtml(hit.topic_name)}</span>
          <p>${escapeHtml(hit.text)}</p>
        </div>
        <form method="post" action="/alerts/hits/${escapeHtml(hit.id)}/seen">${backFields}<button class="quiet" type="submit">Đã xem</button></form>
      </li>`,
    )
    .join("");
  const rules = model.alerts
    .map((rule) => {
      const detail = rule.kind === "phrase" ? rule.phrase : rule.kind === "likes" ? `${rule.min_likes} thích` : "nghiêng xấu";
      return `<li class="pair"><div><strong>${escapeHtml(rule.name)}</strong><span>${escapeHtml(detail)}</span></div>
        <form method="post" action="/alerts/${escapeHtml(rule.id)}/delete">${backFields}<button class="quiet" type="submit">Gỡ</button></form></li>`;
    })
    .join("");
  const voices = model.voices
    .map(
      (voice) =>
        `<span><b>${escapeHtml(voice.author_name)}</b> @${escapeHtml(voice.author_username)} · ${voice.posts} bài</span>`,
    )
    .join("");
  const muted = model.muted
    .map(
      (username) => `<li class="pair"><div><strong>@${escapeHtml(username)}</strong></div>
        <form method="post" action="/mutes/${encodeURIComponent(username)}/delete">${backFields}<button class="quiet" type="submit">Bỏ tắt</button></form></li>`,
    )
    .join("");
  const viewLink = (view: MentionView, label: string) => {
    const params = new URLSearchParams();
    if (model.activeTopic) params.set("topic", model.activeTopic);
    if (view !== "wire") params.set("view", view);
    const query = params.toString();
    return `<a class="${model.view === view ? "on" : ""}" href="/${query ? `?${query}` : ""}">${label}</a>`;
  };

  const bars = model.days
    .map(
      (day) =>
        `<div class="bar" title="${escapeHtml(day.day)}: ${day.count}"><i style="height:${Math.max(8, Math.round((day.count / maxDay) * 100))}%"></i><span>${escapeHtml(day.day.slice(5))}</span></div>`,
    )
    .join("");

  return layout(
    "Bàn nghe",
    `<header class="top">
      <div>
        <p class="kicker"><i class="pulse"></i> Bàn nghe · bài công khai trên X và Trang Facebook</p>
        <h1>Dây tin đang chạy qua các tần số bạn đặt.</h1>
      </div>
      <a class="nav" href="/brief">Bản tin</a>
      <a class="nav" href="/compare">So tần số</a>
      <form method="post" action="/listen"><button type="submit">Lắng nghe ngay</button></form>
      <form method="post" action="/logout"><button class="quiet" type="submit">Thoát</button></form>
    </header>
    ${model.notice ? `<p class="notice">${escapeHtml(model.notice)}</p>` : ""}
    ${model.spike ? `<p class="notice">Đột biến: ${escapeHtml(model.spike)}</p>` : ""}
    ${model.hasToken ? "" : `<p class="notice">Chưa có X_BEARER_TOKEN. Bàn nghe mở được, nhưng chưa hỏi được X. Gắn token trong file .env rồi chạy lại.</p>`}
    ${model.hasFacebook ? "" : `<p class="notice">Chưa có FACEBOOK_ACCESS_TOKEN. Tần số Facebook cần token đọc Trang trong file .env.</p>`}
    <section class="meters">
      <div><span>24 giờ</span><strong>${model.stats.mentions}</strong><small>bài</small></div>
      <div><span>người viết</span><strong>${model.stats.authors}</strong><small>tài khoản</small></div>
      <div><span>tương tác</span><strong>${model.stats.engagement}</strong><small>thích, trả lời, đăng lại</small></div>
      <div class="feelbar" aria-label="Sắc thái">
        <span>sắc thái từ vựng</span>
        <div><i class="pos" style="width:${pct(model.stats.positive)}%"></i><i class="neg" style="width:${pct(model.stats.negative)}%"></i></div>
        <small>${model.stats.positive} nghiêng tốt · ${model.stats.negative} nghiêng xấu · ${model.stats.neutral} trung tính</small>
      </div>
    </section>
    <section class="days">${bars || `<p class="empty">Chưa đủ ngày để vẽ cột.</p>`}</section>
    <section class="voices"><h2>Người viết nhiều, 7 ngày</h2>${voices || `<p class="empty">Chưa có người viết.</p>`}</section>
    ${hits ? `<section class="hits"><h2>Chuông đang kêu</h2><ul>${hits}</ul></section>` : ""}
    <div class="split">
      <aside>
        <h2>Tần số</h2>
        <form class="add" method="post" action="/topics">
          <label>Tên gọi<input name="name" required maxlength="80" placeholder="Quán cà phê giấy" /></label>
          <label>Mạng<select name="source"><option value="x">X</option><option value="facebook">Facebook</option></select></label>
          <label>Câu trên X, hoặc link Trang Facebook<textarea name="query" required maxlength="300" rows="4" placeholder="&quot;cà phê giấy&quot; OR giaycafe lang:vi"></textarea></label>
          <label>Cụm giữ lại trên Facebook<input name="phrase" maxlength="80" placeholder="Để trống thì lấy mọi bài của trang" /></label>
          <label class="check"><input type="checkbox" name="exclude_reposts" checked /> Bỏ bài đăng lại trên X</label>
          <button type="submit">Thêm tần số</button>
        </form>
        <ul class="topics">${topicList || `<li class="off"><div><strong>Chưa có tần số</strong><span>Thêm một câu tìm kiếm để bắt đầu nghe.</span></div></li>`}</ul>
        <h2>Chuông</h2>
        ${model.outbound ? `<p class="hint">Hồi chuông mới còn ra ${escapeHtml(model.outbound)}.</p>` : ""}
        ${model.notifyError ? `<p class="error">${escapeHtml(model.notifyError)}</p>` : ""}
        <form class="add" method="post" action="/alerts">
          <label>Tên<input name="name" required maxlength="80" placeholder="Bài kêu ca" /></label>
          <label>Khi nào<select name="kind">
            <option value="negative">Bài nghiêng xấu</option>
            <option value="phrase">Có cụm từ</option>
            <option value="likes">Đủ lượt thích</option>
          </select></label>
          <label>Cụm từ<input name="phrase" maxlength="80" placeholder="thất vọng" /></label>
          <label>Số thích tối thiểu<input name="min_likes" type="number" min="1" max="1000000" value="20" /></label>
          <label>Áp vào<select name="topic_id"><option value="">Mọi tần số</option>${alertTopics}</select></label>
          <button type="submit">Đặt chuông</button>
        </form>
        <ul class="topics">${rules}</ul>
        <h2>Từ của bạn</h2>
        <form class="add" method="post" action="/lexicon">
          <label>Từ hoặc cụm<input name="word" required maxlength="40" placeholder="ngon" /></label>
          <label>Sắc thái<select name="polarity"><option value="positive">Nghiêng tốt</option><option value="negative">Nghiêng xấu</option></select></label>
          <button type="submit">Thêm từ</button>
        </form>
        <ul class="topics">${lexiconList(model.lexicon, backFields) || `<li class="off"><div><strong>Chưa thêm từ</strong><span>Từ thêm được tính cùng bộ có sẵn, và ghi đè nếu trùng.</span></div></li>`}</ul>
        <h2>Đã tắt tiếng</h2>
        <ul class="topics">${muted || `<li class="off"><div><strong>Chưa tắt ai</strong><span>Tắt tiếng trên một bài để chặn bài sau của tài khoản đó.</span></div></li>`}</ul>
        <form method="post" action="/samples"><button class="quiet" type="submit">Nạp tin mẫu</button></form>
        <form method="post" action="/samples/clear"><button class="quiet" type="submit">Xóa tin mẫu</button></form>
      </aside>
      <section class="wire">
        <div class="wire-head">
          <h2>Dây tin</h2>
          <nav class="views">${viewLink("wire", "Dây tin")}${viewLink("new", `Mới ${model.queueNew}`)}${viewLink("reading", "Đang xử lý")}${viewLink("done", "Xong")}${viewLink("starred", "Đã ghim")}${viewLink("hidden", "Đã giấu")}</nav>
          <form method="get" action="/">
            <input type="hidden" name="view" value="${escapeHtml(model.view === "wire" ? "" : model.view)}" />
            <select name="topic" onchange="this.form.submit()">
              <option value="">Mọi tần số</option>
              ${topicOptions}
            </select>
          </form>
          <a href="/export.csv${model.activeTopic ? `?topic=${encodeURIComponent(model.activeTopic)}` : ""}">Tải CSV</a>
        </div>
        ${rows || `<p class="empty">Chưa có tin. Thêm tần số, rồi bấm Lắng nghe ngay. Tin mẫu có dấu Mẫu và không phải bài thật.</p>`}
      </section>
    </div>`,
  );
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

export function briefPage(brief: Brief): string {
  const negative = brief.negative
    .map((post) => `<li><b>@${escapeHtml(post.authorUsername)}</b> · ${escapeHtml(post.topicName)}<p>${escapeHtml(post.text)}</p></li>`)
    .join("");
  const authors = brief.newAuthors
    .map((author) => `<li><b>@${escapeHtml(author.username)}</b> ${escapeHtml(author.name)} · ${author.posts} bài</li>`)
    .join("");
  const starred = brief.starred
    .map((post) => `<li><b>@${escapeHtml(post.authorUsername)}</b><p>${escapeHtml(post.text)}</p></li>`)
    .join("");
  return layout(
    "Bản tin",
    `<header class="top">
      <div>
        <p class="kicker">Bản tin cuối ngày</p>
        <h1>${escapeHtml(brief.day.split("-").reverse().join("/"))}</h1>
      </div>
      <a class="nav" href="/">Dây tin</a>
      <a class="nav" href="/brief.md">Tải Markdown</a>
    </header>
    <section class="meters">
      <div><span>bài</span><strong>${brief.posts}</strong></div>
      <div><span>nghiêng xấu</span><strong>${brief.negative.length}</strong></div>
      <div><span>người viết lần đầu</span><strong>${brief.newAuthors.length}</strong></div>
      <div><span>đang ghim</span><strong>${brief.starred.length}</strong></div>
    </section>
    <h2>Nghiêng xấu</h2>
    <ul class="brief">${negative || `<li class="empty">Không có.</li>`}</ul>
    <h2>Người viết lần đầu</h2>
    <ul class="brief">${authors || `<li class="empty">Không có.</li>`}</ul>
    <h2>Đang ghim</h2>
    <ul class="brief">${starred || `<li class="empty">Không có.</li>`}</ul>`,
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
      return `<div class="bar" title="${escapeHtml(row.day)}"><span class="pair-bars"><i class="left" style="height:${leftHeight}%"></i><i class="right" style="height:${rightHeight}%"></i></span><span>${escapeHtml(row.day.slice(5))}</span><small>${row.left.posts}/${row.right.posts} bài · ${row.left.authors}/${row.right.authors} người</small></div>`;
    })
    .join("");
  return layout(
    "So tần số",
    `<header class="top">
      <div>
        <p class="kicker">Bảy ngày, giờ Việt Nam</p>
        <h1>Hai tần số cạnh nhau.</h1>
      </div>
      <a class="nav" href="/">Dây tin</a>
    </header>
    <form class="compare-form" method="get" action="/compare">
      <label>Tần số A<select name="left">${options(model.left)}</select></label>
      <label>Tần số B<select name="right">${options(model.right)}</select></label>
      <button type="submit">So</button>
    </form>
    <p class="legend"><i class="left"></i>${escapeHtml(leftName)} <i class="right"></i>${escapeHtml(rightName)}</p>
    <section class="days compare-days">${bars}</section>`,
  );
}

function lexiconList(words: { word: string; polarity: string }[], backFields: string): string {
  return words
    .map((item) => {
      const label = item.polarity === "negative" ? "nghiêng xấu" : "nghiêng tốt";
      return `<li class="pair"><div><strong>${escapeHtml(item.word)}</strong><span>${label}</span></div>
        <form method="post" action="/lexicon/delete">${backFields}<input type="hidden" name="word" value="${escapeHtml(item.word)}" /><button class="quiet" type="submit">Gỡ</button></form></li>`;
    })
    .join("");
}

function queueButton(action: string, backFields: string, queue: string, label: string, current: string): string {
  const selected = current === queue ? " current" : "";
  return `<form method="post" action="${action}/queue">${backFields}<input type="hidden" name="queue" value="${queue}" /><button class="quiet${selected}" type="submit">${label}</button></form>`;
}

function labelSentiment(value: string): string {
  if (value === "positive") return "nghiêng tốt";
  if (value === "negative") return "nghiêng xấu";
  return "trung tính";
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
  <title>${escapeHtml(title)} · X Listening</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --paper: #f3ecdf;
      --ink: #241c14;
      --muted: #6d5e50;
      --line: #ddcbb4;
      --copper: #b5522a;
      --moss: #2f5d45;
      --clay: #8d4b3a;
      --card: rgba(255, 250, 242, 0.78);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      color: var(--ink);
      font-family: "Be Vietnam Pro", "Noto Sans", sans-serif;
      font-size: 17px;
      background:
        radial-gradient(circle at 12% -10%, #f7d7b8 0, transparent 36%),
        linear-gradient(180deg, #f7f1e6 0%, var(--paper) 40%, #efe4d2 100%);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image: repeating-linear-gradient(0deg, transparent, transparent 27px, rgba(36, 28, 20, 0.035) 28px);
    }
    main { position: relative; max-width: 1180px; margin: 0 auto; padding: 28px 22px 64px; }
    h1 { font-size: clamp(1.8rem, 3vw, 2.7rem); line-height: 1.15; font-weight: 600; letter-spacing: -0.03em; margin: 0; max-width: 16ch; }
    h2 { font-size: 1.05rem; margin: 0 0 12px; }
    .kicker { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--copper); display: flex; align-items: center; gap: 8px; }
    .pulse { width: 8px; height: 8px; border-radius: 99px; background: var(--moss); display: inline-block; animation: beat 1.8s ease-in-out infinite; }
    @keyframes beat { 50% { transform: scale(0.7); opacity: 0.55; } }
    .top, .wire-head, .meters { display: flex; gap: 18px; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; }
    .top { margin-bottom: 22px; }
    a.nav { background: transparent; color: var(--ink); border: 1px solid var(--line); border-radius: 999px; padding: 10px 16px; text-decoration: none; }
    .pair-bars { display: flex; gap: 6px; align-items: end; height: 72px; }
    .pair-bars i { display: block; width: 10px; border-radius: 4px 4px 2px 2px; }
    .pair-bars i.left { background: #c9844a; }
    .pair-bars i.right { background: var(--moss); }
    .legend i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; }
    .legend .left { background: #c9844a; }
    .legend .right { background: var(--moss); }
    button, select, a { font: inherit; }
    button, .wire-head a {
      background: var(--ink); color: #f6efe4; border: 0; border-radius: 999px; padding: 10px 16px; cursor: pointer; text-decoration: none;
    }
    button.quiet, .wire-head a { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    input, textarea, select {
      width: 100%; margin-top: 6px; padding: 12px 12px; font: inherit; font-size: 17px;
      border: 1px solid var(--line); border-radius: 12px; background: #fffaf4; color: var(--ink);
    }
    label { display: block; margin-bottom: 12px; color: var(--muted); font-size: 0.92rem; }
    label.check { display: flex; gap: 8px; align-items: center; }
    label.check input { width: auto; }
    .hint { color: var(--muted); font-size: 0.92rem; }
    .notice, .error { background: #fff4ea; border-left: 3px solid var(--copper); padding: 10px 12px; }
    .error { color: var(--clay); }
    .meters { align-items: stretch; margin: 18px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 14px 0; }
    .meters strong { display: block; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 2rem; font-weight: 500; line-height: 1; }
    .meters span, .meters small, .feelbar small { color: var(--muted); }
    .feelbar { min-width: min(100%, 280px); flex: 1.4; }
    .feelbar div { display: flex; height: 10px; background: #e6d8c4; border-radius: 99px; overflow: hidden; margin: 8px 0; }
    .feelbar .pos { background: var(--moss); }
    .feelbar .neg { background: var(--copper); }
    .days { display: flex; gap: 8px; align-items: end; min-height: 92px; margin-bottom: 22px; }
    .bar { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 92px; justify-content: end; }
    .bar i { display: block; width: 100%; max-width: 28px; background: #c9844a; border-radius: 6px 6px 2px 2px; }
    .bar span, .bar small { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 0.72rem; color: var(--muted); }
    .compare-days { align-items: end; }
    .compare-days .bar { height: auto; }
    .compare-form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: end; margin-bottom: 16px; }
    .brief { list-style: none; padding: 0; }
    .brief li { padding: 10px 0; border-top: 1px solid var(--line); }
    .legend { color: var(--muted); }
    .split { display: grid; grid-template-columns: minmax(260px, 0.85fr) 1.6fr; gap: 28px; }
    aside { position: sticky; top: 16px; align-self: start; }
    .topics { list-style: none; padding: 0; margin: 16px 0; display: grid; gap: 12px; }
    .topics li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 12px; border-top: 1px solid var(--line); }
    .topics li > div { flex: 1 0 100%; }
    .topics strong { display: block; }
    .topics span, .topics code { display: block; color: var(--muted); font-size: 0.86rem; }
    .topics code { font-family: "IBM Plex Mono", ui-monospace, monospace; white-space: pre-wrap; margin-top: 4px; }
    .topics li.off strong { color: var(--muted); }
    .topics li.pair { display: grid; grid-template-columns: 1fr auto; align-items: center; }
    .voices { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: baseline; margin: 0 0 22px; }
    .voices h2 { width: 100%; }
    .voices span { color: var(--muted); }
    .hits ul, .hits { list-style: none; padding: 0; margin: 0 0 18px; }
    .hits li { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; padding: 12px 0; border-top: 1px solid var(--line); }
    .hits span, .hits p { color: var(--muted); margin: 4px 0 0; }
    .views { display: flex; gap: 8px; flex-wrap: wrap; }
    .views a { border: 1px solid var(--line); border-radius: 999px; padding: 8px 12px; text-decoration: none; color: var(--ink); }
    .views a.on { background: var(--ink); color: #f6efe4; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .actions button.current { background: var(--ink); color: #f6efe4; }
    .note-form { display: flex; gap: 8px; flex: 1; min-width: min(100%, 280px); }
    .note-form input { margin: 0; }
    article .note { color: var(--clay); margin: 0; }
    article.starred { border-left: 3px solid var(--copper); padding-left: 12px; }
    article { padding: 16px 0; border-top: 1px solid var(--line); animation: rise 0.45s ease both; }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
    article header, article footer { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: var(--muted); font-size: 0.9rem; }
    article p { margin: 8px 0; font-size: 1.05rem; }
    .feel.positive { color: var(--moss); }
    .feel.negative { color: var(--copper); }
    .stamp { font-style: normal; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid var(--line); padding: 1px 6px; }
    .empty { color: var(--muted); }
    .login { max-width: 420px; padding-top: 12vh; }
    .login h1 { max-width: none; margin-bottom: 18px; }
    @media (max-width: 800px) {
      .split { grid-template-columns: 1fr; }
      aside { position: static; }
      .meters { display: grid; grid-template-columns: 1fr 1fr; }
      .compare-form { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pulse, article { animation: none; }
    }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}
