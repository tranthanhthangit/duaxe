# Đường đua chung 3 làn — 20 xe

## Hành vi hiện tại

Đã loại bỏ lưới 5 cột dùng để giãn xe của giai đoạn 4. Xe được chiếu trực tiếp từ `distance` và `lane` đã nội suy. Không đẩy xe sang vị trí khác để tránh chồng hình; điểm, va chạm, quãng đường và hạng vẫn do server quyết định.

Máy chủ bố trí 20 học sinh thành 7 hàng, tối đa 3 xe/hàng, cách nhau 42 m. Hàng đầu ở tọa độ 0 m, các hàng sau ở -42…-252 m, phía sau vạch 0. Đây là vị trí xuất phát vật lý thực được gửi trong snapshot và dùng trong xếp hạng, không phải offset hiển thị. Tất cả về cùng đích 3200 m, vì vậy hàng sau phải đi xa hơn hàng đầu. Không thay đổi điểm để bù khoảng cách. ID, màu, số hiệu, làn và vị trí được giữ khi khôi phục phiên. Chơi đơn giữ nguyên cấu hình xuất phát cũ.

Phối cảnh dùng chung cho xe, vạch làn và chướng ngại vật. Xe xa nhỏ, xe gần lớn; nội suy làn tạo chuyển động ngang mượt. Sprite cache theo màu, chữ/số tái sử dụng; vệt tăng tốc và bụi nhẹ không tạo hàng loạt particle object. Lớp sprite theo chiều sâu: xe gần che xe xa khi chúng đi vào cùng một vị trí. Đây là che khuất tự nhiên, không phải thay đổi hạng.

Chỉ nhãn được dời khỏi xe hoặc ẩn nếu không tìm được ô trống; có đường chỉ tới xe. Ô nhãn tránh cả thân xe và nhãn khác. Tên đầy đủ luôn có trong bảng xếp hạng và tooltip bản đồ tiến độ. Bảng xếp hạng có chỉ báo ⚡ tăng tốc.

Camera mặc định theo trung bình 3 xe dẫn đầu, có làm mượt vị trí/range để không nhảy khi đổi người dẫn đầu. Lúc xuất phát camera giữ đủ 7 hàng. Toàn cảnh lấy biên vị trí thực của toàn đoàn xe; có thể chọn riêng một học sinh. Camera cận cảnh có thể không chứa các xe tụt xa; bản đồ tiến độ luôn hiển thị đủ 20 số xe và cho phép chọn theo dõi. Có nút camera dẫn đầu/toàn cảnh và ẩn/hiện bảng xếp hạng; canvas tự cập nhật kích thước khi mở rộng.

## Kiểm thử và số đo

- TypeScript đạt; 25/25 unit/integration tests đạt.
- Build frontend/backend thành công. Vẫn có cảnh báo chunk Phaser lớn (~344 KB gzip), tải riêng cho chơi đơn/giáo viên.
- Các test mới xác nhận 7 hàng không trùng tọa độ, không chồng nghiêm trọng thân xe cùng làn tại xuất phát, phép chiếu giữ đúng làn và tỉ lệ xa/gần, camera không phụ thuộc thứ tự mảng, toàn cảnh chứa toàn đoàn, nhãn tránh nhau, xe hàng sau tăng tốc vượt thật xe hàng trước và hạng server thay đổi tương ứng.
- Bộ test mạng tiếp tục kiểm tra 20 client đồng thời, đáp án trùng, reconnect, quyền giáo viên, thay đổi hạng, pause/resume/end. Kiểm tra mọi xe đều tiến lên so với chính vị trí xuất phát của mình.
- Chromium smoke: 1 học sinh trình duyệt + 19 client Socket.IO, đủ 20 xe/bản đồ, đổi camera, chọn xe, ẩn/hiện bảng hạng, trả lời/tăng tốc, chuyển làn, mất mạng 22 giây rồi khôi phục cùng trang, tab trùng, giáo viên reload và xuất JSON/CSV. Không có lỗi JavaScript. Giao diện học sinh không tải Phaser.
- Kiểm thử hồi quy riêng chế độ chơi đơn/trình soạn: bắt đầu, đáp án đúng/sai, pause, restart, ảnh, đổi thứ tự và nhập/xuất bộ đề đều đạt.

Dữ liệu thô: `benchmarks/three-lanes.json`. Môi trường cloud Linux, Chromium headless, Vite dev, loopback; mẫu render 8 giây với 20 người, không phải 20 điện thoại thật:

| Chỉ số | Kết quả |
|---|---:|
| FPS requestAnimationFrame | 42,95 |
| FPS Phaser, cửa sổ rolling | 42,67 |
| Frame time p95 rAF | 33,40 ms |
| RTT đáp án trung vị / p95 | 30,16 / 52,59 ms |
| JS heap giáo viên trước / sau mẫu | 39,21 / 40,05 MiB |
| Texture kể cả chữ | 43 |

RTT đo burst 19 bot vì học sinh trình duyệt đã trả lời trước; integration test riêng kiểm tra 20 đáp án đồng thời. RTT không bao gồm bộ đệm trình bày 150 ms. JS heap là ảnh chụp tức thời, không ép GC, không phải tổng RAM/GPU hoặc bằng chứng không rò rỉ. Không dùng số đo ngắn này để khẳng định cải thiện phần trăm hoặc ổn định 60 FPS.

Chạy lại với server/Vite đang chạy:

```sh
npm run typecheck
npm test
npm run build
BENCHMARK=1 BROWSER_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

Nếu dùng browser Playwright đã cài, bỏ biến executable path. Screenshot và số đo ghi `/tmp/duaxe-three-lanes-*`. Hướng dẫn chạy LAN/hosting ở `MULTIPLAYER.md`; checklist 20 điện thoại Wi-Fi thật ở `PERFORMANCE.md` vẫn áp dụng, nhưng thay tiêu chí bố trí giãn bằng: xe đúng 3 làn, không đổi tọa độ để nhường chỗ cho nhãn.

## Giới hạn

- Chưa kiểm thử thiết bị thật; FPS môi trường cloud chưa đạt 60. Cần đo lại trên máy chiếu/máy giáo viên và Wi-Fi thực.
- Xe cùng làn cùng tọa độ có thể che nhau trong lúc vượt. Không có va chạm xe–xe hoặc luật tự nhường làn; số xe, hạng và bản đồ giúp theo dõi.
- Nhãn và số xe rất xa có thể nhỏ hoặc được ẩn. Chọn xe hoặc xem bản đồ/bảng hạng để nhận diện đầy đủ.
- Khi toàn đoàn cách nhau rất xa, toàn cảnh nén phối cảnh khiến vài xe khó phân biệt. Camera theo xe và bản đồ là lựa chọn bổ sung.
- Có độ trễ trình bày 150 ms; mất mạng dài có thể cần hiệu chỉnh về vị trí mới. Các giới hạn RAM, TTL phòng và cửa sổ biên nhận lệnh của giai đoạn 3–4 giữ nguyên.

## File thay đổi

Mới: `src/game/perspective.ts`, `src/online/ProgressMap.tsx`, `THREE_LANE_TRACK.md`, `benchmarks/three-lanes.json`.

Sửa: `server/Room.ts`, `src/game/RaceScene.ts`, `src/online/SnapshotBuffer.ts`, `src/online/RemoteTrack.tsx`, `src/online/OnlineApp.tsx`, `src/styles.css`, `tests/presentation.test.ts`, `tests/server.test.ts`, `scripts/browser-smoke.cjs`, `README.md`, `PERFORMANCE.md`.

`RaceModel` và cơ chế chấm câu hỏi/khôi phục phiên đã được kiểm tra, tiếp tục tái sử dụng; không viết lại game.
