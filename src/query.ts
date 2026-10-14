const MAX_QUERY_LENGTH = 512;

export function buildSearchQuery(raw: string, excludeReposts: boolean): string {
  const query = raw.replace(/\s+/g, " ").trim();
  if (!query) throw new Error("Câu truy vấn đang trống");
  if (/[\u0000-\u001f]/.test(raw)) throw new Error("Câu truy vấn chứa ký tự điều khiển");

  let next = query;
  if (excludeReposts && !/(?:^|\s)-?is:retweet\b/i.test(query)) {
    next = `${query} -is:retweet`;
  }
  if (next.length > MAX_QUERY_LENGTH) {
    throw new Error(`Câu truy vấn dài hơn ${MAX_QUERY_LENGTH} ký tự`);
  }
  return next;
}
