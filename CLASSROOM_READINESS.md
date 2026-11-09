# Kiểm thử và ổn định lớp học — giai đoạn 7

Ngày 06/11/2026 (Asia/Ho_Chi_Minh). **Chưa xác nhận sẵn sàng triển khai lớp học thật.** Chưa có 20 điện thoại/máy tính bảng và AP Wi-Fi thực để chạy nghiệm thu. Các kết quả dưới đây là test tự động, Chromium và mô phỏng loopback bằng dữ liệu giả.

## Lỗi đã sửa

1. File khóa chỉ chứa PID trước đây chặn restart sau SIGKILL. Thay bằng `flock` của kernel, giữ file descriptor trong tiến trình Node. `.guard` là inode khóa cố định, **không unlink/rename**; kernel giải phóng khi tiến trình chết. `.lock` định dạng 2 ghi PID/host/thời điểm để chẩn đoán, không phải bằng chứng quyền sở hữu. Ghi metadata qua file tạm + rename dưới quyền khóa. Không đụng DB/WAL/SHM khi thu hồi khóa sau crash.
2. Receipt trong RAM có thể được tạo trước khi SQLite báo lỗi ghi. Nếu cho retry tiếp tục, client có thể nhận ACK từ receipt chưa commit. Server hiện khóa toàn bộ thao tác sau lỗi lưu trữ, tạm dừng mô phỏng, thông báo `storage-error` để UI khóa nút và từ chối cả retry. Phải sửa lưu trữ rồi restart; trạng thái phục hồi chỉ từ bản đã commit.
3. QR và các avatar React trước đây được render lại theo mỗi frame Socket.IO dù nội dung không đổi. Dùng `React.memo` với so sánh props mặc định, vẫn cập nhật ngay khi ảnh/tên thay đổi; không bỏ frame hay đổi cách tính hạng.
4. Thêm đo React Profiler và thời gian CPU của `RaceScene.update` khi URL có `profile=1`, giúp phân biệt chi phí React với Phaser. Không ghi tên, ID học sinh hoặc ảnh vào bộ đo.

## Khóa và vận hành sau crash

Yêu cầu mới: **Linux, util-linux `flock` trong PATH, filesystem local**, một server Node cho mỗi DB. Không hỗ trợ chia sẻ SQLite qua NFS/SMB, nhiều host hay nhiều worker có RAM phòng riêng. `command -v flock` phải thành công trước khi chạy.

- Mở `.guard` bằng `O_NOFOLLOW`, lấy khóa độc quyền không chờ. Khóa còn bị giữ: từ chối mở DB, không xóa khóa và không dựa vào việc PID có vẻ cũ.
- Khi SIGKILL, kernel đóng FD; lần khởi động sau lấy lại quyền khóa trên cùng inode, ghi metadata mới, SQLite tự đọc/phục hồi WAL và tải phòng về paused. Phòng chưa xuất phát vẫn ready.
- Khóa cũ chỉ có PID: dùng `kill(pid,0)` để báo còn sống/không xác định hoặc PID không tồn tại. **Cả hai trường hợp đều không tự xóa/ghi đè**: PID có thể tái sử dụng hoặc thuộc namespace khác. Nội dung lạ cũng bị chặn.
- Chuyển từ bản cũ: dừng service/supervisor cũ; xác minh PID, host/namespace, cổng và file DB đang mở bằng công cụ quản trị (`ps`, `ss`, `lsof` nếu có). Với khóa legacy còn sót, chỉ sau xác minh không có writer mới lưu trữ lại riêng `.lock` sang tên backup rồi khởi động bản mới. Nếu không xác minh được, dừng và nhờ quản trị viên; không dùng `rm *.lock`. Không xóa `.guard`, `.sqlite`, `-wal`, `-shm`.
- Giữ `.guard` trên đĩa khi dừng sạch là hành vi đúng. Metadata có PID còn sống cũng có thể là Store đã đóng trong cùng tiến trình; quyền kernel là quyết định cho định dạng 2.
- Backup CLI cũng dùng cùng khóa kernel; không chạy backup trong khi server đang giữ DB. Quy trình backup/verify/restore của CLASSROOMS.md vẫn áp dụng, thư mục đích phải mới/rỗng.

ACK thành công chỉ phát sau transaction SQLite (`WAL`, `synchronous=FULL`) đã hoàn tất. Physics checkpoint khoảng 1 giây; xe có thể lùi một phần tiến độ sau crash, gồm boost/slow theo checkpoint. **1 giây là nhịp mục tiêu, không phải hard bound** khi event loop/ổ đĩa bị nghẽn. Đồng hồ mô phỏng không chạy bù thời gian server tắt. Mẫu SIGKILL bên dưới ghi mức lùi quan sát được; không hứa mất điện/ổ đĩa hỏng có cùng kết quả.

## Bảo mật đã kiểm tra

- Cookie giáo viên HttpOnly/SameSite, login sai, CORS/CSRF và ownership lớp/học sinh/ảnh/lịch sử bằng các test HTTP hiện có.
- GET ảnh chưa đăng nhập bị từ chối; giáo viên khác không đọc ảnh/lịch sử hoặc xóa kết quả. Token phòng học sinh không cấp quyền API quản trị.
- QR không chứa token. SHA-256 digests trong checkpoint; không lưu token rõ. Tranh cùng hồ sơ, resume token sai, tab trùng, đáp án trùng đều có test.
- Upload tối đa 2 MB, giới hạn 16 triệu pixel, định dạng thật, EXIF bị bỏ; đã test ảnh không hợp lệ, ảnh quá lớn, thay/xóa ảnh và quyền owner. Chưa penetration test độc lập hoặc fuzz decoder.
- Rà soát `console/logger/stdout/stderr` trong server/src: ứng dụng không log body, ảnh, tên học sinh hay token. Test tiến trình con bắt stdout/stderr và kiểm tra không chứa các giá trị bí mật/tên giả được dùng trong phiên. Đây không bao phủ log của reverse proxy, hosting, APM hoặc extension; quản trị viên phải kiểm tra riêng trước vận hành.

## Checklist 20 thiết bị thật (CHƯA THỰC HIỆN)

Chuẩn bị 20 điện thoại/tablet, máy giáo viên, một AP; dùng dữ liệu giả/biểu tượng trước. Ghi model/OS/browser của từng máy, RAM/CPU giáo viên, phiên bản server, cấu hình AP, băng tần và cường độ sóng. Gắn nhãn T01–T20. Không ghi token/ảnh thật vào phiếu đo. Dùng hai giáo viên giả để thử quyền.

| Bước | Thao tác | Kết quả cần kiểm tra | Kết quả/người thử/thời điểm |
|---|---|---|---|
| 1 | Giáo viên tạo lớp/20 hồ sơ, ảnh khác nhau, mở phòng | 20 thẻ đúng tên/ảnh, QR dùng IP LAN/HTTPS truy cập được | Chưa thử |
| 2 | T01–T20 vào cùng phòng | Chính xác 20 playerId; mỗi hồ sơ chỉ một người; online đúng | Chưa thử |
| 3 | Máy thứ 21 chọn hồ sơ T01 đã chiếm | Bị từ chối, T01 không mất quyền/điểm | Chưa thử |
| 4 | Xuất phát, 20 em trả lời đúng cùng lúc rồi thử nhấn lại | Mỗi câu chỉ 1 kết quả, +10 điểm một lần, boost 3 giây | Chưa thử |
| 5 | Trả lời sai và để hết giờ | Không thưởng, không ghi hai lần, thời gian do server | Chưa thử |
| 6 | Chuyển làn, tăng tốc, vượt xe, đổi camera | Đúng số/tên/ảnh theo xe; thứ hạng theo vị trí thật; đủ 20 trong bảng/bản đồ | Chưa thử |
| 7 | Tắt Wi-Fi T03/T09/T17 trên 25 giây rồi bật | Online/offline đúng; giữ ID/điểm/câu/làn; không thêm người | Chưa thử |
| 8 | Khóa màn hình 30 giây, rồi 60 giây trên iOS và Android | Nối lại đúng phiên; nếu câu chưa trả lời hết giờ thì ghi sai đúng một lần | Chưa thử |
| 9 | Đóng hẳn browser rồi mở lại đúng URL | Token còn trên thiết bị thì resume; không tạo hồ sơ mới | Chưa thử |
| 10 | Mở tab trùng cùng phiên | Tab mới thay thế tab cũ, tab cũ không điều khiển | Chưa thử |
| 11 | Giáo viên Pause/Resume; tắt mạng giáo viên rồi nối lại | Mô phỏng/timer dừng; chỉ tiếp tục khi cô xác nhận | Chưa thử |
| 12 | Trên dữ liệu thử, SIGKILL Node đang đua rồi restart | Tự lấy khóa v2, DB toàn vẹn, paused, 20 phiên trở lại, ACK đã nhận còn nguyên | Chưa thử |
| 13 | Kết thúc, mở lịch sử, xuất CSV/JSON | Hạng/đáp án/thời gian đúng; không ảnh nhúng/token; giáo viên khác bị chặn | Chưa thử |
| 14 | Xóa kết quả bằng owner, restart lần nữa | Kết quả không xuất hiện lại; lớp/hồ sơ/ảnh còn nguyên | Chưa thử |
| 15 | Chạy liên tục ít nhất 45–60 phút, đổi camera/ẩn bảng | Theo dõi FPS/heap/RTT, không tăng texture theo mỗi vòng; ghi mọi disconnect | Chưa thử |

Ngoại tuyến không làm xe/câu hỏi tự dừng nếu giáo viên còn online: server tiếp tục mô phỏng, có thể hết thời gian câu. Không chấm “mất câu trả lời” cho một câu chưa gửi/ACK trước mất mạng. Không xóa dữ liệu browser trong thử resume; xóa dữ liệu đồng nghĩa mất bí mật phiên.

## Đo trong lớp và tiêu chí nghiệm thu đề xuất

Đây là ngưỡng đề xuất để giáo viên/đơn vị triển khai duyệt, không phải kết quả đã đạt trên thiết bị thật:

- 20/20 tham gia, danh tính và avatar chính xác, không mất bất kỳ đáp án đã ACK hoặc tăng điểm lặp.
- Mẫu RTT tối thiểu 1.000 lệnh cả buổi: median ≤150 ms, P95 ≤300 ms, P99 ≤500 ms trên LAN; ghi cả timeout/thất bại, không bỏ mẫu lỗi. Đo từ emit tới ACK; phân biệt thời gian bảng giáo viên nhận kết quả.
- Bảng xếp hạng theo trạng thái server trong ≤500 ms ở P95. FPS giáo viên trung vị ≥45, hướng tới 55–60; ghi P95 frame time và đợt giật kéo dài. Máy học sinh không tải Phaser.
- Không disconnect ngoài kế hoạch trong buổi nghiệm thu; nếu có phải tìm nguyên nhân. Sau Wi-Fi trở lại, phục hồi trong ≤10 giây sau khi browser hoạt động lại; heartbeat có thể cần khoảng 20 giây để nhận biết rớt mạng trước đó. OS khóa màn hình phải được kiểm thử riêng.
- Soak 45–60 phút: không tăng heap giữ lại/texture không giới hạn; CPU không bão hòa liên tục; kiểm tra dung lượng đĩa trước và sau.
- Crash: DB integrity_check = ok, foreign_key_check rỗng, tất cả ACK giữ nguyên, ghi rõ rollback vật lý và thời gian khôi phục. Backup/restore vào thư mục riêng phải thành công.
- Chỉ triển khai khi checklist có người thử, thiết bị, bằng chứng và xử lý các lỗi còn mở; được nhà trường phê duyệt quyền ảnh/retention, tài khoản thật và backup. Hiện các điều kiện thiết bị thật **chưa được xác nhận**.

## Chạy thử qua Wi-Fi nội bộ

Trên máy Linux có Node 24+, `flock`, volume local bền vững:

```sh
npm ci
command -v flock
export CLASSROOM_DB_PATH=/duong-dan-volume/classroom.sqlite
export CLASSROOM_AVATAR_DIR=/duong-dan-volume/avatars
export CORS_ORIGINS=http://192.168.1.10:5173,http://localhost:5173
npm run server
```

Terminal thứ hai:

```sh
VITE_PUBLIC_APP_URL=http://192.168.1.10:5173 npm run dev
```

Thay IP bằng địa chỉ LAN của máy giáo viên. Điện thoại mở cùng địa chỉ; QR không dùng localhost. Mở cổng 5173 cho LAN, AP tắt client isolation, máy giáo viên tránh sleep, giữ IP bằng DHCP reservation. Vite proxy `/api` và `/socket.io` tới backend 3001. Không đặt `VITE_SERVER_URL` nếu dùng proxy cùng origin. Không bật NODE_ENV=production trên LAN HTTP vì cookie Secure sẽ không gửi; đây chỉ là thử có kiểm soát, dùng HTTPS/reverse proxy cùng origin khi vận hành chính thức. Chưa cấu hình firewall/AP giúp người dùng trong phiên này.

Bản build: `npm run build`, `NODE_ENV=production npm run server:start`; reverse proxy HTTPS phục vụ dist và chuyển `/api`, `/socket.io` (WebSocket upgrade), CORS đúng origin. Một worker, supervisor gửi SIGTERM trước khi cưỡng bức kill, service có quyền riêng với volume. Không expose thư mục DB/ảnh qua static server. Trước nâng cấp từ khóa legacy, thực hiện quy trình xác minh ở trên.

## Bộ kiểm thử tự động và cách chạy lại

Đã chạy `npm run typecheck`, `npm test` (**36/36 đạt**) và `npm run build` (client, server, CLI). Bộ test gồm quyền giáo viên/ảnh/lịch sử, upload, dữ liệu tiếng Việt, 20 kết nối, giới hạn phòng, trả lời đồng thời/trùng/quá hạn, nội suy, vượt xe, camera, khôi phục phiên/claims, migration và backup/restore. Hai test khóa mới kiểm tra loại trừ writer đồng thời, inode không đổi, metadata v2 có PID còn sống và khóa legacy còn sống/chết/hỏng bị từ chối mà không sửa file. Test lỗi ghi dùng `PRAGMA query_only=ON`, xác nhận cả đáp án và retry đều thất bại, DB không có đáp án chưa commit và phòng bị pause.

```sh
npm run typecheck
npm test
npm run build
npm run test:crash
npm run benchmark:readiness-network
npm run test:readiness-browser
```

`test:crash` chạy **server đã build trong tiến trình riêng**, tạo 20 hồ sơ/phiên giả, nhận 20 ACK đúng, gửi SIGKILL rồi khởi động lại bằng cùng DB, không xóa khóa. Tất cả phiên trở về paused, giữ điểm/câu/ID, replay cùng commandId không cộng lại. SQLite integrity_check đạt `ok`, foreign_key_check rỗng; backup/verify/restore giữ 20 hồ sơ và ảnh giả. Mức lùi quãng đường quan sát được: **29,95 m**, do checkpoint vật lý trước thời điểm kill. Đây là một mẫu crash, chưa phải fault injection ở mọi ranh giới commit hay thử mất điện.

`test:readiness-browser` dùng Chromium tại `/usr/bin/chromium`, một browser giáo viên, một viewport điện thoại và 19 Socket.IO client. Kiểm tra login, lớp, upload/crop/rotate, import CSV, 20 avatar gắn đúng studentId/playerId qua đổi hạng/camera, restart server, paused chờ cô xác nhận, offline 22 giây rồi resume, điểm/câu giữ nguyên, kết thúc, lịch sử xem/xuất/xóa và lớp vẫn còn. Kiểm tra điện thoại không tải Phaser/không canvas/không tràn ngang, chơi đơn có canvas, không lỗi JavaScript. Restart trong Chromium là dừng sạch; phép SIGKILL nằm trong test tiến trình riêng ở trên. Tất cả dùng thư mục tạm, không mở DB/hồ sơ/ảnh thật đã lưu.

## Số đo thực tế trong môi trường kiểm thử

Nguồn: `benchmarks/readiness-network.json`, `benchmarks/readiness-browser.json`, `benchmarks/crash-readiness.json`. Linux cloud, Node 24.22.1, Chromium headless, dữ liệu/ảnh giả. Không chạy build hoặc bộ test khác song song trong cửa sổ đo Chromium. Số đo là một lần chạy ngắn, không phải SLA.

### Mạng và đồng bộ

Mô phỏng 20 học sinh + giáo viên, cùng tiến trình Node, loopback, SQLite FULL. Ba lượt 20 đáp án đúng và 200 lệnh chuyển làn. Tổng thời gian khoảng 4,07 giây.

| Chỉ số | Trung vị | P95 | P99 | Số mẫu |
|---|---:|---:|---:|---:|
| Emit đáp án → ACK | 29,86 ms | 30,38 ms | 30,45 ms | 60 |
| Emit chuyển làn → ACK | 31,35 ms | 40,02 ms | 41,04 ms | 200 |
| Khoảng cách frame bảng xếp hạng | 100,04 ms | 102,49 ms | 120,81 ms | 45 |
| Đóng transport → kết nối lại + resume ACK | 117,03 ms | 119,81 ms | 119,81 ms | 3 |

- Từ gửi loạt đáp án đầu tiên tới frame giáo viên có đủ 20 kết quả: **88,21 ms**. Khoảng cách frame không đồng nghĩa với độ trễ một chiều.
- **3** disconnect chủ động, **0** disconnect ngoài kế hoạch trong mẫu ngắn này. Reconnect của script cố định 100 ms, còn ứng dụng dùng backoff từ 700 ms; không dùng 117 ms để hứa thời gian hồi phục Wi-Fi thật. Chưa đo P99 có ý nghĩa thống kê với chỉ 60/3 mẫu.
- Payload server gửi tổng cộng khoảng **1.096.873 byte/s** (~1,10 MB/s, 8,78 Mbit/s); nhận khoảng **4.242 byte/s**. Đo packet message ở Engine.IO, không gồm TCP/TLS/WebSocket framing; có đồng bộ lại sau resume. Không phải tốc độ tải mỗi điện thoại hay lưu lượng đo tại AP. Snapshot đầy đủ cho 20 máy vẫn tốn băng thông; cần đo Wi-Fi thực trước khi quyết định delta snapshots.

### Giao diện giáo viên, React và Phaser

Một trang giáo viên + một browser giả lập điện thoại + 19 socket; Vite dev/React StrictMode, cửa sổ đo 8 giây. JSON cuối có `checksPassed: true` chỉ sau tất cả assertion Chromium thành công.

| Chỉ số | Kết quả |
|---|---:|
| FPS requestAnimationFrame trung bình cửa sổ đo | **46,53 FPS** |
| P95 frame time requestAnimationFrame | 33,40 ms |
| FPS rolling của Phaser lúc lấy mẫu | 49,38 FPS |
| React Profiler | 80 commits; tổng actualDuration **867,20 ms**; ~10,84 ms/commit |
| CPU JS trong Scene.update | **101,40 ms / 374 frames**, ~0,27 ms/frame |
| Heap trước / sau cửa sổ đo | 38,56 / 44,70 MiB |
| Heap sau forced GC | **13,15 MiB** |
| Texture tổng / texture avatar | 73 / 20 |
| Xe / avatar nhìn thấy tại mẫu | 20 / 15 |
| RTT đáp án trong lượt Chromium (19 bot) | median 30,12 ms; P95 30,28 ms |

React actualDuration đo render component, không gồm toàn bộ effects/layout/paint. Scene.update đo xử lý JavaScript của scene, không gồm Phaser WebGL renderer chạy sau update hay GPU/compositor. Counter Phaser công bố mỗi giây nên cửa sổ delta có sai lệch biên tới khoảng một giây. Không cộng hai số này thành tổng thời gian frame, không suy ra GPU nhanh hơn React. Muốn đo tổng chi phí cần Chromium Performance trace trên máy giáo viên thật.

20 avatar đều được kiểm tra mapping playerId/studentId/texture. Tại snapshot đang chạy chỉ 15 avatar được vẽ do quy tắc tránh chồng; bảng xếp hạng vẫn có đủ 20 em. Mẫu cuối có 73 texture; chưa ghi chuỗi số đo texture qua một buổi dài để kết luận không rò rỉ.

So với kết quả giai đoạn 6 đã lưu (`sessions-browser-metrics.json`: 46,41 FPS, RTT P95 53,50 ms, heap sau GC 13,65 MiB), lượt cuối này đạt 46,53 FPS. Một lượt thăm dò trước đó đạt khoảng 50,65 FPS, cho thấy độ biến động của cloud. Không kết luận tăng FPS có ý nghĩa hay đạt 55–60 FPS; khác biệt RTT cũng chưa được đối chứng trên phần cứng cố định. Tối ưu memo giảm render lại QR/avatar không đổi, không thay độ chính xác bảng xếp hạng.

CPU toàn tiến trình/RSS không đo lại riêng trong giai đoạn 7; các số CPU/RSS giai đoạn 6 trong `network-sessions.json` chỉ là tham khảo lịch sử, không đại diện cho lần chạy này. Heap ở trên là heap JS trang giáo viên, không gồm toàn bộ RAM Chromium/server.

## Các file thay đổi trong giai đoạn này

| Nhóm | File | Nội dung |
|---|---|---|
| Khóa tiến trình | `server/classroom/ProcessLock.ts` (mới), `server/classroom/Store.ts` | Kernel flock, metadata v2, xử lý legacy an toàn, đóng FD khi lỗi |
| Độ bền đáp án | `server/app.ts`, `src/online/useRoom.ts` | Khóa thao tác sau lỗi lưu trữ; thông báo client |
| Giao diện | `src/classroom/Avatar.tsx`, `src/online/OnlineApp.tsx` | Memo avatar/QR bằng props, giữ cập nhật tên/ảnh |
| Đo render | `src/main.tsx`, `src/game/RaceScene.ts` | React Profiler và CPU Scene.update qua profile=1 |
| Kiểm thử | `tests/process-lock.test.ts`, `tests/storage-fault.test.ts` (mới) | Độc quyền khóa/legacy và lỗi ghi/ACK trùng |
| Mô phỏng | `scripts/persistence-smoke.ts`, `scripts/readiness-network.ts` (mới), `scripts/classroom-browser.ts` | SIGKILL 20 phiên, RTT/reconnect/traffic, Chromium profiling |
| Lệnh | `package.json` | test:crash, benchmark:readiness-network, test:readiness-browser |
| Tài liệu | `CLASSROOM_READINESS.md` (mới), `CLASSROOMS.md`, `PERFORMANCE_AND_SESSIONS.md` | Quy trình khóa mới, bằng chứng, giới hạn và checklist |
| Bằng chứng | `benchmarks/crash-readiness.json`, `benchmarks/readiness-network.json`, `benchmarks/readiness-browser.json` | Số đo JSON từ mô phỏng |
| Ảnh kiểm thử tạo lại | `benchmarks/classroom-start.png`, `benchmarks/classroom-overview.png`, `benchmarks/classroom-teacher.png`, `benchmarks/classroom-phone.png` | Chỉ dữ liệu/ảnh giả |

Không có migration SQL mới: schema vẫn `user_version=2`. Không thay RaceModel, luật xếp hạng hay điểm số. Chỉ nâng định dạng metadata khóa, không xóa dữ liệu lớp/ảnh.

## Giới hạn và công việc nghiệm thu còn lại

- Cần hoàn thành checklist 20 thiết bị thật, mạng Wi-Fi và khóa màn hình iOS/Android; chưa đo nhiễu sóng, AP yếu, mất điện, hỏng đĩa hoặc buổi học kéo dài. Chromium headless không thay thế điện thoại thật.
- `/api` ảnh yêu cầu giáo viên sở hữu, nhưng giao thức phòng hiện có cho người biết mã phòng xem tên hiển thị/avatar qua `preview` để chọn hồ sơ. Mã phòng là quyền vào danh sách phòng, không xác thực danh tính trẻ. Ai biết mã có thể chiếm hồ sơ chưa chọn; bí mật phiên chỉ bảo vệ sau khi claim. Không công khai QR/mã phòng; nhà trường cần duyệt cơ chế này trước khi dùng ảnh thật hoặc yêu cầu bổ sung bước cô duyệt người vào.
- Token resume ở localStorage; xóa dữ liệu trình duyệt/mất thiết bị không thể phục hồi học sinh bằng tên. Cần xử lý giáo viên giải phóng hồ sơ theo quy trình hiện có. Thời hạn phòng 2 giờ và mất giáo viên 10 phút vẫn áp dụng.
- Lỗi lưu trữ khóa cả server cho tới khi sửa và restart; không tự cứu kết quả chưa commit. Snapshot trên màn hình có thể đi trước checkpoint; chỉ ACK thành công là bằng chứng đáp án đã lưu. Không bảo đảm quãng đường không lùi.
- Linux/flock/filesystem local, một worker. Chưa hỗ trợ NFS, nhiều máy chủ hoặc Windows native. Cần kiểm tra và chuyển khóa legacy có giám sát trước nâng cấp.
- Phaser chunk khoảng 1,50 MB minified / 346 KB gzip vẫn gây cảnh báo Vite >500 KB, được lazy-load cho đường đua; học sinh không tải chunk này. Chưa thử browser production trên toàn bộ thiết bị mục tiêu.
- Các số CPU render chỉ là CPU JS đo được, không gồm đầy đủ GPU/compositor/paint. RAM và FPS của cloud biến động; chưa có soak đủ dài để kết luận không rò bộ nhớ.
- Chưa kiểm tra log/reverse proxy/APM của hạ tầng triển khai. Chưa penetration test độc lập. Không khẳng định bảo mật tuyệt đối hoặc sẵn sàng lớp học thật.
