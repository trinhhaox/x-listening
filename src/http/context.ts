import type { AppConfig } from "../config.js";
import type { Store } from "../db.js";
import type { ListenReport } from "../listen.js";
import type { LiveSearchCache } from "../search_cache.js";
import type { searchLiveMentions } from "../social_search.js";

/** Những thứ dùng chung giữa các nhóm route, do createApp tạo một lần. */
export type AppContext = {
  config: AppConfig;
  store: Store;
  runListen: (extra?: { onlyTopicId?: string; startTime?: string }) => Promise<ListenReport>;
  fanOutHits: () => Promise<void>;
  notifyError: () => string;
  liveSearchCache: LiveSearchCache<Awaited<ReturnType<typeof searchLiveMentions>>>;
};
