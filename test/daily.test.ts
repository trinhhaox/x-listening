import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, type AppConfig } from "../src/config.js";
import { dueReport, normalizeReportTime, retentionCutoff, runDailyJobs } from "../src/daily.js";
import { Store } from "../src/db.js";
import { buildWebhookPayload, deliverExecutiveReport, telegramChatId } from "../src/notify.js";

const TG = "https://api.telegram.org/bot123:ABC/sendMessage?chat_id=-100987";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig({ ADMIN_PASSWORD: "mat-khau-dai", DESKTOP_NOTIFY: "0" }), ...overrides };
}

function seed(store: Store, id: string, createdAt: string): void {
  store.insertMention(
    {
      id,
      topicId: "t1",
      text: `bài ${id} tệ quá`,
      authorUsername: `u${id}`,
      authorName: `U ${id}`,
      createdAt,
      lang: "vi",
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    },
    createdAt,
  );
}

function storeWithTopic(): Store {
  const store = Store.open(":memory:");
  store.insertTopic({ id: "t1", name: "Thương hiệu", query: "abc", excludeReposts: true, createdAt: "2026-01-01T00:00:00Z" });
  return store;
}

test("giờ gửi bản tin được chuẩn hóa, sai dạng thì tắt", () => {
  assert.equal(normalizeReportTime("8:05"), "08:05");
  assert.equal(normalizeReportTime(" 18:30 "), "18:30");
  assert.equal(normalizeReportTime("24:00"), "");
  assert.equal(normalizeReportTime("abc"), "");
  assert.equal(normalizeReportTime(""), "");
});

test("bản tin buổi sáng tổng kết hôm qua, buổi chiều tổng kết hôm nay, mỗi ngày một lần", () => {
  const morning = new Date("2026-11-06T01:30:00Z"); // 08:30 giờ Việt Nam
  assert.equal(dueReport(morning, "09:00", undefined), null, "chưa đến giờ");
  assert.deepEqual(dueReport(morning, "08:00", undefined), { day: "2026-11-05", sendDay: "2026-11-06" });
  assert.equal(dueReport(morning, "08:00", "2026-11-06"), null, "đã gửi hôm nay");
  const evening = new Date("2026-11-06T11:00:00Z"); // 18:00
  assert.deepEqual(dueReport(evening, "17:30", "2026-11-05"), { day: "2026-11-06", sendDay: "2026-11-06" });
  assert.equal(dueReport(evening, "", undefined), null, "tắt");
});

test("mốc giữ bài: 0 là tắt, dưới 7 ngày được nâng lên 7", () => {
  const now = new Date("2026-11-06T00:00:00Z");
  assert.equal(retentionCutoff(now, 0), null);
  assert.equal(retentionCutoff(now, 3), "2026-10-30T00:00:00.000Z");
  assert.equal(retentionCutoff(now, 30), "2026-10-07T00:00:00.000Z");
});

test("Telegram: nhận đúng địa chỉ Bot API và gửi chat_id cùng nội dung chữ", async () => {
  assert.equal(telegramChatId(TG), "-100987");
  assert.equal(telegramChatId("https://api.telegram.org/bot123:ABC/sendMessage"), null);
  assert.equal(telegramChatId("https://example.com/bot1/sendMessage?chat_id=1"), null);

  const hit = buildWebhookPayload(TG, {
    id: "h1",
    alertName: "Bài xấu",
    reason: "Nghiêng xấu",
    authorName: "An",
    topicName: "Thương hiệu",
    text: "Dịch vụ tệ",
  }) as { chat_id: string; text: string };
  assert.equal(hit.chat_id, "-100987");
  assert.match(hit.text, /Chuông: Bài xấu/);
  assert.match(hit.text, /Dịch vụ tệ/);

  let sent: { url: string; body: { chat_id: string; text: string } } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent = { url, body: JSON.parse(String(init.body)) };
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const error = await deliverExecutiveReport(
    { day: "2026-11-05", posts: 4, negativeCount: 1, aiSummary: "Ổn định.", title: "Bản tin tự động ngày 05/11/2026" },
    { webhookUrl: TG, fetchImpl },
  );
  assert.equal(error, null);
  assert.equal(sent?.body.chat_id, "-100987");
  assert.match(sent!.body.text, /Bản tin tự động ngày 05\/11\/2026/);
  assert.match(sent!.body.text, /4 bài · 1 nghiêng xấu/);
  assert.match(sent!.body.text, /Ổn định\./);
});

test("việc hằng ngày gửi bản tin của hôm qua đúng một lần và ghi lại kết quả", async () => {
  const store = storeWithTopic();
  seed(store, "a", "2026-11-05T03:00:00Z"); // 10:00 ngày 05/11 giờ VN
  seed(store, "b", "2026-11-05T05:00:00Z");
  seed(store, "c", "2026-11-06T01:00:00Z"); // sáng 06/11, không thuộc bản tin hôm qua
  const bodies: Array<{ report: string; posts: number }> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const cfg = config({ DAILY_REPORT_TIME: "08:00", ALERT_WEBHOOK_URL: "https://hooks.example.com/x" });
  const now = new Date("2026-11-06T01:30:00Z");

  const first = await runDailyJobs(store, cfg, { now, fetchImpl });
  assert.equal(first.reportSent, "2026-11-05");
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]!.posts, 2);

  const second = await runDailyJobs(store, cfg, { now: new Date(now.getTime() + 60_000), fetchImpl });
  assert.equal(second.reportSent, undefined);
  assert.equal(bodies.length, 1, "không gửi lặp");
  store.close();
});

test("gửi lỗi thì ghi lỗi lại, không thử lại mỗi phút", async () => {
  const store = storeWithTopic();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("no", { status: 500 });
  }) as unknown as typeof fetch;
  const cfg = config({ DAILY_REPORT_TIME: "08:00", ALERT_WEBHOOK_URL: "https://hooks.example.com/x" });
  const now = new Date("2026-11-06T01:30:00Z");
  const result = await runDailyJobs(store, cfg, { now, fetchImpl });
  assert.match(result.reportError ?? "", /500/);
  await runDailyJobs(store, cfg, { now: new Date(now.getTime() + 60_000), fetchImpl });
  assert.equal(calls, 1);
  assert.match(store.getSetting("DAILY_REPORT_LAST_RESULT") ?? "", /500/);
  store.close();
});

test("dọn bài cũ nhưng giữ bài đã ghim, có ghi chú hoặc đang xử lý; nhãn tự động không giữ được bài", async () => {
  const store = storeWithTopic();
  const old = "2026-09-01T00:00:00Z";
  for (const id of ["plain", "star", "note", "tag", "who", "reading"]) seed(store, id, old);
  seed(store, "fresh", "2026-11-05T00:00:00Z");
  store.toggleMention("t1", "star", "starred");
  store.setMentionNote("t1", "note", "đã gọi khách");
  store.setMentionTag("t1", "tag", "Khẩn cấp");
  store.setMentionAssignee("t1", "who", "Tuấn");
  store.setMentionQueue("t1", "reading", "reading");

  const cfg = config({ RETENTION_DAYS: 30 });
  const now = new Date("2026-11-06T01:30:00Z");
  const result = await runDailyJobs(store, cfg, { now });
  assert.equal(result.pruned, 3);
  for (const id of ["plain", "tag", "who"]) assert.equal(store.getMention("t1", id), null, `xóa ${id}`);
  for (const id of ["star", "note", "reading", "fresh"]) {
    assert.ok(store.getMention("t1", id), `giữ ${id}`);
  }
  const again = await runDailyJobs(store, cfg, { now: new Date(now.getTime() + 60_000) });
  assert.equal(again.pruned, undefined, "mỗi ngày dọn một lần");
  store.close();
});
