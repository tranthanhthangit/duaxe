# Báo cáo giai đoạn 4 — tối ưu 20 người chơi

## Thay đổi

- Server tính/sort danh sách xe một lần mỗi lần phát, dùng chung cho giáo viên và 20 học sinh; phần câu hỏi riêng vẫn chỉ gửi tới chủ phiên.
- Xe có số hiệu 1–20 theo thứ tự tham gia, không đổi khi vượt nhau hoặc reconnect. Bảng xếp hạng có số và tên; renderer hiển thị số trên xe và tên đầy đủ có xuống dòng.
- Nền tĩnh và thân xe được bake thành texture một lần; các xe cùng màu dùng chung texture. Sprite, text và số được tái sử dụng, không dựng lại toàn bộ hình xe mỗi frame. Giữ cây, cờ, chóp và cảnh 2.5D; không thêm engine 3D.
- Bộ đệm tối đa 24 snapshot, lùi thời điểm hiển thị 150 ms, nội suy giữa hai snapshot; không ngoại suy lúc mất gói. Bỏ snapshot trùng/cũ. Sau khoảng trống hơn 1 giây, bỏ lịch sử cũ và lấy trạng thái mới. Pause/end dùng ngay vị trí cuối đã xác nhận.
- Camera mặc định theo trung bình nhóm 3 xe dẫn đầu, dịch chuyển camera có làm mượt. Có góc toàn bộ đường đua và chọn một học sinh. Tất cả 20 xe vẫn có mặt; bố trí các khung xe/tên riêng để giảm chồng hình. Tọa độ giãn là trình bày, không phải khoảng cách vật lý; số liệu quãng đường/thứ hạng vẫn từ server.
- Mỗi lệnh điều khiển có commandId. Server giữ tối đa 128 biên nhận thành công/người sở hữu, gửi lại kết quả khi nhận trùng ID và cùng nội dung, kể cả sau reconnect. ID bị dùng cho nội dung khác bị từ chối. Câu hỏi còn được bảo vệ bởi ID câu và trạng thái đã chấm; không cấp thưởng hai lần.
- Câu hỏi có sequence/index, bỏ bản cũ và chỉ ghép với frame cùng index. ACK của kết nối cũ không được mở khóa UI của kết nối mới. Khi offline có thông báo rõ và khóa điều khiển, vẫn phục hồi bằng token hiện có.
- Lazy-load Phaser của giai đoạn 3 được giữ nguyên. Browser smoke kiểm tra tài nguyên trên trang học sinh không có chunk Phaser/RaceScene/RemoteTrack, không chỉ kiểm tra số canvas.

## Đo lường

Xem dữ liệu thô ở `benchmarks/stage4.json`. Đo trên cloud Linux x86_64, 5 CPU được báo khả dụng, Chromium headless, Vite development, mạng loopback. Có 1 trình duyệt giáo viên, 1 trình duyệt học sinh kích thước 390 px và 19 Socket.IO clients trong Node. Mẫu render 8 giây ở trạng thái chạy, đủ 20 xe; không phải 20 điện thoại thật. FPS lấy từ requestAnimationFrame của trang và delta của Phaser; RTT tính từ lúc gửi request đến lúc nhận ACK. RTT không bao gồm độ trễ trình bày 150 ms.

Lần đo cuối:

| Chỉ số | Kết quả |
|---|---:|
| FPS requestAnimationFrame | 44,94 |
| FPS Phaser (cửa sổ rolling) | 45,77 |
| Frame time p95 (rAF) | 33,40 ms |
| Frame time p95 (Phaser) | 26,67 ms |
| RTT trung vị, 19 client cùng trả lời | 25,07 ms |
| RTT p95, 19 client cùng trả lời | 36,76 ms |
| JS heap giáo viên đầu/cuối mẫu | 45,11 / 41,45 MiB |
| Texture trong game (kể cả text) | 43 |
| RSS Node sau lần đo cuối | 79.816 KiB ≈ 77,95 MiB |

Bài unit/integration riêng kiểm tra **20** đáp án đồng thời; trong benchmark 1 học sinh trình duyệt đã trả lời trước nên mẫu RTT burst có **19** client. Offline 22 giây đã được xác nhận bằng thông báo mất kết nối, sau đó khôi phục cùng trang và kiểm tra điểm/câu hỏi cũ. Các lần đo 8 giây trước đó dao động khoảng 45–47 FPS rAF và RTT p95 27–66 ms; không suy ra ổn định dài hạn. Không có phép đo baseline trước thay đổi, vì vậy không khẳng định phần trăm tăng tốc. Heap JavaScript là số tức thời từ Chrome Performance metrics, không phải tổng RAM/GPU, không ép GC và không chứng minh không rò rỉ bộ nhớ. RSS Node đo riêng sau bài kiểm thử, bao gồm các phòng RAM còn được giữ và runtime dev.

## Kiểm thử đã thực hiện

- `npm run typecheck`: đạt.
- `npm test`: 22/22 đạt. Bao gồm 20 kết nối đồng thời, 20 câu trả lời cùng lúc, trả lời lại không nhân điểm, vượt xe/thay đổi hạng, token và quyền giáo viên, khôi phục/tab trùng, idempotency lệnh qua reconnect, pause/resume/end, thứ tự snapshot, bố trí 20 xe, timeout, giới hạn phòng và xuất kết quả.
- `npm run build`: client và server đạt. Phaser vẫn là chunk lớn (~1,49 MB minify, ~345 KB gzip), tải riêng cho giáo viên/chơi đơn.
- Chromium browser smoke: đủ 20 người, QR, câu hỏi/tăng tốc/chuyển làn, duplicate tab, giáo viên reload/pause/resume/end, JSON/CSV, học sinh không tải renderer. Benchmark bổ sung offline 22 giây, kiểm tra thông báo mất kết nối và phục hồi cùng trang.

Chạy lại khi server/Vite đang hoạt động:

```sh
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium BENCHMARK=1 npm run test:browser
```

Có thể bỏ `BROWSER_EXECUTABLE_PATH` nếu đã cài Chromium của Playwright. `BROWSER_BASE_URL` đổi origin test; phải khớp CORS. File số đo và screenshot ghi vào `/tmp/duaxe-stage4-*`. Không chứa token trong báo cáo.

## Giới hạn còn lại

- Chưa đo trên 20 điện thoại thật, Wi-Fi mất gói hoặc máy giáo viên phổ thông; chưa đảm bảo 60 FPS. Thời gian đo ngắn, không thay thế soak test dài.
- Bộ đệm làm chậm hình khoảng 150 ms; không dự đoán chuyển động khi mất mạng. Phục hồi sau mất mạng dài có thể cần điều chỉnh vị trí tới snapshot hiện tại; không giả lập xe chạy tiếp để che giấu mất gói.
- Bố trí chống chồng là sơ đồ giãn vị trí, nên xe có thể xuất hiện lệch khỏi vị trí/làn hình học chính xác của đường. Khi đổi camera/đổi ô, một số xe có thể đi qua nhau trong lúc tween; các ô đích không chồng. Bảng xếp hạng và trạng thái làn/quãng đường là nguồn thông tin chính xác. Tên quá dài xuống dòng.
- Biên nhận lệnh có giới hạn 128; không đảm bảo replay lệnh chuyển làn/control đã bị loại khỏi cửa sổ đó. UI không tự retry các lệnh cũ. Chống thưởng lặp theo câu hỏi vẫn tồn tại cả phiên.
- Dữ liệu vẫn lưu RAM một tiến trình Node; restart server mất phòng. Chưa có phân phối nhiều máy hoặc lưu bền vững. Các giới hạn/TTL/CORS giai đoạn 3 tiếp tục áp dụng.

## Checklist 20 điện thoại thật trên Wi-Fi

1. Đọc `MULTIPLAYER.md`, chạy server và Vite. Máy giáo viên dùng LAN IP, thêm đúng origin vào `CORS_ORIGINS`, mở firewall cổng frontend. Cùng SSID, tắt AP isolation; ưu tiên Wi-Fi 5 GHz và máy giáo viên nối Ethernet.
2. Dùng 20 điện thoại riêng, đặt tên Bé 01…20, chọn đủ các màu xe. Quét QR công khai/LAN; kiểm tra server ghi nhận đúng 20, thiết bị thứ 21 bị từ chối. Không dùng 20 tab chung localStorage để thay cho 20 thiết bị.
3. Ghi mẫu máy/OS/trình duyệt, cấu hình máy giáo viên, phiên bản build, router/băng tần và khoảng cách. Chạy tối thiểu 10–15 phút; dùng các cuộc đua mới khi cần vì một cuộc đua ngắn hơn khoảng này.
4. Cho tất cả trả lời đúng cùng lúc, sau đó chia nhóm đúng/sai; xác nhận mỗi câu chỉ có một kết quả, điểm +10/câu đúng, tăng tốc 3 giây, thứ hạng đổi khi vượt nhau. Thử nhiều lần bấm nhanh cùng một đáp án.
5. Chuyển các góc camera; đọc đủ 20 số/tên, kiểm tra không bị che tên ở trạng thái ổn định. Theo dõi bảng xếp hạng, tránh so vị trí xe đã giãn với thứ tự vật lý.
6. Tạm dừng: đồng hồ, xe và điểm phải ngừng; tiếp tục không tự reset. Tắt Wi-Fi trên 2–3 máy trong 5/15/30 giây, đợi chỉ báo offline, bật lại và kiểm tra giữ playerId, tên, màu, điểm và kết quả cũ, không tạo người thứ 21. Nếu phòng vẫn chạy, quãng đường/thời hạn câu có thể tiếp tục tăng trong lúc máy offline; đó là hành vi server thiết kế.
7. Mở tab thứ hai của cùng phiên, kiểm tra chỉ tab mới điều khiển. Mất kết nối máy giáo viên: phòng tự pause; quay lại và chủ động Tiếp tục.
8. Đo FPS/frame time tại canvas giáo viên bằng DevTools Performance trong ít nhất 60 giây ở mỗi góc; ghi median/p95. Đo RTT request/ACK qua DevTools/đo tương tự script, ghi median/p95, không gộp với thời gian đọc câu hoặc phản ứng tay. Ghi JS heap/RSS đầu, cuối và sau GC; so nhiều lần chạy trước khi kết luận rò rỉ.
9. Kết thúc, xuất JSON/CSV và đối chiếu 20 playerId, điểm, từng đáp án và thời gian. Ghi riêng reconnect thất bại, thời gian phục hồi, FPS thấp, thiết bị nóng, mạng hoặc tab nền bị hệ điều hành đình chỉ.

## File thay đổi ở giai đoạn này

- Mới: `src/online/SnapshotBuffer.ts`, `tests/presentation.test.ts`, `PERFORMANCE.md`, `benchmarks/stage4.json`.
- Sửa: `src/game/RaceScene.ts`, `src/online/RemoteTrack.tsx`, `src/online/OnlineApp.tsx`, `src/online/useRoom.ts`, `src/styles.css`, `server/Room.ts`, `server/app.ts`, `shared/protocol.ts`, `tests/server.test.ts`, `scripts/browser-smoke.cjs`, `README.md`, `MULTIPLAYER.md`.

## Bản cập nhật đường đua 3 làn

Cách bố trí giãn xe của báo cáo này đã được thay bằng phép chiếu tọa độ thật và hàng xuất phát do server quản lý. Xem [THREE_LANE_TRACK.md](THREE_LANE_TRACK.md) để biết hành vi và benchmark hiện tại; số đo giai đoạn 4 ở trên được giữ làm lịch sử, không phải số đo phiên bản mới nhất.
