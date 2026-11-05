import assert from "node:assert/strict";
import test from "node:test";
import { alertReason } from "../src/alerts.js";
import { briefMarkdown, buildBrief, spikeReason, type DigestPost } from "../src/digest.js";
import { createApp, getRuntimeConfig } from "../src/app.js";
import { issueSession, sessionValid } from "../src/auth.js";
import type { AppConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { pageKey } from "../src/facebook.js";
import { threadsUserKey } from "../src/threads.js";
import { searchRecentPosts } from "../src/xapi.js";
import { deliverHit, webhookTarget, buildWebhookPayload, deliverExecutiveReport } from "../src/notify.js";
import { generateAiBrief, analyzePostWithAi } from "../src/ai.js";
import { searchXWithCookie } from "../src/xcookie.js";
import { scrapeFacebookPageWithCookie } from "../src/fbcookie.js";
import { listenOnce, PAGE_CAP } from "../src/listen.js";
import { buildSearchQuery } from "../src/query.js";
import { classifySentiment } from "../src/sentiment.js";

function testConfig(): AppConfig {
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
  };
}

test("câu tìm kiếm bỏ bài đăng lại và chặn câu rỗng", () => {
  assert.equal(buildSearchQuery("cà phê giấy", true), "cà phê giấy -is:retweet");
  assert.equal(buildSearchQuery("cà phê is:retweet", true), "cà phê is:retweet");
  assert.throws(() => buildSearchQuery("   ", true));
});

test("sắc thái tiếng Việt có phủ định", () => {
  assert.equal(classifySentiment("Nước ổn, sẽ ghé lại").sentiment, "positive");
  assert.equal(classifySentiment("Thất vọng, phục vụ quá chậm").sentiment, "negative");
  assert.equal(classifySentiment("không tốt").sentiment, "negative");
  assert.equal(classifySentiment("hôm nay trời mưa").sentiment, "neutral");
  assert.equal(classifySentiment("ly này ngon", { positive: ["ngon"], negative: [] }).sentiment, "positive");
  assert.equal(classifySentiment("Nước ổn", { positive: [], negative: ["ổn"] }).sentiment, "negative");
});

test("lưu bài một lần và cập nhật số liệu", () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán",
    query: "cà phê",
    excludeReposts: true,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  const mention = {
    id: "10",
    topicId: "t1",
    text: "Cà phê rất tốt",
    authorUsername: "lan",
    authorName: "Lan",
    createdAt: "2026-10-14T01:00:00.000Z",
    lang: "vi",
    likeCount: 1,
    repostCount: 0,
    replyCount: 0,
    quoteCount: 0,
  };
  assert.equal(store.insertMention(mention, "2026-10-14T02:00:00.000Z"), true);
  store.insertMention({ ...mention, likeCount: 9 }, "2026-10-14T03:00:00.000Z");
  const rows = store.listMentions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.like_count, 9);
  assert.equal(rows[0]?.sentiment, "positive");
  store.close();
});

test("lượt nghe ghi bài công khai và nhớ mốc since_id", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán",
    query: "cà phê giấy",
    excludeReposts: true,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    assert.match(url, /query=/);
    assert.match(decodeURIComponent(url), /-is:retweet/);
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "99",
            text: "Cà phê giấy hôm nay tệ quá",
            author_id: "u1",
            created_at: "2026-10-14T04:00:00.000Z",
            lang: "vi",
            public_metrics: { like_count: 2, retweet_count: 0, reply_count: 1, quote_count: 0 },
          },
        ],
        includes: { users: [{ id: "u1", username: "minh_q", name: "Minh" }] },
        meta: { newest_id: "99", result_count: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const report = await listenOnce(store, { token: "test-token", maxResults: 10, fetchImpl });
  assert.equal(report.saved, 1);
  assert.equal(report.errors.length, 0);
  assert.equal(store.listMentions()[0]?.sentiment, "negative");
  assert.equal(store.getTopic("t1")?.since_id, "99");
  store.close();
});

test("lật hết trang rồi mới nhích mốc, và giữ mốc khi chạm trần", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán",
    query: "cà phê",
    excludeReposts: false,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    const page = calls === 1 ? "a" : "b";
    assert.equal(url.includes("next_token"), calls > 1);
    if (calls === 1) assert.equal(url.includes("since_id"), false);
    return new Response(
      JSON.stringify({
        data: [{ id: calls === 1 ? "200" : "100", text: `bài ${page}`, author_id: "u1", created_at: "2026-10-14T04:00:00.000Z", lang: "vi" }],
        includes: { users: [{ id: "u1", username: "lan", name: "Lan" }] },
        meta: { newest_id: "200", next_token: calls === 1 ? "tok-2" : undefined, result_count: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const report = await listenOnce(store, { token: "test-token", maxResults: 10, fetchImpl });
  assert.equal(report.saved, 2);
  assert.equal(report.errors.length, 0);
  assert.equal(store.getTopic("t1")?.since_id, "200");

  calls = 0;
  const capped: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        data: [{ id: String(1000 + calls), text: "cà phê", author_id: "u1", created_at: "2026-10-14T05:00:00.000Z", lang: "vi" }],
        includes: { users: [{ id: "u1", username: "lan", name: "Lan" }] },
        meta: { newest_id: "1006", next_token: `more-${calls}` },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const again = await listenOnce(store, { token: "test-token", maxResults: 10, fetchImpl: capped });
  assert.equal(calls, PAGE_CAP);
  assert.equal(again.errors.length, 1);
  assert.equal(store.getTopic("t1")?.since_id, "200");
  store.close();
});

test("lấy 7 ngày không gửi since_id", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán",
    query: "cà phê",
    excludeReposts: false,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  store.markTopicListened("t1", "50", null, "2026-10-14T01:00:00.000Z");
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    assert.equal(url.includes("since_id"), false);
    assert.equal(url.includes("start_time"), true);
    return new Response(JSON.stringify({ data: [], meta: {} }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await listenOnce(store, {
    token: "test-token",
    maxResults: 10,
    fetchImpl,
    onlyTopicId: "t1",
    startTime: "2026-10-07T00:00:00.000Z",
  });
  assert.equal(store.getTopic("t1")?.since_id, "50");
  store.close();
});

test("tắt tiếng loại bài khỏi dây, bài xong vẫn được tính", () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán",
    query: "cà phê",
    excludeReposts: true,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  store.insertMention(
    {
      id: "1",
      topicId: "t1",
      text: "Nước ổn",
      authorUsername: "lan_be",
      authorName: "Lan",
      createdAt: "2026-10-14T08:00:00.000Z",
      lang: "vi",
      likeCount: 1,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    },
    "2026-10-14T08:01:00.000Z",
  );
  assert.equal(store.setMentionQueue("t1", "1", "done"), true);
  assert.equal(store.listMentions(undefined, 80, "done").length, 1);
  assert.equal(store.stats("2026-10-14T00:00:00.000Z").mentions, 1);
  assert.equal(store.muteAuthor("lan_be", "2026-10-14T09:00:00.000Z"), true);
  assert.equal(store.listMentions().length, 0);
  assert.equal(store.stats("2026-10-14T00:00:00.000Z").mentions, 0);
  assert.equal(
    store.insertMention(
      {
        id: "2",
        topicId: "t1",
        text: "bài sau",
        authorUsername: "Lan_Be",
        authorName: "Lan",
        createdAt: "2026-10-14T10:00:00.000Z",
        lang: "vi",
        likeCount: 1,
        repostCount: 0,
        replyCount: 0,
        quoteCount: 0,
      },
      "2026-10-14T10:01:00.000Z",
    ),
    false,
  );
  store.unmuteAuthor("@lan_be");
  assert.equal(store.listMentions().length, 1);
  store.close();
});

test("chuông khớp bài đang có, bài mới, và giấu tin khỏi dây", () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán",
    query: "cà phê",
    excludeReposts: true,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  const base = {
    topicId: "t1",
    authorUsername: "lan",
    authorName: "Lan",
    createdAt: "2026-10-14T08:00:00.000Z",
    lang: "vi",
    likeCount: 3,
    repostCount: 0,
    replyCount: 0,
    quoteCount: 0,
  };
  store.insertMention({ ...base, id: "1", text: "Phục vụ thất vọng" }, "2026-10-14T08:01:00.000Z");
  store.insertMention({ ...base, id: "2", text: "Nước ổn" }, "2026-10-14T08:02:00.000Z");
  const found = store.insertAlert({
    id: "bell-1",
    topicId: null,
    name: "Kêu ca",
    kind: "negative",
    phrase: "",
    minLikes: 0,
    createdAt: "2026-10-14T08:03:00.000Z",
  });
  assert.equal(found, 1);
  store.insertMention({ ...base, id: "3", text: "Lại chậm nữa" }, "2026-10-14T08:04:00.000Z");
  assert.equal(store.listOpenHits().length, 2);
  assert.equal(store.toggleMention("t1", "2", "starred"), true);
  assert.equal(store.listMentions(undefined, 80, "starred").length, 1);
  assert.equal(store.toggleMention("t1", "1", "hidden"), true);
  assert.equal(store.listMentions().some((row) => row.id === "1"), false);
  assert.equal(store.stats("2026-10-14T00:00:00.000Z").mentions, 2);
  store.close();
});

test("chuông cụm từ chỉ kêu đúng tần số", () => {
  const rule = {
    id: "a",
    topic_id: "t1",
    name: "Giấy",
    kind: "phrase" as const,
    phrase: "Cà Phê",
    min_likes: 0,
    threshold_count: 3,
    time_window_minutes: 60,
    active: 1,
    created_at: "2026-10-14T00:00:00.000Z",
  };
  assert.match(alertReason(rule, { topicId: "t1", text: "cà phê giấy", sentiment: "neutral", likeCount: 0 }) ?? "", /Cà Phê/);
  assert.equal(alertReason(rule, { topicId: "t2", text: "cà phê giấy", sentiment: "neutral", likeCount: 0 }), null);
});

test("đột biến cần ít nhất 5 bài và gấp 3 lần trung vị", () => {
  const quiet = [
    { day: "2026-10-08", posts: 1, authors: 1 },
    { day: "2026-10-09", posts: 1, authors: 1 },
    { day: "2026-10-10", posts: 2, authors: 1 },
    { day: "2026-10-11", posts: 1, authors: 1 },
    { day: "2026-10-12", posts: 2, authors: 2 },
    { day: "2026-10-13", posts: 1, authors: 1 },
    { day: "2026-10-14", posts: 4, authors: 2 },
  ];
  assert.equal(spikeReason(quiet, "2026-10-14"), null);
  const loud = quiet.map((row) => (row.day === "2026-10-14" ? { ...row, posts: 6 } : row));
  assert.match(spikeReason(loud, "2026-10-14") ?? "", /6 bài/);
  const first = quiet.map((row) => ({ ...row, posts: row.day === "2026-10-14" ? 5 : 0 }));
  assert.match(spikeReason(first, "2026-10-14") ?? "", /5 bài/);
});

test("bản tin chỉ tính người viết lần đầu trong ngày", () => {
  const posts: DigestPost[] = [
    post("1", "2026-10-14T02:00:00.000Z", "lan", "negative", 1),
    post("2", "2026-10-14T03:00:00.000Z", "minh", "neutral", 0),
    post("3", "2026-10-13T03:00:00.000Z", "lan", "neutral", 0),
  ];
  const brief = buildBrief(
    "2026-10-14",
    posts,
    [
      { username: "lan", firstAt: "2026-10-13T03:00:00.000Z" },
      { username: "minh", firstAt: "2026-10-14T03:00:00.000Z" },
    ],
  );
  assert.equal(brief.posts, 2);
  assert.equal(brief.negative.length, 1);
  assert.equal(brief.starred.length, 1);
  assert.deepEqual(brief.newAuthors.map((author) => author.username), ["minh"]);
  assert.match(briefMarkdown(brief), /@minh/);
});

function post(id: string, createdAt: string, author: string, sentiment: string, starred: number): DigestPost {
  return {
    id,
    topicId: "t1",
    topicName: "Quán",
    text: "nội dung",
    authorUsername: author,
    authorName: author,
    createdAt,
    sentiment,
    starred,
  };
}

test("từ của người vận hành chấm lại bài đã lưu", () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán",
    query: "cà phê",
    excludeReposts: true,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  store.insertMention(
    {
      id: "1",
      topicId: "t1",
      text: "Ly này ngon",
      authorUsername: "lan",
      authorName: "Lan",
      createdAt: "2026-10-14T01:00:00.000Z",
      lang: "vi",
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    },
    "2026-10-14T01:00:00.000Z",
  );
  assert.equal(store.listMentions()[0]?.sentiment, "neutral");
  const changed = store.setLexiconWord("ngon", "positive", "2026-10-14T02:00:00.000Z");
  assert.equal(changed, 1);
  assert.equal(store.listMentions()[0]?.sentiment, "positive");
  store.deleteLexiconWord("ngon");
  assert.equal(store.listMentions()[0]?.sentiment, "neutral");
  store.close();
});

test("chuông ra ngoài chỉ gửi webhook hợp lệ một lần", async () => {
  assert.equal(webhookTarget("https://example.com/hook"), "https://example.com/hook");
  assert.equal(webhookTarget("http://127.0.0.1:9/hook"), "http://127.0.0.1:9/hook");
  assert.equal(webhookTarget("http://example.com/hook"), null);
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán",
    query: "cà phê",
    excludeReposts: true,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  store.insertMention(
    {
      id: "1",
      topicId: "t1",
      text: "Thất vọng",
      authorUsername: "lan",
      authorName: "Lan",
      createdAt: "2026-10-14T01:00:00.000Z",
      lang: "vi",
      likeCount: 1,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    },
    "2026-10-14T01:00:00.000Z",
  );
  store.insertAlert({
    id: "a1",
    topicId: null,
    name: "Kêu ca",
    kind: "negative",
    phrase: "",
    minLikes: 0,
    createdAt: "2026-10-14T02:00:00.000Z",
  });
  const pending = store.listPendingNotices();
  assert.equal(pending.length, 1);
  let calls = 0;
  const error = await deliverHit(pending[0]!, {
    webhookUrl: "https://example.com/hook",
    desktop: true,
    desktopImpl: () => {},
    fetchImpl: async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.alert, "Kêu ca");
      assert.equal(init?.method, "POST");
      return new Response("ok", { status: 200 });
    },
  });
  assert.equal(error, null);
  assert.equal(calls, 1);
  store.markNotified(pending.map((hit) => hit.id));
  assert.equal(store.listPendingNotices().length, 0);
  store.close();
});

test("trang Facebook nhận link và từ chối nhóm", () => {
  assert.equal(pageKey("https://www.facebook.com/giaycafe"), "giaycafe");
  assert.equal(pageKey("https://facebook.com/pages/Quan/1234567890"), "1234567890");
  assert.equal(pageKey("https://www.facebook.com/groups/123"), null);
  assert.equal(pageKey("cà phê giấy"), null);
});

test("nghe Facebook chỉ lưu bài có cụm và nhớ mốc giờ", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "fb",
    name: "Trang quán",
    query: "giaycafe",
    excludeReposts: false,
    source: "facebook",
    phrase: "cà phê",
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (!url.includes("published_posts")) {
      return new Response(JSON.stringify({ id: "11111", name: "Quán" }), { status: 200 });
    }
    assert.equal(url.includes("since="), false);
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "11111_22222",
            message: "Hôm nay hết cà phê giấy",
            created_time: "2026-10-14T03:00:00+0000",
            permalink_url: "https://www.facebook.com/giaycafe/posts/22222",
            from: { id: "11111", name: "Quán giấy" },
            reactions: { summary: { total_count: 4 } },
            comments: { summary: { total_count: 1 } },
            shares: { count: 2 },
          },
          {
            id: "11111_33333",
            message: "Chỉ bán trà đá",
            created_time: "2026-10-14T04:00:00+0000",
            permalink_url: "https://www.facebook.com/giaycafe/posts/33333",
            from: { id: "11111", name: "Quán giấy" },
          },
        ],
      }),
      { status: 200 },
    );
  };
  const report = await listenOnce(store, { token: "", facebookToken: "fb-token", maxResults: 10, fetchImpl });
  assert.equal(report.errors.length, 0);
  assert.equal(report.saved, 1);
  const row = store.listMentions()[0];
  assert.equal(row?.text, "Hôm nay hết cà phê giấy");
  assert.equal(row?.url, "https://www.facebook.com/giaycafe/posts/22222");
  assert.equal(store.getTopic("fb")?.since_id, String(Math.floor(Date.parse("2026-10-14T04:00:00+0000") / 1000)));
  store.close();
});

test("khách chưa đăng nhập không vào bàn nghe", async () => {
  const store = Store.open(":memory:");
  const { app } = createApp(testConfig(), store);
  const home = await app.request("/");
  assert.equal(home.status, 302);
  assert.equal(home.headers.get("location"), "/login");
  const blocked = await app.request("/topics", { method: "POST", body: new URLSearchParams({ name: "x", query: "y" }) });
  assert.equal(blocked.status, 302);
  assert.equal(store.listTopics().length, 0);
  store.close();
});

test("phiên đăng nhập hết hạn thì từ chối", () => {
  const token = issueSession("mat-khau-dai", 1_000);
  assert.equal(sessionValid(token, "mat-khau-dai", 1_000), true);
  assert.equal(sessionValid(token, "mat-khau-khac", 1_000), false);
  assert.equal(sessionValid(token, "mat-khau-dai", 1_000 + 8 * 24 * 60 * 60 * 1000), false);
});

test("listMentions lọc theo từ khóa, sắc thái, và số thích tối thiểu", () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán cà phê",
    query: "cafe",
    excludeReposts: true,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  store.insertMention(
    {
      id: "m1",
      topicId: "t1",
      text: "Cà phê ở đây rất tuyệt và thơm",
      authorUsername: "tuan_anh",
      authorName: "Tuấn Anh",
      createdAt: "2026-10-14T01:00:00.000Z",
      lang: "vi",
      likeCount: 50,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    },
    "2026-10-14T01:00:00.000Z",
  );
  store.insertMention(
    {
      id: "m2",
      topicId: "t1",
      text: "Nhân viên phục vụ quá tệ, thất vọng",
      authorUsername: "minh_h",
      authorName: "Minh Hoàng",
      createdAt: "2026-10-14T02:00:00.000Z",
      lang: "vi",
      likeCount: 5,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    },
    "2026-10-14T02:00:00.000Z",
  );

  const bySearch = store.listMentions({ search: "thất vọng" });
  assert.equal(bySearch.length, 1);
  assert.equal(bySearch[0]?.id, "m2");

  const byUser = store.listMentions({ search: "tuan_anh" });
  assert.equal(byUser.length, 1);
  assert.equal(byUser[0]?.id, "m1");

  const positiveRows = store.listMentions({ sentiment: "positive" });
  assert.equal(positiveRows.length, 1);
  assert.equal(positiveRows[0]?.id, "m1");

  const viralRows = store.listMentions({ minLikes: 20 });
  assert.equal(viralRows.length, 1);
  assert.equal(viralRows[0]?.id, "m1");

  store.close();
});

test("buildWebhookPayload định dạng payload đúng cho Discord, Slack và Generic", () => {
  const hit = {
    id: "h1",
    alertName: "Cảnh báo khẩn",
    reason: "Bài nghiêng xấu",
    authorName: "Khách phàn nàn",
    topicName: "Quán cà phê",
    text: "Dịch vụ kém quá",
  };

  const discordPayload = buildWebhookPayload("https://discord.com/api/webhooks/123/xyz", hit) as { content: string; embeds: Array<{ title: string }> };
  assert.match(discordPayload.content, /Cảnh báo khẩn/);
  assert.equal(discordPayload.embeds[0]?.title, "Bài nghiêng xấu");

  const slackPayload = buildWebhookPayload("https://hooks.slack.com/services/T00/B00/X00", hit) as { text: string; blocks: unknown[] };
  assert.match(slackPayload.text, /Cảnh báo khẩn/);
  assert.ok(Array.isArray(slackPayload.blocks));

  const genericPayload = buildWebhookPayload("https://example.com/webhook", hit) as { alert: string; reason: string };
  assert.equal(genericPayload.alert, "Cảnh báo khẩn");
  assert.equal(genericPayload.reason, "Bài nghiêng xấu");
});

test("API Ingest /api/mentions lưu bài từ bên ngoài và kiểm tra quyền", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán cà phê",
    query: "cafe",
    excludeReposts: true,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  const { app } = createApp(testConfig(), store);

  const unauth = await app.request("/api/mentions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topicId: "t1", text: "Bài thử", authorUsername: "user1" }),
  });
  assert.equal(unauth.status, 401);

  const success = await app.request("/api/mentions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer mat-khau-dai",
    },
    body: JSON.stringify({
      topicId: "t1",
      text: "Dịch vụ ở đây quá tuyệt vời, rất hài lòng",
      authorUsername: "tester",
      authorName: "Người Thử Nghiệm",
      likeCount: 15,
      url: "https://tiktok.com/@tester/video/123",
    }),
  });
  assert.equal(success.status, 200);
  const json = (await success.json()) as { ok: boolean; id: string; inserted: boolean };
  assert.equal(json.ok, true);
  assert.equal(json.inserted, true);

  const rows = store.listMentions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.author_username, "tester");
  assert.equal(rows[0]?.sentiment, "positive");
  assert.equal(rows[0]?.like_count, 15);
  assert.equal(rows[0]?.url, "https://tiktok.com/@tester/video/123");

  store.close();
});

test("chuông bùng nổ bài tiêu cực (velocity) chỉ kêu khi đủ ngưỡng trong khung giờ", () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán cà phê",
    query: "cafe",
    excludeReposts: true,
    createdAt: "2026-10-14T00:00:00.000Z",
  });

  store.insertAlert({
    id: "v1",
    topicId: "t1",
    name: "Cảnh báo khủng hoảng",
    kind: "velocity",
    phrase: "",
    minLikes: 0,
    thresholdCount: 3,
    timeWindowMinutes: 60,
    createdAt: "2026-10-14T01:00:00.000Z",
  });

  const now = new Date();
  const t1 = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const t2 = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const t3 = new Date(now.getTime() - 2 * 60 * 1000).toISOString();

  store.insertMention({
    id: "m1",
    topicId: "t1",
    text: "Phục vụ quá tệ",
    authorUsername: "u1",
    authorName: "User 1",
    createdAt: t1,
    lang: "vi",
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    quoteCount: 0,
  }, t1);
  assert.equal(store.listOpenHits().length, 0);

  store.insertMention({
    id: "m2",
    topicId: "t1",
    text: "Cà phê dở, thất vọng",
    authorUsername: "u2",
    authorName: "User 2",
    createdAt: t2,
    lang: "vi",
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    quoteCount: 0,
  }, t2);
  assert.equal(store.listOpenHits().length, 0);

  store.insertMention({
    id: "m3",
    topicId: "t1",
    text: "Chất lượng kém và lừa đảo",
    authorUsername: "u3",
    authorName: "User 3",
    createdAt: t3,
    lang: "vi",
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    quoteCount: 0,
  }, t3);

  const hits = store.listOpenHits();
  assert.equal(hits.length, 1);
  assert.match(hits[0]?.reason ?? "", /Bùng nổ: 3 bài nghiêng xấu trong 60 phút/);

  store.close();
});

test("AI generateAiBrief và analyzePostWithAi phân tích thành công với mock fetch", async () => {
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.match(url, /\/chat\/completions/);
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    
    if (body.messages[0]?.content.includes("DUY NHẤT một chuỗi JSON")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  sentiment: "negative",
                  score: -85,
                  isSarcastic: true,
                  explanation: "Người dùng mỉa mai chất lượng dịch vụ quá kém",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "### Tóm tắt Điều hành\n- Dư luận hôm nay có xu hướng tiêu cực về thời gian giao hàng.",
            },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const briefText = await generateAiBrief(
    [
      {
        id: "1",
        topicId: "t1",
        topicName: "Quán",
        text: "Giao trễ quá thất vọng",
        authorUsername: "lan",
        authorName: "Lan",
        createdAt: new Date().toISOString(),
        sentiment: "negative",
        starred: 0,
      },
    ],
    {
      apiKey: "test-key",
      fetchImpl: mockFetch,
    },
  );
  assert.match(briefText, /Tóm tắt Điều hành/);

  const postAnalysis = await analyzePostWithAi("Quán làm ăn tuyệt vời ghê, đợi 2 tiếng chưa có đồ", {
    apiKey: "test-key",
    fetchImpl: mockFetch,
  });
  assert.ok(postAnalysis);
  assert.equal(postAnalysis.sentiment, "negative");
  assert.equal(postAnalysis.isSarcastic, true);
  assert.match(postAnalysis.explanation, /mỉa mai/);
});

test("API POST /api/ai/analyze phản hồi đúng cấu trúc", async () => {
  const store = Store.open(":memory:");
  const config = {
    ...testConfig(),
    LLM_API_KEY: "test-key",
  };
  const { app } = createApp(config, store);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sentiment: "positive",
                score: 90,
                isSarcastic: false,
                explanation: "Khen ngợi đồ uống rất ngon",
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );

  try {
    const res = await app.request("/api/ai/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer mat-khau-dai",
      },
      body: JSON.stringify({ text: "Cà phê ở đây ngon xuất sắc" }),
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; data: { sentiment: string; score: number } };
    assert.equal(json.ok, true);
    assert.equal(json.data.sentiment, "positive");
    assert.equal(json.data.score, 90);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
});

test("threadsUserKey nhận link hoặc username Threads hợp lệ", () => {
  assert.equal(threadsUserKey("https://www.threads.net/@vietnam_coffee/post/123"), "vietnam_coffee");
  assert.equal(threadsUserKey("@trinhhao"), "trinhhao");
  assert.equal(threadsUserKey("brand.official"), "brand.official");
  assert.equal(threadsUserKey("https://facebook.com/trang"), null);
});

test("searchRecentPosts báo lỗi rõ ràng khi gặp Rate Limit 429", async () => {
  const fetch429: typeof fetch = async () =>
    new Response(JSON.stringify({ title: "Too Many Requests" }), {
      status: 429,
      headers: { "x-rate-limit-reset": "1770000000" },
    });

  await assert.rejects(
    () => searchRecentPosts("token", "query", 10, null, fetch429),
    /Rate Limit 429/,
  );
});

test("nghe Threads ghi bài và ghi nhớ mốc", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "th1",
    name: "Quán Threads",
    query: "quan_cafe",
    source: "threads",
    phrase: "giấy",
    excludeReposts: false,
    createdAt: "2026-10-14T00:00:00.000Z",
  });

  const fetchThreads: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "th_post_1",
            text: "Cà phê giấy hôm nay có khuyến mãi",
            timestamp: "2026-10-14T05:00:00+0000",
            username: "quan_cafe",
            permalink: "https://www.threads.net/@quan_cafe/post/th_post_1",
          },
          {
            id: "th_post_2",
            text: "Trà sữa hôm nay ngon tuyệt",
            timestamp: "2026-10-14T04:00:00+0000",
            username: "quan_cafe",
          },
        ],
      }),
      { status: 200 },
    );

  const report = await listenOnce(store, {
    token: "",
    threadsToken: "threads-token",
    maxResults: 10,
    fetchImpl: fetchThreads,
  });

  assert.equal(report.errors.length, 0);
  assert.equal(report.saved, 1);
  const row = store.listMentions()[0];
  assert.equal(row?.id, "th_post_1");
  assert.equal(row?.author_username, "quan_cafe");
  assert.equal(row?.url, "https://www.threads.net/@quan_cafe/post/th_post_1");

  store.close();
});

test("nghe YouTube ghi video theo từ khóa tìm kiếm", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "yt1",
    name: "Review Cà Phê",
    query: "review cà phê giấy",
    source: "youtube",
    phrase: "",
    excludeReposts: false,
    createdAt: "2026-10-14T00:00:00.000Z",
  });

  const fetchYoutube: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            id: { videoId: "yt_123" },
            snippet: {
              title: "Review Cà phê giấy siêu ngon",
              description: "Trải nghiệm cà phê giấy đặc biệt tại Sài Gòn",
              channelTitle: "Food Reviewer",
              channelId: "UC_123",
              publishedAt: "2026-10-14T06:00:00Z",
            },
          },
        ],
      }),
      { status: 200 },
    );

  const report = await listenOnce(store, {
    token: "",
    youtubeApiKey: "yt-key",
    maxResults: 10,
    fetchImpl: fetchYoutube,
  });

  assert.equal(report.errors.length, 0);
  assert.equal(report.saved, 1);
  const row = store.listMentions()[0];
  assert.equal(row?.id, "yt_123");
  assert.equal(row?.author_name, "Food Reviewer");
  assert.equal(row?.url, "https://www.youtube.com/watch?v=yt_123");

  store.close();
});

test("quản lý gán người xử lý và gắn nhãn trên bài viết", () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Quán",
    query: "quan",
    source: "x",
    phrase: "",
    excludeReposts: false,
    createdAt: "2026-10-14T00:00:00.000Z",
  });

  store.insertMention(
    {
      id: "m1",
      topicId: "t1",
      text: "Cà phê bị nguội khi ship tới nơi",
      authorUsername: "user1",
      authorName: "User 1",
      createdAt: "2026-10-14T01:00:00.000Z",
      lang: "vi",
      likeCount: 5,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    },
    "2026-10-14T01:00:00.000Z",
  );

  store.insertMention(
    {
      id: "m2",
      topicId: "t1",
      text: "Không gian quán rất thoáng mát",
      authorUsername: "user2",
      authorName: "User 2",
      createdAt: "2026-10-14T02:00:00.000Z",
      lang: "vi",
      likeCount: 15,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    },
    "2026-10-14T02:00:00.000Z",
  );

  // Gán người và nhãn
  store.setMentionAssignee("t1", "m1", "Tuấn CSKH");
  store.setMentionTag("t1", "m1", "Khẩn cấp");

  let rows = store.listMentions({ assignedTo: "Tuấn" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "m1");
  assert.equal(rows[0]?.assigned_to, "Tuấn CSKH");
  assert.equal(rows[0]?.tag, "Khẩn cấp");

  rows = store.listMentions({ tag: "Khẩn" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "m1");

  rows = store.listMentions({ assignedTo: "Lan" });
  assert.equal(rows.length, 0);

  store.close();
});

test("quản lý mẫu phản hồi nhanh (response templates)", () => {
  const store = Store.open(":memory:");
  assert.equal(store.listTemplates().length, 0);

  store.insertTemplate({
    id: "tpl_1",
    name: "Xin lỗi chậm trễ",
    content: "Chào bạn, quán rất tiếc về sự cố đơn hàng của bạn...",
    createdAt: new Date().toISOString(),
  });

  const list = store.listTemplates();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, "Xin lỗi chậm trễ");
  assert.match(list[0]?.content ?? "", /quán rất tiếc/);

  store.deleteTemplate("tpl_1");
  assert.equal(store.listTemplates().length, 0);

  store.close();
});

test("deliverExecutiveReport gửi báo cáo điều hành tới webhook", async () => {
  let capturedBody: any = null;
  const mockFetch: typeof fetch = async (input, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const reportData = {
    day: "2026-10-14",
    posts: 42,
    negativeCount: 5,
    newAuthorsCount: 8,
    starredCount: 3,
    aiSummary: "Tình hình dư luận ổn định, có một vài phàn nàn về đóng gói.",
  };

  // Test Discord Webhook
  const discordErr = await deliverExecutiveReport(reportData, {
    webhookUrl: "https://discord.com/api/webhooks/123/xyz",
    fetchImpl: mockFetch,
  });
  assert.equal(discordErr, null);
  assert.match(capturedBody.content, /Báo cáo Dư luận Điều hành ngày 14\/10\/2026/);
  assert.equal(capturedBody.embeds.length, 1);
  assert.equal(capturedBody.embeds[0].title, "Tóm tắt Điều hành AI");

  // Test Slack Webhook
  const slackErr = await deliverExecutiveReport(reportData, {
    webhookUrl: "https://hooks.slack.com/services/123/xyz",
    fetchImpl: mockFetch,
  });
  assert.equal(slackErr, null);
  assert.match(capturedBody.text, /Báo cáo Dư luận Điều hành ngày 14\/10\/2026/);
  assert.ok(capturedBody.blocks.length >= 2);

  // Test Generic Webhook
  const genericErr = await deliverExecutiveReport(reportData, {
    webhookUrl: "http://127.0.0.1:9999/webhook",
    fetchImpl: mockFetch,
  });
  assert.equal(genericErr, null);
  assert.equal(capturedBody.day, "2026-10-14");
  assert.equal(capturedBody.posts, 42);
  assert.equal(capturedBody.negative, 5);
});

test("API POST /api/reports/send gửi báo cáo thành công", async () => {
  const store = Store.open(":memory:");
  const config = {
    ...testConfig(),
    ALERT_WEBHOOK_URL: "https://discord.com/api/webhooks/test",
  };
  const { app } = createApp(config, store);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });

  try {
    const res = await app.request("/api/reports/send", {
      method: "POST",
      headers: {
        authorization: "Bearer mat-khau-dai",
      },
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; message: string };
    assert.equal(json.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
});

test("searchXWithCookie tìm kiếm bài viết bằng cookie web X (không cần developer api)", async () => {
  const mockFetch: typeof fetch = async (input, init) => {
    const headers = init?.headers as Record<string, string>;
    assert.match(headers.cookie, /auth_token=mock_auth/);
    assert.match(headers["x-csrf-token"], /mock_ct0/);

    const mockResponse = {
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [
                {
                  entries: [
                    {
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              rest_id: "1899999999999999999",
                              legacy: {
                                full_text: "Cà phê giấy hôm nay uống rất vừa miệng!",
                                created_at: "Wed Oct 14 07:00:00 +0000 2026",
                                favorite_count: 25,
                                retweet_count: 3,
                                reply_count: 2,
                                lang: "vi",
                              },
                              core: {
                                user_results: {
                                  result: {
                                    legacy: {
                                      screen_name: "nguoitieudung",
                                      name: "Người Tiêu Dùng",
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    };

    return new Response(JSON.stringify(mockResponse), { status: 200 });
  };

  const posts = await searchXWithCookie({
    authToken: "mock_auth",
    ct0: "mock_ct0",
    query: "cà phê giấy",
    fetchImpl: mockFetch,
  });

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.id, "1899999999999999999");
  assert.equal(posts[0]?.authorUsername, "nguoitieudung");
  assert.equal(posts[0]?.likeCount, 25);
  assert.match(posts[0]?.text ?? "", /vừa miệng/);
});

test("scrapeFacebookPageWithCookie cào bài viết Fanpage qua mbasic (không cần app review)", async () => {
  const mockHtml = `
    <html>
      <body>
        <div id="m_story_1">
          <a href="/story.php?story_fbid=9876543210&id=1000123">Chi tiết</a>
          <div>Cà phê giấy khai trương cơ sở mới tại quận 1, giảm giá 30% hôm nay!</div>
        </div>
      </body>
    </html>
  `;

  const mockFetch: typeof fetch = async () =>
    new Response(mockHtml, { status: 200, headers: { "content-type": "text/html" } });

  const posts = await scrapeFacebookPageWithCookie({
    cookie: "c_user=123; xs=abc;",
    pageKey: "quan_cafe_giay",
    phrase: "giảm giá",
    fetchImpl: mockFetch,
  });

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.id, "fb_9876543210");
  assert.equal(posts[0]?.authorUsername, "quan_cafe_giay");
  assert.match(posts[0]?.text ?? "", /giảm giá 30%/);
});

test("listenOnce tự động chạy chế độ cookie khi không có API token", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "tx1",
    name: "Quán X Cookie",
    query: "cafe",
    source: "x",
    phrase: "",
    excludeReposts: false,
    createdAt: "2026-10-14T00:00:00.000Z",
  });

  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        data: {
          search_by_raw_query: {
            search_timeline: {
              timeline: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: "1899999999999999998",
                                legacy: {
                                  full_text: "Quán mới decor đẹp lắm",
                                  created_at: "Wed Oct 14 08:00:00 +0000 2026",
                                  favorite_count: 10,
                                  retweet_count: 1,
                                  lang: "vi",
                                },
                                core: {
                                  user_results: {
                                    result: {
                                      legacy: {
                                        screen_name: "khachhang",
                                        name: "Khách Hàng",
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      }),
      { status: 200 },
    );
  };

  const report = await listenOnce(store, {
    token: "",
    twitterAuthToken: "mock_auth",
    twitterCt0: "mock_ct0",
    maxResults: 10,
    fetchImpl: mockFetch,
  });

  assert.equal(report.errors.length, 0);
  assert.equal(report.saved, 1);
  const mention = store.listMentions()[0];
  assert.equal(mention?.id, "1899999999999999998");
  assert.equal(mention?.author_username, "khachhang");

  store.close();
});

test("quản lý cài đặt runtime settings trong database và override config", async () => {
  const store = Store.open(":memory:");
  const base = testConfig();

  // Ban đầu rỗng
  let runtime = getRuntimeConfig(base, store);
  assert.equal(runtime.TWITTER_AUTH_TOKEN, "");
  assert.equal(runtime.ALERT_WEBHOOK_URL, "");

  // Lưu cài đặt vào DB
  store.setSetting("TWITTER_AUTH_TOKEN", "new_cookie_123");
  store.setSetting("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/mywebhook");
  store.setSetting("SEARCH_MAX_RESULTS", "50");

  runtime = getRuntimeConfig(base, store);
  assert.equal(runtime.TWITTER_AUTH_TOKEN, "new_cookie_123");
  assert.equal(runtime.ALERT_WEBHOOK_URL, "https://discord.com/api/webhooks/mywebhook");
  assert.equal(runtime.SEARCH_MAX_RESULTS, 50);

  // Test qua HTTP request vào route /settings
  const { app } = createApp(base, store);
  const session = issueSession(base.ADMIN_PASSWORD);

  // GET /settings
  const getRes = await app.request("/settings", {
    headers: {
      cookie: `xl_session=${session}`,
    },
  });
  assert.equal(getRes.status, 200);
  const html = await getRes.text();
  assert.match(html, /Cài đặt Bàn nghe/);
  assert.match(html, /new_cookie_123/);

  // POST /settings
  const postRes = await app.request("/settings", {
    method: "POST",
    headers: {
      cookie: `xl_session=${session}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      TWITTER_AUTH_TOKEN: "updated_auth_token",
      TWITTER_CT0: "updated_ct0",
      FACEBOOK_COOKIE: "c_user=999; xs=xyz;",
    }).toString(),
  });

  assert.equal(postRes.status, 302);
  assert.equal(store.getSetting("TWITTER_AUTH_TOKEN"), "updated_auth_token");
  assert.equal(store.getSetting("TWITTER_CT0"), "updated_ct0");
  assert.equal(store.getSetting("FACEBOOK_COOKIE"), "c_user=999; xs=xyz;");

  store.close();
});
