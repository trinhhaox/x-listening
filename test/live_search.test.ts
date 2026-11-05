import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchLiveMentions } from "../src/social_search.js";
import { searchPage } from "../src/pages.js";
import type { AppConfig } from "../src/config.js";

const mockConfig: AppConfig = {
  HOST: "127.0.0.1",
  PORT: 3021,
  DATABASE_PATH: ":memory:",
  ADMIN_PASSWORD: "test-admin-password-123",
  TWITTER_AUTH_TOKEN: "",
  TWITTER_CT0: "",
  X_BEARER_TOKEN: "",
  FACEBOOK_COOKIE: "",
  FACEBOOK_ACCESS_TOKEN: "",
  THREADS_ACCESS_TOKEN: "",
  YOUTUBE_API_KEY: "",
  LLM_API_KEY: "",
  LLM_BASE_URL: "",
  LLM_MODEL: "",
  ALERT_WEBHOOK_URL: "",
  DESKTOP_NOTIFY: "0",
  LISTEN_INTERVAL_MINUTES: 15,
  SEARCH_MAX_RESULTS: 10,
};

describe("Live Discovery Search", () => {
  it("trả về kết quả rỗng khi query rỗng", async () => {
    const res = await searchLiveMentions("   ", ["web"], mockConfig);
    assert.equal(res.items.length, 0);
    assert.equal(res.counts.total, 0);
  });

  it("gọi cào song song và phân tích sắc thái cảm xúc đúng", async () => {
    // Mock fetch trả về RSS giả lập cho kênh web
    const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News</title>
    <item>
      <title>Sản phẩm cực kỳ tuyệt vời và chất lượng rất tốt</title>
      <link>https://vnexpress.net/san-pham-tot-12345.html</link>
      <pubDate>Thu, 05 Nov 2026 12:00:00 GMT</pubDate>
      <source url="https://vnexpress.net">VnExpress</source>
    </item>
    <item>
      <title>Thất vọng vì dịch vụ tệ hại và lừa đảo khách hàng</title>
      <link>https://tuoitre.vn/lua-dao-67890.html</link>
      <pubDate>Thu, 05 Nov 2026 13:00:00 GMT</pubDate>
      <source url="https://tuoitre.vn">Tuổi Trẻ</source>
    </item>
  </channel>
</rss>`;

    const mockFetch = (async () => {
      return new Response(mockRss, { status: 200, headers: { "Content-Type": "application/xml" } });
    }) as unknown as typeof fetch;

    const res = await searchLiveMentions("san pham", ["web"], mockConfig, mockFetch);
    assert.equal(res.items.length, 2);
    assert.equal(res.counts.total, 2);
    assert.equal(res.counts.positive, 1);
    assert.equal(res.counts.negative, 1);
    assert.equal(res.items.find((i) => i.sentiment === "positive")?.sentiment, "positive");
    assert.equal(res.items.find((i) => i.sentiment === "negative")?.sentiment, "negative");
  });

  it("searchPage render form tra cứu và các thẻ bài viết HeroUI", () => {
    const html = searchPage({
      query: "rueco",
      selectedChannels: ["x", "web"],
      result: {
        query: "rueco",
        channels: ["x", "web"],
        items: [
          {
            id: "test-1",
            source: "web",
            author_name: "VnExpress",
            author_username: "vnexpress",
            text: "Thương hiệu mỹ phẩm Rueco ra mắt dòng sản phẩm mới rất tuyệt vời",
            url: "https://vnexpress.net/rueco",
            created_at: new Date().toISOString(),
            like_count: 10,
            reply_count: 2,
            repost_count: 0,
            sentiment: "positive",
          },
        ],
        counts: { total: 1, positive: 1, negative: 0, neutral: 0 },
        errors: [],
      },
    });

    assert.ok(html.includes("Tra cứu Nhanh Đa Kênh Tức thời"));
    assert.ok(html.includes('value="rueco"'));
    assert.ok(html.includes("Thương hiệu mỹ phẩm Rueco"));
    assert.ok(html.includes("Tích cực"));
  });

  it("Route GET /search phản hồi 200 cho người dùng đăng nhập", async () => {
    const { createApp } = await import("../src/app.js");
    const { Store } = await import("../src/db.js");
    const { issueSession } = await import("../src/auth.js");

    const store = Store.open(":memory:");
    const { app } = createApp(mockConfig, store);
    const session = issueSession(mockConfig.ADMIN_PASSWORD);

    const res = await app.request("/search", {
      headers: {
        cookie: `xl_session=${session}`,
      },
    });

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Tra cứu Nhanh Đa Kênh Tức thời"));
    assert.ok(html.includes("Sẵn sàng quét tìm kiếm thời gian thực"));
  });
});
