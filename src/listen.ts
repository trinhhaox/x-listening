import { buildSearchQuery } from "./query.js";
import { searchRecentPosts } from "./xapi.js";
import type { Store } from "./db.js";
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
  if (!options.token.trim()) {
    return { saved: 0, topics: topics.length, errors: ["Chưa có X_BEARER_TOKEN trong môi trường."] };
  }

  const now = options.now ?? new Date();
  const errors: string[] = [];
  let saved = 0;
  const muted = new Set(store.listMuted());

  for (const topic of topics) {
    try {
      const query = buildSearchQuery(topic.query, topic.exclude_reposts === 1);
      const pulled = await pullPages(store, topic.id, query, topic.since_id, muted, {
        ...options,
        now,
      });
      saved += pulled.saved;
      if (pulled.incomplete) {
        errors.push(`${topic.name}: còn trang chưa lấy (tối đa ${PAGE_CAP}). Mốc giữ nguyên.`);
        store.markTopicListened(topic.id, null, `Còn trang chưa lấy, tối đa ${PAGE_CAP} trang.`, now.toISOString());
      } else {
        store.markTopicListened(topic.id, newerSnowflake(topic.since_id, pulled.newest), null, now.toISOString());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi không rõ";
      errors.push(`${topic.name}: ${message}`);
      store.markTopicListened(topic.id, null, message, now.toISOString());
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

function newerSnowflake(current: string | null, incoming: string | null): string | null {
  if (!incoming || !/^\d+$/.test(incoming)) return current;
  if (!current || !/^\d+$/.test(current)) return incoming;
  return BigInt(incoming) > BigInt(current) ? incoming : current;
}
