export type FacebookScrapedPost = {
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

const BOT_USER_AGENT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export async function scrapeFacebookPageWithCookie(
  options: {
    cookie: string;
    pageKey: string;
    phrase?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<FacebookScrapedPost[]> {
  const cookie = normalizeFacebookCookie(options.cookie || "");
  const doFetch = options.fetchImpl ?? fetch;
  const cleanKey = cleanFacebookPageKey(options.pageKey);
  const phrase = options.phrase?.trim() || "";

  // 1. Chiến lược 1: Web Crawler thông minh qua SSR của Facebook (Khắc phục việc mbasic bị Meta đóng cửa)
  try {
    const webPosts = await scrapeFacebookViaWeb(cleanKey, phrase, doFetch);
    if (webPosts.length > 0) {
      return webPosts;
    }
  } catch {
    // tiếp tục thử mbasic dự phòng
  }

  // 2. Chiến lược 2: mbasic dự phòng nếu có cookie
  try {
    const url = `https://mbasic.facebook.com/${encodeURIComponent(cleanKey)}`;
    const headers: Record<string, string> = {
      "user-agent": MOBILE_USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    };

    if (cookie) {
      headers.cookie = cookie;
    }

    const res = await doFetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(12000),
    });

    if (res.ok) {
      const html = await res.text();
      const mbasicPosts = parseMbasicPosts(html, cleanKey, phrase);
      if (mbasicPosts.length > 0) {
        return mbasicPosts;
      }
    }
  } catch {
    // bỏ qua
  }

  return [];
}

/**
 * Trích xuất bài viết từ trang Fanpage công khai qua SSR
 */
export async function scrapeFacebookViaWeb(
  pageKey: string,
  phrase = "",
  doFetch: typeof fetch = fetch,
): Promise<FacebookScrapedPost[]> {
  const url = `https://www.facebook.com/${encodeURIComponent(pageKey)}`;
  const res = await doFetch(url, {
    method: "GET",
    headers: {
      "user-agent": BOT_USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    return [];
  }

  const html = await res.text();
  return parseFacebookWebHtml(html, pageKey, phrase);
}

export function parseFacebookWebHtml(html: string, pageKey: string, phrase = ""): FacebookScrapedPost[] {
  const posts: FacebookScrapedPost[] = [];
  const normalizedPhrase = phrase.toLowerCase().trim();

  // 1. Trích xuất tên Fanpage từ thẻ <title>
  const rawTitle = html.match(/<title>([^<]+)<\/title>/)?.[1] || pageKey;
  const authorName = rawTitle.replace(/\s*[-|]\s*Facebook$/i, "").replace(/\s*\|\s*Hanoi\s*$/i, "").trim() || pageKey;

  // 2. Trích xuất các message text từ JSON nhúng của React SSR
  const rawMsgs: string[] = [];
  const msgMatches = [...html.matchAll(/"message":\{"text":("(?:[^"\\]|\\.)*")/g)];
  for (const m of msgMatches) {
    try {
      const unescaped = JSON.parse(m[1]) as string;
      if (unescaped && unescaped.trim().length > 15) {
        rawMsgs.push(unescaped.trim());
      }
    } catch {
      // bỏ qua lỗi decode
    }
  }

  // Khử trùng lặp nội dung
  const uniqueMsgs = [...new Set(rawMsgs)];

  // 3. Trích xuất danh sách post_ids
  const postIds = [...html.matchAll(/"post_id":"([0-9]+)"/g)].map((x) => x[1]);
  const uniqueIds = [...new Set(postIds)];

  for (let i = 0; i < uniqueMsgs.length; i++) {
    const text = uniqueMsgs[i];
    if (normalizedPhrase && !text.toLowerCase().includes(normalizedPhrase)) {
      continue;
    }

    const id = uniqueIds[i] || `${cleanNumericKey(pageKey)}_${Date.now() - i * 3600000}`;
    const postId = id.startsWith("fb_") ? id : `fb_${id}`;
    const permalink = `https://www.facebook.com/${pageKey}/posts/${id}`;
    const createdAt = new Date(Date.now() - i * 3600000 * 4).toISOString();

    posts.push({
      id: postId,
      text,
      authorUsername: pageKey,
      authorName,
      createdAt,
      lang: "vi",
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
      url: permalink,
    });
  }

  return posts;
}

export function cleanFacebookPageKey(input: string): string {
  let cleaned = input.trim();
  // Bỏ https://facebook.com/ hoặc www.facebook.com/
  cleaned = cleaned.replace(/^https?:\/\/(?:www\.|m\.|mbasic\.)?facebook\.com\//i, "");
  // Bỏ trailing slash và query params
  cleaned = cleaned.split("?")[0].replace(/\/+$/, "");
  // Bỏ @ nếu có
  cleaned = cleaned.replace(/^@+/, "");
  return cleaned || input.trim();
}

export function normalizeFacebookCookie(raw: string): string {
  let cookie = raw.trim();
  if (!cookie) return "";
  if (!cookie.includes("c_user=") && !cookie.includes("xs=")) {
    const parts = cookie.split(";").map((p) => p.trim());
    if (parts.length >= 2) {
      const numPart = parts.find((p) => /^\d+$/.test(p));
      const xsPart = parts.find((p) => p.includes("%3A") || p.length > 20);
      if (numPart && xsPart) {
        return `c_user=${numPart}; xs=${xsPart}`;
      }
    }
  }
  return cookie;
}

function cleanNumericKey(key: string): string {
  const digits = key.replace(/\D/g, "");
  return digits || "1000";
}

export function parseMbasicPosts(html: string, pageKey: string, phrase?: string): FacebookScrapedPost[] {
  const posts: FacebookScrapedPost[] = [];
  const normalizedPhrase = (phrase ?? "").trim().toLowerCase();

  const storyRegex = /(?:href="\/story\.php\?story_fbid=([0-9]+)|href="\/[^/]+\/posts\/([0-9]+))/g;
  const matches = [...html.matchAll(storyRegex)];

  const postIds: string[] = [];
  for (const m of matches) {
    const id = m[1] || m[2];
    if (id && !postIds.includes(id)) {
      postIds.push(id);
    }
  }

  for (const id of postIds.slice(0, 15)) {
    const idx = html.indexOf(id);
    if (idx === -1) continue;

    const chunk = html.slice(Math.max(0, idx - 200), Math.min(html.length, idx + 1500));

    const rawText = chunk
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    if (!rawText) continue;

    const text = rawText.slice(0, 1000);
    if (normalizedPhrase && !text.toLowerCase().includes(normalizedPhrase)) {
      continue;
    }

    posts.push({
      id: id.startsWith("fb_") ? id : `fb_${id}`,
      text,
      authorUsername: pageKey,
      authorName: pageKey,
      createdAt: new Date().toISOString(),
      lang: "vi",
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
      url: `https://facebook.com/${encodeURIComponent(pageKey)}/posts/${encodeURIComponent(id)}`,
    });
  }

  return posts;
}
