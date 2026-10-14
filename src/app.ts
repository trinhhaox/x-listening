import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { issueSession, sessionValid } from "./auth.js";
import type { AppConfig } from "./config.js";
import { muteKey, Store, type MentionView, type QueueState } from "./db.js";
import { pageKey } from "./facebook.js";
import { listenOnce, type ListenReport } from "./listen.js";
import { deliverHit } from "./notify.js";
import { buildSearchQuery } from "./query.js";
import { lexiconWord } from "./sentiment.js";
import { buckets, briefMarkdown, buildBrief, dayStartIso, daysEnding, localDay, spikeReason } from "./digest.js";
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
        facebookToken: config.FACEBOOK_ACCESS_TOKEN,
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
    if (c.req.path === "/login" || c.req.path === "/health") return next();
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
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const today = localDay(new Date());
    const series = buckets(store.listHeardSince(dayStartIso(daysEnding(today, 7)[0] ?? today)), daysEnding(today, 7), topic);
    return c.html(
      dashboardPage({
        topics: store.listTopics(),
        mentions: store.listMentions(topic || undefined, 80, view),
        activeTopic: topic,
        view,
        hasToken: Boolean(config.X_BEARER_TOKEN.trim()),
        hasFacebook: Boolean(config.FACEBOOK_ACCESS_TOKEN.trim()),
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

  app.get("/brief", (c) => c.html(briefPage(todayBrief(store))));

  app.get("/brief.md", (c) =>
    c.body(briefMarkdown(todayBrief(store)), 200, {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": "attachment; filename=ban-tin.md",
    }),
  );

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
    const csv = mentionsCsv(store.listMentions(topic || undefined, 1000));
    return c.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=x-listening.csv",
    });
  });

  app.post("/topics", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim().slice(0, 80);
    const rawQuery = String(body.query ?? "");
    const source = body.source === "facebook" ? "facebook" : "x";
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
      phrase: source === "facebook" ? phrase : "",
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
    const topicId = String(body.topic_id ?? "");
    if (!name) return c.redirect(deskPath("", "wire", "Thiếu tên chuông."));
    if (kind !== "negative" && kind !== "phrase" && kind !== "likes") {
      return c.redirect(deskPath("", "wire", "Kiểu chuông không dùng được."));
    }
    if (kind === "phrase" && !phrase) return c.redirect(deskPath("", "wire", "Chuông cụm từ cần một cụm."));
    if (kind === "likes" && (!Number.isInteger(minLikes) || minLikes < 1 || minLikes > 1_000_000)) {
      return c.redirect(deskPath("", "wire", "Số thích tối thiểu chưa hợp lệ."));
    }
    if (topicId && !store.getTopic(topicId)) return c.redirect(deskPath("", "wire", "Tần số của chuông không còn."));
    const found = store.insertAlert({
      id: randomUUID(),
      topicId: topicId || null,
      name,
      kind,
      phrase: kind === "phrase" ? phrase : "",
      minLikes: kind === "likes" ? minLikes : 0,
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
    return c.redirect(deskPath(String(body.topic ?? ""), readView(String(body.view ?? ""))));
  });

  app.post("/mutes", async (c) => {
    const body = await c.req.parseBody();
    const username = String(body.username ?? "");
    if (!muteKey(username) || !store.muteAuthor(username, new Date().toISOString())) {
      return c.redirect(deskPath(String(body.topic ?? ""), readView(String(body.view ?? "")), "Tên tài khoản không dùng được."));
    }
    return c.redirect(deskPath(String(body.topic ?? ""), readView(String(body.view ?? "")), `Đã tắt tiếng @${muteKey(username)}.`));
  });

  app.post("/mutes/:username/delete", async (c) => {
    store.unmuteAuthor(c.req.param("username"));
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, "Đã bỏ tắt tiếng."));
  });

  app.post("/mentions/:topicId/:mentionId/note", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const body = await c.req.parseBody();
    if (safeKey(topicId) && safeKey(mentionId)) {
      store.setMentionNote(topicId, mentionId, String(body.note ?? "").trim());
    }
    return c.redirect(deskPath(String(body.topic ?? ""), readView(String(body.view ?? ""))));
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

function todayBrief(store: Store) {
  const today = localDay(new Date());
  return buildBrief(today, store.listHeardSince(dayStartIso(today)), store.listFirstSeen());
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

function deskPath(topic: string, view: MentionView, notice?: string): string {
  const params = new URLSearchParams();
  if (topic) params.set("topic", topic);
  if (view !== "wire") params.set("view", view);
  if (notice) params.set("notice", notice);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

async function backFrom(c: { req: { parseBody: () => Promise<Record<string, unknown>> } }): Promise<{ topic: string; view: MentionView }> {
  const body = await c.req.parseBody();
  return { topic: String(body.topic ?? ""), view: readView(String(body.view ?? "")) };
}

function passwordsMatch(input: string, expected: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
