import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Store } from "./db.js";

const config = loadConfig();
const store = Store.open(config.DATABASE_PATH);
const { app, runListen } = createApp(config, store);

const timer = setInterval(() => {
  const hasAnyAuth = Boolean(
    config.X_BEARER_TOKEN.trim() ||
      (config.TWITTER_AUTH_TOKEN.trim() && config.TWITTER_CT0.trim()) ||
      config.FACEBOOK_ACCESS_TOKEN.trim() ||
      config.FACEBOOK_COOKIE.trim() ||
      config.THREADS_ACCESS_TOKEN.trim() ||
      config.YOUTUBE_API_KEY.trim(),
  );
  if (!hasAnyAuth) return;
  runListen()
    .then((report) => {
      if (report.saved || report.errors.length) {
        console.log(`[listen] ghi ${report.saved} bài; lỗi ${report.errors.length}`);
      }
    })
    .catch((error: unknown) => {
      console.error("[listen]", error instanceof Error ? error.message : error);
    });
}, config.LISTEN_INTERVAL_MINUTES * 60 * 1000);
timer.unref?.();

serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
  console.log(`X Listening đang mở tại http://${info.address}:${info.port}`);
});
