import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { issueSession, issueUserSession, readSession } from "../auth.js";
import { accountPage, forbiddenPage, loginPage } from "../views/login.js";
import { COOKIE, attempts, passwordsMatch, clientIp, requestIsHttps } from "../http/security.js";
import type { AppContext } from "../http/context.js";
import type { Store } from "../db.js";
import {
  OWNER,
  ROLE_LABELS,
  burnPasswordCheck,
  hashPassword,
  normalizePhone,
  passwordProblem,
  requiredRole,
  roleAtLeast,
  runAsViewer,
  verifyPassword,
  type Viewer,
} from "../users.js";

const WEEK_S = 7 * 24 * 60 * 60;

/** Người đứng sau cookie phiên; null khi chưa đăng nhập, hết hạn, bị khóa hoặc phiên đã bị thu hồi. */
export function viewerFromCookie(token: string | undefined, secret: string, store: Store): Viewer | null {
  const claim = readSession(token, secret);
  if (!claim) return null;
  if (claim.kind === "owner") return OWNER;
  const user = store.getUser(claim.id);
  if (!user || !user.active || user.session_version !== claim.version) return null;
  return { id: user.id, name: user.name, phone: user.phone, role: user.role };
}

function setSessionCookie(c: Context, value: string): void {
  setCookie(c, COOKIE, value, { httpOnly: true, sameSite: "Lax", secure: requestIsHttps(c), path: "/", maxAge: WEEK_S });
}

/** Đăng nhập, đăng xuất, đổi mật khẩu của mình và lớp kiểm tra phiên + quyền cho mọi route phía sau. */
export function registerAuthRoutes(app: Hono, ctx: AppContext): void {
  const { config, store } = ctx;
  const secret = config.ADMIN_PASSWORD;

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/login", (c) => {
    if (viewerFromCookie(getCookie(c, COOKIE), secret, store)) return c.redirect("/");
    return c.html(loginPage());
  });

  app.post("/login", async (c) => {
    const ip = clientIp(c);
    const gate = attempts.get(ip);
    const now = Date.now();
    if (gate && gate.resetAt > now && gate.count >= 8) {
      return c.html(loginPage("Sai quá nhiều lần. Thử lại sau một phút."), 429);
    }
    const body = await c.req.parseBody();
    const phoneInput = String(body.phone ?? "").trim();
    const password = String(body.password ?? "");
    const fail = (message: string) => {
      const next = !gate || gate.resetAt <= now ? { count: 1, resetAt: now + 60_000 } : { count: gate.count + 1, resetAt: gate.resetAt };
      attempts.set(ip, next);
      return c.html(loginPage(message, phoneInput), 401);
    };

    if (!phoneInput) {
      // Không nhập số điện thoại: đăng nhập chủ hệ thống bằng mật khẩu quản trị trong .env.
      if (!passwordsMatch(password, secret)) return fail("Mật khẩu quản trị chưa đúng. Tài khoản thường cần nhập số điện thoại.");
      attempts.delete(ip);
      setSessionCookie(c, issueSession(secret));
      return c.redirect("/");
    }

    const phone = normalizePhone(phoneInput);
    const user = phone ? store.getUserByPhone(phone) : undefined;
    if (!user) {
      burnPasswordCheck(password);
      return fail("Số điện thoại hoặc mật khẩu chưa đúng.");
    }
    if (!verifyPassword(password, user.password_hash)) return fail("Số điện thoại hoặc mật khẩu chưa đúng.");
    if (!user.active) return fail("Tài khoản này đang bị khóa. Hãy liên hệ người quản trị.");
    attempts.delete(ip);
    store.touchUserLogin(user.id, new Date().toISOString());
    setSessionCookie(c, issueUserSession(user.id, user.session_version, secret));
    return c.redirect("/");
  });

  app.use("*", async (c, next) => {
    if (c.req.path === "/login" || c.req.path === "/health") return next();
    let viewer: Viewer | null = null;
    if (c.req.path.startsWith("/api/")) {
      // API: nhận Bearer token ở header (quyền Quản trị), hoặc phiên đăng nhập (giao diện gọi fetch cùng trang).
      // Không nhận ?token= trên URL vì mật khẩu sẽ lọt vào log của proxy.
      const authHeader = c.req.header("authorization") ?? "";
      const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const apiToken = config.API_TOKEN || config.ADMIN_PASSWORD;
      viewer = bearer && passwordsMatch(bearer, apiToken) ? { ...OWNER, name: "API" } : viewerFromCookie(getCookie(c, COOKIE), secret, store);
      if (!viewer) return c.json({ ok: false, error: "Unauthorized" }, 401);
    } else {
      viewer = viewerFromCookie(getCookie(c, COOKIE), secret, store);
      if (!viewer) {
        deleteCookie(c, COOKIE, { path: "/" });
        if (c.req.path.startsWith("/export")) return c.text("Cần đăng nhập", 401);
        return c.redirect("/login");
      }
    }
    const needed = requiredRole(c.req.method, c.req.path);
    if (!roleAtLeast(viewer.role, needed)) {
      const message = `Tài khoản ${ROLE_LABELS[viewer.role]} không được làm việc này (cần quyền ${ROLE_LABELS[needed]}).`;
      if (c.req.path.startsWith("/api/")) return c.json({ ok: false, error: message }, 403);
      return runAsViewer(viewer, () => c.html(forbiddenPage(message), 403));
    }
    const current = viewer;
    const team = () => store.listUsers().filter((u) => u.active).map((u) => u.name);
    return runAsViewer(current, () => next(), team);
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.redirect("/login");
  });

  app.get("/account", (c) => c.html(accountPage(c.req.query("notice") ?? "", store.listUsers())));

  app.post("/account/password", async (c) => {
    const viewer = viewerFromCookie(getCookie(c, COOKIE), secret, store);
    if (!viewer || viewer.id === OWNER.id) {
      return c.redirect("/account?notice=" + encodeURIComponent("Mật khẩu quản trị được đặt trong file .env trên máy chủ."));
    }
    const user = store.getUser(viewer.id);
    const body = await c.req.parseBody();
    const current = String(body.current ?? "");
    const next = String(body.password ?? "");
    const confirm = String(body.confirm ?? "");
    if (!user || !verifyPassword(current, user.password_hash)) {
      return c.redirect("/account?notice=" + encodeURIComponent("Mật khẩu hiện tại chưa đúng."));
    }
    const problem = passwordProblem(next) || (next !== confirm ? "Hai lần nhập mật khẩu mới chưa khớp." : "");
    if (problem) return c.redirect("/account?notice=" + encodeURIComponent(problem));
    store.setUserPassword(user.id, hashPassword(next));
    // Đổi mật khẩu làm phiên cũ hết hạn; cấp phiên mới cho chính trình duyệt này.
    setSessionCookie(c, issueUserSession(user.id, store.getUser(user.id)!.session_version, secret));
    return c.redirect("/account?notice=" + encodeURIComponent("Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất."));
  });
}
