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
  const cookie = options.cookie.trim();
  const doFetch = options.fetchImpl ?? fetch;

  const url = `https://mbasic.facebook.com/${encodeURIComponent(options.pageKey)}`;
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

  if (!res.ok) {
    throw new Error(`Facebook mbasic trả về mã HTTP ${res.status}`);
  }

  const html = await res.text();

  // Kiểm tra nếu bị chuyển hướng trang login
  if (html.includes("/login.php") && !cookie) {
    throw new Error("Trang Facebook này yêu cầu đăng nhập. Hãy gắn FACEBOOK_COOKIE trong file .env.");
  }

  return parseMbasicPosts(html, options.pageKey, options.phrase);
}

export function parseMbasicPosts(html: string, pageKey: string, phrase?: string): FacebookScrapedPost[] {
  const posts: FacebookScrapedPost[] = [];
  const normalizedPhrase = (phrase ?? "").trim().toLowerCase();

  // Phân tách các khối bài viết dựa trên thẻ <article> hoặc khối chứa story link
  // Các bài viết trên mbasic có link dạng href="/story.php?story_fbid=..." hoặc href="/<page>/posts/..."
  const storyRegex = /(?:href="\/story\.php\?story_fbid=([0-9]+)|href="\/[^/]+\/posts\/([0-9]+))/g;
  const matches = [...html.matchAll(storyRegex)];

  // Gom các post ID độc nhất
  const postIds: string[] = [];
  for (const m of matches) {
    const id = m[1] || m[2];
    if (id && !postIds.includes(id)) {
      postIds.push(id);
    }
  }

  // Tách từng đoạn HTML tương ứng với mỗi bài
  for (const id of postIds.slice(0, 15)) {
    // Tìm đoạn HTML chứa ID bài viết
    const idx = html.indexOf(id);
    if (idx === -1) continue;

    // Lấy ngữ cảnh xung quanh ID
    const chunk = html.slice(Math.max(0, idx - 200), Math.min(html.length, idx + 1500));

    // Bỏ HTML tags để lấy text bài viết
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

    // Nếu có cụm từ giữ lại thì kiểm tra
    if (normalizedPhrase && !rawText.toLowerCase().includes(normalizedPhrase)) {
      continue;
    }

    // Cắt text hợp lý
    const text = rawText.slice(0, 1500);

    posts.push({
      id: `fb_${id}`,
      text,
      authorUsername: pageKey,
      authorName: pageKey,
      createdAt: new Date().toISOString(),
      lang: "vi",
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
      url: `https://www.facebook.com/${encodeURIComponent(pageKey)}/posts/${id}`,
    });
  }

  return posts;
}
