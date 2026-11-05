import { listPagePosts } from "./facebook.js";
import { buildSearchQuery } from "./query.js";
import { searchRecentPosts } from "./xapi.js";
import { listThreadsPosts } from "./threads.js";
import { searchYoutubeVideos } from "./youtube.js";
import { searchXWithCookie } from "./xcookie.js";
import { scrapeFacebookPageWithCookie } from "./fbcookie.js";
import type { Store, Topic } from "./db.js";
import { muteKey } from "./db.js";

export const PAGE_CAP = 5;

export type ListenReport = {
  saved: number;
  topics: number;
  errors: string[];
};

export async function listenOnce(
  store: Store,
  options: {
    token: string;
    twitterAuthToken?: string;
    twitterCt0?: string;
    facebookToken?: string;
    facebookCookie?: string;
    threadsToken?: string;
    youtubeApiKey?: string;
    maxResults: number;
    now?: Date;
    fetchImpl?: typeof fetch;
    onlyTopicId?: string;
    startTime?: string;
  },
): Promise<ListenReport> {
  const selected = options.onlyTopicId ? store.getTopic(options.onlyTopicId) : undefined;
  if (options.onlyTopicId && !selected) {
    return { saved: 0, topics: 0, errors: ["Không còn tần số này."] };
  }
  const topics = selected ? [selected] : store.listTopics().filter((topic) => topic.active === 1);
  const xTopics = topics.filter((topic) => topic.source === "x" || (!topic.source && topic.source !== "facebook"));
  const fbTopics = topics.filter((topic) => topic.source === "facebook");
  const threadsTopics = topics.filter((topic) => topic.source === "threads");
  const youtubeTopics = topics.filter((topic) => topic.source === "youtube");
  const now = options.now ?? new Date();
  const errors: string[] = [];
  let saved = 0;
  const muted = new Set(store.listMuted());

  const hasXAuth = Boolean(options.token.trim() || (options.twitterAuthToken?.trim() && options.twitterCt0?.trim()));
  const hasFbAuth = Boolean(options.facebookToken?.trim() || options.facebookCookie?.trim());

  if (xTopics.length > 0 && !hasXAuth) {
    errors.push("Chưa có X_BEARER_TOKEN hoặc (TWITTER_AUTH_TOKEN và TWITTER_CT0) trong môi trường.");
  }
  if (fbTopics.length > 0 && !hasFbAuth) {
    errors.push("Chưa có FACEBOOK_ACCESS_TOKEN hoặc FACEBOOK_COOKIE trong môi trường.");
  }
  if (threadsTopics.length > 0 && !options.threadsToken?.trim()) {
    errors.push("Chưa có THREADS_ACCESS_TOKEN trong môi trường.");
  }
  if (youtubeTopics.length > 0 && !options.youtubeApiKey?.trim()) {
    errors.push("Chưa có YOUTUBE_API_KEY trong môi trường.");
  }

  for (const topic of xTopics) {
    if (!hasXAuth) continue;
    try {
      const query = buildSearchQuery(topic.query, topic.exclude_reposts === 1);
      let pulled: { saved: number; newest: string | null; incomplete: boolean };
      if (options.token.trim()) {
        pulled = await pullPages(store, topic.id, query, topic.since_id, muted, {
          ...options,
          now,
        });
      } else {
        pulled = await pullPagesWithCookie(store, topic.id, query, topic.since_id, muted, {
          twitterAuthToken: options.twitterAuthToken ?? "",
          twitterCt0: options.twitterCt0 ?? "",
          maxResults: options.maxResults,
          now,
          fetchImpl: options.fetchImpl,
        });
      }
      saved += pulled.saved;
      finishTopic(store, topic, pulled, errors, now, (newest) => newerSnowflake(topic.since_id, newest));
    } catch (error) {
      failTopic(store, topic, error, errors, now);
    }
  }

  for (const topic of fbTopics) {
    if (!hasFbAuth) continue;
    try {
      let pulled: { saved: number; newest: string | null; incomplete: boolean };
      if (options.facebookToken?.trim()) {
        pulled = await pullFacebook(store, topic, muted, { ...options, facebookToken: options.facebookToken, now });
      } else {
        pulled = await pullFacebookWithCookie(store, topic, muted, {
          facebookCookie: options.facebookCookie ?? "",
          now,
          fetchImpl: options.fetchImpl,
        });
      }
      saved += pulled.saved;
      finishTopic(store, topic, pulled, errors, now, (newest) => newerUnix(topic.since_id, newest));
    } catch (error) {
      failTopic(store, topic, error, errors, now);
    }
  }

  for (const topic of threadsTopics) {
    if (!options.threadsToken?.trim()) continue;
    try {
      const pulled = await pullThreads(store, topic, muted, { ...options, threadsToken: options.threadsToken, now });
      saved += pulled.saved;
      finishTopic(store, topic, pulled, errors, now, (newest) => newerUnix(topic.since_id, newest));
    } catch (error) {
      failTopic(store, topic, error, errors, now);
    }
  }

  for (const topic of youtubeTopics) {
    if (!options.youtubeApiKey?.trim()) continue;
    try {
      const pulled = await pullYoutube(store, topic, muted, { ...options, youtubeApiKey: options.youtubeApiKey, now });
      saved += pulled.saved;
      finishTopic(store, topic, pulled, errors, now, (newest) => newest ?? topic.since_id);
    } catch (error) {
      failTopic(store, topic, error, errors, now);
    }
  }

  return { saved, topics: topics.length, errors };
}

async function pullPages(
  store: Store,
  topicId: string,
  query: string,
  sinceId: string | null,
  muted: Set<string>,
  options: {
    token: string;
    maxResults: number;
    now: Date;
    fetchImpl?: typeof fetch;
    startTime?: string;
  },
): Promise<{ saved: number; newest: string | null; incomplete: boolean }> {
  let nextToken: string | null = null;
  let newest: string | null = null;
  let saved = 0;
  const sinceForQuery = options.startTime ? null : sinceId;

  for (let page = 0; page < PAGE_CAP; page++) {
    const result = await searchRecentPosts(
      options.token,
      query,
      options.maxResults,
      sinceForQuery,
      options.fetchImpl,
      { nextToken, startTime: options.startTime },
    );
    for (const post of result.posts) {
      if (!/^\d+$/.test(post.id)) continue;
      newest = newerSnowflake(newest, post.id);
      const username = post.authorUsername.replace(/[^\w.]/g, "").slice(0, 32) || "unknown";
      if (muted.has(muteKey(username) ?? "")) continue;
      const wrote = store.insertMention(
        {
          id: post.id,
          topicId,
          text: post.text.slice(0, 2000),
          authorUsername: username,
          authorName: post.authorName.slice(0, 80),
          createdAt: post.createdAt,
          lang: post.lang.slice(0, 12),
          likeCount: post.likeCount,
          repostCount: post.repostCount,
          replyCount: post.replyCount,
          quoteCount: post.quoteCount,
        },
        options.now.toISOString(),
      );
      if (wrote) saved += 1;
    }
    newest = newerSnowflake(newest, result.newestId);
    if (!result.nextToken) return { saved, newest, incomplete: false };
    nextToken = result.nextToken;
  }

  return { saved, newest, incomplete: true };
}

async function pullFacebook(
  store: Store,
  topic: Topic,
  muted: Set<string>,
  options: {
    facebookToken: string;
    maxResults: number;
    now: Date;
    fetchImpl?: typeof fetch;
    startTime?: string;
  },
): Promise<{ saved: number; newest: string | null; incomplete: boolean }> {
  let after: string | null = null;
  let newest: string | null = null;
  let saved = 0;
  const sinceUnix = options.startTime ? unixSeconds(options.startTime) : unixSince(topic.since_id);
  const phrase = topic.phrase.trim().toLocaleLowerCase("vi");

  for (let page = 0; page < PAGE_CAP; page++) {
    const result = await listPagePosts(options.facebookToken, topic.query, options.maxResults, sinceUnix, options.fetchImpl, { after });
    for (const post of result.posts) {
      newest = newerUnix(newest, String(post.createdUnix));
      if (phrase && !post.text.toLocaleLowerCase("vi").includes(phrase)) continue;
      if (muted.has(muteKey(post.authorUsername) ?? "")) continue;
      const wrote = store.insertMention(
        {
          id: post.id,
          topicId: topic.id,
          text: post.text.slice(0, 2000),
          authorUsername: post.authorUsername,
          authorName: post.authorName,
          createdAt: post.createdAt,
          lang: "",
          likeCount: post.likeCount,
          repostCount: post.repostCount,
          replyCount: post.replyCount,
          quoteCount: 0,
          url: post.url,
        },
        options.now.toISOString(),
      );
      if (wrote) saved += 1;
    }
    if (!result.after) return { saved, newest, incomplete: false };
    after = result.after;
  }

  return { saved, newest, incomplete: true };
}

async function pullThreads(
  store: Store,
  topic: Topic,
  muted: Set<string>,
  options: {
    threadsToken: string;
    maxResults: number;
    now: Date;
    fetchImpl?: typeof fetch;
    startTime?: string;
  },
): Promise<{ saved: number; newest: string | null; incomplete: boolean }> {
  let after: string | null = null;
  let newest: string | null = null;
  let saved = 0;
  const sinceUnix = options.startTime ? unixSeconds(options.startTime) : unixSince(topic.since_id);
  const phrase = topic.phrase.trim().toLocaleLowerCase("vi");

  for (let page = 0; page < PAGE_CAP; page++) {
    const result = await listThreadsPosts(
      options.threadsToken,
      topic.query,
      options.maxResults,
      sinceUnix,
      options.fetchImpl,
      { after },
    );
    for (const post of result.posts) {
      newest = newerUnix(newest, String(post.createdUnix));
      if (phrase && !post.text.toLocaleLowerCase("vi").includes(phrase)) continue;
      if (muted.has(muteKey(post.authorUsername) ?? "")) continue;
      const wrote = store.insertMention(
        {
          id: post.id,
          topicId: topic.id,
          text: post.text.slice(0, 2000),
          authorUsername: post.authorUsername,
          authorName: post.authorName,
          createdAt: post.createdAt,
          lang: "",
          likeCount: post.likeCount,
          repostCount: post.repostCount,
          replyCount: post.replyCount,
          quoteCount: post.quoteCount,
          url: post.url,
        },
        options.now.toISOString(),
      );
      if (wrote) saved += 1;
    }
    if (!result.after) return { saved, newest, incomplete: false };
    after = result.after;
  }

  return { saved, newest, incomplete: true };
}

async function pullYoutube(
  store: Store,
  topic: Topic,
  muted: Set<string>,
  options: {
    youtubeApiKey: string;
    maxResults: number;
    now: Date;
    fetchImpl?: typeof fetch;
    startTime?: string;
  },
): Promise<{ saved: number; newest: string | null; incomplete: boolean }> {
  let pageToken: string | null = null;
  let newest: string | null = null;
  let saved = 0;
  const publishedAfter = options.startTime ?? topic.since_id;

  for (let page = 0; page < PAGE_CAP; page++) {
    const result = await searchYoutubeVideos(
      options.youtubeApiKey,
      topic.query,
      options.maxResults,
      publishedAfter,
      options.fetchImpl,
      pageToken,
    );
    for (const post of result.posts) {
      if (!newest || Date.parse(post.createdAt) > Date.parse(newest)) {
        newest = post.createdAt;
      }
      if (muted.has(muteKey(post.authorUsername) ?? "")) continue;
      const wrote = store.insertMention(
        {
          id: post.id,
          topicId: topic.id,
          text: post.text.slice(0, 2000),
          authorUsername: post.authorUsername,
          authorName: post.authorName,
          createdAt: post.createdAt,
          lang: "",
          likeCount: post.likeCount,
          repostCount: post.repostCount,
          replyCount: post.replyCount,
          quoteCount: 0,
          url: post.url,
        },
        options.now.toISOString(),
      );
      if (wrote) saved += 1;
    }
    if (!result.nextPageToken) return { saved, newest, incomplete: false };
    pageToken = result.nextPageToken;
  }

  return { saved, newest, incomplete: true };
}

function finishTopic(
  store: Store,
  topic: Topic,
  pulled: { newest: string | null; incomplete: boolean },
  errors: string[],
  now: Date,
  nextSince: (newest: string | null) => string | null,
): void {
  if (pulled.incomplete) {
    errors.push(`${topic.name}: còn trang chưa lấy (tối đa ${PAGE_CAP}). Mốc giữ nguyên.`);
    store.markTopicListened(topic.id, null, `Còn trang chưa lấy, tối đa ${PAGE_CAP} trang.`, now.toISOString());
    return;
  }
  store.markTopicListened(topic.id, nextSince(pulled.newest), null, now.toISOString());
}

function failTopic(store: Store, topic: Topic, error: unknown, errors: string[], now: Date): void {
  const message = error instanceof Error ? error.message : "Lỗi không rõ";
  errors.push(`${topic.name}: ${message}`);
  store.markTopicListened(topic.id, null, message, now.toISOString());
}

function unixSeconds(iso: string): number | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function unixSince(value: string | null): number | null {
  if (!value || !/^\d{10}$/.test(value)) return null;
  return Number(value);
}

function newerUnix(current: string | null, incoming: string | null): string | null {
  if (!incoming || !/^\d{10}$/.test(incoming)) return current;
  if (!current || !/^\d{10}$/.test(current)) return incoming;
  return Number(incoming) > Number(current) ? incoming : current;
}

function newerSnowflake(current: string | null, incoming: string | null): string | null {
  if (!incoming || !/^\d+$/.test(incoming)) return current;
  if (!current || !/^\d+$/.test(current)) return incoming;
  return BigInt(incoming) > BigInt(current) ? incoming : current;
}

async function pullPagesWithCookie(
  store: Store,
  topicId: string,
  query: string,
  sinceId: string | null,
  muted: Set<string>,
  options: {
    twitterAuthToken: string;
    twitterCt0: string;
    maxResults: number;
    now: Date;
    fetchImpl?: typeof fetch;
  },
): Promise<{ saved: number; newest: string | null; incomplete: boolean }> {
  let newest: string | null = null;
  let saved = 0;
  const posts = await searchXWithCookie({
    authToken: options.twitterAuthToken,
    ct0: options.twitterCt0,
    query,
    count: options.maxResults,
    fetchImpl: options.fetchImpl,
  });

  for (const post of posts) {
    if (!/^\d+$/.test(post.id)) continue;
    newest = newerSnowflake(newest, post.id);
    const username = post.authorUsername.replace(/[^\w.]/g, "").slice(0, 32) || "unknown";
    if (muted.has(muteKey(username) ?? "")) continue;
    const wrote = store.insertMention(
      {
        id: post.id,
        topicId,
        text: post.text.slice(0, 2000),
        authorUsername: username,
        authorName: post.authorName.slice(0, 80),
        createdAt: post.createdAt,
        lang: post.lang.slice(0, 12),
        likeCount: post.likeCount,
        repostCount: post.repostCount,
        replyCount: post.replyCount,
        quoteCount: post.quoteCount,
        url: post.url,
      },
      options.now.toISOString(),
    );
    if (wrote) saved += 1;
  }

  return { saved, newest, incomplete: false };
}

async function pullFacebookWithCookie(
  store: Store,
  topic: Topic,
  muted: Set<string>,
  options: {
    facebookCookie: string;
    now: Date;
    fetchImpl?: typeof fetch;
  },
): Promise<{ saved: number; newest: string | null; incomplete: boolean }> {
  let saved = 0;
  const posts = await scrapeFacebookPageWithCookie({
    cookie: options.facebookCookie,
    pageKey: topic.query,
    phrase: topic.phrase || undefined,
    fetchImpl: options.fetchImpl,
  });

  for (const post of posts) {
    if (muted.has(muteKey(post.authorUsername) ?? "")) continue;
    const wrote = store.insertMention(
      {
        id: post.id,
        topicId: topic.id,
        text: post.text.slice(0, 2000),
        authorUsername: post.authorUsername.slice(0, 32),
        authorName: post.authorName.slice(0, 80),
        createdAt: post.createdAt,
        lang: post.lang,
        likeCount: post.likeCount,
        repostCount: post.repostCount,
        replyCount: post.replyCount,
        quoteCount: post.quoteCount,
        url: post.url,
      },
      options.now.toISOString(),
    );
    if (wrote) saved += 1;
  }

  return { saved, newest: topic.since_id, incomplete: false };
}
