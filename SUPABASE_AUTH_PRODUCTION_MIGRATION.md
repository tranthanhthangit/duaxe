# Giai đoạn 9B.2 — Supabase Auth và chuyển tài khoản giáo viên

## Bổ sung 9B.3: kiểm tra hostname/action tại Node

Trạng thái hiện hành và giới hạn nghiệm thu: [SUPABASE_PRODUCTION_VALIDATION_9B3.md](SUPABASE_PRODUCTION_VALIDATION_9B3.md). SQL cần review, chưa chạy production: [MIGRATION_REVIEW_9B3.md](MIGRATION_REVIEW_9B3.md).

Luồng đăng ký mới bổ sung một Turnstile **mới** có action `teacher-profile` sau khi đăng nhập/xác nhận email, trước khi Node tạo quyền giáo viên. Token `teacher-auth` đã được Supabase dùng không được gửi lại Siteverify. Node kiểm `success`, hostname HTTPS đã duyệt, action, thời hạn và replay; token không hợp lệ hoặc dịch vụ lỗi đều từ chối cấp quyền. Retry của mapping đã tồn tại giữ nguyên teacherId. Reset lần đầu có thể yêu cầu bước hoàn tất này trước khi tạo profile; refresh của giáo viên đã mapping không cần challenge mới.

**Cập nhật hướng dẫn secret phía dưới:** cùng secret widget phải nằm trong Supabase Auth CAPTCHA settings **và Render `TURNSTILE_SECRET_KEY`**, thêm `TURNSTILE_EXPECTED_HOSTNAME` khớp CORS origin frontend. Chỉ site key công khai vào Pages `VITE_TURNSTILE_SITE_KEY`. Không đưa secret vào frontend/chat/git. Hướng dẫn cũ chỉ đặt secret ở Supabase chưa đủ cho bước kiểm hostname/action mới. Cấu hình thiếu hoặc universal test key làm enrollment runtime fail closed. Kiểm thử mock local không chứng minh Turnstile/SMTP thật đã hoạt động.

## Cập nhật hiện hành: giáo viên tự đăng ký (07/11/2026)

Phương án được người dùng xác nhận: giáo viên tự đăng ký bằng họ tên/email/mật khẩu, bắt buộc xác nhận email, sau đó đăng nhập và được tạo hồ sơ tự động. **Không có hàng đợi phê duyệt tài khoản mới hoặc bước Admin invite trong luồng này.** Học sinh tiếp tục QR/mã phòng và secret riêng, không cần Supabase Auth. Các hướng dẫn Admin/migration phía dưới chỉ dành cho tài khoản và dữ liệu cũ cần chuyển có kiểm soát.

**Mã nguồn và kiểm thử được thực hiện local. Chưa chạy migration004 trên Supabase, chuyển tài khoản/ảnh thật, sửa Dashboard, gửi email thật, publish/deploy, đổi DNS hoặc mở public access. Không commit.**

### Quy trình đăng ký và xác nhận

1. Giáo viên mở Auth, chọn Đăng ký giáo viên, nhập họ tên, email, mật khẩu và nhập lại mật khẩu; hoàn thành Turnstile.
2. SDK Supabase `signUp` gửi trực tiếp qua HTTPS, chỉ đặt `user_metadata.full_name` làm tên hiển thị. Không gửi teacherId/ownerId/role do frontend chọn. Mật khẩu không đi qua API Node và không lưu trong database ứng dụng.
3. Supabase gửi email confirmation qua SMTP đã cấu hình. UI hiển thị thông báo chung, kể cả email trùng; không suy luận user đã tồn tại từ fake/obfuscated identity. Nếu provider trả session ngay khi signup, frontend đăng xuất session đó và báo cấu hình confirmation chưa an toàn.
4. Link về `/?mode=teacher&auth=confirm&fresh=1`; SDK dùng PKCE, xóa code/token/error khỏi URL trước await. Xác nhận xong đăng xuất session callback và yêu cầu đăng nhập. Link đã dùng/hết hạn chỉ báo lỗi, không cấp quyền. Có nút gửi lại confirmation, dùng CAPTCHA và thông báo chung/cooldown429.
5. Đăng nhập thành công gọi `POST /api/auth/profile` rồi `/api/me`. Backend xác minh JWT bằng cơ chế 9B.2, lấy Auth user mới nhất bằng server key và yêu cầu `email_confirmed_at`, không banned/deleted/anonymous. Không có profile/mapping mới trong lúc email chưa xác nhận.
6. Backend commit teacher + teacher profile + Auth mapping trong một transaction trước trả HTTP200. Giáo viên bắt đầu với dữ liệu riêng; không cần quản trị viên duyệt.

Giữ quên/đặt lại mật khẩu, refresh và logout của9B.2. Giáo viên đã xác nhận email nhưng chưa từng đăng nhập cũng có thể reset: backend tự provision profile idempotent trước khi commit cutoff, không đòi quản trị viên liên kết tài khoản mới. CAPTCHA áp dụng signup/login/resend/recovery khi được cấu hình; không áp thêm challenge cho password update hoặc refresh. Callback recovery và confirmation dùng cùng cơ chế xử lý URL, không tạo trang game mới. PKCE cần verifier của trình duyệt đã yêu cầu email; khi mở email trên trình duyệt khác có thể cần dùng liên kết mới hoặc đăng nhập sau khi email đã được provider xác nhận. Chưa nghiệm thu hành vi email thực trên thiết bị thật.

### TeacherId, idempotency và tài khoản cũ

- TeacherId mới là `randomUUID()` ở backend, độc lập Auth UUID; `teachers.id` và quan hệ cũ giữ nguyên. Frontend không chọn ID hoặc owner. Backend chỉ sử dụng `full_name` như văn bản; mọi trường metadata tự khai như `role`, `teacherId` bị bỏ qua về phân quyền.
- `teacher_auth_links` có khóa Auth UUID và teacherId duy nhất; `teacher_profiles.teacher_id` là PK/FK. Transaction giữ writer fence và advisory lock theo Auth UUID. Email có unique index theo `lower(btrim(email))`.
- Retry đồng thời, reload hoặc mất phản hồi COMMIT đều nhận lại teacherId đã commit. Lỗi giữa insert teacher/profile/mapping rollback cả transaction, không giữ hồ sơ một nửa. Không auto retry một COMMIT chưa rõ outcome rồi tạo ID mới.
- Mapping cũ enabled được tái sử dụng nguyên teacherId; mapping disabled, session revoked hoặc cutoff không được đăng ký lại để vượt quyền. Không cập nhật tên/email/mapping cũ bằng metadata từ đăng ký mới.
- Auth UUID chưa mapping nhưng email trùng hồ sơ cũ trong PostgreSQL: trả409 và không link/tạo profile mới. Trường hợp này cần đối chiếu migration/quyền sở hữu dữ liệu cũ, **không phải yêu cầu phê duyệt mọi tài khoản mới**.
- Trước mở signup production phải import hoặc bảo toàn danh sách email/ID giáo viên cũ vào PostgreSQL và kiểm số lượng. Backend không thể bảo vệ một email cũ còn nằm ngoài database cloud mà chưa được đưa vào đối chiếu. Không bật admission trước bước này; không tự đọc/di chuyển SQLite thật để làm tắt.

### Migration004 và phân quyền

`004_teacher_signup.sql` là migration bổ sung, không sửa001–003 hoặc SQLite:

| Thay đổi | Cách bảo vệ |
|---|---|
| Unique index `teachers_normalized_email` | Trùng email sau trim/lowercase làm migration fail và rollback; không merge/xóa/sửa email âm thầm |
| `teacher_profiles(teacher_id,full_name,created_at)` | FK về teacherId hiện có; CHECK tên2–100 ký tự; FORCE/ENABLE RLS, không browser grants/policies |
| Runtime thêm INSERT Auth mapping | Không thêm UPDATE enabled/teacherId; mapping vẫn chỉ do backend tạo sau verify, endpoint từ chối body có ID/role |

Runtime chỉ cần SELECT/INSERT profile. Các bảng private schema duaxe không expose qua Data API. Policy runtime vẫn trải nhiều tenant như9B.2; **không tuyên bố RLS tự tách teacher khi backend có quyền rộng**. Backend lấy owner từ Auth UUID đã verify cho mọi API lớp/học sinh/avatar/câu hỏi/phòng/history. Supabase service key có thể bypass RLS, chỉ ở server; không frontend nào có key đó. Giáo viên mới không đọc/sửa được lớp của giáo viên cũ hoặc giáo viên khác.

Cloud runtime chấp nhận schema3/4 khi signup tắt; **self-signup bật bắt buộc schema4**. Runtime không tự migrate. Preflight cũng kiểm schema và cấu hình signup/confirmation nếu bật feature. Công cụ import cũ được bổ sung checksum teacher_profiles để từ chối rollback mất hoạt động mới.

Sau phê duyệt backup/target và dừng writer, operator dùng lệnh hiện có với tùy chọn mới:

```sh
# Chỉ plan; chưa kết nối hoặc thay đổi database
npm run cloud:operator -- schema --self-signup
# Chỉ sau phê duyệt riêng, các target/approval guards của operator vẫn bắt buộc:
# npm run cloud:operator -- schema --self-signup --apply
```

### Chống spam/đăng ký tự động

- Tích hợp Turnstile explicit widget chỉ trên các form Auth. Token một lần gửi qua `captchaToken` của SDK tới Supabase; reset challenge sau mỗi thao tác, xử lý token hết hạn/lỗi tải. Token không lưu trong room, QR hoặc export.
- **Phải bật CAPTCHA Turnstile tại Supabase Auth**, nhập secret của widget ở Dashboard. Nếu chỉ có widget frontend, kẻ tự động có thể gọi Auth endpoint trực tiếp. Không coi frontend CAPTCHA là kiểm tra bảo mật phía server.
- Public `/auth/v1/settings` không công bố trạng thái CAPTCHA, SMTP hoặc rate limits. Runtime có thể kiểm `disable_signup=false`, `mailer_autoconfirm=false`, Email provider enabled, nhưng các mục CAPTCHA/SMTP/rate vẫn phải được kiểm Dashboard và nghiệm thu request trực tiếp trên project.
- API tạo profile giới hạn20 yêu cầu/phút/IP; provision mới tối đa10/phút/Auth UUID, tối đa1000 bucket còn hạn. JWT cần hợp lệ trước khi dùng Auth UUID làm key. Không tin X-Forwarded-For tùy ý. Sau Pages/Render, nhiều client có thể chung peer IP; giới hạn này dành cho đăng ký giáo viên, không phải20 học sinh trả lời.
- Direct Supabase Auth dùng limiter của provider (signup, email send/resend/recovery/login) và CAPTCHA. Cần cấu hình theo SMTP quota, thử429 và cooldown thực; UI không thay thế limiter server. Không gửi email kết quả, mã phòng hoặc quảng cáo; chỉ email Auth confirmation/recovery và resend theo yêu cầu.

### Supabase Dashboard và biến môi trường

| Nơi | Cấu hình production sau phê duyệt |
|---|---|
| Supabase Auth / Providers / Email | Email enabled; **Allow new users to sign up ON; Confirm email ON** (mailer_autoconfirm=false) |
| Supabase Auth / CAPTCHA | Enable CAPTCHA, provider Turnstile; secret widget trong Dashboard bảo mật, không chat/git/VITE_ |
| Cloudflare Turnstile | Widget hostname allowlist đúng `<app>.pages.dev`, không toàn bộ pages.dev; public site key cho Pages |
| Supabase Auth / SMTP | Custom SMTP/sender đã xác minh, SPF/DKIM/DMARC theo nhà cung cấp; password chỉ trong Dashboard; test email thực trước mở người dùng |
| Site URL | `https://<app>.pages.dev/` |
| Redirect URLs | Chính xác hai URL `https://<app>.pages.dev/?mode=teacher&auth=confirm&fresh=1` và `https://<app>.pages.dev/?mode=teacher&auth=recovery&fresh=1`; không wildcard/preview/localhost trong project production |
| Auth templates | Confirmation và recovery dùng ConfirmationURL/redirect provider; không bỏ PKCE bằng cách tự sửa link hoặc log link/token |
| Auth password / rates | Chính sách khớp UI12–200 ký tự, có hoa/thường/số; cấu hình rate limits/cooldown theo SMTP, kiểm request trực tiếp thiếu/sai CAPTCHA |
| Render | `TEACHER_SELF_SIGNUP=true`, cùng các biến Supabase/PG/gateway9B.2; một active writer; `PRODUCTION_ACCESS_MODE=closed` đến lúc được duyệt |
| Pages build | `VITE_SELF_SIGNUP_ENABLED=true`, `VITE_TURNSTILE_SITE_KEY` public; giữ VITE_AUTH_DRIVER=supabase, public project URL/key và backend gateway cùng origin |
| Pages Functions | CSP cho script/frame Turnstile chỉ khi mode=teacher; không nới quyền cho trang học sinh; gate closed/pilot vẫn giữ nguyên |

Template Render bật flag cho phương án mới; `.env.example` vẫn tắt ở local/legacy và hướng dẫn bật **cả hai** flag ở cloud. Build Pages từ chối self-signup thiếu site key hoặc dùng universal test key của Turnstile. Kiểm tra hình dạng key không chứng minh key thuộc đúng widget/project; phải nghiệm thu thực. Không đặt CAPTCHA secret trên frontend hoặc dùng Supabase service key như publishable key.

**Quan sát chỉ đọc trên Supabase thật trong phiên này:** endpoint settings báo signup enabled, email confirmation required, Email provider enabled. Không thay đổi các giá trị này. Endpoint không cho biết CAPTCHA/SMTP/rate limits; chưa login/signup hoặc gửi email thật, chưa tạo teacherId trên database thật. Bằng chứng an toàn: `benchmarks/self-signup/provider-settings-readonly.json`.

### Kiểm thử hiện tại

| Nhóm | Kết quả local |
|---|---|
| Toàn bộ unit/integration | **94/94 pass,0 fail,0 skip** (88 cũ +6 self-signup) trên PostgreSQL17 local |
| TypeScript, frontend/backend build | Đạt; giữ cảnh báo chunk Phaser lớn như cũ |
| Chromium self-signup | Đạt: CAPTCHA trước request, token gửi SDK, duplicate email generic, pending không có teacher/profile, unconfirmed login bị chặn, confirm rồi login, fullname tiếng Việt, ID ổn định/reload/retry, tenant khác bị chặn |
| Chromium link/recovery | Đạt: link dùng lại/hết hạn, URL scrub, resend429, quên/đặt mật khẩu và logout; Auth/Turnstile giả lập, SDK thật |
| Chromium9B.2 regression | Đạt login/refresh/reset, mất ACK cutoff rồi retry không đổi password hai lần, logout nhiều tab/ẩn phòng đang mở |
| Atomicity/idempotency |5 request đồng thời một ID; lỗi insert rollback0 profile; mất phản hồi COMMIT rồi retry1 teacher/profile; giữ ID qua restart |
| Legacy/migration/RLS | Email cũ không bị claim; không re-enable mapping; không sửa teacherId cũ; schema004 gặp case collision rollback về3; untrusted SQL role không đọc profile |
| Compiled runtime self-signup ON | Schema4 + HTTPS Auth/Storage emulator, TLS verify bật; profile tự tạo giữ nguyên ID qua SIGTERM/INT/KILL |
| Multiplayer regression | Mỗi tín hiệu20 player/20 ACK/20 avatar, paused sau restart,0 thưởng trùng; SIGKILL quan sát lùi26,69m chưa checkpoint |
| Pages Functions/Worker | Build local đạt; static/SPA/API/Socket vẫn fail closed; CSP Turnstile chỉ teacher |

Benchmark/screenshot cũ được giữ nguyên. Bằng chứng mới trong `benchmarks/self-signup/`: browser, auth-regression, signals, source-check và validation. Chưa đo FPS/RTT mới trong pha Auth này; số ở phần lịch sử phía dưới không phải số đo self-signup hiện tại. Chưa test20 điện thoại thật hoặc bảo đảm mạng lớp học ổn định.

### Các điều kiện còn chặn production và rollback

1. Backup SQLite/ảnh và PostgreSQL/Auth/Storage, thử restore và đối chiếu dữ liệu cũ trước khi mở signup. Source thật chưa được thay đổi trong phiên này.
2. Duyệt/apply schema004, kiểm normalized email trước khi import; bảo toàn teacherId/email/mapping cũ rồi mới cho tạo tài khoản mới. Kiểm quyền runtime tối thiểu trên Supabase thật.
3. Chuẩn bị tên Pages/Render thực, Site URL và hai redirect exact; xác minh custom SMTP, template/link, delivery/thư rác, CAPTCHA provider bật và rate limits bằng request trực tiếp. Public settings hiện đạt3 cờ không đồng nghĩa cả checklist đã đạt.
4. Duyệt deploy bản đóng để kiểm dữ liệu giả; thử signup/login/confirm/resend/used-link/reset thật, RLS/private Storage, HTTPS/WSS và restart trên dịch vụ. **Chưa thực hiện hosted acceptance này**; unit runner0 skip không có nghĩa các mục hosted đã được chạy.
5. Kiểm20 thiết bị thật/soak/performance theo CLASSROOM_READINESS.md. Số FPS/RTT lịch sử còn thấp cần xử lý; không tuyên bố sẵn sàng người dùng thật.
6. Chuyển tài khoản/ảnh thật và publish/live vẫn cần phê duyệt tương ứng. Không có phê duyệt từng giáo viên mới khi hệ thống đã được mở chính thức.

Rollback feature: đóng admission, dừng/drain writer khi đổi release; dùng artifact hiểu schema4, tắt `TEACHER_SELF_SIGNUP` và `VITE_SELF_SIGNUP_ENABLED` khi cần, giữ toàn bộ teacher/profile/mapping và dữ liệu đã tạo. Không drop004, xóa Auth users hoặc chuyển về SQLite bỏ mất dữ liệu cloud. Người đã có mapping vẫn đăng nhập được bằng Auth. Thay đổi Dashboard (kể cả đóng signup) cần phê duyệt và xem xét người đang xác nhận email; không auto sửa project để làm test qua.

File thay đổi của lần cập nhật: `TeacherSignup.ts` (mới), `004_teacher_signup.sql` (mới), `AuthChallenge.tsx` (mới), `teacher-signup.test.ts` (mới), `signup-browser.ts` (mới); mở rộng TeacherAuth/AuthUserStatus/contracts/API/factory, migrate/Database/importer, auth.ts/TeacherLogin/ClassroomPanel/api, CSP, operator/preflight/build guard, config/template, helper/test/harness và báo cáo. Danh sách chính xác theo nguồn đầu phiên tại `benchmarks/self-signup/source-check.json`. Không đổi RaceModel/RaceScene/Room/RoomQueue/shared protocol, quy tắc ACK sau commit, luật đua, CSS hoặc migration001–003.

---

## Báo cáo nền 9B.2 — giữ để tham khảo migration tài khoản cũ

Các số đo và kết luận bên dưới thuộc phiên9B.2 trước self-signup. Chính sách đăng ký mới và schema hiện hành được cập nhật ở phần đầu, không dùng các đoạn lịch sử để yêu cầu duyệt tài khoản mới.


Ngày 07/11/2026 (UTC+7). Repository `/workspace/duaxe`. Phần code và các kiểm thử local được thực hiện trên bản draft hiện tại, không áp dụng lại các giai đoạn đã hoàn thành.

**Chưa import tài khoản thật, sửa database Supabase, chuyển ảnh thật, gửi email thật, deploy/publish, đổi DNS hoặc mở public access.** Không commit hoặc xóa file untracked. Không tạo staging riêng. Dùng địa chỉ mặc định Pages/Render theo lựa chọn của người dùng.

## 1. Khảo sát và kiến trúc Auth cũ

Đã kiểm tra package.json, frontend/classroom/online, Store/migrations SQLite1–2, PostgreSQL adapter/migrations001–002, API, RoomQueue, Socket.IO, checkpoint/receipt, avatar, lịch sử và các báo cáo ASYNC_STORAGE_MIGRATION.md, POSTGRESQL_ADAPTER_MIGRATION.md, POSTGRESQL_PERFORMANCE_STAGING.md, CLOUD_MIGRATION_PLAN.md, DEPLOY_CLOUDFLARE_RENDER_SUPABASE.md, CLASSROOM_READINESS.md, PRODUCTION_IMPLEMENTATION.md.

Trong bản nguồn đầu phiên đã có Supabase SDK login/refresh/logout, JWKS verification, private avatar adapter, `teacher_auth_links`, revocation theo session và Pages gateway. Không tạo lại các phần này hoặc PostgreSQL adapter. Khoảng trống: quên/đặt lại mật khẩu, kiểm tra trạng thái Auth mới nhất, thu hồi JWT của các thiết bị khác sau reset, và migration tài khoản có journal/retry.

Auth local cũ: `teachers.id` UUID lưu dưới dạng TEXT trong SQLite; lớp/ảnh/phòng tham chiếu ID này. Email được chuyển chữ thường khi tạo nhưng schema không lưu bằng chứng email verified hoặc trạng thái vô hiệu hóa. `Store.createTeacher` dùng Node `scryptSync(password, salt, 64)`, salt16 byte; lưu `saltHex32:hashHex128`. Adapter PostgreSQL cũ dùng scrypt async với cùng định dạng. Phiên cookie `teacher_session` ngẫu nhiên32 byte, chỉ SHA-256 lưu DB, TTL12 giờ; HttpOnly/SameSite=Strict, Secure trong production.

## 2. Mật khẩu và mapping

Không coi định dạng scrypt riêng này là `password_hash` được Supabase hỗ trợ. Không đổi hash, xuất hash, gửi hash qua Admin API hoặc đặt mật khẩu mặc định. Công cụ tạo Auth user **không có password/password_hash**, `email_confirm:false`, bằng Admin API được hỗ trợ; giữ nguyên password cũ trong database nguồn để bảo toàn dữ liệu và rollback có kiểm soát.

`teacher_auth_links(auth_user_id UUID PRIMARY KEY, teacher_id UUID UNIQUE FK, enabled)` tiếp tục ánh xạ Auth UUID về teacherId cũ. Lớp, học sinh, avatar, chủ phòng, lịch sử không đổi khóa. Đăng nhập Auth thành công chưa tự tạo quyền giáo viên: `/api/me` phải tìm được mapping enabled. Không dùng email hoặc `user_metadata` làm quyền quản trị.

Audit kiểm email thiếu/sai, trùng sau trim/lowercase, dạng mật khẩu hỗ trợ/không hỗ trợ, số lớp/học sinh/phòng. Audit không đọc giá trị hash ra khỏi SQL. Không thể suy ra email đã xác minh hoặc tài khoản local bị vô hiệu hóa từ schema cũ: quản trị viên phải rà soát. Auth user bị banned/deleted/anonymous hoặc chưa xác minh bị chặn. Không tự gộp tài khoản trùng email.

## 3. Frontend và phiên

`TeacherLogin` dùng lại khung đăng nhập và CSS hiện tại, thêm quên mật khẩu và form đặt mật khẩu trong cùng màn hình. Bản self-signup bổ sung đăng ký theo phần cập nhật đầu tài liệu; không thay bố cục game. Mật khẩu mới12–200 ký tự, có chữ hoa/chữ thường/số; phải cấu hình chính sách tương ứng phía Supabase, vì client validation không phải ranh giới bảo mật.

- Login/password/refresh dùng Supabase browser SDK; `/api/me` kiểm mapping trước khi mở hồ sơ. Backend cloud không nhận login mật khẩu cũ.
- Recovery dùng PKCE và redirect chính xác `https://<app>.pages.dev/?mode=teacher&auth=recovery&fresh=1`; cùng trình duyệt đã yêu cầu email giữ verifier. Invite fragment từ Auth cũng được nhận với `type=invite|recovery` và SDK `setSession`.
- Code/token/error callback được xóa khỏi thanh địa chỉ bằng `replaceState` trước await. Link sai/hết hạn không mở form đặt mật khẩu. Không ghi link/email/JWT vào log.
- Sau đổi mật khẩu: backend commit cutoff thu hồi mọi JWT cũ của tài khoản đã mapping, sau đó SDK signOut global thu hồi refresh token. Tài khoản chưa mapping chưa có quyền backend: quản trị viên cần finalize sau xác minh email để người nhận hoàn tất bước này. HTTP401 hoặc lỗi mạng/lưu trữ đều không được coi là đã thu hồi. UI giữ trạng thái mật khẩu đã đổi và cho thử Hoàn tất đăng xuất, không đổi mật khẩu lần hai. Retry refresh JWT sau giây cutoff, xử lý cả trường hợp COMMIT thành công nhưng mất phản hồi.
- JWT `iat` chỉ chính xác đến giây; token phát hành trong giây bị thu hồi cũng bị chặn. UI chờ1,1 giây trước khi cho đăng nhập lại. Máy chủ cần đồng bộ đồng hồ.
- Phiên SDK persist trong localStorage của Pages, tự refresh; logout và signout tab khác xóa danh sách quản trị. Bearer token đi qua gateway cùng origin, không kết hợp cookie legacy với Auth cloud. Cloud logout không phát cookie.

LocalStorage chịu rủi ro XSS. CSP/Referrer-Policy đã có ở Pages Functions, không dùng `dangerouslySetInnerHTML` cho tên/câu hỏi. Chưa chứng minh CSP/HTTPS trên Pages thật bằng test Vite local. MFA cho giáo viên chưa có UI challenge; không bật bắt buộc AAL2 trước khi bổ sung và nghiệm thu luồng đó. Tài khoản quản trị Supabase/Cloudflare/Render nên bắt buộc MFA.

Đăng xuất từ tab khác cũng xóa frame/avatar/câu hỏi quản trị khỏi màn hình đường đua đang mở, đóng socket; giữ credential phòng riêng để có thể khôi phục sau một lần đăng nhập hợp lệ. Mất Wi-Fi thông thường không đi qua nhánh xóa dữ liệu này. Chromium đã kiểm cả trường hợp đang mở phòng.

## 4. Backend và Socket.IO

JWT được `jose.jwtVerify` xác minh với JWKS: ES256/RS256, chữ ký, issuer, audience authenticated, expiration, iat, sub, session_id, role và anonymous. Không chỉ decode. Không tin teacherId do frontend gửi.

Runtime factory cloud bắt buộc schema003, bật kiểm cutoff và kiểm trạng thái hiện tại bằng Auth Admin GET user theo UUID đã xác minh. Dùng server-only service key đang cấp cho Storage; không dùng publishable key để kiểm banned state. Public `/user` không được coi là bằng chứng chắc chắn về `banned_until`. Key này cần quyền Auth Admin đọc user; quyền thực trên project chưa được kiểm chứng. `SUPABASE_AUTH_ADMIN_KEY` riêng chỉ dành cho công cụ provisioning/operator, không cần đặt trên frontend hoặc Render.

Đọc thông thường cache thành công tối đa10 giây, tối đa256 digest JWT trong RAM; không cache quyền mapping. `/me`, HTTP ghi và lệnh giáo viên kiểm provider mới; provider lỗi/timeout3 giây thì từ chối quyền. Không gọi Auth provider khi học sinh trả lời bằng capability riêng.

Socket giáo viên vẫn cần cả JWT owner hợp lệ và credential phòng. SDK refresh chủ động gửi `teacher-auth`; mỗi lệnh kiểm lại quyền, actor và owner. Mỗi socket giáo viên đã attach có audit10 giây, kiểm expiration/mapping/provider/cutoff và ngắt khi không còn quyền; socket hết quyền không được xem thụ động vô hạn. Khoảng thu hồi luồng xem thụ động có thể tới10 giây cộng thời gian request/checkpoint; lệnh mới bị kiểm riêng. Audit không ngắt socket nếu JWT đã được refresh trong lúc chờ kiểm. Disconnect đi qua cơ chế pause/drain hiện có.

Học sinh không cần Supabase Auth: giữ QR/mã, studentId/playerId, secret độc lập, claim, chống tab trùng và reconnect. JWT giáo viên và token học sinh không thay thế nhau. Không đổi shared protocol, RaceModel, RaceScene, Room, cách chấm điểm/thưởng, RoomQueue hoặc quy tắc ACK sau commit.

## 5. Phân quyền và câu hỏi/lịch sử

API giữ owner checks ở lớp/học sinh/export/ảnh/history. Socket kiểm chủ phòng với configure/control/report/recover/release, không coi room code là quyền quản trị. Bộ câu hỏi hiện được soạn/import trên client và persist cùng room aggregate; không có API thư viện bộ đề toàn cục riêng để tự tạo lại trong giai đoạn Auth.

Schema `duaxe` tiếp tục private, ENABLE/FORCE RLS, không expose Data API/browser grants. `duaxe_runtime` có policy backend trải nhiều tenant, nên **RLS không tự tách tenant cho backend**. Runtime không được superuser/BYPASSRLS; không grant role đó cho anon/authenticated. Các kiểm tra owner ở Node vẫn bắt buộc, kể cả key Storage có service role.

## 6. Migration003

Không sửa checksum `001_storage.sql`, `002_cloud.sql` hoặc schema SQLite. File mới `003_auth_migration.sql` thêm:

| Bảng | Mục đích và quyền |
|---|---|
| teacher_auth_cutoffs | Auth UUID → valid_after theo iat; runtime SELECT/INSERT/UPDATE, RLS backend; không token rõ |
| auth_migration_batches | UUID batch, checksum manifest, trạng thái; operator only |
| auth_migration_items | teacherId/Auth UUID, email digest, trạng thái, owned/mapping_created, ý định gửi invite; operator only |

Journal không có password/hash/JWT/link email. Audit có email là dữ liệu cá nhân: chỉ xuất vào file mới0600 bên ngoài repository. Journal bị RLS/grants chặn với runtime. Adapter local/legacy vẫn chấp nhận schema1–3; cloud factory yêu cầu3, không auto migrate lúc boot. Importer cũ chỉ được bổ sung checksum các bảng mới để từ chối rollback bỏ mất hoạt động mới.

## 7. Công cụ chuyển tài khoản cũ — không dùng cho self-signup mới

Mặc định **offline plan, không kết nối**:

```sh
npm run cloud:auth-migration
npm run cloud:operator -- schema --auth-journal
```

Sau khi được người dùng phê duyệt từng thao tác, dừng writer và nạp secret riêng cho invocation operator: `DATABASE_URL` admin, `SUPABASE_AUTH_ADMIN_KEY`, `SUPABASE_URL`; chốt `CLOUD_TARGET=production`, `CLOUD_OPERATION_APPROVED=1`, `CLOUD_EXPECTED_DB_HOST`, `CLOUD_EXPECTED_DATABASE`, `CLOUD_EXPECTED_SUPABASE_URL`. Không đặt các cờ phê duyệt trên dịch vụ web. Cờ môi trường không thay thế phê duyệt của người dùng.

Schema apply riêng bằng `cloud:operator -- schema --auth-journal --apply`. Chỉ chạy sau backup/restore và duyệt target/SQL. Công cụ tài khoản không tự sửa schema.

Manifest0600, đường dẫn tuyệt đối ngoài repo, ví dụ cấu trúc (thay bằng ID đã được đối chiếu, không tự tạo ID mới):

```json
[
  {"teacherId":"<teacher UUID hiện có>"},
  {"teacherId":"<teacher UUID khác>","existingAuthUserId":"<Auth UUID đã kiểm>","ownershipVerified":true}
]
```

`existingAuthUserId` bắt buộc có xác nhận quyền sở hữu thủ công và email Auth đã verified. Boolean là xác nhận của operator, không phải bằng chứng tự động; giữ hồ sơ phê duyệt riêng. Không tự link một tài khoản chỉ vì email giống.

Thứ tự, sau phê duyệt (đây là hướng dẫn, **chưa chạy remote**):

```sh
npm run cloud:auth-migration -- audit --dry-run --report /private/audit.json
npm run cloud:auth-migration -- prepare --manifest /private/teachers.json --batch <UUID> --dry-run
npm run cloud:auth-migration -- prepare --manifest /private/teachers.json --batch <UUID> --apply
# Phê duyệt gửi email riêng, CLOUD_AUTH_REDIRECT_URL phải là URL chính xác bên dưới.
npm run cloud:auth-migration -- invite --manifest /private/teachers.json --batch <UUID> --apply
# Chờ người nhận xác minh email, duyệt mapping; người nhận hoàn tất đặt mật khẩu/đăng xuất sau khi đã liên kết.
npm run cloud:auth-migration -- finalize --manifest /private/teachers.json --batch <UUID> --dry-run
npm run cloud:auth-migration -- finalize --manifest /private/teachers.json --batch <UUID> --apply
```

Prepare commit intent trước Admin create, gắn marker `app_metadata.duaxe_batch/duaxe_teacher` chỉ admin được sửa. Crash sau remote create nhưng trước lưu UUID: retry inventory chỉ nhận đúng marker+email, không create lại hay ghép theo email. Không gắn quyền cho user mới trước finalize/email confirmation. Manifest/checksum/email drift hoặc mapping disabled/conflict bị từ chối.

SQL giữ transaction, synchronous_commit và advisory writer lock; không giữ SQL transaction mở khi chờ Auth HTTP. Các tác vụ cùng batch được tuần tự hóa. Prepare/finalize chạy lại được; kết quả log chỉ tổng success/failed/skipped. Lỗi transaction/commit cần đối chiếu journal, không xóa Auth user để che mất phản hồi.

Invite commit cờ requested trước HTTP: tối đa một lần gửi tự động. Nếu SMTP/response bị mất, lần chạy lại bỏ qua thay vì spam. Cần kiểm tra Auth/SMTP và xử lý thủ công hoặc để giáo viên dùng Quên mật khẩu; công cụ không chứng minh email đã giao/đã đọc. Không tự đánh dấu email verified.

## 8. Private Storage

Tái sử dụng private bucket/immutable object adapter đã có. Backend kiểm owner trước read/write; upload cloud kiểm MIME header và Sharp kiểm bytes thật, JPG/PNG/WebP tĩnh,2MB/16Mpixel, resize128 WebP và bỏ metadata. Legacy giữ hợp đồng upload cũ và vẫn kiểm bytes bằng Sharp. Không public URL vĩnh viễn; API Bearer → blob, revoke blob khi đổi/unmount; socket cấp ảnh theo scope đã có, không serialize ảnh vào report/export.

Nhập mã đơn thuần chỉ preview metadata/placeholder; QR cần invite hợp lệ để preview ảnh. Sau claim/resume chỉ nhận ảnh của mình; teacher owner nhận roster. Người ngoài biết mã vẫn có thể chọn một hồ sơ chưa claim theo UX cũ: đây **không phải xác minh danh tính học sinh**, cần giáo viên giám sát và quy định không phát QR ra ngoài lớp. Không đổi quy tắc join/reconnect trong giai đoạn này.

Avatar bytes trong phiên không phụ thuộc signed URL hết hạn; không thêm cơ chế refresh URL mỗi frame. Upload SQL và Storage không cùng atomic transaction; cơ chế compensation/orphan review từ giai đoạn trước giữ nguyên. Chưa chuyển ảnh thật. Template `ops/supabase-private-storage.sql` chưa áp dụng remote.

## 9. SMTP, redirect và cấu hình

Tên miền mặc định trước. Thay `<app>` bằng tên Pages thực tế đã được duyệt; không dùng tên giả của test trong production.

| Nơi | Cấu hình cần chuẩn bị |
|---|---|
| Pages build | VITE_AUTH_DRIVER=supabase; VITE_SUPABASE_URL; VITE_SUPABASE_PUBLISHABLE_KEY public/anon; VITE_SERVER_URL trống; VITE_PUBLIC_APP_URL HTTPS Pages |
| Render | STORAGE_DRIVER=postgres, TEACHER_AUTH_DRIVER=supabase, AVATAR_STORAGE_DRIVER=supabase; DATABASE_URL runtime hạn quyền/TLS verify-full; SUPABASE_URL; SUPABASE_STORAGE_KEY server-only; CORS_ORIGINS exact Pages; gateway key; PRODUCTION_ACCESS_MODE=closed |
| Pages Functions | ACCESS_MODE=closed ban đầu; BACKEND_URL Render HTTPS; BACKEND_GATEWAY_KEY secret; SUPABASE_PUBLIC_ORIGIN; pilot Access team/AUD |
| Supabase Auth Site URL | `https://<app>.pages.dev/` |
| Supabase Redirect URLs | **Chính xác** `https://<app>.pages.dev/?mode=teacher&auth=recovery&fresh=1`; không wildcard/preview/localhost trong project production |
| Operator invite | CLOUD_AUTH_REDIRECT_URL bằng chính URL redirect đã duyệt; admin key/target guards chỉ dùng tạm cho lệnh được duyệt |

Custom SMTP: chọn nhà cung cấp và sender hợp lệ, xác minh domain gửi với SPF/DKIM/DMARC; nhập SMTP password trong Supabase Dashboard bảo mật, không chat/git. Kiểm template recovery/invite dùng ConfirmationURL/redirect của provider, không log link. Theo chính sách mới, bật Allow new users to sign up và bật Confirm email; không import scrypt hoặc tự verified email. Cấu hình password policy12+ và Auth rate limits theo năng lực SMTP/nhà trường; kiểm brute force/429 và recovery cooldown trên domain thật. HTTP login legacy vẫn có limiter cũ; browser Supabase Auth phải dựa thêm limiter của provider. Chưa có CAPTCHA/MFA challenge UI giáo viên, chưa cấu hình SMTP/rate limits trên project.

Môi trường hiện báo SUPABASE_URL, DATABASE_URL và HTTP secret SUPABASE_STORAGE_KEY ready; điều này không chứng minh đúng DB role, schema, SMTP hoặc quyền Admin. URL là biến thường; Storage key là HTTP secret theo domain Supabase của môi trường công cụ. DATABASE_URL dùng secret môi trường PostgreSQL/TCP, không HTTP secret. Render/Pages cần cấu hình riêng, không tự thừa hưởng secret của cuộc trò chuyện. Không dùng VITE_ cho bất kỳ server/admin/database/gateway secret nào.

## 10. Kiểm thử và số đo của phiên 9B.2 trước self-signup (lịch sử)

Baseline trước sửa: **81/81 pass**,0 skip/fail. Bản mới: **88/88 pass**,0 skip/fail trên PostgreSQL17 local, Node24.22.1. TypeScript và build React/Vite + backend/CLI đạt; cảnh báo chunk Phaser lớn vẫn còn, không thay engine/đồ họa để giấu cảnh báo.

Đã build cả chế độ mặc định và `build:pages` với URL/publishable key **giả lập** để kiểm tra nhánh Auth cloud và guard. `dist` từ lượt kiểm tra này không phải artifact production đã cấu hình cho project thật. Đối chiếu bundle không thấy các tên biến server/admin/database/gateway; không thay thế kiểm tra secret của release thực trước deploy.

| Nhóm | Kết quả |
|---|---|
| JWT | Signature/issuer/audience/expiry/role/anonymous; mapping enabled; banned/unverified/deleted/outage: đạt local |
| Phiên | Login đúng/sai, PKCE reset, password policy, reload/refresh, logout, signout hai tab, invalid callback: Chromium đạt với SDK thật/Auth giả lập |
| Thu hồi | Password reset cutoff chặn JWT của nhiều session, giữ qua restart, không ảnh hưởng teacher khác; logout session digest: đạt |
| Socket | Teacher JWT hết hạn bị ngắt xem thụ động; refresh giữ owner; student token không gọi được API quản trị: đạt |
| Tenant/Storage | Không đọc/sửa lớp B, không ảnh/history/room của B; MIME/corrupt/oversize upload; private scope: đạt local |
| Migration | Dry-run không ghi, retry mất phản hồi create, duplicate email, chưa verified, transaction lỗi rollback, finalize idempotent, rollback không xóa teacher/class/student/history/Auth user: đạt |
| CLI thật | Offline default, approval/exact-project guard, audit0600 không hash, create/retry/invite/finalize/rollback qua HTTPS emulator và PG local: đạt |
| RLS | Runtime không đọc/ghi journal; untrusted mapping/default deny và restrictive Storage policy trên PostgreSQL local: đạt; chưa hosted Data API |
| Multiplayer |20 student/20 avatar/20 ACK, đồng thời và trùng đáp án, offline22s, resume/history, mobile không Phaser: Chromium và integration đạt |
| Crash compiled runtime | SIGTERM/INT/KILL với cloud factory/schema003, PG local + HTTPS Auth/Storage emulator, TLS verification bật: đạt cả3; mỗi lượt20 ACK/20 avatar, paused và không thưởng trùng |

SIGKILL lùi **29,16m** ở lượt này; SIGTERM/INT0m. Đây là tiến độ vật lý chưa checkpoint, không phải mất đáp án đã ACK và không phải giới hạn tối đa cho mọi crash.

Lượt Chromium20 xe đo8 giây sau reconnect, viewport1500×1100, Vite/headless + PostgreSQL loopback,1 teacher browser +1 phone viewport +19 bot, dữ liệu giả:

| Chỉ số | Đo thực tế |
|---|---:|
| RAF FPS / frame P95 |20,17 /66,70ms |
| RTT đáp án median / P95 |252,42 /493,08ms;19 mẫu |
| Node RSS (gồm Vite/emulator/server/bots) |454,60MiB; không gồm toàn bộ Chromium/PostgreSQL |
| Socket payload gửi trong cửa sổ xem |2.175.894 byte/giây, tổng server, không gồm TLS/TCP |
| Avatar bindings / avatar texture |20 /20 |

Không phải20 điện thoại thật, không phải Supabase Internet RTT, không phải đo trước/sau có đối chứng. Số FPS thấp hơn các lượt lịch sử ở tài liệu trước; chưa xác định nguyên nhân bằng phép đo A/B cùng môi trường, không quy cho Auth hoặc tuyên bố tối ưu hiệu năng. Không đạt55–60FPS hay mục tiêu P95 dưới150ms trong lượt này. Chưa có P99 đáng tin với19 mẫu hoặc soak45–60 phút.

Bằng chứng: `benchmarks/auth-production/{browser,operator}.json`, `race/browser.json`, `race/cloud-race.png`, `signals/cloud-signals.json`, `source-check.json`, `validation.json`. Các JSON chỉ chứa số đo và dữ liệu giả; log test riêng trong `/tmp/duaxe-auth-*.log`. Không ghi đè các benchmark lịch sử.

## 11. Những gì đã/chưa kiểm trên Supabase thật

Đã thực hiện đúng **một đọc metadata công khai**: JWKS trả1 khóa ES256; không cần password/token và không thay đổi project. Không gọi đây là test đăng nhập Auth.

Chưa chạy trên dịch vụ thật: tạo/login giáo viên giả, refresh/recovery/invite/email delivery, Admin status permissions, SMTP, private Storage upload/read/policies, DB schema/role/TLS transaction, migration, Cloudflare Access/HTTPS/WSS, Render restart hoặc20 thiết bị. Đây là các acceptance test **chưa thực hiện**, dù unit runner có0 skip. Không dùng production để thử tự động khi chưa duyệt. Không khai báo sẵn sàng lớp thật.

## 12. Backup, cutover và rollback

1. Kết thúc buổi đang chơi, chặn admission, pause/drain và dừng writer. Không auto resume sau restart hoặc chuyển origin.
2. Backup SQLite + ảnh bằng CLI hiện hữu theo CLASSROOMS.md, xử lý WAL nhất quán; không xóa lock/WAL/SHM. Công cụ migration dữ liệu chỉ nhận bản copy đã xác nhận, không mở/sửa nguồn trong phiên này.
3. Backup PostgreSQL/schema/grants/RLS và private object bytes/manifest; có kế hoạch backup/restore Supabase Auth/config, không coi pg_dump schema duaxe là toàn bộ project/Auth/Storage. Khôi phục bản sao isolated và so ID/count/ảnh/answer/cutoff trước approve. Test schema2 restore ở giai đoạn trước không tự chứng minh disaster recovery hosted schema3.
4. Duyệt schema003, migration dữ liệu copy, audit và manifest tài khoản; không có dual-write local/cloud. Một Render instance hoạt động; advisory lock/fence vẫn bắt buộc vì rolling deploy có thể chồng old/new. Thực hiện maintenance/stop-before-start theo PRODUCTION_IMPLEMENTATION.md; không bỏ lock để deploy qua.
5. Trong pilot chỉ quản trị viên và dữ liệu giả qua Access. Duyệt riêng tạo Auth user giả/gửi email giả/apply SQL/upload; kiểm link thực, RLS,20 client, restart, reconnect, exports và không ACK trước commit. Chưa thực hiện các bước đó remote.
6. Duyệt chuyển tài khoản thật, xác minh email rồi finalize mapping. Tài khoản cũ/nguồn được giữ; cloud chỉ dùng Supabase, không chạy cookie login song song. Phê duyệt này dành cho migration dữ liệu cũ, không phải duyệt từng giáo viên đăng ký mới. Không bật legacy fallback để vượt một lỗi quyền.
7. Chỉ cân nhắc live sau20 điện thoại thật trên Wi-Fi, soak, privacy/backup/retention phê duyệt và khắc phục chỉ số chậm.

Rollback batch Auth đã apply, sau phê duyệt:

```sh
npm run cloud:auth-migration -- rollback --manifest /private/teachers.json --batch <UUID> --dry-run
npm run cloud:auth-migration -- rollback --manifest /private/teachers.json --batch <UUID> --apply
```

Chỉ disable mapping do batch tạo, giữ accounts/profiles/ảnh/history/journal/cutoff; preexisting mapping không bị tắt. Không tự xóa Auth users, không tự reset password/verified flag, không bỏ cutoff. Batch rolled_back không tự activate lại; cần review/batch mới và xử lý mapping disabled riêng, không sửa journal mù.

Rollback release phải dùng artifact cloud hỗ trợ schema003 và cơ chế thu hồi; không drop migration hoặc chạy lại artifact không hiểu cutoff. Nếu muốn trở lại SQLite, cần reconcile mọi dữ liệu cloud phát sinh trước; SQLite cũ không tự nhận kết quả mới. Restore database cũ có thể làm sống lại session đã revoked: phải review/thu hồi lại trước khi phục vụ, không mở ngay sau restore. Supabase Auth và SQL không chung transaction; reconcile journal/markers trước mọi retry/rollback.

## 13. File thay đổi và điều kiện nghiệm thu

| Nhóm | File |
|---|---|
| Auth server | `server/cloud/TeacherAuth.ts`, mới `AuthUserStatus.ts`, `AuthAdmin.ts`, `TeacherMigration.ts` |
| Auth/API/Socket | `server/classroom/api.ts`, `server/app.ts`, `server/storage/contracts.ts`, `factory.ts` |
| Schema/compatibility | mới `server/storage/postgres/migrations/003_auth_migration.sql`; `migrate.ts`, `Database.ts` chỉ chấp nhận version3 thêm; `importer.ts` checksum bảng mới |
| Frontend | `src/classroom/auth.ts`, mới `TeacherLogin.tsx`, `ClassroomPanel.tsx`, `src/online/useRoom.ts` chỉ plumbing Auth |
| Operator/config | mới `scripts/cloud/auth-migration.ts`; `operator.ts`, `preflight.ts`, `.env.example`, `package.json` |
| Tests/harness | mới `tests/auth-migration.test.ts`, `auth-socket.test.ts`, `scripts/cloud/auth-browser.ts`, `auth-operator-smoke.ts`; `tests/helpers/supabase.ts`, `cloud-integration.test.ts`, `scripts/cloud/browser.ts`, `persistence.ts` |
| Tài liệu/bằng chứng | báo cáo này, README/PRODUCTION_IMPLEMENTATION trỏ báo cáo mới, `benchmarks/auth-production/` |

Danh sách chính xác theo SHA-256 so với đầu phiên nằm trong `source-check.json`; Git toàn bộ source đang untracked từ đầu, không coi `git diff` trống là không có thay đổi. Không add/commit/push.

- [x] Code Auth và recovery chạy trong kiểm thử local, giữ ID/lớp/học sinh/history; tenant checks/Socket/reconnect/transaction/ACK đạt.
- [x] RaceModel/RaceScene/Room/RoomQueue/shared protocol, CSS và migrations SQLite/PG001–002 giữ nguyên theo đối chiếu nguồn.
- [ ] Duyệt và thực hiện backup/restore + SQL003 trên project thật.
- [ ] Cấu hình domain thực, custom SMTP, confirmation/signup/password/rate limits và redirect exact; xác minh server-key/Admin read permission.
- [ ] Duyệt deploy bản **đóng** Pages/Render và dữ liệu giả trước khi gọi acceptance tests production.
- [ ] Đạt nghiệm thu cloud Auth/Storage/RLS/WSS/restart/20 client, giải quyết FPS/RTT và20 điện thoại thật.
- [ ] Phê duyệt riêng import tài khoản thật, chuyển ảnh thật, DNS/publish và mở public access.

**Kết luận phạm vi:** code9B.2 và bộ kiểm thử local đã hoàn thiện theo các kết quả ghi trên; cấu hình/acceptance cloud và mở production còn chưa hoàn thành. Dừng trước tất cả thao tác production cần phê duyệt.

## Signup feedback repair — 2026-11-10

The production screenshot confirms the game socket is connected, but does not show
an Auth signup response. Anonymous `/api/me` 401 is not evidence of signup failure;
Turnstile iframe console warnings alone do not identify the failing request.

- TeacherLogin now focuses and scrolls feedback into view above the form, and shows
  password requirements directly below the password field (12–200, upper/lower/digit).
- Supabase signup errors map to fixed CAPTCHA, SMTP recipient restriction, rate-limit,
  disabled-signup, weak-password, network and provider-outage hints. Raw provider
  details are not displayed; duplicate-email outcomes remain generic.
- ClassroomPanel skips `/me` when cloud Auth has no session; authenticated requests
  still require backend authorization. No changes to confirmation or profile ownership.
- Browser regression: `node --import tsx scripts/cloud/signup-feedback-browser.ts`.
  Real React/Supabase SDK/Chromium with mocked providers, no database/email writes:
  invalid/mismatched passwords, missing CAPTCHA, CAPTCHA failure, SMTP restriction,
  rate limits, provider error, confirmation notice, focus/visibility, anonymous `/me`.
- Validation: TypeScript and frontend/backend build pass; full test suite 78 pass,
  31 skip, 0 fail (PostgreSQL test database unavailable). Browser regression passes.
- Not verified: real signup, SMTP delivery and email confirmation on production.
  Need the displayed submit error or sanitized Auth request status/code to identify
  the remaining hosted configuration blocker. Do not disable CAPTCHA/email confirmation
  or widen CSP based solely on third-party iframe warnings.
