import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createApp, getRuntimeConfig } from "../src/app.js";
import { issueSession } from "../src/auth.js";
import type { AppConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { xRouteWarning } from "../src/pages.js";
import { LiveSearchCache } from "../src/search_cache.js";
import { SettingsCipher } from "../src/secrets.js";
import { searchXWithCookie } from "../src/xcookie.js";
import { stableId } from "../src/social_search.js";

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
    DAILY_REPORT_TIME: "",
    RETENTION_DAYS: 0,
    LLM_API_KEY: "",
    LLM_BASE_URL: "https://api.openai.com/v1",
    LLM_MODEL: "gpt-4o-mini",
    ...overrides,
  };
}

function rawSetting(path: string, key: string): string | undefined {
  const db = new DatabaseSync(path);
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  db.close();
  return row?.value;
}

test("khóa bí mật được mã hóa trong DB, giá trị chữ thường cũ được mã hóa lại khi mở", () => {
  const dir = mkdtempSync(join(tmpdir(), "xl-"));
  const path = join(dir, "t.db");
  try {
    // DB cũ: lưu chữ thường.
    const legacy = Store.open(path);
    legacy.setSetting("TWITTER_AUTH_TOKEN", "auth-bi-mat");
    legacy.setSetting("LLM_MODEL", "gpt-4o-mini");
    legacy.close();
    assert.equal(rawSetting(path, "TWITTER_AUTH_TOKEN"), "auth-bi-mat");

    const store = Store.open(path);
    store.useSettingsCipher(new SettingsCipher("khoa-ma-hoa-rat-dai"));
    store.setSetting("LLM_API_KEY", "sk-bi-mat");
    assert.equal(store.getSetting("TWITTER_AUTH_TOKEN"), "auth-bi-mat");
    assert.equal(store.getAllSettings().LLM_API_KEY, "sk-bi-mat");
    store.close();

    const raw = rawSetting(path, "TWITTER_AUTH_TOKEN") ?? "";
    assert.match(raw, /^enc:v1:/);
    assert.doesNotMatch(raw, /auth-bi-mat/);
    assert.match(rawSetting(path, "LLM_API_KEY") ?? "", /^enc:v1:/);
    assert.equal(rawSetting(path, "LLM_MODEL"), "gpt-4o-mini"); // không phải khóa bí mật

    // Sai khóa: không giải mã được, rơi về giá trị trong .env và báo cho người vận hành.
    const wrong = Store.open(path);
    wrong.useSettingsCipher(new SettingsCipher("khoa-khac-hoan-toan"));
    assert.deepEqual([...wrong.unreadableSecrets].sort(), ["LLM_API_KEY", "TWITTER_AUTH_TOKEN"]);
    const runtime = getRuntimeConfig(testConfig({ TWITTER_AUTH_TOKEN: "tu-env" }), wrong);
    assert.equal(runtime.TWITTER_AUTH_TOKEN, "tu-env");
    // Nhập lại thì hết báo lỗi.
    wrong.setSetting("TWITTER_AUTH_TOKEN", "moi");
    assert.equal(wrong.unreadableSecrets.has("TWITTER_AUTH_TOKEN"), false);
    assert.equal(wrong.getSetting("TWITTER_AUTH_TOKEN"), "moi");
    wrong.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("API_TOKEN riêng: khi đã đặt, API không nhận mật khẩu admin nữa", async () => {
  const store = Store.open(":memory:");
  const config = testConfig({ API_TOKEN: "token-api-rieng-1234" });
  const { app } = createApp(config, store);
  const call = (auth: string) => app.request("/api/wordcloud", { headers: { authorization: `Bearer ${auth}` } });
  assert.equal((await call("token-api-rieng-1234")).status, 200);
  assert.equal((await call("mat-khau-dai")).status, 401);
  // Giao diện (phiên đăng nhập) vẫn gọi được.
  const viaSession = await app.request("/api/wordcloud", { headers: { cookie: `xl_session=${issueSession("mat-khau-dai")}` } });
  assert.equal(viaSession.status, 200);
  store.close();

  assert.throws(() => loadConfig({ ADMIN_PASSWORD: "mat-khau-dai", API_TOKEN: "ngan" }), /API_TOKEN/);
  assert.equal(loadConfig({ ADMIN_PASSWORD: "mat-khau-dai", API_TOKEN: "" }).API_TOKEN, "");
});

test("mã bài ổn định và không lưu trùng cùng một đường link", () => {
  assert.equal(stableId("web-", "https://a.vn/1"), stableId("web-", "https://a.vn/1"));
  assert.notEqual(stableId("web-", "https://a.vn/1"), stableId("web-", "https://a.vn/2"));
  assert.match(stableId("web-", "x"), /^web-[0-9a-f]{16}$/);

  const store = Store.open(":memory:");
  store.insertTopic({ id: "w", name: "Báo", query: "q", excludeReposts: false, createdAt: new Date().toISOString(), source: "web" });
  const base = {
    topicId: "w",
    text: "Tin",
    authorUsername: "bao",
    authorName: "Báo",
    createdAt: new Date().toISOString(),
    lang: "vi",
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    quoteCount: 0,
    url: "https://a.vn/1",
  };
  const now = new Date().toISOString();
  assert.equal(store.insertMention({ ...base, id: "web-mabamcu" }, now), true);
  assert.equal(store.insertMention({ ...base, id: stableId("web-", base.url) }, now), false);
  store.close();
});

test("ghi nhận đường lấy tin X và cảnh báo khi phải dùng chỉ mục web", async () => {
  const routes: string[] = [];
  const emptyX = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("bing.com")) {
      return new Response(
        `<rss><channel><item><title>Bài</title><link>https://x.com/abc/status/1234567890</link><description>Nội dung</description></item></channel></rss>`,
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  await searchXWithCookie({ authToken: "a", ct0: "c", query: "cà phê", fetchImpl: emptyX, onRoute: (r) => routes.push(r) });
  assert.deepEqual(routes, ["web-index"]);

  const store = Store.open(":memory:");
  store.setXRoute("web-index", true, "2026-11-06T08:00:00.000Z");
  const warning = xRouteWarning(store.getXRoute());
  assert.match(warning, /Bing\/DuckDuckGo/);
  assert.equal(xRouteWarning({ route: "direct", cookieConfigured: true, at: "2026-11-06T08:00:00.000Z" }), "");
  assert.equal(xRouteWarning({ route: "web-index", cookieConfigured: false, at: "2026-11-06T08:00:00.000Z" }), "");

  // Trang Cài đặt hiện cảnh báo.
  const { app } = createApp(testConfig(), store);
  const html = await (await app.request("/settings", { headers: { cookie: `xl_session=${issueSession("mat-khau-dai")}` } })).text();
  assert.match(html, /lấy tạm qua chỉ mục Bing\/DuckDuckGo/);
  store.close();
});

test("bộ nhớ đệm tra cứu: trả lại kết quả cũ, gộp yêu cầu trùng, chặn khi gọi quá nhanh", async () => {
  let clock = 0;
  let loads = 0;
  const cache = new LiveSearchCache<string>({ ttlMs: 1000, maxEntries: 2, maxCallsPerMinute: 2, now: () => clock });
  const load = async () => {
    loads++;
    return `kq${loads}`;
  };
  const k = LiveSearchCache.key("  Cà  Phê ", ["x", "web"]);
  assert.equal(k, LiveSearchCache.key("cà phê", ["web", "x"]));

  const [a, b] = await Promise.all([cache.get(k, load), cache.get(k, load)]);
  assert.equal(loads, 1);
  assert.deepEqual(a, { value: "kq1", cached: false });
  assert.deepEqual(b, { value: "kq1", cached: true });

  clock = 2000; // hết hạn
  assert.deepEqual(await cache.get(k, load), { value: "kq2", cached: false });
  const limited = await cache.get("khac", load);
  assert.ok("retryAfterSec" in limited);
  assert.equal(loads, 2);

  clock = 61_000;
  assert.deepEqual(await cache.get("khac", load), { value: "kq3", cached: false });
});
