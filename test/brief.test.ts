import assert from "node:assert/strict";
import test from "node:test";
import { buildBriefUserPrompt, pickBriefSample } from "../src/ai.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { localDay, readDay, splitRisk, type DigestPost } from "../src/digest.js";
import { briefForDay, collectRefs } from "../src/http/helpers.js";
import { deliverExecutiveReport } from "../src/notify.js";
import { aiBriefCard } from "../src/views/brief.js";
import { markdownToPlain, renderMarkdown } from "../src/views/markdown.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig({ ADMIN_PASSWORD: "mat-khau-dai", DESKTOP_NOTIFY: "0" }), ...overrides };
}

function post(id: string, sentiment: string, engagement = 0, starred = 0): DigestPost {
  return {
    id,
    topicId: "t1",
    topicName: "Thương hiệu",
    text: `bài ${id}`,
    authorUsername: `u${id}`,
    authorName: `U${id}`,
    createdAt: "2026-11-06T03:00:00Z",
    sentiment,
    starred,
    engagement,
    url: `https://example.com/${id}`,
  };
}

const AI_TEXT = `MỨC RỦI RO: Trung bình — Có 2 phàn nàn về giao hàng.

## Tình hình chung
Hôm nay **nhiều** bài hơn hôm trước.

## Điểm nóng
- Giao trễ [#1]

## Việc cần làm
- [CSKH] Gọi lại khách [#1]`;

test("tách dòng mức rủi ro ở đầu nhận định", () => {
  const r = splitRisk(AI_TEXT);
  assert.equal(r.risk, "medium");
  assert.equal(r.reason, "Có 2 phàn nàn về giao hàng.");
  assert.match(r.body, /^## Tình hình chung/);
  assert.equal(splitRisk("**MỨC RỦI RO: Cao** - nóng").risk, "high");
  assert.equal(splitRisk("Mức rủi ro: thấp").risk, "low");
  assert.equal(splitRisk("Không có dòng rủi ro").risk, undefined);
});

test("readDay chỉ nhận ngày hợp lệ, không ở tương lai", () => {
  const now = new Date("2026-11-06T05:00:00Z");
  assert.equal(readDay("2026-11-01", now), "2026-11-01");
  assert.equal(readDay("2026-12-01", now), "2026-11-06");
  assert.equal(readDay("2026-02-31", now), "2026-11-06");
  assert.equal(readDay("abc", now), "2026-11-06");
  assert.equal(readDay(undefined, now), "2026-11-06");
});

test("Markdown của AI được escape, không lọt HTML", () => {
  const html = renderMarkdown(`## Tiêu đề\n- **đậm** <script>alert(1)</script> [#2]\n| a | b |\n|---|---|\n| 1 | 2 |`);
  assert.match(html, /<h3>Tiêu đề<\/h3>/);
  assert.match(html, /<strong>đậm<\/strong>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /href="#post-2"/);
  assert.match(html, /1 · 2/);
  assert.doesNotMatch(html, /---/);
  assert.equal(markdownToPlain("## Mục\n- **a** b"), "MỤC\n• a b");
});

test("chọn bài cho AI: tiêu cực trước, không trùng, theo tương tác", () => {
  const sample = pickBriefSample([post("a", "positive", 50), post("b", "negative", 1), post("c", "negative", 9), post("d", "neutral", 5, 1)], 3);
  assert.deepEqual(sample.map((p) => p.id), ["c", "b", "d"]);
  const prompt = buildBriefUserPrompt([post("a", "negative", 3)], {
    day: "2026-11-06",
    sentiment: { positive: 0, neutral: 0, negative: 1 },
    previous: { posts: 4, negative: 0, avg7: 2.5 },
    topics: [{ name: "Thương hiệu", posts: 1, negative: 1 }],
  });
  assert.match(prompt, /Ngày: 06\/11\/2026/);
  assert.match(prompt, /Hôm trước: 4 bài/);
  assert.match(prompt, /\[#1\] \[Thương hiệu\] @ua · tiêu cực · 3 tương tác/);
  assert.deepEqual(collectRefs("xem [#1] và [#9]", [post("a", "negative")]).map((r) => r.n), [1]);
});

function seededStore(): Store {
  const store = Store.open(":memory:");
  store.insertTopic({ id: "t1", name: "Thương hiệu", query: "abc", excludeReposts: true, createdAt: "2026-01-01T00:00:00Z" });
  const now = new Date().toISOString();
  store.insertMention(
    { id: "1", topicId: "t1", text: "giao hàng tệ quá", authorUsername: "lan", authorName: "Lan", createdAt: now, lang: "vi", likeCount: 2, repostCount: 0, replyCount: 1, quoteCount: 0, url: "https://x.com/lan/status/1" },
    now,
  );
  return store;
}

test("nhận định AI được lưu theo ngày, chỉ gọi lại khi dữ liệu đổi hoặc bấm viết lại", async () => {
  const store = seededStore();
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls++;
    assert.match(String(input), /api\.anthropic\.com\/v1\/messages$/);
    const body = JSON.parse(String(init?.body)) as { max_tokens: number; messages: { content: string }[] };
    assert.equal(body.max_tokens, 1200);
    assert.match(body.messages[0]!.content, /\[#1\]/);
    return new Response(JSON.stringify({ content: [{ type: "text", text: AI_TEXT }] }), { status: 200 });
  };
  const cfg = config({ LLM_API_KEY: "k", LLM_BASE_URL: "https://api.anthropic.com/v1", LLM_MODEL: "" });
  const day = localDay(new Date());

  const empty = await briefForDay(store, cfg, day, fetchImpl, { cachedOnly: true });
  assert.equal(empty.aiSummary, undefined);
  assert.equal(calls, 0);

  const first = await briefForDay(store, cfg, day, fetchImpl);
  assert.equal(calls, 1);
  assert.equal(first.risk, "medium");
  assert.equal(first.ai?.model, "claude-sonnet-5-5");
  assert.equal(first.aiRefs?.[0]?.url, "https://x.com/lan/status/1");
  assert.equal(first.negative[0]?.engagement, 3);

  await briefForDay(store, cfg, day, fetchImpl);
  assert.equal(calls, 1, "không gọi lại khi dữ liệu không đổi");

  const now = new Date().toISOString();
  store.insertMention(
    { id: "2", topicId: "t1", text: "ổn", authorUsername: "minh", authorName: "Minh", createdAt: now, lang: "vi", likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 },
    now,
  );
  const stale = await briefForDay(store, cfg, day, fetchImpl, { cachedOnly: true });
  assert.equal(stale.ai?.stale, true);
  assert.equal(calls, 1);

  await briefForDay(store, cfg, day, fetchImpl);
  assert.equal(calls, 2);
  await briefForDay(store, cfg, day, fetchImpl, { force: true });
  assert.equal(calls, 3);

  const card = aiBriefCard(stale, { hasAiKey: true });
  assert.match(card, /Mức rủi ro: Trung bình/);
  assert.match(card, /owner-chip">CSKH/);
  store.close();
});

test("lỗi AI không bị lưu, vẫn giữ bản cũ", async () => {
  const store = seededStore();
  const day = localDay(new Date());
  const cfg = config({ LLM_API_KEY: "k", LLM_BASE_URL: "https://api.anthropic.com/v1" });
  const ok: typeof fetch = async () => new Response(JSON.stringify({ content: [{ type: "text", text: AI_TEXT }] }), { status: 200 });
  const bad: typeof fetch = async () => new Response("overloaded", { status: 529 });

  const failed = await briefForDay(store, cfg, day, bad);
  assert.equal(failed.aiSummary, undefined);
  assert.match(failed.ai?.error ?? "", /529/);

  await briefForDay(store, cfg, day, ok);
  const kept = await briefForDay(store, cfg, day, bad, { force: true });
  assert.equal(kept.risk, "medium");
  assert.match(kept.ai?.error ?? "", /529/);
  store.close();
});

test("Telegram nhận mức rủi ro ở đầu và chữ không còn ký hiệu Markdown", async () => {
  let sent = "";
  const fetchImpl: typeof fetch = async (_input, init) => {
    sent = String(init?.body);
    return new Response("{}", { status: 200 });
  };
  const err = await deliverExecutiveReport(
    { day: "2026-11-06", posts: 3, negativeCount: 1, aiSummary: AI_TEXT },
    { webhookUrl: "https://api.telegram.org/bot123:ABC/sendMessage?chat_id=-100987", fetchImpl },
  );
  assert.equal(err, null);
  const text = (JSON.parse(sent) as { text: string }).text;
  assert.match(text, /🟠 Mức rủi ro: Trung bình — Có 2 phàn nàn/);
  assert.match(text, /TÌNH HÌNH CHUNG/);
  assert.doesNotMatch(text, /\*\*|##/);
});
