import { pickBriefSample, requestAiBrief, resolveModel } from "../ai.js";
import type { AppConfig } from "../config.js";
import { Store, type MentionView, type QueueState } from "../db.js";
import { buildBrief, dayStartIso, localDay, shiftDay, splitRisk, type Brief, type BriefRef, type DigestPost } from "../digest.js";

export function outboundLabel(config: AppConfig): string {
  const desktop = config.DESKTOP_NOTIFY === "1" ? "thông báo trên máy" : "";
  const webhook = config.ALERT_WEBHOOK_URL.trim() ? "webhook" : "";
  return [desktop, webhook].filter(Boolean).join(" và ");
}

type StoredAiBrief = {
  fingerprint: string;
  text: string;
  generatedAt: string;
  model: string;
  basedOn: number;
  refs?: BriefRef[];
};

/** Lấy các bài mà nhận định dẫn chứng bằng [#n], theo đúng thứ tự đã đưa cho AI. */
export function collectRefs(text: string, sample: DigestPost[]): BriefRef[] {
  const numbers = [...new Set([...text.matchAll(/\[#(\d{1,3})\]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  return numbers
    .map((n) => {
      const post = sample[n - 1];
      if (!post) return null;
      return {
        n,
        author: post.authorUsername,
        topic: post.topicName,
        sentiment: post.sentiment,
        text: post.text.replace(/\s+/g, " ").slice(0, 400),
        url: post.url ?? "",
      };
    })
    .filter((ref): ref is BriefRef => ref !== null);
}

const AI_BRIEF_PREFIX = "AI_BRIEF:";

/** Dấu vân tay dữ liệu của một ngày: đổi khi có bài mới, đổi cảm xúc, ghim/bỏ ghim, hay đổi model. */
export function briefFingerprint(brief: Brief, posts: DigestPost[], model: string): string {
  const ids = posts.map((p) => `${p.topicId}/${p.id}:${p.sentiment}:${p.starred}`).sort().join(",");
  let hash = 2166136261;
  for (let i = 0; i < ids.length; i++) hash = Math.imul(hash ^ ids.charCodeAt(i), 16777619) >>> 0;
  return `${model}|${brief.posts}|${hash.toString(36)}`;
}

function readStoredBrief(store: Store, day: string): StoredAiBrief | undefined {
  const raw = store.getSetting(AI_BRIEF_PREFIX + day);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAiBrief>;
    if (typeof parsed.text !== "string" || typeof parsed.fingerprint !== "string") return undefined;
    return {
      fingerprint: parsed.fingerprint,
      text: parsed.text,
      generatedAt: String(parsed.generatedAt ?? ""),
      model: String(parsed.model ?? ""),
      basedOn: Number(parsed.basedOn ?? 0),
      refs: Array.isArray(parsed.refs) ? parsed.refs : [],
    };
  } catch {
    return undefined;
  }
}

export async function todayBrief(store: Store, config: AppConfig, fetchImpl?: typeof fetch): Promise<Brief> {
  return briefForDay(store, config, localDay(new Date()), fetchImpl);
}

export type BriefOptions = {
  /** Bỏ bản đã lưu, gọi AI viết lại. */
  force?: boolean;
  /** Chỉ dùng bản đã lưu, không gọi AI (trang mở nhanh, gọi AI sau). */
  cachedOnly?: boolean;
};

/**
 * Bản tin của một ngày (giờ Việt Nam), kèm nhận định AI khi có khóa.
 * Nhận định được lưu theo ngày; chỉ gọi AI lại khi dữ liệu ngày đó thay đổi hoặc khi yêu cầu viết lại.
 */
export async function briefForDay(
  store: Store,
  config: AppConfig,
  day: string,
  fetchImpl?: typeof fetch,
  options: BriefOptions = {},
): Promise<Brief> {
  const weekAgo = shiftDay(day, -7);
  const recent = store.listHeardSince(dayStartIso(weekAgo));
  const posts = recent.filter((post) => localDay(new Date(post.createdAt)) === day);
  const base = buildBrief(day, posts, store.listFirstSeen());

  const yesterday = shiftDay(day, -1);
  const prior = recent.filter((post) => {
    const d = localDay(new Date(post.createdAt));
    return d >= weekAgo && d < day;
  });
  const yesterdayPosts = prior.filter((post) => localDay(new Date(post.createdAt)) === yesterday);
  base.previous = {
    posts: yesterdayPosts.length,
    negative: yesterdayPosts.filter((post) => post.sentiment === "negative").length,
    avg7: Math.round((prior.length / 7) * 10) / 10,
  };

  if (!config.LLM_API_KEY.trim()) return base;

  const aiOptions = { apiKey: config.LLM_API_KEY, baseUrl: config.LLM_BASE_URL, model: config.LLM_MODEL, fetchImpl };
  const model = resolveModel(aiOptions);
  const fingerprint = briefFingerprint(base, posts, model);
  const stored = readStoredBrief(store, day);

  const apply = (entry: StoredAiBrief) => {
    const { risk } = splitRisk(entry.text);
    base.aiSummary = entry.text;
    base.risk = risk;
    base.ai = { generatedAt: entry.generatedAt, model: entry.model, basedOn: entry.basedOn };
    base.aiRefs = entry.refs ?? [];
  };

  if (stored && !options.force && (stored.fingerprint === fingerprint || options.cachedOnly)) {
    apply(stored);
    if (stored.fingerprint !== fingerprint) base.ai!.stale = true;
    return base;
  }
  if (options.cachedOnly) return base;

  const result = await requestAiBrief(posts, aiOptions, {
    day,
    sentiment: base.sentiment,
    topics: base.topics,
    previous: base.previous,
  });
  if (result.text) {
    const entry: StoredAiBrief = {
      fingerprint,
      text: result.text,
      generatedAt: new Date().toISOString(),
      model,
      basedOn: posts.length,
      refs: collectRefs(result.text, pickBriefSample(posts)),
    };
    store.setSetting(AI_BRIEF_PREFIX + day, JSON.stringify(entry));
    store.pruneSettings(AI_BRIEF_PREFIX, AI_BRIEF_PREFIX + shiftDay(localDay(new Date()), -45));
    apply(entry);
  } else if (stored) {
    // Lỗi lần này: vẫn hiện bản cũ, kèm báo lỗi.
    apply(stored);
    base.ai!.error = result.error;
    base.ai!.stale = true;
  } else {
    base.ai = { generatedAt: "", model, basedOn: posts.length, error: result.error };
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
