import type { QueueState } from "./db.js";

/** Tốc độ đội xử lý bài tiêu cực trong một khoảng ngày. */
export type ResponseStats = {
  days: number;
  negative: number;
  done: number;
  open: number;
  /** Còn mở và đã chờ quá OVERDUE_HOURS. */
  overdue: number;
  /** Phút từ lúc hệ thống thấy bài đến lúc Đã xong. */
  medianMinutes: number | null;
  p90Minutes: number | null;
  byAssignee: { name: string; done: number; open: number; medianMinutes: number | null }[];
};

export const OVERDUE_HOURS = 24;

type Row = { queue: QueueState; assigned_to: string; fetched_at: string; done_at: string | null };

export function computeResponseStats(rows: Row[], now: Date, days: number): ResponseStats {
  const minutesOf = (row: Row) => Math.max(0, (Date.parse(row.done_at!) - Date.parse(row.fetched_at)) / 60_000);
  const done = rows.filter((row) => row.queue === "done" && row.done_at && Number.isFinite(Date.parse(row.done_at)));
  const open = rows.filter((row) => row.queue !== "done");
  const overdue = open.filter((row) => now.getTime() - Date.parse(row.fetched_at) > OVERDUE_HOURS * 3_600_000).length;

  const people = new Map<string, Row[]>();
  for (const row of rows) {
    const name = row.assigned_to.trim() || "Chưa gán";
    people.set(name, [...(people.get(name) ?? []), row]);
  }
  const byAssignee = [...people.entries()]
    .map(([name, list]) => {
      const finished = list.filter((row) => done.includes(row));
      return { name, done: finished.length, open: list.length - finished.length, medianMinutes: quantile(finished.map(minutesOf), 0.5) };
    })
    .sort((a, b) => b.open - a.open || b.done - a.done || a.name.localeCompare(b.name));

  const durations = done.map(minutesOf);
  return {
    days,
    negative: rows.length,
    done: done.length,
    open: open.length,
    overdue,
    medianMinutes: quantile(durations, 0.5),
    p90Minutes: quantile(durations, 0.9),
    byAssignee,
  };
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** "45 phút", "3 giờ 20 phút", "2 ngày 4 giờ". */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  const m = Math.round(minutes);
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} giờ ${m % 60} phút` : `${h} giờ`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} ngày ${h % 24} giờ` : `${d} ngày`;
}

/** Một dòng cho bản tin. Trống khi không có bài tiêu cực nào. */
export function responseSummary(stats: ResponseStats | undefined): string {
  if (!stats || stats.negative === 0) return "";
  const parts = [`Xử lý bài tiêu cực ${stats.days} ngày: xong ${stats.done}/${stats.negative}`];
  if (stats.done) parts.push(`trung vị ${formatDuration(stats.medianMinutes)}`);
  if (stats.open) parts.push(`còn mở ${stats.open}`);
  if (stats.overdue) parts.push(`${stats.overdue} bài chờ quá ${OVERDUE_HOURS} giờ`);
  return parts.join(" · ");
}
