import type { AppConfig } from "./config.js";
import type { Store } from "./db.js";

/** Có gì để nghe không: có ít nhất một khóa nền tảng, hoặc có tần số báo chí (không cần khóa). */
export function hasSomethingToListen(current: AppConfig, store: Store): boolean {
  const hasAnyAuth = Boolean(
    current.X_BEARER_TOKEN.trim() ||
      (current.TWITTER_AUTH_TOKEN.trim() && current.TWITTER_CT0.trim()) ||
      current.FACEBOOK_ACCESS_TOKEN.trim() ||
      current.FACEBOOK_COOKIE.trim() ||
      current.THREADS_ACCESS_TOKEN.trim() ||
      current.YOUTUBE_API_KEY.trim(),
  );
  if (hasAnyAuth) return true;
  return store.listTopics().some((topic) => topic.active === 1 && topic.source === "web");
}

/**
 * Hẹn giờ nghe bằng setTimeout nối tiếp: mỗi lượt đọc lại chu kỳ hiện hành,
 * nên đổi "chu kỳ quét" trong Cài đặt có hiệu lực từ lượt kế tiếp, không cần khởi động lại.
 */
export function startListenLoop(options: {
  intervalMinutes: () => number;
  tick: () => Promise<void>;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
}): { stop: () => void } {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  let stopped = false;
  let handle: { unref?: () => void } | undefined;
  let clear: (() => void) | undefined;

  const schedule = () => {
    if (stopped) return;
    const minutes = Math.min(24 * 60, Math.max(5, options.intervalMinutes() || 15));
    const t = setTimer(() => {
      options
        .tick()
        .catch(() => undefined)
        .finally(schedule);
    }, minutes * 60 * 1000);
    handle = t;
    clear = () => clearTimeout(t as unknown as NodeJS.Timeout);
    handle.unref?.();
  };

  schedule();
  return {
    stop: () => {
      stopped = true;
      clear?.();
    },
  };
}
