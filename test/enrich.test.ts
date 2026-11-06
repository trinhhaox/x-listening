import assert from "node:assert/strict";
import test from "node:test";
import { parseSentimentBatch } from "../src/ai.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { aiSentimentEnabled, checkSourceHealth, failingTopics, runAiSentiment } from "../src/enrich.js";
import { renderMentionCard } from "../src/views/dashboard.js";
import type { MentionRow } from "../src/db.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig({ ADMIN_PASSWORD: "mat-khau-dai", DESKTOP_NOTIFY: "0" }), ...overrides };
}

function seeded(): Store {
  const store = Store.open(":memory:");
  store.insertTopic({ id: "t1", name: "Rươi Co", query: "rươi", excludeReposts: true, createdAt: "2026-01-01T00:00:00Z" });
  const now = new Date().toISOString();
  const add = (id: string, text: string) =>
    store.insertMention(
      { id, topicId: "t1", text, authorUsername: `u${id}`, authorName: `U${id}`, createdAt: now, lang: "vi", likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 },
      now,
    );
  add("1", "ngon quá cơ, đợi giao 2 tiếng mới tới");
  add("2", "hàng tệ, giao chậm, thất vọng");
  add("3", "cửa hàng mở cửa lúc mấy giờ");
  return store;
}

const reply = (verdicts: { n: number; s: string; r: string }[]): typeof fetch =>
  async () => new Response(JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify(verdicts) + "\n```" }] }), { status: 200 });

const aiCfg = config({ LLM_API_KEY: "k", LLM_BASE_URL: "https://api.anthropic.com/v1", LLM_MODEL: "" });

test("đọc kết quả AI: bỏ phần tử hỏng, số thứ tự lạ hoặc trùng", () => {
  const items = [
    { id: "a", topicId: "t", text: "x" },
    { id: "b", topicId: "t", text: "y" },
  ];
  const out = parseSentimentBatch('Đây: [{"n":1,"s":"NEGATIVE","r":"chê"},{"n":1,"s":"positive"},{"n":9,"s":"neutral"},{"n":2,"s":"hmm"}]', items);
  assert.deepEqual(out, [{ id: "a", topicId: "t", sentiment: "negative", reason: "chê" }]);
  assert.deepEqual(parseSentimentBatch("không có json", items), []);
  // Bị cắt giữa chừng vẫn giữ phần tử đã đủ.
  assert.deepEqual(parseSentimentBatch('[{"n":2,"s":"positive","r":"khen"},\n{"n":1,"s":"neg', items).map((v) => v.id), ["b"]);
});

test("AI chấm lại cảm xúc, bật chuông khi bài thành tiêu cực và gỡ chuông báo nhầm", async () => {
  const store = seeded();
  store.insertAlert({ id: "neg", topicId: null, name: "Kêu ca", kind: "negative", phrase: "", minLikes: 0, createdAt: new Date().toISOString() });
  const before = store.listPendingNotices().map((h) => h.text);
  assert.ok(before.some((t) => t.startsWith("hàng tệ")), "bộ đếm từ thấy bài 2 tiêu cực");
  assert.ok(!before.some((t) => t.startsWith("ngon quá cơ")), "bộ đếm từ bỏ sót câu mỉa mai");

  let prompt = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    prompt = (JSON.parse(String(init?.body)) as { messages: { content: string }[] }).messages[0]!.content;
    const verdicts = prompt.split("\n").map((line, i) =>
      line.includes("ngon quá cơ")
        ? { n: i + 1, s: "negative", r: "mỉa mai giao chậm" }
        : line.includes("hàng tệ")
          ? { n: i + 1, s: "negative", r: "chê hàng" }
          : { n: i + 1, s: "neutral", r: "hỏi giờ" },
    );
    return reply(verdicts)(input, init);
  };
  assert.equal(aiSentimentEnabled(aiCfg), true);
  assert.equal(aiSentimentEnabled({ ...aiCfg, AI_SENTIMENT: "0" }), false);
  const status = await runAiSentiment(store, aiCfg, { fetchImpl });
  assert.match(prompt, /\[Rươi Co\] ngon quá cơ/);
  assert.equal(status.scored, 3);
  assert.equal(status.error, undefined);
  const texts = store.listPendingNotices().map((h) => h.text);
  assert.ok(texts.some((t) => t.startsWith("ngon quá cơ")), "câu mỉa mai giờ có chuông");

  const m1 = store.getMention("t1", "1")!;
  assert.equal(m1.sentiment, "negative");
  assert.equal(m1.sentiment_source, "ai");
  assert.equal(m1.sentiment_reason, "mỉa mai giao chậm");

  // Người sửa tay: bài thôi tiêu cực thì chuông chưa gửi bị gỡ, và AI không chấm đè nữa.
  store.applySentiment("t1", "2", { sentiment: "neutral", source: "manual" });
  assert.ok(!store.listPendingNotices().some((h) => h.text.startsWith("hàng tệ")));
  assert.equal(store.applySentiment("t1", "2", { sentiment: "negative", source: "ai" }), false);
  assert.equal(store.getMention("t1", "2")!.sentiment, "neutral");

  // Quét lại cùng bài không ghi đè nhãn AI bằng bộ đếm từ; bài đã chấm không gửi AI lần nữa.
  store.insertMention(
    { id: "1", topicId: "t1", text: "ngon quá cơ, đợi giao 2 tiếng mới tới", authorUsername: "u1", authorName: "U1", createdAt: m1.created_at, lang: "vi", likeCount: 5, repostCount: 0, replyCount: 0, quoteCount: 0 },
    new Date().toISOString(),
  );
  assert.equal(store.getMention("t1", "1")!.sentiment, "negative");
  let again = 0;
  await runAiSentiment(store, aiCfg, { fetchImpl: async () => (again++, new Response("{}")) });
  assert.equal(again, 0);
  store.close();
});

test("AI lỗi thì ghi lại, bài vẫn chờ chấm ở lượt sau", async () => {
  const store = seeded();
  const status = await runAiSentiment(store, aiCfg, { fetchImpl: async () => new Response("overloaded", { status: 529 }) });
  assert.equal(status.scored, 0);
  assert.match(status.error ?? "", /529/);
  assert.equal(store.countMentionsForAiSentiment(new Date(Date.now() - 86_400_000).toISOString()), 3);
  store.close();
});

test("báo một lần khi nguồn lỗi 3 lượt liền, báo lại khi nguồn chạy lại", async () => {
  const store = seeded();
  const sent: string[] = [];
  const fetchImpl: typeof fetch = async (_i, init) => {
    sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response("{}", { status: 200 });
  };
  const cfg = config({ ALERT_WEBHOOK_URL: "https://api.telegram.org/bot1:A/sendMessage?chat_id=5" });
  const at = new Date().toISOString();
  for (let i = 0; i < 2; i++) store.markTopicListened("t1", null, "Cookie X hết hạn (401)", at);
  await checkSourceHealth(store, cfg, { fetchImpl });
  assert.equal(sent.length, 0, "2 lượt lỗi thì chưa báo");

  store.markTopicListened("t1", null, "Cookie X hết hạn (401)", at);
  assert.equal(failingTopics(store).length, 1);
  await checkSourceHealth(store, cfg, { fetchImpl });
  await checkSourceHealth(store, cfg, { fetchImpl });
  assert.equal(sent.length, 1, "chỉ báo một lần");
  assert.match(sent[0]!, /Rươi Co \(X\): Cookie X hết hạn \(401\) — lỗi 3 lượt liền/);

  store.markTopicListened("t1", "99", null, at);
  assert.equal(failingTopics(store).length, 0);
  await checkSourceHealth(store, cfg, { fetchImpl });
  assert.equal(sent.length, 2);
  assert.match(sent[1]!, /quét lại được/);
  store.close();
});

test("thẻ bài ghi rõ nhãn do AI hay người sửa", () => {
  const row = {
    id: "m1", topic_id: "t1", topic_name: "Rươi Co", text: "x", author_username: "a", author_name: "A", created_at: new Date().toISOString(),
    lang: "vi", like_count: 0, repost_count: 0, reply_count: 0, quote_count: 0, url: "", sentiment: "negative", sentiment_score: -2,
    sample: 0, fetched_at: "", starred: 0, hidden: 0, note: "", queue: "new", assigned_to: "", tag: "",
    sentiment_source: "ai", sentiment_reason: "mỉa mai",
  } satisfies MentionRow;
  const html = renderMentionCard(row, 0, "", [], true);
  assert.match(html, /title="AI chấm: mỉa mai"/);
  assert.match(html, /class="sent-src">AI</);
  assert.match(html, /action="\/mentions\/t1\/m1\/sentiment"/);
});
