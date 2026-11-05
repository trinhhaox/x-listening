const THREADS_GRAPH = "https://graph.threads.net/v1.0";

export type ThreadsPost = {
  id: string;
  text: string;
  authorUsername: string;
  authorName: string;
  createdAt: string;
  createdUnix: number;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  quoteCount: number;
  url: string;
};

type GraphError = { error?: { message?: string; type?: string; code?: number } };

type ThreadsGraphItem = {
  id?: string;
  text?: string;
  timestamp?: string;
  permalink?: string;
  username?: string;
  is_quote_post?: boolean;
};

type ThreadsPayload = GraphError & {
  data?: ThreadsGraphItem[];
  paging?: { cursors?: { after?: string } };
};

export class ThreadsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function threadsUserKey(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 200) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      if (host !== "threads.net") return null;
      const parts = url.pathname.split("/").filter(Boolean);
      const userPart = parts[0]?.replace(/^@/, "");
      if (userPart && /^[a-zA-Z0-9._]{1,50}$/.test(userPart)) return userPart;
      return null;
    } catch {
      return null;
    }
  }
  const clean = text.replace(/^@/, "");
  if (/^[a-zA-Z0-9._]{1,50}$/.test(clean)) return clean;
  return null;
}

export async function listThreadsPosts(
  token: string,
  userOrUserId: string,
  maxResults: number,
  sinceUnix: number | null,
  fetchImpl: typeof fetch = fetch,
  cursor: { after?: string | null } = {},
): Promise<{ posts: ThreadsPost[]; after: string | null }> {
  const targetId = userOrUserId === "me" || /^\d+$/.test(userOrUserId) ? userOrUserId : "me";
  const url = new URL(`${THREADS_GRAPH}/${encodeURIComponent(targetId)}/threads`);
  url.searchParams.set("fields", "id,text,timestamp,permalink,username,is_quote_post");
  url.searchParams.set("limit", String(Math.min(Math.max(maxResults, 1), 100)));
  if (sinceUnix && Number.isInteger(sinceUnix) && sinceUnix > 1_000_000_000) {
    url.searchParams.set("since", String(sinceUnix));
  }
  if (cursor.after && cursor.after.length <= 2000 && !/[\u0000-\u001f]/.test(cursor.after)) {
    url.searchParams.set("after", cursor.after);
  }

  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = (await response.json().catch(() => ({}))) as ThreadsPayload;

  if (!response.ok) {
    if (response.status === 429) {
      throw new ThreadsApiError("Threads giới hạn tần suất gọi (Rate Limit 429)", 429);
    }
    const msg = payload.error?.message || response.statusText || "Lỗi truy vấn Threads";
    throw new ThreadsApiError(`Threads trả về ${response.status}: ${msg}`, response.status);
  }

  const posts = (payload.data ?? []).flatMap((item) => {
    const parsed = parseThreadsItem(item);
    return parsed ? [parsed] : [];
  });

  const after = payload.paging?.cursors?.after ?? null;
  return { posts, after: after && after.length <= 2000 ? after : null };
}

function parseThreadsItem(item: ThreadsGraphItem): ThreadsPost | null {
  if (!item.id || item.id.length > 80) return null;
  const created = item.timestamp ? Date.parse(item.timestamp) : Number.NaN;
  if (Number.isNaN(created)) return null;

  const username = item.username || "threads_user";
  const text = (item.text || "").replace(/\s+/g, " ").trim();
  const permalink = item.permalink && item.permalink.startsWith("https://") ? item.permalink : `https://www.threads.net/@${username}/post/${item.id}`;

  return {
    id: item.id,
    text: text || "(bài Threads không có chữ)",
    authorUsername: username,
    authorName: `@${username}`,
    createdAt: new Date(created).toISOString(),
    createdUnix: Math.floor(created / 1000),
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    quoteCount: 0,
    url: permalink,
  };
}

