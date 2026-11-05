export type WordCloudItem = {
  text: string;
  count: number;
  sentiment: "positive" | "negative" | "neutral";
  posCount: number;
  negCount: number;
  neuCount: number;
  cluster?: string;
};

export type TopicCluster = {
  id: string;
  name: string;
  icon: string;
  count: number;
  sentiment: "positive" | "negative" | "neutral";
  keywords: string[];
};

export const STOP_WORDS = new Set([
  // Tiếng Việt hư từ, liên từ, trợ từ, đại từ phổ biến
  "và", "là", "của", "có", "cho", "với", "trong", "được", "này", "đó", "thì", "mà", "ở", "các", "những",
  "một", "về", "ra", "lại", "theo", "từ", "đến", "lên", "xuống", "vào", "bị", "bởi", "cũng", "đã", "đang",
  "sẽ", "rất", "quá", "lắm", "luôn", "như", "đều", "hơn", "nhiều", "ít", "hay", "hoặc", "nhưng", "thế",
  "vậy", "gì", "sao", "ai", "đâu", "nào", "khi", "lúc", "ngày", "hôm", "nay", "qua", "năm", "tháng",
  "giờ", "phút", "giây", "bài", "tin", "trang", "web", "link", "http", "https", "com", "vn", "org", "net",
  "facebook", "twitter", "youtube", "threads", "rt", "via", "post", "tôi", "mình", "bạn", "anh", "chị", "em",
  "họ", "chúng", "ta", "nó", "người", "cái", "chiếc", "con", "việc", "sự", "điều", "đây", "kia", "đó",
  "nữa", "rồi", "chưa", "không", "chẳng", "phải", "để", "làm", "đi", "thấy", "biết", "muốn", "cần",
  // English stop words
  "the", "and", "is", "in", "to", "of", "for", "with", "on", "at", "by", "from", "this", "that", "it",
  "an", "as", "are", "was", "be", "or", "we", "you", "they", "i", "my", "your", "our", "all", "so", "if",
]);

export const CLUSTERS_DEF = [
  {
    id: "shipping",
    name: "Vận chuyển & Đóng gói",
    icon: "📦",
    tag: "Giao hàng",
    assignee: "@VanHanh",
    keywords: ["giao hàng", "vận chuyển", "shipper", "đóng gói", "ship", "giao trễ", "chậm trễ", "đơn hàng", "bưu tá", "nhận hàng", "phí ship", "hộp"],
  },
  {
    id: "service",
    name: "Dịch vụ & CSKH",
    icon: "🎧",
    tag: "Dịch vụ",
    assignee: "@CSKH",
    keywords: ["nhân viên", "thái độ", "tư vấn", "hỗ trợ", "cskh", "hotline", "inbox", "trả lời", "chăm sóc", "hướng dẫn", "tiếp đón", "phục vụ", "giải quyết"],
  },
  {
    id: "product",
    name: "Chất lượng Sản phẩm",
    icon: "💎",
    tag: "Sản phẩm",
    assignee: "@KyThuat",
    keywords: ["chất lượng", "hương vị", "lỗi", "hỏng", "mùi", "vị", "thành phần", "dùng thử", "tính năng", "bao bì", "mẫu mã", "hết hạn", "date", "độ bền"],
  },
  {
    id: "pricing",
    name: "Giá cả & Ưu đãi",
    icon: "🏷️",
    tag: "Giá cả",
    assignee: "@KinhDoanh",
    keywords: ["giá", "đắt", "rẻ", "voucher", "tiền", "khuyến mãi", "giảm giá", "sale", "bảng giá", "chi phí", "mã giảm", "ưu đãi", "deal"],
  },
  {
    id: "praise",
    name: "Khen ngợi & Đánh giá cao",
    icon: "🌟",
    tag: "Khen ngợi",
    assignee: "@CSKH",
    keywords: ["tuyệt vời", "xuất sắc", "hài lòng", "ưng ý", "yêu thích", "cảm ơn", "ngon", "đẹp", "đỉnh", "ủng hộ", "chất lượng tốt", "10 điểm", "yêu"],
  },
  {
    id: "pr",
    name: "Truyền thông & Xu hướng",
    icon: "📢",
    tag: "Truyền thông",
    assignee: "@PR",
    keywords: ["báo", "bài viết", "quảng cáo", "scandal", "video", "clip", "trend", "viral", "sự kiện", "phốt", "cộng đồng", "diễn đàn", "chia sẻ"],
  },
];

function cleanToken(token: string): string {
  return token.toLowerCase().trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function extractWordCloud(
  mentions: Array<{ text: string; sentiment: string }>,
  limit = 28,
): { words: WordCloudItem[]; clusters: TopicCluster[] } {
  if (mentions.length === 0) {
    return { words: [], clusters: [] };
  }

  const wordStats = new Map<
    string,
    { count: number; posCount: number; negCount: number; neuCount: number }
  >();

  const clusterCounts = new Map<string, { count: number; posCount: number; negCount: number; neuCount: number }>();
  for (const c of CLUSTERS_DEF) {
    clusterCounts.set(c.id, { count: 0, posCount: 0, negCount: 0, neuCount: 0 });
  }

  for (const mention of mentions) {
    const rawText = mention.text.replace(/https?:\/\/\S+/gi, "").replace(/@\w+/g, "");
    const tokens = rawText
      .split(/[\s,.;:!?()\[\]{}"'\\/|`~+=*&^%$#@<>_]+/u)
      .map(cleanToken)
      .filter((t) => t.length >= 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));

    const s = mention.sentiment;
    const isPos = s === "positive";
    const isNeg = s === "negative";

    // Phân tích từ đơn
    const seenSingle = new Set<string>();
    for (const t of tokens) {
      if (t.length < 2 || STOP_WORDS.has(t)) continue;
      if (seenSingle.has(t)) continue;
      seenSingle.add(t);

      const entry = wordStats.get(t) ?? { count: 0, posCount: 0, negCount: 0, neuCount: 0 };
      entry.count++;
      if (isPos) entry.posCount++;
      else if (isNeg) entry.negCount++;
      else entry.neuCount++;
      wordStats.set(t, entry);
    }

    // Phân tích cụm 2 từ (Bigrams) có nghĩa
    const seenBigrams = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) {
      const w1 = tokens[i];
      const w2 = tokens[i + 1];
      if (STOP_WORDS.has(w1) || STOP_WORDS.has(w2)) continue;
      const bigram = `${w1} ${w2}`;
      if (seenBigrams.has(bigram)) continue;
      seenBigrams.add(bigram);

      const entry = wordStats.get(bigram) ?? { count: 0, posCount: 0, negCount: 0, neuCount: 0 };
      entry.count += 1.5; // ưu tiên cụm 2 từ có ngữ nghĩa rõ hơn
      if (isPos) entry.posCount++;
      else if (isNeg) entry.negCount++;
      else entry.neuCount++;
      wordStats.set(bigram, entry);
    }

    // Gán vào Cluster
    const lowerText = mention.text.toLowerCase();
    for (const c of CLUSTERS_DEF) {
      const match = c.keywords.some((kw) => lowerText.includes(kw));
      if (match) {
        const ce = clusterCounts.get(c.id)!;
        ce.count++;
        if (isPos) ce.posCount++;
        else if (isNeg) ce.negCount++;
        else ce.neuCount++;
      }
    }
  }

  // Chuyển đổi và sắp xếp
  const words: WordCloudItem[] = Array.from(wordStats.entries())
    .filter(([_, stats]) => stats.count >= 1)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([text, stats]) => {
      let sentiment: "positive" | "negative" | "neutral" = "neutral";
      if (stats.posCount > stats.negCount && stats.posCount > 0) {
        sentiment = "positive";
      } else if (stats.negCount > stats.posCount && stats.negCount > 0) {
        sentiment = "negative";
      }

      // Tìm cluster phù hợp
      let matchedCluster: string | undefined;
      for (const c of CLUSTERS_DEF) {
        if (c.keywords.some((kw) => text.includes(kw) || kw.includes(text))) {
          matchedCluster = c.name;
          break;
        }
      }

      return {
        text,
        count: Math.round(stats.count),
        sentiment,
        posCount: stats.posCount,
        negCount: stats.negCount,
        neuCount: stats.neuCount,
        cluster: matchedCluster,
      };
    });

  const clusters: TopicCluster[] = CLUSTERS_DEF.map((c) => {
    const stats = clusterCounts.get(c.id)!;
    let sentiment: "positive" | "negative" | "neutral" = "neutral";
    if (stats.posCount > stats.negCount && stats.posCount > 0) sentiment = "positive";
    else if (stats.negCount > stats.posCount && stats.negCount > 0) sentiment = "negative";

    return {
      id: c.id,
      name: c.name,
      icon: c.icon,
      count: stats.count,
      sentiment,
      keywords: c.keywords.slice(0, 4),
    };
  }).filter((c) => c.count > 0);

  return { words, clusters };
}

