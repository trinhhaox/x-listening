import type { MentionRow } from "../db.js";

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
