# Đường đua tri thức

> Cập nhật self-signup (07/11/2026): giáo viên tự đăng ký, xác nhận email rồi đăng nhập; backend tạo profile idempotent, không duyệt tài khoản mới. Xem [SUPABASE_AUTH_PRODUCTION_MIGRATION.md](SUPABASE_AUTH_PRODUCTION_MIGRATION.md) cho schema004, Turnstile, SMTP, flags và các chốt production chưa thực hiện.

> Giai đoạn9B.2 (07/11/2026): [SUPABASE_AUTH_PRODUCTION_MIGRATION.md](SUPABASE_AUTH_PRODUCTION_MIGRATION.md) mô tả Auth/recovery, schema003, migration tài khoản có retry, kiểm thử local và các bước production còn cần phê duyệt. Chưa mở production.

> Cập nhật 06/11/2026: triển khai production theo quyết định **không tạo staging riêng**. Xem [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md) và [PRODUCTION_IMPLEMENTATION.md](PRODUCTION_IMPLEMENTATION.md). Các phần khảo sát/staging dưới đây là lịch sử; không dùng để tự publish hoặc thay target của công cụ cũ.


Game đua xe 2.5D cho “Vui học cùng cô”, dùng React, TypeScript và Phaser 3. Đồ họa đường đua được vẽ bằng Graphics, không cần engine 3D; avatar tùy chọn lấy từ kho ảnh riêng của giáo viên. Chơi đơn không cần tài khoản/backend; chế độ phòng trực tuyến dùng Node.js + Socket.IO, chưa dùng Supabase.

## Phòng trực tuyến (giai đoạn 3)

Xem [MULTIPLAYER.md](MULTIPLAYER.md) để chạy máy chủ, tham gia bằng QR, cấu hình Wi-Fi/hosting và xem kiến trúc, giới hạn, kiểm thử.

## Phát triển

Node.js 24 trở lên (SQLite tích hợp trong Node). Tại thư mục repository:

```sh
npm ci
npm run dev
```

```sh
npm run typecheck
npm test
npm run build
```

Vite tạo bản tĩnh trong `dist/`. `base: './'` hỗ trợ đặt dưới đường dẫn con. Để tích hợp vào React có sẵn, dùng `GameCanvas`, kết nối hàm gửi `RaceCommand` và nhận `RaceSnapshot`; CSS hiện tại là CSS của trang demo, cần giới hạn phạm vi khi ghép vào website khác.

## Chơi

Bấm Bắt đầu; cả 5 xe tự chạy. Phím ←/→ hoặc nút chuyển làn điều khiển xe vàng. Mỗi câu chỉ được trả lời một lần: đúng nhận 3 giây tăng tốc; sai hủy tăng tốc hiện tại, không thay đổi hiệu ứng chậm do vật cản. Chóp làm chậm xe 1,8 giây. Tạm dừng đóng băng thời gian và hiệu ứng; Chơi lại đưa về màn chờ. Khi xe chính về đích, cuộc đua dừng và giữ thứ hạng. Các xe đối thủ không va chạm với nhau; xe phía sau ngoài tầm nhìn vẫn xuất hiện trong bảng xếp hạng.

## Cấu trúc

- `src/game/config.ts`: số xe, 3 làn, màu xe, tốc độ (m/s), chiều dài đường đua, thời lượng hiệu ứng.
- `src/game/RaceModel.ts`: mô phỏng độc lập với renderer; nhận lệnh, xuất snapshot có ID xe ổn định.
- `src/game/RaceScene.ts`: phối cảnh giả 3D, vẽ cảnh, xe, chóp, bàn phím; cập nhật UI 10 lần/giây, render tối đa 60 FPS.
- `src/game/GameCanvas.tsx`: vòng đời Phaser và cầu nối React; hủy game, sự kiện, canvas khi unmount.
- `src/main.tsx`: trang chơi, phối hợp phiên câu hỏi với cuộc đua và bảng xếp hạng.

Chế độ chơi đơn mô phỏng cục bộ. Chế độ trực tuyến có phòng tối đa 20 học sinh, QR, máy chủ chấm đáp án/mô phỏng xe và nội suy ở màn giáo viên; xem MULTIPLAYER.md.

Chỉnh `carCount`, `baseSpeed`, `trackLength` trong config; renderer hiện thiết kế cho đúng 3 làn. Hệ thống câu hỏi chỉ lưu trong bộ nhớ của phiên; chưa lưu lên máy chủ.


## Soạn và chơi bộ câu hỏi (giai đoạn 2)

Bấm **Quản lý câu hỏi** để mở bản nháp. Cuộc đua đang chạy sẽ tạm dừng. Giáo viên có thể sửa tên bộ đề, thêm/sửa/xóa câu, dùng Lên/Xuống để đổi thứ tự, tạo 2–4 phương án, chọn một đáp án đúng và thời gian 5–120 giây. Mỗi bộ chứa 1–100 câu. Ảnh tải lên hỗ trợ PNG/JPEG/WebP tối đa 2 MB và 4096 × 4096 pixel; ảnh được nhúng data URL trong JSON, không tải lên dịch vụ ngoài.

**Xuất JSON** kiểm tra dữ liệu và tải bộ đề xuống máy. **Nhập JSON** (tối đa 32 MB) nạp vào bản nháp; dữ liệu sai định dạng bị từ chối và bộ đang chơi vẫn giữ nguyên. **Áp dụng bộ câu hỏi & đặt lại cuộc đua** dùng bản nháp, xóa kết quả và đưa cuộc đua về màn chờ. Đóng bản nháp không tự áp dụng. Bộ đề chưa xuất sẽ mất khi tải lại trang.

Câu hỏi được hiển thị theo thứ tự. Đáp án đã chọn hoặc hết giờ đều khóa câu hiện tại; bấm **Câu tiếp theo** để tiếp tục. Hết giờ ghi một câu sai với đáp án `null`. Hoàn thành bộ câu hỏi không lặp lại bộ đề; xe tiếp tục đua tới đích. Về đích dừng nhận câu trả lời, câu chưa trả lời không tính vào tổng sai. Chơi lại xóa kết quả nhưng giữ bộ đề đã áp dụng. Kết quả chi tiết xem trong mục **Kết quả trong phiên**.

Âm đúng/sai được tổng hợp bằng Web Audio sau thao tác chọn đáp án. Nút đọc dùng Speech Synthesis với `vi-VN`; chất lượng/giọng tiếng Việt tùy trình duyệt và hệ điều hành. Nếu trình duyệt chặn âm thanh, phản hồi chữ vẫn hoạt động. Tạm dừng/chuyển câu/mở trình soạn sẽ hủy lời đọc.

### Ranh giới logic và dữ liệu

- `src/questions/model.ts`: kiểu dữ liệu, kiểm tra JSON, bộ mặc định và `QuestionSession` độc lập React/Phaser. Kết quả gồm `questionId`, `selectedOptionId`, `correct`, `responseTime` (giây), `timedOut`; tổng đúng/sai được tính từ kết quả.
- `src/questions/QuestionEditor.tsx`: trình soạn bản nháp và nhập/xuất.
- `src/questions/QuestionPanel.tsx`: hiển thị câu, đồng hồ, đáp án và kết quả.
- `src/questions/audio.ts`: âm phản hồi và đọc tiếng Việt.

`QuestionSession.sync(elapsed, status)` nhận thời gian mô phỏng từ snapshot cuộc đua (10 Hz), vì vậy tạm dừng đóng băng đồng hồ và phản hồi thời gian có độ phân giải khoảng 0,1 giây. `answer(questionId, optionId)` từ chối đáp án cũ, sai ID, câu đã trả lời và thao tác khi không chạy. Chỉ kết quả mới được chấp nhận mới cấp thưởng. `next()` không bỏ qua câu chưa trả lời. `reset()` xóa trạng thái phiên.

Để mở phòng 15–20 thiết bị trong giai đoạn tiếp theo: chuyển quyền chấm điểm/thời gian/cấp thưởng lên máy chủ, thêm ID phòng/người chơi/phiên và số thứ tự lệnh, chống gửi lặp, phân phối câu không lộ đáp án đúng tới client, rồi đồng bộ snapshot. Giai đoạn 3 đã bổ sung máy chủ phòng và kiểm thử 20 client mô phỏng; chưa kiểm thử 20 thiết bị thật. Bản cục bộ chứa đáp án đúng trong bộ đề và không cung cấp cơ chế chống gian lận.

## Tối ưu 20 người chơi (giai đoạn 4)

Xem [PERFORMANCE.md](PERFORMANCE.md) để biết cache texture, nội suy, camera, chống lệnh trùng, số đo FPS/RTT/bộ nhớ, danh sách file và checklist 20 điện thoại thật.

## Đường đua chung 3 làn

Bản cập nhật mới thay lưới giãn vị trí bằng phối cảnh theo vị trí server thật, 7 hàng xuất phát và bản đồ tiến độ 20 xe. Xem [THREE_LANE_TRACK.md](THREE_LANE_TRACK.md) cho quy tắc xuất phát, camera, kiểm thử, số đo và danh sách file.

## Lớp học và ảnh đại diện lưu lâu dài

Xem [CLASSROOMS.md](CLASSROOMS.md): tài khoản giáo viên, SQLite, API riêng tư, nhập CSV/XLSX, ảnh 128 × 128, phòng chọn hồ sơ, backup/restore và kết quả kiểm thử. Hồ sơ lưu trên đĩa; phòng và kết quả vẫn lưu RAM. Chơi đơn và phòng nhập tên nhanh vẫn dùng được.

## Phiên chơi bền vững (giai đoạn 6)

[PERFORMANCE_AND_SESSIONS.md](PERFORMANCE_AND_SESSIONS.md) mô tả migration 2, checkpoint mỗi giây và transaction trước ACK, khôi phục về tạm dừng, lịch sử riêng từng giáo viên, quyền xuất/xóa kết quả và benchmark trước/sau. Giữ nguyên hai đường dẫn CLASSROOM_* khi khởi động lại. Phòng đang đua cần giáo viên xác nhận tiếp tục; lớp và ảnh vẫn giữ nguyên.
