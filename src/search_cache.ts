/**
 * Bộ nhớ đệm cho tra cứu tức thời (/search): cùng câu + cùng kênh trong TTL thì trả lại kết quả cũ,
 * gộp các yêu cầu trùng đang chạy, và giới hạn số lượt gọi thật ra các nền tảng mỗi phút
 * để bấm tìm liên tục không khiến X/Bing/Google chặn IP máy chủ.
 */
export class LiveSearchCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();
  private recentCalls: number[] = [];

  constructor(
    private readonly options: { ttlMs: number; maxEntries: number; maxCallsPerMinute: number; now?: () => number },
  ) {}

  static key(query: string, channels: string[]): string {
    return `${query.trim().toLowerCase().replace(/\s+/g, " ")}|${[...channels].sort().join(",")}`;
  }

  /**
   * cached=true nếu lấy từ bộ nhớ đệm. Khi vượt giới hạn trả về retryAfterSec thay vì gọi ra ngoài.
   */
  async get(
    key: string,
    load: () => Promise<T>,
  ): Promise<{ value: T; cached: boolean } | { retryAfterSec: number }> {
    const now = this.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) return { value: hit.value, cached: true };
    if (hit) this.entries.delete(key);

    const running = this.inflight.get(key);
    if (running) return { value: await running, cached: true };

    this.recentCalls = this.recentCalls.filter((t) => t > now - 60_000);
    if (this.recentCalls.length >= this.options.maxCallsPerMinute) {
      const oldest = this.recentCalls[0] ?? now;
      return { retryAfterSec: Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000)) };
    }
    this.recentCalls.push(now);

    const promise = load();
    this.inflight.set(key, promise);
    try {
      const value = await promise;
      this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
      while (this.entries.size > this.options.maxEntries) {
        const first = this.entries.keys().next().value;
        if (first === undefined) break;
        this.entries.delete(first);
      }
      return { value, cached: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
