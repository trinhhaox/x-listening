import { z } from "zod";

const schema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3021),
  DATABASE_PATH: z.string().min(1).default("./data/listening.db"),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD cần ít nhất 8 ký tự"),
  X_BEARER_TOKEN: z.string().optional().default(""),
  LISTEN_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(15),
  SEARCH_MAX_RESULTS: z.coerce.number().int().min(10).max(100).default(20),
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
