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
};

export type DayCount = { day: string; posts: number; authors: number };

export type Brief = {
  day: string;
  posts: number;
  negative: DigestPost[];
  newAuthors: { username: string; name: string; posts: number }[];
  starred: DigestPost[];
};

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
  return {
    day,
    posts: onDay.length,
    negative: onDay.filter((post) => post.sentiment === "negative"),
    newAuthors,
    starred: onDay.filter((post) => post.starred === 1),
  };
}

export function briefMarkdown(brief: Brief): string {
  const lines = [
    `# Bản tin ${brief.day.split("-").reverse().join("/")}`,
    "",
    `${brief.posts} bài. ${brief.negative.length} nghiêng xấu. ${brief.newAuthors.length} người viết lần đầu. ${brief.starred.length} bài đang ghim.`,
    "",
    "## Nghiêng xấu",
    ...section(brief.negative.map((post) => `- @${post.authorUsername}: ${oneLine(post.text)}`)),
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
