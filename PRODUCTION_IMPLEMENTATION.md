# Production: mã đã hoàn thiện, cấu hình và chốt nghiệm thu

> Chính sách hiện hành: self-signup, email confirmation, tự tạo teacher profile; xem phần cập nhật đầu [SUPABASE_AUTH_PRODUCTION_MIGRATION.md](SUPABASE_AUTH_PRODUCTION_MIGRATION.md). Cần schema004 và Turnstile khi bật. Các mô tả chỉ cấp tài khoản thủ công dưới đây thuộc nền9B.2 trước thay đổi này.

> Cập nhật9B.2 ngày07/11/2026: xem [SUPABASE_AUTH_PRODUCTION_MIGRATION.md](SUPABASE_AUTH_PRODUCTION_MIGRATION.md). Cloud runtime mới yêu cầu schema003 và có recovery/cutoff; các số đo, tình trạng credentials và hạn chế Auth bên dưới thuộc phiên06/11, không phải xác nhận cấu hình hiện tại. Chưa apply SQL hoặc publish remote.

Ngày 06/11/2026 (UTC+7). Dùng **Pages + Render một instance hoạt động + Supabase**, địa chỉ mặc định trước, **không staging riêng**. Xem kế hoạch khảo sát trước sửa tại [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md).

**Chưa deploy/publish, đổi DNS, áp SQL lên Supabase hoặc import dữ liệu thật. Chưa mở cho người dùng.** Các kết quả bên dưới là local/emulator. Runtime cuộc trò chuyện chưa có credentials dịch vụ ở lần kiểm tra gần nhất; việc bạn đã có project không đồng nghĩa công cụ đã được cấp quyền.

## 1. Những phần đã hoàn thiện trong mã

- Tận dụng PostgreSQL adapter/delta write/fence của9B.1.1; vẫn transaction + ACK sau commit, không đổi unique constraint/luật chấm điểm. SQLite mặc định vẫn chạy local.
- Supabase Auth email/password qua SDK browser, giữ form/bố cục hiện có; refresh JWT và cập nhật xác thực socket. Backend kiểm JWKS/signature/issuer/audience/exp/iat/session_id/role, từ chối anonymous/service-role JWT làm giáo viên. Không lấy room code làm quyền quản trị.
- Mapping **Auth UUID → teacherId cũ** riêng, explicit và enabled; không tự cấp quyền khi signup hoặc tự ghép bằng email. Owner checks ở API/Socket vẫn bắt buộc, kể cả service-role/DB backend có quyền rộng.
- Logout ghi revocation theo session_id trong PostgreSQL trước khi browser sign out; JWT cũ bị chặn ngay tại backend. Raw JWT/refresh token không ghi database/log/result. Đóng tab/refresh/khôi phục học sinh vẫn dùng secret riêng như trước.
- Avatar strategy local hoặc Supabase private object store. Upload giữ giới hạn2MB/16Mpixel/định dạng tĩnh, Sharp128WebP, immutable key `ownerId/avatarId.webp`, không upsert đè ảnh. Private bucket phải được kiểm tra trước startup. Không dùng URL công khai/vĩnh viễn; API owner-authenticated trả bytes, browser dùng blob URL rồi revoke khi unmount.
- RaceScene tiếp tục nhận ảnh Base64 qua socket như trước; checkpoint/report/export không nhúng ảnh. Teacher nhận20 ảnh; học sinh sau claim/resume nhận ảnh của mình. QR có invite riêng được băm trong DB, không chứa teacher/student session token. Invite hết hạn/đổi không làm mất phiên học sinh đã nhận.
- Để giữ nhập mã6 ký tự, preview bằng mã đơn thuần chỉ trả danh sách tên/metadata và placeholder; ảnh lựa chọn cần QR/invite hợp lệ. Claim vẫn kiểm roster/unique student, sau đó nhận ảnh riêng. Không coi biết mã phòng là đã đăng nhập giáo viên. Không chia sẻ QR ra ngoài lớp.
- Cloudflare gateway cùng origin cho `/api/*` và `/socket.io/*`; JWT Bearer được chuyển tiếp, cookie/Access service secret không chuyển tới Render. Backend luôn cần gateway key; frontend không biết key. Không phụ thuộc third-party cookie giữa pages.dev và onrender.com.
- Cả Pages và backend mặc định **closed**. Pilot yêu cầu Cloudflare Access identity/service-token JWT trên Pages và key nội bộ ở Render. Live vẫn chặn truy cập API/Socket trực tiếp tới Render nếu thiếu key. Preview deployments thiếu cấu hình cũng mặc định đóng.
- Thêm operator/preflight/acceptance có target guard; không tự migrate lúc server boot, không tự provision/xóa Auth users hoặc xóa test data.

Không thay RaceModel/RaceScene, luật boost/va chạm/xếp hạng, shared Request/Frame protocol hoặc Room/session serializer. Chỉ thêm plumbing xác thực socket/invite, API và ảnh; CSS/đường đua/bố cục không thiết kế lại. Giao diện QR có báo lỗi/thử lại khi tạo link thất bại.

## 2. Schema/RLS và lưu trữ bền vững

`001_storage.sql` giữ nguyên checksum. **002_cloud.sql** bổ sung:

| Bảng | Mục đích/quyền |
|---|---|
| teacher_auth_links | Auth UUID duy nhất ↔ teacherId duy nhất, enabled; runtime chỉ SELECT, operator mới link/disable |
| teacher_auth_revocations | session_id đã logout; runtime SELECT/INSERT, không token rõ, không tự xóa revocation |
| room_invites | FK room, SHA-256 invite, expires_at; runtime DML, không lưu invite rõ |

Đều ENABLE/FORCE RLS, private schema, không PUBLIC/browser grants. Runtime không superuser/BYPASSRLS, thuộc duaxe_runtime. Policy backend có phạm vi rộng nên Node vẫn kiểm owner; **không tuyên bố RLS tự tách tenant cho backend**. Không expose duaxe vào Data API hoặc grant duaxe_runtime cho anon/authenticated.

`ops/supabase-private-storage.sql` là template operator riêng, **chưa chạy remote**: tạo bucket private nếu chưa có, từ chối bucket hiện có public, áp restrictive policy chặn anon/authenticated cho bucket ảnh ngay cả khi có policy permissive khác. Các bucket khác giữ policy cũ. Service-role Storage bypass RLS, nên chỉ backend giữ key và kiểm owner/room. Xem xét tên bucket trước khi dùng; không áp lên bucket dùng chung ứng dụng khác. Script transactional, không có khoảng hở DROP/CREATE policy.

Ảnh mới và metadata không nằm trên ổ Render. DB/Object upload không cùng atomic transaction: upload trước, SQL commit sau; lỗi chắc chắn rollback có compensation, uncertain commit giữ object để tránh xóa ảnh đã commit. Crash có thể để orphan private object, cần cleanup có manifest/review, không xóa mù. GC giữ ảnh referenced trong player và profile snapshot/lịch sử. Ảnh import local_owned=false không bị GC unlink nguồn.

Không sửa SQLite schema hoặc xóa nguồn. Import giữ teacher/class/student/player/code/question/answer/receipt IDs và hash như9B.1. Importer được bổ sung checksum các bảng Auth/invite để **từ chối rollback khi đã có hoạt động mới**, không cascade mất mapping/session mới.

## 3. Bạn nhập cấu hình ở đâu

| Nơi | Tên biến | Loại/giá trị |
|---|---|---|
| Môi trường công cụ hiện tại | SUPABASE_URL | **Environment variable thường**, `https://<project-ref>.supabase.co`; URL không phải mật khẩu |
| Môi trường công cụ hiện tại | SUPABASE_STORAGE_KEY | HTTP Secret nếu dùng proxy HTTP; domain chỉ `<project-ref>.supabase.co`, không `https://`/path |
| Render encrypted Environment | DATABASE_URL | PostgreSQL runtime login thật; **không HTTP Secret** vì driver dùng PostgreSQL/TCP |
| Render encrypted Environment | SUPABASE_STORAGE_KEY | Key server-only; không VITE_, không chat; không tự đồng bộ từ secret của cuộc trò chuyện |
| Render Environment | SUPABASE_URL, SUPABASE_AVATAR_BUCKET | Public origin và bucket private đã duyệt, mặc định student-avatars |
| Render Environment | NODE_ENV, STORAGE_DRIVER | production / postgres |
| Render Environment | TEACHER_AUTH_DRIVER, AVATAR_STORAGE_DRIVER | supabase / supabase, không fallback local trong cloud mode |
| Render Environment | CORS_ORIGINS | Exact HTTPS Pages origin, không slash cuối/wildcard/localhost |
| Render encrypted Environment | BACKEND_GATEWAY_KEY | Secret ngẫu nhiên tối thiểu43 ký tự base64url, giống Pages Functions |
| Render Environment | PRODUCTION_ACCESS_MODE | closed ban đầu; pilot/live chỉ sau xác nhận tương ứng |
| Render Environment | PG_POOL_MAX, PG_SSL_MODE |4 (cộng1 writer session), verify-full; CA file tùy provider |
| Pages build variables | VITE_AUTH_DRIVER | supabase; dùng `npm run build:pages` để kiểm config |
| Pages build variables | VITE_SUPABASE_URL | Cùng public Supabase origin |
| Pages build variables | VITE_SUPABASE_PUBLISHABLE_KEY | Publishable key hoặc legacy anon JWT; không service-role/secret |
| Pages build variables | VITE_SERVER_URL | Để trống: dùng gateway cùng origin |
| Pages build variables | VITE_PUBLIC_APP_URL | HTTPS Pages URL đã duyệt; có thể trống để lấy current origin |
| Pages Functions variables | BACKEND_URL, SUPABASE_PUBLIC_ORIGIN | HTTPS Render origin và Supabase origin cho CSP |
| Pages Functions secret | BACKEND_GATEWAY_KEY | Cùng secret với Render; không đưa vào build VITE_ |
| Pages Functions variables | ACCESS_MODE | closed mặc định; pilot khi private test; live khi được mở |
| Pages pilot variables | CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD | `<team>.cloudflareaccess.com` và đúng Application Audience |
| Operator riêng | Admin DATABASE_URL, SUPABASE_AUTH_ADMIN_KEY | Không đặt admin credential trên Render runtime; chỉ invocation được duyệt |

HTTP Secrets có thể là placeholder cho proxy; không dùng placeholder như DB URL/password hay JWT gửi trong WebSocket frame. Các SDK HTTP trong môi trường managed cần proxy/CA được cấp; Node24 có thể dùng NODE_USE_ENV_PROXY=1. PostgreSQL và WSS cần quyền TCP/network thích hợp. Không tắt TLS để vượt lỗi. Trên Render/Pages, nhập secret thật vào encrypted environment/binding tương ứng.

Tài khoản cần: Cloudflare Pages/Access + quyền repository, Render Web Service, Supabase project/Auth/Storage/PostgreSQL. Theo chính sách mới bật self-signup với email confirmation và CAPTCHA, xem báo cáo cập nhật; dùng asymmetric signing ES256/RS256. Nếu project còn HS256, dừng và xin duyệt rotation/migration trước, không tự đổi key. Giữ expiry JWT ngắn hợp lý, thử refresh trước khi dùng lớp. UI hiện chỉ email/password, không thêm signup/reset/MFA UI; quản trị tài khoản/recovery dùng quy trình Supabase được duyệt.

## 4. Build/deploy — chưa được thực hiện external

`render.yaml`: Node24, plan Starter **có phí, chỉ là đề xuất cần duyệt**, numInstances1, autoDeploy off, health `/health`, build TypeScript/server; không migration tại boot. `wrangler.toml`: Pages dist, ACCESS_MODE=closed. `functions/_middleware.ts` áp gate/security headers/CSP cho cả static và SPA; gateway chuyển REST/Socket tới backend. Không DNS tùy chỉnh ở bước này.

Cloudflare build: `npm ci` → `npm run build:pages`, output dist, Functions lấy từ repository. Cấu hình production và preview riêng; không để preview vô tình dùng secret/live mode. Header Referrer-Policy no-referrer bảo vệ invite trong URL. CSP cho self/Supabase origin, data/blob ảnh, không wildcard scripts; frame-ancestors none nên chưa cho nhúng iframe ở website khác.

Repository chưa có commit/release SHA. Chưa tự add/commit/push; cần duyệt nguồn và tạo artifact/commit bất biến trước deploy. Git push có thể kích hoạt Pages nên không push trước xác nhận. Không coi bản workspace hiện tại là release đã publish.

### Hai writer và cập nhật Render

Một instance cấu hình vẫn có thể có old/new process trong rolling deploy. Advisory lock + epoch/fence vẫn chặn writer thứ hai; không bỏ lock hoặc làm health200 để ép deploy qua. **Không hứa zero-downtime.**

Trước update: đóng gate, pause/drain, backup, xác minh process cũ đã dừng và lock được giải phóng. Phải xác minh quy trình stop-before-start của dịch vụ. Nếu Render khởi động new trước khi dừng old, release mới sẽ bị chặn có chủ ý; không lặp deploy mù. Phương án maintenance cần duyệt: giữ old service suspended, chạy replacement đã duyệt ở closed với một active instance, verify rồi đổi BACKEND_URL của Pages; old vẫn suspended cho rollback. Không chạy hai service ghi cùng DB. Việc tạo replacement/chuyển config cũng cần xác nhận, có thể phát sinh phí.

## 5. Backup, migration và rollback

**Trước mọi apply:** finish buổi đang chạy, đóng admission/gate, dừng writer, backup/verify SQLite+ảnh bằng CLI cũ, lưu SHA-256/manifest ngoài repo. Không mở ClassroomStore trên nguồn chỉ để đọc, không copy riêng DB bỏ WAL/SHM, không xóa lock. Công cụ mới chỉ dùng bản copy đã xác nhận.

Backup cloud cần cả PostgreSQL, private Storage và kế hoạch phục hồi Supabase Auth/config/secret. Provider DB backup/PITR không đồng nghĩa có backup object bytes. Có thể dùng pg_dump custom-format/schema duaxe với credential operator qua biến PG* private (không đặt URL/password trên command line), giữ grants/policies phù hợp; restore trên PostgreSQL local sạch để kiểm. Các role phải được provision lại có kiểm soát nếu cluster mới.

`backup-avatars` đọc object private, lưu bytes/manifest SHA-256 ở thư mục mới mode0700, file0600 ngoài repo; liên kết checksum của DB dump đã chuẩn bị. Nó **không tự chứng minh dump restore được** hoặc backup toàn bộ hosted Auth. Đã test restore app schema+photo+Auth mapping local; disaster recovery toàn project Supabase cần kiểm provider riêng trước mở lớp.

Lệnh mặc định chỉ in plan, không connect:

```sh
npm run cloud:operator -- schema
npm run cloud:preflight
```

Chỉ sau xác nhận mục tiêu/backup, nạp riêng admin credential và các chốt `CLOUD_TARGET=production`, `CLOUD_OPERATION_APPROVED=1`, `CLOUD_EXPECTED_DB_HOST`, `CLOUD_EXPECTED_DATABASE` cho **một invocation operator**, không đặt các cờ duyệt trên web service:

```sh
npm run cloud:operator -- schema --apply
# Review/apply ops/supabase-private-storage.sql riêng sau duyệt bucket/policy.
npm run cloud:operator -- import --source "$SQLITE_COPY" --source-is-copy --batch "$BATCH_ID" --dry-run
npm run cloud:operator -- import --source "$SQLITE_COPY" --source-is-copy --batch "$BATCH_ID" --apply
npm run cloud:operator -- copy-avatars --source "$SQLITE_COPY" --source-is-copy --avatars "$AVATAR_COPY" --batch "$BATCH_ID" --journal "$PRIVATE_JOURNAL" --apply
npm run cloud:operator -- link-teacher --teacher "$EXISTING_TEACHER_ID" --auth-user "$CONFIRMED_AUTH_USER_ID" --apply
npm run cloud:operator -- backup-avatars --output "$NEW_PRIVATE_BACKUP_DIR" --database-backup "$PG_DUMP_FILE" --apply
```

Schema001 không viết lại; schema002 additive/checksum. Import transactional/count/FK/ID/checksum/rerun của9B.1 được dùng lại. Copy ảnh deterministic owner/key, không overwrite, verify checksum và source, journal để tiếp tục/đối soát. Không upload/xóa ảnh nguồn. Auth link kiểm user bằng Admin API/email confirmed và teacher ID rõ ràng; không đổi ID cũ. `--create-profile` chỉ dành profile mới được duyệt, như tài khoản test; không tạo đè teacher thật trước import.

Dùng **tài khoản/profile test riêng**, email/UUID khác nguồn để tránh unique-ID/email conflict. Không seed profile thật bằng sentinel trước import SQLite; importer sẽ từ chối nội dung khác thay vì overwrite. Tắt gate/writer trong suốt import/link/copy.

Rollback import chỉ khi toàn target checksum còn nguyên; sau link Auth/logout/invite/game mới có thể bị từ chối. Không tự xóa Auth user hoặc object để vượt guard. Object đã copy có thể được giữ private để đối soát; cleanup chỉ theo manifest/hash/reference review và xác nhận riêng. Không có lời hứa rollback mọi thứ bằng một lệnh.

Rollback release: đóng gate, pause/drain, backup cả DB/object, dùng artifact cloud/schema2 tương thích đã kiểm. Không quay mù về code9B.1 legacy Auth/schema1 hoặc chỉ đổi về SQLite nếu cloud đã có kết quả mới; cần export/reconcile trước. Giữ SQLite/ảnh gốc bất biến. Nếu cutover đầu chưa đạt thì duy trì maintenance, không mở người dùng.

Cutover giữa các buổi: browser localStorage không tự chuyển từ LAN/localhost sang pages.dev. Kết thúc/phân loại phòng active trước chuyển origin, không phát QR chứa student secret để lách điều này. Phòng anonymous cũ không có owner cần operator review; không tự gán cho bất kỳ Auth user nào.

## 6. Kiểm thử và bằng chứng local

| Kiểm tra | Kết quả/phạm vi |
|---|---|
| Toàn bộ unit/integration |81 pass,0 skip,0 fail ở lượt kiểm gần nhất với PostgreSQL local; kiểm lại cuối được ghi validation JSON |
| TypeScript/client/server | Build đạt; cảnh báo chunk Phaser lớn vẫn tồn tại |
| Functions | esbuild và Wrangler Pages compiler đạt; không gọi deploy |
| Compiled Pages Worker | workerd/Miniflare local: closed chặn `/`, static asset, SPA QR, API và Socket.IO path503; pilot không Access identity403 |
| JWT/quyền | Signature/issuer/audience/expiry/role/anonymous/mapping, cross-tenant ảnh/lịch sử và revocation; private bucket/public bucket/overwrite/unsafe path |
| Storage RLS | PostgreSQL local mô phỏng schema storage: restrictive deny thắng permissive policy cho anon/authenticated; chưa test hosted Storage principals |
|20 client cloud path |20 hồ sơ/ảnh, invite/manual metadata, own-avatar delivery, simultaneous answer/duplicate, reconnect/restart paused,20 ACK giữ |
| Compiled server/index.js | NODE_ENV=production/private gate, PostgreSQL local + HTTPS Auth/Storage emulator, CA verification bật: SIGTERM/SIGINT/SIGKILL đạt,20 ACK và20 avatar mỗi trường hợp |
| SIGKILL cloud harness | Lùi quãng đường29,28m, restore paused, không thưởng trùng; không phải Render/Supabase outage thực |
| Operator | Schema2/dry-run/import/link/copy/private backup, actual pg_dump/restore vào DB local khác, đọc lại ảnh/Auth đúng ID; từ chối rollback sau mapping mới; nguồn copy không đổi |
| Chromium | SDK Supabase thật với Auth/Storage emulator, login/refresh/logout, blob ảnh private, QR,20 binding, offline22s/resume/history; mobile không Phaser |

Số đo browser cuối nằm ở `benchmarks/production-local/browser.json`; đây là một teacher browser + một mobile viewport +19 socket trong cùng môi trường dev/emulator, không20 điện thoại. RTT19 mẫu/P95 gần max, không SLA; FPS headless/dev không đại diện mọi máy. Baseline9B.1.1 vẫn là95,92/P95178,57ms trên180 answer samples; không so trực tiếp hai phương pháp để tuyên bố cải thiện/regression driver. Không giảm transaction để làm đẹp số.

Các file `cloud-signals.json`, `operator.json`, `pages-gate.json`, validation và source-check ghi bằng chứng. Intermediate lỗi test được sửa (chờ tab giáo viên render đủ20 và chờ URL invite hoàn thành; fixture role creation được serialize); không giảm assertion hoặc sửa game để test qua.

**Chưa kiểm:** dịch vụ thật, hosted RLS/Storage/JWKS/key rotation, Cloudflare↔Render HTTPS/WSS upgrade, cold start, rollout/restart Render, latency DB qua mạng, full-project Auth/PITR restore,20 điện thoại/Wi-Fi/soak45–60 phút. Local TLS/emulator không thay thế các bài này.

## 7. Acceptance production bằng dữ liệu giả — CHƯA CHẠY

Sau khi có target/credentials và được duyệt publish tài nguyên **vẫn closed**, chạy `cloud:preflight -- --connect` (read-only: TLS, role, schema2, private bucket, asymmetric JWKS, browser roles không thuộc backend role). Script không lấy writer lock hoặc thay schema. Chỉ sau xác nhận mở phạm vi pilot mới cấp Access cho tester/runner và đặt gate pilot.

`cloud:acceptance` có chốt **CLOUD_ACCEPTANCE_APPROVED=1**, **CLOUD_ACCEPTANCE_TARGET=production**, exact CLOUD_APP_ORIGIN/CLOUD_EXPECTED_APP_ORIGIN, dedicated CLOUD_TEST_TEACHER_ID, short-lived CLOUD_TEST_TEACHER_TOKEN thật trong private runner, optional Access service headers và private absolute CLOUD_EVIDENCE_DIR. Không dùng placeholder HTTP-secret trong WebSocket frame; runner cần network WSS được phép. Không yêu cầu mật khẩu trong chat.

Script tạo class/20 profile/ảnh màu tổng hợp dưới account test, bắt đầu20 socket, trả lời đồng thời/lặp, pause/resume/reconnect3, end/history/đối chiếu; giữ dữ liệu fake để review, không tự xóa. Không deploy, đổi DNS, restart provider hoặc import dữ liệu thật. Số mẫu RTT nhỏ; thêm một buổi đo dài ít nhất1.000 lệnh và ghi cả lỗi để có P99 đáng tin hơn.

Checklist trước mở:20 thiết bị thật + máy cô cùng Wi-Fi, đủ20 avatar đúng xe; thiết bị21/claim trùng bị chặn; answer đồng thời/timeout/duplicate; lane/boost/overtake/rank; offline25s, khóa màn hình30/60s, đóng browser/mở lại; teacher pause/resume/logout/refresh; restart Render có kiểm soát giữa cuộc đua, paused/giữ ACK; second writer bị chặn; history/export không ảnh/token; principals A/B/anon không đọc ảnh/dữ liệu nhau; restore backup;45–60 phút đo RTT/FPS/heap/disconnect/reconnect/bytes/s.

Không mở nếu test fail, backup chưa restore, ảnh public, quyền sai, hai writer, không giữ ACK hoặc chưa có số đo thiết bị/mạng thật. P95 mục tiêu150ms chưa đạt ở baseline local, cần ghi số thực tế và quyết định chấp nhận trước mở. Co-locate Render/Supabase (ưu tiên region gần lớp) để giảm database round-trip; không scale nhiều writer.

## 8. File thay đổi và bước xác nhận

Nhóm chính: `server/cloud/{config,TeacherAuth,AvatarObjects,RoomInvites,DeploymentGate}.ts`; strategies trong PostgresStorage/factory/contracts; API/app/index auth/gate; migration mới002 và runner hỗ trợ target2; importer checksum bảng cloud. Frontend `classroom/{auth,api,Avatar}.ts[x]`, `online/{useRoom,OnlineApp}.tsx` đổi plumbing; không sửa engine/CSS/luật. `functions/`, `render.yaml`, `wrangler.toml`, `public/_headers`; `ops/supabase-private-storage.sql`; `scripts/cloud/` operator/preflight/build/acceptance và test harness; tests/helpers; env/gitignore/package/lock/tsconfig/docs. Danh sách chính xác và protected hashes: `benchmarks/production-local/source-check.json`.

Tại chốt hiện tại có thể review code/config/tests. **Cần cấu hình secret/target và xác nhận riêng trước publish/apply production dù đang closed.** Sau đó chạy acceptance fake/20 thiết bị, backup/restore và migration thật được duyệt; **dừng xin xác nhận cuối trước live**. Chưa đến bước xin mở công khai, chưa xác nhận sẵn sàng lớp thật.
