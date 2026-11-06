import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";

export const COOKIE = "xl_session";

export const attempts = new Map<string, { count: number; resetAt: number }>();

export function passwordsMatch(input: string, expected: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function isLoopbackOrPrivate(address: string): boolean {
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

export function requestIsHttps(c: Context): boolean {
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  return new URL(c.req.url).protocol === "https:";
}
