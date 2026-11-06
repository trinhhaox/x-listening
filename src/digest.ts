export const ZONE = "Asia/Ho_Chi_Minh";

export type DigestPost = {
  id: string;
  topicId: string;
  topicName: string;
  text: string;
  authorUsername: string;
  authorName: string;
  createdAt: string;
  sentiment: string;
  starred: number;
  url?: string;
  /** Tổng thích + chia sẻ + bình luận + trích dẫn. */
  engagement?: number;
};

export type RiskLevel = "low" | "medium" | "high";

export type BriefAiMeta = {
  generatedAt: string;
  model: string;
  basedOn: number;
  error?: string;
  /** Dữ liệu ngày đó đã đổi sau lần viết này. */
  stale?: boolean;
};

export type DayCount = { day: string; posts: number; authors: number };

export type Brief = {
  day: string;
  posts: number;
  negative: DigestPost[];
  newAuthors: { username: string; name: string; posts: number }[];
  starred: DigestPost[];
  sentiment: { positive: number; neutral: number; negative: number };
  topics: { name: string; posts: number; negative: number }[];
  /** Hôm trước và trung bình 7 ngày trước đó, để so sánh. */
  previous?: { posts: number; negative: number; avg7: number };
  aiSummary?: string;
  risk?: RiskLevel;
  ai?: BriefAiMeta;
  /** Các bài AI dẫn chứng bằng [#n]. */
  aiRefs?: BriefRef[];
};

export type BriefRef = { n: number; author: string; topic: string; sentiment: string; text: string; url: string };

export function localDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function shiftDay(day: string, delta: number): string {
  return localDay(new Date(Date.parse(`${day}T00:00:00+07:00`) + delta * 86_400_000));
}

export function daysEnding(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftDay(today, index - (count - 1)));
}

export function dayStartIso(day: string): string {
  return new Date(`${day}T00:00:00+07:00`).toISOString();
}

export function buckets(posts: DigestPost[], days: string[], topicId = ""): DayCount[] {
  return days.map((day) => {
    const rows = posts.filter((post) => (topicId === "" || post.topicId === topicId) && localDay(new Date(post.createdAt)) === day);
    return { day, posts: rows.length, authors: new Set(rows.map((row) => row.authorUsername.toLowerCase())).size };
  });
}

export function spikeReason(series: DayCount[], today: string): string | null {
  const byDay = new Map(series.map((row) => [row.day, row.posts]));
  const todayCount = byDay.get(today) ?? 0;
  if (todayCount < 5) return null;
  const prior = daysEnding(shiftDay(today, -1), 6).map((day) => byDay.get(day) ?? 0);
  const middle = median(prior);
  if (middle > 0 && todayCount < middle * 3) return null;
  const shown = Number.isInteger(middle) ? String(middle) : middle.toFixed(1);
  return `Hôm nay ${todayCount} bài, trong khi trung vị 6 ngày trước là ${shown}.`;
}

export function buildBrief(day: string, posts: DigestPost[], firstSeen: { username: string; firstAt: string }[]): Brief {
  const onDay = posts.filter((post) => localDay(new Date(post.createdAt)) === day);
  const fresh = new Set(
    firstSeen.filter((row) => localDay(new Date(row.firstAt)) === day).map((row) => row.username.toLowerCase()),
  );
  const newAuthors = [...fresh].map((username) => {
    const rows = onDay.filter((post) => post.authorUsername.toLowerCase() === username);
    return { username: rows[0]?.authorUsername ?? username, name: rows[0]?.authorName ?? username, posts: rows.length };
  });
  const byEngagement = (a: DigestPost, b: DigestPost) => (b.engagement ?? 0) - (a.engagement ?? 0);
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  const topics = new Map<string, { name: string; posts: number; negative: number }>();
  for (const post of onDay) {
    if (post.sentiment === "positive") sentiment.positive++;
    else if (post.sentiment === "negative") sentiment.negative++;
    else sentiment.neutral++;
    const row = topics.get(post.topicId) ?? { name: post.topicName, posts: 0, negative: 0 };
    row.posts++;
    if (post.sentiment === "negative") row.negative++;
    topics.set(post.topicId, row);
  }
  return {
    day,
    posts: onDay.length,
    negative: onDay.filter((post) => post.sentiment === "negative").sort(byEngagement),
    newAuthors,
    starred: onDay.filter((post) => post.starred === 1).sort(byEngagement),
    sentiment,
    topics: [...topics.values()].sort((a, b) => b.posts - a.posts),
  };
}

/** Ngày hợp lệ dạng YYYY-MM-DD, không ở tương lai; sai thì trả về hôm nay. */
export function readDay(raw: string | undefined, now = new Date()): string {
  const today = localDay(now);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return today;
  if (Number.isNaN(Date.parse(`${raw}T00:00:00+07:00`))) return today;
  if (localDay(new Date(Date.parse(`${raw}T00:00:00+07:00`))) !== raw) return today;
  return raw > today ? today : raw;
}

const RISK_LABEL: Record<RiskLevel, string> = { low: "Thấp", medium: "Trung bình", high: "Cao" };
export function riskLabel(risk: RiskLevel): string {
  return RISK_LABEL[risk];
}

/**
 * Tách dòng "MỨC RỦI RO: …" mà AI được yêu cầu viết ở đầu.
 * Trả về mức rủi ro, lý do và phần thân còn lại.
 */
export function splitRisk(summary: string): { risk?: RiskLevel; reason: string; body: string } {
  const lines = summary.replace(/\r/g, "").split("\n");
  const index = lines.findIndex((line) => line.trim() !== "");
  if (index < 0) return { reason: "", body: "" };
  const first = lines[index]!.replace(/[*#_>]/g, "").trim();
  const match = /^m[ứu]c\s*r[ủu]i\s*ro\s*[:：-]\s*(th[ấa]p|trung\s*b[ìi]nh|cao)\b\s*[—–:,.-]*\s*(.*)$/iu.exec(first);
  if (!match) return { reason: "", body: summary.trim() };
  const word = match[1]!.toLowerCase();
  const risk: RiskLevel = word.startsWith("cao") ? "high" : word.startsWith("trung") ? "medium" : "low";
  return { risk, reason: match[2]!.trim(), body: lines.slice(index + 1).join("\n").trim() };
}

export function briefMarkdown(brief: Brief): string {
  const lines = [
    `# Bản tin ${brief.day.split("-").reverse().join("/")}`,
    "",
    `${brief.posts} bài. ${brief.negative.length} nghiêng xấu. ${brief.newAuthors.length} người viết lần đầu. ${brief.starred.length} bài đang ghim.`,
    ...(brief.previous ? [`Hôm trước: ${brief.previous.posts} bài, ${brief.previous.negative} nghiêng xấu. Trung bình 7 ngày: ${brief.previous.avg7} bài/ngày.`] : []),
    "",
    ...(brief.aiSummary ? ["## Nhận định AI", "", brief.aiSummary, ""] : []),
    "## Nghiêng xấu",
    ...section(brief.negative.map((post) => `- @${post.authorUsername}: ${oneLine(post.text)}${post.url ? ` (${post.url})` : ""}`)),
    "",
    "## Người viết lần đầu",
    ...section(brief.newAuthors.map((author) => `- @${author.username} (${author.name}), ${author.posts} bài`)),
    "",
    "## Đang ghim",
    ...section(brief.starred.map((post) => `- @${post.authorUsername}: ${oneLine(post.text)}`)),
    "",
  ];
  return lines.join("\n");
}

function section(lines: string[]): string[] {
  return lines.length > 0 ? lines : ["Không có."];
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}
