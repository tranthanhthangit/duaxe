# Giai đoạn 9B.1 — PostgreSQL adapter và migration

Ngày 06/11/2026 (UTC+7). Đã triển khai adapter và kiểm thử với **PostgreSQL 17 local trong Docker**, Node 24.22.1 và Chromium headless. Không có cấu hình Supabase staging được cung cấp; chưa kết nối Supabase, triển khai Render/Cloudflare hoặc thực hiện migration production. Không chuyển sang 9B.2.

## Khảo sát và phạm vi bảo toàn

Đã đọc ASYNC_STORAGE_MIGRATION.md, CLOUD_MIGRATION_PLAN.md, DEPLOY_CLOUDFLARE_RENDER_SUPABASE.md, CLASSROOM_READINESS.md; interfaces 9A, SQLite Store/migrations 1–2/SessionStore/ProcessLock, API/CLI, RoomQueue, Room, app, auth/reconnect/avatar/history, frontend và các test/script liên quan. Trước sửa, **57/57 test đạt**. Git vẫn chưa có commit; file đều untracked. Không xóa untracked, add, commit hoặc publish.

Đối chiếu SHA-256 với bản nguồn đầu phiên: toàn bộ `src/`, `shared/`, `Room.ts`, `RaceModel`, `RaceScene`, cấu hình/luật đua, SQLite Store/migrations, ProcessLock, SQLiteStorage, SessionStore, API/CLI và RoomQueue giữ nguyên bytes. Bằng chứng: `benchmarks/postgres/source-check.json`. Không mở database SQLite/ảnh thật để chạy thử; mọi fixture là dữ liệu giả trong thư mục tạm. Không có dual-write.

## Kiến trúc

`createStorage()` chọn `STORAGE_DRIVER=sqlite|postgres`; mặc định SQLite. PostgreSQL thiếu cấu hình/role/schema/lock sẽ dừng khởi động, không âm thầm chuyển về SQLite. Backend tiếp tục dùng cùng interfaces Promise 9A; UI/protocol không đổi.

`PERSISTENCE_BACKEND=postgres` trong tài liệu deploy giai đoạn thiết kế trước là tên đề xuất cũ; biến đã triển khai thực tế ở 9B.1 là **STORAGE_DRIVER**, không dùng cả hai.

- `PostgresStorage`: teachers, classrooms, avatars, rooms/history tương thích interface hiện tại. SQL qua driver `pg`; file I/O qua `fs/promises`, scrypt qua async crypto, Sharp async.
- `PostgresDatabase`: pool giới hạn 4 connection mặc định, cộng **1 connection riêng** giữ quyền writer. Một transaction luôn dùng một PoolClient; giải phóng trong `finally`, connection lỗi bị hủy.
- Mỗi transaction bật `synchronous_commit=on`. Connection timeout 2 s, statement 3 s, lock 1 s, query 5 s, idle transaction 10 s; các biến cấu hình ở `.env.example`. Timeout/release/pool exhaustion được kiểm thử với database thật.
- Mẫu latency giữ tối đa 2.048 phần tử/nhóm, chỉ thống kê số; không log SQL, bind values, URL, token, email hoặc dữ liệu học sinh.
- Schema migration là thao tác operator riêng, runtime chỉ kiểm version. Auth giáo viên vẫn salted scrypt + cookie SHA-256 phiên 12 giờ như hiện tại; chưa dùng Supabase Auth.

## Schema và khác biệt SQLite/PostgreSQL

SQL: `server/storage/postgres/migrations/001_storage.sql`, yêu cầu PostgreSQL **15+** (dùng `ON DELETE SET NULL (avatar_id)`). `schema_migrations` lưu version/checksum SQL; chạy lại chỉ chấp nhận cùng checksum. Không sửa `PRAGMA user_version=2` hoặc SQL SQLite.

| Dữ liệu | SQLite hiện tại → PostgreSQL |
|---|---|
| Teacher/class/student/avatar/player ID | TEXT UUID → UUID, giữ nguyên giá trị, không phát ID thay thế |
| Room/history ID | Mã phòng `code` 6 ký tự là PK có sẵn; không tạo room UUID mới |
| Question ID | TEXT có thể là `sun`, `legs`; PK `(room_code, question_id)` trong snapshot bộ đề |
| Answer ID | Nguồn không có UUID độc lập; giữ khóa `(room_code, player_id, question_id)` |
| Receipt | Tách từ checkpoint JSON sang `command_receipts`, PK `(room, role, actor, command)`; vẫn lưu trong checkpoint để reconnect tương thích |
| Phiên | Session token SHA-256 và player/teacher credential digest giữ nguyên; không import token rõ |
| Thời gian hồ sơ | ISO TEXT → `timestamptz`, trả ISO UTC như API cũ |
| Thời gian game/session | INTEGER epoch milliseconds → BIGINT, chuyển về JS number có kiểm soát tại mapper |
| Checkpoint/state/report/result | JSON TEXT → JSONB, đối chiếu canonical JSON, không so sánh thứ tự khóa |
| Boolean | JSON boolean giữ nguyên; `local_owned` metadata dùng PostgreSQL boolean |
| Transaction/upsert | `BEGIN IMMEDIATE` → READ COMMITTED + advisory/row lock + sequence guard, `ON CONFLICT` có kiểm tra nội dung trước |
| Foreign key | Bổ sung composite FK owner cho lớp/avatar của học sinh; lịch sử classId/studentId vẫn là snapshot, cố ý không FK tới hồ sơ sống |

Các bảng:

- `teachers`, `sessions`, `classes`, `students`, `avatars`: dữ liệu hồ sơ, owner, hash/session và metadata file. UNIQUE email/storage_key; indexes classes_owner/students_class. Học sinh chỉ tham chiếu lớp/avatar cùng owner bằng composite FK.
- `race_sessions`: code, owner/class snapshot, status, các mốc thời gian, checkpoint_version=1, sequence, checkpoint, report, error. Index `(owner_id, created_at DESC)` cho lịch sử.
- `room_questions`: snapshot câu hỏi, position và nội dung; UNIQUE `(room, position)`.
- `race_players`: digest/state, PK phòng/player, UNIQUE phòng/student để chống claim hồ sơ trùng; NULL studentId cho chế độ nhập tên vẫn hợp lệ.
- `race_answers`: PK phòng/player/question và FK tới player/question cùng phòng; đây là constraint chống lưu đáp án hai lần.
- `command_receipts`: signature và kết quả, unique idempotency key theo actor/phòng.
- `runtime_owner`: một hàng singleton owner/epoch để fencing writer.
- `migration_batches`, `migration_items`: batch UUID, checksum nguồn/hàng/đích, danh sách hàng được thêm, trạng thái rollback.

Thêm học sinh/lớp vẫn sinh UUID như cũ; migration không sinh lại ID. `class_id`/`student_id` lịch sử được giữ cả khi lớp/học sinh đã bị xóa ở SQLite. Các FK dùng cho dữ liệu sống vẫn kiểm tra chặt chẽ; nguồn sai UUID, FK, JSON, NUL, checkpoint hoặc checksum làm dry-run thất bại thay vì tự sửa/xóa dữ liệu.

## Transaction đáp án, ACK và retry

Luồng 9A giữ nguyên: xác thực phiên/quyền → queue phòng → kiểm receipt/câu hỏi/thời hạn → fork Room → chấm/thưởng trên candidate → lưu aggregate → commit → adopt/publish → ACK thành công. Không gọi HTTP, chờ người dùng, xử lý ảnh hoặc scrypt trong transaction đáp án.

Trong cùng PoolClient/transaction PostgreSQL:

1. Kiểm owner/epoch và dedicated advisory lock còn hiệu lực.
2. Advisory xact lock theo mã phòng, rồi `SELECT race_sessions ... FOR UPDATE`; lock vẫn bảo vệ lần tạo phòng chưa có row.
3. Từ chối sequence bằng/thấp hơn bản đã commit; không cho đổi owner/class hoặc đổi bộ đề đã bắt đầu.
4. Kiểm mọi đáp án đã ghi còn nguyên trong candidate; một checkpoint mới hơn cũng không được xóa/đổi đáp án cũ.
5. Kiểm receipt signature/data, upsert session/checkpoint/report, player state; insert answer và receipt với khóa unique. Dùng JSONB bulk writes, không chạy một SQL insert cho từng xe.
6. COMMIT với synchronous_commit, rồi mới công bố state/ACK theo contract 9A.

Lỗi trước commit rollback, không adopt candidate, không ACK thành công và khóa thao tác/pause như 9A. Mất phản hồi COMMIT được coi là **outcome chưa rõ**; không tự retry mutation. Sau restart, đọc checkpoint/receipt đã commit rồi retry cùng commandId để nhận kết quả cũ. Test fault injection thực hiện commit thật rồi làm mất phản hồi ở boundary adapter; chưa cắt packet TCP đúng lúc COMMIT trên Supabase.

Checkpoint vẫn giữ cửa sổ **128 receipt/actor** như trước. PostgreSQL lưu thêm archive receipt độc lập; nếu một commandId đã evict bị gửi lại, ghi bị từ chối thay vì áp dụng lần nữa. Đây là fail-closed, chưa phải API replay vô hạn; có thể cần restart sau lỗi quá cũ. Answer/quiz vẫn chống thưởng lại cùng câu với commandId mới. Archive có thể tăng kích thước theo buổi; xóa lịch sử hợp lệ cascade archive. Chưa có retention riêng cho archive.

## Một writer và restart

Dedicated connection lấy session advisory lock `(924,901)` cho toàn database; writer thứ hai bị từ chối startup. Sau khi giữ lock, tăng `runtime_owner.epoch`. Mỗi transaction lấy `FOR SHARE` hàng owner và kiểm owner/epoch cùng PID/lock thực trong `pg_locks`; writer mới không thể vượt transaction cũ chưa kết thúc. Mất connection riêng làm health503, pause và khóa thao tác ngay; tiến trình cũ không thể ghi snapshot mới dù sequence cao.

Đây là **một instance cho một database**, chủ ý mạnh hơn lock từng phòng. Không có horizontal scaling/failover tự động hoặc rolling deploy không gián đoạn: dừng/drain instance cũ trước khi cho instance mới nhận writer. Readiness thất bại của instance mới không nên được giải quyết bằng xóa lock/epoch hoặc chạy nhiều writer.

Phải dùng **direct PostgreSQL hoặc session pooler** có session ổn định. Transaction pooler không phù hợp session advisory lock; config từ chối cổng Supabase transaction pooler 6543. Pooler trên cổng khác vẫn cần operator xác minh mode. Pool mặc định cần tối đa 5 connection/backend, ngoài migration/test.

Checkpoint mục tiêu khoảng 1 Hz/coalesce khi rảnh; lệnh quan trọng lưu ngay. Không ghi vị trí mỗi frame. Recovery dùng Room.restore hiện tại: running → paused, ready vẫn ready, bỏ socket online cũ, giữ playerId/studentId/avatar/quiz/điểm/boost/digest, giáo viên xác nhận tiếp tục. Hết hạn/corrupt theo quy tắc cũ; I/O lỗi không bị gán nhầm thành hàng loạt record corrupt.

Compiled process, 20 client mỗi trường hợp, đủ 20 đáp án đã ACK và replay không thưởng trùng:

| Tín hiệu | Trạng thái sau restart | Quãng đường lùi quan sát |
|---|---|---:|
| SIGTERM | paused | 0 m |
| SIGINT | paused | 0 m |
| SIGKILL | paused | **30,53 m** |

Baseline 9A SIGKILL là 29,88 m. Chênh lệch do thời điểm crash/checkpoint; không khẳng định đây là giới hạn tối đa hay zero rollback. Đáp án/điểm đã ACK không mất trong các lượt thử; phần simulation chưa checkpoint có thể lùi. Không chạy bù thời gian server tắt. Mẫu này kill **Node process**, chưa kill PostgreSQL host hoặc kiểm thử mất điện/replication/failover cloud.

## Phân quyền, RLS và avatar

Schema private `duaxe`, revoke PUBLIC; bảng dữ liệu bật ENABLE/FORCE RLS. `duaxe_runtime` là role NOLOGIN/NOSUPERUSER/NOBYPASSRLS; operator cấp membership cho login backend riêng. Runtime từ chối login superuser/BYPASSRLS hoặc không thuộc role này. Migration cần credential quản trị tách riêng, không dùng làm runtime.

Policy runtime hiện **cho backend truy cập toàn bộ tenant**; backend phải kiểm owner ở từng repository và API. Không coi direct SQL/service-role tự có tenant isolation. Test hai giáo viên không đọc/sửa lớp, học sinh hoặc ảnh của nhau; role SQL thử nghiệm không có policy thấy 0 rows ngay cả khi được grant SELECT. Đây chưa phải kiểm thử `anon`/`authenticated` thực của Supabase, JWT Auth hoặc student RLS. Không expose schema này vào Data API/browser; không cấp duaxe_runtime cho browser role.

`DATABASE_URL` chỉ ở server/operator, không có `VITE_`. PostgreSQL từ xa xác minh TLS/chứng chỉ/hostname (`rejectUnauthorized=true`), không cho disable từ xa. URL `sslmode=require` không được phép làm giảm xác minh. Có thể cấp CA bằng `PG_SSL_CA_FILE`; không log URL hoặc raw database errors.

Ảnh **chưa chuyển sang Supabase Storage**. Metadata `storage_key` giữ nguyên; imported `local_owned=false`, GC không unlink ảnh nguồn. PostgreSQL dùng `PG_AVATAR_DIR` là **bản sao riêng**, từ chối dùng chung path ảnh SQLite (kể cả alias symlink đã tồn tại). File mới trong bản sao có thể được GC khi không còn tham chiếu hồ sơ/phòng. I/O file không nằm trong SQL transaction; commit upload chưa rõ outcome giữ file, có thể để lại orphan an toàn thay vì xóa ảnh đã commit. Thiếu file dùng placeholder theo recovery cũ.

Upload vẫn owner check, tối đa 2 MB/16M pixel, JPG/PNG/WebP tĩnh → WebP128, private file, không URL công khai. History/report/CSV không chứa ảnh Base64. Không tự copy/upload ảnh thật. Render Free chưa thể dùng đường ảnh local này như lưu trữ lâu dài; đó là việc của 9B.2.

## Công cụ migration và rollback staging

Chuẩn bị một **bản backup SQLite nhất quán** bằng CLI backup/verify hiện tại (sao chép WAL an toàn theo hướng dẫn CLASSROOMS.md). Không chỉ copy file DB đang ghi. Dùng bản backup riêng, không dùng đường SQLite gốc. CLI migration mở readOnly, chặn source trùng realpath/inode database gốc, từ chối WAL chưa checkpoint, kiểm integrity/FK, schema1/2 và SHA-256 trước/sau. Không tự mở SQLite gốc để VACUUM hoặc đổi schema.

Trước thao tác, dừng backend **staging**, xác minh project/database đích và backup đích. Nạp credential bằng secret manager/shell riêng, không gõ URL/mật khẩu vào command arguments/history hoặc `.env` được commit. CLI bắt buộc `PG_MIGRATION_TARGET=staging` + tên database allowlist; đây là chốt thao tác, không tự nhận diện project production. Nhiều Supabase project đều có database tên `postgres`, nên operator vẫn phải kiểm hostname/project.

```sh
# DATABASE_URL: credential quản trị của PostgreSQL STAGING, được nạp riêng.
export PG_MIGRATION_TARGET=staging
export PG_MIGRATION_DATABASE_NAME=ten_database_staging
export PG_SSL_MODE=verify-full
npm run postgres:migrate -- schema

# Dùng cùng BATCH_ID (UUID) cho dry-run, apply, retry và rollback.
# SQLITE_COPY là bản backup/copy đã verify, không phải DB gốc.
npm run postgres:migrate -- import --source "$SQLITE_COPY" --source-is-copy --batch "$BATCH_ID"
npm run postgres:migrate -- import --source "$SQLITE_COPY" --source-is-copy --batch "$BATCH_ID" --apply
npm run postgres:migrate -- rollback --batch "$BATCH_ID"
```

Dry-run thực hiện INSERT/constraint/đối chiếu trong transaction rồi ROLLBACK; yêu cầu quyền ghi ở **test/staging** dù không để lại dữ liệu. Apply import theo thứ tự teacher → session → class → avatar → student → room → question → player → answer → receipt. Mỗi hàng được kiểm key/checksum canonical; đối chiếu tất cả hàng nguồn với đích, trả counts nguồn/đích. Đích khác nội dung cùng ID thì từ chối, không overwrite. Giữ session hash và password hash để Auth cũ tiếp tục hoạt động. Không tự import token rõ/ảnh.

Batch UUID + checksum nguồn cho phép chạy lại an toàn. Sau mất phản hồi COMMIT, kiểm batch bằng cùng lệnh/nguồn, không đổi batch và giả định rollback đã xong. Thông báo lỗi không chứa bind values/URL; toàn bộ transaction được yêu cầu rollback, nhưng không tuyên bố rollback thành công nếu connection mất.

Rollback chỉ xóa hàng do batch thêm, theo thứ tự ngược, trong một transaction. Chỉ chấp nhận khi checksum **toàn bộ tập dữ liệu đích** chưa thay đổi từ lúc import; đã chơi/thêm dữ liệu thì từ chối để tránh cascade mất dữ liệu mới. Không xóa schema, SQLite hoặc ảnh; batch được đánh dấu rolled_back. Muốn import lại batch đã rollback cần batch UUID mới. Không chạy importer/rollback khi writer đang giữ lock. Nên dùng database staging trống riêng; import lớn hiện đọc/checksum toàn bộ vào RAM, chưa có streaming/resume theo chunk.

Đã kiểm thử local:

- SQLite schema1 và schema2; dry-run không để lại hàng, apply/rerun/verify/rollback.
- Bảo toàn teacher/class/student/player/code/question/answer/receipt/hash; dữ liệu/JSON/timestamp và hành vi API so với SQLite.
- Lịch sử orphan class/student được giữ, target đã đổi bị từ chối rollback.
- CLI operator thực chạy schema hai lần + dry-run/apply/idempotent retry/rollback, nguồn checksum không đổi. Fixture nhỏ gồm 1 teacher/session/class/student/avatar/room/player/answer, 3 question; test riêng kiểm import receipt.
- Bằng chứng đếm hàng CLI: `benchmarks/postgres/migration-cli.json`. **Không phải migration dữ liệu lớp thật hoặc Supabase staging**.

## Cấu hình chạy backend thử nghiệm

Sau khi schema/import đã verify và chuyển sang login runtime riêng (GRANT `duaxe_runtime` từ operator, NOSUPERUSER/NOBYPASSRLS), cấu hình server:

Ví dụ operator tạo login tối thiểu bằng psql trên **staging**:

```sql
CREATE ROLE duaxe_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT duaxe_runtime TO duaxe_app;
```

Đặt mật khẩu bằng lệnh psql tương tác `\password duaxe_app`, hoặc cơ chế secret của nhà cung cấp; không ghi mật khẩu vào migration/source. Kiểm quyền tạo/grant role của project Supabase staging thực tế trước khi chạy; chưa xác minh các quyền này trên Supabase trong phiên này. Không grant role cho anon/authenticated.

```sh
export STORAGE_DRIVER=postgres
# DATABASE_URL: login runtime riêng; không dùng credential quản trị phía trên.
export PG_POOL_MAX=4
export PG_SSL_MODE=verify-full
export PG_AVATAR_DIR=/duong-dan-private-ban-sao-anh
npm ci
npm run build
npm run server:start
```

Ứng dụng tiếp tục listen `process.env.PORT`, health `/health`, Socket.IO qua backend hiện tại. Không tự nạp `.env` ở entrypoint; nạp bằng hosting environment hoặc cách vận hành hiện có. `STORAGE_DRIVER=sqlite` dùng nguyên SQLite/default private paths, không đọc DATABASE_URL. CLI `npm run classroom` vẫn dành cho SQLite/offline backup; chưa tạo công cụ provision giáo viên PostgreSQL mới ngoài import, chờ Auth 9B.2.

Để trở lại SQLite: dừng/drain PostgreSQL backend, giữ PostgreSQL backup, đặt STORAGE_DRIVER=sqlite và dùng nguyên paths/backup nguồn. **Không có reverse-sync** đáp án mới ở PostgreSQL về SQLite; đổi driver không bảo toàn tự động các buổi phát sinh sau cutover. Không cho hai backend cùng phục vụ một lớp trong lúc rollback.

## Kết quả test và đo hiệu năng

| Kiểm tra | Kết quả |
|---|---|
| Baseline trước sửa | 57/57 test cũ đạt |
| Toàn bộ unit/integration với PG_TEST_URL local | **68/68 đạt, không skip**; 57 cũ + 11 mới |
| TypeScript, build client/server/CLI | Đạt |
| SQL transaction/constraints | Atomic checkpoint/answer/receipt; trigger lỗi rollback, retry; stale sequence/đổi đáp án bị từ chối |
| Two-writer/fence | Writer thứ hai bị từ chối; kill dedicated connection, old writer bị fence và live server health503/pause |
| Connection/pool/timeout | Kill pooled connection, statement timeout, pool max1 exhaustion; release và query tiếp theo hoạt động |
| Unknown commit | Commit thật + fault boundary: không ACK thành công; restart/replay có đúng một đáp án/thưởng |
| 20 PostgreSQL Socket.IO | 20 hồ sơ/ảnh, trả lời đồng thời/trùng, resume/restart paused, không cấp lại player/điểm |
| Process lifecycle PostgreSQL | SIGTERM/SIGINT/SIGKILL compiled server: đạt cả 3 |
| Migration | schema1/2, ID/hash/JSON/FK/parity, CLI, dry-run/apply/rollback/rerun đạt |
| SQLite regression | Cả ba tín hiệu + backup/verify/restore và Chromium readiness đạt |
| Chromium PostgreSQL | Login/class, QR không token, 20 avatar binding, reward/lane, offline22s/resume, history/CSV đạt; mobile không Phaser/overflow, không pageerror |

Các lệnh chạy lại (PG_TEST_URL là credential **local thử nghiệm**, harness từ chối host ngoài loopback, cần quyền CREATE DATABASE/ROLE để tạo và dọn database riêng):

```sh
npm run typecheck
npm test                         # không có PG_TEST_URL thì 10 integration PG sẽ skip
npm run build
npm run test:postgres
npm run test:postgres-migration
npm run test:postgres-signals
npm run test:postgres-browser
BENCHMARK_DRIVER=sqlite ASYNC_BENCHMARK_OUTPUT=/tmp/sqlite-network.json npm run benchmark:readiness-network
BENCHMARK_DRIVER=postgres ASYNC_BENCHMARK_OUTPUT=/tmp/postgres-network.json npm run benchmark:readiness-network
STOP_SIGNAL=SIGTERM npm run test:persistence
STOP_SIGNAL=SIGINT npm run test:persistence
npm run test:crash
npm run test:readiness-browser
```

Network benchmark chạy tuần tự, cùng máy, 20 socket + server một Node process, 60 đáp án, 200 lệnh làn, 3 ngắt transport chủ động; PostgreSQL ở Docker loopback, SQLite FULL. Không chạy build/test khác trong cửa sổ đo. Không phải benchmark Supabase qua Internet. Histogram SQL chỉ giữ 2.048 mẫu gần nhất; ACK processing gồm mọi lệnh (create/join/next/lane/resume), không chỉ answer.

| Chỉ số (ms, trừ khi ghi khác) | SQLite cùng phiên | PostgreSQL local |
|---|---:|---:|
| RTT đáp án median / P95 / P99 (60 mẫu) | 68,70 / 71,94 / 72,38 | **166,74 / 314,78 / 374,94** |
| RTT làn median / P95 / P99 (200) | 70,71 / 77,10 / 77,48 | 214,09 / 385,57 / 405,71 |
| Queue wait median / P95 / P99 | 0,006 / 0,021 / 0,102 | 137,43 / 346,83 / 378,86 |
| Save aggregate median / P95 | 2,62 / 3,80 | 17,87 / 22,59 |
| DB query median / P95 / P99 | Chưa tách driver sync | 0,86 / 3,40 / 4,36 |
| Transaction median / P95 / P99 | Chưa tách | 16,66 / 20,91 / 26,63 |
| Pool acquisition median / P95 / P99 | Không có pool | 0,105 / 0,219 / 0,320 |
| ACK processing median / P95 / P99 | 3,10 / 4,44 / 5,96 | 178,47 / 369,87 / 397,67 |
| Periodic checkpoint (chỉ 1 mẫu benchmark ngắn) | 2,73 | 18,96 |
| Event loop mean / P95 / P99 / max | 12,80 / 13,47 / 73,60 / 80,15 | 10,21 / 11,25 / 12,53 / 16,16 |
| Ranking frame gap median / P95 / P99 | 99,82 / 127,50 / 129,21 | 100,37 / 502,24 / 801,84 |
| Loạt20 đáp án đầu → frame cô đủ kết quả | 128,63 | 670,77 |
| Reconnect median / P95 (3 mẫu) | 118,91 / 123,45 | 155,83 / 173,50 |
| Disconnect ngoài kế hoạch | 0 | 0 |
| Payload gửi/nhận tổng byte/s | 1.315.301 / 3.720 | 569.997 / 1.879 |

Regression rõ rệt: PostgreSQL giảm event-loop blocking nhưng mỗi aggregate commit nhiều round trip, các lệnh cùng phòng phải tuần tự chờ durability. Queue sâu nhất20, pool không phải nút nghẽn trong mẫu một phòng (cuối đo1 pooled idle/0 waiting, max4 + writer1), không lỗi/reject. SQLite queue wait nhỏ không tính packet đang chờ event loop bị block. Không dùng số wait đó để kết luận RTT nhỏ.

Lưu lượng/giây PostgreSQL thấp hơn **không chứng minh tối ưu protocol**: benchmark dài hơn9,18s so với4,64s, tick coalesce và phát frame chậm khi room bận. Đây là dấu hiệu cần xử lý, không phải lợi ích băng thông. Qua Internet có thể chậm hơn đáng kể; chưa đạt bằng chứng phù hợp lớp thật. Cần giảm round trip bằng transaction SQL gọn/batching có giữ nguyên ACK durability và đo staging trước khi mở cho lớp; không tăng FPS bằng cách bỏ commit/constraint.

Baseline lịch sử 9A: answer median68,43/P9571,83/P9972,00ms; Chromium42,04FPS. Các lượt Chromium local mới là phép đo ngắn/Vite dev/headless, không phải SLA hay thiết bị thật; FPS/memory chi tiết ở JSON bằng chứng, không suy ra cải thiện đồ họa vì frontend giữ nguyên. Chưa có soak dài, remote TLS/Internet benchmark hoặc 20 điện thoại thật.

Lượt Chromium cuối dùng viewport1500×1100, camera dẫn đầu, đo8 giây sau reconnect, chỉ một lượt mỗi adapter:

| Chỉ số trình duyệt | SQLite | PostgreSQL local |
|---|---:|---:|
| RAF FPS / frame P95 | **39,54 / 33,40 ms** | **39,54 / 33,40 ms** |
| React commits / tổng render trong8s | 80 / 899,80 ms | 79 / 851,20 ms |
| Phaser update CPU / số update | 61,30 ms / 318 | 64,40 ms / 321 |
| JS heap trước / sau / sau GC | 23,79 / 21,08 / 13,46 MiB | 19,24 / 41,51 / 13,36 MiB |
| Texture tổng / avatar texture | 74 / 20 | 89 / 20 |

Đây không phải A/B đồ họa hoàn toàn: fixture màu xe/luồng chuẩn bị giữa hai script khác nhau, nên texture tổng khác; không quy chênh lệch FPS/render/heap cho driver. Phaser update CPU đo phần update được instrument, **không bao gồm toàn bộ GPU/draw**; React render không phải toàn bộ chi phí commit/paint. Camera dẫn đầu có15 avatar trong viewport tại mẫu cuối, nhưng20 bindings/xe vẫn được giữ và kiểm đúng playerId/studentId/avatarId; chế độ toàn cảnh cũng được thử. Heap giảm sau GC không chứng minh không rò rỉ trong buổi học dài. Mục tiêu55–60FPS chưa đạt trong môi trường này.

Vite ghi một `ECONNRESET` proxy ở lượt cố ý offline; không có browser pageerror, resume kiểm điểm/câu hỏi thành công. Build còn cảnh báo chunk Phaser lớn hơn500kB như trước; không sửa/lược đồ họa hoặc UI trong giai đoạn adapter.

## File tạo/sửa và bằng chứng

| File | Thay đổi |
|---|---|
| `server/storage/PostgresStorage.ts` | Adapter toàn bộ repository hiện tại |
| `server/storage/postgres/{config,Database,json,room,migrate,importer}.ts` | Pool/TLS/errors/fence/atomic room/import/checksum |
| `server/storage/postgres/migrations/001_storage.sql` | Schema PostgreSQL v1, constraints/index/RLS/runtime role |
| `server/storage/factory.ts` | Chọn driver, lazy import, bảo vệ path ảnh nguồn |
| `server/storage/contracts.ts` | Hook optional assertWritable/onUnavailable, SQLite không bắt buộc đổi |
| `server/runtime/Samples.ts` | Latency histogram giới hạn bộ nhớ |
| `server/app.ts` | Lắng nghe storage unavailable, writer guard, metrics ACK/save/checkpoint |
| `server/index.ts` | Await factory, startup fail closed, giữ shutdown server→storage |
| `tests/postgres.test.ts`, `tests/helpers/postgres.ts` | 11 test, fixture PostgreSQL thật và login runtime riêng |
| `scripts/postgres/{migrate,migration-smoke,persistence,browser}.ts` | CLI operator và kiểm thử CLI/process/Chromium PostgreSQL |
| `scripts/readiness-network.ts` | Cùng benchmark SQLite/PG, telemetry queue/DB/ACK/loop |
| `package.json`, `package-lock.json` | pg/@types/pg, scripts mới |
| `.env.example`, `.gitignore` | Driver/TLS/pool/path; bảo vệ secret/private-data/export/dump |
| `POSTGRESQL_ADAPTER_MIGRATION.md` | Báo cáo này |
| `benchmarks/postgres/` | Network JSON, signals, migration CLI, browser JSON/ảnh giả, source-check, SQLite regression riêng |

Các benchmark giai đoạn trước ở thư mục gốc đã được backup/khôi phục sau khi chạy script cũ; không ghi đè bằng số mới. Bằng chứng chỉ chứa dữ liệu giả; file credential local thử nghiệm nằm ngoài repository, không đưa vào tài liệu.

## Giới hạn và việc tiếp theo

1. Chỉ đạt integration local; chưa xác minh quyền CREATEROLE, TLS/CA, pooler session, timeout, RLS role và latency trên Supabase staging thật. Không dùng production để thử.
2. Regression latency/frame khi 20 lệnh cùng phòng cần được tối ưu/đo lại trước triển khai thực tế. Không có cam kết 55–60FPS hoặc kết nối ổn định tuyệt đối.
3. RLS backend-wide, Auth cũ/cookie Strict và avatar file riêng vẫn tồn tại. Auth JWT/teacher mapping không đổi ID, private Storage/signed access và cookie/cross-site Cloudflare↔Render là phạm vi **9B.2 chưa làm**.
4. Một writer/database, không rolling deploy không gián đoạn; mất lock cần supervisor restart. Commit không rõ outcome cần recovery, không tự hòa giải online. Password/session hash không phải JWT Supabase.
5. Import toàn bộ trong một transaction/RAM, thử dữ liệu giả nhỏ và SQLite v1/v2; chưa import dữ liệu lớp thật hay stress bộ đề ảnh lớn/50 phòng. Rollback đích đã hoạt động bị từ chối có chủ ý.
6. File và SQL không chung atomic transaction; ảnh local có thể orphan sau crash và chưa bền trên Render Free. Không di chuyển/xóa ảnh nguồn để che giới hạn này.
7. SIGKILL có rollback quãng đường; không mất ACK trong các kịch bản đã thử không phải chứng minh mọi tình huống mất điện/database outage.
8. Chỉ sau khi có project staging/credential phù hợp mới kiểm migration bản sao đã duyệt, WSS/HTTPS/QR/restart Render, rồi checklist 20 điện thoại Wi-Fi. Chưa xác nhận sẵn sàng dùng lớp thật, chưa tự triển khai.
