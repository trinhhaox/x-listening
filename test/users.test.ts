import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { issueSession, issueUserSession, readSession } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { attempts } from "../src/http/security.js";
import { hashPassword, normalizePhone, requiredRole, verifyPassword } from "../src/users.js";

const SECRET = "mat-khau-dai";

function setup() {
  attempts.clear();
  const store = Store.open(":memory:");
  const config = loadConfig({ ADMIN_PASSWORD: SECRET, DATABASE_PATH: ":memory:" } as NodeJS.ProcessEnv);
  const { app } = createApp(config, store);
  store.insertTopic({ id: "t1", name: "Rươi Co", query: "rươi", excludeReposts: true, createdAt: "2026-01-01T00:00:00Z" });
  const now = new Date().toISOString();
  store.insertMention(
    { id: "m1", topicId: "t1", text: "giao chậm quá", authorUsername: "lan", authorName: "Lan", createdAt: now, lang: "vi", likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 },
    now,
  );
  const add = (phone: string, name: string, role: "admin" | "editor" | "viewer") =>
    store.insertUser({ phone, name, role, passwordHash: hashPassword("matkhau123"), at: now });
  return { store, app, add };
}

const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;
const post = (cookie: string, fields: Record<string, string> = {}) => ({
  method: "POST",
  headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

test("số điện thoại: chuẩn hóa +84, khoảng trắng; băm mật khẩu kiểm lại được", () => {
  assert.equal(normalizePhone("0912 345 678"), "0912345678");
  assert.equal(normalizePhone("+84 912-345-678"), "0912345678");
  assert.equal(normalizePhone("84912345678"), "0912345678");
  assert.equal(normalizePhone("912345678"), "0912345678");
  assert.equal(normalizePhone("12345"), "");
  assert.equal(normalizePhone("abc0912345678"), "");
  const hash = hashPassword("matkhau123");
  assert.ok(verifyPassword("matkhau123", hash));
  assert.ok(!verifyPassword("matkhau124", hash));
  assert.notEqual(hash, hashPassword("matkhau123"));
});

test("bảng quyền theo vai trò", () => {
  assert.equal(requiredRole("GET", "/"), "viewer");
  assert.equal(requiredRole("GET", "/settings"), "admin");
  assert.equal(requiredRole("GET", "/users"), "admin");
  assert.equal(requiredRole("POST", "/mentions/t1/m1/queue"), "editor");
  assert.equal(requiredRole("POST", "/alerts/hits/abc/seen"), "editor");
  assert.equal(requiredRole("POST", "/alerts"), "admin");
  assert.equal(requiredRole("POST", "/topics/t1/delete"), "admin");
  assert.equal(requiredRole("POST", "/topicsx"), "editor");
  assert.equal(requiredRole("POST", "/logout"), "viewer");
  assert.equal(requiredRole("POST", "/account/password"), "viewer");
});

test("đăng nhập bằng số điện thoại; sai mật khẩu, tài khoản khóa thì từ chối", async () => {
  const { app, add, store } = setup();
  const lan = add("0912345678", "Lan", "editor");

  const bad = await app.request("/login", post("", { phone: "0912345678", password: "saimatkhau" }));
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /Số điện thoại hoặc mật khẩu chưa đúng/);

  const ok = await app.request("/login", post("", { phone: "+84 912 345 678", password: "matkhau123" }));
  assert.equal(ok.status, 302);
  const cookie = cookieOf(ok);
  assert.match(cookie, /^xl_session=u\./);
  const home = await app.request("/", { headers: { cookie } });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /data-role="editor"/);
  assert.match(html, /Lan/);
  assert.doesNotMatch(html, /class="nav-item [^"]*" href="\/settings"/);
  assert.ok(store.getUser(lan.id)!.last_login_at);

  store.updateUser(lan.id, { active: false });
  assert.equal((await app.request("/", { headers: { cookie } })).status, 302, "khóa tài khoản thì phiên cũ mất hiệu lực");
  const locked = await app.request("/login", post("", { phone: "0912345678", password: "matkhau123" }));
  assert.match(await locked.text(), /đang bị khóa/);

  // Không nhập số: mật khẩu quản trị như trước.
  const owner = await app.request("/login", post("", { password: SECRET }));
  assert.equal(owner.status, 302);
  assert.equal(readSession(cookieOf(owner).slice("xl_session=".length), SECRET)?.kind, "owner");
});

test("phân quyền: Chỉ xem không sửa được, Xử lý không vào được Cấu hình, Quản trị thêm được người", async () => {
  const { app, add, store } = setup();
  const viewer = add("0900000001", "Minh", "viewer");
  const editor = add("0900000002", "Hà", "editor");
  const admin = add("0900000003", "Tuấn", "admin");
  const c = (u: typeof viewer) => `xl_session=${issueUserSession(u.id, u.session_version, SECRET)}`;

  const viewQueue = await app.request("/mentions/t1/m1/queue", post(c(viewer), { queue: "done" }));
  assert.equal(viewQueue.status, 403);
  assert.equal(store.getMention("t1", "m1")!.queue, "new");
  assert.equal((await app.request("/brief", { headers: { cookie: c(viewer) } })).status, 200);
  assert.equal((await app.request("/api/wordcloud", { headers: { cookie: c(viewer) } })).status, 200);

  store.setMentionAssignee("t1", "m1", "");
  const editQueue = await app.request("/mentions/t1/m1/queue", post(c(editor), { queue: "reading" }));
  assert.equal(editQueue.status, 302);
  const m = store.getMention("t1", "m1")!;
  assert.equal(m.queue, "reading");
  assert.equal(m.assigned_to, "Hà", "bài chưa ai nhận thì gán cho người bấm đọc");
  assert.equal((await app.request("/settings", { headers: { cookie: c(editor) } })).status, 403);
  assert.equal((await app.request("/topics/t1/delete", post(c(editor)))).status, 403);
  assert.ok(store.listTopics().length === 1);
  assert.equal((await app.request("/users", post(c(editor), { name: "X", phone: "0911111111", password: "12345678", role: "admin" }))).status, 403);

  const created = await app.request("/users", post(c(admin), { name: "Ngọc", phone: "0911 111 111", password: "matkhaungoc", role: "viewer" }));
  assert.equal(created.status, 302);
  const ngoc = store.getUserByPhone("0911111111")!;
  assert.equal(ngoc.role, "viewer");
  const dup = await app.request("/users", post(c(admin), { name: "Trùng", phone: "0911111111", password: "matkhaungoc", role: "viewer" }));
  assert.match(decodeURIComponent(dup.headers.get("location")!), /đã có tài khoản/);

  // Nâng quyền thì phiên cũ phải đăng nhập lại để nhận vai trò mới.
  const before = `xl_session=${issueUserSession(ngoc.id, ngoc.session_version, SECRET)}`;
  await app.request(`/users/${ngoc.id}`, post(c(admin), { name: "Ngọc", phone: "0911111111", role: "editor", active: "1" }));
  assert.equal(store.getUser(ngoc.id)!.role, "editor");
  assert.equal((await app.request("/", { headers: { cookie: before } })).status, 302);

  // Quản trị không tự hạ quyền hay tự khóa mình.
  await app.request(`/users/${admin.id}`, post(c(admin), { name: "Tuấn", phone: "0900000003", role: "viewer" }));
  assert.equal(store.getUser(admin.id)!.role, "admin");
  assert.equal(store.getUser(admin.id)!.active, true);

  // Chủ hệ thống (mật khẩu .env) vẫn toàn quyền như trước.
  assert.equal((await app.request("/users", { headers: { cookie: `xl_session=${issueSession(SECRET)}` } })).status, 200);

  // Admin vào trang /account thấy khối Quản lý Nhân viên & Phân quyền và tạo user quay lại /account
  const accRes = await app.request("/account", { headers: { cookie: c(admin) } });
  assert.equal(accRes.status, 200);
  const accHtml = await accRes.text();
  assert.match(accHtml, /Quản lý Nhân viên & Phân quyền/);
  assert.match(accHtml, /Thêm tài khoản nhân viên mới/);
  assert.match(accHtml, /href="\/users"/);

  const createFromAcc = await app.request("/users", post(c(admin), {
    name: "Nhân viên Mới",
    phone: "0988 888 888",
    password: "matkhaumoi88",
    role: "editor",
    back: "/account",
  }));
  assert.equal(createFromAcc.status, 302);
  assert.match(createFromAcc.headers.get("location")!, /^\/account\?notice=/);
  assert.ok(store.getUserByPhone("0988888888"));
});

test("tự đổi mật khẩu: cần mật khẩu cũ, đổi xong thiết bị khác bị đăng xuất", async () => {
  const { app, add, store } = setup();
  const lan = add("0912345678", "Lan", "viewer");
  const old = `xl_session=${issueUserSession(lan.id, lan.session_version, SECRET)}`;
  const wrong = await app.request("/account/password", post(old, { current: "khongdung1", password: "matkhaumoi1", confirm: "matkhaumoi1" }));
  assert.match(decodeURIComponent(wrong.headers.get("location")!), /hiện tại chưa đúng/);
  const ok = await app.request("/account/password", post(old, { current: "matkhau123", password: "matkhaumoi1", confirm: "matkhaumoi1" }));
  const fresh = cookieOf(ok);
  assert.ok(verifyPassword("matkhaumoi1", store.getUser(lan.id)!.password_hash));
  assert.equal((await app.request("/", { headers: { cookie: old } })).status, 302);
  assert.equal((await app.request("/account", { headers: { cookie: fresh } })).status, 200);
});
