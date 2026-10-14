import { buildSearchQuery } from "./query.js";
import { searchRecentPosts } from "./xapi.js";
import type { Store } from "./db.js";

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
  },
): Promise<ListenReport> {
  const topics = store.listTopics().filter((topic) => topic.active === 1);
  if (!options.token.trim()) {
    return { saved: 0, topics: topics.length, errors: ["Chưa có X_BEARER_TOKEN trong môi trường."] };
  }

  const now = options.now ?? new Date();
  const errors: string[] = [];
  let saved = 0;

  for (const topic of topics) {
    try {
      const query = buildSearchQuery(topic.query, topic.exclude_reposts === 1);
      const result = await searchRecentPosts(
        options.token,
        query,
        options.maxResults,
        topic.since_id,
        options.fetchImpl,
      );
      for (const post of result.posts) {
        if (!/^\d+$/.test(post.id)) continue;
        const wrote = store.insertMention(
          {
            id: post.id,
            topicId: topic.id,
            text: post.text.slice(0, 2000),
            authorUsername: post.authorUsername.replace(/[^\w]/g, "").slice(0, 32) || "unknown",
            authorName: post.authorName.slice(0, 80),
            createdAt: post.createdAt,
            lang: post.lang.slice(0, 12),
            likeCount: post.likeCount,
            repostCount: post.repostCount,
            replyCount: post.replyCount,
            quoteCount: post.quoteCount,
          },
          now.toISOString(),
        );
        if (wrote) saved += 1;
      }
      const newest = newerSnowflake(topic.since_id, result.newestId);
      store.markTopicListened(topic.id, newest, null, now.toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi không rõ";
      errors.push(`${topic.name}: ${message}`);
      store.markTopicListened(topic.id, null, message, now.toISOString());
    }
  }

  return { saved, topics: topics.length, errors };
}

function newerSnowflake(current: string | null, incoming: string | null): string | null {
  if (!incoming || !/^\d+$/.test(incoming)) return current;
  if (!current || !/^\d+$/.test(current)) return incoming;
  return BigInt(incoming) > BigInt(current) ? incoming : current;
}
