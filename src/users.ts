import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Tài khoản và phân quyền.
 * - admin  (Quản trị): mọi việc, kể cả Cấu hình, nguồn theo dõi, chuông, tài khoản.
 * - editor (Xử lý):   xử lý bài (đọc/xong, gán, ghi chú, nhãn, soạn trả lời), quét tin, làm báo cáo.
 * - viewer (Chỉ xem): xem và xuất dữ liệu, không thay đổi gì.
 */
export const ROLES = ["admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Quản trị",
  editor: "Xử lý",
  viewer: "Chỉ xem",
};

export const ROLE_HINTS: Record<Role, string> = {
  admin: "Toàn quyền: cấu hình, nguồn theo dõi, chuông, mẫu câu, tài khoản.",
  editor: "Xử lý bài: đánh dấu đọc/xong, gán người, ghi chú, soạn trả lời, quét tin, làm báo cáo.",
  viewer: "Chỉ xem và xuất dữ liệu, không sửa được gì.",
};

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function roleAtLeast(role: Role, needed: Role): boolean {
  return RANK[role] >= RANK[needed];
}

/** Người đang đăng nhập. `id = "owner"` là chủ hệ thống, vào bằng mật khẩu quản trị trong .env. */
export type Viewer = { id: string; name: string; phone: string; role: Role };

export const OWNER: Viewer = { id: "owner", name: "Chủ hệ thống", phone: "", role: "admin" };

const viewerStore = new AsyncLocalStorage<{ viewer: Viewer; team: () => string[] }>();

/** Chạy phần còn lại của yêu cầu dưới tên người này; `team` cho tên các thành viên để gợi ý khi gán bài. */
export function runAsViewer<T>(viewer: Viewer, fn: () => T, team: () => string[] = () => []): T {
  let cached: string[] | undefined;
  return viewerStore.run({ viewer, team: () => (cached ??= team()) }, fn);
}

/** Người đang xem trang hiện tại (dùng trong view để ẩn nút không có quyền). */
export function currentViewer(): Viewer | undefined {
  return viewerStore.getStore()?.viewer;
}

/** Tên các tài khoản đang dùng, để gợi ý ô “Gán người”. */
export function teamNames(): string[] {
  return viewerStore.getStore()?.team() ?? [];
}

export function can(needed: Role): boolean {
  const viewer = currentViewer();
  return viewer ? roleAtLeast(viewer.role, needed) : true;
}

/**
 * Chuẩn hóa số điện thoại Việt Nam về dạng 0xxxxxxxxx.
 * Nhận "0912 345 678", "+84912345678", "84-912-345-678". Sai định dạng thì trả "".
 */
export function normalizePhone(input: string): string {
  let digits = String(input ?? "").replace(/[\s.\-()]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return "";
  if (digits.startsWith("84") && digits.length >= 11) digits = "0" + digits.slice(2);
  if (!digits.startsWith("0")) digits = "0" + digits;
  return /^0\d{9,10}$/.test(digits) ? digits : "";
}

export function formatPhone(phone: string): string {
  return phone.length === 10 ? `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}` : phone;
}

export const MIN_PASSWORD = 8;

export function passwordProblem(password: string): string {
  if (password.length < MIN_PASSWORD) return `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.`;
  if (password.length > 200) return "Mật khẩu quá dài.";
  return "";
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltText, hashText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = scryptSync(password, Buffer.from(saltText, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Băm giả để thời gian trả lời khi sai số điện thoại giống như khi sai mật khẩu. */
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));
export function burnPasswordCheck(password: string): void {
  verifyPassword(password, DUMMY_HASH);
}

/** Đường dẫn ai cũng vào được khi đã đăng nhập, kể cả vai trò Chỉ xem. */
const ANY_ROLE_POSTS = ["/logout", "/account/password"];

/** Thao tác chỉ Quản trị được làm. */
const ADMIN_POST_PREFIXES = [
  "/settings",
  "/sentiment/ai-run",
  "/users",
  "/topics",
  "/lexicon",
  "/samples",
  "/mutes",
  "/templates",
  "/brief/send-webhook",
  "/api/reports/send",
];
const ADMIN_PAGES = ["/settings", "/users"];

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

/** Vai trò tối thiểu cho một yêu cầu. GET/HEAD là xem; còn lại là thay đổi. */
export function requiredRole(method: string, path: string): Role {
  const reading = method === "GET" || method === "HEAD";
  if (reading) return ADMIN_PAGES.some((p) => underPrefix(path, p)) ? "admin" : "viewer";
  if (ANY_ROLE_POSTS.includes(path)) return "viewer";
  if (path === "/alerts/hits" || path.startsWith("/alerts/hits/")) return "editor";
  if (underPrefix(path, "/alerts")) return "admin";
  if (ADMIN_POST_PREFIXES.some((p) => underPrefix(path, p))) return "admin";
  return "editor";
}
