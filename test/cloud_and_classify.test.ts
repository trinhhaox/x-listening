import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/db.js";
import { extractWordCloud } from "../src/cloud.js";
import { classifyMentionRuleBased, classifyMentionWithAi } from "../src/ai.js";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

const defaultConfig: AppConfig = {
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
  ADMIN_PASSWORD: "test-admin-password",
  SEARCH_MAX_RESULTS: 10,
  LLM_API_KEY: "test-key",
  LLM_BASE_URL: "https://api.openai.com/v1",
  LLM_MODEL: "gpt-4o-mini",
  ALERT_WEBHOOK_URL: "",
  DESKTOP_NOTIFY: "0",
};

test("extractWordCloud trích xuất từ khóa, lọc stop words và phân cụm chủ đề", () => {
  const sampleMentions = [
    { text: "Dịch vụ giao hàng hôm nay quá chậm trễ, shipper thái độ rất chán", sentiment: "negative" },
    { text: "Đóng gói cẩn thận, hộp đẹp, chất lượng sản phẩm tuyệt vời rất ưng ý", sentiment: "positive" },
    { text: "Giá cả hơi đắt nhưng chất lượng tốt, ủng hộ shop dài dài", sentiment: "positive" },
    { text: "Nhân viên tư vấn nhiệt tình, hỗ trợ giải quyết đơn hàng nhanh chóng", sentiment: "positive" },
    { text: "Sản phẩm bị lỗi hỏng bao bì khi nhận hàng, yêu cầu đổi trả", sentiment: "negative" },
  ];

  const cloud = extractWordCloud(sampleMentions, 20);

  // Phải có danh sách từ khóa
  assert.ok(cloud.words.length > 0, "Phải có từ khóa");
  // Các từ khóa không được chứa stop words như 'và', 'là', 'quá', 'rất'
  for (const w of cloud.words) {
    assert.notEqual(w.text, "quá");
    assert.notEqual(w.text, "rất");
    assert.notEqual(w.text, "hôm nay");
  }

  // Cụm chủ đề phải được nhận diện
  const clusters = cloud.clusters;
  assert.ok(clusters.length > 0, "Phải có cụm chủ đề");
  const shippingCluster = clusters.find((c) => c.id === "shipping");
  const productCluster = clusters.find((c) => c.id === "product");
  assert.ok(shippingCluster, "Phải có cụm Vận chuyển & Đóng gói");
  assert.ok(productCluster, "Phải có cụm Chất lượng Sản phẩm");
});

test("classifyMentionRuleBased phân loại chính xác theo chủ đề và nhân sự phụ trách", () => {
  // Test Giao hàng
  const r1 = classifyMentionRuleBased("Đơn hàng của mình bị shipper giao trễ 3 ngày rồi");
  assert.equal(r1.tag, "Giao hàng");
  assert.equal(r1.assignedTo, "@VanHanh");

  // Test Dịch vụ
  const r2 = classifyMentionRuleBased("Thái độ nhân viên tư vấn qua hotline quá tệ");
  assert.equal(r2.tag, "Dịch vụ");
  assert.equal(r2.assignedTo, "@CSKH");

  // Test Chất lượng Sản phẩm
  const r3 = classifyMentionRuleBased("Chất lượng hương vị đợt này có vấn đề, lỗi đóng gói");
  assert.equal(r3.tag, "Sản phẩm");
  assert.equal(r3.assignedTo, "@KyThuat");

  // Test Giá cả
  const r4 = classifyMentionRuleBased("Có mã giảm giá voucher khuyến mãi nào cho khách quen không?");
  assert.equal(r4.tag, "Giá cả");
  assert.equal(r4.assignedTo, "@KinhDoanh");

  // Test Khen ngợi
  const r5 = classifyMentionRuleBased("Sản phẩm xuất sắc, 10 điểm tuyệt vời, rất hài lòng");
  assert.equal(r5.tag, "Khen ngợi");
  assert.equal(r5.assignedTo, "@CSKH");
});

test("classifyMentionWithAi gọi LLM hoặc fallback rule-based an toàn", async () => {
  // Khi không có LLM key -> fallback rule-based
  const rNoKey = await classifyMentionWithAi("Giao hàng quá chậm phí ship đắt", { apiKey: "" });
  assert.equal(rNoKey.tag, "Giao hàng");

  // Khi có mock LLM phản hồi JSON chuẩn
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                tag: "Sản phẩm",
                assignedTo: "@KyThuat",
                reason: "Khách phản ánh lỗi kỹ thuật sản phẩm",
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const rAi = await classifyMentionWithAi("Thiết bị dùng bị nóng máy quá", {
    apiKey: "test-ai-key",
    fetchImpl: mockFetch,
  });
  assert.equal(rAi.tag, "Sản phẩm");
  assert.equal(rAi.assignedTo, "@KyThuat");
});

test("Store tự động phân loại khi insertMention và hỗ trợ batch auto-classify", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "topic-1",
    name: "Cà phê",
    query: "cà phê",
    excludeReposts: false,
    createdAt: new Date().toISOString(),
  });

  // Khi insert mention mới, hệ thống tự động gán nhãn và người phụ trách
  store.insertMention(
    {
      id: "m-1",
      topicId: "topic-1",
      text: "Shipper giao hàng chậm quá trời, chờ mãi không thấy đơn",
      authorUsername: "user1",
      authorName: "Khách 1",
      createdAt: new Date().toISOString(),
      lang: "vi",
      likeCount: 2,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    },
    new Date().toISOString(),
  );

  const mention = store.getMention("topic-1", "m-1");
  assert.ok(mention);
  assert.equal(mention.tag, "Giao hàng");
  assert.equal(mention.assigned_to, "@VanHanh");

  // Chạy autoClassifyMention thủ công
  store.autoClassifyMention("topic-1", "m-1", { tag: "Dịch vụ", assignedTo: "@CSKH" });
  const updated = store.getMention("topic-1", "m-1");
  assert.equal(updated?.tag, "Dịch vụ");
  assert.equal(updated?.assigned_to, "@CSKH");
});

test("API /api/wordcloud trả về JSON đám mây từ khóa và cụm chủ đề", async () => {
  const store = Store.open(":memory:");
  store.insertTopic({
    id: "t1",
    name: "Trà sữa",
    query: "trà sữa",
    excludeReposts: false,
    createdAt: new Date().toISOString(),
  });

  store.insertMention(
    {
      id: "m1",
      topicId: "t1",
      text: "Trà sữa ngon tuyệt vời, giao hàng đóng gói rất cẩn thận",
      authorUsername: "u1",
      authorName: "Khách trà sữa",
      createdAt: new Date().toISOString(),
      lang: "vi",
      likeCount: 5,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    },
    new Date().toISOString(),
  );

  const { app } = createApp(defaultConfig, store);
  const res = await app.request("/api/wordcloud?topic=t1");
  assert.equal(res.status, 200);
  const json = (await res.json()) as { ok: boolean; data: { words: unknown[]; clusters: unknown[] } };
  assert.equal(json.ok, true);
  assert.ok(Array.isArray(json.data.words));
  assert.ok(Array.isArray(json.data.clusters));
});
