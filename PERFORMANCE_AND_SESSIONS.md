# Hiệu năng và phiên chơi bền vững — giai đoạn 6

Ngày 05/11/2026. Mở rộng dự án hiện có, không đổi RaceModel hoặc tọa độ thi đấu. Dữ liệu lớp/ảnh đã lưu không bị xóa hay ghi đè. Các phép thử dùng DB tạm và ảnh giả, không dùng tài khoản/hồ sơ thật.

> Cập nhật giai đoạn 7: xem [CLASSROOM_READINESS.md](CLASSROOM_READINESS.md) về khóa kernel, thử SIGKILL, lỗi lưu trữ và số đo mới. Các số đo bên dưới là lịch sử giai đoạn 6.

## Lưu trữ và migration

Migration `user_version` **1 → 2**, transaction, giữ nguyên teachers/sessions/classes/students/avatars. DB mới chạy lần lượt migration 1 rồi 2. SQLite vẫn dùng foreign keys và WAL.

- `race_sessions`: code (PK), ownerId (FK teachers), classId (ID snapshot, không cascade khi xóa lớp), status, createdAt/startedAt/finishedAt/updatedAt, checkpoint JSON có version, report JSON, error. Index ownerId/createdAt.
- `race_players`: khóa (roomCode, playerId), studentId, digest SHA-256, state JSON; unique (roomCode, studentId). FK roomCode cascade khi xóa kết quả.
- `race_answers`: khóa duy nhất (roomCode, playerId, questionId), result JSON; FK tới race_players cascade. Không có thao tác cộng điểm trực tiếp; tổng điểm luôn tính từ các đáp án đã ghi.

Checkpoint gồm vị trí/làn/tốc độ, boost/slow, obstacle hit flags, thời gian mô phỏng, quiz index/startedAt/results, bộ đề, bản đồ playerId/studentId và các command receipts giới hạn 128/owner. Không lưu token phiên rõ hoặc avatar Base64 vào bảng phiên. Chỉ lưu băm token; resume kiểm tra timingSafeEqual. Bộ đề có thể chứa hình minh họa câu hỏi như cơ chế cũ.

Mỗi lệnh thành công và disconnect được lưu trong **một transaction trước ACK**; checkpoint vật lý khi đang chạy mỗi **1 giây**, không ghi theo frame 60 Hz/Socket tick 10 Hz. Các câu trả lời unique được insert-on-conflict-do-nothing; progress cập nhật player state. Khi dừng sạch, lưu trạng thái cuối. Vì thế câu trả lời đã ACK bền vững; khi tiến trình chết bất thường có thể lùi quãng đường/boost chưa kèm thao tác về checkpoint gần nhất (nhịp mục tiêu 1 giây, không phải giới hạn cứng khi IO/event loop nghẽn), không mô phỏng bù thời gian server ngừng chạy.

Ảnh trong RAM không đưa vào checkpoint. Sau restart, server nạp lại ảnh từ avatarId qua Store có kiểm tra owner. Nếu ảnh/hồ sơ nguồn đã bị xóa, dùng avatar mặc định, giữ nguyên tên/điểm/studentId/playerId. Ảnh bản sao RAM đang dùng trong phòng hiện tại vẫn theo cơ chế giai đoạn 5.

Phòng chơi nhanh chưa đăng nhập vẫn hoạt động và có thể khôi phục bằng capability đã lưu trên trình duyệt; vì không có ownerId nên không xuất hiện trong lịch sử của giáo viên. Phòng do giáo viên đăng nhập tạo có ownerId, kể cả chơi nhanh không chọn lớp.

## Khôi phục

1. Giữ nguyên `CLASSROOM_DB_PATH` và `CLASSROOM_AVATAR_DIR`, khởi động lại `npm run server` hoặc bản đã build. Store chạy migration tự động. Từ giai đoạn 7 dùng kernel flock; sau kill -9 tự lấy lại khóa trên inode `.guard` còn nguyên. Metadata legacy cần xác minh và lưu trữ theo CLASSROOM_READINESS.md. Không xóa `.guard`/DB/WAL/SHM.
2. Tải tối đa 50 phòng chưa kết thúc, trong TTL 2 giờ. Phòng đang đua được đưa về **paused**, mọi socket online cũ bị xóa. Phòng chưa xuất phát giữ **ready** để còn chọn hồ sơ. Không tự cho xe chạy. Clock câu hỏi đứng yên lúc server ngừng chạy/tạm dừng.
3. Trình duyệt nối lại dùng token cũ đã lưu. Teacher/player digests được khôi phục; hai tab vẫn thay thế nhau. Claims được dựng lại từ studentId/playerId, không tạo người chơi mới cho hồ sơ đã chiếm. Sequence tăng 1.000 khi phục hồi để loại snapshot cũ.
4. Giáo viên bấm **Tiếp tục**. Nếu đổi trình duyệt/mất capability giáo viên: đăng nhập tài khoản sở hữu → **Lịch sử trò chơi → Khôi phục phòng**, server xoay capability giáo viên, ngắt phiên giáo viên cũ. Học sinh cần token đã lưu trên thiết bị; không khôi phục bằng tên/deviceId.
5. Hết TTL, phòng ngừng nhận lệnh và được gỡ khỏi RAM nhưng kết quả gần nhất vẫn nằm trong lịch sử. Không xóa lớp/ảnh khi dọn phòng. TTL mất kết nối giáo viên 10 phút bắt đầu lại lúc load; giới hạn 2 giờ từ tạo vẫn giữ nguyên.
6. JSON/checkpoint không hợp lệ bị cách ly `status=corrupt`, `error=Invalid checkpoint`, không chạy tiếp; các phòng khác tiếp tục được nạp. Không tự sửa hoặc ghi đè dữ liệu lỗi. Kết quả gần nhất đã lưu vẫn có thể xem qua API lịch sử.

## Lịch sử và API

Trong mục Danh sách học sinh đã đăng nhập có **Lịch sử trò chơi**. Lọc lớp và ngày, xem hạng/đúng/sai/quãng đường/chi tiết lựa chọn/thời gian, xuất CSV/JSON. Không nhúng ảnh, token hay digest vào bản xuất. Chỉ xóa phiên đã kết thúc/hết hạn/bị cách ly thuộc tài khoản hiện tại; xóa cascade players/answers, không đụng lớp/học sinh/ảnh.

- GET `/api/history?classId=&from=YYYY-MM-DD&to=YYYY-MM-DD`: tối đa 200 phiên mới nhất của owner, lọc ngày theo UTC (UI hiển thị giờ địa phương).
- GET `/api/history/:code`: report dành riêng owner.
- DELETE `/api/history/:code`: cookie + CSRF header + owner, từ chối phòng đang hoạt động; loại phòng kết thúc khỏi RAM trước khi xóa DB để periodic checkpoint không tạo lại kết quả.
- Socket `recoverTeacher {code}`: cookie giáo viên sở hữu, xoay băm token; không dùng mã phòng làm bằng chứng quyền sở hữu.

Cơ chế cookie/CORS/rate limit/giới hạn body/API ảnh giữ nguyên. Không có chức năng ghi điểm/vị trí do client tự khai báo.

## Render

Giữ nội suy SnapshotBuffer và phối cảnh 3 làn. Thay vì tessellate cây/cờ mỗi frame, bake 6 texture cảnh một lần, dùng tối đa 24 sprite tái sử dụng. Avatar cache theo avatarId, sprite theo playerId, không dùng rank làm khóa. Nhãn và số chỉ đổi nội dung khi thay đổi; bố trí chống chồng tính 10 Hz, vị trí nhãn/avatar vẫn đi theo xe mỗi frame. Dọn offset khi xe bị gỡ. Hình học polygon dùng path trực tiếp, tránh tạo hàng trăm Phaser.Geom.Point mỗi frame. 15–20 xe giảm bụi thường, giữ vệt boost và nhận diện xe. Tái sử dụng Graphics, không tạo Graphics/texture mới trong trạng thái render ổn định (chỉ bake lần đầu/ảnh mới).

Instrumentation `?off=avatars|labels|cars|road|effects` dành cho benchmark. Các phép tắt là **ablation**, không phải phép phân rã CPU/GPU độc lập: tắt cars cũng bỏ nhãn/avatar gắn theo xe; road tắt vạch/cây/cờ động nhưng vẫn giữ background bake và bảng chỉ đường. Không được cộng các chênh lệch để suy ra tổng chi phí.

## Tệp thay đổi

Mới: `server/sessions/SessionStore.ts`, `src/classroom/GameHistory.tsx`, `tests/sessions.test.ts`, `scripts/render-benchmark.ts`, `scripts/network-benchmark.ts`, báo cáo này và JSON benchmark giai đoạn 6.

Sửa: `server/Room.ts`, `server/app.ts`, `server/classroom/Store.ts`, `server/classroom/api.ts`, `src/questions/model.ts`, `shared/protocol.ts`, `src/classroom/ClassroomPanel.tsx`, `src/online/OnlineApp.tsx`, `src/online/useRoom.ts`, `src/game/RaceScene.ts`, `scripts/classroom-browser.ts`, `scripts/persistence-smoke.ts`, `CLASSROOMS.md`, `README.md`, `package.json`.

## Chạy lại kiểm thử

```sh
npm run typecheck
npm test
npm run build
npm run test:persistence
SESSION_RESTART=1 node --import tsx scripts/classroom-browser.ts
node --import tsx scripts/render-benchmark.ts benchmarks/render-after.json
node --import tsx scripts/network-benchmark.ts
```

Không chạy test/build cùng lúc với benchmark nếu muốn số đo có thể so sánh. Chromium `/usr/bin/chromium`, Node 24.22.1, môi trường cloud headless phần mềm. Benchmark renderer riêng dùng đúng instance Phaser của RaceScene và xác nhận canvas báo đủ số xe trước khi đo; mỗi cấu hình 3 giây. Đây không phải số FPS của toàn giao diện hay máy trình chiếu thật. Cần nhiều lượt/lấy median và thiết bị thật để đánh giá ổn định dài hạn.

## Số đo trước và sau

rAF FPS của renderer riêng, canvas 900 × 600, mỗi cấu hình một mẫu 3 giây. Các mẫu có nhiễu GC/lập lịch cloud; tắt avatar không luôn nhanh hơn bật. Không lấy chênh lệch đơn lẻ làm chi phí GPU chính xác.

| Xe | Trước bật avatar | Sau bật avatar | Trước tắt avatar | Sau tắt avatar |
|---|---:|---:|---:|---:|
| 5 | 56.02 | 60.00 | 60.00 | 59.67 |
| 10 | 59.34 | 60.00 | 60.00 | 55.03 |
| 15 | 56.02 | 57.35 | 59.34 | 60.00 |
| 20 | 56.36 | 60.00 | 57.35 | 57.34 |

Ablation 20 xe; CPU là TaskDuration của tab trên cửa sổ 3 giây, không phải GPU:

| Tắt lớp | FPS trước | FPS sau | CPU trước (s) | CPU sau (s) |
|---|---:|---:|---:|---:|
| none | 56.36 | 60.00 | 3.038 | 2.778 |
| avatars | 57.35 | 57.34 | 2.952 | 2.870 |
| labels | 59.00 | 55.36 | 2.804 | 2.917 |
| cars | 55.69 | 60.00 | 2.952 | 2.407 |
| road | 59.67 | 56.69 | 2.673 | 2.885 |
| effects | 33.48 | 59.34 | 3.034 | 2.846 |

Mẫu effects trước 33,48 FPS thấp bất thường; không suy ra chi phí âm của hiệu ứng. Mẫu none 20 xe giảm TaskDuration từ 3,038 xuống 2,778 giây. Cần profiler GPU và nhiều lượt lặp trên máy thực để phân rã chi phí. Lượt after đầu có test chạy chồng một số mẫu đã được thay bằng lượt riêng ở render-after.json.

Toàn giao diện, Chromium 1500 × 1100, một giáo viên + một browser điện thoại + 19 bot, cửa sổ 8 giây:

| Chỉ số | Giai đoạn 5 | Giai đoạn 6 mới nhất |
|---|---:|---:|
| rAF FPS | 37.42 | 46.41 |
| rAF frame P95 (ms) | 50.00 | 33.40 |
| RTT đáp án P95 (ms) | 82.92 | 53.50 |
| Heap trước / sau (MiB) | 20.58 / 19.80 | 31.32 / 31.71 |

Heap sau forced GC: **13.65 MiB**. Avatar texture giữ 20, tổng texture 73 (trước 67, tăng 6 texture cây/cờ). Lúc xuất phát đủ 20 avatar; camera dẫn đầu lúc đo có 15 nhãn nhìn thấy. Chưa soak test nhiều giờ hoặc đo VRAM. Giai đoạn 5 không forced GC nên không tính phần trăm tiết kiệm heap giữa điều kiện khác nhau.

Một lượt trước gộp broadcast đạt 46,93 FPS / RTT P95 122,21 ms, một lượt khác khoảng 52 FPS. Bảng dùng lượt mới nhất, không chọn FPS cao nhất. Renderer riêng đạt 55–60 FPS ở mẫu 20 xe; toàn ứng dụng chưa đạt mục tiêu này ổn định.

Node benchmark: server + 21 client chung tiến trình, khoảng 5 giây; CPU phần trăm một lõi; RSS/heap bao gồm bot.

| Chế độ | RTT P95 ms | CPU % | RSS MiB | Heap MiB | Socket out MB/s |
|---|---:|---:|---:|---:|---:|
| Trước gộp, RAM đối chứng | 35.32 | 4.86 | 138.66 | 31.52 | 1.366 |
| Trước gộp, SQLite | 55.77 | 5.52 | 139.73 | 33.73 | 1.379 |
| Sau gộp, RAM đối chứng | 5.98 | 4.07 | 119.92 | 32.90 | 1.004 |
| Sau gộp, SQLite | 67.93 | 4.06 | 122.55 | 37.87 | 0.991 |

Sau gộp, SQLite gửi 0,991 MB/s so với 1,379 MB/s trước gộp. Đây là payload Engine.IO, chưa gồm transport headers/TLS/retransmission. Đáp án/next/lane gửi frame cá nhân ngay, giáo viên và client khác cập nhật theo tick 100 ms, tránh broadcast cả phòng 20 lần trong một đợt đáp án. Điểm/hạng vẫn do server tính. fsync làm RTT SQLite cao hơn RAM; số loopback không đại diện Internet/Wi-Fi.

JSON: `benchmarks/render-baseline.json`, `render-after.json`, `network-uncoalesced.json`, `network-sessions.json`, `sessions-browser-precoalescing.json`, `sessions-browser-metrics.json`.

## Kết quả kiểm thử và giới hạn

- TypeScript đạt; **33/33 unit/integration test đạt**: migration v1 giữ nguyên giáo viên/lớp/học sinh/ảnh; 20 phiên, đáp án/receipt sau restart, quyền lịch sử, cách ly/xóa dữ liệu lỗi, CRUD/backup và regression game.
- Build client/server/CLI đạt. Chunk Phaser vẫn khoảng 1,50 MB (346 KB gzip), lazy-load; màn học sinh không tải Phaser.
- Chromium đạt: 20 avatar đúng xe qua thay hạng/camera; restart backend giữa cuộc đua, giữ 20 danh tính/câu/điểm, paused chờ giáo viên; offline 22 giây; lịch sử UI xem/xuất/xóa không bị checkpoint tạo lại; giữ lớp/hồ sơ; chơi đơn không lỗi JavaScript.
- Smoke bản đã build dùng tiến trình Node con thật và CLI: restart vẫn giữ lớp/ảnh/cookie và phòng đua, điểm/câu/token, không thưởng trùng; backup → verify → restore vào thư mục mới.
- Chưa kiểm thử 20 điện thoại thật, mất điện, ổ đĩa đầy hoặc tự phục hồi file khóa sau SIGKILL. SIGKILL có thể để lại `.lock` cần xác minh/xử lý; đây là giới hạn khóa giai đoạn 5. Crash có thể lùi khoảng 1 giây vật lý; không hứa giữ từng frame. Lỗi ghi SQLite không trả ACK thành công, có thể dừng tiến trình/tạm dừng phòng; cần sửa lưu trữ và khởi động lại.
- Một Node process, tối đa 50 phòng trong RAM, chưa clustering/HA. SQLite sync/JSON checkpoint/fsync có thể tăng latency với nhiều phòng hoặc bộ đề ảnh lớn; chưa benchmark tải nhiều phòng/hàng nghìn buổi.
- Lịch sử tối đa 200 hàng/truy vấn, ngày lọc UTC; chưa phân trang, retention tự động, chia sẻ giữa giáo viên hoặc phục hồi token học sinh đã mất. Chính sách backup/xóa cần áp dụng cả dữ liệu buổi chơi.
- Chưa có soak test nhiều giờ, profiler GPU hay chứng minh tuyệt đối không rò rỉ. Các lượt render là mẫu ngắn, cần nhiều lượt và máy trình chiếu thật.

Kiểm tra 20 điện thoại thật: dùng checklist Wi-Fi trong CLASSROOMS.md, thêm bước dừng sạch Node giữa cuộc đua và mở lại cùng volume; kiểm tra đủ 20 token khôi phục, paused, đúng câu/điểm/ảnh, giáo viên tiếp tục, đáp án cũ không được thưởng lại. Kiểm tra lịch sử/xuất/xóa sau đó. Ghi riêng máy/AP, FPS/RSS/RTT và thời gian phục hồi; không xem mô phỏng cloud là kết quả thiết bị thật.
