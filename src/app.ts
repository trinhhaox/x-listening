import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { issueSession, sessionValid } from "./auth.js";
import type { AppConfig } from "./config.js";
import { Store } from "./db.js";
import { listenOnce, type ListenReport } from "./listen.js";
import { buildSearchQuery } from "./query.js";
import { dashboardPage, loginPage, mentionsCsv } from "./pages.js";

const COOKIE = "xl_session";
const attempts = new Map<string, { count: number; resetAt: number }>();

export function createApp(config: AppConfig, store: Store) {
  const app = new Hono();
  let listening = false;

  async function runListen(): Promise<ListenReport> {
    if (listening) return { saved: 0, topics: 0, errors: ["Đang nghe một lượt khác."] };
    listening = true;
    try {
      return await listenOnce(store, { token: config.X_BEARER_TOKEN, maxResults: config.SEARCH_MAX_RESULTS });
    } finally {
      listening = false;
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
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return c.html(
      dashboardPage({
        topics: store.listTopics(),
        mentions: store.listMentions(topic || undefined),
        activeTopic: topic,
        hasToken: Boolean(config.X_BEARER_TOKEN.trim()),
        notice,
        stats: store.stats(since),
        days: store.volumeByDay(7),
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
    const query = String(body.query ?? "");
    const exclude = body.exclude_reposts === "on" || body.exclude_reposts === "true";
    if (!name) return c.redirect("/?notice=" + encodeURIComponent("Thiếu tên tần số."));
    try {
      buildSearchQuery(query, exclude);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Câu truy vấn không dùng được";
      return c.redirect("/?notice=" + encodeURIComponent(message));
    }
    store.insertTopic({
      id: randomUUID(),
      name,
      query: query.replace(/\s+/g, " ").trim(),
      excludeReposts: exclude,
      createdAt: new Date().toISOString(),
    });
    return c.redirect("/?notice=" + encodeURIComponent(`Đã thêm tần số “${name}”.`));
  });

  app.post("/topics/:id/toggle", (c) => {
    const topic = store.getTopic(c.req.param("id"));
    if (topic) store.setTopicActive(topic.id, topic.active !== 1);
    return c.redirect("/");
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

  app.post("/samples", (c) => {
    const count = store.seedSamples();
    return c.redirect("/?notice=" + encodeURIComponent(`Đã nạp ${count} tin mẫu.`));
  });

  app.post("/samples/clear", (c) => {
    const count = store.clearSamples();
    return c.redirect("/?notice=" + encodeURIComponent(`Đã xóa ${count} tin mẫu.`));
  });

  return { app, runListen };
}

function passwordsMatch(input: string, expected: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
