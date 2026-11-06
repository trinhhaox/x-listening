import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { analyzePostWithAi, classifyMentionWithAi } from "../ai.js";
import { deliverExecutiveReport } from "../notify.js";
import { extractWordCloud } from "../cloud.js";
import { analyzeHashtags } from "../hashtags.js";
import { todayBrief, safeKey } from "../http/helpers.js";
import { getRuntimeConfig } from "../runtime_config.js";
import type { AppContext } from "../http/context.js";

/** API JSON dưới /api/* (đã qua lớp xác thực Bearer hoặc phiên). */
export function registerApiRoutes(app: Hono, ctx: AppContext): void {
  const { config, store, fanOutHits } = ctx;

  app.post("/api/mentions", async (c) => {

    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const mentionSchema = z.object({
      id: z.string().optional(),
      topicId: z.string().min(1),
      text: z.string().min(1).max(5000),
      authorUsername: z.string().min(1).max(100),
      authorName: z.string().optional().default(""),
      createdAt: z.string().optional(),
      lang: z.string().optional().default("vi"),
      likeCount: z.number().int().min(0).optional().default(0),
      repostCount: z.number().int().min(0).optional().default(0),
      replyCount: z.number().int().min(0).optional().default(0),
      quoteCount: z.number().int().min(0).optional().default(0),
      url: z.string().url().optional().or(z.literal("")),
      sample: z.boolean().optional().default(false),
    });

    const parsed = mentionSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" }, 400);
    }

    const data = parsed.data;
    const topic = store.getTopic(data.topicId);
    if (!topic) {
      return c.json({ ok: false, error: "Tần số không tồn tại" }, 404);
    }

    const id = data.id || randomUUID();
    const nowIso = new Date().toISOString();
    const createdAt = data.createdAt || nowIso;
    const inserted = store.insertMention(
      {
        id,
        topicId: data.topicId,
        text: data.text,
        authorUsername: data.authorUsername,
        authorName: data.authorName || data.authorUsername,
        createdAt,
        lang: data.lang,
        likeCount: data.likeCount,
        repostCount: data.repostCount,
        replyCount: data.replyCount,
        quoteCount: data.quoteCount,
        url: data.url || "",
        sample: data.sample,
      },
      nowIso,
    );

    await fanOutHits();
    return c.json({ ok: true, id, inserted });
  });

  app.post("/api/ai/analyze", async (c) => {

    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const schema = z.object({ text: z.string().min(1).max(5000) });
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" }, 400);
    }

    const activeConfig = getRuntimeConfig(config, store);
    if (!activeConfig.LLM_API_KEY.trim()) {
      return c.json({ ok: false, error: "Chưa cấu hình LLM_API_KEY (trong Cài đặt hoặc .env)" }, 400);
    }

    const result = await analyzePostWithAi(parsed.data.text, {
      apiKey: activeConfig.LLM_API_KEY,
      baseUrl: activeConfig.LLM_BASE_URL,
      model: activeConfig.LLM_MODEL,
    });

    if (!result) {
      return c.json({ ok: false, error: "Không thể phân tích bằng AI" }, 502);
    }

    return c.json({ ok: true, data: result });
  });

  app.get("/api/wordcloud", (c) => {
    const topic = c.req.query("topic") ?? "";
    const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const cloudMentions = store.listMentionsForCloud(week, topic || undefined);
    const result = extractWordCloud(cloudMentions);
    return c.json({ ok: true, data: result });
  });

  app.get("/api/hashtags", (c) => {
    const daysParam = Number(c.req.query("days"));
    const days = [1, 7, 30].includes(daysParam) ? daysParam : 7;
    const topic = c.req.query("topic") ?? "";
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const mentions = store.listMentionsForHashtags(since, topic || undefined);
    const analytics = analyzeHashtags(mentions, 100);
    return c.json({ ok: true, data: analytics });
  });

  app.post("/api/ai/classify", async (c) => {

    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const schema = z.object({ text: z.string().min(1).max(5000) });
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" }, 400);
    }

    const activeConfig = getRuntimeConfig(config, store);
    const result = await classifyMentionWithAi(parsed.data.text, {
      apiKey: activeConfig.LLM_API_KEY,
      baseUrl: activeConfig.LLM_BASE_URL,
      model: activeConfig.LLM_MODEL,
    });

    return c.json({ ok: true, data: result });
  });

  app.post("/api/reports/send", async (c) => {
    const activeConfig = getRuntimeConfig(config, store);
    if (!activeConfig.ALERT_WEBHOOK_URL.trim()) {
      return c.json({ ok: false, error: "Chưa cấu hình ALERT_WEBHOOK_URL" }, 400);
    }
    const brief = await todayBrief(store, activeConfig);
    const err = await deliverExecutiveReport(brief, activeConfig.ALERT_WEBHOOK_URL);
    if (err) {
      return c.json({ ok: false, error: err }, 502);
    }
    return c.json({ ok: true, message: "Report sent successfully" });
  });
}
