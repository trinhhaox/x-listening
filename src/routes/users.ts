import type { Hono } from "hono";
import type { AppContext } from "../http/context.js";
import { usersPage } from "../views/users.js";
import { currentViewer, formatPhone, hashPassword, isRole, normalizePhone, passwordProblem } from "../users.js";

/** Quản lý tài khoản (chỉ Quản trị; quyền được kiểm ở lớp đăng nhập). */
export function registerUsersRoutes(app: Hono, ctx: AppContext): void {
  const { store } = ctx;
  const resolveBack = (c: { req: { query: (k: string) => string | undefined } }, bodyBack?: unknown) => {
    const raw = String(bodyBack ?? c.req.query("back") ?? "/users").trim();
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/users";
  };
  const makeBack = (base: string, notice: string) => `${base}${base.includes("?") ? "&" : "?"}notice=${encodeURIComponent(notice)}`;
  const cleanName = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

  app.get("/users", (c) => c.html(usersPage(store.listUsers(), c.req.query("notice") ?? "")));

  app.post("/users", async (c) => {
    const body = await c.req.parseBody();
    const backTarget = resolveBack(c, body.back);
    const back = (notice: string) => makeBack(backTarget, notice);
    const name = cleanName(body.name);
    const phone = normalizePhone(String(body.phone ?? ""));
    const password = String(body.password ?? "");
    const role = isRole(body.role) ? body.role : "viewer";
    if (!name) return c.redirect(back("Cần nhập họ tên."));
    if (!phone) return c.redirect(back("Số điện thoại chưa đúng (cần 10–11 số, VD 0912345678)."));
    const problem = passwordProblem(password);
    if (problem) return c.redirect(back(problem));
    if (store.getUserByPhone(phone)) return c.redirect(back(`Số ${formatPhone(phone)} đã có tài khoản.`));
    store.insertUser({ phone, name, role, passwordHash: hashPassword(password), at: new Date().toISOString() });
    return c.redirect(back(`Đã thêm tài khoản nhân viên ${name} (${formatPhone(phone)}) thành công.`));
  });

  app.post("/users/:id", async (c) => {
    const body = await c.req.parseBody();
    const backTarget = resolveBack(c, body.back);
    const back = (notice: string) => makeBack(backTarget, notice);
    const user = store.getUser(c.req.param("id"));
    if (!user) return c.redirect(back("Không tìm thấy tài khoản."));
    const self = currentViewer()?.id === user.id;
    const name = cleanName(body.name) || user.name;
    const phone = body.phone === undefined ? user.phone : normalizePhone(String(body.phone));
    if (!phone) return c.redirect(back("Số điện thoại chưa đúng."));
    const owner = store.getUserByPhone(phone);
    if (owner && owner.id !== user.id) return c.redirect(back(`Số ${formatPhone(phone)} đã thuộc tài khoản khác.`));
    // Không tự hạ quyền hay tự khóa mình, để không lỡ tay mất quyền quản trị.
    const role = self ? user.role : isRole(body.role) ? body.role : user.role;
    const active = self ? true : body.active === "1";
    store.updateUser(user.id, { name, phone, role, active });
    return c.redirect(back(`Đã lưu thay đổi cho nhân viên ${name}.`));
  });

  app.post("/users/:id/password", async (c) => {
    const body = await c.req.parseBody();
    const backTarget = resolveBack(c, body.back);
    const back = (notice: string) => makeBack(backTarget, notice);
    const user = store.getUser(c.req.param("id"));
    if (!user) return c.redirect(back("Không tìm thấy tài khoản."));
    const password = String(body.password ?? "");
    const problem = passwordProblem(password);
    if (problem) return c.redirect(back(problem));
    store.setUserPassword(user.id, hashPassword(password));
    return c.redirect(back(`Đã đặt mật khẩu mới cho ${user.name}; các phiên cũ của họ đã bị đăng xuất.`));
  });

  app.post("/users/:id/delete", async (c) => {
    const body = await c.req.parseBody().catch(() => ({}));
    const backTarget = resolveBack(c, (body as Record<string, unknown>).back);
    const back = (notice: string) => makeBack(backTarget, notice);
    const user = store.getUser(c.req.param("id"));
    if (!user) return c.redirect(back("Không tìm thấy tài khoản."));
    if (currentViewer()?.id === user.id) return c.redirect(back("Không tự xóa tài khoản đang dùng."));
    store.deleteUser(user.id);
    return c.redirect(back(`Đã xóa tài khoản ${user.name}.`));
  });
}
