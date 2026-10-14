const POSITIVE = [
  "tuyệt",
  "tốt",
  "hay",
  "ưng",
  "ủng hộ",
  "yêu",
  "vui",
  "đẹp",
  "xuất sắc",
  "cảm ơn",
  "hài lòng",
  "chất lượng",
  "đáng tiền",
  "ổn",
  "great",
  "love",
  "good",
  "excellent",
  "thanks",
  "helpful",
];

const NEGATIVE = [
  "tệ",
  "dở",
  "thất vọng",
  "lừa",
  "chậm",
  "lỗi",
  "kém",
  "tức",
  "phàn nàn",
  "xấu",
  "hỏng",
  "scam",
  "tồi",
  "giận",
  "bad",
  "hate",
  "awful",
  "terrible",
  "disappointed",
  "broken",
];

export type Sentiment = "positive" | "negative" | "neutral";

function lexiconHit(words: string[], tokens: string[], index: number): boolean {
  return words.some((word) => {
    const parts = word.split(" ");
    return parts.every((part, offset) => tokens[index + offset] === part);
  });
}

export function lexiconWord(input: string): string | null {
  const clean = input.trim().toLowerCase().normalize("NFC").replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+){0,2}$/u.test(clean) || clean.length > 40) return null;
  return clean;
}

export function classifySentiment(
  text: string,
  extra?: { positive: string[]; negative: string[] },
): { sentiment: Sentiment; score: number } {
  const tokens = text
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const added = new Set([...(extra?.positive ?? []), ...(extra?.negative ?? [])]);
  const positiveWords = [...POSITIVE.filter((word) => !added.has(word)), ...(extra?.positive ?? [])];
  const negativeWords = [...NEGATIVE.filter((word) => !added.has(word)), ...(extra?.negative ?? [])];

  let score = 0;
  for (let i = 0; i < tokens.length; i++) {
    const negated = i > 0 && (tokens[i - 1] === "không" || tokens[i - 1] === "chẳng" || tokens[i - 1] === "not");
    const positive = lexiconHit(positiveWords, tokens, i);
    const negative = lexiconHit(negativeWords, tokens, i);
    if (positive) score += negated ? -1 : 1;
    if (negative) score += negated ? 1 : -1;
  }

  const sentiment: Sentiment = score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
  return { sentiment, score };
}
