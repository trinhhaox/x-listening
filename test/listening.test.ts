import assert from "node:assert/strict";
import test from "node:test";
import { alertReason } from "../src/alerts.js";
import { createApp } from "../src/app.js";
import { issueSession, sessionValid } from "../src/auth.js";
import type { AppConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { listenOnce } from "../src/listen.js";
import { buildSearchQuery } from "../src/query.js";
import { classifySentiment } from "../src/sentiment.js";

function testConfig(): AppConfig {
  return {
    HOST: "127.0.0.1",
    PORT: 3021,
    DATABASE_PATH: ":memory:",
    ADMIN_PASSWORD: "mat-khau-dai",
    X_BEARER_TOKEN: "",
    LISTEN_INTERVAL_MINUTES: 15,
    SEARCH_MAX_RESULTS: 10,
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
    active: 1,
    created_at: "2026-10-14T00:00:00.000Z",
  };
  assert.match(alertReason(rule, { topicId: "t1", text: "cà phê giấy", sentiment: "neutral", likeCount: 0 }) ?? "", /Cà Phê/);
  assert.equal(alertReason(rule, { topicId: "t2", text: "cà phê giấy", sentiment: "neutral", likeCount: 0 }), null);
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
