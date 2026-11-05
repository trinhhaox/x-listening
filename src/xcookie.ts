export type XCookiePost = {
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
  url: string;
};

// Bearer token công khai của Web client Twitter (x.com)
const PUBLIC_WEB_BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export async function searchXWithCookie(
  options: {
    authToken?: string;
    ct0?: string;
    query: string;
    count?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<XCookiePost[]> {
  const authToken = options.authToken?.trim() || "";
  const ct0 = options.ct0?.trim() || "";
  const count = options.count ?? 20;
  const doFetch = options.fetchImpl ?? fetch;

  // 1. Thử tìm kiếm trực tiếp bằng Cookie phiên nếu đã cấu hình
  if (authToken && ct0) {
    try {
      const directPosts = await searchXDirectGraphQL(options.query, authToken, ct0, count, doFetch);
      if (directPosts.length > 0) {
        return directPosts;
      }
    } catch {
      // Bỏ qua lỗi direct và tự động chuyển sang cơ chế dự phòng thông minh
    }
  }

  // 2. Cơ chế Dự phòng Thông minh (Smart Web Index Fallback):
  // X thường xuyên chặn IP VPS/Datacenter hoặc đổi GraphQL hash. Ta trích xuất bài viết công khai qua Bing & DuckDuckGo Index.
  try {
    const fallbackPosts = await searchXViaWebIndex(options.query, count, doFetch);
    if (fallbackPosts.length > 0) {
      return fallbackPosts;
    }
  } catch {
    // Không ném crash
  }

  return [];
}

async function searchXDirectGraphQL(
  query: string,
  authToken: string,
  ct0: string,
  count: number,
  doFetch: typeof fetch,
): Promise<XCookiePost[]> {
  const cookieHeader = `auth_token=${authToken}; ct0=${ct0}`;
  const headers: Record<string, string> = {
    authorization: PUBLIC_WEB_BEARER,
    cookie: cookieHeader,
    "x-csrf-token": ct0,
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-client-language": "vi",
    "user-agent": DEFAULT_USER_AGENT,
    referer: "https://x.com/search",
  };

  const variables = {
    rawQuery: query,
    count,
    querySource: "typed_query",
    product: "Latest",
  };

  const features = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };

  // Thử các queryId phổ biến của SearchTimeline
  const queryIds = ["BYppgupFFS2yqVmmRNjlsw", "MJvjGg5-7kEB3yQv7U2q6w"];

  for (const qId of queryIds) {
    try {
      const gqlUrl = new URL(`https://x.com/i/api/graphql/${qId}/SearchTimeline`);
      gqlUrl.searchParams.set("variables", JSON.stringify(variables));
      gqlUrl.searchParams.set("features", JSON.stringify(features));

      const res = await doFetch(gqlUrl.toString(), {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().startsWith("{")) {
          const json = JSON.parse(text);
          const posts = parseGraphqlSearch(json);
          if (posts.length > 0) return posts;
        }
      }
    } catch {
      // Tiếp tục queryId tiếp theo
    }
  }

  // Thử endpoint adaptive search
  try {
    const adaptiveUrl = new URL("https://api.twitter.com/2/search/adaptive.json");
    adaptiveUrl.searchParams.set("q", query);
    adaptiveUrl.searchParams.set("count", String(count));
    adaptiveUrl.searchParams.set("query_source", "typed_query");
    adaptiveUrl.searchParams.set("product", "Latest");
    adaptiveUrl.searchParams.set("tweet_mode", "extended");

    const res = await doFetch(adaptiveUrl.toString(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().startsWith("{")) {
        const json = JSON.parse(text);
        const posts = parseAdaptiveSearch(json);
        if (posts.length > 0) return posts;
      }
    }
  } catch {
    // bỏ qua
  }

  return [];
}

/**
 * Trích xuất bài viết công khai trên X qua Open Web Search (Bing RSS & DuckDuckGo)
 * Giải pháp bền bỉ chống chặn IP Datacenter và không phụ thuộc GraphQL hash.
 */
export async function searchXViaWebIndex(
  query: string,
  count = 20,
  doFetch: typeof fetch = fetch,
): Promise<XCookiePost[]> {
  const posts: XCookiePost[] = [];
  const seenIds = new Set<string>();

  // 1. Bing RSS (Rất nhanh và định dạng XML ổn định)
  try {
    const bingUrl = `https://www.bing.com/search?q=site:x.com+${encodeURIComponent(query)}&format=rss`;
    const res = await doFetch(bingUrl, {
      headers: { "user-agent": DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const xml = await res.text();
      const bingPosts = parseBingRss(xml);
      for (const p of bingPosts) {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          posts.push(p);
        }
      }
    }
  } catch {
    // tiếp tục fallback DuckDuckGo
  }

  if (posts.length >= count) {
    return posts.slice(0, count);
  }

  // 2. DuckDuckGo HTML Fallback
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=site:x.com+${encodeURIComponent(query)}`;
    const res = await doFetch(ddgUrl, {
      headers: { "user-agent": DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const html = await res.text();
      const ddgPosts = parseDuckDuckGoHtml(html);
      for (const p of ddgPosts) {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          posts.push(p);
        }
      }
    }
  } catch {
    // bỏ qua
  }

  return posts.slice(0, count);
}

export function parseBingRss(xml: string): XCookiePost[] {
  const posts: XCookiePost[] = [];
  const items = xml.split("<item>");

  for (const item of items.slice(1)) {
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
    const link = linkMatch ? cleanHtmlText(linkMatch[1].trim()) : "";
    const statusMatch = link.match(/https?:\/\/(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)\/status\/(\d+)/);
    if (!statusMatch) continue;

    const username = statusMatch[1];
    const id = statusMatch[2];

    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
    const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);
    const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

    const title = titleMatch ? cleanHtmlText(titleMatch[1]) : "";
    const desc = descMatch ? cleanHtmlText(descMatch[1]) : "";
    const rawDate = pubDateMatch ? pubDateMatch[1].trim() : "";

    let createdAt = new Date().toISOString();
    if (rawDate) {
      const parsedDate = new Date(rawDate);
      if (!Number.isNaN(parsedDate.getTime())) {
        createdAt = parsedDate.toISOString();
      }
    }

    let text = desc || title || link;
    text = text.replace(/^[a-zA-Z0-9_]+ on X:\s*["']?/i, "").replace(/["']?\s*\/ X$/i, "").trim();
    if (!text) text = title || link;

    posts.push({
      id,
      text,
      authorUsername: username,
      authorName: username,
      createdAt,
      lang: "vi",
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
      url: `https://x.com/${username}/status/${id}`,
    });
  }

  return posts;
}

export function parseDuckDuckGoHtml(html: string): XCookiePost[] {
  const posts: XCookiePost[] = [];
  const blocks = html.split(/class=["']result\s+/);

  for (const block of blocks.slice(1)) {
    const urlMatch = block.match(/uddg=([^&"'\s]+)/);
    if (!urlMatch) continue;

    const rawUrl = decodeURIComponent(urlMatch[1]);
    const statusMatch = rawUrl.match(/https?:\/\/(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)\/status\/(\d+)/);
    if (!statusMatch) continue;

    const username = statusMatch[1];
    const id = statusMatch[2];

    const snippetMatch = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span|td)>/);
    const snippet = snippetMatch ? cleanHtmlText(snippetMatch[1]) : "";

    const titleMatch = block.match(/class=["'][^"']*result__a[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span|td)>/);
    const title = titleMatch ? cleanHtmlText(titleMatch[1]) : "";

    let text = snippet || title || rawUrl;
    text = text.replace(/^[a-zA-Z0-9_]+ on X:\s*["']?/i, "").replace(/["']?\s*\/ X$/i, "").trim();
    if (!text) text = title || rawUrl;

    posts.push({
      id,
      text,
      authorUsername: username,
      authorName: username,
      createdAt: new Date().toISOString(),
      lang: "vi",
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
      url: `https://x.com/${username}/status/${id}`,
    });
  }

  return posts;
}

function cleanHtmlText(str: string): string {
  return str
    .replace(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseGraphqlSearch(data: any): XCookiePost[] {
  const posts: XCookiePost[] = [];
  try {
    const instructions =
      data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ?? [];
    for (const instruction of instructions) {
      const entries = instruction?.entries ?? [];
      for (const entry of entries) {
        const item = entry?.content?.itemContent?.tweet_results?.result;
        const tweet = item?.tweet ? item.tweet : item;
        if (!tweet || !tweet.legacy) continue;

        const legacy = tweet.legacy;
        const userLegacy = tweet.core?.user_results?.result?.legacy ?? {};
        const id = legacy.id_str || tweet.rest_id;
        const text = legacy.full_text || legacy.text || "";
        const authorUsername = userLegacy.screen_name || "unknown";
        const authorName = userLegacy.name || authorUsername;
        const createdAt = new Date(legacy.created_at).toISOString();

        if (id && text) {
          posts.push({
            id,
            text,
            authorUsername,
            authorName,
            createdAt: Number.isNaN(new Date(createdAt).getTime()) ? new Date().toISOString() : createdAt,
            lang: legacy.lang || "vi",
            likeCount: legacy.favorite_count ?? 0,
            repostCount: legacy.retweet_count ?? 0,
            replyCount: legacy.reply_count ?? 0,
            quoteCount: legacy.quote_count ?? 0,
            url: `https://x.com/${authorUsername}/status/${id}`,
          });
        }
      }
    }
  } catch {
    // bỏ qua lỗi parse nếu cấu trúc khác biệt
  }
  return posts;
}

export function parseAdaptiveSearch(data: any): XCookiePost[] {
  const posts: XCookiePost[] = [];
  try {
    const tweets = data?.globalObjects?.tweets ?? {};
    const users = data?.globalObjects?.users ?? {};

    for (const id of Object.keys(tweets)) {
      const t = tweets[id];
      if (!t) continue;
      const u = users[t.user_id_str] ?? {};
      const username = u.screen_name || "unknown";
      const createdAt = new Date(t.created_at).toISOString();

      posts.push({
        id,
        text: t.full_text || t.text || "",
        authorUsername: username,
        authorName: u.name || username,
        createdAt: Number.isNaN(new Date(createdAt).getTime()) ? new Date().toISOString() : createdAt,
        lang: t.lang || "vi",
        likeCount: t.favorite_count ?? 0,
        repostCount: t.retweet_count ?? 0,
        replyCount: t.reply_count ?? 0,
        quoteCount: t.quote_count ?? 0,
        url: `https://x.com/${username}/status/${id}`,
      });
    }
  } catch {
    // bỏ qua lỗi
  }
  return posts;
}
