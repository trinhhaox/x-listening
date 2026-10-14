export type PublicPost = {
  id: string;
  text: string;
  authorUsername: string;
  authorName: string;
  createdAt: string;
  lang: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  newestId: string | null;
};

type SearchPayload = {
  data?: Array<{
    id: string;
    text: string;
    author_id?: string;
    created_at?: string;
    lang?: string;
    public_metrics?: {
      like_count?: number;
      retweet_count?: number;
      reply_count?: number;
      quote_count?: number;
    };
  }>;
  includes?: { users?: Array<{ id: string; username?: string; name?: string }> };
  meta?: { newest_id?: string; result_count?: number; next_token?: string };
  detail?: string;
  title?: string;
  errors?: Array<{ message?: string }>;
};

export class XApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function searchRecentPosts(
  token: string,
  query: string,
  maxResults: number,
  sinceId: string | null,
  fetchImpl: typeof fetch = fetch,
  page: { nextToken?: string | null; startTime?: string | null } = {},
): Promise<{ posts: PublicPost[]; newestId: string | null; nextToken: string | null }> {
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("tweet.fields", "created_at,public_metrics,lang,author_id");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name");
  if (sinceId && /^\d+$/.test(sinceId)) url.searchParams.set("since_id", sinceId);
  if (page.startTime && !Number.isNaN(Date.parse(page.startTime))) url.searchParams.set("start_time", page.startTime);
  if (page.nextToken && page.nextToken.length <= 2000 && !/[\u0000-\u001f]/.test(page.nextToken)) {
    url.searchParams.set("next_token", page.nextToken);
  }

  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as SearchPayload;
  if (!response.ok) {
    const detail = payload.detail || payload.title || payload.errors?.[0]?.message || response.statusText;
    throw new XApiError(`X trả về ${response.status}: ${detail}`, response.status);
  }

  const users = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));
  const posts = (payload.data ?? []).map((post) => {
    const user = post.author_id ? users.get(post.author_id) : undefined;
    return {
      id: post.id,
      text: post.text,
      authorUsername: user?.username || "unknown",
      authorName: user?.name || user?.username || "Không rõ tên",
      createdAt: post.created_at || new Date().toISOString(),
      lang: post.lang || "",
      likeCount: post.public_metrics?.like_count ?? 0,
      repostCount: post.public_metrics?.retweet_count ?? 0,
      replyCount: post.public_metrics?.reply_count ?? 0,
      quoteCount: post.public_metrics?.quote_count ?? 0,
      newestId: payload.meta?.newest_id ?? null,
    } satisfies PublicPost;
  });

  const nextToken = payload.meta?.next_token;
  return {
    posts,
    newestId: payload.meta?.newest_id ?? null,
    nextToken: nextToken && nextToken.length <= 2000 ? nextToken : null,
  };
}
