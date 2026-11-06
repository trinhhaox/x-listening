import type { DigestPost } from "./digest.js";
import { CLUSTERS_DEF } from "./cloud.js";

export type AiOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
};

export type AiSentimentResult = {
  sentiment: "positive" | "negative" | "neutral";
  score: number;
  isSarcastic: boolean;
  explanation: string;
};

export type AutoClassificationResult = {
  tag: string;
  assignedTo: string;
  reason: string;
};

type CallLimits = { maxTokens?: number; timeoutMs?: number };

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

/** Model thực sự được gọi với cấu hình này (để ghi kèm báo cáo). */
export function resolveModel(options: Pick<AiOptions, "baseUrl" | "model">): string {
  const baseUrl = options.baseUrl?.trim() || "https://api.openai.com/v1";
  return options.model?.trim() || (baseUrl.includes("anthropic.com") ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL);
}

async function callChatCompletions(
  messages: Array<{ role: "system" | "user"; content: string }>,
  options: AiOptions,
  responseFormatJson = false,
  limits: CallLimits = {},
): Promise<string> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("Chưa cấu hình LLM_API_KEY");

  const baseUrl = (options.baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = resolveModel(options);

  // Hỗ trợ tự động Anthropic Messages API gốc
  if (baseUrl.includes("anthropic.com")) {
    const sysMsg = messages.find((m) => m.role === "system")?.content;
    const userMsgs = messages
      .filter((m) => m.role === "user")
      .map((m) => ({ role: "user", content: m.content }));

    const anthropicPayload: Record<string, unknown> = {
      model,
      max_tokens: limits.maxTokens ?? 1024,
      messages: userMsgs,
    };
    if (sysMsg) {
      anthropicPayload.system = sysMsg;
    }

    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicPayload),
      signal: AbortSignal.timeout(limits.timeoutMs ?? 25_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Anthropic API trả về lỗi ${response.status}: ${errorText.slice(0, 160)}`);
    }

    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("")
      .trim();
    if (!text) throw new Error("Anthropic API không trả về nội dung");
    return text;
  }

  // Chuẩn OpenAI-compatible mặc định
  const url = `${baseUrl}/chat/completions`;
  const bodyPayload: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.3,
  };

  if (responseFormatJson) {
    bodyPayload.response_format = { type: "json_object" };
  }

  const response = await (options.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(limits.timeoutMs ?? 20_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`LLM API trả về lỗi ${response.status}: ${errorText.slice(0, 160)}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("LLM không trả về nội dung");
  }

  return content;
}

export type BriefContext = {
  day?: string;
  sentiment?: { positive: number; neutral: number; negative: number };
  topics?: { name: string; posts: number; negative: number }[];
  previous?: { posts: number; negative: number; avg7: number };
};

const BRIEF_SAMPLE = 40;

/** Chọn bài đưa cho AI: tiêu cực trước, rồi bài ghim, rồi bài nhiều tương tác. */
export function pickBriefSample(posts: DigestPost[], limit = BRIEF_SAMPLE): DigestPost[] {
  const byEngagement = (a: DigestPost, b: DigestPost) => (b.engagement ?? 0) - (a.engagement ?? 0);
  const seen = new Set<string>();
  const out: DigestPost[] = [];
  const groups = [
    posts.filter((p) => p.sentiment === "negative").sort(byEngagement),
    posts.filter((p) => p.starred === 1).sort(byEngagement),
    [...posts].sort(byEngagement),
  ];
  for (const group of groups) {
    for (const post of group) {
      const key = `${post.topicId}/${post.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(post);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const SENTIMENT_VI: Record<string, string> = { positive: "tích cực", negative: "tiêu cực", neutral: "trung tính" };

export const BRIEF_SYSTEM_PROMPT = `Bạn là chuyên gia phân tích dư luận mạng xã hội và quản trị rủi ro truyền thông cho một thương hiệu Việt Nam.
Đọc số liệu và các bài viết công khai trong ngày, rồi viết bản nhận định ngắn cho ban điều hành bằng tiếng Việt.

Quy tắc:
- Dòng đầu tiên bắt buộc đúng mẫu: "MỨC RỦI RO: Thấp|Trung bình|Cao — <một câu lý do>".
- Sau đó đúng 3 mục, mỗi mục mở đầu bằng "## ":
  ## Tình hình chung — 2 đến 3 câu; so sánh với hôm trước và trung bình 7 ngày khi có số liệu.
  ## Điểm nóng — tối đa 3 gạch đầu dòng; mỗi ý dẫn số thứ tự bài làm chứng, ví dụ [#3].
  ## Việc cần làm — tối đa 3 gạch đầu dòng; mỗi ý bắt đầu bằng bộ phận phụ trách trong ngoặc vuông, ví dụ [CSKH], [Truyền thông], [Vận hành].
- Tổng độ dài dưới 280 từ. Không dùng bảng, không dùng emoji, không thêm tiêu đề khác.
- Chỉ dựa vào dữ liệu được đưa; không bịa số liệu hay sự việc. Nếu dữ liệu quá ít, hoặc phần lớn bài do chính thương hiệu đăng, hãy nói rõ điều đó.`;

export function buildBriefUserPrompt(posts: DigestPost[], context: BriefContext = {}): string {
  const sample = pickBriefSample(posts);
  const lines: string[] = [];
  if (context.day) lines.push(`Ngày: ${context.day.split("-").reverse().join("/")}`);
  const s = context.sentiment;
  lines.push(
    `Tổng số bài: ${posts.length}` +
      (s ? ` (tích cực ${s.positive}, trung tính ${s.neutral}, tiêu cực ${s.negative})` : ""),
  );
  if (context.previous) {
    lines.push(
      `Hôm trước: ${context.previous.posts} bài, ${context.previous.negative} tiêu cực. Trung bình 7 ngày trước: ${context.previous.avg7} bài/ngày.`,
    );
  }
  if (context.topics?.length) {
    lines.push(
      "Theo nguồn theo dõi: " +
        context.topics
          .slice(0, 8)
          .map((t) => `${t.name} ${t.posts} bài${t.negative ? ` (${t.negative} tiêu cực)` : ""}`)
          .join("; "),
    );
  }
  lines.push("", `Các bài tiêu biểu (${sample.length}/${posts.length} bài, ưu tiên tiêu cực và nhiều tương tác):`);
  sample.forEach((p, i) => {
    const engagement = p.engagement ? ` · ${p.engagement} tương tác` : "";
    lines.push(
      `[#${i + 1}] [${p.topicName}] @${p.authorUsername} · ${SENTIMENT_VI[p.sentiment] ?? p.sentiment}${engagement}: ${p.text.replace(/\s+/g, " ").slice(0, 360)}`,
    );
  });
  lines.push("", "Viết bản nhận định theo đúng quy tắc.");
  return lines.join("\n");
}

/** Gọi AI viết nhận định ngày. Lỗi thì trả về error, không ném ra. */
export async function requestAiBrief(
  posts: DigestPost[],
  options: AiOptions,
  context: BriefContext = {},
): Promise<{ text?: string; error?: string }> {
  if (!options.apiKey.trim()) return { error: "Chưa cấu hình khóa AI (LLM_API_KEY)." };
  if (posts.length === 0) return { text: "MỨC RỦI RO: Thấp — Không có bài viết nào trong ngày.\n\nChưa có dữ liệu để nhận định." };
  try {
    const text = await callChatCompletions(
      [
        { role: "system", content: BRIEF_SYSTEM_PROMPT },
        { role: "user", content: buildBriefUserPrompt(posts, context) },
      ],
      options,
      false,
      { maxTokens: 1200, timeoutMs: 75_000 },
    );
    return { text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|aborted/i.test(message)) return { error: "AI phản hồi quá lâu, thử lại sau ít phút." };
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(message)) {
      return { error: "Không kết nối được tới dịch vụ AI. Kiểm tra địa chỉ API trong Cấu hình hoặc mạng của máy chủ." };
    }
    if (/\b(401|403)\b/.test(message)) return { error: "Khóa AI không hợp lệ hoặc đã hết hạn." };
    if (/\b(429|529)\b/.test(message)) return { error: `Dịch vụ AI đang quá tải hoặc hết hạn mức (${message.slice(0, 120)}). Thử lại sau.` };
    return { error: message };
  }
}

export async function generateAiBrief(posts: DigestPost[], options: AiOptions, context: BriefContext = {}): Promise<string> {
  if (!options.apiKey.trim()) {
    return "Chưa cấu hình LLM_API_KEY. Điền API Key trong file .env để kích hoạt Bản tin Tóm tắt Điều hành bằng Trí tuệ Nhân tạo.";
  }
  if (posts.length === 0) {
    return "Hôm nay chưa có bài viết nào trên các tần số để AI tổng hợp.";
  }
  const result = await requestAiBrief(posts, options, context);
  return result.text ?? `Không thể tạo tóm tắt AI: ${result.error}`;
}

export async function analyzePostWithAi(text: string, options: AiOptions): Promise<AiSentimentResult | null> {
  if (!options.apiKey.trim()) return null;

  const systemPrompt = `Bạn là hệ thống NLP phân tích sắc thái văn bản mạng xã hội tiếng Việt và tiếng Anh.
Phân tích bài viết được cung cấp và trả về DUY NHẤT một chuỗi JSON chuẩn có cấu trúc:
{
  "sentiment": "positive" | "negative" | "neutral",
  "score": number (-100 đến 100),
  "isSarcastic": boolean,
  "explanation": "giải thích ngắn gọn lý do phân loại trong 1-2 câu"
}`;

  try {
    const raw = await callChatCompletions(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      options,
      true,
    );

    const parsed = JSON.parse(raw) as Partial<AiSentimentResult>;
    const sentiment =
      parsed.sentiment === "positive" || parsed.sentiment === "negative" ? parsed.sentiment : "neutral";
    const score = typeof parsed.score === "number" ? Math.max(-100, Math.min(100, Math.round(parsed.score))) : 0;
    const isSarcastic = Boolean(parsed.isSarcastic);
    const explanation = typeof parsed.explanation === "string" ? parsed.explanation.slice(0, 300) : "";

    return { sentiment, score, isSarcastic, explanation };
  } catch {
    return null;
  }
}

export function classifyMentionRuleBased(text: string): AutoClassificationResult {
  const lower = text.toLowerCase();
  let bestCluster: (typeof CLUSTERS_DEF)[number] | null = null;
  let maxScore = 0;

  for (const c of CLUSTERS_DEF) {
    let score = 0;
    for (const kw of c.keywords) {
      if (lower.includes(kw)) {
        score += kw.includes(" ") ? 3 : 1;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestCluster = c;
    }
  }

  if (bestCluster && maxScore > 0) {
    return {
      tag: bestCluster.tag,
      assignedTo: bestCluster.assignee,
      reason: `Khớp chủ đề ${bestCluster.name} qua từ khóa`,
    };
  }

  return {
    tag: "Chung",
    assignedTo: "@CSKH",
    reason: "Thảo luận chung chưa phân loại cụ thể",
  };
}

export async function classifyMentionWithAi(
  text: string,
  options?: AiOptions,
): Promise<AutoClassificationResult> {
  // Nếu không có LLM API key, dùng rule-based tức thì
  if (!options || !options.apiKey.trim()) {
    return classifyMentionRuleBased(text);
  }

  const tagList = CLUSTERS_DEF.map((c) => `"${c.tag}" (${c.name} -> gán ${c.assignee})`).join(", ");

  const systemPrompt = `Bạn là Trợ lý AI Phân loại & Điều phối Yêu cầu Dư luận mạng xã hội (Customer Care & Crisis Dispatcher).
Nhiệm vụ của bạn là đọc bài viết và phân loại chính xác vào 1 trong các nhóm chủ đề:
${tagList}, hoặc "Chung" (@CSKH).

Trả về DUY NHẤT một chuỗi JSON chuẩn có cấu trúc:
{
  "tag": "Giao hàng" | "Dịch vụ" | "Sản phẩm" | "Giá cả" | "Khen ngợi" | "Truyền thông" | "Chung",
  "assignedTo": "@VanHanh" | "@CSKH" | "@KyThuat" | "@KinhDoanh" | "@PR",
  "reason": "lý do ngắn gọn 1 câu"
}`;

  try {
    const raw = await callChatCompletions(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: text.slice(0, 1000) },
      ],
      options,
      true,
    );

    const parsed = JSON.parse(raw) as Partial<AutoClassificationResult>;
    const tag = typeof parsed.tag === "string" && parsed.tag.trim() ? parsed.tag.trim() : "";
    const assignedTo = typeof parsed.assignedTo === "string" && parsed.assignedTo.trim() ? parsed.assignedTo.trim() : "";
    const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "";

    if (tag && assignedTo) {
      return { tag, assignedTo, reason };
    }
  } catch {
    // Fallback sang rule-based khi LLM có sự cố
  }

  return classifyMentionRuleBased(text);
}



export type SentimentBatchItem = { id: string; topicId: string; topicName?: string; text: string };
export type SentimentVerdict = { id: string; topicId: string; sentiment: "positive" | "negative" | "neutral"; reason: string };

export const SENTIMENT_BATCH_SIZE = 25;

export const SENTIMENT_SYSTEM_PROMPT = `Bạn chấm cảm xúc bài mạng xã hội (tiếng Việt và tiếng Anh) cho đội theo dõi dư luận của một thương hiệu.
Mỗi bài có [chủ đề] là thương hiệu hoặc vấn đề đang theo dõi. Chấm thái độ của người viết với chủ đề đó:
- negative: phàn nàn, chê, tố cáo, thất vọng, cảnh báo người khác, mỉa mai, đòi hoàn tiền, có nguy cơ thành khủng hoảng.
- positive: khen, giới thiệu tốt, cảm ơn, hài lòng, muốn mua lại.
- neutral: hỏi thông tin, tin tức thuần túy, quảng cáo hoặc bài do chính thương hiệu đăng, không rõ thái độ.
Chú ý câu mỉa mai ("ngon quá cơ, đợi 2 tiếng"), phủ định ("không tệ"), tiếng lóng và viết tắt.
Trả về DUY NHẤT một mảng JSON, mỗi bài một phần tử, theo đúng số thứ tự:
[{"n":1,"s":"negative","r":"lý do ngắn dưới 10 từ"}]
Không viết gì ngoài mảng JSON.`;

export function buildSentimentBatchPrompt(items: SentimentBatchItem[]): string {
  return items
    .map((item, i) => `${i + 1}. [${(item.topicName ?? "").slice(0, 40) || "chung"}] ${item.text.replace(/\s+/g, " ").trim().slice(0, 500)}`)
    .join("\n");
}

/**
 * Đọc kết quả từ câu trả lời (có thể bọc trong ```json, hoặc bị cắt giữa chừng).
 * Đọc từng đối tượng {...} riêng lẻ, nên phần tử hỏng hay bị cắt chỉ mất phần tử đó.
 */
export function parseSentimentBatch(raw: string, items: SentimentBatchItem[]): SentimentVerdict[] {
  const out: SentimentVerdict[] = [];
  const seen = new Set<number>();
  for (const match of raw.matchAll(/\{[^{}]*\}/g)) {
    let e: { n?: unknown; s?: unknown; r?: unknown };
    try {
      e = JSON.parse(match[0]) as typeof e;
    } catch {
      continue;
    }
    const n = Number(e.n);
    const item = Number.isInteger(n) ? items[n - 1] : undefined;
    if (!item || seen.has(n)) continue;
    const s = String(e.s ?? "").toLowerCase().trim();
    const sentiment = s.startsWith("neg") ? "negative" : s.startsWith("pos") ? "positive" : s.startsWith("neu") ? "neutral" : null;
    if (!sentiment) continue;
    seen.add(n);
    out.push({ id: item.id, topicId: item.topicId, sentiment, reason: String(e.r ?? "").trim().slice(0, 160) });
  }
  return out;
}

/** Chấm cảm xúc một lô bài bằng một lần gọi AI. Lỗi thì ném ra để người gọi ghi lại. */
export async function classifySentimentBatch(items: SentimentBatchItem[], options: AiOptions): Promise<SentimentVerdict[]> {
  if (items.length === 0) return [];
  const raw = await callChatCompletions(
    [
      { role: "system", content: SENTIMENT_SYSTEM_PROMPT },
      { role: "user", content: buildSentimentBatchPrompt(items) },
    ],
    options,
    false,
    { maxTokens: 400 + items.length * 90, timeoutMs: 90_000 },
  );
  return parseSentimentBatch(raw, items);
}

export type ReplyDraftInput = {
  /** Tên nguồn theo dõi, thường là tên thương hiệu. */
  topicName: string;
  authorName: string;
  text: string;
  sentiment: string;
  templates: { name: string; content: string }[];
  /** Nháp cũ người trực muốn AI viết lại. */
  previous?: string;
};

export const REPLY_SYSTEM_PROMPT = `Bạn là nhân viên chăm sóc khách hàng của thương hiệu, viết câu trả lời công khai dưới một bài mạng xã hội.
Quy tắc:
- Viết bằng ngôn ngữ của bài gốc (thường là tiếng Việt), xưng "chúng mình" hoặc "[thương hiệu]", gọi người viết lịch sự (anh/chị, bạn).
- Ngắn: 2 đến 4 câu, không quá 70 từ. Không dùng hashtag, không dùng Markdown.
- Bài phàn nàn: cảm ơn, xin lỗi về trải nghiệm, nói rõ bước tiếp theo (mời nhắn tin riêng kèm mã đơn hoặc số điện thoại). Không đổ lỗi, không tranh cãi.
- Bài khen: cảm ơn chân thành, nhắc lại đúng điều họ khen.
- Không bịa chính sách, giá, thời hạn hay khoản đền bù. Chỉ dùng thông tin có trong mẫu câu nếu được cung cấp.
- Nếu có mẫu câu, giữ giọng văn và thông tin liên hệ giống mẫu.
Chỉ trả về đúng nội dung câu trả lời, không giải thích.`;

export function buildReplyPrompt(input: ReplyDraftInput): string {
  const templates = input.templates
    .slice(0, 5)
    .map((t, i) => `${i + 1}. ${t.name}: ${t.content.slice(0, 400)}`)
    .join("\n");
  const sentiment = input.sentiment === "negative" ? "tiêu cực" : input.sentiment === "positive" ? "tích cực" : "trung tính";
  return [
    `Thương hiệu: ${input.topicName}`,
    `Người viết: ${input.authorName || "khách hàng"}`,
    `Cảm xúc của bài: ${sentiment}`,
    `Bài gốc:\n"""\n${input.text.slice(0, 1500)}\n"""`,
    templates ? `Mẫu câu của đội (giữ giọng và thông tin liên hệ):\n${templates}` : "",
    input.previous?.trim() ? `Nháp hiện tại (viết lại cho tốt hơn, giữ ý chính):\n${input.previous.trim().slice(0, 800)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Bỏ ngoặc kép bao ngoài và tiền tố kiểu "Câu trả lời:". */
export function cleanReply(raw: string): string {
  return raw
    .trim()
    .replace(/^(câu trả lời|trả lời|reply)\s*:\s*/i, "")
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim()
    .slice(0, 2000);
}

export async function draftReplyWithAi(input: ReplyDraftInput, options: AiOptions): Promise<string> {
  const raw = await callChatCompletions(
    [
      { role: "system", content: REPLY_SYSTEM_PROMPT },
      { role: "user", content: buildReplyPrompt(input) },
    ],
    options,
    false,
    { maxTokens: 1200, timeoutMs: 60_000 },
  );
  const text = cleanReply(raw);
  if (!text) throw new Error("AI không trả về câu trả lời");
  return text;
}

/** Không có AI: lấy mẫu đầu tiên hợp cảm xúc, thay {tên} bằng tên người viết. */
export function fillTemplate(template: string, authorName: string): string {
  return template.replace(/\{\s*(tên|ten|name)\s*\}/gi, authorName || "bạn").trim();
}
