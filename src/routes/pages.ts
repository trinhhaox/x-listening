import type { Hono } from "hono";
import { SECRET_SETTINGS } from "../secrets.js";
import { deliverExecutiveReport } from "../notify.js";
import { extractWordCloud } from "../cloud.js";
import { analyzeHashtags } from "../hashtags.js";
import { searchLiveMentions } from "../social_search.js";
import { LiveSearchCache } from "../search_cache.js";
import { buckets, briefMarkdown, dayStartIso, daysEnding, localDay, spikeReason } from "../digest.js";
import { xRouteWarning, briefPage, comparePage, dashboardPage, hashtagsPage, mentionsCsv, searchPage, settingsPage } from "../pages.js";
import { outboundLabel, todayBrief, readView } from "../http/helpers.js";
import { getRuntimeConfig } from "../runtime_config.js";
import { lastReportResult, normalizeReportTime } from "../daily.js";
import type { AppContext } from "../http/context.js";

/** Các trang HTML: tổng quan, cấu hình, báo cáo, so sánh, xuất CSV, xu hướng, tra cứu. */
export function registerPagesRoutes(app: Hono, ctx: AppContext): void {
  const { config, store, liveSearchCache } = ctx;

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
        notifyError: ctx.notifyError(),
        spike: spikeReason(series, today),
        wordCloud,
        adminOpen: c.req.query("admin") === "1" || c.req.query("admin") === "open",
      }),
    );
  });

  app.get("/settings", (c) => {
    const activeConfig = getRuntimeConfig(config, store);
    const notice = c.req.query("notice") ?? "";
    return c.html(settingsPage(activeConfig, notice, { unreadableSecrets: [...store.unreadableSecrets], xRoute: store.getXRoute(), lastReport: lastReportResult(store) }));
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
    if (body.DAILY_REPORT_TIME !== undefined) {
      store.setSetting("DAILY_REPORT_TIME", normalizeReportTime(String(body.DAILY_REPORT_TIME ?? "")));
    }
    if (body.RETENTION_DAYS !== undefined) {
      const days = Math.max(0, Math.min(3650, Math.floor(Number(body.RETENTION_DAYS) || 0)));
      store.setSetting("RETENTION_DAYS", String(days > 0 ? Math.max(7, days) : 0));
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

}
