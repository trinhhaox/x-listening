import assert from "node:assert/strict";
import test from "node:test";
import { createApp, getRuntimeConfig } from "../src/app.js";
import { issueSession } from "../src/auth.js";
import type { AppConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { hasSomethingToListen, startListenLoop } from "../src/scheduler.js";

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    HOST: "127.0.0.1",
    PORT: 3021,
    DATABASE_PATH: ":memory:",
    ADMIN_PASSWORD: "mat-khau-dai",
    X_BEARER_TOKEN: "",
    TWITTER_AUTH_TOKEN: "",
    TWITTER_CT0: "",
    FACEBOOK_ACCESS_TOKEN: "",
    FACEBOOK_COOKIE: "",
    THREADS_ACCESS_TOKEN: "",
    YOUTUBE_API_KEY: "",
    LISTEN_INTERVAL_MINUTES: 15,
    SEARCH_MAX_RESULTS: 10,
    ALERT_WEBHOOK_URL: "",
    DESKTOP_NOTIFY: "0",
    LLM_API_KEY: "",
    LLM_BASE_URL: "https://api.openai.com/v1",
    LLM_MODEL: "gpt-4o-mini",
    ...overrides,
  };
}

test("mọi đường /api/* đều cần đăng nhập; nhận Bearer hoặc phiên, không nhận ?token=", async () => {
  const store = Store.open(":memory:");
  const config = testConfig();
  const { app } = createApp(config, store);

  for (const path of ["/api/wordcloud", "/api/hashtags?days=7"]) {
    assert.equal((await app.request(path)).status, 401, path);
    assert.equal((await app.request(`${path}${path.includes("?") ? "&" : "?"}token=mat-khau-dai`)).status, 401, path);
    const bearer = await app.request(path, { headers: { authorization: "Bearer mat-khau-dai" } });
    assert.equal(bearer.status, 200, path);
    const session = await app.request(path, { headers: { cookie: `xl_session=${issueSession(config.ADMIN_PASSWORD)}` } });
    assert.equal(session.status, 200, path);
  }

  const wrong = await app.request("/api/wordcloud", { headers: { authorization: "Bearer sai-mat-khau" } });
  assert.equal(wrong.status, 401);

  const viaQuery = await app.request("/api/mentions?token=mat-khau-dai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topicId: "t1", text: "x", authorUsername: "u" }),
  });
  assert.equal(viaQuery.status, 401);
  store.close();
});

test("lưu cài đặt: ô khóa bí mật để trống thì giữ nguyên, tích Xóa thì xóa", async () => {
  const store = Store.open(":memory:");
  const config = testConfig();
  const { app } = createApp(config, store);
  const cookie = `xl_session=${issueSession(config.ADMIN_PASSWORD)}`;
  store.setSetting("TWITTER_AUTH_TOKEN", "cu_auth");
  store.setSetting("LLM_API_KEY", "sk-cu");

  const post = (fields: Record<string, string>) =>
    app.request("/settings", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });

  // Trình duyệt gửi ô trống cho mọi khóa vì trang không in lại giá trị.
  assert.equal((await post({ TWITTER_AUTH_TOKEN: "", LLM_API_KEY: "", TWITTER_CT0: "ct0-moi" })).status, 302);
  assert.equal(store.getSetting("TWITTER_AUTH_TOKEN"), "cu_auth");
  assert.equal(store.getSetting("LLM_API_KEY"), "sk-cu");
  assert.equal(store.getSetting("TWITTER_CT0"), "ct0-moi");

  await post({ TWITTER_AUTH_TOKEN: "", clear_TWITTER_AUTH_TOKEN: "1", LLM_API_KEY: "sk-moi" });
  assert.equal(store.getSetting("TWITTER_AUTH_TOKEN"), "");
  assert.equal(store.getSetting("LLM_API_KEY"), "sk-moi");
  assert.equal(getRuntimeConfig(config, store).TWITTER_AUTH_TOKEN, "");

  const html = await (await app.request("/settings", { headers: { cookie } })).text();
  assert.doesNotMatch(html, /sk-moi|ct0-moi/);
  assert.match(html, /name="clear_LLM_API_KEY"/);
  store.close();
});

test("giới hạn đăng nhập sai không né được bằng cách đổi x-forwarded-for khi gọi thẳng", async () => {
  const store = Store.open(":memory:");
  const { app } = createApp(testConfig(), store);
  // Mô phỏng kết nối thẳng từ Internet (không qua proxy nội bộ).
  const env = { incoming: { socket: { remoteAddress: "203.0.113.9", remotePort: 5000, remoteFamily: "IPv4" } } };
  let last = 0;
  for (let i = 0; i < 9; i++) {
    const res = await app.request(
      "/login",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `198.51.100.${i}` },
        body: "password=sai-mat-khau-1",
      },
      env,
    );
    last = res.status;
  }
  assert.equal(last, 429);
  store.close();
});

test("cookie phiên bật Secure khi đi qua HTTPS", async () => {
  const store = Store.open(":memory:");
  const { app } = createApp(testConfig(), store);
  const res = await app.request("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-proto": "https" },
    body: "password=mat-khau-dai",
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("set-cookie") ?? "", /Secure/);
  store.close();
});

test("lịch nghe chạy cả khi chỉ có tần số báo chí", () => {
  const store = Store.open(":memory:");
  const config = testConfig();
  assert.equal(hasSomethingToListen(config, store), false);
  store.insertTopic({ id: "w1", name: "Báo", query: "cà phê", excludeReposts: false, createdAt: new Date().toISOString(), source: "web" });
  assert.equal(hasSomethingToListen(config, store), true);
  assert.equal(hasSomethingToListen(testConfig({ YOUTUBE_API_KEY: "k" }), Store.open(":memory:")), true);
  store.close();
});

test("lịch nghe đọc lại chu kỳ mỗi lượt", async () => {
  const delays: number[] = [];
  const pending: Array<() => void> = [];
  let minutes = 15;
  let ticks = 0;
  const loop = startListenLoop({
    intervalMinutes: () => minutes,
    tick: async () => {
      ticks++;
    },
    setTimer: (fn, ms) => {
      delays.push(ms);
      pending.push(fn);
      return {};
    },
  });
  assert.deepEqual(delays, [15 * 60_000]);
  minutes = 30; // người dùng đổi trong Cài đặt
  pending.shift()!();
  await new Promise((r) => setImmediate(r));
  assert.equal(ticks, 1);
  assert.deepEqual(delays, [15 * 60_000, 30 * 60_000]);
  minutes = 1; // dưới mức tối thiểu thì kẹp về 5 phút
  pending.shift()!();
  await new Promise((r) => setImmediate(r));
  assert.equal(delays.at(-1), 5 * 60_000);
  loop.stop();
});
