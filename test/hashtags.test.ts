import test from "node:test";
import assert from "node:assert/strict";
import { extractHashtags, analyzeHashtags } from "../src/hashtags.js";
import { searchWebNews, searchFacebookPublic, searchThreadsPublic } from "../src/social_search.js";
import { Store } from "../src/db.js";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

const config: AppConfig = {
  HOST: "127.0.0.1",
  PORT: 3000,
  DATABASE_PATH: ":memory:",
  LISTEN_INTERVAL_MINUTES: 10,
  X_BEARER_TOKEN: "",
  TWITTER_AUTH_TOKEN: "",
  TWITTER_CT0: "",
  FACEBOOK_ACCESS_TOKEN: "",
  FACEBOOK_COOKIE: "",
  THREADS_ACCESS_TOKEN: "",
  YOUTUBE_API_KEY: "",
  ADMIN_PASSWORD: "mat-khau-test",
  SEARCH_MAX_RESULTS: 10,
  LLM_API_KEY: "",
  LLM_BASE_URL: "https://api.openai.com/v1",
  LLM_MODEL: "gpt-4o-mini",
  ALERT_WEBHOOK_URL: "",
  DESKTOP_NOTIFY: "0",
};

test("extractHashtags trích xuất chính xác các hashtag tiếng Việt và tiếng Anh", () => {
  const text = "Sản phẩm của #Rueco dùng rất thích! Ủng hộ #mỹ_phẩm_sạch và #review_chân_thực #100đ";
  const tags = extractHashtags(text);

  assert.ok(tags.includes("rueco"));
  assert.ok(tags.includes("mỹ_phẩm_sạch"));
  assert.ok(tags.includes("review_chân_thực"));
  assert.ok(tags.includes("100đ"));
});

test("analyzeHashtags tính toán tỷ lệ cảm xúc, rủi ro cảnh báo và tổng tương tác", () => {
  const sampleMentions = [
    { text: "Dùng thử bộ sản phẩm #Rueco thấy da cải thiện hẳn", sentiment: "positive", like_count: 10, author_username: "user1" },
    { text: "Thất vọng về #Rueco, giao hàng chậm và thái độ phục vụ kém", sentiment: "negative", like_count: 5, author_username: "user2" },
    { text: "Săn sale #Rueco nhận quà khủng #khuyenmai", sentiment: "positive", like_count: 20, author_username: "user3" },
    { text: "Bị kích ứng khi dùng kem #Rueco, quá tệ", sentiment: "negative", like_count: 8, author_username: "user4" },
  ];

  const result = analyzeHashtags(sampleMentions);

  assert.equal(result.totalHashtagsCount, 2);
  assert.ok(result.topHashtag);
  assert.equal(result.topHashtag.tag, "#rueco");
  assert.equal(result.topHashtag.totalPosts, 4);
  assert.equal(result.topHashtag.positivePosts, 2);
  assert.equal(result.topHashtag.negativePosts, 2);
  assert.equal(result.topHashtag.posPct, 50);
  assert.equal(result.topHashtag.negPct, 50);
  // Do có 50% tiêu cực >= 30% -> trạng thái phải là warning
  assert.equal(result.topHashtag.sentimentStatus, "warning");
});

test("searchWebNews trích xuất tin tức báo chí theo từ khóa/hashtag từ RSS", async () => {
  const mockXml = `
    <rss version="2.0">
      <channel>
        <title>Google News</title>
        <item>
          <title>Thương hiệu Rueco ra mắt dòng sản phẩm mới - Báo VnExpress</title>
          <link>https://vnexpress.net/rueco-ra-mat-san-pham-123.html</link>
          <pubDate>Thu, 05 Nov 2026 10:00:00 GMT</pubDate>
          <source url="https://vnexpress.net">VnExpress</source>
        </item>
      </channel>
    </rss>
  `;

  const mockFetch: typeof fetch = async () =>
    new Response(mockXml, { status: 200, headers: { "content-type": "application/xml" } });

  const results = await searchWebNews("Rueco", 10, mockFetch);
  assert.equal(results.length, 1);
  assert.equal(results[0].authorName, "VnExpress");
  assert.ok(results[0].text.includes("Rueco"));
  assert.equal(results[0].source, "web");
});

test("Route GET /api/hashtags trả về JSON phân tích hashtag", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "top-1",
    name: "Mỹ phẩm",
    query: "mỹ phẩm",
    excludeReposts: false,
    createdAt: new Date().toISOString(),
  });

  store.insertMention(
    {
      id: "men-1",
      topicId: "top-1",
      text: "Đánh giá #Rueco chất lượng tốt",
      authorUsername: "tester",
      authorName: "Tester",
      createdAt: new Date().toISOString(),
      lang: "vi",
      likeCount: 15,
      repostCount: 2,
      replyCount: 1,
      quoteCount: 0,
    },
    new Date().toISOString(),
  );

  const { app } = createApp(config, store);
  const res = await app.request("/api/hashtags?days=7");
  assert.equal(res.status, 200);

  const json = (await res.json()) as { ok: boolean; data: { totalHashtagsCount: number; list: Array<{ tag: string }> } };
  assert.equal(json.ok, true);
  assert.ok(json.data.totalHashtagsCount >= 1);
  assert.equal(json.data.list[0]?.tag, "#rueco");
});

