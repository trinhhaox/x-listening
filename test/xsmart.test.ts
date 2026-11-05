import test from "node:test";
import assert from "node:assert/strict";
import { parseBingRss, parseDuckDuckGoHtml, searchXWithCookie } from "../src/xcookie.js";

test("parseBingRss trích xuất bài viết tweet từ XML Bing RSS", () => {
  const xml = `<?xml version="1.0" encoding="utf-8" ?>
  <rss version="2.0">
    <channel>
      <title>Bing: site:x.com Rueco</title>
      <item>
        <title>rueco on X: "Sản phẩm dùng rất tốt"</title>
        <link>https://x.com/rueco/status/2103158242620957009</link>
        <description>rueco on X: "Sản phẩm dùng rất tốt" 24 Sep 2026</description>
        <pubDate>Thu, 24 Sep 2026 16:22:54 GMT</pubDate>
      </item>
      <item>
        <title>Not a tweet</title>
        <link>https://x.com/rueco</link>
        <description>Profile page</description>
      </item>
    </channel>
  </rss>`;

  const posts = parseBingRss(xml);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "2103158242620957009");
  assert.equal(posts[0].authorUsername, "rueco");
  assert.equal(posts[0].url, "https://x.com/rueco/status/2103158242620957009");
  assert.ok(posts[0].text.includes("Sản phẩm dùng rất tốt"));
});

test("parseDuckDuckGoHtml trích xuất bài viết tweet từ HTML DuckDuckGo", () => {
  const html = `
    <div class="result results_links">
      <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.com%2Fuser123%2Fstatus%2F9876543210&amp;rut=123">x.com</a>
      <a class="result__snippet" href="#">Dịch vụ CSKH trả lời rất nhanh và tận tâm</a>
    </div>
  `;

  const posts = parseDuckDuckGoHtml(html);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "9876543210");
  assert.equal(posts[0].authorUsername, "user123");
  assert.equal(posts[0].text, "Dịch vụ CSKH trả lời rất nhanh và tận tâm");
});

test("searchXWithCookie tự động fallback sang Web Index khi X direct rỗng", async () => {
  const mockFetch = async (input: RequestInfo | URL) => {
    const urlStr = String(input);
    if (urlStr.includes("x.com/i/api/graphql") || urlStr.includes("api.twitter.com")) {
      // Giả lập X trả về rỗng (như khi bị bot block)
      return new Response("", { status: 200 });
    }
    if (urlStr.includes("bing.com")) {
      return new Response(
        `<?xml version="1.0"?><rss><channel><item><link>https://x.com/rueco/status/1122334455</link><title>Test tweet</title><description>Nội dung bài viết dự phòng</description></item></channel></rss>`,
        { status: 200 },
      );
    }
    return new Response("", { status: 404 });
  };

  const posts = await searchXWithCookie({
    authToken: "token",
    ct0: "ct0",
    query: "Rueco",
    fetchImpl: mockFetch as typeof fetch,
  });

  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "1122334455");
  assert.equal(posts[0].authorUsername, "rueco");
  assert.equal(posts[0].text, "Nội dung bài viết dự phòng");
});

