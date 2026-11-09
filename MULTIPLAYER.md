# Phòng trực tuyến — giai đoạn 3

## Chạy tại máy phát triển

Cần Node.js 22+ và npm. Tại `/workspace/duaxe`:

```sh
npm ci
npm run server
```

Trong terminal thứ hai, cùng thư mục:

```sh
npm run dev
```

Mở trang Vite. Chọn **Giáo viên · Tạo phòng**; soạn bộ câu hỏi trước hoặc sau khi tạo phòng, rồi chia sẻ QR/mã phòng. Học sinh chọn **Học sinh · Vào phòng**, nhập tên, màu xe và mã. Cô bấm Bắt đầu khi đủ học sinh, có thể tạm dừng/tiếp tục/kết thúc. Khi kết thúc, xem từng học sinh và xuất JSON/CSV.

Chơi đơn vẫn có ở `?mode=solo`. Màn giáo viên ở `?mode=teacher`; học sinh ở `?mode=student&room=ABC234`. Mã ví dụ không phải phòng đã tạo. **Mở phòng khác** mở màn mới mà không xóa mã khôi phục của phòng cũ. Khi mở lại đường dẫn phòng đã lưu, phiên cũ được khôi phục thay vì tạo người chơi mới. Để quay lại phòng giáo viên cụ thể đã lưu, dùng `?mode=teacher&room=MÃ_PHÒNG`.

## Điện thoại trong cùng Wi-Fi

1. Máy chủ và điện thoại cùng mạng LAN; tắt tính năng cách ly thiết bị của Wi-Fi nếu mạng đang bật.
2. Tìm IPv4 LAN của máy chạy Node, ví dụ `192.168.1.25`.
3. Dừng máy chủ rồi chạy với origin của trang LAN:

```sh
CORS_ORIGINS=http://192.168.1.25:5173,http://localhost:5173,http://127.0.0.1:5173 npm run server
```

4. Chạy Vite bằng `npm run dev` (đã bind `0.0.0.0`). Cho phép cổng TCP 5173 từ mạng nội bộ trong firewall máy chủ. Vite proxy chuyển `/socket.io` sang Node cổng 3001; điện thoại không cần mở trực tiếp cổng 3001 trong cấu hình này.
5. Giáo viên mở trang bằng địa chỉ LAN `http://192.168.1.25:5173`, **không dùng localhost**, rồi tạo phòng. QR sẽ dùng origin LAN này. Hoặc đặt `VITE_PUBLIC_APP_URL=http://192.168.1.25:5173` trước khi chạy Vite.
6. Quét QR bằng điện thoại; có thể nhập mã phòng thủ công trên cùng website.

Một số trình duyệt chỉ cho `crypto.randomUUID()` ở ngữ cảnh an toàn. Trình soạn đã dùng hàm tạo ID có fallback cho HTTP LAN. Âm thanh cần thao tác của người dùng; giọng đọc tiếng Việt tùy thiết bị. Không có đường hầm công khai hoặc chứng chỉ HTTPS được tự thiết lập trong dự án.

## Cấu hình & triển khai hosting

Các biến tham khảo trong `.env.example`. Vite đọc `.env.local` khi chạy/build. Node server đọc **biến môi trường của tiến trình**, không tự đọc file `.env`.

- `PORT`: cổng Node, mặc định 3001.
- `CORS_ORIGINS`: danh sách origin frontend đầy đủ, cách nhau bởi dấu phẩy; không có dấu `/` cuối, không dùng `*`. Ví dụ `https://game.example.edu`.
- `VITE_SERVER_URL`: URL gốc máy chủ Socket.IO; bỏ trống khi reverse proxy cùng origin. Không chứa `/socket.io` ở cuối.
- `VITE_PUBLIC_APP_URL`: URL frontend học sinh truy cập được, dùng tạo QR; bỏ trống thì dùng trang hiện tại. Không đặt token/secret trong URL này.

```sh
npm ci
VITE_SERVER_URL=https://api.example.edu VITE_PUBLIC_APP_URL=https://game.example.edu npm run build
CORS_ORIGINS=https://game.example.edu PORT=3001 npm run server:start
```

Build tạo `dist/` cho frontend tĩnh và `dist-server/index.js` cho Node. Có thể dùng hosting frontend tĩnh và dịch vụ Node lâu dài riêng; không dùng hàm serverless ngắn hạn cho Socket.IO/RAM phòng. Nếu dùng cùng origin, reverse proxy `/socket.io/` tới Node, hỗ trợ WebSocket Upgrade và HTTP long polling, timeout ít nhất 60 giây; các đường dẫn tĩnh phục vụ từ `dist/`. `/health` là endpoint kiểm tra Node, không công bố dữ liệu phòng. Dùng HTTPS trên frontend và backend khi triển khai công khai. Cần rebuild frontend nếu thay biến `VITE_*`.

Bản này chạy **một tiến trình Node**. Không bật nhiều replica/cluster khi chưa có kho phòng dùng chung và Socket.IO adapter; sticky session đơn thuần không đồng bộ dữ liệu RAM. Giữ quy trình Node hoạt động bằng process manager của hosting. Khởi động lại mất toàn bộ phòng và phiên phía server.

## Quyền sở hữu phiên và khôi phục

- Máy chủ tạo `playerId` UUID và token ngẫu nhiên 256 bit riêng cho từng học sinh; giáo viên cũng có token 256 bit. RAM chỉ giữ SHA-256 digest; kiểm tra bằng phép so sánh constant-time.
- Socket đã xác thực được gắn với đúng vai trò/phòng/người chơi; lệnh không nhận điểm, tốc độ hay vị trí từ client. Chỉ giáo viên sở hữu token mới cấu hình/điều khiển/xuất kết quả phòng đó.
- Token chỉ gửi trong phản hồi riêng khi tạo/tham gia hoặc yêu cầu resume; không có trong QR, URL tham gia, bảng xếp hạng hoặc file kết quả. Trình duyệt lưu credential theo vai trò và mã phòng trong localStorage. Mỗi trình duyệt có vùng lưu riêng; không dùng deviceId làm bằng chứng.
- Tự reconnect sẽ gửi lại credential. Tải lại trang vẫn phục hồi tên, màu, quãng đường, điểm và câu hỏi cũ. Không tự tạo học sinh mới nếu đã lưu credential của phòng. Phiên lỗi/hết hạn được báo rõ; không âm thầm đổi danh tính.
- **Tab xác thực gần nhất giữ quyền điều khiển.** Máy chủ ngắt socket cũ, tab cũ hiện thông báo và không tự giành lại. Nút “Kết nối / lấy lại phiên” cho phép người dùng chủ động lấy lại. Socket cũ ngắt không làm phiên mới bị đánh dấu offline.
- Học sinh mất mạng vẫn giữ chỗ trong giới hạn 20. Xe và đồng hồ vẫn chạy khi phòng đang chạy; hết hạn câu ghi sai. Không bù thưởng cho câu chưa gửi. Khi giáo viên mất kết nối, toàn phòng tự tạm dừng; giáo viên quay lại phải bấm Tiếp tục.
- Nếu trình duyệt chặn/xóa localStorage, hoặc mất phản hồi tạo/tham gia trước khi lưu token, không thể chứng minh sở hữu phiên đó. Giao diện báo chưa nhận xác nhận thay vì tự retry thao tác tạo người chơi. Bản RAM chưa có cơ chế cấp lại token bị mất.

## Mô phỏng & hiệu năng

`Room` tái sử dụng `RaceModel(true)` (một xe chính) và `QuestionSession` độc lập cho mỗi học sinh. Trạng thái xe, va chạm, tăng tốc, thời hạn và đáp án đều do Node tính. Đúng +10 điểm, tăng tốc 3 giây; sai hủy tăng tốc, va chạm vẫn ưu tiên chậm. Xếp hạng theo quãng đường, khi cùng về đích thì theo thời điểm về đích; UUID dùng phá hòa để thứ tự ổn định.

Các học sinh đi qua bộ câu hỏi theo tiến độ riêng; đáp án hoặc hết giờ khóa câu, bấm Câu tiếp theo để tiếp tục. Kiểm tra ID câu chặn trả lời/chuyển câu lặp hoặc cũ. Hết bộ câu vẫn tiếp tục đua. Học sinh về đích không nhận câu trả lời nữa; phòng kết thúc khi mọi xe về đích hoặc cô bấm Kết thúc. Câu chưa trả lời khi kết thúc không bị tự tính sai.

Server phát snapshot 10 Hz, chia bước vật lý tối đa 50 ms. Nếu tiến trình bị treo lâu, mỗi lần catch-up chỉ bù tối đa 250 ms để tránh vòng lặp vô hạn; thời gian trò chơi có thể chậm hơn thời gian thực khi server quá tải. Không tin đồng hồ client. Client không xếp hàng thao tác để phát lại sau mất mạng.

Giáo viên tái dùng `RaceScene` ở chế độ remote, bỏ mô phỏng client, nội suy vị trí/làn tới snapshot đích ở tốc độ render (tối đa 60 FPS). Có góc toàn đường và theo từng xe. Tối đa 20 nhãn được tái sử dụng; không tạo text mỗi frame. Khi nhiều xe sát nhau, nhãn có thể chồng; dùng danh sách xếp hạng để chọn theo dõi. Học sinh không render hoặc tải chunk Phaser; chỉ nhận giao diện câu hỏi và trạng thái xe. Ảnh câu hỏi chỉ phát khi đổi câu/kết nối lại, không lặp lại trong snapshot 10 Hz.

## Giới hạn tài nguyên và đầu vào

- Tối đa 20 học sinh/phòng, 50 phòng và khoảng 500 kết nối đồng thời toàn server.
- Bộ câu hỏi trực tuyến tối đa 8 MB; tổng dữ liệu bộ đề trong các phòng tối đa 64 MB. Mỗi ảnh vẫn giới hạn 2 MB theo trình soạn.
- Socket.IO giới hạn thông điệp 10 MB; lệnh thường tối đa 2 KB, lệnh bộ đề tối đa 8 MB + phần bọc. Schema Zod strict và bộ kiểm tra câu hỏi kiểm tra lại ở server.
- Giới hạn 50 yêu cầu/socket/10 giây, 1200 yêu cầu/IP/10 giây, 100 lần nối/IP/phút, 5 lần tạo phòng/IP/phút. Các thiết bị cùng Wi-Fi chung IP được tính gộp. Không tin `X-Forwarded-For`; khi dùng proxy có thể nhiều người chung một bucket.
- Phòng có tuổi tối đa 2 giờ, tự xóa sau 10 phút giáo viên offline hoặc 15 phút sau kết thúc, tùy mốc nào đến trước. Dọn mỗi 10 giây. Thời gian hết hạn này tính theo thời gian thực kể cả khi tạm dừng. Khi hết hạn socket nhận thông báo và bị ngắt.
- Tạo phòng hiện không yêu cầu tài khoản giáo viên; quyền điều khiển phòng dựa trên token chủ phòng. Chưa có cơ chế định danh tài khoản, phân quyền tổ chức hoặc lưu bền vững.

## Kiểm thử

```sh
npm run typecheck
npm test
npm run build
```

`tests/server.test.ts` dùng server thật và Socket.IO clients qua loopback, gồm: tạo/tham gia, 20 join đồng thời/giới hạn 21, 20 client nhận snapshot khi tick trực tiếp, khôi phục và tab trùng, sai token, quyền giáo viên, teacher disconnect, timeout/duplicate/stale câu hỏi, payload sai, rate limit, CORS, expiry, ranking, report và CSV. Test thời gian dài được đẩy bằng bước mô phỏng xác định; test 20 client chạy ticker thật 3 giây.

Kiểm thử Chromium tách vùng lưu giáo viên/học sinh: tạo phòng/QR, điện thoại 390 px, trả lời/tăng tốc/chuyển làn, offline + reload, tab trùng, giáo viên reload/tạm dừng/tiếp tục/kết thúc, tải JSON/CSV. Chơi đơn và bộ soạn vẫn có bộ test của giai đoạn trước.

Đây là kiểm thử mô phỏng trên một máy, **chưa kiểm thử 20 điện thoại thật qua Wi-Fi/Internet**, chưa đo FPS trên máy giáo viên phổ thông hay mạng mất gói thực tế. Không khẳng định kết nối ổn định tuyệt đối hoặc năng lực tải production từ các kiểm thử này.

## Các mô-đun

- `shared/protocol.ts`: hợp đồng request, snapshot công khai, credential và báo cáo.
- `server/Room.ts`: phòng, player/session, trạng thái/mô phỏng và báo cáo.
- `server/app.ts`: Socket.IO, validation, auth, rate limit, broadcast và cleanup.
- `server/index.ts`: cấu hình môi trường, listen và shutdown.
- `src/online/useRoom.ts`: quản lý kết nối, lưu credential, resume và fencing tab.
- `src/online/OnlineApp.tsx`: giao diện giáo viên/học sinh, QR, báo cáo.
- `src/online/RemoteTrack.tsx`: cầu nối snapshot tới renderer hiện có.
- `src/online/export.ts`: xuất JSON/CSV, escape công thức bảng tính.
- `src/SoloApp.tsx`: chế độ chơi đơn hiện có được tách khỏi entrypoint để tải theo nhu cầu.

### Chạy lại browser smoke test

Khởi chạy server và Vite ở hai terminal như trên, rồi:

```sh
npx playwright install chromium
npm run test:browser
```

Nếu dùng Chromium cài sẵn, đặt `BROWSER_EXECUTABLE_PATH` tới executable. Có thể đổi origin test bằng `BROWSER_BASE_URL` (mặc định `http://127.0.0.1:5173`); origin tương ứng phải nằm trong `CORS_ORIGINS`. Script `scripts/browser-smoke.cjs` tạo 1 học sinh trên giao diện điện thoại + 19 Socket.IO clients, kiểm tra tổng 20 người trên màn giáo viên, khôi phục và tab trùng, kết thúc và tải báo cáo. Các client đều được đóng sau test. Ảnh chụp và file báo cáo của test lưu trong `/tmp/duaxe-online-*`; không đưa token vào kết quả.

## Cập nhật giai đoạn 4

Renderer đã thêm số xe, bố trí giãn để giảm chồng tên, camera tự theo nhóm dẫn đầu và bộ đệm nội suy. Lệnh có commandId/biên nhận để chống thực thi trùng; thông điệp câu hỏi có sequence/index. Xem [PERFORMANCE.md](PERFORMANCE.md) để biết độ trễ, giới hạn cửa sổ biên nhận và số đo thực tế. Thông tin nội suy/nhãn ở phần giai đoạn 3 phía trên mô tả phiên bản trước cập nhật này.
