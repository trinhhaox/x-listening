import { z } from "zod";

const schema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3021),
  DATABASE_PATH: z.string().min(1).default("./data/listening.db"),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD cần ít nhất 8 ký tự"),
  // Token riêng cho /api/*. Chưa đặt thì API dùng ADMIN_PASSWORD như trước.
  API_TOKEN: z.string().min(16, "API_TOKEN cần ít nhất 16 ký tự").optional().or(z.literal("")),
  // Khóa mã hóa cookie/token lưu trong DB. Chưa đặt thì dẫn xuất từ ADMIN_PASSWORD.
  SECRETS_KEY: z.string().min(16, "SECRETS_KEY cần ít nhất 16 ký tự").optional().or(z.literal("")),
  X_BEARER_TOKEN: z.string().optional().default(""),
  TWITTER_AUTH_TOKEN: z.string().optional().default(""),
  TWITTER_CT0: z.string().optional().default(""),
  FACEBOOK_ACCESS_TOKEN: z.string().optional().default(""),
  FACEBOOK_COOKIE: z.string().optional().default(""),
  THREADS_ACCESS_TOKEN: z.string().optional().default(""),
  YOUTUBE_API_KEY: z.string().optional().default(""),
  LISTEN_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(15),
  SEARCH_MAX_RESULTS: z.coerce.number().int().min(10).max(100).default(20),
  ALERT_WEBHOOK_URL: z.string().optional().default(""),
  DESKTOP_NOTIFY: z.enum(["0", "1"]).optional().default("1"),
  LLM_API_KEY: z.string().optional().default(""),
  LLM_BASE_URL: z.string().optional().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().optional().default("gpt-4o-mini"),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Cấu hình không hợp lệ:\n${message}`);
  }
  return parsed.data;
}
