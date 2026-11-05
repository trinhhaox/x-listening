const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export type YoutubeVideoPost = {
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

type YoutubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    title?: string;
    description?: string;
    channelTitle?: string;
  };
};

type YoutubePayload = {
  items?: YoutubeSearchItem[];
  nextPageToken?: string;
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
};

export class YoutubeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function searchYoutubeVideos(
  apiKey: string,
  query: string,
  maxResults: number,
  publishedAfterIso: string | null,
  fetchImpl: typeof fetch = fetch,
  pageToken?: string | null,
): Promise<{ posts: YoutubeVideoPost[]; nextPageToken: string | null }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) throw new YoutubeApiError("Thiếu YOUTUBE_API_KEY", 401);

  const url = new URL(`${YOUTUBE_API_BASE}/search`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(Math.min(Math.max(maxResults, 1), 50)));
  url.searchParams.set("order", "date");
  url.searchParams.set("key", cleanKey);

  if (publishedAfterIso && !Number.isNaN(Date.parse(publishedAfterIso))) {
    url.searchParams.set("publishedAfter", new Date(publishedAfterIso).toISOString());
  }
  if (pageToken && pageToken.length < 200) {
    url.searchParams.set("pageToken", pageToken);
  }

  const response = await fetchImpl(url);
  const payload = (await response.json().catch(() => ({}))) as YoutubePayload;

  if (!response.ok) {
    if (response.status === 403 && payload.error?.errors?.[0]?.reason === "quotaExceeded") {
      throw new YoutubeApiError("YouTube Data API hết hạn mức trong ngày (Quota Exceeded 403)", 403);
    }
    const msg = payload.error?.message || response.statusText || "Lỗi truy vấn YouTube API";
    throw new YoutubeApiError(`YouTube trả về ${response.status}: ${msg}`, response.status);
  }

  const posts = (payload.items ?? []).flatMap((item) => {
    const videoId = item.id?.videoId;
    if (!videoId || videoId.length > 50) return [];
    const snippet = item.snippet;
    if (!snippet) return [];

    const created = snippet.publishedAt ? Date.parse(snippet.publishedAt) : Number.NaN;
    if (Number.isNaN(created)) return [];

    const title = snippet.title || "";
    const desc = snippet.description || "";
    const text = [title, desc].filter(Boolean).join(" - ").replace(/\s+/g, " ").trim();
    const channelTitle = snippet.channelTitle || "YouTube Channel";
    const channelId = snippet.channelId || "channel";

    return [
      {
        id: videoId,
        text: text || "(Video không có mô tả)",
        authorUsername: channelId,
        authorName: channelTitle,
        createdAt: new Date(created).toISOString(),
        createdUnix: Math.floor(created / 1000),
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
        quoteCount: 0,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      },
    ];
  });

  return {
    posts,
    nextPageToken: payload.nextPageToken || null,
  };
}

