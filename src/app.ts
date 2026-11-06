import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { analyzePostWithAi, classifyMentionRuleBased, classifyMentionWithAi, generateAiBrief } from "./ai.js";
import { issueSession, sessionValid } from "./auth.js";
import { SECRET_SETTINGS } from "./secrets.js";
import type { AppConfig } from "./config.js";
import { muteKey, Store, type MentionView, type QueueState } from "./db.js";
import { pageKey } from "./facebook.js";
import { threadsUserKey } from "./threads.js";
import { listenOnce, type ListenReport } from "./listen.js";
import { deliverExecutiveReport, deliverHit } from "./notify.js";
import { buildSearchQuery } from "./query.js";
import { lexiconWord } from "./sentiment.js";
import { extractWordCloud } from "./cloud.js";
import { analyzeHashtags } from "./hashtags.js";
import { searchLiveMentions } from "./social_search.js";
import { LiveSearchCache } from "./search_cache.js";
import { buckets, briefMarkdown, buildBrief, dayStartIso, daysEnding, localDay, spikeReason, type Brief } from "./digest.js";
import { xRouteWarning, briefPage, comparePage, dashboardPage, hashtagsPage, loginPage, mentionsCsv, searchPage, settingsPage } from "./pages.js";

const COOKIE = "xl_session";

const attempts = new Map<string, { count: number; resetAt: number }>();

export function getRuntimeConfig(base: AppConfig, store: Store): AppConfig {
  const dbSettings = store.getAllSettings();
  return {
    ...base,
    X_BEARER_TOKEN: dbSettings.X_BEARER_TOKEN ?? base.X_BEARER_TOKEN,
    TWITTER_AUTH_TOKEN: dbSettings.TWITTER_AUTH_TOKEN ?? base.TWITTER_AUTH_TOKEN,
    TWITTER_CT0: dbSettings.TWITTER_CT0 ?? base.TWITTER_CT0,
    FACEBOOK_ACCESS_TOKEN: dbSettings.FACEBOOK_ACCESS_TOKEN ?? base.FACEBOOK_ACCESS_TOKEN,
    FACEBOOK_COOKIE: dbSettings.FACEBOOK_COOKIE ?? base.FACEBOOK_COOKIE,
    THREADS_ACCESS_TOKEN: dbSettings.THREADS_ACCESS_TOKEN ?? base.THREADS_ACCESS_TOKEN,
    YOUTUBE_API_KEY: dbSettings.YOUTUBE_API_KEY ?? base.YOUTUBE_API_KEY,
    LLM_API_KEY: dbSettings.LLM_API_KEY ?? base.LLM_API_KEY,
    LLM_BASE_URL: dbSettings.LLM_BASE_URL ?? base.LLM_BASE_URL,
    LLM_MODEL: dbSettings.LLM_MODEL ?? base.LLM_MODEL,
    ALERT_WEBHOOK_URL: dbSettings.ALERT_WEBHOOK_URL ?? base.ALERT_WEBHOOK_URL,
    DESKTOP_NOTIFY: dbSettings.DESKTOP_NOTIFY === "0" || dbSettings.DESKTOP_NOTIFY === "1" ? dbSettings.DESKTOP_NOTIFY : base.DESKTOP_NOTIFY,
    LISTEN_INTERVAL_MINUTES: Number(dbSettings.LISTEN_INTERVAL_MINUTES) || base.LISTEN_INTERVAL_MINUTES,
    SEARCH_MAX_RESULTS: Number(dbSettings.SEARCH_MAX_RESULTS) || base.SEARCH_MAX_RESULTS,
  };
}

export function createApp(config: AppConfig, store: Store) {
  const app = new Hono();
  let listening = false;
  const liveSearchCache = new LiveSearchCache<Awaited<ReturnType<typeof searchLiveMentions>>>({
    ttlMs: 5 * 60_000,
    maxEntries: 50,
    maxCallsPerMinute: 10,
  });
  let notifyError = "";

  async function runListen(extra?: { onlyTopicId?: string; startTime?: string }): Promise<ListenReport> {
    if (listening) return { saved: 0, topics: 0, errors: ["Đang nghe một lượt khác."] };
    listening = true;
    try {
      const activeConfig = getRuntimeConfig(config, store);
      const report = await listenOnce(store, {
        token: activeConfig.X_BEARER_TOKEN,
        twitterAuthToken: activeConfig.TWITTER_AUTH_TOKEN,
        twitterCt0: activeConfig.TWITTER_CT0,
        facebookToken: activeConfig.FACEBOOK_ACCESS_TOKEN,
        facebookCookie: activeConfig.FACEBOOK_COOKIE,
        threadsToken: activeConfig.THREADS_ACCESS_TOKEN,
        youtubeApiKey: activeConfig.YOUTUBE_API_KEY,
        maxResults: activeConfig.SEARCH_MAX_RESULTS,
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
    const activeConfig = getRuntimeConfig(config, store);
    const hits = store.listPendingNotices();
    const done: string[] = [];
    for (const hit of hits) {
      try {
        const error = await deliverHit(hit, {
          webhookUrl: activeConfig.ALERT_WEBHOOK_URL,
          desktop: activeConfig.DESKTOP_NOTIFY === "1",
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
    const ip = clientIp(c);
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
      secure: requestIsHttps(c),
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return c.redirect("/");
  });

  app.use("*", async (c, next) => {
    if (c.req.path === "/login" || c.req.path === "/health") return next();
    if (c.req.path.startsWith("/api/")) {
      // API: nhận Bearer token ở header, hoặc phiên đăng nhập (giao diện gọi fetch cùng trang).
      // Không nhận ?token= trên URL vì mật khẩu sẽ lọt vào log của proxy.
      const authHeader = c.req.header("authorization") ?? "";
      const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const apiToken = config.API_TOKEN || config.ADMIN_PASSWORD;
      const ok = (bearer && passwordsMatch(bearer, apiToken)) || sessionValid(getCookie(c, COOKIE), config.ADMIN_PASSWORD);
      if (!ok) return c.json({ ok: false, error: "Unauthorized" }, 401);
      return next();
    }
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
    const activeConfig = getRuntimeConfig(config, store);
    const cloudMentions = store.listMentionsForCloud(week, topic || undefined);
    const wordCloud = extractWordCloud(cloudMentions);
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
        hasToken: Boolean(activeConfig.X_BEARER_TOKEN.trim() || (activeConfig.TWITTER_AUTH_TOKEN.trim() && activeConfig.TWITTER_CT0.trim())),
        xNotice: (() => {
          const hasBearer = Boolean(activeConfig.X_BEARER_TOKEN.trim());
          const hasAuth = Boolean(activeConfig.TWITTER_AUTH_TOKEN.trim());
          const hasCt0 = Boolean(activeConfig.TWITTER_CT0.trim());
          if (hasBearer) return "";
          if (hasAuth && hasCt0) return xRouteWarning(store.getXRoute());
          if (hasAuth && !hasCt0) return 'Đã có Cookie auth_token nhưng còn thiếu ct0 (CSRF token) của X. X yêu cầu cả 2 để quét bài viết. Vào mục <a href="/settings">Cài đặt</a> để thêm.';
          if (!hasAuth && hasCt0) return 'Đã có Cookie ct0 nhưng còn thiếu auth_token của X. Vào mục <a href="/settings">Cài đặt</a> để thêm.';
          return 'Chưa có cấu hình X (auth_token & ct0). Vào mục <a href="/settings">Cài đặt</a> để thêm.';
        })(),
        hasFacebook: Boolean(activeConfig.FACEBOOK_ACCESS_TOKEN.trim() || activeConfig.FACEBOOK_COOKIE.trim()),
        hasThreads: Boolean(activeConfig.THREADS_ACCESS_TOKEN.trim()),
        hasYoutube: Boolean(activeConfig.YOUTUBE_API_KEY.trim()),
        notice,
        stats: store.stats(since),
        days: series.map((row) => ({ day: row.day, count: row.posts })),
        alerts: store.listAlerts(),
        hits: store.listOpenHits(),
        voices: store.topVoices(week),
        muted: store.listMuted(),
        queueNew: store.countNew(),
        lexicon: store.listLexicon(),
        outbound: outboundLabel(activeConfig),
        notifyError,
        spike: spikeReason(series, today),
        wordCloud,
        adminOpen: c.req.query("admin") === "1" || c.req.query("admin") === "open",
      }),
    );
  });

  app.get("/settings", (c) => {
    const activeConfig = getRuntimeConfig(config, store);
    const notice = c.req.query("notice") ?? "";
    return c.html(settingsPage(activeConfig, notice, { unreadableSecrets: [...store.unreadableSecrets], xRoute: store.getXRoute() }));
  });

  app.post("/settings", async (c) => {
    const body = await c.req.parseBody();
    // Khóa bí mật không được in lại ra trang, nên ô trống nghĩa là giữ nguyên giá trị cũ.
    // Muốn xóa thì tích ô clear_<KEY>.
    for (const key of SECRET_SETTINGS) {
      const value = String(body[key] ?? "").trim();
      if (body[`clear_${key}`] === "1") store.setSetting(key, "");
      else if (value) store.setSetting(key, value);
    }
    for (const key of ["LLM_BASE_URL", "LLM_MODEL"]) {
      if (body[key] !== undefined) store.setSetting(key, String(body[key] ?? "").trim());
    }

    store.setSetting("DESKTOP_NOTIFY", body.DESKTOP_NOTIFY === "1" ? "1" : "0");
    if (body.LISTEN_INTERVAL_MINUTES) {
      store.setSetting("LISTEN_INTERVAL_MINUTES", String(body.LISTEN_INTERVAL_MINUTES));
    }
    if (body.SEARCH_MAX_RESULTS) {
      store.setSetting("SEARCH_MAX_RESULTS", String(body.SEARCH_MAX_RESULTS));
    }

    return c.redirect("/settings?notice=" + encodeURIComponent("Đã lưu cài đặt và áp dụng ngay lập tức!"));
  });

  app.get("/brief", async (c) => {
    const activeConfig = getRuntimeConfig(config, store);
    const notice = c.req.query("notice") ?? "";
    const brief = await todayBrief(store, activeConfig);
    return c.html(briefPage(brief, notice));
  });

  app.post("/brief/send-webhook", async (c) => {
    const activeConfig = getRuntimeConfig(config, store);
    if (!activeConfig.ALERT_WEBHOOK_URL.trim()) {
      return c.redirect("/brief?notice=" + encodeURIComponent("Chưa cấu hình ALERT_WEBHOOK_URL"));
    }
    const brief = await todayBrief(store, activeConfig);
    const err = await deliverExecutiveReport(brief, activeConfig.ALERT_WEBHOOK_URL);
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

  app.get("/hashtags", (c) => {
    const daysParam = Number(c.req.query("days"));
    const days = [1, 7, 30].includes(daysParam) ? daysParam : 7;
    const topic = c.req.query("topic") ?? "";
    const notice = c.req.query("notice") ?? "";
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const mentions = store.listMentionsForHashtags(since, topic || undefined);
    const analytics = analyzeHashtags(mentions, 50);

    return c.html(
      hashtagsPage({
        analytics,
        days,
        activeTopic: topic,
        topics: store.listTopics(),
        notice,
      }),
    );
  });

  app.get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const notice = c.req.query("notice") ?? "";
    const rawChannels = c.req.queries("channel") ?? [];
    const validChannels = ["web", "x", "facebook", "threads", "youtube"];
    const channels = rawChannels.filter((ch) => validChannels.includes(ch));
    const activeChannels = channels.length > 0 ? channels : validChannels;

    const runtimeCfg = getRuntimeConfig(config, store);

    let result = undefined;
    let searchNotice = notice;
    if (q) {
      const outcome = await liveSearchCache.get(LiveSearchCache.key(q, activeChannels), () =>
        searchLiveMentions(q, activeChannels, runtimeCfg),
      );
      if ("retryAfterSec" in outcome) {
        searchNotice = `Đang tra cứu quá nhanh, các nền tảng có thể chặn máy chủ. Thử lại sau ${outcome.retryAfterSec} giây.`;
      } else {
        result = outcome.value;
        if (outcome.cached && !searchNotice) searchNotice = "Kết quả lấy từ bộ nhớ đệm (dưới 5 phút).";
      }
    }

    return c.html(
      searchPage({
        query: q,
        selectedChannels: activeChannels,
        result,
        notice: searchNotice,
      }),
    );
  });

  app.post("/topics", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim().slice(0, 80);
    const rawQuery = String(body.query ?? "");
    const source = ["facebook", "threads", "youtube", "web"].includes(body.source as string)
      ? (body.source as "facebook" | "threads" | "youtube" | "web")
      : "x";
    const phrase = String(body.phrase ?? "").trim().slice(0, 80);
    const exclude = body.exclude_reposts === "on" || body.exclude_reposts === "true";
    if (!name) return c.redirect("/?notice=" + encodeURIComponent("Thiếu tên nguồn theo dõi."));
    let query = rawQuery.replace(/\s+/g, " ").trim();
    if (!query) {
      return c.redirect("/?notice=" + encodeURIComponent("Câu truy vấn, từ khóa hoặc link không được để trống."));
    }

    if (source === "facebook") {
      const page = pageKey(query);
      if (page) {
        query = page;
      }
    } else if (source === "threads") {
      const user = threadsUserKey(query);
      if (user) {
        query = user;
      }
    } else if (source === "x") {
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
    return c.redirect("/?notice=" + encodeURIComponent(`Đã thêm nguồn theo dõi “${name}”.`));
  });

  app.post("/topics/:id/toggle", (c) => {
    const topic = store.getTopic(c.req.param("id"));
    if (topic) store.setTopicActive(topic.id, topic.active !== 1);
    return c.redirect("/");
  });

  app.post("/topics/:id/backfill", async (c) => {
    const id = c.req.param("id");
    if (!safeKey(id) || !store.getTopic(id)) return c.redirect(deskPath("", "wire", "Không tìm thấy nguồn theo dõi này."));
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const report = await runListen({ onlyTopicId: id, startTime: start });
    const notice = [`Ghi nhận ${report.saved} bài trong 7 ngày qua.`, ...report.errors].filter(Boolean).join(" ");
    return c.redirect(deskPath("", "wire", notice));
  });

  app.post("/topics/:id/delete", (c) => {
    store.deleteTopic(c.req.param("id"));
    return c.redirect("/?notice=" + encodeURIComponent("Đã xóa nguồn theo dõi."));
  });

  app.post("/listen", async (c) => {
    const report = await runListen();
    const notice = report.errors.length
      ? `Ghi nhận ${report.saved} bài từ ${report.topics} nguồn theo dõi. ${report.errors.join(" ")}`
      : `Đã quét ${report.topics} nguồn theo dõi, ghi nhận ${report.saved} bài viết mới.`;
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

  app.post("/mentions/auto-classify", async (c) => {
    const body = await c.req.parseBody();
    const topic = String(body.topic ?? "").trim();
    const unclassified = store.listUnclassifiedMentions(120, topic || undefined);

    let count = 0;
    for (const m of unclassified) {
      const routing = classifyMentionRuleBased(m.text);
      if (store.autoClassifyMention(m.topic_id, m.id, { tag: routing.tag, assignedTo: routing.assignedTo })) {
        count++;
      }
    }

    const back = await backFrom(c);
    const msg = count > 0
      ? `⚡ Đã phân loại & điều phối thành công ${count} bài viết.`
      : "Không có bài viết nào cần phân loại thêm.";
    return c.redirect(deskPath(back.topic, back.view, msg, back));
  });

  app.post("/mentions/:topicId/:mentionId/auto-classify", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const activeConfig = getRuntimeConfig(config, store);
    const mention = store.getMention(topicId, mentionId);

    if (safeKey(topicId) && safeKey(mentionId) && mention) {
      const routing = await classifyMentionWithAi(mention.text, {
        apiKey: activeConfig.LLM_API_KEY,
        baseUrl: activeConfig.LLM_BASE_URL,
        model: activeConfig.LLM_MODEL,
      });
      store.autoClassifyMention(topicId, mentionId, { tag: routing.tag, assignedTo: routing.assignedTo });
      const back = await backFrom(c);
      return c.redirect(
        deskPath(back.topic, back.view, `⚡ Đã gắn #${routing.tag} & gán ${routing.assignedTo} (${routing.reason}).`, back),
      );
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

function isLoopbackOrPrivate(address: string): boolean {
  const a = address.replace(/^::ffff:/, "");
  return (
    a === "::1" ||
    a.startsWith("127.") ||
    a.startsWith("10.") ||
    a.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a) ||
    a.startsWith("fc") ||
    a.startsWith("fd")
  );
}

/**
 * Địa chỉ người gọi để chặn dò mật khẩu. Chỉ tin header x-forwarded-for khi kết nối đến từ
 * proxy trên máy hoặc mạng nội bộ (Caddy, Docker); gọi thẳng từ Internet thì dùng địa chỉ thật,
 * để không thể né giới hạn bằng cách tự đặt header.
 */
export function clientIp(c: Context): string {
  let remote = "";
  try {
    remote = getConnInfo(c).remote.address ?? "";
  } catch {
    remote = "";
  }
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded && (!remote || isLoopbackOrPrivate(remote))) return forwarded;
  return remote || "local";
}

function requestIsHttps(c: Context): boolean {
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  return new URL(c.req.url).protocol === "https:";
}
