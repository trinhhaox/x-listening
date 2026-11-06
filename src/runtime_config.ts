import type { AppConfig } from "./config.js";
import { Store } from "./db.js";

export function getRuntimeConfig(base: AppConfig, store: Store): AppConfig {
  const dbSettings = store.getAllSettings();
  return {
    ...base,
    X_BEARER_TOKEN: dbSettings.X_BEARER_TOKEN ?? base.X_BEARER_TOKEN,
    TWITTER_AUTH_TOKEN: dbSettings.TWITTER_AUTH_TOKEN ?? base.TWITTER_AUTH_TOKEN,
    TWITTER_CT0: dbSettings.TWITTER_CT0 ?? base.TWITTER_CT0,
    FACEBOOK_ACCESS_TOKEN: dbSettings.FACEBOOK_ACCESS_TOKEN ?? base.FACEBOOK_ACCESS_TOKEN,
    FACEBOOK_COOKIE: dbSettings.FACEBOOK_COOKIE ?? base.FACEBOOK_COOKIE,
    THREADS_ACCESS_TOKEN: dbSettings.THREADS_ACCESS_TOKEN ?? base.THREADS_ACCESS_TOKEN,
    YOUTUBE_API_KEY: dbSettings.YOUTUBE_API_KEY ?? base.YOUTUBE_API_KEY,
    LLM_API_KEY: dbSettings.LLM_API_KEY ?? base.LLM_API_KEY,
    LLM_BASE_URL: dbSettings.LLM_BASE_URL ?? base.LLM_BASE_URL,
    LLM_MODEL: dbSettings.LLM_MODEL ?? base.LLM_MODEL,
    ALERT_WEBHOOK_URL: dbSettings.ALERT_WEBHOOK_URL ?? base.ALERT_WEBHOOK_URL,
    DESKTOP_NOTIFY: dbSettings.DESKTOP_NOTIFY === "0" || dbSettings.DESKTOP_NOTIFY === "1" ? dbSettings.DESKTOP_NOTIFY : base.DESKTOP_NOTIFY,
    LISTEN_INTERVAL_MINUTES: Number(dbSettings.LISTEN_INTERVAL_MINUTES) || base.LISTEN_INTERVAL_MINUTES,
    DAILY_REPORT_TIME: dbSettings.DAILY_REPORT_TIME ?? base.DAILY_REPORT_TIME,
    AI_SENTIMENT: dbSettings.AI_SENTIMENT === "0" || dbSettings.AI_SENTIMENT === "1" ? dbSettings.AI_SENTIMENT : base.AI_SENTIMENT,
    RETENTION_DAYS: dbSettings.RETENTION_DAYS !== undefined && dbSettings.RETENTION_DAYS !== "" ? Number(dbSettings.RETENTION_DAYS) || 0 : base.RETENTION_DAYS,
    SEARCH_MAX_RESULTS: Number(dbSettings.SEARCH_MAX_RESULTS) || base.SEARCH_MAX_RESULTS,
  };
}
