# Hướng dẫn triển khai Cloudflare Pages + Render + Supabase

> Cập nhật 06/11/2026: triển khai production theo quyết định **không tạo staging riêng**. Xem [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md) và [PRODUCTION_IMPLEMENTATION.md](PRODUCTION_IMPLEMENTATION.md). Các phần khảo sát/staging dưới đây là lịch sử; không dùng để tự publish hoặc thay target của công cụ cũ.


Ngày 06/11/2026 (UTC+7). **Đây là runbook cho bước triển khai sau, chưa phải bằng chứng hệ thống đã được chuyển cloud.** Hiện mã nguồn vẫn dùng SQLite, cookie giáo viên và ảnh local. Không chạy bản này trên Render Free rồi coi DB/ảnh đã bền vững. Phiên khảo sát chỉ tạo tài liệu, không đăng nhập dịch vụ, tạo project, migration hoặc deploy.

Đọc [CLOUD_MIGRATION_PLAN.md](CLOUD_MIGRATION_PLAN.md) về schema/ID/RLS/import, async transaction, quyền giáo viên và reconnect. Đọc [CLASSROOM_READINESS.md](CLASSROOM_READINESS.md) về checklist thiết bị thật, lỗi crash và giới hạn đo local. Không dùng số đo loopback để kết luận Internet/Render đã đạt.

## 1. Điều kiện phải hoàn thành trước deploy staging

- Có adapter PostgreSQL/Auth/Storage hoạt động, SQL migration versioned đã review, per-room queue và quy tắc ACK sau commit; các phần này **chưa có trong mã hiện tại**.
- Có tài khoản/project Supabase **staging riêng**, Render service staging và Cloudflare Pages staging, người phụ trách xác nhận đúng project IDs/origins; dùng dữ liệu giả trước. Không tự áp dụng vào production.
- Có `ClassroomRepository` async, `SessionRepository` async, private AvatarStore, Auth token validation và frontend Supabase session. Không triển khai chỉ bằng cách đặt SUPABASE_URL lên ứng dụng SQLite hiện tại.
- Giữ Node 24+, package-lock nhất quán, rollback release artifact và backup nguồn. Git hiện chưa có commit, toàn bộ mã untracked; cần phiên bản review/commit được chủ dự án quản lý trước deploy từ Git. Phiên này không commit/push/publish.
- Xác nhận region Render gần Supabase và học sinh, giới hạn connection/Storage/egress, cold start/suspend/giới hạn tài nguyên theo gói đang dùng. Không giả định Render Free hoạt động liên tục hoặc filesystem giữ qua redeploy.
- Đặt secret trong secret manager/dashboard của backend/CI. Không gửi vào hội thoại, frontend, QR, log hoặc repository. Không có credential cloud được khai báo trong metadata môi trường hiện tại; chưa kiểm tra quyền dịch vụ từ xa.

## 2. Biến môi trường và quyền sở hữu cấu hình

Các tên có ghi “đề xuất” chưa được code hiện tại đọc. Phải triển khai config validation trước khi dùng; cấu hình thiếu thì backend dừng khởi động, không tự fallback SQLite/RAM trong cloud mode.

| Biến | Nơi đặt | Hiện trạng / ý nghĩa |
|---|---|---|
| `VITE_SERVER_URL` | Cloudflare build; công khai | Đã có: HTTPS origin Render/API, không `/api`, không trailing slash, không `wss://` vì helper REST cũng dùng biến này |
| `VITE_PUBLIC_APP_URL` | Cloudflare build; công khai | Đã có: root URL HTTPS frontend mà điện thoại truy cập, dùng QR |
| `VITE_SUPABASE_URL` | Cloudflare build; công khai | Đề xuất: URL project Supabase staging |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Cloudflare build; công khai | Đề xuất: publishable/anon key dành browser, không service role; RLS/grants phải chặn đọc trái phép |
| `PORT` | Render cấp runtime | Đã có: Node listen 0.0.0.0:PORT; không hardcode số khi deploy |
| `NODE_ENV=production` | Render runtime | Đã có; tương lai Auth cloud không phụ thuộc cookie SQLite |
| `CORS_ORIGINS` | Render runtime | Đã có: exact HTTPS frontend origins ngăn cách dấu phẩy, không path/trailing slash; không wildcard |
| `PERSISTENCE_BACKEND=postgres` | Render runtime | Đề xuất: chọn adapter, fail closed khi thiếu config; không tự dùng CLASSROOM_DB_PATH |
| `SUPABASE_URL` | Render runtime | Đề xuất: cùng project với frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | **Render secret** / operator import khi cần | Đề xuất: Auth admin/Storage; có thể bypass RLS, không prefix VITE_ |
| `DATABASE_URL` | **Render secret** | Đề xuất: PostgreSQL runtime role quyền tối thiểu, TLS verify certificate; không superuser/migration role |
| `MIGRATION_DATABASE_URL` | **Operator/CI secret riêng** | Đề xuất: DDL/import; không inject vào server thường trực hoặc Cloudflare |
| `SUPABASE_AVATAR_BUCKET=student-avatars` | Render runtime | Đề xuất: bucket private, không phải URL công khai |
| `AVATAR_SIGNED_URL_TTL_SECONDS=90` | Render runtime | Đề xuất: TTL ngắn đã được test; URL hết hạn phải refresh theo quyền |
| `CHECKPOINT_INTERVAL_MS=1000` | Render runtime | Đề xuất: nhịp checkpoint, có coalescing/backpressure; hiện tại hardcode gần1 Hz trong app.ts |
| `CLASSROOM_DB_PATH`, `CLASSROOM_AVATAR_DIR` | Chỉ máy local/backup | Đã có: giữ để vận hành nguồn SQLite; không dùng làm nguồn dữ liệu cloud |

URL ví dụ dưới đây là placeholder, không phải dịch vụ đã tồn tại:

```text
Frontend: https://duaxe-staging.example.org
API/Socket.IO: https://duaxe-api-staging.example.org
CORS_ORIGINS=https://duaxe-staging.example.org
VITE_SERVER_URL=https://duaxe-api-staging.example.org
VITE_PUBLIC_APP_URL=https://duaxe-staging.example.org/
```

Nếu dùng tên mặc định Pages/Render, thay bằng đúng `<project>.pages.dev` và `<service>.onrender.com` trong dashboard. Khi đổi frontend URL, build lại vì VITE_* được bake vào bundle; thay runtime Render không sửa bundle Pages. Production không dùng localhost/127.0.0.1 làm endpoint hoặc QR.

## 3. Thiết lập Supabase staging

1. Tạo project staging riêng, xác minh project ref/region. Bảo vệ quyền operator. Chọn kết nối Postgres TLS theo khả năng mạng Render (direct/session pooler); không tắt TLS verification để vượt lỗi.
2. Triển khai SQL versioned từ repository **sau khi được viết/test**, theo schema trong kế hoạch. Review generated SQL trước apply. Không chạy đoạn SQLite CREATE TABLE hoặc import SQLite qua PostgreSQL CLI rồi mong tự chuyển kiểu.
3. Tạo runtime SQL role riêng và migration role; grants schema/table/function/sequence tối thiểu. Không cho anon/authenticated đọc schema chứa digest, receipts, answers đúng, report/checkpoint của cả phòng. RLS USING/WITH CHECK cho teacher data; không có policy “authenticated can read all”.
4. Kiểm tra bằng anon và hai giáo viên A/B: không thể đọc/ghi lớp, học sinh, avatar metadata, bộ đề, history của nhau; không đổi teacher_id/class_id/avatar_id sang tenant khác. Các bảng con và view cũng kiểm tra. Service role thành công không chứng minh RLS đúng.
5. Auth: cấu hình Site URL là frontend staging, allowlist redirect chính xác cho invite/reset; không wildcard preview tùy ý. Tắt đăng ký tự do cho giáo viên, cấu hình email delivery/invite staging, liên kết teachers.auth_user_id có xác minh. Không nhập salt:scrypt hoặc sessions cookie; operator lập mapping teachers.id cũ → Auth user ID.
6. Storage: tạo `student-avatars` với **public=false**. Backend giữ upload validation hiện tại: byte≤2 MB,16 triệu pixel, JPG/PNG/WebP tĩnh, Sharp128/WebP/EXIF removal, concurrency2. MIME khai báo trên bucket không thay kiểm tra ảnh thật. Không cấp client quyền upload/delete trực tiếp khi chọn API upload trung gian.
7. Thiết lập policy/grant Storage phù hợp: anon không list/read; request ký URL chỉ ở backend sau kiểm tra owner hoặc capability/roster phòng. Nếu thử direct teacher Storage access thì phải có owner policy và test riêng, không bật “allow all” cho đỡ lỗi.
8. Cấu hình pool nhỏ đủ cho một instance; transaction phải giữ cùng connection. Advisory lock cần dedicated connection với session ổn định; không đưa lock vào transaction pooler. Nếu hạ tầng chỉ cho transaction pooling, triển khai lease+fencing thay thế trước deploy. Quản lý credential rotation và giới hạn connection.
9. Sao lưu PostgreSQL, ảnh và manifest; xác minh mức backup/PITR thực tế gói cung cấp, không giả định snapshot DB bao gồm bytes Storage. Chạy restore drill riêng trước dữ liệu thật.

## 4. Chuyển dữ liệu SQLite trên staging

Công cụ cloud import/verify/rollback **chưa được viết**. Không có `npm run migrate:cloud` để chạy ở bản hiện tại. Chỉ thực hiện phần backup local sau trong đợt vận hành đã lên lịch; phiên khảo sát này không chạy trên nguồn thật:

```sh
# Dừng writer SQLite sạch trước; giữ nguyên đúng CLASSROOM_* của nguồn.
# Đích backup phải là thư mục mới, không tồn tại.
npm run classroom -- backup /duong-dan-rieng/backup-stage9
npm run classroom -- verify /duong-dan-rieng/backup-stage9
```

CLI backup hiện có dùng flock, VACUUM INTO, copy ảnh có tham chiếu và manifest SHA-256; loại sessions cookie khỏi bản backup. Không xóa `.guard/.lock/WAL/SHM`, không copy riêng DB đang ghi, không mở Store trên nguồn chỉ để dry-run. Khi gặp khóa legacy phải theo quy trình CLASSROOM_READINESS.md.

Sau khi có công cụ cloud, thao tác theo thứ tự:

1. Read-only backup → kiểm tra schema1/2, integrity/FK, manifest/hash; hash nguồn trước/sau.
2. Dry-run trên target staging allowlist, kiểm tra mapping giáo viên/UUID, ID câu text, timestamps, checkpoint/report, profile đã xóa, ảnh thiếu/hỏng, tenant conflict. Dữ liệu lỗi phải được báo/cách ly có manifest, không bỏ qua im lặng.
3. Apply batch trên staging trống hoặc đã xác định xung đột; upload ảnh vào prefix batch, transaction SQL giữ ID/quan hệ, không ghi đè hàng trùng khác nội dung. Không cố rollback cả Auth/Storage bằng một SQL ROLLBACK.
4. Verify số lượng từng bảng, tập ID, checksum ảnh, report/đáp án/điểm, băm token, owner và room paused. Test owner A/B, claims và resume trên cùng origin thử; kích hoạt batch sau verify.
5. Re-run cùng batch phải idempotent; thử kill importer giữa upload và commit; rollback batch phải chỉ xóa phần do batch tạo còn chưa thay đổi/không còn tham chiếu. Không xóa Auth users có từ trước hoặc dữ liệu SQLite gốc.

Cutover giữa các buổi học giúp tránh ghi hai nguồn. Token học sinh nằm trong localStorage theo origin, không tự sang domain Pages mới; không gắn token vào QR. Nếu cần khôi phục buổi đang chạy khi đổi origin, đó là yêu cầu migration phiên riêng cần được triển khai/test trước. Không hứa các máy LAN tự resume trên Pages chỉ vì giữ digest.

## 5. Render Web Service staging

Chỉ cấu hình/deploy khi adapter cloud và Auth/Storage đã hoàn thành. Bản hiện tại vẫn tạo ClassroomStore trong server/index.ts; không deploy bản đó lên ổ đĩa tạm Render để giữ dữ liệu lớp.

- Runtime Node24; dùng đúng branch/commit đã review và package-lock. Một Web Service, một instance, không cluster/PM2 nhiều worker. Chọn region gần Supabase. Render cung cấp HTTPS/WSS đầu ngoài; Node bên trong listen HTTP trên 0.0.0.0:PORT như hiện tại.
- Các lệnh hiện có phù hợp làm cơ sở pipeline sau thay đổi adapter:

```sh
# Build command: cần dev dependencies cho TypeScript/esbuild.
npm ci --include=dev && npm run typecheck && npm run server:build
# Start command:
npm run server:start
```

- Đặt runtime env/secret đúng bảng trên. Backend artifact esbuild dùng `--packages=external`, nên production dependencies như driver PostgreSQL/Supabase SDK/Sharp phải còn trong node_modules. Không chỉ upload dist-server rồi bỏ dependencies.
- CORS allowlist exact Cloudflare origin, cả REST và Socket.IO allowRequest. Preflight API cần bổ sung Authorization cùng Content-Type/X-Classroom-Request. Không giải quyết cross-site bằng đổi cookie SameSite=None; chuyển Bearer Auth theo thiết kế.
- Hiện GET `/health` trả200 khi process sống, chưa kiểm tra storageFault/DB. Bổ sung `/ready` hoặc nâng `/health` để503 khi chưa load phòng, mất writer lock, DB không khả dụng hoặc fail-closed lưu trữ. Nếu giữ health và readiness riêng, cấu hình dashboard endpoint phản ánh khả năng phục vụ thực tế, không trả bí mật/SQL/raw lỗi.
- Trước ready: xác thực config, kết nối DB, xác minh schema version, giữ single-writer lock/fencing, load/reconcile checkpoint rồi mới nhận lệnh. Running → paused; không tự resume khi teacher reconnect.
- Rolling deploy có thể chạy chồng instance: process không lấy được lock không được tick/ACK. Mất connection giữ advisory lock phải dừng writer; không chỉ bắt lỗi rồi mở connection và ghi tiếp. Nếu dùng lease, mọi commit phải kiểm writer_epoch và lease còn hiệu lực.
- SIGTERM/SIGINT: stop admission, drain queue/commit có deadline, đóng Socket.IO/DB. Kill cứng lấy checkpoint đã commit, ACK đã phát phải còn đủ. Supabase down thì pause/fail closed, không fallback vào RAM-only.
- Giữ transport Socket.IO mặc định có polling+WebSocket upgrade, kiểm cả polling và WSS. Không bật websocket-only cho mọi thiết bị nếu chưa test đường truyền lớp. Không có Redis adapter hoặc Supabase Realtime thay Socket.IO trong giai đoạn một writer.
- Xác định chain reverse proxy Render trước khi dùng X-Forwarded-For; rate-limit hiện dựa remoteAddress có thể gom mọi máy vào một IP. Không tin header client tùy ý; dùng trusted proxy cố định và bucket theo verified teacher/player kết hợp IP. Test 20 máy sau proxy và kết nối lặp thực tế.
- Kiểm tra policy sleep/cold-start hiện hành trong dashboard. Giữ một phiên học không đồng nghĩa dịch vụ Free có SLA; phải đo thời gian wake/reconnect/quiz clock. Khi restart giữ TTL phòng2 giờ/teacher vắng10 phút như luật cũ.

## 6. Cloudflare Pages staging

Chỉ deploy frontend Auth mới với API cloud đã qua readiness. Không đưa secret server vào build environment Pages vì bất kỳ giá trị VITE_* nào đều có thể public.

- Root directory là repository duaxe. Cấu hình Node24 và install dependencies từ lockfile.
- Build frontend bằng lệnh thực tế đang có công cụ trong package.json/node_modules:

```sh
npm ci
npm run typecheck
npx vite build
```

Trong dashboard có thể đặt build command `npm run typecheck && npx vite build` khi nền tảng đã cài dependencies. Output directory: `dist`. `npm run build` hiện build cả client/server/CLI; có thể dùng để CI regression nhưng Pages chỉ publish dist, không publish dist-server, SQLite, ảnh nguồn, backup hoặc .env.

- Đặt VITE_SERVER_URL, VITE_PUBLIC_APP_URL và hai biến Supabase public đã được code hỗ trợ. Mỗi môi trường có project/API riêng; production build không trỏ staging hoặc localhost.
- Routing hiện dùng query, không React Router: QR dạng `https://<frontend>/?mode=student&room=ABC234`; trang giáo viên `/?mode=teacher`, solo `/?mode=solo`. Refresh root/query hoạt động nếu index.html được phục vụ. Không invent `/join/:code` vì ứng dụng chưa có route đó.
- `vite.config.ts` hiện `base:'./'`; với root/query đúng hiện tại không cần đổi. Nếu thêm pathname sâu phải đổi asset base/routing đồng bộ và test refresh; không coi wildcard redirect là đủ sửa relative asset URL.
- Pages SPA fallback thường áp dụng khi không có top-level404.html, nhưng phải xác minh output/runtime. Nếu tương lai cần file `_redirects`, thêm trong `public/` để Vite copy và test riêng; phiên này chưa tạo file đó. Chưa cần Worker proxy để dùng Socket.IO trực tiếp tới Render.
- Cache HTML để nhận build mới, assets hashed có thể cache lâu. Không cache private API/ảnh theo chính sách public tại proxy/service worker. Auth callbacks/invite/reset ở frontend phải có handler đã triển khai, không chỉ nhập URL vào dashboard.
- Kiểm tra dist chỉ chứa publishable/anon key nếu dùng, không DATABASE_URL/service role/teacher token/signed avatar URL cố định. Không dump nội dung bundle ra log khi phát hiện secret; dùng secret scan và báo file/vị trí đã che. Runtime error logs cũng phải redact Authorization/Socket handshake auth/signed query.
- Cho phép HTTPS origins cần thiết trong CSP nếu bổ sung: Supabase Auth/Storage, API HTTPS/WSS; không CSP wildcard. Test ảnh cross-origin, WebGL, speech/audio sau thao tác người dùng và lazy-load Phaser. Các giới hạn speech tiếng Việt của browser vẫn tồn tại.
- Preview deployments có origin khác: allowlist staging preview chính xác, không wildcard mọi *.pages.dev vào production API. Không chia sẻ token/Storage production với preview không đáng tin.

## 7. Smoke HTTPS/WSS, bảo mật và nghiệm thu staging

Phải ghi commit, Node/browser, region/gói, ngày thử và bằng chứng thật. Danh sách sau **chưa thực hiện trên ba dịch vụ**:

| Kiểm tra | Kết quả cần đạt |
|---|---|
| Health/readiness | HTTPS hợp lệ, ready503 trước load/DB outage/mất writer quyền; không raw lỗi hoặc secret |
| Frontend/QR | Root/query refresh được, không localhost/mixed content/token trên QR; quét từ mạng điện thoại khác vẫn vào đúng phòng |
| Teacher Auth | A/B login, refresh/expire/logout/revoke; backend xác minh token, không chỉ decode; student token/mã phòng không control/report/recoverTeacher |
| REST preflight | Authorization header được cho đúng origin; origin khác bị từ chối; không wildcard credentials |
| RLS | anon và JWT B không đọc/ghi tenant A qua Data API, view hoặc Storage; không đổi ownership bằng update |
| Private avatar | Guest không đọc/list; chỉ owner/phòng được ký; hết TTL/release không cấp lại; refresh URL vẫn đúng avatarId/playerId |
| Upload | Bytes/pixel/type/concurrency limits; thay ảnh rollback không mất ảnh cũ; không log ảnh hoặc secret |
| Socket.IO | HTTPS endpoint upgrade101/WSS trên browser; kiểm cả polling fallback, proxy, CORS và20 máy sau NAT |
| Race | 20 xe, 3 làn, đúng hạng/vượt/chuyển làn/boost; client không gửi điểm/vị trí; không Phaser trên mobile |
| Đồng thời | 20 đáp án đồng thời, retry cùngcommandId/samequestion không cộng lại; timeout/pause theo clock server |
| Crash | Kill trước/sau commit và trước ACK; restart manual; mọi ACK đã nhận còn, room paused, replay không boost lại |
| Outage/split writer | DB mất mạng/timeout commit, rolling deploy2 process: không stale checkpoint, không hai writer, UI báo pause |
| Reconnect | TắtWi-Fi/khóa30–60 giây/đóngbrowser/tabtrùng/teacher rớt; giữID/claim/điểm/câu và loại frame cũ sau recovery epoch |
| History/export | Owner filter/lọcngàyUTC, details và CSV/JSON chính xác, không ảnh/token; xóa không tái xuất hiện sau checkpoint/restart |
| Import/rollback | Cả v1/v2, orphan IDs, ảnh thiếu, batch partial, xung đột ID, retry; source checksum không đổi |

Chạy baseline local hiện có trước và sau thay đổi:

```sh
npm run typecheck
npm test
npm run build
npm run test:crash
npm run test:readiness-browser
```

Các script hiện tại tự tạo backend SQLite hoặc dùng local URL; chúng **không tự kiểm thử Render/Supabase khi chỉ thay VITE_SERVER_URL**. Cần bổ sung integration harness cloud nhận target staging allowlist, Auth A/B, database fixture và khả năng restart service có kiểm soát. Không trỏ script tạo/xóa test data vào production. Bộ mô phỏng20 phải kiểm token/DB thật, không chỉmock; test RLS phải dùng principal thật.

Đo RTT median/P95/P99 (tối thiểu1000 lệnh/buổi, tính cả lỗi), khoảng cách frame và command→teacher frame riêng, reconnect từ khi browser active/mạng trở lại, disconnect ngoài kế hoạch, payload byte/s, query/checkpoint latency và writes/giây, CPU/RAM Render, FPS/heap React/Phaser giáo viên. Bật `profile=1` khi đo dev theo báo cáo cũ; React Profiler có thể không có số ở production build, không coi0 là miễn phí render. Không gọi snapshot frame gap là RTT. Ghi rollback quãng đường/tuổi checkpoint sau crash. Không dùng P99 với chỉ vài mẫu để đưa SLA.

Sau staging20 clients vẫn phải chạy checklist20 điện thoại thật + máy giáo viên + Wi-Fi, ít nhất45–60 phút, có bằng chứng model/OS/browser/AP. Mục tiêu đề xuất trong CLASSROOM_READINESS.md phải được điều chỉnh theo đường Internet thật, ghi người duyệt; không tự công bố sẵn sàng khi chưa thử.

## 8. Triển khai chính thức và rollback (chưa được cho phép trong phiên khảo sát)

1. Review code/schema/RLS/secret scan và toàn bộ bằng chứng staging; chuẩn bị backup PostgreSQL + Storage manifest, backup SQLite/ảnh nguồn và release trước. Không có commit thì chưa có artifact version để rollback từ Git.
2. Lên cửa sổ chuyển giữa buổi; dừng ghi nguồn, backup/verify, dry-run/import vào project đích được xác nhận, verify rồi mới chuyển frontend/API. Một nguồn writer tại một thời điểm, không chạy SQLite và PostgreSQL nhận cùng buổi.
3. Theo dõi ready/RTT/DBerrors/claim/answerduplicate/avatar; giáo viên xác nhận resume. Không ghi token/ảnh vào log hỗ trợ. Nếu đổi origin, giải quyết token localStorage theo kế hoạch trước, không phát QR chứa capability.
4. Nếu app release mới lỗi nhưng schema tương thích: ngừng admission, drain/backup, quay lại artifact cloud đã kiểm chứng, giữ một writer. Dùng expand→migrate→contract; không drop cột/bảng trong deploy đầu để rollback app còn đọc được.
5. Nếu cần quay về SQLite: ngừng ghi cloud, backup PostgreSQL/Storage, export/reconcile toàn bộ kết quả phát sinh sau cutover vào môi trường riêng. SQLite gốc không chứa dữ liệu mới; chỉ đổi URL sẽ mất phần này. Không tự ghi đè SQLite nguồn; restore vào thư mục mới sau verify, dùng release SQLite tương thích rồi đổi cấu hình có kiểm soát.
6. Rollback import batch chỉ xóa rows/objects được batch tạo và chưa thay đổi/được dùng; cần kiểm reference/revision/hash. Không xóa Auth account có sẵn hoặc dùng chung. Không dùng TRUNCATE/drop bucket/schema để rollback chung.
7. Giữ snapshot nguồn và archive manifest theo retention đã duyệt; chưa xóa SQLite/ảnh hiện tại sau chuyển. Hoàn thành restore drill trước khi xem xét dọn dữ liệu về sau.

## 9. Hiện trạng và bước tiếp theo

Hai tài liệu này là đầu ra khảo sát. Chưa có SQL PostgreSQL/RLS thực thi, importer, Auth/Storage integration, config Render/Cloudflare hoạt động hoặc deployment thật. Các biến đề xuất chưa tạo tính năng trong runtime. Chưa thử Supabase project, WSS Internet, Render restart hoặc20 điện thoại thật.

Bước kế tiếp: review kế hoạch schema/auth/import, triển khai interface async+queue dưới SQLite adapter để giữ regression, sau đó viết migration/adapter cloud và test staging theo các cổng ở CLOUD_MIGRATION_PLAN.md. Không yêu cầu người dùng gửi khóa bí mật vào chat; cấu hình qua secret manager khi bắt đầu bước cloud có quyền phù hợp.

Kết quả kiểm tra local trong phiên khảo sát: TypeScript đạt,36/36 test đạt, build client/server/CLI đạt, test:crash và test:readiness-browser đạt. Xem [baseline giai đoạn9](CLOUD_MIGRATION_PLAN.md#10-baseline-kiểm-thử-phiên-khảo-sát) để phân biệt bằng chứng local với các bước cloud chưa thực hiện.
