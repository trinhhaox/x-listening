import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/** Những cài đặt là khóa bí mật: được mã hóa khi lưu và không bao giờ in lại ra trang. */
export const SECRET_SETTINGS = [
  "TWITTER_AUTH_TOKEN",
  "TWITTER_CT0",
  "X_BEARER_TOKEN",
  "FACEBOOK_COOKIE",
  "FACEBOOK_ACCESS_TOKEN",
  "THREADS_ACCESS_TOKEN",
  "YOUTUBE_API_KEY",
  "LLM_API_KEY",
  "ALERT_WEBHOOK_URL",
] as const;

const SECRET_SET = new Set<string>(SECRET_SETTINGS);
const PREFIX = "enc:v1:";

export function isSecretSetting(key: string): boolean {
  return SECRET_SET.has(key);
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Mã hóa AES-256-GCM cho giá trị cài đặt. Khóa được dẫn xuất (scrypt) từ SECRETS_KEY,
 * hoặc ADMIN_PASSWORD khi chưa đặt SECRETS_KEY. File DB rò ra một mình không lộ cookie/token.
 */
export class SettingsCipher {
  private readonly key: Buffer;

  constructor(material: string) {
    if (material.length < 8) throw new Error("Khóa mã hóa cài đặt cần ít nhất 8 ký tự");
    this.key = scryptSync(material, "x-listening/settings/v1", 32);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, body]).toString("base64url");
  }

  /** Trả về undefined nếu không giải mã được (khóa đã đổi hoặc dữ liệu hỏng). */
  decrypt(value: string): string | undefined {
    if (!isEncrypted(value)) return value;
    try {
      const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const body = raw.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      return undefined;
    }
  }
}
