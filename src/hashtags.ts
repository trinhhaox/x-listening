export type HashtagStat = {
  tag: string;
  cleanTag: string;
  totalPosts: number;
  positivePosts: number;
  negativePosts: number;
  neutralPosts: number;
  posPct: number;
  negPct: number;
  neuPct: number;
  engagement: number;
  sentimentStatus: "positive" | "negative" | "neutral" | "warning";
  topAuthors: string[];
  sampleSnippet: string;
};

export type HashtagAnalyticsResult = {
  totalHashtagsCount: number;
  topHashtag: HashtagStat | null;
  riskyHashtag: HashtagStat | null;
  mostEngagedHashtag: HashtagStat | null;
  list: HashtagStat[];
};

/**
 * Trích xuất các hashtags tiếng Việt và tiếng Anh từ văn bản
 */
export function extractHashtags(text: string): string[] {
  if (!text) return [];
  // Hỗ trợ unicode tiếng Việt và số, gạch dưới
  const matches = text.match(/(?:^|\s)#([\p{L}\p{N}_]{2,40})/gu);
  if (!matches) return [];

  const set = new Set<string>();
  for (const raw of matches) {
    const clean = raw.trim().replace(/^#/, "").toLowerCase();
    // Bỏ các hashtag chỉ toàn số
    if (clean.length >= 2 && !/^\d+$/.test(clean)) {
      set.add(clean);
    }
  }
  return Array.from(set);
}

/**
 * Phân tích danh sách bài viết để tạo ma trận Hashtag Analytics
 */
export function analyzeHashtags(
  mentions: Array<{
    text: string;
    sentiment: string;
    like_count?: number;
    repost_count?: number;
    reply_count?: number;
    quote_count?: number;
    author_username?: string;
  }>,
  limit = 40,
): HashtagAnalyticsResult {
  const map = new Map<
    string,
    {
      total: number;
      pos: number;
      neg: number;
      neu: number;
      engagement: number;
      authors: Set<string>;
      sample: string;
    }
  >();

  for (const m of mentions) {
    const tags = extractHashtags(m.text);
    const eng =
      (m.like_count ?? 0) + (m.repost_count ?? 0) + (m.reply_count ?? 0) + (m.quote_count ?? 0);
    const author = (m.author_username ?? "").trim();

    for (const cleanTag of tags) {
      const entry = map.get(cleanTag) ?? {
        total: 0,
        pos: 0,
        neg: 0,
        neu: 0,
        engagement: 0,
        authors: new Set<string>(),
        sample: "",
      };

      entry.total++;
      if (m.sentiment === "positive") entry.pos++;
      else if (m.sentiment === "negative") entry.neg++;
      else entry.neu++;

      entry.engagement += eng;
      if (author) entry.authors.add(author);
      if (!entry.sample) entry.sample = m.text.slice(0, 160);

      map.set(cleanTag, entry);
    }
  }

  const list: HashtagStat[] = Array.from(map.entries())
    .map(([cleanTag, data]) => {
      const posPct = Math.round((data.pos / data.total) * 100);
      const negPct = Math.round((data.neg / data.total) * 100);
      const neuPct = Math.max(0, 100 - posPct - negPct);

      let sentimentStatus: "positive" | "negative" | "neutral" | "warning" = "neutral";
      if (negPct >= 30) {
        sentimentStatus = "warning";
      } else if (posPct > negPct && posPct >= 40) {
        sentimentStatus = "positive";
      } else if (negPct > posPct) {
        sentimentStatus = "negative";
      }

      return {
        tag: `#${cleanTag}`,
        cleanTag,
        totalPosts: data.total,
        positivePosts: data.pos,
        negativePosts: data.neg,
        neutralPosts: data.neu,
        posPct,
        negPct,
        neuPct,
        engagement: data.engagement,
        sentimentStatus,
        topAuthors: Array.from(data.authors).slice(0, 3),
        sampleSnippet: data.sample,
      };
    })
    .sort((a, b) => b.totalPosts - a.totalPosts || b.engagement - a.engagement);

  const topHashtag = list[0] ?? null;

  // Tìm hashtag rủi ro (tỷ lệ tiêu cực cao nhất có từ 2 bài trở lên)
  const riskyHashtag =
    list
      .filter((h) => h.totalPosts >= 2 && h.negPct > 0)
      .sort((a, b) => b.negPct - a.negPct || b.negativePosts - a.negativePosts)[0] ?? null;

  // Tìm hashtag có tương tác cao nhất
  const mostEngagedHashtag =
    list.slice().sort((a, b) => b.engagement - a.engagement)[0] ?? null;

  return {
    totalHashtagsCount: list.length,
    topHashtag,
    riskyHashtag,
    mostEngagedHashtag,
    list: list.slice(0, limit),
  };
}

