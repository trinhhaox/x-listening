# Thiết kế Kỹ thuật: Tính năng Tra cứu Nhanh Đa Kênh Tức thời (Live Discovery Search)

## 1. Mục đích & Bối cảnh (Intent & Why)
- **Mục đích**: Cung cấp công cụ tra cứu tức thời theo từ khóa hoặc hashtag trên các kênh mạng xã hội và báo chí được chỉ định (Facebook, X, Threads, YouTube, Báo chí trực tuyến).
- **Đặc điểm cốt lõi**: Kết quả hiển thị tức thì trên màn hình cho người vận hành xem nhanh, **không tự động lưu vào cơ sở dữ liệu** để tránh làm rác dữ liệu giám sát định kỳ hoặc kích hoạt các chuông báo động sai lệch.
- **Tiện ích mở rộng**: Người dùng có thể bấm một nút để "Đưa từ khóa này vào danh sách Nguồn giám sát cố định (Topic)" nếu thấy chủ đề hữu ích.

## 2. Mục tiêu (Goals, Non-Goals, Anti-Goals)
- **Goals**:
  - Trang chuyên dụng `/search` đồng bộ phong cách HeroUI với icon vector SVG.
  - Form tìm kiếm hỗ trợ: nhập từ khóa/hashtag, chọn 1 hoặc nhiều kênh nguồn (X, Facebook, Threads, YouTube, Báo chí).
  - Quét dữ liệu song song qua các module cào thời gian thực hiện có (`social_search.ts`, `xcookie.ts`, `fbcookie.ts`, `threads.ts`, `youtube.ts`).
  - Tự động phân tích sắc thái cảm xúc (Tích cực / Tiêu cực / Trung tính) và hiển thị thẻ bài viết kèm lượt tương tác và liên kết tới bài viết gốc.
  - Tóm tắt nhanh: tổng số bài tìm thấy và tỷ lệ cảm xúc của lượt tra cứu.
- **Non-Goals**:
  - Không tự động lưu các bài viết tra cứu vào bảng `mentions` trong SQLite.
  - Không gửi webhook cảnh báo hay phân công nhân sự tự động cho các bài viết tra cứu tạm thời.
- **Anti-Goals**:
  - Không làm treo tiến trình server khi một trong các nền tảng mạng xã hội phản hồi chậm hoặc bị giới hạn tần suất (rate limit) - phải có timeout và xử lý lỗi độc lập cho từng kênh nguồn.

## 3. Kiến trúc Kỹ thuật & Luồng xử lý (Architecture & Workflow)

```
[Người dùng tại /search]
        │
        ▼ (Nhập từ khóa, chọn [X, Facebook, Threads, YouTube, Báo chí])
[GET /search?q=...&channels=...]
        │
   ┌────┴───────────────────────────────┐
   │ Gọi song song (Promise.allSettled) │
   ├────────────────────────────────────┤
   │ 1. searchXWithCookie               │
   │ 2. scrapeFacebookPageWithCookie    │
   │ 3. searchThreadsPosts              │
   │ 4. searchYoutubeVideos             │
   │ 5. searchWebNews                   │
   └────┬───────────────────────────────┘
        │
        ▼
[Tổng hợp danh sách bài viết & Phân tích cảm xúc bằng sentiment.ts]
        │
        ▼
[Hiển thị kết quả tạm thời trên giao diện HeroUI (/search)]
  - Thống kê nhanh: Tổng số bài, % Tích cực / Tiêu cực / Trung tính
  - Danh sách thẻ bài viết kết quả
  - Nút "+ Thêm vào Nguồn giám sát" để tạo Topic nếu muốn
```

## 4. Các thành phần code cần triển khai

1. **Backend Routing (`src/app.ts`)**:
   - Thêm route `GET /search`:
     - Nhận query params: `q` (từ khóa hoặc hashtag), `channels` (danh sách kênh chọn: `x`, `facebook`, `threads`, `youtube`, `web`).
     - Nếu có `q`: gọi hàm quét đa kênh `searchLiveMentions(query, channels, config)`.
     - Phân tích cảm xúc cho từng bài viết tìm được bằng `analyzeSentiment(text)`.
     - Render trang qua hàm `searchPage(...)` trong `src/pages.ts`.

2. **Module Tìm kiếm Trực tiếp (`src/social_search.ts`)**:
   - Hàm `searchLiveMentions(query: string, channels: string[], config: AppConfig)`:
     - Chạy song song qua `Promise.allSettled` với timeout an toàn (ví dụ 8 giây mỗi kênh).
     - Định dạng dữ liệu trả về theo chuẩn cấu trúc bài viết xem nhanh: `id`, `source`, `author_name`, `author_username`, `text`, `url`, `created_at`, `like_count`, `reply_count`, `repost_count`, `sentiment`.

3. **Giao diện HeroUI (`src/pages.ts`)**:
   - Thêm nút menu `Tra cứu` (icon `search`) trên thanh Navbar (`renderNavbar`).
   - Hàm `searchPage(model: SearchPageModel)`:
     - Form tìm kiếm lớn với ô input, checkbox các kênh (Facebook, X, Threads, YouTube, Báo chí), nút bấm quét tìm kiếm.
     - Thanh tóm tắt kết quả (số lượng bài, feelbar cảm xúc).
     - Danh sách bài viết dạng thẻ HeroUI Card thanh lịch, hiển thị nguồn gốc và link xem trực tiếp.
     - Nút hành động nhanh: *"Tạo nguồn theo dõi từ từ khóa này"* gửi POST tới `/topics`.

4. **Kiểm thử tự động (`test/live_search.test.ts`)**:
   - Viết unit test kiểm tra hàm `searchLiveMentions` chạy độc lập, xử lý timeout an toàn và chấm đúng cảm xúc.
   - Kiểm tra route `GET /search` trả về HTML đầy đủ.

