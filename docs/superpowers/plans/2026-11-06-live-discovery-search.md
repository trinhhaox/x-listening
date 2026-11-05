# Live Discovery Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng tính năng Tra cứu Nhanh Đa Kênh Tức thời (`/search`) cho phép nhập từ khóa/hashtag, chọn nhiều kênh nguồn (X, Facebook, Threads, YouTube, Báo chí) và xem kết quả trực tiếp trên giao diện mà không lưu vào database.

**Architecture:** Mở rộng backend với hàm tổng hợp `searchLiveMentions` chạy song song (`Promise.allSettled`) các trình cào dữ liệu X, Facebook, Threads, YouTube, Báo chí; tự động chấm sắc thái cảm xúc qua `analyzeSentiment`; phục vụ giao diện HeroUI tại route `GET /search`.

**Tech Stack:** TypeScript, Node.js (v24), Fastify/Node native HTTP routing, SQLite (chỉ dùng đọc config, không lưu kết quả search), HeroUI CSS & Lucide SVG Icons.

**Spec:** `docs/superpowers/specs/2026-11-06-live-discovery-search-design.md`

## Global Constraints
- Mọi câu chữ trên giao diện phải dùng tiếng Việt tự nhiên, trực quan.
- Kết quả tra cứu tức thời KHÔNG ĐƯỢC ghi vào cơ sở dữ liệu (`mentions` table).
- Giao diện tuân thủ chuẩn HeroUI (Navbar 64px, Card bo tròn, SVG icons từ `src/icons.ts`).
- Tuân thủ quy tắc commit/push: Chỉ commit và push khi người dùng ra lệnh trực tiếp.

## Review Focus
- Trường hợp query rỗng hoặc toàn khoảng trắng: Trả về trang tìm kiếm kèm thông báo nhắc nhở nhẹ nhàng, không gọi crawler.
- Trường hợp người dùng không chọn kênh nào: Mặc định chọn tất cả 5 kênh hoặc thông báo cần chọn ít nhất 1 kênh.
- Trường hợp một kênh mạng xã hội bị lỗi hoặc hết hạn cookie/token: Kênh đó không làm sập các kênh còn lại (`Promise.allSettled`).
- Xử lý hashtag có dấu `#` hoặc không có dấu `#`: Chuẩn hóa query đồng bộ.
- Kênh X / Threads / Facebook cào về rỗng: Hiển thị trạng thái "Không tìm thấy bài viết" cho kênh đó mà không báo lỗi 500.

---

### Task 1: Module `searchLiveMentions` trong `src/social_search.ts`

**Files:**
- Modify: `src/social_search.ts`
- Test: `test/live_search.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LiveSearchItem = {
    id: string;
    source: "x" | "facebook" | "threads" | "youtube" | "web";
    author_name: string;
    author_username: string;
    text: string;
    url: string;
    created_at: string;
    like_count: number;
    reply_count: number;
    repost_count: number;
    sentiment: "positive" | "negative" | "neutral";
  };

  export type LiveSearchResult = {
    query: string;
    channels: string[];
    items: LiveSearchItem[];
    counts: { total: number; positive: number; negative: number; neutral: number };
    errors: { channel: string; error: string }[];
  };

  export async function searchLiveMentions(
    query: string,
    channels: string[],
    config: AppConfig,
  ): Promise<LiveSearchResult>
  ```

- [ ] **Step 1: Write unit tests in `test/live_search.test.ts`**
- [ ] **Step 2: Run test to verify it fails (`npm test`)**
- [ ] **Step 3: Implement `searchLiveMentions` in `src/social_search.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 2: Giao diện Tra cứu Nhanh `searchPage` trong `src/pages.ts`

**Files:**
- Modify: `src/pages.ts`
- Test: `test/live_search.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SearchPageModel = {
    query: string;
    selectedChannels: string[];
    result?: LiveSearchResult;
    notice?: string;
  };

  export function searchPage(model: SearchPageModel): string;
  ```
- Cập nhật `renderNavbar(activeTab)`: Thêm tab `Tra cứu` (`/search`, icon `search`).

- [ ] **Step 1: Write test checking `searchPage` renders correctly with form and result cards**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `searchPage` and update `renderNavbar` in `src/pages.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 3: Tích hợp Route `GET /search` vào `src/app.ts`

**Files:**
- Modify: `src/app.ts`
- Test: `test/live_search.test.ts`

**Interfaces:**
- Consumes: `searchLiveMentions`, `searchPage`
- Produces: `GET /search` endpoint với query params `q` và `channel`

- [ ] **Step 1: Write route integration test in `test/live_search.test.ts`**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Wire up route in `src/app.ts`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Run full suite (`npm run typecheck && npm test`)**

