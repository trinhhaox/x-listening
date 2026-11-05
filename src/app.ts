import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { analyzePostWithAi, generateAiBrief } from "./ai.js";
import { issueSession, sessionValid } from "./auth.js";
import type { AppConfig } from "./config.js";
import { muteKey, Store, type MentionView, type QueueState } from "./db.js";
import { pageKey } from "./facebook.js";
import { threadsUserKey } from "./threads.js";
import { listenOnce, type ListenReport } from "./listen.js";
import { deliverExecutiveReport, deliverHit } from "./notify.js";
import { buildSearchQuery } from "./query.js";
import { lexiconWord } from "./sentiment.js";
import { buckets, briefMarkdown, buildBrief, dayStartIso, daysEnding, localDay, spikeReason, type Brief } from "./digest.js";
import { briefPage, comparePage, dashboardPage, loginPage, mentionsCsv } from "./pages.js";

const COOKIE = "xl_session";
const attempts = new Map<string, { count: number; resetAt: number }>();

export function createApp(config: AppConfig, store: Store) {
  const app = new Hono();
  let listening = false;
  let notifyError = "";

  async function runListen(extra?: { onlyTopicId?: string; startTime?: string }): Promise<ListenReport> {
    if (listening) return { saved: 0, topics: 0, errors: ["Đang nghe một lượt khác."] };
    listening = true;
    try {
      const report = await listenOnce(store, {
        token: config.X_BEARER_TOKEN,
        twitterAuthToken: config.TWITTER_AUTH_TOKEN,
        twitterCt0: config.TWITTER_CT0,
        facebookToken: config.FACEBOOK_ACCESS_TOKEN,
        facebookCookie: config.FACEBOOK_COOKIE,
        threadsToken: config.THREADS_ACCESS_TOKEN,
        youtubeApiKey: config.YOUTUBE_API_KEY,
        maxResults: config.SEARCH_MAX_RESULTS,
        onlyTopicId: extra?.onlyTopicId,
        startTime: extra?.startTime,
      });
      await fanOutHits();
      return report;
    } finally {
      listening = false;
    }
  }

  async function fanOutHits(): Promise<void> {
    const hits = store.listPendingNotices();
    const done: string[] = [];
    for (const hit of hits) {
      try {
        const error = await deliverHit(hit, {
          webhookUrl: config.ALERT_WEBHOOK_URL,
          desktop: config.DESKTOP_NOTIFY === "1",
        });
        if (error) notifyError = error;
        else done.push(hit.id);
      } catch (error) {
        notifyError = error instanceof Error ? error.message : "Không gửi được chuông ra ngoài.";
      }
    }
    if (done.length > 0) {
      store.markNotified(done);
      if (done.length === hits.length) notifyError = "";
    }
  }

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/login", (c) => {
    if (sessionValid(getCookie(c, COOKIE), config.ADMIN_PASSWORD)) return c.redirect("/");
    return c.html(loginPage());
  });

  app.post("/login", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const gate = attempts.get(ip);
    const now = Date.now();
    if (gate && gate.resetAt > now && gate.count >= 8) {
      return c.html(loginPage("Thử lại sau một phút."), 429);
    }
    const body = await c.req.parseBody();
    const password = String(body.password ?? "");
    if (!passwordsMatch(password, config.ADMIN_PASSWORD)) {
      const next = !gate || gate.resetAt <= now ? { count: 1, resetAt: now + 60_000 } : { count: gate.count + 1, resetAt: gate.resetAt };
      attempts.set(ip, next);
      return c.html(loginPage("Mật khẩu chưa đúng."), 401);
    }
    attempts.delete(ip);
    setCookie(c, COOKIE, issueSession(config.ADMIN_PASSWORD), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return c.redirect("/");
  });

  app.use("*", async (c, next) => {
    if (c.req.path === "/login" || c.req.path === "/health" || c.req.path.startsWith("/api/")) return next();
    if (!sessionValid(getCookie(c, COOKIE), config.ADMIN_PASSWORD)) {
      if (c.req.path.startsWith("/export")) return c.text("Cần đăng nhập", 401);
      return c.redirect("/login");
    }
    return next();
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.redirect("/login");
  });

  app.get("/", (c) => {
    const topic = c.req.query("topic") ?? "";
    const notice = c.req.query("notice") ?? "";
    const view = readView(c.req.query("view"));
    const search = c.req.query("search") ?? "";
    const sentiment = c.req.query("sentiment") ?? "";
    const minLikes = Number(c.req.query("min_likes") ?? 0) || undefined;
    const assignedTo = c.req.query("assigned_to") ?? "";
    const tag = c.req.query("tag") ?? "";

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const today = localDay(new Date());
    const series = buckets(store.listHeardSince(dayStartIso(daysEnding(today, 7)[0] ?? today)), daysEnding(today, 7), topic);
    return c.html(
      dashboardPage({
        topics: store.listTopics(),
        mentions: store.listMentions({
          topicId: topic || undefined,
          limit: 80,
          view,
          search,
          sentiment,
          minLikes,
          assignedTo,
          tag,
        }),
        activeTopic: topic,
        view,
        search,
        sentimentFilter: sentiment,
        minLikesFilter: minLikes,
        assignedToFilter: assignedTo,
        tagFilter: tag,
        templates: store.listTemplates(),
        hasToken: Boolean(config.X_BEARER_TOKEN.trim() || (config.TWITTER_AUTH_TOKEN.trim() && config.TWITTER_CT0.trim())),
        hasFacebook: Boolean(config.FACEBOOK_ACCESS_TOKEN.trim() || config.FACEBOOK_COOKIE.trim()),
        hasThreads: Boolean(config.THREADS_ACCESS_TOKEN.trim()),
        hasYoutube: Boolean(config.YOUTUBE_API_KEY.trim()),
        notice,
        stats: store.stats(since),
        days: series.map((row) => ({ day: row.day, count: row.posts })),
        alerts: store.listAlerts(),
        hits: store.listOpenHits(),
        voices: store.topVoices(week),
        muted: store.listMuted(),
        queueNew: store.countNew(),
        lexicon: store.listLexicon(),
        outbound: outboundLabel(config),
        notifyError,
        spike: spikeReason(series, today),
      }),
    );
  });

  app.get("/brief", async (c) => {
    const notice = c.req.query("notice") ?? "";
    const brief = await todayBrief(store, config);
    return c.html(briefPage(brief, notice));
  });

  app.post("/brief/send-webhook", async (c) => {
    if (!config.ALERT_WEBHOOK_URL.trim()) {
      return c.redirect("/brief?notice=" + encodeURIComponent("Chưa cấu hình ALERT_WEBHOOK_URL trong file .env"));
    }
    const brief = await todayBrief(store, config);
    const err = await deliverExecutiveReport(brief, config.ALERT_WEBHOOK_URL);
    if (err) {
      return c.redirect("/brief?notice=" + encodeURIComponent(`Không gửi được báo cáo: ${err}`));
    }
    return c.redirect("/brief?notice=" + encodeURIComponent("Đã gửi báo cáo điều hành qua Webhook thành công!"));
  });

  app.get("/brief.md", async (c) => {
    const brief = await todayBrief(store, config);
    return c.body(briefMarkdown(brief), 200, {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": "attachment; filename=ban-tin.md",
    });
  });

  app.get("/compare", (c) => {
    const topics = store.listTopics();
    const left = c.req.query("left") || topics[0]?.id || "";
    const right = c.req.query("right") || topics.find((topic) => topic.id !== left)?.id || left;
    const today = localDay(new Date());
    const days = daysEnding(today, 7);
    const posts = store.listHeardSince(dayStartIso(days[0] ?? today));
    const leftSeries = buckets(posts, days, left);
    const rightSeries = buckets(posts, days, right);
    return c.html(
      comparePage({
        topics,
        left,
        right,
        series: days.map((day, index) => ({ day, left: leftSeries[index]!, right: rightSeries[index]! })),
      }),
    );
  });

  app.get("/export.csv", (c) => {
    const topic = c.req.query("topic") ?? "";
    const search = c.req.query("search") ?? "";
    const sentiment = c.req.query("sentiment") ?? "";
    const minLikes = Number(c.req.query("min_likes") ?? 0) || undefined;
    const assignedTo = c.req.query("assigned_to") ?? "";
    const tag = c.req.query("tag") ?? "";
    const csv = mentionsCsv(
      store.listMentions({
        topicId: topic || undefined,
        limit: 1000,
        search,
        sentiment,
        minLikes,
        assignedTo,
        tag,
      }),
    );
    return c.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=x-listening.csv",
    });
  });

  app.post("/topics", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim().slice(0, 80);
    const rawQuery = String(body.query ?? "");
    const source = ["facebook", "threads", "youtube"].includes(body.source as string)
      ? (body.source as "facebook" | "threads" | "youtube")
      : "x";
    const phrase = String(body.phrase ?? "").trim().slice(0, 80);
    const exclude = body.exclude_reposts === "on" || body.exclude_reposts === "true";
    if (!name) return c.redirect("/?notice=" + encodeURIComponent("Thiếu tên tần số."));
    let query = rawQuery.replace(/\s+/g, " ").trim();
    if (source === "facebook") {
      const page = pageKey(query);
      if (!page) {
        return c.redirect(
          "/?notice=" + encodeURIComponent("Facebook cần link hoặc id một Trang. Không tìm được từ khóa trên mọi bài Facebook."),
        );
      }
      query = page;
    } else if (source === "threads") {
      const user = threadsUserKey(query);
      if (!user) {
        return c.redirect("/?notice=" + encodeURIComponent("Threads cần username hoặc link tài khoản Threads."));
      }
      query = user;
    } else if (source === "youtube") {
      if (!query) {
        return c.redirect("/?notice=" + encodeURIComponent("YouTube cần từ khóa tìm kiếm."));
      }
    } else {
      try {
        buildSearchQuery(query, exclude);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Câu truy vấn không dùng được";
        return c.redirect("/?notice=" + encodeURIComponent(message));
      }
    }
    store.insertTopic({
      id: randomUUID(),
      name,
      query,
      excludeReposts: source === "x" && exclude,
      source,
      phrase: source === "facebook" || source === "threads" ? phrase : "",
      createdAt: new Date().toISOString(),
    });
    return c.redirect("/?notice=" + encodeURIComponent(`Đã thêm tần số “${name}”.`));
  });

  app.post("/topics/:id/toggle", (c) => {
    const topic = store.getTopic(c.req.param("id"));
    if (topic) store.setTopicActive(topic.id, topic.active !== 1);
    return c.redirect("/");
  });

  app.post("/topics/:id/backfill", async (c) => {
    const id = c.req.param("id");
    if (!safeKey(id) || !store.getTopic(id)) return c.redirect(deskPath("", "wire", "Không còn tần số này."));
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const report = await runListen({ onlyTopicId: id, startTime: start });
    const notice = [`Ghi ${report.saved} bài trong 7 ngày.`, ...report.errors].filter(Boolean).join(" ");
    return c.redirect(deskPath("", "wire", notice));
  });

  app.post("/topics/:id/delete", (c) => {
    store.deleteTopic(c.req.param("id"));
    return c.redirect("/?notice=" + encodeURIComponent("Đã gỡ tần số."));
  });

  app.post("/listen", async (c) => {
    const report = await runListen();
    const notice = report.errors.length
      ? `Ghi ${report.saved} bài trên ${report.topics} tần số. ${report.errors.join(" ")}`
      : `Đã nghe ${report.topics} tần số, ghi ${report.saved} bài.`;
    return c.redirect("/?notice=" + encodeURIComponent(notice));
  });

  app.post("/lexicon", async (c) => {
    const body = await c.req.parseBody();
    const word = lexiconWord(String(body.word ?? ""));
    const polarity = body.polarity === "negative" ? "negative" : body.polarity === "positive" ? "positive" : "";
    if (!word || !polarity) return c.redirect(deskPath("", "wire", "Từ cần là một cụm chữ, tối đa ba tiếng."));
    const changed = store.setLexiconWord(word, polarity, new Date().toISOString());
    return c.redirect(deskPath("", "wire", `Đã thêm “${word}”. Chấm lại ${changed} bài.`));
  });

  app.post("/lexicon/delete", async (c) => {
    const body = await c.req.parseBody();
    const word = lexiconWord(String(body.word ?? ""));
    if (!word) return c.redirect(deskPath("", "wire", "Không còn từ này."));
    const changed = store.deleteLexiconWord(word);
    return c.redirect(deskPath("", "wire", `Đã gỡ “${word}”. Chấm lại ${changed} bài.`));
  });

  app.post("/samples", (c) => {
    const count = store.seedSamples();
    return c.redirect("/?notice=" + encodeURIComponent(`Đã nạp ${count} tin mẫu.`));
  });

  app.post("/samples/clear", (c) => {
    const count = store.clearSamples();
    return c.redirect("/?notice=" + encodeURIComponent(`Đã xóa ${count} tin mẫu.`));
  });

  app.post("/alerts", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim().slice(0, 80);
    const kind = String(body.kind ?? "");
    const phrase = String(body.phrase ?? "").trim().slice(0, 80);
    const minLikes = Number(body.min_likes ?? 0);
    const thresholdCount = Number(body.threshold_count ?? 3);
    const timeWindowMinutes = Number(body.time_window_minutes ?? 60);
    const topicId = String(body.topic_id ?? "");
    if (!name) return c.redirect(deskPath("", "wire", "Thiếu tên chuông."));
    if (kind !== "negative" && kind !== "phrase" && kind !== "likes" && kind !== "velocity") {
      return c.redirect(deskPath("", "wire", "Kiểu chuông không dùng được."));
    }
    if (kind === "phrase" && !phrase) return c.redirect(deskPath("", "wire", "Chuông cụm từ cần một cụm."));
    if (kind === "likes" && (!Number.isInteger(minLikes) || minLikes < 1 || minLikes > 1_000_000)) {
      return c.redirect(deskPath("", "wire", "Số thích tối thiểu chưa hợp lệ."));
    }
    if (kind === "velocity" && (!Number.isInteger(thresholdCount) || thresholdCount < 2 || !Number.isInteger(timeWindowMinutes) || timeWindowMinutes < 5 || timeWindowMinutes > 1440)) {
      return c.redirect(deskPath("", "wire", "Số bài xấu hoặc số phút của chuông bùng nổ chưa hợp lệ."));
    }
    if (topicId && !store.getTopic(topicId)) return c.redirect(deskPath("", "wire", "Tần số của chuông không còn."));
    const found = store.insertAlert({
      id: randomUUID(),
      topicId: topicId || null,
      name,
      kind,
      phrase: kind === "phrase" ? phrase : "",
      minLikes: kind === "likes" ? minLikes : 0,
      thresholdCount: kind === "velocity" ? thresholdCount : undefined,
      timeWindowMinutes: kind === "velocity" ? timeWindowMinutes : undefined,
      createdAt: new Date().toISOString(),
    });
    await fanOutHits();
    return c.redirect(deskPath("", "wire", `Đã đặt chuông “${name}”, khớp ${found} bài đang có.`));
  });

  app.post("/alerts/:id/delete", async (c) => {
    const id = c.req.param("id");
    if (safeKey(id)) store.deleteAlert(id);
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, "Đã gỡ chuông."));
  });

  app.post("/alerts/hits/:id/seen", async (c) => {
    const id = c.req.param("id");
    if (safeKey(id)) store.seeHit(id);
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view));
  });

  app.post("/mentions/:topicId/:mentionId/star", async (c) => {
    await changeMention(c, "starred");
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view));
  });

  app.post("/mentions/:topicId/:mentionId/hide", async (c) => {
    await changeMention(c, "hidden");
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view));
  });

  app.post("/mentions/:topicId/:mentionId/queue", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const body = await c.req.parseBody();
    const queue = String(body.queue ?? "");
    if (safeKey(topicId) && safeKey(mentionId) && isQueue(queue)) store.setMentionQueue(topicId, mentionId, queue);
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, undefined, back));
  });

  app.post("/mutes", async (c) => {
    const body = await c.req.parseBody();
    const username = String(body.username ?? "");
    const back = await backFrom(c);
    if (!muteKey(username) || !store.muteAuthor(username, new Date().toISOString())) {
      return c.redirect(deskPath(back.topic, back.view, "Tên tài khoản không dùng được.", back));
    }
    return c.redirect(deskPath(back.topic, back.view, `Đã tắt tiếng @${muteKey(username)}.`, back));
  });

  app.post("/mutes/:username/delete", async (c) => {
    store.unmuteAuthor(c.req.param("username"));
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, "Đã bỏ tắt tiếng.", back));
  });

  app.post("/mentions/:topicId/:mentionId/note", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const body = await c.req.parseBody();
    if (safeKey(topicId) && safeKey(mentionId)) {
      store.setMentionNote(topicId, mentionId, String(body.note ?? "").trim());
    }
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, undefined, back));
  });

  app.post("/mentions/:topicId/:mentionId/assign", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const body = await c.req.parseBody();
    if (safeKey(topicId) && safeKey(mentionId)) {
      store.setMentionAssignee(topicId, mentionId, String(body.assigned_to ?? "").trim().slice(0, 40));
    }
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, undefined, back));
  });

  app.post("/mentions/:topicId/:mentionId/tag", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const body = await c.req.parseBody();
    if (safeKey(topicId) && safeKey(mentionId)) {
      store.setMentionTag(topicId, mentionId, String(body.tag ?? "").trim().slice(0, 40));
    }
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, undefined, back));
  });

  app.post("/templates", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim().slice(0, 80);
    const content = String(body.content ?? "").trim().slice(0, 1000);
    const back = await backFrom(c);
    if (!name || !content) {
      return c.redirect(deskPath(back.topic, back.view, "Cần nhập cả tên mẫu và nội dung.", back));
    }
    store.insertTemplate({
      id: randomUUID(),
      name,
      content,
      createdAt: new Date().toISOString(),
    });
    return c.redirect(deskPath(back.topic, back.view, `Đã thêm mẫu “${name}”.`, back));
  });

  app.post("/templates/:id/delete", async (c) => {
    const id = c.req.param("id");
    if (safeKey(id)) {
      store.deleteTemplate(id);
    }
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, "Đã xóa mẫu phản hồi.", back));
  });

  app.post("/api/mentions", async (c) => {
    const authHeader = c.req.header("authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : (c.req.query("token") ?? "");
    if (!bearer || !passwordsMatch(bearer, config.ADMIN_PASSWORD)) {
      return c.json({ ok: false, error: "Unauthorized" }, 401);
    }

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
    const authHeader = c.req.header("authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : (c.req.query("token") ?? "");
    if (!bearer || !passwordsMatch(bearer, config.ADMIN_PASSWORD)) {
      return c.json({ ok: false, error: "Unauthorized" }, 401);
    }

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

    if (!config.LLM_API_KEY.trim()) {
      return c.json({ ok: false, error: "Chưa cấu hình LLM_API_KEY trong file .env" }, 400);
    }

    const result = await analyzePostWithAi(parsed.data.text, {
      apiKey: config.LLM_API_KEY,
      baseUrl: config.LLM_BASE_URL,
      model: config.LLM_MODEL,
    });

    if (!result) {
      return c.json({ ok: false, error: "Không thể phân tích bằng AI" }, 502);
    }

    return c.json({ ok: true, data: result });
  });

  app.post("/api/reports/send", async (c) => {
    const authHeader = c.req.header("authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : (c.req.query("token") ?? "");
    if (!bearer || !passwordsMatch(bearer, config.ADMIN_PASSWORD)) {
      return c.json({ ok: false, error: "Unauthorized" }, 401);
    }
    if (!config.ALERT_WEBHOOK_URL.trim()) {
      return c.json({ ok: false, error: "Chưa cấu hình ALERT_WEBHOOK_URL trong file .env" }, 400);
    }
    const brief = await todayBrief(store, config);
    const err = await deliverExecutiveReport(brief, config.ALERT_WEBHOOK_URL);
    if (err) {
      return c.json({ ok: false, error: err }, 502);
    }
    return c.json({ ok: true, message: "Report sent successfully" });
  });

  async function changeMention(c: { req: { param: (name: string) => string } }, field: "starred" | "hidden") {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    if (safeKey(topicId) && safeKey(mentionId)) store.toggleMention(topicId, mentionId, field);
  }

  return { app, runListen };
}

function outboundLabel(config: AppConfig): string {
  const desktop = config.DESKTOP_NOTIFY === "1" ? "thông báo trên máy" : "";
  const webhook = config.ALERT_WEBHOOK_URL.trim() ? "webhook" : "";
  return [desktop, webhook].filter(Boolean).join(" và ");
}

let cachedAiBrief: { day: string; text: string; expiresAt: number } | null = null;

async function todayBrief(store: Store, config: AppConfig, fetchImpl?: typeof fetch): Promise<Brief> {
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

function safeKey(value: string): boolean {
  return /^[\w-]{1,80}$/.test(value);
}

function readView(value: string | undefined): MentionView {
  if (value === "new" || value === "reading" || value === "done" || value === "starred" || value === "hidden") return value;
  return "wire";
}

function isQueue(value: string): value is QueueState {
  return value === "new" || value === "reading" || value === "done";
}

function deskPath(
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

async function backFrom(c: { req: { parseBody: () => Promise<Record<string, unknown>> } }): Promise<{
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

function passwordsMatch(input: string, expected: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
