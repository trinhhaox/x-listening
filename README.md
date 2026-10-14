# X Listening

Bàn nghe bài **công khai** trên X. Bạn đặt các tần số (câu tìm kiếm), ứng dụng hỏi X Recent Search theo lịch, lưu bài vào SQLite và xếp thành dây tin.

Ứng dụng không đọc tin nhắn riêng, không đăng nhập hộ tài khoản, và không lấy bài để chế độ riêng tư.

## Chạy

```bash
cp .env.example .env   # đổi ADMIN_PASSWORD
npm install
npm run dev            # http://127.0.0.1:3021
```

Chưa có `X_BEARER_TOKEN` vẫn vào được bàn nghe. Nút **Nạp tin mẫu** tạo vài bài giả có dấu **Mẫu** để xem bố cục. Muốn nghe bài thật, điền bearer token của ứng dụng X (quyền đọc recent search) vào `.env` rồi chạy lại.

## Cách đặt tần số

Câu viết theo cú pháp tìm kiếm của X, ví dụ:

```text
"cà phê giấy" OR giaycafe lang:vi
from:username -is:reply
```

Ô **Bỏ bài đăng lại** tự thêm `-is:retweet` nếu câu chưa có `is:retweet`.

Mỗi lượt chỉ lấy một trang (mặc định 20 bài) cho mỗi tần số đang bật, rồi nhớ `since_id` để lần sau lấy phần mới hơn. Lịch mặc định là 15 phút.

Sắc thái “nghiêng tốt / nghiêng xấu” là đếm từ vựng tiếng Việt và tiếng Anh, có xét “không” đứng ngay trước. Đây không phải mô hình cảm xúc.

Trên mỗi bài có thể **ghim**, **giấu**, hoặc viết ghi chú nội bộ. Dây tin có ba ngăn: đang xem, đã ghim, đã giấu. Bài đã giấu không tính vào số liệu.

**Chuông** kêu khi bài mới (và bài đang lưu lúc đặt chuông) nghiêng xấu, chứa một cụm từ, hoặc đủ số lượt thích. Chuông có thể áp cho một tần số hoặc mọi tần số. Bấm **Đã xem** để tắt một hồi chuông.

## Kiểm tra

```bash
npm test
npm run typecheck
```
