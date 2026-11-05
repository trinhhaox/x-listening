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
    authToken: string;
    ct0: string;
    query: string;
    count?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<XCookiePost[]> {
  const authToken = options.authToken.trim();
  const ct0 = options.ct0.trim();
  const count = options.count ?? 20;
  const doFetch = options.fetchImpl ?? fetch;

  if (!authToken || !ct0) {
    throw new Error("Cần cả TWITTER_AUTH_TOKEN và TWITTER_CT0 để tìm kiếm bằng cookie web.");
  }

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

  // 1. Thử endpoint GraphQL SearchTimeline
  const variables = {
    rawQuery: options.query,
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

  const gqlUrl = new URL("https://x.com/i/api/graphql/MJvjGg5-7kEB3yQv7U2q6w/SearchTimeline");
  gqlUrl.searchParams.set("variables", JSON.stringify(variables));
  gqlUrl.searchParams.set("features", JSON.stringify(features));

  let res = await doFetch(gqlUrl.toString(), {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(12000),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error("Cookie X không hợp lệ hoặc đã hết hạn. Hãy cập nhật TWITTER_AUTH_TOKEN và TWITTER_CT0 mới từ trình duyệt.");
  }

  if (res.status === 429) {
    throw new Error("X báo quá tần suất (Rate Limit 429) cho cookie này. Hãy đợi vài phút rồi thử lại.");
  }

  if (res.ok) {
    const json = (await res.json()) as any;
    const posts = parseGraphqlSearch(json);
    if (posts.length > 0) return posts;
  }

  // 2. Dự phòng: Endpoint adaptive search nếu GraphQL ID thay đổi
  const adaptiveUrl = new URL("https://api.twitter.com/2/search/adaptive.json");
  adaptiveUrl.searchParams.set("q", options.query);
  adaptiveUrl.searchParams.set("count", String(count));
  adaptiveUrl.searchParams.set("query_source", "typed_query");
  adaptiveUrl.searchParams.set("product", "Latest");
  adaptiveUrl.searchParams.set("tweet_mode", "extended");

  res = await doFetch(adaptiveUrl.toString(), {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(12000),
  });

  if (res.ok) {
    const json = (await res.json()) as any;
    return parseAdaptiveSearch(json);
  }

  if (!res.ok) {
    throw new Error(`X cookie search trả về HTTP ${res.status}`);
  }

  return [];
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
