import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { classifyMentionRuleBased, classifyMentionWithAi } from "../ai.js";
import { muteKey } from "../db.js";
import { pageKey } from "../facebook.js";
import { threadsUserKey } from "../threads.js";
import { buildSearchQuery } from "../query.js";
import { lexiconWord } from "../sentiment.js";
import { safeKey, isQueue, deskPath, backFrom } from "../http/helpers.js";
import { getRuntimeConfig } from "../runtime_config.js";
import type { AppContext } from "../http/context.js";

/** Các nút bấm trên giao diện (form POST rồi chuyển hướng về trang). */
export function registerActionsRoutes(app: Hono, ctx: AppContext): void {
  const { config, store, runListen, fanOutHits } = ctx;

  app.post("/topics", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim().slice(0, 80);
    const rawQuery = String(body.query ?? "");
    const source = ["facebook", "threads", "youtube", "web"].includes(body.source as string)
      ? (body.source as "facebook" | "threads" | "youtube" | "web")
      : "x";
    const phrase = String(body.phrase ?? "").trim().slice(0, 80);
    const exclude = body.exclude_reposts === "on" || body.exclude_reposts === "true";
    if (!name) return c.redirect("/?notice=" + encodeURIComponent("Thiếu tên nguồn theo dõi."));
    let query = rawQuery.replace(/\s+/g, " ").trim();
    if (!query) {
      return c.redirect("/?notice=" + encodeURIComponent("Câu truy vấn, từ khóa hoặc link không được để trống."));
    }

    if (source === "facebook") {
      const page = pageKey(query);
      if (page) {
        query = page;
      }
    } else if (source === "threads") {
      const user = threadsUserKey(query);
      if (user) {
        query = user;
      }
    } else if (source === "x") {
      try {
        buildSearchQuery(query, exclude);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Câu truy vấn không dùng được";
        return c.redirect("/?notice=" + encodeURIComponent(message));
      }
    }
    store.insertTopic({
      id: randomUUID(),
      name,
      query,
      excludeReposts: source === "x" && exclude,
      source,
      phrase: source === "facebook" || source === "threads" ? phrase : "",
      createdAt: new Date().toISOString(),
    });
    return c.redirect("/?notice=" + encodeURIComponent(`Đã thêm nguồn theo dõi “${name}”.`));
  });

  app.post("/topics/:id/toggle", (c) => {
    const topic = store.getTopic(c.req.param("id"));
    if (topic) store.setTopicActive(topic.id, topic.active !== 1);
    return c.redirect("/");
  });

  app.post("/topics/:id/backfill", async (c) => {
    const id = c.req.param("id");
    if (!safeKey(id) || !store.getTopic(id)) return c.redirect(deskPath("", "wire", "Không tìm thấy nguồn theo dõi này."));
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const report = await runListen({ onlyTopicId: id, startTime: start });
    const notice = [`Ghi nhận ${report.saved} bài trong 7 ngày qua.`, ...report.errors].filter(Boolean).join(" ");
    return c.redirect(deskPath("", "wire", notice));
  });

  app.post("/topics/:id/delete", (c) => {
    store.deleteTopic(c.req.param("id"));
    return c.redirect("/?notice=" + encodeURIComponent("Đã xóa nguồn theo dõi."));
  });

  app.post("/listen", async (c) => {
    const report = await runListen();
    const notice = report.errors.length
      ? `Ghi nhận ${report.saved} bài từ ${report.topics} nguồn theo dõi. ${report.errors.join(" ")}`
      : `Đã quét ${report.topics} nguồn theo dõi, ghi nhận ${report.saved} bài viết mới.`;
    return c.redirect("/?notice=" + encodeURIComponent(notice));
  });

  app.post("/lexicon", async (c) => {
    const body = await c.req.parseBody();
    const word = lexiconWord(String(body.word ?? ""));
    const polarity = body.polarity === "negative" ? "negative" : body.polarity === "positive" ? "positive" : "";
    if (!word || !polarity) return c.redirect(deskPath("", "wire", "Từ cần là một cụm chữ, tối đa ba tiếng."));
    const changed = store.setLexiconWord(word, polarity, new Date().toISOString());
    return c.redirect(deskPath("", "wire", `Đã thêm “${word}”. Chấm lại ${changed} bài.`));
  });

  app.post("/lexicon/delete", async (c) => {
    const body = await c.req.parseBody();
    const word = lexiconWord(String(body.word ?? ""));
    if (!word) return c.redirect(deskPath("", "wire", "Không còn từ này."));
    const changed = store.deleteLexiconWord(word);
    return c.redirect(deskPath("", "wire", `Đã gỡ “${word}”. Chấm lại ${changed} bài.`));
  });

  app.post("/samples", (c) => {
    const count = store.seedSamples();
    return c.redirect("/?notice=" + encodeURIComponent(`Đã nạp ${count} tin mẫu.`));
  });

  app.post("/samples/clear", (c) => {
    const count = store.clearSamples();
    return c.redirect("/?notice=" + encodeURIComponent(`Đã xóa ${count} tin mẫu.`));
  });

  app.post("/alerts", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim().slice(0, 80);
    const kind = String(body.kind ?? "");
    const phrase = String(body.phrase ?? "").trim().slice(0, 80);
    const minLikes = Number(body.min_likes ?? 0);
    const thresholdCount = Number(body.threshold_count ?? 3);
    const timeWindowMinutes = Number(body.time_window_minutes ?? 60);
    const topicId = String(body.topic_id ?? "");
    if (!name) return c.redirect(deskPath("", "wire", "Thiếu tên chuông."));
    if (kind !== "negative" && kind !== "phrase" && kind !== "likes" && kind !== "velocity") {
      return c.redirect(deskPath("", "wire", "Kiểu chuông không dùng được."));
    }
    if (kind === "phrase" && !phrase) return c.redirect(deskPath("", "wire", "Chuông cụm từ cần một cụm."));
    if (kind === "likes" && (!Number.isInteger(minLikes) || minLikes < 1 || minLikes > 1_000_000)) {
      return c.redirect(deskPath("", "wire", "Số thích tối thiểu chưa hợp lệ."));
    }
    if (kind === "velocity" && (!Number.isInteger(thresholdCount) || thresholdCount < 2 || !Number.isInteger(timeWindowMinutes) || timeWindowMinutes < 5 || timeWindowMinutes > 1440)) {
      return c.redirect(deskPath("", "wire", "Số bài xấu hoặc số phút của chuông bùng nổ chưa hợp lệ."));
    }
    if (topicId && !store.getTopic(topicId)) return c.redirect(deskPath("", "wire", "Tần số của chuông không còn."));
    const found = store.insertAlert({
      id: randomUUID(),
      topicId: topicId || null,
      name,
      kind,
      phrase: kind === "phrase" ? phrase : "",
      minLikes: kind === "likes" ? minLikes : 0,
      thresholdCount: kind === "velocity" ? thresholdCount : undefined,
      timeWindowMinutes: kind === "velocity" ? timeWindowMinutes : undefined,
      createdAt: new Date().toISOString(),
    });
    await fanOutHits();
    return c.redirect(deskPath("", "wire", `Đã đặt chuông “${name}”, khớp ${found} bài đang có.`));
  });

  app.post("/alerts/:id/delete", async (c) => {
    const id = c.req.param("id");
    if (safeKey(id)) store.deleteAlert(id);
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, "Đã gỡ chuông."));
  });

  app.post("/alerts/hits/:id/seen", async (c) => {
    const id = c.req.param("id");
    if (safeKey(id)) store.seeHit(id);
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view));
  });

  app.post("/mentions/:topicId/:mentionId/star", async (c) => {
    await changeMention(c, "starred");
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view));
  });

  app.post("/mentions/:topicId/:mentionId/hide", async (c) => {
    await changeMention(c, "hidden");
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view));
  });

  app.post("/mentions/:topicId/:mentionId/queue", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const body = await c.req.parseBody();
    const queue = String(body.queue ?? "");
    if (safeKey(topicId) && safeKey(mentionId) && isQueue(queue)) store.setMentionQueue(topicId, mentionId, queue);
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, undefined, back));
  });

  app.post("/mutes", async (c) => {
    const body = await c.req.parseBody();
    const username = String(body.username ?? "");
    const back = await backFrom(c);
    if (!muteKey(username) || !store.muteAuthor(username, new Date().toISOString())) {
      return c.redirect(deskPath(back.topic, back.view, "Tên tài khoản không dùng được.", back));
    }
    return c.redirect(deskPath(back.topic, back.view, `Đã tắt tiếng @${muteKey(username)}.`, back));
  });

  app.post("/mutes/:username/delete", async (c) => {
    store.unmuteAuthor(c.req.param("username"));
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, "Đã bỏ tắt tiếng.", back));
  });

  app.post("/mentions/:topicId/:mentionId/note", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const body = await c.req.parseBody();
    if (safeKey(topicId) && safeKey(mentionId)) {
      store.setMentionNote(topicId, mentionId, String(body.note ?? "").trim());
    }
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, undefined, back));
  });

  app.post("/mentions/:topicId/:mentionId/assign", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const body = await c.req.parseBody();
    if (safeKey(topicId) && safeKey(mentionId)) {
      store.setMentionAssignee(topicId, mentionId, String(body.assigned_to ?? "").trim().slice(0, 40));
    }
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, undefined, back));
  });

  app.post("/mentions/:topicId/:mentionId/tag", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const body = await c.req.parseBody();
    if (safeKey(topicId) && safeKey(mentionId)) {
      store.setMentionTag(topicId, mentionId, String(body.tag ?? "").trim().slice(0, 40));
    }
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, undefined, back));
  });

  app.post("/mentions/:topicId/:mentionId/sentiment", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const body = await c.req.parseBody();
    const value = String(body.sentiment ?? "");
    const back = await backFrom(c);
    if (safeKey(topicId) && safeKey(mentionId) && (value === "positive" || value === "neutral" || value === "negative")) {
      store.applySentiment(topicId, mentionId, { sentiment: value, source: "manual" });
      await fanOutHits();
      const label = value === "positive" ? "Tích cực" : value === "negative" ? "Tiêu cực" : "Trung tính";
      return c.redirect(deskPath(back.topic, back.view, `Đã sửa cảm xúc thành “${label}”. AI sẽ không chấm đè bài này.`, back));
    }
    return c.redirect(deskPath(back.topic, back.view, undefined, back));
  });

  app.post("/mentions/auto-classify", async (c) => {
    const body = await c.req.parseBody();
    const topic = String(body.topic ?? "").trim();
    const unclassified = store.listUnclassifiedMentions(120, topic || undefined);

    let count = 0;
    for (const m of unclassified) {
      const routing = classifyMentionRuleBased(m.text);
      if (store.autoClassifyMention(m.topic_id, m.id, { tag: routing.tag, assignedTo: routing.assignedTo })) {
        count++;
      }
    }

    const back = await backFrom(c);
    const msg = count > 0
      ? `⚡ Đã phân loại & điều phối thành công ${count} bài viết.`
      : "Không có bài viết nào cần phân loại thêm.";
    return c.redirect(deskPath(back.topic, back.view, msg, back));
  });

  app.post("/mentions/:topicId/:mentionId/auto-classify", async (c) => {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    const activeConfig = getRuntimeConfig(config, store);
    const mention = store.getMention(topicId, mentionId);

    if (safeKey(topicId) && safeKey(mentionId) && mention) {
      const routing = await classifyMentionWithAi(mention.text, {
        apiKey: activeConfig.LLM_API_KEY,
        baseUrl: activeConfig.LLM_BASE_URL,
        model: activeConfig.LLM_MODEL,
      });
      store.autoClassifyMention(topicId, mentionId, { tag: routing.tag, assignedTo: routing.assignedTo });
      const back = await backFrom(c);
      return c.redirect(
        deskPath(back.topic, back.view, `⚡ Đã gắn #${routing.tag} & gán ${routing.assignedTo} (${routing.reason}).`, back),
      );
    }

    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, undefined, back));
  });

  app.post("/templates", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim().slice(0, 80);
    const content = String(body.content ?? "").trim().slice(0, 1000);
    const back = await backFrom(c);
    if (!name || !content) {
      return c.redirect(deskPath(back.topic, back.view, "Cần nhập cả tên mẫu và nội dung.", back));
    }
    store.insertTemplate({
      id: randomUUID(),
      name,
      content,
      createdAt: new Date().toISOString(),
    });
    return c.redirect(deskPath(back.topic, back.view, `Đã thêm mẫu “${name}”.`, back));
  });

  app.post("/templates/:id/delete", async (c) => {
    const id = c.req.param("id");
    if (safeKey(id)) {
      store.deleteTemplate(id);
    }
    const back = await backFrom(c);
    return c.redirect(deskPath(back.topic, back.view, "Đã xóa mẫu phản hồi.", back));
  });

  async function changeMention(c: { req: { param: (name: string) => string } }, field: "starred" | "hidden") {
    const topicId = c.req.param("topicId");
    const mentionId = c.req.param("mentionId");
    if (safeKey(topicId) && safeKey(mentionId)) store.toggleMention(topicId, mentionId, field);
  }
}
