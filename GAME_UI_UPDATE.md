# Cập nhật giao diện theo ba ảnh thiết kế

Ngày 06/11/2026 (UTC+7). Chỉnh trực tiếp dự án hiện có, giữ RaceModel, luật thi đấu, Socket.IO/reconnect, xác thực, SQLite, migration và dữ liệu lớp/ảnh. Không thay cấu hình triển khai cloud, không publish.

## Tình trạng ảnh gốc — CHƯA HOÀN TẤT PHẦN GHÉP ẢNH

Ba ảnh được nhìn thấy trong hội thoại nhưng thư mục attachment truy cập được chỉ chứa các tệp văn bản, không có bản nhị phân PNG/JPEG. Đã kiểm tra repository và thư mục đính kèm; các file sau **chưa có**:

- `public/assets/game-ui/home-background.png`
- `public/assets/game-ui/create-room-background.png`
- `public/assets/game-ui/race-background.png`

Không dùng ảnh khác hoặc ảnh AI thay thế; không tạo file giả mang tên các ảnh này. Home/create hiện hiển thị giao diện pastel khi thiếu file; không hiện biểu tượng ảnh hỏng. Đường dẫn đã nối sẵn qua `DesignBackdrop.tsx`: thêm đúng ảnh gốc rồi build lại sẽ kích hoạt nền và bố cục vùng an toàn. Không cần đổi logic game. Có hướng dẫn trong `public/assets/game-ui/README.md`.

Vì thiếu ảnh, **chưa thể tuyên bố giao diện đã khớp hoàn toàn ba thiết kế**, chưa kiểm chứng cắt cảnh/cô giáo/logo bằng asset thật. Không tìm thấy file font VNI-Avo/woff/ttf/otf trong mã dự án; dùng font hệ thống hỗ trợ tiếng Việt, không tải font ngoài.

## Khảo sát và thay đổi giao diện

- Trước sửa đã đọc main/SoloApp/OnlineApp, ClassroomPanel, useRoom, RaceScene, perspective, config, styles, GameCanvas và các script Chromium/render hiện có.
- Root `/` trước đây mở solo; nay mở HomeScreen. Các đường dẫn `?mode=solo`, `?mode=teacher`, `?mode=student&room=...` vẫn hoạt động. Home không mở socket hoặc tải Phaser.
- Trang chủ: hai nút chính tạo/tham gia, nút hướng dẫn dùng dialog thật (Escape/đóng, focus native), tài khoản giáo viên tới form đăng nhập đang có, đường dẫn chơi thử solo. Không tạo chức năng giả.
- Có ảnh gốc: ẩn tiêu đề fallback để không chồng logo trong ảnh; desktop giữ tỷ lệ 1672:941, nút ở khoảng giữa; mobile giữ đầy đủ ảnh ở trên và xếp nút bên dưới.
- Màn tạo phòng: thẻ kem, chọn lớp/hồ sơ, đăng nhập, quản lý, bộ đề/editor/import/export/thời gian câu hỏi giữ nguyên. Lỗi/kết nối/loading có trạng thái rõ. Khi có ảnh, form lệch phải từ30% và nằm dưới bảng tiêu đề; mobile đặt dưới toàn bộ ảnh, không ép form desktop lên mặt cô giáo.
- Màn chờ: QR192 px có quiet zone4 module (tablet trung gian168 px theo layout), mã phòng, online count, roster/avatar và thao tác giải phóng/bỏ chọn còn nguyên. Roster riêng có giới hạn chiều cao/scroll; bảng xếp hạng đủ20 người cuộn riêng. Các nút start/pause/resume/end/configure vẫn gọi handler cũ.
- Đang đua: header/HUD gọn hơn, QR nằm trong mục “Hiện mã QR” mở được để tăng diện tích quan sát; camera dẫn đầu/toàn cảnh/từng xe, ẩn bảng, boost indicator, tên/avatar và minimap giữ nguyên. Giữ canvas tỷ lệ3:2 theo projection900 ×600; không kéo canvas sang16:9 làm méo làn.
- Responsive ở1920 ×1080,1366 ×768,768 ×1024,390 ×844; không tràn ngang trong kiểm thử. Hover/press nhẹ, form xuất hiện ngắn; reduced-motion tắt animation/transition.

## Phaser và ảnh tham chiếu đường đua

Không đặt toàn bộ `race-background.png` dưới hoặc trên mặt đường. Ảnh có camera cố định, trong khi scene thay cameraRange/cameraDistance; dùng nguyên ảnh sẽ tạo hai mặt đường và cổng đích sai tiến độ.

`environment.ts` tái tạo hướng mỹ thuật bằng Graphics: trời xanh, cầu vồng, mây/cây, trường học/cờ, hoa, khán đài có khán giả tĩnh, đèn. Bake vào texture duy nhất lúc đầu. Mặt đường tím xám và lề đỏ/kem dùng cùng hình học với projectRoad; vạch làn/xe vẫn do renderer điều khiển. Cảnh trang trí đứng ngoài đường, depth ở sau sprite/nhãn xe. Không đổi tọa độ để giãn hạng.

Cổng đích có sọc caro và nhãn “ĐÍCH” được vẽ khi `trackLength - cameraDistance` trong tầm nhìn. Cả vạch đất/cổng/nhãn dùng projectRoad và trackLength3200 m, không có cổng tĩnh ở horizon mọi lúc. Nhãn Text tạo một lần, chỉ đổi vị trí/scale/visibility; scenery bake một lần, cache xe/avatar giữ như cũ. Không thêm ảnh đại diện hoặc texture mỗi frame; một texture Text mới cho nhãn đích là chi phí cố định.

## File chỉnh sửa và tạo mới

| File | Thay đổi |
|---|---|
| `src/main.tsx` | Home lazy-load mặc định, giữ route cũ, thêm link về trang chủ và CSS UI |
| `src/online/OnlineApp.tsx` | Class cho setup/lobby/race/student, hookup ảnh đúng path, vùng account, QR lớn/collapsible khi đua, trạng thái busy và footer |
| `src/game/RaceScene.ts` | Bake environment, lề đường cùng projection, cổng/nhãn đích theo tiến độ |
| `src/ui/HomeScreen.tsx` (mới) | Trang chủ/nút có chức năng/dialog hướng dẫn |
| `src/ui/DesignBackdrop.tsx` (mới) | Mapping ảnh gốc, load/error, fallback an toàn |
| `src/ui/game-ui.css` (mới) | Skin pastel, form/button/QR/HUD, safe areas, responsive/reduced motion |
| `src/game/environment.ts` (mới) | Cảnh quan vẽ/bake một lần theo ảnh tham chiếu |
| `scripts/ui-browser.ts` (mới) | Responsive, routes/dialog, QR20 xe, camera/pause/resume/end, aspect ratio/safe areas và finish gate |
| `public/assets/game-ui/README.md` (mới) | File ảnh thiếu và hướng dẫn đặt ảnh gốc |
| `GAME_UI_UPDATE.md` (mới) | Báo cáo này |
| `benchmarks/ui-redesign/` (mới) | Screenshot/dữ liệu giả và kết quả test/render trước-sau |

Không sửa package.json/lockfile, styles.css cũ, RaceModel/config/perspective, server/shared/useRoom, SQLite/schema, CLASSROOM_* hoặc tài liệu giai đoạn9. Build sinh lại dist/dist-server/tsbuildinfo; các benchmark/screenshot cũ của giai đoạn7 đã được bảo toàn khi chạy script regression.

## Kiểm thử thực thi

- TypeScript: đạt sau sửa lỗi typing trong script kiểm thử mới và thay Graphics.fillStar (không có trong Phaser3) bằng path star bake một lần.
- `npm test`: **36/36 đạt**, không fail/skip; gồm luật đua, hạng,20 client, profile claims, auth, ảnh, lịch sử, restart, đáp án trùng/timeout và lỗi SQLite.
- `npm run build`: đạt Vite client và esbuild server/CLI. Vite vẫn cảnh báo chunk Phaser/RaceScene lớn: khoảng1.503,37 kB minified /347,32 kB gzip; không tải ở trang chủ/học sinh.
- Chromium mới: cả bốn kích thước qua tạo phòng,20 socket, mã/QR đúng, không token trong link,20 dòng hạng/minimap, camera, ẩn/hiện bảng, start/pause/resume/end, không tràn ngang, không JS pageerror. `checks.json` ghi kết quả.
- Kiểm tra tương lai khi có ảnh dùng PNG trong suốt tổng hợp chỉ trong route test để xác nhận tỷ lệ và vùng form. Fixture không lưu vào public, không dùng làm nền sản phẩm, không dùng chụp screenshot minh họa thiết kế. Đây không phải đối chiếu với bản PNG gốc.
- Finish fixture: không có gate ở xuất phát, gate xuất hiện khi gần3200 m; vị trí nhãn đúng theo projection/camera; vẫn20 xe. Screenshot `finish-gate.png` chỉ là fixture synthetic, cổng xa có thể bị nhãn học sinh che một phần do thứ tự ưu tiên avatar/xe.
- Bộ Chromium classroom hiện có: đạt login, tạo lớp, crop/rotate/upload, CSV import,20 hồ sơ/avatar đúng theo playerId/studentId khi đổi hạng/camera, thưởng/làn, server restart paused chờ cô, offline22 giây/resume, summary, history xem/xuất/xóa và roster còn, solo canvas. Học sinh không tải Phaser/canvas, không tràn ngang/JSerror. Dữ liệu giả/thư mục tạm, không mở DB thật.
- Có thông báo EPIPE từ proxy Vite khi đóng context trong test responsive; các assertion và app pageerror vẫn đạt. Chưa kết luận mạng thực ổn định từ phép thử này.

Lệnh chạy lại:

```sh
npm run typecheck
npm test
npm run build
UI_EVIDENCE_DIR=benchmarks/ui-redesign node --import tsx scripts/ui-browser.ts
npm run test:readiness-browser
node --import tsx scripts/render-benchmark.ts /tmp/ui-render-current.json
```

`test:readiness-browser` mặc định ghi benchmark/screenshot giai đoạn7; nếu chạy lại cần sao lưu/khôi phục hoặc giữ kết quả mới riêng như phiên này. Các bản mới của lần regression này ở `benchmarks/ui-redesign/regression/`.

## Ảnh chụp để xem lại

- [Trang chủ1920](benchmarks/ui-redesign/home-1920.png), [tạo phòng1366](benchmarks/ui-redesign/create-1366.png).
- [Màn chờ1920](benchmarks/ui-redesign/lobby-1920.png), [màn chờ390](benchmarks/ui-redesign/lobby-390.png).
- [Đường đua1366](benchmarks/ui-redesign/race-1366.png), [đường đua768](benchmarks/ui-redesign/race-768.png).
- [Màn học sinh](benchmarks/ui-redesign/regression/classroom-phone.png), [20 avatar lúc xuất phát](benchmarks/ui-redesign/regression/classroom-start.png).

Các ảnh home/create/lobby là fallback khi thiếu asset gốc; không được coi là bản thiết kế đã ghép ảnh. Đủ ảnh home/create/lobby/race ở cả bốn kích thước trong cùng thư mục.

## FPS trước/sau

Dùng cùng script renderer độc lập, cloud headless Chromium, ảnh tổng hợp,3 giây/mẫu; không phải20 điện thoại thật hoặc FPS production. Một lượt sau bị trùng build được giữ riêng `render-after-with-build.json`, không dùng so sánh vì không cùng điều kiện; đo lại khi không có build/test khác chạy song song.

| Số xe | RAF FPS trước | RAF FPS sau (lượt sạch cuối) | P95 frame trước / sau |
|---|---:|---:|---:|
| 5 | 53.37 | 51.76 | 33.30 / 33.30 ms |
| 10 | 52.71 | 51.38 | 33.30 / 33.40 ms |
| 15 | 51.71 | 49.39 | 33.40 / 33.40 ms |
| 20 | 51.10 | 49.45 | 33.40 / 33.40 ms |

Nguồn JSON: `benchmarks/ui-redesign/render-before.json` và `render-after.json`. Đây là một lượt/mỗi cấu hình, không đủ để kết luận cải thiện/hồi quy nhỏ có ý nghĩa thống kê. Không chọn số FPS cao nhất từ các lượt. Chưa đo được ảnh hưởng decode/render hai PNG gốc vì ảnh chưa có.

Toàn UI giáo viên trong regression (1 teacher+1 mobilebrowser+19 socket, Vite dev, cửa sổ8 giây): RAF42,66 FPS, P95 frame33,40 ms; RTT đáp án19 bot median72,66/P9579,45 ms; heap sauGC13,57 MiB;74 texture tổng/20 avatar,15 avatar nhìn thấy tại mẫu đang đua do chống chồng,20 avatar lúc xuất phát đã được test. Đây là phép đo khác benchmark renderer độc lập, không so trực tiếp FPS hai môi trường. Không có baseline toànUI cùng điều kiện trong phiên này để quy chênh lệch cho skin mới.

## Phần còn thiếu

1. Cần ba tệp PNG gốc tại đúng đường dẫn để hoàn thành ghép nền và kiểm tra trực quan nhân vật/logo/cô giáo. Không thể xác nhận độ giống hoàn toàn chỉ bằng fixture tỷ lệ.
2. Scene theo hướng mỹ thuật tham chiếu nhưng vẫn dùng vector/sprite hiện có; chưa phải dựng đồ họa3 D giống hệt ảnh.
3. Chưa quét QR bằng camera điện thoại thật; chưa kiểm20 điện thoại/tablet thật, GPU thấp hoặc buổi Wi-Fi dài. Chưa kiểm deployment/cloud; chưa thay kết luận sẵn sàng lớp học trong CLASSROOM_READINESS.md.
