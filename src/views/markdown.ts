import { escapeHtml } from "./layout.js";

/** Định dạng trong dòng: **đậm**, `mã`, [#3] (tham chiếu bài). Đầu vào đã được escape. */
function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[#(\d{1,3})\]/g, '<a class="post-ref" href="#post-$1">#$1</a>')
    .replace(/\[([^\]\n]{2,24})\]/g, '<span class="owner-chip">$1</span>');
}

/**
 * Markdown tối giản và an toàn cho nhận định AI: tiêu đề, danh sách, trích dẫn, đường kẻ, đoạn văn.
 * Mọi chữ đều được escape trước; không cho HTML hay liên kết tùy ý.
 */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.join("<br />")}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const openList = (kind: "ul" | "ol") => {
    if (list === kind) return;
    closeList();
    out.push(`<${kind}>`);
    list = kind;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    // Bảng: bỏ dòng phân cách, nối các ô thành một dòng.
    if (/^\|?\s*:?-{2,}/.test(line) && /^[|\s:-]+$/.test(line)) continue;
    if (line.startsWith("|")) {
      flushParagraph();
      openList("ul");
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      out.push(`<li>${inline(escapeHtml(cells.join(" · ")))}</li>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      closeList();
      out.push("<hr />");
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1]!.length <= 2 ? "h3" : "h4";
      out.push(`<${level}>${inline(escapeHtml(heading[2]!.replace(/\*\*/g, "")))}</${level}>`);
      continue;
    }
    const bullet = /^[-*•+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      openList("ul");
      out.push(`<li>${inline(escapeHtml(bullet[1]!))}</li>`);
      continue;
    }
    const numbered = /^(\d{1,2})[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      openList("ol");
      out.push(`<li>${inline(escapeHtml(numbered[2]!))}</li>`);
      continue;
    }
    if (line.startsWith(">")) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${inline(escapeHtml(line.replace(/^>\s?/, "")))}</blockquote>`);
      continue;
    }
    closeList();
    paragraph.push(inline(escapeHtml(line)));
  }
  flushParagraph();
  closeList();
  return out.join("\n");
}

/** Bỏ ký hiệu Markdown để gửi qua kênh chỉ nhận chữ thường (Telegram). */
export function markdownToPlain(source: string): string {
  return source
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => !(/^[|\s:-]+$/.test(line.trim()) && line.includes("-")))
    .map((line) => {
      const t = line.trim();
      const heading = /^#{1,6}\s+(.*)$/.exec(t);
      if (heading) return `\n${heading[1]!.replace(/\*\*/g, "").toUpperCase()}`;
      if (/^(-{3,}|\*{3,})$/.test(t)) return "";
      return line
        .replace(/^\s*[-*+]\s+/, "• ")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
