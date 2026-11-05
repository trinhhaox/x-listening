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

async function callChatCompletions(
  messages: Array<{ role: "system" | "user"; content: string }>,
  options: AiOptions,
  responseFormatJson = false,
): Promise<string> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("Chưa cấu hình LLM_API_KEY");

  const baseUrl = (options.baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = options.model?.trim() || (baseUrl.includes("anthropic.com") ? "claude-3-5-sonnet-20241022" : "gpt-4o-mini");

  // Hỗ trợ tự động Anthropic Messages API gốc
  if (baseUrl.includes("anthropic.com")) {
    const sysMsg = messages.find((m) => m.role === "system")?.content;
    const userMsgs = messages
      .filter((m) => m.role === "user")
      .map((m) => ({ role: "user", content: m.content }));

    const anthropicPayload: Record<string, unknown> = {
      model,
      max_tokens: 2048,
      messages: userMsgs,
    };
    if (sysMsg) {
      anthropicPayload.system = sysMsg;
    }

    const response = await (options.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicPayload),
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Anthropic API trả về lỗi ${response.status}: ${errorText.slice(0, 160)}`);
    }

    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text?.trim() || data.content?.[0]?.text?.trim();
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
    signal: AbortSignal.timeout(20_000),
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

export async function generateAiBrief(posts: DigestPost[], options: AiOptions): Promise<string> {
  if (!options.apiKey.trim()) {
    return "Chưa cấu hình LLM_API_KEY. Điền API Key trong file .env để kích hoạt Bản tin Tóm tắt Điều hành bằng Trí tuệ Nhân tạo.";
  }

  if (posts.length === 0) {
    return "Hôm nay chưa có bài viết nào trên các tần số để AI tổng hợp.";
  }

  // Chọn tối đa 35 bài tiêu biểu (ưu tiên bài tiêu cực và bài được ghim)
  const prioritized = [
    ...posts.filter((p) => p.sentiment === "negative"),
    ...posts.filter((p) => p.starred === 1),
    ...posts.filter((p) => p.sentiment !== "negative" && p.starred !== 1),
  ].slice(0, 35);

  const sampleTexts = prioritized
    .map(
      (p, i) =>
        `${i + 1}. [${p.topicName}] @${p.authorUsername} (${p.sentiment}): ${p.text.replace(/\s+/g, " ").slice(0, 200)}`,
    )
    .join("\n");

  const systemPrompt = `Bạn là Chuyên gia Phân tích Dư luận Mạng xã hội & Quản trị Rủi ro Khủng hoảng Truyền thông.
Nhiệm vụ của bạn là đọc các bài viết công khai trên mạng xã hội hôm nay và lập Bản tóm tắt Điều hành (Executive Brief) ngắn gọn, sắc sảo bằng tiếng Việt.
Yêu cầu định dạng phản hồi bằng Markdown gồm 3 phần:
1. **Tổng quan Nhịp điệu Dư luận:** Đánh giá xu hướng chung (bình yên, sôi nổi, hay có nguy cơ rủi ro).
2. **Điểm nóng & Động lực chính (Key Drivers):** Tóm tắt các chủ đề được nhắc nhiều, vì sao người dùng hài lòng hoặc bức xúc.
3. **Khuyến nghị Hành động (Actionable Next Steps):** Đưa ra 2-3 gợi ý cụ thể cho bộ phận chăm sóc khách hàng hoặc truyền thông.`;

  const userPrompt = `Dưới đây là các bài viết tiêu biểu ghi nhận được hôm nay:\n\n${sampleTexts}\n\nHãy phân tích và viết Bản tóm tắt Điều hành theo yêu cầu.`;

  try {
    return await callChatCompletions(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      options,
    );
  } catch (error) {
    return `Không thể tạo tóm tắt AI: ${error instanceof Error ? error.message : String(error)}`;
  }
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


