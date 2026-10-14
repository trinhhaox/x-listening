const GRAPH = "https://graph.facebook.com/v23.0";

export type FbPost = {
  id: string;
  text: string;
  authorUsername: string;
  authorName: string;
  createdAt: string;
  createdUnix: number;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  url: string;
};

type GraphError = { error?: { message?: string } };

type GraphPost = {
  id?: string;
  message?: string;
  story?: string;
  created_time?: string;
  permalink_url?: string;
  from?: { id?: string; name?: string };
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
};

type PostsPayload = GraphError & {
  data?: GraphPost[];
  paging?: { cursors?: { after?: string } };
};

export class FbApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function pageKey(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 300) return null;
  let path = text;
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "facebook.com" && host !== "fb.com" && host !== "m.facebook.com" && host !== "web.facebook.com") return null;
    const profileId = url.searchParams.get("id");
    if (url.pathname === "/profile.php" && profileId && /^\d+$/.test(profileId)) return profileId;
    path = safeDecode(url.pathname);
  }
  const parts = path.split("/").filter(Boolean).map((part) => part.split("?")[0] ?? "");
  if (parts.length === 0) return null;
  const head = (parts[0] ?? "").toLowerCase();
  if (["share", "sharer", "watch", "reel", "reels", "groups", "stories", "login", "marketplace", "events", "photo", "photos"].includes(head)) {
    return null;
  }
  if (head === "pages") {
    const numeric = [...parts].reverse().find((part) => /^\d{5,20}$/.test(part));
    return numeric ?? null;
  }
  const slug = parts[0] ?? "";
  if (!/^[A-Za-z0-9.\-]{1,80}$/.test(slug)) return null;
  return slug;
}

export async function listPagePosts(
  token: string,
  page: string,
  maxResults: number,
  sinceUnix: number | null,
  fetchImpl: typeof fetch = fetch,
  cursor: { after?: string | null } = {},
): Promise<{ posts: FbPost[]; after: string | null }> {
  const pageId = await resolvePage(token, page, fetchImpl);
  const url = new URL(`${GRAPH}/${encodeURIComponent(pageId)}/published_posts`);
  url.searchParams.set(
    "fields",
    "id,message,story,created_time,permalink_url,from{id,name},shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)",
  );
  url.searchParams.set("limit", String(Math.min(Math.max(maxResults, 1), 100)));
  if (sinceUnix && Number.isInteger(sinceUnix) && sinceUnix > 1_000_000_000) url.searchParams.set("since", String(sinceUnix));
  if (cursor.after && cursor.after.length <= 2000 && !/[\u0000-\u001f]/.test(cursor.after)) {
    url.searchParams.set("after", cursor.after);
  }

  const payload = await graphGet<PostsPayload>(url, token, fetchImpl);
  const posts = (payload.data ?? []).flatMap((post) => {
    const parsed = parsePost(post, pageId);
    return parsed ? [parsed] : [];
  });
  const after = payload.paging?.cursors?.after ?? null;
  return { posts, after: after && after.length <= 2000 ? after : null };
}

async function resolvePage(token: string, page: string, fetchImpl: typeof fetch): Promise<string> {
  if (/^\d{5,20}$/.test(page)) return page;
  const url = new URL(`${GRAPH}/${encodeURIComponent(page)}`);
  url.searchParams.set("fields", "id,name");
  const payload = await graphGet<GraphError & { id?: string }>(url, token, fetchImpl);
  if (!payload.id || !/^\d{5,20}$/.test(payload.id)) throw new FbApiError("Facebook không trả id trang.", 502);
  return payload.id;
}

async function graphGet<T>(url: URL, token: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = (await response.json().catch(() => ({}))) as T & GraphError;
  if (!response.ok) {
    const detail = redact(payload.error?.message || response.statusText || "từ chối");
    throw new FbApiError(`Facebook trả về ${response.status}: ${detail}`, response.status);
  }
  return payload;
}

function parsePost(post: GraphPost, pageId: string): FbPost | null {
  if (!post.id || !/^\d+_\d+$/.test(post.id) || post.id.length > 80) return null;
  const created = post.created_time ? Date.parse(post.created_time) : Number.NaN;
  if (Number.isNaN(created)) return null;
  const authorId = (post.from?.id ?? pageId).replace(/\D/g, "").slice(0, 64) || pageId;
  const text = (post.message || post.story || "").replace(/\s+/g, " ").trim();
  return {
    id: post.id,
    text: text || "(bài không có chữ)",
    authorUsername: authorId,
    authorName: (post.from?.name || "Trang Facebook").slice(0, 80),
    createdAt: new Date(created).toISOString(),
    createdUnix: Math.floor(created / 1000),
    likeCount: countOf(post.reactions?.summary?.total_count),
    replyCount: countOf(post.comments?.summary?.total_count),
    repostCount: countOf(post.shares?.count),
    url: safePermalink(post.permalink_url ?? ""),
  };
}

function countOf(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 0) return 0;
  return Math.min(Math.floor(value), 1_000_000_000);
}

function safePermalink(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (url.protocol !== "https:" || (host !== "facebook.com" && host !== "fb.com")) return "";
    return url.toString().slice(0, 500);
  } catch {
    return "";
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function redact(value: string): string {
  return value.replace(/access_token=[^&\s]+/gi, "access_token=…").slice(0, 240);
}
