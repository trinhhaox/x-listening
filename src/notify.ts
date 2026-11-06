import { execFile } from "node:child_process";
import { riskLabel, splitRisk } from "./digest.js";
import { markdownToPlain } from "./views/markdown.js";

export type HitNotice = {
  id: string;
  alertName: string;
  reason: string;
  authorName: string;
  topicName: string;
  text: string;
};

export function webhookTarget(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash) return null;
  const host = url.hostname.toLowerCase();
  const local = host === "127.0.0.1" || host === "localhost";
  if (url.protocol === "http:" && local) return url.toString();
  if (url.protocol === "https:") return url.toString();
  return null;
}

/**
 * Telegram Bot API: https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>.
 * Trả về chat_id khi địa chỉ đúng dạng đó, ngược lại null.
 */
export function telegramChatId(target: string): string | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== "api.telegram.org") return null;
  if (!/^\/bot[^/]+\/sendMessage$/.test(url.pathname)) return null;
  const chatId = url.searchParams.get("chat_id")?.trim();
  return chatId ? chatId : null;
}

function telegramPayload(chatId: string, text: string): unknown {
  return { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true };
}

export function buildWebhookPayload(target: string, hit: HitNotice): unknown {
  const url = target.toLowerCase();
  const chatId = telegramChatId(target);
  if (chatId) {
    return telegramPayload(
      chatId,
      `🔔 Chuông: ${clip(hit.alertName, 80)}\n${clip(hit.reason, 160)}\nTần số: ${clip(hit.topicName, 80)} · Tác giả: ${clip(hit.authorName, 80)}\n\n${clip(hit.text, 280)}`,
    );
  }
  if (url.includes("discord.com/api/webhooks")) {
    return {
      content: `🔔 **Chuông:** ${clip(hit.alertName, 80)}`,
      embeds: [
        {
          title: clip(hit.reason, 160),
          description: clip(hit.text, 280),
          fields: [
            { name: "Tần số", value: clip(hit.topicName, 80), inline: true },
            { name: "Tác giả", value: clip(hit.authorName, 80), inline: true },
          ],
          color: 15158332,
        },
      ],
    };
  }

  if (url.includes("hooks.slack.com")) {
    return {
      text: `🔔 *Chuông: ${clip(hit.alertName, 80)}* - ${clip(hit.reason, 160)}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🔔 *Chuông: ${clip(hit.alertName, 80)}*\n*Lý do:* ${clip(hit.reason, 160)}\n*Tần số:* ${clip(hit.topicName, 80)} · *Tác giả:* ${clip(hit.authorName, 80)}\n>${clip(hit.text, 280)}`,
          },
        },
      ],
    };
  }

  return {
    alert: clip(hit.alertName, 80),
    reason: clip(hit.reason, 160),
    author: clip(hit.authorName, 80),
    topic: clip(hit.topicName, 80),
    text: clip(hit.text, 280),
  };
}

export async function deliverHit(
  hit: HitNotice,
  options: {
    webhookUrl: string;
    desktop: boolean;
    fetchImpl?: typeof fetch;
    desktopImpl?: (title: string, body: string) => void;
  },
): Promise<string | null> {
  const title = `Chuông: ${clip(hit.alertName, 60)}`;
  const body = clip(`${hit.topicName} · ${hit.authorName}. ${hit.reason}. ${hit.text}`, 180);
  if (options.desktop) {
    const notify = options.desktopImpl ?? desktopNotify;
    notify(title, body);
  }
  const raw = options.webhookUrl.trim();
  if (!raw) return null;
  const target = webhookTarget(raw);
  if (!target) return "Webhook chuông chỉ nhận địa chỉ https, hoặc http trên máy này.";
  const payload = buildWebhookPayload(target, hit);
  const response = await (options.fetchImpl ?? fetch)(target, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) return `Webhook chuông trả về ${response.status}.`;
  return null;
}

function desktopNotify(title: string, body: string): void {
  if (process.platform !== "darwin") return;
  execFile("osascript", ["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`], { timeout: 3000 }, () => {});
}

/** Cắt độ dài nhưng giữ xuống dòng (cho phần nhận định nhiều dòng). */
function clipBlock(value: string, max: number): string {
  const text = value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export type ExecutiveReportData = {
  day: string;
  posts: number;
  negativeCount?: number;
  newAuthorsCount?: number;
  starredCount?: number;
  negative?: unknown[];
  newAuthors?: unknown[];
  starred?: unknown[];
  aiSummary?: string;
  /** Tiêu đề thay cho "Báo cáo Dư luận Điều hành ngày …", ví dụ cho báo cáo tự động. */
  title?: string;
};

export async function deliverExecutiveReport(
  brief: ExecutiveReportData,
  options:
    | {
        webhookUrl: string;
        fetchImpl?: typeof fetch;
      }
    | string,
): Promise<string | null> {
  const opts = typeof options === "string" ? { webhookUrl: options } : options;
  const raw = opts.webhookUrl.trim();
  if (!raw) return "Chưa cấu hình ALERT_WEBHOOK_URL";
  const target = webhookTarget(raw);
  if (!target) return "Webhook chỉ nhận địa chỉ https, hoặc http trên máy này.";

  const negCount = brief.negativeCount ?? brief.negative?.length ?? 0;
  const newAuthCount = brief.newAuthorsCount ?? brief.newAuthors?.length ?? 0;
  const starCount = brief.starredCount ?? brief.starred?.length ?? 0;

  const dayFormatted = brief.day.split("-").reverse().join("/");
  const statsSummary = `${brief.posts} bài · ${negCount} nghiêng xấu · ${newAuthCount} người mới · ${starCount} ghim`;
  const url = target.toLowerCase();

  // Tách dòng "MỨC RỦI RO" khỏi thân nhận định để đưa lên đầu tin.
  const split = brief.aiSummary ? splitRisk(brief.aiSummary) : undefined;
  const riskLine = split?.risk ? `Mức rủi ro: ${riskLabel(split.risk)}${split.reason ? ` — ${split.reason}` : ""}` : "";
  const aiBody = split ? split.body || brief.aiSummary!.trim() : "";
  const riskIcon = split?.risk === "high" ? "🔴" : split?.risk === "medium" ? "🟠" : split?.risk === "low" ? "🟢" : "";

  let payload: unknown;
  const chatId = telegramChatId(target);
  if (chatId) {
    const title = brief.title ?? `Báo cáo Dư luận Điều hành ngày ${dayFormatted}`;
    payload = telegramPayload(
      chatId,
      `📊 ${title}\n${statsSummary}${riskLine ? `\n${riskIcon} ${riskLine}` : ""}${aiBody ? `\n\n${markdownToPlain(aiBody).slice(0, 3200)}` : ""}`,
    );
  } else if (url.includes("discord.com/api/webhooks")) {
    payload = {
      content: `📊 **${brief.title ?? `Báo cáo Dư luận Điều hành ngày ${dayFormatted}`}**\n${statsSummary}${riskLine ? `\n${riskIcon} **${riskLine}**` : ""}`,
      embeds: aiBody
        ? [
            {
              title: "Nhận định AI",
              description: clipBlock(aiBody, 3800),
              color: 3447003,
            },
          ]
        : [],
    };
  } else if (url.includes("hooks.slack.com")) {
    payload = {
      text: `📊 *Báo cáo Dư luận Điều hành ngày ${dayFormatted}* - ${statsSummary}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📊 *Báo cáo Dư luận Điều hành ngày ${dayFormatted}*\n*Số liệu:* ${statsSummary}${riskLine ? `\n${riskIcon} *${riskLine}*` : ""}`,
          },
        },
        ...(aiBody
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: clipBlock(markdownToPlain(aiBody), 2900),
                },
              },
            ]
          : []),
      ],
    };
  } else {
    payload = {
      report: `Báo cáo Dư luận Điều hành ${dayFormatted}`,
      day: brief.day,
      posts: brief.posts,
      negative: negCount,
      newAuthors: newAuthCount,
      starred: starCount,
      aiSummary: brief.aiSummary ?? "",
      risk: split?.risk ?? "",
    };
  }

  const response = await (opts.fetchImpl ?? fetch)(target, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(6000),
  });

  if (!response.ok) return `Gửi báo cáo thất bại, webhook trả về mã ${response.status}`;
  return null;
}
