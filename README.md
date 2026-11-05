# X Listening

Bàn nghe bài **công khai** trên đa nền tảng: **X**, **Trang Facebook**, **Meta Threads**, và **YouTube**. Trên X và YouTube, một tần số là câu tìm kiếm từ khóa. Trên Facebook, một tần số là một Trang (Page). Trên Threads, một tần số là một tài khoản (@username). Ứng dụng hỏi theo lịch, lưu bài vào SQLite và xếp thành dây tin.

Ứng dụng không đọc tin nhắn riêng, không đăng nhập hộ tài khoản, và không lấy bài để chế độ riêng tư.

## Chạy

```bash
cp .env.example .env   # đổi ADMIN_PASSWORD
npm install
npm run dev            # http://127.0.0.1:3021
```

Chưa có token vẫn vào được bàn nghe. Nút **Nạp tin mẫu** tạo vài bài giả có dấu **Mẫu** để xem bố cục. Muốn nghe nền tảng nào, điền cấu hình tương ứng trong file `.env`:
- `X_BEARER_TOKEN`: quyền đọc recent search trên X.
- `FACEBOOK_ACCESS_TOKEN`: token đọc được Trang Facebook.
- `THREADS_ACCESS_TOKEN`: token Threads Graph API.
- `YOUTUBE_API_KEY`: API key cho YouTube Data API v3.
- `LLM_API_KEY`: token để bật Tóm tắt Điều hành AI và Phân tích bài viết sâu.

## Cách đặt tần số

- **X (Twitter):** Cú pháp tìm kiếm của X, ví dụ: `"cà phê giấy" OR giaycafe lang:vi`. Ô **Bỏ bài đăng lại** tự thêm `-is:retweet`.
- **Facebook:** Nhận link `facebook.com/ten-trang`, id số, hoặc tên trang. Ô **Cụm giữ lại** chỉ lưu bài có chứa cụm đó.
- **Threads:** Nhận `@username` hoặc link `threads.net/@username`. Ô **Cụm giữ lại** chỉ lưu bài chứa cụm đó.
- **YouTube:** Nhận từ khóa tìm kiếm video, ví dụ: `review cà phê giấy`. Tự động theo dõi các video mới xuất bản.

Ứng dụng có cơ chế tự động bắt lỗi tần suất gọi **Rate Limit (HTTP 429)** và đọc header `x-rate-limit-reset` để hiển thị thời gian mở lại chính xác theo giờ Việt Nam.

Mỗi lượt lấy tối đa 5 trang cho mỗi tần số đang bật. Mốc `since_id` chỉ nhích khi đã lấy hết trang. Nếu còn trang, mốc giữ nguyên để lần sau không bỏ bài. Nút **Lấy 7 ngày** hỏi lại khoảng 7 ngày gần nhất của một tần số. Recent Search không có bài cũ hơn khoảng 7 ngày. Lịch mặc định là 15 phút.

**Tắt tiếng** chặn bài sau của một tài khoản và đưa bài đã lưu của họ ra khỏi dây tin và số liệu. **Bỏ tắt** để hiện lại.

Mỗi bài có trạng thái **Mới**, **Đang xử lý**, **Xong**. Bài xong vẫn được tính. **Giấu** mới loại bài khỏi số liệu.

**Đột biến** hiện khi hôm nay có ít nhất 5 bài và số đó gấp từ 3 lần trung vị của 6 ngày trước (giờ Việt Nam). Ngày không có bài được tính là 0.

**Bản tin** (`/brief`) gom bài trong ngày, bài nghiêng xấu, người viết lần đầu và bài đang ghim. Có bản Markdown tại `/brief.md`.

**So tần số** (`/compare`) vẽ số bài và số người viết của hai tần số trên 7 ngày.

Sắc thái “nghiêng tốt / nghiêng xấu” là đếm từ vựng tiếng Việt và tiếng Anh, có xét “không” đứng ngay trước. Đây không phải mô hình cảm xúc. Mục **Từ của bạn** thêm hoặc ghi đè một từ, rồi chấm lại bài đã lưu.

Trên mỗi bài có thể **ghim**, **giấu**, hoặc viết ghi chú nội bộ. Dây tin có ba ngăn: đang xem, đã ghim, đã giấu. Bài đã giấu không tính vào số liệu.

**Chuông** kêu khi bài mới (và bài đang lưu lúc đặt chuông) nghiêng xấu, chứa một cụm từ, đạt ngưỡng lượt thích, hoặc **bùng nổ bài tiêu cực (Velocity)** khi xuất hiện nhiều bài tiêu cực trong một khoảng thời gian ngắn (ví dụ: $\ge 3$ bài xấu trong 60 phút). Chuông có thể áp cho một tần số hoặc mọi tần số. Bấm **Đã xem** để tắt một hồi chuông. Hồi chuông mới còn hiện thông báo trên máy Mac. Đặt `DESKTOP_NOTIFY=0` để tắt. `ALERT_WEBHOOK_URL` nhận địa chỉ https, hoặc http trên máy này; tự động nhận diện và định dạng Rich Embed cho Discord, Block Kit cho Slack, hoặc JSON chuẩn cho Generic Webhook khi có hồi mới.

## Trí tuệ Nhân tạo & Tóm tắt Điều hành (AI Intelligence)

Hỗ trợ mọi endpoint OpenAI-compatible (OpenAI, Gemini OpenAI-compatible, Groq, Ollama, OpenRouter...). Cấu hình trong `.env`:
```bash
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```
- **Bản tin Tóm tắt Điều hành AI (`/brief`):** Tự động đọc các bài đăng trong ngày, phân tích tâm lý đám đông, chỉ ra nguyên nhân gây bức xúc/hài lòng và đề xuất khuyến nghị hành động tức thì cho ban điều hành.
- **API Phân tích Sâu Bài viết (`POST /api/ai/analyze`):** Kiểm tra sắc thái, điểm rủi ro (-100 đến 100), phát hiện mỉa mai (sarcasm) và tóm tắt lý do.

## Tìm kiếm và Lọc trên Dây tin

Trên thanh công cụ **Dây tin**, người vận hành có thể:
- Tìm kiếm từ khóa xuất hiện trong nội dung bài hoặc tên/username tác giả.
- Lọc theo sắc thái: **Nghiêng tốt**, **Nghiêng xấu**, hoặc **Trung tính**.
- Lọc theo ngưỡng số lượt thích tối thiểu (tìm bài có độ lan tỏa cao).
- Giữ nguyên bộ lọc khi chuyển qua các ngăn (Mới, Đang xử lý, Xong, Đã ghim, Đã giấu) hoặc khi xuất file CSV (`/export.csv`).

## API nạp tin từ bên ngoài (Ingest API)

Cho phép các hệ thống crawler bên ngoài (TikTok, YouTube, RSS tin báo...) nạp bài viết vào bàn nghe tập trung:

```bash
curl -X POST http://127.0.0.1:3021/api/mentions \
  -H "Authorization: Bearer <ADMIN_PASSWORD>" \
  -H "Content-Type: application/json" \
  -d '{
    "topicId": "<topic_id>",
    "text": "Nội dung bài viết...",
    "authorUsername": "user_name",
    "authorName": "Tên Hiển Thị",
    "likeCount": 10,
    "url": "https://..."
  }'
```

Bài viết nạp qua API sẽ tự động được chấm điểm sắc thái cảm xúc và kích hoạt chuông cảnh báo tương ứng.

## Quy trình Phối hợp Xử lý & Mẫu Phản hồi Nhanh (Giai đoạn 4)

- **Gán Người Xử lý (Assignee) & Gắn Nhãn (Tagging):**
  - Trực tiếp trên từng thẻ bài viết tại Dây tin, người vận hành có thể nhập tên nhân sự phụ trách (ví dụ: `Tuấn CSKH`) hoặc gắn nhãn phân loại (ví dụ: `Khẩn cấp`, `Góp ý UI`, `Sự cố mạng`).
  - Thanh bộ lọc hỗ trợ lọc tức thì theo `#nhãn` và `👤 người gán`.
- **Kho Mẫu Phản hồi Nhanh (Quick Response Templates):**
  - Thiết lập các mẫu phản hồi chuẩn mực ngay tại cột Sidebar (ví dụ: *Lời xin lỗi sự cố đơn hàng*, *Hướng dẫn liên hệ bảo hành*).
  - Đội ngũ CSKH và truyền thông có thể dễ dàng sao chép để xử lý khủng hoảng hoặc tương tác với khách hàng.
- **Tự động gửi Báo cáo Điều hành qua Webhook:**
  - Nút **Gửi Webhook** trực tiếp trên trang `/brief` cho phép gửi báo cáo tóm tắt dư luận kèm phân tích AI đến kênh Discord/Slack điều hành.
  - Hỗ trợ endpoint tự động hóa cho các hệ thống Cronjob:
    ```bash
    curl -X POST http://127.0.0.1:3021/api/reports/send \
      -H "Authorization: Bearer <ADMIN_PASSWORD>"
    ```

## Hỗ trợ Kỹ thuật & Tích hợp

- Kênh hỗ trợ kỹ thuật chính thức: **Zalo OA XOX**: [https://zalo.me/3972600953931944918](https://zalo.me/3972600953931944918).

## Kiểm tra

```bash
npm test
npm run typecheck
```
