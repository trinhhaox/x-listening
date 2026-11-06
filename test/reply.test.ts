import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { buildReplyPrompt, cleanReply, fillTemplate } from "../src/ai.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { issueSession } from "../src/auth.js";
import { computeResponseStats, formatDuration, responseSummary } from "../src/response.js";
import { responseCard } from "../src/views/brief.js";

function setup() {
  const store = Store.open(":memory:");
  store.insertTopic({ id: "t1", name: "Rươi Co", query: "rươi", excludeReposts: true, createdAt: "2026-01-01T00:00:00Z" });
  const now = new Date().toISOString();
  store.insertMention(
    { id: "m1", topicId: "t1", text: "giao chậm quá, thất vọng", authorUsername: "lan", authorName: "Lan", createdAt: now, lang: "vi", likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 },
    now,
  );
  return store;
}

const form = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { cookie: `xl_session=${issueSession("mat-khau-dai")}`, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

test("mẫu câu: thay {tên}, làm sạch câu AI, đưa mẫu vào lời nhắc", () => {
  assert.equal(fillTemplate("Chào {tên}, mình xin lỗi.", "Lan"), "Chào Lan, mình xin lỗi.");
  assert.equal(fillTemplate("Chào { name }!", ""), "Chào bạn!");
  assert.equal(cleanReply('Câu trả lời: "Dạ chúng mình cảm ơn ạ."'), "Dạ chúng mình cảm ơn ạ.");
  const prompt = buildReplyPrompt({ topicName: "Rươi Co", authorName: "Lan", text: "dở", sentiment: "negative", templates: [{ name: "Xin lỗi", content: "Inbox 0909" }], previous: "nháp cũ" });
  assert.match(prompt, /Thương hiệu: Rươi Co/);
  assert.match(prompt, /tiêu cực/);
  assert.match(prompt, /Inbox 0909/);
  assert.match(prompt, /nháp cũ/);
});

test("soạn trả lời: lưu nháp, AI viết lại, lưu và đánh dấu xong", async () => {
  const store = setup();
  store.insertTemplate({ id: "tp", name: "Xin lỗi", content: "Chào {tên}, inbox giúp mình mã đơn nhé.", createdAt: new Date().toISOString() });
  const config = { ...loadConfig({ ADMIN_PASSWORD: "mat-khau-dai", DESKTOP_NOTIFY: "0" }) };
  const { app } = createApp(config, store);

  // Không có khóa AI: chèn mẫu đầu tiên.
  let res = await app.request("/mentions/t1/m1/reply", form({ op: "ai", reply_draft: "" }));
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location") ?? "", /#reply-t1-m1$/);
  assert.equal(store.getMention("t1", "m1")!.reply_draft, "Chào Lan, inbox giúp mình mã đơn nhé.");

  await app.request("/mentions/t1/m1/reply", form({ op: "save", reply_draft: "  Dạ mình xin lỗi Lan ạ.  " }));
  assert.equal(store.getMention("t1", "m1")!.reply_draft, "Dạ mình xin lỗi Lan ạ.");

  // Có khóa AI: gửi kèm bài gốc và nháp cũ.
  store.setSetting("LLM_API_KEY", "k");
  store.setSetting("LLM_BASE_URL", "https://api.anthropic.com/v1");
  let sent = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = String(init?.body);
    return new Response(JSON.stringify({ content: [{ type: "text", text: '"Dạ chúng mình rất tiếc, Lan inbox mã đơn giúp mình nhé."' }] }), { status: 200 });
  }) as typeof fetch;
  try {
    res = await app.request("/mentions/t1/m1/reply", form({ op: "ai", reply_draft: "Dạ mình xin lỗi Lan ạ." }));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(res.status, 302);
  assert.match(sent, /giao chậm quá/);
  assert.match(sent, /Dạ mình xin lỗi Lan ạ/);
  assert.equal(store.getMention("t1", "m1")!.reply_draft, "Dạ chúng mình rất tiếc, Lan inbox mã đơn giúp mình nhé.");

  await app.request("/mentions/t1/m1/reply", form({ op: "done", reply_draft: "Bản cuối" }));
  const m = store.getMention("t1", "m1")!;
  assert.equal(m.queue, "done");
  assert.equal(m.reply_draft, "Bản cuối");
  assert.ok(m.done_at && m.reading_at);

  const html = await (await app.request("/", { headers: { cookie: `xl_session=${issueSession("mat-khau-dai")}` } })).text();
  assert.match(html, /id="reply-t1-m1" open/);
  assert.match(html, /Bản cuối<\/textarea>/);
  assert.match(html, /Chèn mẫu câu/);
  store.close();
});

test("mốc xử lý: mở lại thì xóa mốc xong, giữ mốc nhận việc đầu tiên", () => {
  const store = setup();
  store.setMentionQueue("t1", "m1", "reading", "2026-01-01T01:00:00.000Z");
  store.setMentionQueue("t1", "m1", "done", "2026-01-01T02:00:00.000Z");
  store.setMentionQueue("t1", "m1", "done", "2026-01-01T05:00:00.000Z");
  let m = store.getMention("t1", "m1")!;
  assert.equal(m.reading_at, "2026-01-01T01:00:00.000Z");
  assert.equal(m.done_at, "2026-01-01T02:00:00.000Z", "bấm Đã xong lần nữa không đổi mốc");
  store.setMentionQueue("t1", "m1", "new", "2026-01-01T06:00:00.000Z");
  m = store.getMention("t1", "m1")!;
  assert.equal(m.done_at, null);
  assert.equal(m.reading_at, "2026-01-01T01:00:00.000Z");
  store.close();
});

test("thống kê tốc độ xử lý bài tiêu cực", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toISOString();
  const rows = [
    { queue: "done" as const, assigned_to: "@CSKH", fetched_at: at(0), done_at: at(1) },
    { queue: "done" as const, assigned_to: "@CSKH", fetched_at: at(0), done_at: at(3) },
    { queue: "done" as const, assigned_to: "@PR", fetched_at: at(0), done_at: at(5) },
    { queue: "new" as const, assigned_to: "", fetched_at: at(0), done_at: null },
    { queue: "reading" as const, assigned_to: "@PR", fetched_at: at(40), done_at: null },
  ];
  const stats = computeResponseStats(rows, new Date(at(48)), 7);
  assert.equal(stats.negative, 5);
  assert.equal(stats.done, 3);
  assert.equal(stats.open, 2);
  assert.equal(stats.overdue, 1);
  assert.equal(stats.medianMinutes, 180);
  assert.equal(formatDuration(stats.medianMinutes), "3 giờ");
  assert.equal(formatDuration(45), "45 phút");
  assert.equal(formatDuration(60 * 26 + 5), "1 ngày 2 giờ");
  assert.deepEqual(
    stats.byAssignee.map((p) => [p.name, p.done, p.open]),
    [["@PR", 1, 1], ["Chưa gán", 0, 1], ["@CSKH", 2, 0]],
  );
  assert.equal(responseSummary(stats), "Xử lý bài tiêu cực 7 ngày: xong 3/5 · trung vị 3 giờ · còn mở 2 · 1 bài chờ quá 24 giờ");
  assert.equal(responseSummary(computeResponseStats([], new Date(), 7)), "");
  const card = responseCard(stats);
  assert.match(card, /3\/5/);
  assert.match(card, /1 chờ quá 24 giờ/);
});
