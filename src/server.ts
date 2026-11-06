import { serve } from "@hono/node-server";
import { createApp, getRuntimeConfig } from "./app.js";
import { loadConfig } from "./config.js";
import { Store } from "./db.js";
import { hasSomethingToListen, startListenLoop } from "./scheduler.js";
import { SettingsCipher } from "./secrets.js";

const config = loadConfig();
const store = Store.open(config.DATABASE_PATH);
if (store.migration.from !== store.migration.to) {
  console.log(
    `[db] cập nhật cấu trúc v${store.migration.from} → v${store.migration.to}` +
      (store.migration.backup ? `; bản sao lưu: ${store.migration.backup}` : ""),
  );
}
store.useSettingsCipher(new SettingsCipher(config.SECRETS_KEY || config.ADMIN_PASSWORD));
if (store.unreadableSecrets.size > 0) {
  console.warn(
    `[settings] Không giải mã được: ${[...store.unreadableSecrets].join(", ")}. ` +
      "Có thể SECRETS_KEY hoặc ADMIN_PASSWORD đã đổi; hãy nhập lại trong trang Cài đặt.",
  );
}
const { app, runListen } = createApp(config, store);

startListenLoop({
  intervalMinutes: () => getRuntimeConfig(config, store).LISTEN_INTERVAL_MINUTES,
  tick: async () => {
    if (!hasSomethingToListen(getRuntimeConfig(config, store), store)) return;
    try {
      const report = await runListen();
      if (report.saved || report.errors.length) {
        console.log(`[listen] ghi ${report.saved} bài; lỗi ${report.errors.length}`);
      }
    } catch (error: unknown) {
      console.error("[listen]", error instanceof Error ? error.message : error);
    }
  },
});

serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
  console.log(`X Listening đang mở tại http://${info.address}:${info.port}`);
});
