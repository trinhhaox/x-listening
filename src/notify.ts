import { execFile } from "node:child_process";

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
  const response = await (options.fetchImpl ?? fetch)(target, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      alert: clip(hit.alertName, 80),
      reason: clip(hit.reason, 160),
      author: clip(hit.authorName, 80),
      topic: clip(hit.topicName, 80),
      text: clip(hit.text, 280),
    }),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) return `Webhook chuông trả về ${response.status}.`;
  return null;
}

function desktopNotify(title: string, body: string): void {
  if (process.platform !== "darwin") return;
  execFile("osascript", ["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`], { timeout: 3000 }, () => {});
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}
