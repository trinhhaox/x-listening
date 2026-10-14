# X Listening

Bàn nghe bài **công khai** trên X và bài của **Trang Facebook**. Trên X, một tần số là câu tìm kiếm. Trên Facebook, một tần số là một Trang: Graph API không cho tìm từ khóa trên mọi bài công khai. Ứng dụng hỏi theo lịch, lưu bài vào SQLite và xếp thành dây tin.

Ứng dụng không đọc tin nhắn riêng, không đăng nhập hộ tài khoản, và không lấy bài để chế độ riêng tư.

## Chạy

```bash
cp .env.example .env   # đổi ADMIN_PASSWORD
npm install
npm run dev            # http://127.0.0.1:3021
```

Chưa có token vẫn vào được bàn nghe. Nút **Nạp tin mẫu** tạo vài bài giả có dấu **Mẫu** để xem bố cục. Muốn nghe X, điền `X_BEARER_TOKEN` (quyền đọc recent search). Muốn nghe một Trang Facebook, điền `FACEBOOK_ACCESS_TOKEN` là token đọc được trang đó (token Trang, hoặc token người dùng đã được Meta cấp `pages_read_engagement`). Rồi chạy lại.

## Cách đặt tần số

Câu viết theo cú pháp tìm kiếm của X, ví dụ:

```text
"cà phê giấy" OR giaycafe lang:vi
from:username -is:reply
```

Ô **Bỏ bài đăng lại** tự thêm `-is:retweet` nếu câu chưa có `is:retweet`.

Tần số Facebook nhận link `facebook.com/ten-trang`, id số, hoặc tên trang. Ô **Cụm giữ lại** chỉ lưu bài của trang có chứa cụm đó. Ứng dụng không quét nhóm, tin nhắn, hay bài để chế độ riêng tư.

Mỗi lượt lấy tối đa 5 trang cho mỗi tần số đang bật. Mốc `since_id` chỉ nhích khi đã lấy hết trang. Nếu còn trang, mốc giữ nguyên để lần sau không bỏ bài. Nút **Lấy 7 ngày** hỏi lại khoảng 7 ngày gần nhất của một tần số. Recent Search không có bài cũ hơn khoảng 7 ngày. Lịch mặc định là 15 phút.

**Tắt tiếng** chặn bài sau của một tài khoản và đưa bài đã lưu của họ ra khỏi dây tin và số liệu. **Bỏ tắt** để hiện lại.

Mỗi bài có trạng thái **Mới**, **Đang xử lý**, **Xong**. Bài xong vẫn được tính. **Giấu** mới loại bài khỏi số liệu.

**Đột biến** hiện khi hôm nay có ít nhất 5 bài và số đó gấp từ 3 lần trung vị của 6 ngày trước (giờ Việt Nam). Ngày không có bài được tính là 0.

**Bản tin** (`/brief`) gom bài trong ngày, bài nghiêng xấu, người viết lần đầu và bài đang ghim. Có bản Markdown tại `/brief.md`.

**So tần số** (`/compare`) vẽ số bài và số người viết của hai tần số trên 7 ngày.

Sắc thái “nghiêng tốt / nghiêng xấu” là đếm từ vựng tiếng Việt và tiếng Anh, có xét “không” đứng ngay trước. Đây không phải mô hình cảm xúc. Mục **Từ của bạn** thêm hoặc ghi đè một từ, rồi chấm lại bài đã lưu.

Trên mỗi bài có thể **ghim**, **giấu**, hoặc viết ghi chú nội bộ. Dây tin có ba ngăn: đang xem, đã ghim, đã giấu. Bài đã giấu không tính vào số liệu.

**Chuông** kêu khi bài mới (và bài đang lưu lúc đặt chuông) nghiêng xấu, chứa một cụm từ, hoặc đủ số lượt thích. Chuông có thể áp cho một tần số hoặc mọi tần số. Bấm **Đã xem** để tắt một hồi chuông.

## Kiểm tra

```bash
npm test
npm run typecheck
```
