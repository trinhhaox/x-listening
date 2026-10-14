export type AlertKind = "negative" | "phrase" | "likes";

export type AlertRule = {
  id: string;
  topic_id: string | null;
  name: string;
  kind: AlertKind;
  phrase: string;
  min_likes: number;
  active: number;
  created_at: string;
};

export function alertReason(
  rule: AlertRule,
  mention: { topicId: string; text: string; sentiment: string; likeCount: number },
): string | null {
  if (rule.active !== 1) return null;
  if (rule.topic_id && rule.topic_id !== mention.topicId) return null;

  if (rule.kind === "negative" && mention.sentiment === "negative") {
    return "Bài nghiêng xấu";
  }

  if (rule.kind === "phrase") {
    const phrase = rule.phrase.normalize("NFC").trim().toLowerCase();
    if (!phrase) return null;
    const text = mention.text.normalize("NFC").toLowerCase();
    if (text.includes(phrase)) return `Có cụm “${rule.phrase.trim()}”`;
  }

  if (rule.kind === "likes" && rule.min_likes > 0 && mention.likeCount >= rule.min_likes) {
    return `Đạt ${mention.likeCount} lượt thích`;
  }

  return null;
}
