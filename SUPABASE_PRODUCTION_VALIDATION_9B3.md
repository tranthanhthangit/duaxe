# Nghiệm thu Supabase production — giai đoạn 9B.3

Ngày 07/11/2026 (UTC+7). Repository `/workspace/duaxe`. **Chưa nghiệm thu production; chưa đủ điều kiện mở cho lớp học thật.** Không có staging riêng. Đợt này chỉ sửa/test local và đọc metadata provider. Không áp migration production, chuyển tài khoản/dữ liệu/ảnh thật, gửi email, tạo bucket, deploy/publish, đổi DNS, mở public access hoặc commit.

Trạng thái dùng trong báo cáo: **PASS**, **FAIL**, **BLOCKED**, **NOT TESTED**, **NEEDS APPROVAL**. Assertion của emulator/mock chỉ là bằng chứng hợp đồng local; không được ghi PASS cho nghiệm thu dịch vụ thật. Các JSON cũ có `passed/checksPassed` chỉ mô tả phạm vi local được ghi trong chính artifact.

## 1. Kết luận và bằng chứng production

| Hạng mục | Trạng thái | Bằng chứng / giới hạn |
|---|---|---|
| Supabase public Auth settings | PASS | Đọc thật: signup bật, Email provider bật, bắt buộc email confirmation; không tạo user |
| JWKS public | PASS | Đọc thật: có khóa ES256; chưa phải kiểm thử login/token thật |
| Phiên bản/checksum schema production003/004 | BLOCKED | TCP proxy đang tắt; chưa chạy câu SQL nào trên production. Theo brief004 chưa áp, chưa đối chiếu catalog được |
| Áp SQL003/004 hoặc các version còn thiếu | NEEDS APPROVAL | Review nguyên văn SQL và checksum trong `MIGRATION_REVIEW_9B3.md`; chưa chạy |
| SMTP, sender, email confirmation/recovery thật | BLOCKED | Chưa có quyền kiểm Dashboard/cấu hình SMTP được xác nhận và hộp thư người lớn dành riêng cho test |
| Turnstile site key/secret/hostname/action thật | BLOCKED | Chưa có URL Pages, site key và secret thực sẵn sàng cho test; chưa gửi Siteverify thật |
| Redirect HTTPS, Site URL, CORS thật | BLOCKED | Chưa nhận URL Pages/Render thật; không suy diễn từ placeholder |
| Private bucket `student-avatars` | BLOCKED | API metadata trả HTTP400/provider404 `BUCKET_NOT_FOUND`; cần kiểm đúng project/tên/quyền key. Không chứng minh mọi bucket đều vắng, chưa đọc object/ảnh |
| Self-signup, teacherId, tenant isolation trên Supabase | NOT TESTED | Có kiểm thử hợp đồng local với PostgreSQL thật + provider giả, không nghiệm thu hosted |
| Cloudflare/Render access gate, WSS/QR, restart,20 client cloud | NOT TESTED | Chưa deploy/publish, chưa kiểm trên dịch vụ thật |
| 20 điện thoại/tablet thật | NOT TESTED | Chưa có thử nghiệm mạng/thiết bị thật |

Metadata tối thiểu, không chứa secret: [`provider-readonly.json`](benchmarks/9b3/provider-readonly.json), [`database-readonly-status.json`](benchmarks/9b3/database-readonly-status.json). Quan sát public Auth settings lúc `2026-11-07T06:06:01.220Z` không đảm bảo cấu hình hiện tại/mọi thiết lập Dashboard đều đúng. Settings public **không công bố** CAPTCHA, SMTP, Site URL hay rate limits. Có biến môi trường không đồng nghĩa credential đã được provider chấp nhận.

## 2. Migration003/004, RLS và rollback

Đã đọc001–004, runner, import/rollback, Auth, ảnh, phòng/queue/ACK, các báo cáo migration và readiness hiện có. Không có `PRODUCTION_PREFLIGHT_9B2.md` trong snapshot khảo sát. SQL001–004 không sửa byte nào. Local suite kiểm schema1/2/3/4 trong database disposable; review mới kiểm schema2 vẫn là2 sau READ ONLY, pending3+4, rồi chỉ áp4 trong fixture local để đối chiếu catalog.

**003 không phải tham chiếu DDL trực tiếp của004**, nhưng chuỗi migration/runtime bắt buộc003 trước004: cutoff/revocation và migration journal thuộc003;004 cần teachers của001, mapping của002. Target4 chạy **mọi version thiếu tới4**. Production ở2 cần3+4; ở3 cần4; trống/ở1 còn cần review001/002 riêng. Không được coi đồng ý004 là đồng ý tất cả001–004.

004 tạo unique index `teachers_normalized_email(lower(btrim(email)))`, bảng `teacher_profiles` với PK/FK teacherId, tên2–100 ký tự, ENABLE/FORCE RLS, quyền SELECT/INSERT profile và INSERT mapping cho runtime. Không mở UPDATE quyền/mapping. Index không CONCURRENTLY, có thể chặn ghi khi tạo; email cũ trùng sau normalize làm transaction rollback, không âm thầm merge/xóa.003 tạo cutoff và journal, không thay teacherId/luật đua.

Backend role có policy xuyên tenant cho xử lý phòng; **RLS của runtime không tự tách từng giáo viên**. Backend phải lấy owner từ JWT/mapping đã kiểm, không lấy teacherId frontend. Browser `anon/authenticated` không được cấp `duaxe_runtime`, không expose schema `duaxe` qua Data API. Service key chỉ server. Role operator/migration và login runtime NOSUPERUSER/NOBYPASSRLS phải tách; quyền thực trên Supabase còn BLOCKED.

Tool mới:

```sh
# Offline, không connect/DDL: hashes và nội dung nguồn cần review
npm run cloud:migration-review
# Chỉ khi TCP/credential/exact target đã sẵn sàng; READ ONLY + ROLLBACK:
# CLOUD_READONLY_REVIEW=1 npm run cloud:migration-review -- --connect
```

Không chứa mật khẩu trong command. Cần cấu hình privately `DATABASE_URL`, `CLOUD_EXPECTED_DB_HOST`, `CLOUD_EXPECTED_DATABASE`; công cụ cưỡng chế TLS verify-full. Kết quả metadata gồm version/hash, RLS/index/policy/role và **số nhóm** email trùng, không xuất email/học sinh. Không dùng migrate để thử kết nối.

Runner giữ migration lock924/900 và operator loại trừ runtime writer924/901, transaction/checksum giữ nguyên. Một Render instance vẫn có thể có overlap khi rolling deploy: dùng maintenance/stop writer, không bỏ lock hoặc tăng instance để né lỗi. Runtime không tự migrate lúc boot; session/direct PostgreSQL cần giữ connection/advisory lock, không dùng transaction pooler6543.

Rollback003/004 không có down-DDL an toàn tự động. Đóng admission, dùng artifact tương thích schema4 và giữ profile/cutoff/journal; không DROP bảng/index để quay về. Restore phải review revocation tránh hồi sinh token cũ. Backup DB/Auth/Storage và bản sao SQLite/ảnh, thử restore trước khi apply. Chưa tạo backup production hoặc thử restore production.

## 3. Lỗi local được sửa: bằng chứng Turnstile trước cấp quyền

Trước đợt này, SDK gửi CAPTCHA tới Supabase, nhưng Node tạo teacher profile chưa tự kiểm hostname/action. Review mã nguồn upstream Supabase Auth cho thấy verifier có trả hostname nhưng middleware được đọc chỉ dựa vào `success`; không được giả định hosted version đang kiểm hostname/action ứng dụng. Đây là lý do thêm kiểm tra tại Node, không phải xác nhận phiên bản GoTrue production.

Luồng hiện hành:

1. Signup/login/resend/recovery dùng widget action `teacher-auth`, SDK gửi token tới Supabase Auth; Dashboard vẫn phải bật CAPTCHA và limiter độc lập.
2. Email chưa xác nhận không được cấp quyền giáo viên. Node verify JWT, trạng thái Auth user mới nhất, ban/delete/confirmation và cutoff như9B.2.
3. Khi Auth user hợp lệ chưa có mapping, frontend hiển thị **Hoàn tất tài khoản giáo viên**, lấy token **mới** action `teacher-profile`. Không tái dùng token Supabase đã tiêu thụ.
4. Node Siteverify qua endpoint HTTPS cố định, kiểm success boolean, hostname cấu hình khớp HTTPS CORS origin, đúng action, tuổi token≤300s, giới hạn token và replay; timeout/provider lỗi từ chối cấp quyền. Không tin hostname/role/success frontend. Secret thiếu/test key làm runtime self-signup fail closed. Không có biến môi trường bypass CAPTCHA trong ứng dụng.
5. Sau verify, transaction hiện có giữ fence/unique/lock theo Auth UUID, tạo teacher/profile/mapping và trả HTTP200 **sau COMMIT**. Backend sinh UUID; không tạo/link theo email cũ. Mapping enabled có sẵn trả nguyên ID, retry không bắt CAPTCHA lần nữa. Reset trước lần đăng nhập đầu có cùng bước proof; refresh của tài khoản đã mapping giữ luồng cũ.

API `/auth/profile` chỉ nhận optional `captchaToken`, giới hạn body4096B; từ chối ID/role lạ. Code lỗi428 yêu cầu challenge,403 token không hợp lệ,503 verifier chưa sẵn sàng; frontend xử lý mà không tự cấp quyền. Rate limit IP/UID độc lập còn nguyên. Token chỉ giữ trong bộ nhớ, hash replay cache có TTL/giới hạn; không lưu vào QR, kết quả hay database. Provider chống dùng lại token qua restart; bộ cache local không thay thế provider. Proof cũng không thay Auth JWT/owner checks.

Kiểm hợp đồng local bao phủ thiếu/sai/hết hạn/tương lai/replay/hostname/action/provider lỗi, retry profile và reset lần đầu; **Turnstile hosted vẫn BLOCKED**, không dùng test key để gọi là nghiệm thu.

## 4. Cấu hình cần chuẩn bị an toàn

Không gửi password, DSN, service key hoặc token email vào chat. URL/site key/publishable key là công khai. Các giá trị dưới đây là **tên biến/placeholder, không phải địa chỉ đã cấp**.

| Nơi | Cấu hình |
|---|---|
| Cloudflare Pages / Build | `VITE_AUTH_DRIVER=supabase`, `VITE_SELF_SIGNUP_ENABLED=true`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable/anon), `VITE_TURNSTILE_SITE_KEY` (site key công khai), `VITE_PUBLIC_APP_URL=https://<app>.pages.dev`; `VITE_SERVER_URL` trống để qua gateway cùng origin |
| Pages Functions | `ACCESS_MODE=closed`, `BACKEND_URL=https://<service>.onrender.com`, `BACKEND_GATEWAY_KEY` secret, `SUPABASE_PUBLIC_ORIGIN`; khi pilot thêm `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` và chính sách Access cho URL chính/preview |
| Render | `NODE_ENV=production`, `STORAGE_DRIVER=postgres`, `TEACHER_AUTH_DRIVER=supabase`, `AVATAR_STORAGE_DRIVER=supabase`, `TEACHER_SELF_SIGNUP=true`, `PRODUCTION_ACCESS_MODE=closed`, `SUPABASE_URL`, `SUPABASE_AVATAR_BUCKET=student-avatars`, `CORS_ORIGINS=https://<app>.pages.dev`, `TURNSTILE_EXPECTED_HOSTNAME=<app>.pages.dev`, `PG_POOL_MAX=4`, `PG_SSL_MODE=verify-full` |
| Render encrypted secrets | `DATABASE_URL` runtime login, `SUPABASE_STORAGE_KEY`, `BACKEND_GATEWAY_KEY` khớp Pages Functions, **`TURNSTILE_SECRET_KEY`** cùng widget secret bên Supabase. Không đặt key operator/approval flags trên web service |
| Supabase Auth | Signup ON; Email provider/Confirm email ON; CAPTCHA provider Turnstile ON, cùng secret widget; password policy/rate limit, custom SMTP; cần kiểm Dashboard vì public settings không cung cấp đủ |
| Supabase Storage | Bucket private, size/MIME policy theo uploader hiện có; kiểm quyền key backend và gateway room/teacher. Không cấp public URL/photo, không nhúng ảnh vào export |
| Công cụ operator riêng | Credential admin, exact target/backup/version, approval flags chỉ sau phê duyệt. Không đưa vào Pages/Render runtime |

**Lấy URL/widget:** Cloudflare → Workers & Pages → dự án Pages → Overview lấy URL `.pages.dev`; Render → Web Service → URL `.onrender.com` gần tên service. Chưa tạo service/project thì chưa có URL thật. Không bấm Deploy/Publish để lấy URL khi chưa được duyệt bước triển khai kín.

Cloudflare → Turnstile → Add widget → Managed → hostname Pages thật **không** `https://` hay đường dẫn; lấy Site key công khai cho Pages, Secret key cho Supabase CAPTCHA **và Render**. Cần network tới `challenges.cloudflare.com` cả browser và Node. Không dùng wildcard hostname hoặc universal test keys để nghiệm thu.

Trong môi trường Cloud: URL là Environment variable; secret backend là secret binding, không gắn `VITE_`. HTTP secret cần domain đích tương ứng (`challenges.cloudflare.com` với verifier). `DATABASE_URL` chứa mật khẩu là secret môi trường server, không phải HTTP Authorization header. Không in giá trị để thử cấu hình. Hiện status chỉ xác nhận SUPABASE_URL, DATABASE_URL và secret SUPABASE_STORAGE_KEY sẵn sàng; chưa có các public URL/Turnstile/SMTP settings trong môi trường này. Dashboard có thể có cấu hình riêng chưa được kiểm.

### SMTP và redirect chính xác

Supabase Dashboard → Authentication → Email/SMTP: nhập host, port theo nhà cung cấp, username, **password trong trường bảo mật**, sender email và sender name. Xác minh domain sender, SPF/DKIM và DMARC theo provider; kiểm quota/email rate limits. Không cấu hình SMTP password trong frontend hoặc yêu cầu người dùng gửi qua chat. Không bắt buộc lưu SMTP credential ở Render khi Supabase là bên gửi thư.

Site URL `https://<app>.pages.dev/`. Chỉ thêm hai Redirect URLs chính xác:

```text
https://<app>.pages.dev/?mode=teacher&auth=confirm&fresh=1
https://<app>.pages.dev/?mode=teacher&auth=recovery&fresh=1
```

Thay `<app>` bằng URL thật trước lưu, không dùng placeholder/wildcard; review email template sử dụng RedirectTo chính xác. PKCE cần verifier ở browser yêu cầu email; thử riêng mở email khác browser/thiết bị và hướng dẫn lấy link mới khi cần. Không log query/token callback. Auth overhead local không chứng minh email delivery hoặc redirect hosted.

Checklist email/Turnstile thật còn BLOCKED: đăng ký hộp thư test người lớn, thử login trước confirm (bị từ chối), nhận/nhấn confirm, login và profile1lần, refresh/retry, resend/duplicate email phản hồi chung, link confirm dùng lại/hết hạn, recovery/đổi mật khẩu/thu hồi phiên qua restart, link ngoại domain bị từ chối, CAPTCHA sai/hết hạn/reuse/missing/network lỗi/rate429. Không dùng email/ảnh học sinh thật, không tự tạo user hoặc gửi thư khi chưa xác định hộp thư và phạm vi test được phép.

## 5. Hiệu năng cùng kịch bản cũ

Chromium headless Linux, viewport giáo viên1500×1100 + viewport học sinh390×844,19 Socket.IO bot +1 browser học sinh,20 avatar, camera nhóm dẫn đầu (15 avatar trong view), Vite và PostgreSQL17 local. Auth/Storage provider giả, SDK thật. Đo rAF8s sau offline22s/resume; không build/test khác chạy đồng thời cửa sổ đo. Node24.22.1, quota4CPU, memory limit32GiB. Một lần đo, chưa đủ suy luận thống kê giữa các lần chạy.

| Chỉ số | Baseline9B.2 | Lần9B.3 này |
|---|---:|---:|
| FPS rAF | 20,17 | 20,66 |
| Frame P95 | 66,70ms | 66,70ms |
| Answer RTT median | 252,42ms | 334,69ms |
| Answer RTT P95 | 493,08ms | 584,95ms |
| Answer RTT P99 | Không có | 584,95ms |
| Node RSS (có Vite/emulator/bot, không Chromium/PG) | 454,60MiB | 450,93MiB |
| Payload gửi/giây (không TLS/framing overhead) | 2.175.894B | 2.165.789B |

RTT19 mẫu, P95/P99 gần hoặc bằng max, chưa là SLA. FPS gần mức cũ; RTT lần này cao hơn, **không tuyên bố cải thiện hiệu năng** hoặc quy nguyên nhân cho CAPTCHA. Race harness dùng giáo viên đã mapping/schema3 như baseline, không đo đăng ký mới/Siteverify thật. Game/render không sửa trong tác vụ này. Điều kiện CPU/GPU host biến động; cần nhiều lượt cloud và thiết bị thật trước quyết định.

- Node CPU trong8s: **9,43% một core** (100%=1core), không bao gồm Chromium/PostgreSQL/host.
- Event loop mean/P95/P99/max: **11,06/15,16/21,87/46,79ms**.
- Auth verification79 mẫu (JWT + SQL + provider giả tùy đường gọi): median/P95/P99 **5,16/33,58/46,07ms**. Không phải overhead Supabase qua Internet, không bao gồm CAPTCHA/email.
- Room transaction57 mẫu median/P95/P99 **18,27/42,50/47,78ms**, commit **3,00/12,59/15,80ms**; answer queue39 mẫu gồm duplicate retries **250,87/491,74/493,93ms**. Quantile các pha không cộng trực tiếp được. Quan sát cho thấy queue chờ đáng kể, không phải chứng minh nhân quả duy nhất.
- Texture89/avatar20, bindings đúng20; không tải Phaser trên browser học sinh. React profiler toàn luồng399commit/9603,8ms, max99,5ms; không phải riêng cửa sổ8s. Heap browser khoảng40,55MiB chỉ là snapshot, chưa là kiểm chứng không rò rỉ dài hạn.

Bằng chứng: [`browser.json`](benchmarks/9b3/equivalent-browser/browser.json), [`ảnh local`](benchmarks/9b3/equivalent-browser/cloud-race.png). Baseline cũ `benchmarks/auth-production/race/browser.json` được giữ nguyên.

Đo native PostgreSQL +20 client loopback riêng, không render, không Supabase Auth:60 answers,200 lane commands,3 transport disconnect chủ động. Answer RTT median/P95/P99 **148,99/256,88/290,51ms**; answer queue **121,98/238,05/267,96ms**; transaction329 mẫu **11,04/16,20/23,50ms**; pool wait **0,13/0,30/0,61ms**, pool4/1dedicated writer, không thấy chờ tồn cuối phép đo. Reconnect3 mẫu **142,28/157,50/157,50ms**,0 mất kết nối ngoài chủ động; payload gửi665.400B/s/nhận2.143B/s; event loop P95/P99 **12,74/15,07ms**. Ranking gap median/P95/P99 **100,40/500,27/601,88ms**, câu trả lời đồng thời đầu tới teacher frame258,96ms. Đây là workload khác, **không thay cột baseline/cùng phương pháp**. Chi tiết [`native-postgres-network.json`](benchmarks/9b3/native-postgres-network.json).

## 6. Kiểm thử và crash

| Kiểm tra | Kết quả local | Nghiệm thu hosted |
|---|---|---|
| TypeScript; build client/server; Pages build self-signup với public config giả | PASS compile | NOT TESTED deployment |
| Pages Functions build | PASS compile | NOT TESTED Cloudflare |
| Full suite PostgreSQL local | 98/98 assertions,0fail/skip | NOT TESTED Auth/SMTP/Turnstile hosted; không quy mock thành PASS |
| Metadata review READ ONLY trên PostgreSQL local | PASS nativeSQL, không tự apply DDL | BLOCKED catalog production |
| Signup/Auth Chromium UI, recovery, PKCE, refresh/logout nhiều tab | Assertions hoàn tất, provider/widget giả | NOT TESTED hosted |
| Pages Worker closed/pilot không identity | Local workerd chặn static/SPA/API/socket như hợp đồng | NOT TESTED chính sách Access thật |
|20 client native PostgreSQL loopback | PASS chỉ workload native local nêu trên | NOT TESTED20 client cloud |
|20 avatar, teacherId idempotent, tenant API, upload, private blob ảnh | Hợp đồng local với provider giả | NOT TESTED private bucket/Auth thật |
| Crash/restart compiled backend +PostgreSQL thật, Auth/Storage/Turnstile giả | Assertions hoàn tất,3signals×20client | NOT TESTED Render restart |

Crash dùng entrypoint build thật, NODE_ENV=production, HTTPS provider emulator được CA tin cậy (không tắt TLS verification), schema4/self-signup bật. Loader test riêng chỉ chạy với DB/provider127.0.0.1 và hostname test cố định, ứng dụng không import loader và không có runtime bypass env. SIGTERM/SIGINT/SIGKILL mỗi lượt20 đáp án ACK đã ghi bền,20 avatar khớp studentId, resume paused, resend không thưởng trùng; teacherId mới giữ nguyên qua restart. **Xe lùi0/0/30,62m** tương ứng: SIGKILL mất tiến độ sau checkpoint gần nhất, không mất đáp án được xác nhận. Không sửa checkpoint/race để che giới hạn.

Chromium race có1 client offline22s/reconnect; native workload chỉ ngắt3 transport trong20. **Chưa thử đồng loạt20 thiết bị mất mạng/reconnect**, screen lock30–60s và đóng browser trên điện thoại thật. Không biến “20client kết nối” thành “20client reconnect đã nghiệm thu”.

Lần đầu signup fixture timeout lúc teardown; đã sửa thứ tự đóng browser/drain backend trước đóng proxy, chạy lại exit0. Pages build lần đầu sandbox EPERM ở IPC của tsx; retry ngoài sandbox được auto-review chấp nhận, exit0; không phải lỗi build ứng dụng. Bundle Phaser lớn vẫn cảnh báo như trước. Không tối ưu RaceModel hoặc làm nhẹ kiểm bảo mật để lấy số đo.

Các artifact mới nằm `benchmarks/9b3/`; log local không chứa credential, export không nhúng ảnh. `validation.json` và `source-check.json` ghi phạm vi kiểm tra và đối chiếu snapshot đầu lượt.

## 7. File đã sửa/tạo

Sửa Auth/backend: `server/cloud/TeacherSignup.ts`, `TeacherAuth.ts`, `server/storage/factory.ts`, `contracts.ts`, `server/classroom/api.ts`; tạo `server/cloud/Turnstile.ts`.

Sửa Auth UI: `src/classroom/api.ts`, `TeacherLogin.tsx`, `AuthChallenge.tsx`. Chỉ trang Auth nhận thêm bước proof, không đổi giao diện game.

Sửa tooling/config: `.env.example`, `render.yaml`, `package.json`, `scripts/cloud/preflight.ts`, `browser.ts`, `persistence.ts`, `signup-browser.ts`; tạo `scripts/cloud/migration-review.ts`.

Sửa `tests/teacher-signup.test.ts`; tạo `tests/turnstile.test.ts`, `tests/migration-review.test.ts`, `tests/helpers/turnstile-preload.mjs`.

Tạo báo cáo này, `MIGRATION_REVIEW_9B3.md`, artifacts `benchmarks/9b3/*`; cập nhật `SUPABASE_AUTH_PRODUCTION_MIGRATION.md`. Không thay adapter PostgreSQL, SQL001–004, RaceModel/Scene, Room/queue/protocol, scoring/reconnect, CSS hoặc SQLite/ảnh nguồn. Git đã untracked nguồn từ đầu; không dùng git diff để giả kết luận không có thay đổi, dùng SHA256 snapshot.

## 8. Các bước tiếp theo và điểm phải phê duyệt

1. Chuẩn bị URL Pages/Render thật, public site key, hộp thư test người lớn. Secret qua Dashboard/Settings bảo mật, không chat. Cấp TCP READ ONLY tới `db.icdnxzwkrgkjhoqrvsbh.supabase.co:5432` trong môi trường; kiểm lại trạng thái live rồi mới dùng metadata review. Không in DSN hoặc đổi sang production URL giả.
2. Đối chiếu catalog/hash/role, inventory tài khoản cũ và backup/restore rehearsal; cập nhật đúng pending SQL. **NEEDS APPROVAL:** chính xác SQL/hash/target/maintenance trước apply; không chạy003/004 hoặc import dữ liệu thật trong lượt này.
3. Review/tạo private bucket nếu cần, SMTP/sender/Turnstile/Site URL/redirect/rate limits qua Dashboard; xác nhận key/cấu hình runtime least privilege. Những thay đổi tài nguyên này chưa được thực hiện. **NEEDS APPROVAL:** cấu hình/triển khai thử kín Cloudflare+Render, một instance, Access và gateway chặn cả frontend/backend, preview cũng bị bảo vệ.
4. Sau approval dùng dữ liệu giả, hộp thư test được xác định; thử Auth/SMTP/Turnstile thật, trùng email/token/link/revocation, teacherA/B không đọc chéo, student không nhận quyền giáo viên, ảnh đúng xe/private, export không ảnh; không chạy crash test phá hủy khi có người dùng thật.
5. Chạy20 client cloud, reconnect/restart có kế hoạch, xác minh ACK durable/idempotency/paused restore, WSS và QR HTTPS, đo lại RTT/FPS/CPU/queue/transaction. Tiếp đó checklist20 điện thoại Wi-Fi trong `CLASSROOM_READINESS.md`: đồng thời trả lời/chuyển làn,20 avatar, mất Wi-Fi, khóa màn hình, đóng/mở browser, chọn trùng học sinh, pause/resume/end/export. Ghi rõ thiết bị/mạng/mẫu và cả lỗi xảy ra; thử soak memory dài hơn.
6. **NEEDS APPROVAL riêng:** chuyển tài khoản/dữ liệu/ảnh thật và mở production công khai chỉ sau khi đủ nghiệm thu/backup/rollback; không tự đổi DNS/publish/commit. Rollback ưu tiên closed gate+compatible artifact+giữ database; restore/import rollback phải có review dữ liệu mới và revocation, không xóa SQLite/ảnh gốc.

Hiện không cần mật khẩu qua chat hay phê duyệt chung chung; cần hoàn tất cấu hình và metadata để đưa ra tập thay đổi production cụ thể có thể duyệt. Thiếu điều kiện trên nên dừng ở chuẩn bị và báo cáo, không tuyên bố9B.3 hoàn tất nghiệm thu thực tế.
