// Lắp ráp ứng dụng. Route nằm trong src/routes/, tiện ích HTTP trong src/http/.
export { getRuntimeConfig } from "./runtime_config.js";
export { clientIp } from "./http/security.js";
import { Hono } from "hono";
import type { AppConfig } from "./config.js";
import { Store } from "./db.js";
import { listenOnce, type ListenReport } from "./listen.js";
import { deliverHit } from "./notify.js";
import { aiSentimentEnabled, checkSourceHealth, runAiSentiment } from "./enrich.js";
import { searchLiveMentions } from "./social_search.js";
import { LiveSearchCache } from "./search_cache.js";
import { getRuntimeConfig } from "./runtime_config.js";
import type { AppContext } from "./http/context.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerPagesRoutes } from "./routes/pages.js";
import { registerActionsRoutes } from "./routes/actions.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerUsersRoutes } from "./routes/users.js";

export function createApp(config: AppConfig, store: Store) {
  const app = new Hono();
  let listening = false;
  const liveSearchCache = new LiveSearchCache<Awaited<ReturnType<typeof searchLiveMentions>>>({
    ttlMs: 5 * 60_000,
    maxEntries: 50,
    maxCallsPerMinute: 10,
  });
  let notifyError = "";

  async function runListen(extra?: { onlyTopicId?: string; startTime?: string }): Promise<ListenReport> {
    if (listening) return { saved: 0, topics: 0, errors: ["Đang nghe một lượt khác."] };
    listening = true;
    try {
      const activeConfig = getRuntimeConfig(config, store);
      const report = await listenOnce(store, {
        token: activeConfig.X_BEARER_TOKEN,
        twitterAuthToken: activeConfig.TWITTER_AUTH_TOKEN,
        twitterCt0: activeConfig.TWITTER_CT0,
        facebookToken: activeConfig.FACEBOOK_ACCESS_TOKEN,
        facebookCookie: activeConfig.FACEBOOK_COOKIE,
        threadsToken: activeConfig.THREADS_ACCESS_TOKEN,
        youtubeApiKey: activeConfig.YOUTUBE_API_KEY,
        maxResults: activeConfig.SEARCH_MAX_RESULTS,
        onlyTopicId: extra?.onlyTopicId,
        startTime: extra?.startTime,
      });
      // AI chấm cảm xúc trước khi gửi chuông, để chuông “nghiêng xấu” dựa trên kết quả AI.
      const latest = getRuntimeConfig(config, store);
      if (aiSentimentEnabled(latest)) await runAiSentiment(store, latest).catch(() => undefined);
      await fanOutHits();
      await checkSourceHealth(store, latest).catch(() => undefined);
      return report;
    } finally {
      listening = false;
    }
  }

  async function fanOutHits(): Promise<void> {
    const activeConfig = getRuntimeConfig(config, store);
    const hits = store.listPendingNotices();
    const done: string[] = [];
    for (const hit of hits) {
      try {
        const error = await deliverHit(hit, {
          webhookUrl: activeConfig.ALERT_WEBHOOK_URL,
          desktop: activeConfig.DESKTOP_NOTIFY === "1",
        });
        if (error) notifyError = error;
        else done.push(hit.id);
      } catch (error) {
        notifyError = error instanceof Error ? error.message : "Không gửi được chuông ra ngoài.";
      }
    }
    if (done.length > 0) {
      store.markNotified(done);
      if (done.length === hits.length) notifyError = "";
    }
  }

  const ctx: AppContext = {
    config,
    store,
    runListen,
    fanOutHits,
    notifyError: () => notifyError,
    liveSearchCache,
  };
  registerAuthRoutes(app, ctx);
  registerPagesRoutes(app, ctx);
  registerActionsRoutes(app, ctx);
  registerApiRoutes(app, ctx);
  registerUsersRoutes(app, ctx);

  return { app, runListen };
}
