# Giai đoạn 9B.1.1 — Hiệu năng PostgreSQL và chuẩn bị staging

Ngày 06/11/2026 (UTC+7). Đã tối ưu và đo trên **PostgreSQL17 local Docker**, Node24.22.1, dữ liệu giả. Không tạo lại adapter, không sửa migration/schema, không deploy production, không chuyển sang 9B.2 hoặc commit. **Median 20 client giảm từ162,30 xuống95,92ms; P95 từ310,03 xuống178,57ms. Mục tiêu P95<150ms chưa đạt.** Chưa có credentials Supabase staging nên chưa kiểm thử cloud.

## 1. Khảo sát và môi trường test

Đã đọc POSTGRESQL_ADAPTER_MIGRATION.md, ASYNC_STORAGE_MIGRATION.md, CLOUD_MIGRATION_PLAN.md; kiểm tra PostgresDatabase/pool, PostgresStorage, writeRoom, RoomQueue, app fork/save/adopt/ACK, duplicate/receipt, checkpoint, reconnect và tests. PostgreSQL adapter/schema/import/rollback của9B.1 được tận dụng.

Đầu phiên `PG_TEST_URL` và `DATABASE_URL` chưa được cấu hình. Docker local hoạt động, có image PostgreSQL17; tạo **container test riêng trên loopback**, password thực sinh ngẫu nhiên, lưu mode0600 ngoài repository và chỉ truyền PG_TEST_URL cho tiến trình test. Đây là URL tới database đã khởi động/xác thực được, không phải URL giả hoặc production. Fixture hiện có tạo database/role runtime riêng cho từng bài rồi dọn; không dùng database lớp học/ảnh thật. Runtime environment không có secret/identity Supabase staging; không dò credential trong file riêng hoặc tự dùng production.

Git vẫn chưa có commit, file untracked; giữ nguyên tất cả. Snapshot SHA-256 mã nguồn đầu phiên dùng để đối chiếu. **src/, shared/, RaceModel, RaceScene, Room/luật đua, RoomQueue, SQLite adapter/Store/migrations, SessionStore, PostgreSQL migration001 và importer không đổi bytes.** `benchmarks/postgres-performance/source-check.json` ghi file cụ thể. Không mở SQLite gốc để migrate/gc hoặc thay ảnh.

## 2. Đo trước khi tối ưu và nguyên nhân regression

Trước khi đổi cách lưu: chỉ thêm telemetry và tham số số client cho benchmark, chạy68/68 test, rồi đo baseline **1/5/10/15/20 client, ba lượt/mức**. Sau đó mới thay SQL. Queue logic, thứ tự command, tốc độ game và ACK boundary giữ nguyên.

Baseline20 client cho thấy:

- Queue chờ đáp án median140,28ms, P95282,53ms; lấy connection chỉ0,103ms, P950,202ms.
- Một aggregate save dùng **13 lời gọi client.query**, transaction median15,64ms, P9520,17ms. Khi20 học sinh trả lời cùng lúc, các commit tuần tự trong cùng phòng làm người cuối chờ nhiều transaction phía trước.
- Session write median2,83ms, player delete/upsert3,65ms, insert answer1,30ms, insert receipt1,42ms. Mỗi lệnh làn/checkpoint cũng gửi lại toàn bộ answer/receipt và đi qua ON CONFLICT dù hầu hết đã có.
- Đọc lại checkpoint/answer/receipt, canonical JSON và truyền cùng state dưới dạng checkpoint lẫn player rows tạo thêm công việc. SQL round-trip và aggregate write là phần đáng tối ưu; COMMIT0,79ms không phải nút nghẽn lớn nhất.
- Pool max4, quan sát busy/total peak1, cuối đo idle1/waiting0; không có bằng chứng pool bão hòa. Không tăng pool theo số học sinh. Event-loop P99 khoảng12,30ms cũng không giải thích queue hàng trăm ms trong PostgreSQL.

SQLite chạy in-process và block event loop trong SQL, không có round-trip PostgreSQL, nên queue wait thấp không đồng nghĩa packet không phải đợi. Baseline lịch sử9B.1: SQLite68,70/P9571,94ms và PostgreSQL166,74/P95314,78ms. Baseline mới162,30/P95310,03ms gần mức PostgreSQL cũ; không dùng số lịch sử thay cho phép đo trước/sau cùng phiên.

## 3. Thay đổi tối ưu và tính toàn vẹn

1. **Pool được giữ và tái sử dụng như cũ**, max4 cộng1 dedicated writer. Thêm đo pool acquire, busy/total/waiting peak, không tạo connection theo mỗi answer.
2. Gộp kiểm owner/epoch/dedicated writer lock và acquire room advisory lock vào một SELECT. Hàng owner vẫn `FOR SHARE`; writer khác vẫn bị fencing. Statement ghi tiếp theo chạy **sau khi acquire lock xong**, lấy snapshot READ COMMITTED mới.
3. `roomWrite.ts` dùng một statement CTE có guard: `SELECT ... FOR UPDATE` bản cũ, kiểm sequence/owner/set, giữ nguyên mọi answer đã lưu, kiểm signature/data/receipt archive và cửa sổ receipt cũ. Chỉ khi guard hợp lệ mới UPDATE session và các bảng liên quan.
4. Truyền checkpoint JSON một lần, suy ra player/answer/receipt rows ngay trong PostgreSQL. Không truyền lại toàn bộ player state qua tham số JSON riêng. Các player đã tồn tại dùng UPDATE, chỉ INSERT player mới.
5. Chỉ INSERT **answer/receipt chưa có**. Unique/PK/FK không đổi, không bỏ ON CONFLICT hoặc tính idempotent. Đếm số hàng dự kiến/thực tế trước commit; thiếu player hoặc insert không khớp làm rollback toàn transaction.
6. Prepared statement cho query phòng, tên băm từ SQL tĩnh; `plan_cache_mode=force_generic_plan` chỉ trong transaction phòng để tái dùng plan, tránh lập lại plan chứa các JSON constant lớn. Không đổi plan mode cho CRUD giáo viên/lớp.
7. Tạo phòng/đổi bộ đề trước start tiếp tục dùng đường ghi tương thích schema cũ khi guarded update không áp dụng. Có test release/claim lại hồ sơ và configure câu hỏi.

Lưu phòng thông thường còn **4 lời gọi client.query**: BEGIN+SET LOCAL, fence+room lock, guarded aggregate statement, COMMIT. Một lời gọi BEGIN chứa nhiều SQL statement; con số4 là lượt trao đổi logic qua driver, không phải bốn packet TCP. Các đường tạo phòng/configure có nhiều lệnh hơn, không được báo thành4.

Không bỏ transaction, không tắt synchronous_commit/fsync, không ACK sớm. Answer, quiz/boost, receipt, player state, checkpoint/report vẫn cùng transaction. Server chỉ adopt/publish và ACK sau COMMIT theo9A. Lỗi/uncertain commit giữ fail-closed; restart đọc bản đã commit để replay, không tự chấm/thưởng lại.

**Lưu ý MVCC:** Không đưa một advisory lock có thể phải chờ vào cùng statement CTE ghi/đọc. Snapshot của statement đó có thể được tạo trước khi writer trước commit. Test mới giữ transaction đầu đang mở, quan sát writer sau thực sự chờ lock, rồi kiểm nó thấy đáp án vừa commit của writer trước. RoomQueue vẫn tuần tự, bounded/coalesced như cũ; không thêm queue toàn server hoặc cho hai command cùng phòng sửa state song song.

Không thêm index: số đo chỉ ra chi phí số lượt SQL/ghi lặp; chưa có bằng chứng thiếu index trong fixture này. PK/index/schema/RLS hiện có được giữ nguyên.

## 4. Phương pháp benchmark và kết quả RTT

`npm run benchmark:postgres-performance` chạy script readiness hiện có, tham số1/5/10/15/20 client, ba lượt tuần tự mỗi mức. Mỗi lượt:3 đợt trả lời đồng thời,10 đợt chuyển làn, ngắt transport/resume tối đa3 client. Server và socket client cùng Node process, PostgreSQL Docker loopback, dữ liệu giả; không chạy build/test khác trong cửa sổ đo. Trước/sau dùng cùng script, câu hỏi, telemetry và máy. Không phải đo Supabase Internet hoặc điện thoại thật.

RTT bảng dưới gộp raw answer samples của ba lượt, median upper-middle và P95/P99 nearest-rank. Mức1 chỉ9 mẫu, P99 gần max; không phải SLA. Các histogram server giữ tối đa2.048 mẫu/nhóm, không lưu SQL/parameter/tên/token vào telemetry.

| Client | Mẫu đáp án/mỗi phía | Median trước → sau (ms) | P95 trước → sau (ms) | P99 trước → sau (ms) |
|---:|---:|---:|---:|---:|
| 1 | 9 | 10,66 → 6,20 | 22,27 → 16,98 | 22,27 → 16,98 |
| 5 | 45 | 37,29 → 18,84 | 76,52 → 39,59 | 79,48 → 53,71 |
| 10 | 90 | 69,77 → 41,83 | 122,01 → 76,14 | 128,80 → 89,71 |
| 15 | 135 | 111,59 → 62,97 | 210,28 → 124,65 | 227,65 → 132,42 |
| **20** | **180** | **162,30 → 95,92** | **310,03 → 178,57** | **355,05 → 197,59** |

20 client: median giảm khoảng40,9%, P95 giảm42,4%, P99 giảm44,4%. Median gộp dưới100ms nhưng một lượt riêng median100,62ms; không khẳng định luôn dưới100ms. P95 ba lượt sau là186,14 /179,05 /169,43ms, **chưa đạt150ms**.

Control SQLite mới20 client (một lượt/60 mẫu, cùng benchmark, chạy riêng): median63,31/P9564,74/P9965,10ms. PostgreSQL vẫn chậm hơn; không tuyên bố ngang SQLite. Raw JSON từng lượt và `comparison.json` nằm trong `benchmarks/postgres-performance/`.

Các thử trung gian được giữ ở `intermediate/`: gộp SQL đơn thuần giảm lượt gọi nhưng P95 có lúc xấu hơn (546,02ms). EXPLAIN không thấy JIT; sau đó mới giảm payload trùng, dùng plan lại và gộp lock trước statement ghi. Không chọn số đẹp nhất của các trial làm số cuối; bảng trên dùng đủ15 lượt trước và15 lượt sau.

## 5. Queue, từng phần transaction, ACK và pool

Bảng thành phần20 client là **median của ba thống kê tương ứng theo lượt**, không phải percentile gộp của raw phase samples. Đơn vịms. Mỗi lượt khoảng329 room transactions, gồm setup/join/lane/next/resume/checkpoint, không chỉ60 answer. Queue/ACK hàng answer có60 mẫu/lượt.

| Thành phần | Median trước → sau | P95 trước → sau | P99 trước → sau |
|---|---:|---:|---:|
| Answer queue wait | 140,28 → 80,01 | 282,53 → 163,65 | 320,68 → 183,45 |
| Connection acquisition | 0,103 → 0,109 | 0,202 → 0,203 | 0,337 → 0,319 |
| BEGIN/settings | 0,360 → 0,381 | 1,043 → 1,179 | 3,421 → 2,907 |
| Tổng query wall time/transaction | 14,22 → 7,45 | 18,68 → 9,35 | 22,37 → 11,79 |
| Tổng transaction | **15,64 → 7,88** | **20,17 → 9,83** | **24,46 → 12,12** |
| COMMIT | 0,792 → 0,859 | 1,115 → 1,126 | 1,708 → 1,586 |
| Answer ACK processing | 156,74 → 89,37 | 298,37 → 175,32 | 339,85 → 193,92 |
| Event-loop delay P99 | 12,30 → 12,38 | — | — |

Trước tối ưu còn tách được: fence0,80ms, room lock0,25ms, previous read1,14ms, duplicate-query1,39ms, duplicate checking gồm query+JS2,02ms, session write2,83ms, player write3,65ms, answer insert1,30ms, receipt insert1,42ms (median theo cách trên). Duplicate checking chồng lên duplicate-query; không cộng tất cả medians để suy tổng transaction.

Sau tối ưu: fence+room lock chung0,591/P950,929/P991,532ms; **guard/duplicate check + session/player/answer/receipt write chung5,60/P956,68/P998,14ms**. Không thể gán độc lập network wall time cho từng CTE. Các bucket query cũ có0 vì không còn gọi riêng, **không phải duplicate check/insert đã bị bỏ hoặc có chi phí0**.

Đã đo thêm EXPLAIN ANALYZE năm lượt trên một aggregate20 player giả, thêm một answer/receipt; mỗi lượt rollback toàn bộ, không ACK. Median planning0,902ms, execution3,032ms, validation node0,178ms, answer INSERT node0,085ms, receipt INSERT node0,058ms; JIT không bật trong các plan quan sát. Đây là thời gian node **cumulative**, có thể chồng nhau, chưa gồm network/COMMIT, fixture chưa có lịch sử dài; không cộng node times hoặc dùng làm RTT. EXPLAIN là phép đo riêng/custom-plan, khác đường prepared generic plan được tái dùng trong benchmark. `query-plan.json` chỉ lưu nhãn/timing/buffer/trigger, không xuất SQL/JSON payload.

Pool max4 giữ nguyên, dedicated writer1. Trước/sau đều quan sát busyPeak1,totalPeak1, cuối idle1/waiting0; pendingPeak1 có cả giai đoạn mở connection, không phải bằng chứng saturation kéo dài. Pool-exhaustion test vẫn ép max1 và giữ connection để kiểm timeout/release. Không loại connection-acquire time khỏi số transaction để làm số đẹp.

Periodic checkpoint median giữa ba lượt:18,58 →11,27ms, **chỉ1 mẫu/lượt**, chưa đại diện tải dài. Ranking frame gap P95 giữa ba lượt giảm khoảng504,81 →303,58ms, nhưng vẫn có gap lớn khi queue bận. Không đổi ticker/catch-up/quy tắc game để che gap.

## 6. Kết quả20 client, crash và hồi quy

| Kiểm tra | Kết quả thực tế |
|---|---|
| Toàn bộ tests | **72 pass /0 skip /0 fail**, gồm68 cũ và4 test mới |
| Suite PostgreSQL riêng |15 test, gồm selector và14 bài cần PostgreSQL; chạy với database test local |
| TypeScript | Đạt |
| Build client/server/CLI | Đạt; cảnh báo chunk Phaser lớn như trước |
| Migration regression | CLI schema checksum/dry-run/apply/rerun/rollback và nguồn giả không đổi: đạt; không viết migration mới |
|20 client trong mỗi lượt matrix | Mỗi người3 câu đúng,200 lệnh làn cho20 client; giữ đúng20 player và socket active,0 queue reject |
| Reconnect20-client runs | Mỗi phía9 ngắt transport chủ động qua3 lượt,0 disconnect ngoài kế hoạch; resume giữ quiz/điểm/ID |
| Reconnect median/P95 giữa3 lượt |144,44/161,31ms trước →134,96/144,15ms sau; chỉ3 mẫu/lượt, script backoff100ms |
| Compiled SIGTERM/SIGINT | Mỗi trường hợp20 phiên/20 ACK, restore paused, không thưởng trùng; quãng đường lùi quan sát0m |
| Compiled SIGKILL |20 phiên/20 ACK giữ nguyên, paused; replay không thưởng trùng; lùi **27,80m** |
| Chromium PostgreSQL | Login/QR,20 avatar gắn đúng ID, answer/lane, offline22s/resume, history/CSV, mobile không Phaser: đạt |
| Staging probe | **SKIP**, vì PG_STAGING_URL chưa có; exit0 của lệnh không có nghĩa đã test Supabase |

SIGKILL9A từng lùi29,88m,9B.1 từng30,53m. Chênh lệch27,80m ở lượt mới phụ thuộc thời điểm crash/checkpoint, không chứng minh giảm rollback tối đa; simulation chưa checkpoint vẫn có thể lùi. Không mất đáp án đã ACK trong kịch bản đã thử không phải bảo đảm mọi loại mất điện/database failover.

Bốn test mới kiểm: BEFORE INSERT chỉ thấy answer/receipt mới, không thử chèn lại trên checkpoint; receipt đổi nội dung/đã evict bị chặn; writer chờ thực sự thấy predecessor vừa commit; ready-room release/configure/claim lại; JSON-null receipt và thiếu player row làm rollback. Các test cũ về timeout, pool exhaustion, connection loss, stale sequence, second writer, commit-response-lost/replay và20 avatar đều giữ assertion.

Chromium lượt này đo RAF32,18FPS, heap sauGC13,19MiB. Không có baseline Chromium mới cùng phiên trước thay SQL nên không quy thay đổi FPS cho tối ưu; số39,54FPS ở9B.1 là lượt lịch sử. Frontend không đổi, chưa đạt55–60FPS trong môi trường cloud headless này. Không thử20 điện thoại thật, Wi-Fi thật, remote Supabase, soak dài hoặc database-host crash.

## 7. Tình trạng Supabase staging và biến môi trường

**Chưa có credentials, không có lần kết nối Supabase nào trong phiên này.** HTTP environment connected không chứng minh PostgreSQL TCP được phép; cần cấu hình quyền outbound tới chính DB host/port nếu môi trường yêu cầu. Không tự thay network policy hoặc dùng production URL.

| Biến | Mục đích |
|---|---|
| PG_TEST_URL | Chỉ harness local, URL thật trên loopback; fixture cần CREATE DATABASE/ROLE, không dùng runtime/staging/production chung |
| STORAGE_DRIVER=postgres, DATABASE_URL | Runtime staging sau khi operator áp schema9B.1 đã duyệt; login runtime riêng, không admin/superuser/BYPASSRLS |
| PG_POOL_MAX=4 | Bốn pooled connection + một dedicated writer; không một connection/học sinh |
| PG_SSL_MODE=verify-full, PG_SSL_CA_FILE tùy chọn | Verify CA/hostname từ xa; không disable TLS hoặc rejectUnauthorized để vượt lỗi |
| PG_CONNECT_TIMEOUT_MS / PG_STATEMENT_TIMEOUT_MS / PG_LOCK_TIMEOUT_MS / PG_QUERY_TIMEOUT_MS | Giữ mặc định2.000/3.000/1.000/5.000ms của9B.1, cần đo lại phù hợp staging |
| PG_AVATAR_DIR | Bản sao riêng tạm thời như9B.1; chưa chuyển Storage, không dùng ảnh nguồn |
| PG_STAGING_URL | Credential runtime **staging riêng**, chỉ script probe dùng; không tự lấy DATABASE_URL làm staging |
| PG_STAGING_CONFIRMED=1, PG_STAGING_EXPECTED_HOST | Operator xác nhận target và exact-host allowlist trước khi probe connect |
| PG_STAGING_CONNECTION_MODE=direct hoặc session | Xác nhận mode; transaction pooler không hỗ trợ dedicated session writer lock |

`npm run check:postgres-staging` khi có đủ target được xác nhận: verify TLS, runtime role/schema1, BEGIN READ ONLY, query bằng cùng PoolClient/backend PID, ROLLBACK và release. Không migrate/seed/sửa phòng. Probe này không chứng minh session pooler giữ session qua nhiều transaction, writer fencing, RLS tenant hoặc multiplayer đã đúng trên Supabase. Runtime vẫn cần direct/session connection;6543 bị config từ chối như9B.1. Prepared statements cũng cần thử trên đúng endpoint/mode staging; không bỏ TLS/guard để kết nối được.

Bộ dữ liệu giả local đã có: defaultSet3 câu,20 profile/avatar tổng hợp,20 Socket.IO clients, câu trả lời/receipts và các tín hiệu restart. Khi có project staging được xác nhận, áp quy trình migration9B.1 trên bản sao/dữ liệu giả đã duyệt, rồi kiểm TLS/role/pooler, chạy room/20-client/restart/uncertain-commit và latency qua mạng. Không trỏ harness local tự CREATE/DROP DATABASE vào Supabase; harness cố ý từ chối remote host. Probe readonly chưa thay thế bộ acceptance staging đầy đủ.

Auth cookie/RLS backend-wide/private avatar local của9B.1 giữ nguyên; Supabase Auth/private Storage/cross-origin frontend là9B.2, chưa làm. Không tuyên bố lớp thật sẵn sàng.

## 8. File sửa/tạo và chạy lại

| File | Nội dung |
|---|---|
| server/storage/postgres/Database.ts | Phase/pool telemetry, gộp fence+room lock, named prepared statements/generic plan cho room transaction |
| server/storage/postgres/room.ts | Dùng guarded write cho phòng có sẵn; giữ đường tạo/configure và advisory boundary |
| server/storage/postgres/roomWrite.ts (mới) | CTE validation/delta/aggregate write, derive player/answer/receipt từ checkpoint một lần |
| server/storage/PostgresStorage.ts | Truyền category/code phòng vào transaction, giữ interfaces và clone đầu vào |
| server/app.ts | Telemetry queue wait/ACK theo operation type, không đổi protocol/queue behavior |
| scripts/readiness-network.ts | Tham số số client và raw RTT samples, mặc định20 giữ kịch bản cũ |
| scripts/postgres/performance.ts (mới) | Chạy ma trận tuần tự, lưu JSON từng lượt và metadata môi trường |
| scripts/postgres/query-plan.ts (mới) | EXPLAIN ANALYZE dữ liệu giả, rollback, chỉ xuất timing/nhãn an toàn |
| scripts/postgres/staging-check.ts (mới) | Probe staging readonly có explicit target/TLS/role/schema checks hoặc SKIP |
| tests/postgres-performance.test.ts (mới) |4 test hồi quy cho delta/immutable/MVCC/release/configure/null/missing row |
| package.json, .env.example | Scripts kiểm thử/profiling/staging và tên biến, không credential mới trong source |
| POSTGRESQL_PERFORMANCE_STAGING.md (mới) | Báo cáo này |
| benchmarks/postgres-performance/ (mới) | Before/after/matrix/comparison, intermediate, query-plan, recovery, browser, validation, source-check |

Không đổi dependency/lockfile, index/migration001, importer, frontend hoặc các artifact benchmark9B.1 trước đó.

```sh
# Nạp PG_TEST_URL thật của PostgreSQL local riêng bằng secret mechanism, không in URL.
npm run typecheck
npm test
npm run test:postgres
npm run build
PG_BENCHMARK_PHASE=before npm run benchmark:postgres-performance
# Chạy before trên mã9B.1 có telemetry, after trên mã tối ưu; cùng máy/config.
PG_BENCHMARK_PHASE=after npm run benchmark:postgres-performance
npm run profile:postgres-sql
PG_EVIDENCE_DIR=benchmarks/postgres-performance/recovery npm run test:postgres-signals
PG_EVIDENCE_DIR=benchmarks/postgres-performance/browser npm run test:postgres-browser
npm run test:postgres-migration
npm run check:postgres-staging
```

Chạy phase=before trên mã tối ưu sẽ chỉ đổi nhãn, **không khôi phục SQL cũ**. Không ghi đè bằng chứng before đã lưu khi chạy lại. Các lệnh cần quyền listen localhost; sandbox ban đầu chặn IPC tsx bằng EPERM, đã chạy kiểm thử với quyền thực thi phù hợp. TypeScript/build/test không dùng database thật ngoài fixture riêng.

## 9. Giới hạn và bước tiếp theo

- P95 mục tiêu150ms chưa đạt ở20 client. Queue tuần tự vẫn là phần lớn RTT; transaction dù giảm còn7,88ms vẫn phải chờ nhiều command cùng phòng. Cần thử tối ưu thêm aggregate/plan hoặc thiết kế batch command có ranh giới commit/adopt/receipt rõ ràng trong một bước riêng; không bỏ durability hoặc chạy song song state cùng phòng để lấy số đẹp.
- CTE phức tạp hơn, generic plan chưa được stress với bộ đề ảnh lớn, receipt dài/50 phòng, remote TLS và độ trễ Supabase. Prepared statement cache sống theo connection; cache được tạo lại khi reconnect. Không có schema change để rollback, nhưng phải đo trên endpoint staging thực.
- Tick/checkpoint coalesce giữ nguyên; ranking có gap khi room bận. Không thay tốc độ simulation hoặc hạng để giấu latency. Periodic checkpoint sample quá ít để suy SLA.
- Một writer/database và các giới hạn receipt/recovery9B.1 giữ nguyên. Không hỗ trợ rolling deploy không gián đoạn/horizontal scale. Không có automatic reconciliation cho uncertain commit; restart/replay như trước.
- Nếu phải quay lại code9B.1: drain/dừng server, khôi phục phiên bản code đã duyệt, giữ schema1 và dữ liệu; không xóa/recreate database hoặc ảnh. Không cần chạy lại import/migration để rollback riêng tối ưu này.
- Khi có staging credentials/target và network được xác nhận mới kiểm Supabase; sau đó mới tiếp tục acceptance20 điện thoại thật. Chưa deploy, chưa tự chuyển9B.2.
