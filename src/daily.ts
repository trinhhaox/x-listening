import type { AppConfig } from "./config.js";
import type { Store } from "./db.js";
import { localDay, shiftDay, ZONE } from "./digest.js";
import { briefForDay } from "./http/helpers.js";
import { deliverExecutiveReport } from "./notify.js";

/** "HH:MM" theo giờ Việt Nam của một thời điểm. */
export function localTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** Chuẩn hóa giờ người dùng nhập ("8:00", "08:30"). Sai dạng thì trả về "" (tắt). */
export function normalizeReportTime(raw: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Báo cáo tự động có đến giờ gửi chưa, và gửi cho ngày nào.
 * Gửi buổi sáng (trước 12:00) thì tổng kết hôm qua; từ trưa trở đi thì tổng kết hôm nay.
 * Mỗi ngày gửi một lần; máy khởi động lại sau giờ hẹn vẫn gửi bù trong ngày.
 */
export function dueReport(now: Date, reportTime: string, lastSentDay: string | undefined): { day: string; sendDay: string } | null {
  const time = normalizeReportTime(reportTime);
  if (!time) return null;
  const today = localDay(now);
  if (lastSentDay === today) return null;
  if (localTime(now) < time) return null;
  const day = time < "12:00" ? shiftDay(today, -1) : today;
  return { day, sendDay: today };
}

/** Mốc xóa bài: bài tạo trước thời điểm này bị dọn. 0 hoặc trống là tắt. */
export function retentionCutoff(now: Date, days: number): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(now.getTime() - Math.max(7, Math.floor(days)) * 86_400_000).toISOString();
}

export type DailyResult = { reportSent?: string; reportError?: string; pruned?: number };

/** Chạy các việc theo ngày. Gọi mỗi phút; tự biết đã làm hôm nay chưa. */
export async function runDailyJobs(
  store: Store,
  config: AppConfig,
  options: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<DailyResult> {
  const now = options.now ?? new Date();
  const today = localDay(now);
  const result: DailyResult = {};

  const due = dueReport(now, config.DAILY_REPORT_TIME, store.getSetting("DAILY_REPORT_LAST_DAY"));
  if (due && config.ALERT_WEBHOOK_URL.trim()) {
    // Đánh dấu trước khi gửi để lỗi mạng không làm gửi lặp mỗi phút.
    store.setSetting("DAILY_REPORT_LAST_DAY", due.sendDay);
    try {
      const brief = await briefForDay(store, config, due.day, options.fetchImpl);
      const title = `Bản tin tự động ngày ${due.day.split("-").reverse().join("/")}`;
      const error = await deliverExecutiveReport({ ...brief, title }, { webhookUrl: config.ALERT_WEBHOOK_URL, fetchImpl: options.fetchImpl });
      if (error) result.reportError = error;
      else result.reportSent = due.day;
    } catch (error: unknown) {
      result.reportError = error instanceof Error ? error.message : String(error);
    }
    store.setSetting(
      "DAILY_REPORT_LAST_RESULT",
      JSON.stringify({ at: now.toISOString(), day: due.day, error: result.reportError ?? "" }),
    );
  }

  const cutoff = retentionCutoff(now, config.RETENTION_DAYS);
  if (cutoff && store.getSetting("RETENTION_LAST_DAY") !== today) {
    store.setSetting("RETENTION_LAST_DAY", today);
    result.pruned = store.pruneMentions(cutoff);
  }

  return result;
}

export function lastReportResult(store: Store): { at: string; day: string; error: string } | undefined {
  const raw = store.getSetting("DAILY_REPORT_LAST_RESULT");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { at?: unknown; day?: unknown; error?: unknown };
    if (typeof parsed.at !== "string" || typeof parsed.day !== "string") return undefined;
    return { at: parsed.at, day: parsed.day, error: typeof parsed.error === "string" ? parsed.error : "" };
  } catch {
    return undefined;
  }
}

export function startDailyLoop(run: () => Promise<void>, everyMs = 60_000): { stop: () => void } {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    run()
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, everyMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
