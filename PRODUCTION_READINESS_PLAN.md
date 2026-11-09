# Production — kế hoạch thực hiện và chốt mở truy cập

Ngày 06/11/2026 (UTC+7). Quyết định mới: dùng một hệ thống production, không tạo staging riêng. Dùng địa chỉ mặc định pages.dev/onrender.com trước. Chưa được phép publish, migration dữ liệu thật, đổi DNS, xóa dữ liệu hoặc mở truy cập công khai. Các báo cáo staging trước là lịch sử; không tự đổi tên target của importer để lách chốt xác nhận.

## Khảo sát trước sửa

Đã có PostgreSQL adapter/schema001/importer/rollback, ACK sau commit, queue theo phòng, delta write và fence một writer. Baseline9B.1.1:72 tests, median/P95 20 client95,92/178,57ms, SIGKILL giữ20 ACK, lùi27,80m; Chromium32,18FPS. Đây là local/synthetic, chưa là số đo production hoặc20 điện thoại thật.

Còn thiếu Supabase Auth, mapping teacherId cũ, private avatar object store, Bearer/API/Socket integration, quyền xem danh sách/ảnh trước claim, deployment gate, hosting manifests, migration avatar và quy trình acceptance production. Cookie Strict hiện tại không đủ cho pages.dev→onrender.com. Ảnh local không bền trên Render Free.

## Công việc được phép thực hiện trong workspace

1. Thêm Auth/Storage strategies vào interfaces đã có, không viết lại PostgreSQL adapter hoặc luật game. Migration mới cho Auth links/invite; không sửa001 hoặc SQLite.
2. Giữ bố cục/form hiện tại, thay plumbing đăng nhập/refresh/Bearer và ảnh có xác thực. Student session secret vẫn độc lập, không đưa vào QR.
3. Backend private bucket proxy + owner checks; invite phòng riêng cho QR, không dùng room code làm quyền quản trị hoặc quyền xem ảnh một mình.
4. Cấu hình production mặc định đóng; một instance Render, startup từ chối writer thứ hai. Chuẩn bị Pages gateway cùng origin, tránh phụ thuộc third-party cookies; secret gateway chỉ ở server.
5. Test local với database/dữ liệu giả: Auth/JWT/quyền, Storage/private ảnh,20 client, restart/replay, migration/rollback. Chưa gọi dịch vụ thật khi chưa có cấu hình/ủy quyền.

## Tài khoản và secret cần chuẩn bị

Cloudflare: tài khoản có quyền Pages/Access, repository integration. Render: tài khoản Web Service, một instance, Node24, cùng region gần Supabase. Supabase: project production, DB admin cho operator riêng; DB runtime NOSUPERUSER/NOBYPASSRLS thuộc duaxe_runtime; Auth signing keys/JWKS, private bucket, server Storage secret/service-role riêng. Tắt public signup, cấp tài khoản giáo viên rõ ràng; không tự ghép email để thay owner ID.

Nhập secret trong Settings → Secrets/Environment của từng dịch vụ hoặc secret bindings của môi trường này. Không gửi mật khẩu/token vào chat. Frontend chỉ có Supabase URL/publishable key và URL ứng dụng; không VITE_ database password/service-role/gateway secret. Chưa có credentials nào được cấu hình trong runtime hiện tại.

## Thứ tự production cần xác nhận

1. Hoàn thiện code, local tests, mẫu env và tài liệu; không publish.
2. Chủ dự án cấu hình tài khoản/secret/target. Chốt tên project/URL/region, backup, chế độ đóng và danh sách người kiểm thử. Xin xác nhận riêng trước publish tài nguyên production hoặc chạy migration.
3. Sau xác nhận, tạo schema/bucket/Auth bằng operator, deploy ứng dụng vẫn đóng. Không import lớp/ảnh thật. Xác minh Render trực tiếp bị chặn, frontend/API/WSS đi qua gateway được bảo vệ, preview deployments cũng bị hạn chế.
4. Xin xác nhận mở riêng phạm vi kiểm thử có kiểm soát; dùng20 hồ sơ/ảnh giả, chạy HTTPS/WSS/QR, Auth refresh/logout, quyền chéo lớp/ảnh, trả lời đồng thời, kill/restart, hai writer và xuất kết quả. Ghi RTT median/P95/P99, FPS, RAM, reconnect/lưu lượng. Tiếp tục đóng người dùng thật.
5. Kiểm thử20 điện thoại/tablet thật + máy giáo viên, Wi-Fi chung,45–60 phút, offline/khóa màn hình/tab trùng. Không coi mô phỏng là thay thế thiết bị thật.
6. Backup/verify SQLite+ảnh bản sao và đích, lập batch/manifest/checksum/ID mapping/Auth link; xin xác nhận migration dữ liệu thật. Chạy dry-run/đối chiếu trước apply; không xóa nguồn.
7. Đối chiếu toàn bộ dữ liệu, ảnh, owner, kết quả và thử restore backup. **Dừng xin xác nhận cuối trước khi mở production cho người dùng thật.**

## Điều kiện qua chốt và rollback

Chưa mở nếu secret/config thiếu, ảnh public, quyền chéo tenant sai, WSS/recovery/ACK lỗi, second writer được phép ghi, không restore được backup, hoặc chưa có acceptance thiết bị thật. P95 hiện chưa đạt150ms cần đo/đánh giá tải thực, không bỏ commit/transaction để đạt số.

Rollback code: đóng cổng truy cập, pause/drain, backup PostgreSQL/Auth mapping/object manifest, khôi phục phiên bản code/schema tương thích. Không chỉ đổi về SQLite nếu production đã có kết quả mới: phải export/đối soát trước. Rollback batch chỉ xóa dữ liệu/object do batch tạo và chưa bị thay đổi/tham chiếu; không xóa người dùng Auth dùng chung hoặc ảnh nguồn. DB dump không bao gồm private Storage; cần cả hai backup và kiểm restore.

Trạng thái triển khai thực tế và kiểm thử được cập nhật trong PRODUCTION_IMPLEMENTATION.md sau khi hoàn thiện local; chưa có hành động external nào được thực hiện.
