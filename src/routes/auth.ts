import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { issueSession, sessionValid } from "../auth.js";
import { loginPage } from "../pages.js";
import { COOKIE, attempts, passwordsMatch, clientIp, requestIsHttps } from "../http/security.js";
import type { AppContext } from "../http/context.js";

/** Đăng nhập, đăng xuất và lớp kiểm tra phiên cho mọi route phía sau. */
export function registerAuthRoutes(app: Hono, ctx: AppContext): void {
  const { config } = ctx;

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
}
