import { createHmac, timingSafeEqual } from "node:crypto";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function sameSig(given: string, expected: string): boolean {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Phiên của chủ hệ thống (đăng nhập bằng mật khẩu quản trị trong .env): `<hết hạn>.<chữ ký>`. */
export function issueSession(password: string, now = Date.now()): string {
  const exp = String(now + WEEK_MS);
  return `${exp}.${sign(password, exp)}`;
}

/**
 * Phiên của một tài khoản: `u.<id>.<phiên bản>.<hết hạn>.<chữ ký>`.
 * Phiên bản tăng khi đổi mật khẩu, hạ quyền hoặc khóa tài khoản, nên phiên cũ hết hiệu lực ngay.
 */
export function issueUserSession(userId: string, version: number, secret: string, now = Date.now()): string {
  const payload = `u.${userId}.${version}.${now + WEEK_MS}`;
  return `${payload}.${sign(secret, payload)}`;
}

export type SessionClaim = { kind: "owner" } | { kind: "user"; id: string; version: number };

export function readSession(token: string | undefined, secret: string, now = Date.now()): SessionClaim | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length === 2) {
    const [exp, sig] = parts as [string, string];
    if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
    return sameSig(sig, sign(secret, exp)) ? { kind: "owner" } : null;
  }
  if (parts.length === 5 && parts[0] === "u") {
    const [, id, version, exp, sig] = parts as [string, string, string, string, string];
    if (!id || !/^\d+$/.test(version) || !/^\d+$/.test(exp) || Number(exp) < now) return null;
    if (!sameSig(sig, sign(secret, `u.${id}.${version}.${exp}`))) return null;
    return { kind: "user", id, version: Number(version) };
  }
  return null;
}

/** Giữ cho mã cũ: đúng khi là phiên chủ hệ thống còn hạn. */
export function sessionValid(token: string | undefined, password: string, now = Date.now()): boolean {
  return readSession(token, password, now)?.kind === "owner";
}
