// Việc làm sau mỗi lượt quét: AI chấm lại cảm xúc bài mới, và báo khi một nguồn hỏng/chạy lại.
import { classifySentimentBatch, resolveModel, SENTIMENT_BATCH_SIZE, type SentimentBatchItem } from "./ai.js";
import type { AppConfig } from "./config.js";
import type { Store, Topic } from "./db.js";
import { deliverText } from "./notify.js";

export const AI_SENTIMENT_STATUS_KEY = "AI_SENTIMENT_STATUS";
/** Mỗi lượt quét chấm tối đa chừng này bài, để một lần nạp nhiều bài không đốt quá nhiều lượt gọi. */
export const AI_SENTIMENT_PER_RUN = 50;
/** Nguồn lỗi liên tiếp chừng này lượt thì báo (một lỗi lẻ do mạng chập chờn thì bỏ qua). */
export const SOURCE_FAIL_THRESHOLD = 3;

export type AiSentimentStatus = { at: string; scored: number; changed: number; model: string; error?: string };

export function aiSentimentEnabled(config: AppConfig): boolean {
  return Boolean(config.LLM_API_KEY.trim()) && config.AI_SENTIMENT !== "0";
}

export function readAiSentimentStatus(store: Store): AiSentimentStatus | undefined {
  const raw = store.getSetting(AI_SENTIMENT_STATUS_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AiSentimentStatus;
  } catch {
    return undefined;
  }
}

/**
 * Chấm cảm xúc bằng AI cho bài chưa được chấm (mới nhất trước), theo lô 25 bài một lần gọi.
 * Bài người đã sửa tay không bị đụng. Lỗi của AI không làm hỏng lượt quét: ghi lại và dừng.
 */
export async function runAiSentiment(
  store: Store,
  config: AppConfig,
  options: { limit?: number; sinceDays?: number; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<AiSentimentStatus> {
  const now = options.now ?? new Date();
  const model = resolveModel({ baseUrl: config.LLM_BASE_URL, model: config.LLM_MODEL });
  const status: AiSentimentStatus = { at: now.toISOString(), scored: 0, changed: 0, model };
  const since = new Date(now.getTime() - (options.sinceDays ?? 3) * 86_400_000).toISOString();
  const pending = store.listMentionsForAiSentiment(options.limit ?? AI_SENTIMENT_PER_RUN, since);
  if (pending.length === 0) return status;

  const topicNames = new Map(store.listTopics().map((t) => [t.id, t.name]));
  const before = new Map(pending.map((p) => [`${p.topic_id}\u0000${p.id}`, p.sentiment]));
  const items: SentimentBatchItem[] = pending.map((p) => ({ id: p.id, topicId: p.topic_id, topicName: topicNames.get(p.topic_id), text: p.text }));

  for (let i = 0; i < items.length; i += SENTIMENT_BATCH_SIZE) {
    const batch = items.slice(i, i + SENTIMENT_BATCH_SIZE);
    try {
      const verdicts = await classifySentimentBatch(batch, {
        apiKey: config.LLM_API_KEY,
        baseUrl: config.LLM_BASE_URL,
        model: config.LLM_MODEL,
        fetchImpl: options.fetchImpl,
      });
      if (verdicts.length === 0) {
        status.error = "AI trả lời sai định dạng, sẽ thử lại ở lượt sau.";
        break;
      }
      for (const v of verdicts) {
        if (!store.applySentiment(v.topicId, v.id, { sentiment: v.sentiment, reason: v.reason, source: "ai" }, status.at)) continue;
        status.scored += 1;
        if (before.get(`${v.topicId}\u0000${v.id}`) !== v.sentiment) status.changed += 1;
      }
    } catch (error) {
      status.error = error instanceof Error ? error.message.slice(0, 200) : "Không gọi được AI.";
      break;
    }
  }
  store.setSetting(AI_SENTIMENT_STATUS_KEY, JSON.stringify(status));
  return status;
}

export function failingTopics(store: Store): Topic[] {
  return store.listTopics().filter((t) => t.active === 1 && t.fail_count >= SOURCE_FAIL_THRESHOLD);
}

/**
 * Báo một lần khi nguồn lỗi liên tiếp từ 3 lượt (cookie hết hạn, token bị thu hồi...),
 * và báo một lần nữa khi nguồn quét lại được. Không có webhook thì chỉ ghi trạng thái.
 */
export async function checkSourceHealth(
  store: Store,
  config: AppConfig,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ down: string[]; recovered: string[]; error?: string }> {
  const down: Topic[] = [];
  const recovered: Topic[] = [];
  for (const topic of store.listTopics()) {
    if (topic.active === 1 && topic.fail_count >= SOURCE_FAIL_THRESHOLD && topic.health_alerted === 0) down.push(topic);
    else if (topic.health_alerted === 1 && (topic.fail_count === 0 || topic.active === 0)) {
      if (topic.active === 1) recovered.push(topic);
      else store.setTopicHealthAlerted(topic.id, false);
    }
  }
  let error: string | undefined;
  const send = async (title: string, body: string) => {
    try {
      const e = await deliverText(title, body, {
        webhookUrl: config.ALERT_WEBHOOK_URL,
        desktop: config.DESKTOP_NOTIFY === "1",
        fetchImpl: options.fetchImpl,
      });
      if (e) error = e;
      return !e;
    } catch (e) {
      error = e instanceof Error ? e.message : "Không gửi được.";
      return false;
    }
  };
  if (down.length > 0) {
    const lines = down.map((t) => `• ${t.name} (${sourceName(t.source)}): ${(t.last_error ?? "lỗi không rõ").slice(0, 200)} — lỗi ${t.fail_count} lượt liền`);
    const ok = await send(`⚠️ ${down.length} nguồn đang không quét được`, `${lines.join("\n")}\n\nThường do cookie/token hết hạn. Vào Cài đặt để cập nhật.`);
    if (ok) for (const t of down) store.setTopicHealthAlerted(t.id, true);
  }
  if (recovered.length > 0) {
    const ok = await send(`✅ Nguồn đã quét lại được`, recovered.map((t) => `• ${t.name} (${sourceName(t.source)})`).join("\n"));
    if (ok) for (const t of recovered) store.setTopicHealthAlerted(t.id, false);
  }
  return { down: down.map((t) => t.name), recovered: recovered.map((t) => t.name), error };
}

export function sourceName(source: string): string {
  return source === "facebook" ? "Facebook" : source === "threads" ? "Threads" : source === "youtube" ? "YouTube" : source === "web" ? "Báo chí" : "X";
}
