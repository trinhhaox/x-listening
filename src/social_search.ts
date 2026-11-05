export type SocialSearchResult = {
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
  source: "facebook" | "threads" | "web";
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function cleanHtml(raw: string): string {
  return raw
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

/**
 * Lắng nghe bài viết và tin tức báo chí, diễn đàn theo Từ khóa hoặc Hashtag qua Google News RSS & Bing RSS
 */
export async function searchWebNews(
  query: string,
  count = 20,
  fetchImpl: typeof fetch = fetch,
): Promise<SocialSearchResult[]> {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  const results: SocialSearchResult[] = [];
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQ)}&hl=vi&gl=VN&ceid=VN:vi`;

  try {
    const res = await fetchImpl(rssUrl, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok) {
      const xml = await res.text();
      const items = xml.split("<item>");
      for (const item of items.slice(1)) {
        if (results.length >= count) break;
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
        const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
        const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);

        const title = titleMatch ? cleanHtml(titleMatch[1]) : "";
        const link = linkMatch ? linkMatch[1].trim() : "";
        const author = sourceMatch ? cleanHtml(sourceMatch[1]) : "Báo chí";

        if (!title || !link) continue;

        let createdAt = new Date().toISOString();
        if (dateMatch) {
          const parsed = new Date(dateMatch[1].trim());
          if (!Number.isNaN(parsed.getTime())) createdAt = parsed.toISOString();
        }

        const id = "web-" + Math.abs(link.split("").reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)).toString(36);

        results.push({
          id,
          text: title,
          authorUsername: author.toLowerCase().replace(/\s+/g, "_"),
          authorName: author,
          createdAt,
          lang: "vi",
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          quoteCount: 0,
          url: link,
          source: "web",
        });
      }
    }
  } catch {
    // Không ném crash
  }

  return results;
}

/**
 * Lắng nghe bài viết Facebook công khai theo từ khóa hoặc hashtag
 */
export async function searchFacebookPublic(
  query: string,
  count = 20,
  fetchImpl: typeof fetch = fetch,
): Promise<SocialSearchResult[]> {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  const results: SocialSearchResult[] = [];
  const searchEngineUrl = `https://www.bing.com/search?q=${encodeURIComponent(`site:facebook.com "${cleanQ}"`)}&format=rss`;

  try {
    const res = await fetchImpl(searchEngineUrl, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok) {
      const xml = await res.text();
      const items = xml.split("<item>");
      for (const item of items.slice(1)) {
        if (results.length >= count) break;
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
        const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
        const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);
        const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

        const title = titleMatch ? cleanHtml(titleMatch[1]) : "";
        const desc = descMatch ? cleanHtml(descMatch[1]) : "";
        const link = linkMatch ? linkMatch[1].trim() : "";

        if (!link || !link.includes("facebook.com")) continue;

        let createdAt = new Date().toISOString();
        if (dateMatch) {
          const parsed = new Date(dateMatch[1].trim());
          if (!Number.isNaN(parsed.getTime())) createdAt = parsed.toISOString();
        }

        // Trích xuất username hoặc page từ URL
        const userMatch = link.match(/facebook\.com\/([^/?&#]+)/);
        const author = userMatch ? userMatch[1] : "Facebook User";
        const text = desc || title || "Bài viết Facebook";
        const id = "fb-search-" + Math.abs((link + title).split("").reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)).toString(36);

        results.push({
          id,
          text,
          authorUsername: author.slice(0, 32),
          authorName: author.slice(0, 50),
          createdAt,
          lang: "vi",
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          quoteCount: 0,
          url: link,
          source: "facebook",
        });
      }
    }
  } catch {
    // Không ném crash
  }

  return results;
}

/**
 * Lắng nghe bài viết Threads công khai theo từ khóa hoặc hashtag
 */
export async function searchThreadsPublic(
  query: string,
  count = 20,
  fetchImpl: typeof fetch = fetch,
): Promise<SocialSearchResult[]> {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  const results: SocialSearchResult[] = [];
  const searchEngineUrl = `https://www.bing.com/search?q=${encodeURIComponent(`site:threads.net "${cleanQ}"`)}&format=rss`;

  try {
    const res = await fetchImpl(searchEngineUrl, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok) {
      const xml = await res.text();
      const items = xml.split("<item>");
      for (const item of items.slice(1)) {
        if (results.length >= count) break;
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
        const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
        const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);
        const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

        const title = titleMatch ? cleanHtml(titleMatch[1]) : "";
        const desc = descMatch ? cleanHtml(descMatch[1]) : "";
        const link = linkMatch ? linkMatch[1].trim() : "";

        if (!link || !link.includes("threads.net")) continue;

        let createdAt = new Date().toISOString();
        if (dateMatch) {
          const parsed = new Date(dateMatch[1].trim());
          if (!Number.isNaN(parsed.getTime())) createdAt = parsed.toISOString();
        }

        const userMatch = link.match(/threads\.net\/@([^/?&#]+)/);
        const author = userMatch ? userMatch[1] : "threads_user";
        const text = desc || title || "Bài viết Threads";
        const id = "th-search-" + Math.abs((link + title).split("").reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)).toString(36);

        results.push({
          id,
          text,
          authorUsername: author.slice(0, 32),
          authorName: author.slice(0, 50),
          createdAt,
          lang: "vi",
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          quoteCount: 0,
          url: link,
          source: "threads",
        });
      }
    }
  } catch {
    // Không ném crash
  }

  return results;
}

