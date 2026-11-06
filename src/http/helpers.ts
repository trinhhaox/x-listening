import { generateAiBrief } from "../ai.js";
import type { AppConfig } from "../config.js";
import { Store, type MentionView, type QueueState } from "../db.js";
import { buildBrief, dayStartIso, localDay, type Brief } from "../digest.js";

export function outboundLabel(config: AppConfig): string {
  const desktop = config.DESKTOP_NOTIFY === "1" ? "thông báo trên máy" : "";
  const webhook = config.ALERT_WEBHOOK_URL.trim() ? "webhook" : "";
  return [desktop, webhook].filter(Boolean).join(" và ");
}

let cachedAiBrief: { day: string; text: string; expiresAt: number } | null = null;

export async function todayBrief(store: Store, config: AppConfig, fetchImpl?: typeof fetch): Promise<Brief> {
  const today = localDay(new Date());
  const posts = store.listHeardSince(dayStartIso(today));
  const base = buildBrief(today, posts, store.listFirstSeen());

  if (config.LLM_API_KEY.trim()) {
    const now = Date.now();
    if (cachedAiBrief && cachedAiBrief.day === today && cachedAiBrief.expiresAt > now) {
      base.aiSummary = cachedAiBrief.text;
    } else {
      const summary = await generateAiBrief(posts, {
        apiKey: config.LLM_API_KEY,
        baseUrl: config.LLM_BASE_URL,
        model: config.LLM_MODEL,
        fetchImpl,
      });
      cachedAiBrief = { day: today, text: summary, expiresAt: now + 10 * 60 * 1000 };
      base.aiSummary = summary;
    }
  }

  return base;
}

export function safeKey(value: string): boolean {
  return /^[\w-]{1,80}$/.test(value);
}

export function readView(value: string | undefined): MentionView {
  if (value === "new" || value === "reading" || value === "done" || value === "starred" || value === "hidden") return value;
  return "wire";
}

export function isQueue(value: string): value is QueueState {
  return value === "new" || value === "reading" || value === "done";
}

export function deskPath(
  topic: string,
  view: MentionView,
  notice?: string,
  filters?: { search?: string; sentiment?: string; minLikes?: number; tag?: string; assignedTo?: string },
): string {
  const params = new URLSearchParams();
  if (topic) params.set("topic", topic);
  if (view !== "wire") params.set("view", view);
  if (filters?.search) params.set("search", filters.search);
  if (filters?.sentiment) params.set("sentiment", filters.sentiment);
  if (filters?.minLikes) params.set("min_likes", String(filters.minLikes));
  if (filters?.tag) params.set("tag", filters.tag);
  if (filters?.assignedTo) params.set("assigned_to", filters.assignedTo);
  if (notice) params.set("notice", notice);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export async function backFrom(c: { req: { parseBody: () => Promise<Record<string, unknown>> } }): Promise<{
  topic: string;
  view: MentionView;
  search: string;
  sentiment: string;
  minLikes?: number;
  tag: string;
  assignedTo: string;
}> {
  const body = await c.req.parseBody();
  return {
    topic: String(body.topic ?? ""),
    view: readView(String(body.view ?? "")),
    search: String(body.search ?? "").trim(),
    sentiment: String(body.sentiment ?? "").trim(),
    minLikes: Number(body.min_likes ?? 0) || undefined,
    tag: String(body.tag ?? "").trim(),
    assignedTo: String(body.assigned_to ?? "").trim(),
  };
}
