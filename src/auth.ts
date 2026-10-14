import { createHmac, timingSafeEqual } from "node:crypto";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function issueSession(password: string, now = Date.now()): string {
  const exp = String(now + WEEK_MS);
  const sig = createHmac("sha256", password).update(exp).digest("base64url");
  return `${exp}.${sig}`;
}

export function sessionValid(token: string | undefined, password: string, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < now) return false;
  const expected = createHmac("sha256", password).update(exp).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
