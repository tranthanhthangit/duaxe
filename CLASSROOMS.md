> Cập nhật giai đoạn 6: phòng và kết quả hiện được lưu SQLite, có lịch sử và khôi phục sau restart. Xem [PERFORMANCE_AND_SESSIONS.md](PERFORMANCE_AND_SESSIONS.md) cho migration 2, hành vi hiện tại và số đo mới. Những mô tả RAM/giới hạn và benchmark bên dưới ghi lại phiên bản giai đoạn 5.

# Lớp học, học sinh và ảnh đại diện

Bổ sung trên game hiện có. SQLite và ảnh riêng trên máy chủ lưu lâu dài; phòng, bộ đề đang chơi, bản sao ảnh và kết quả cuộc đua vẫn chỉ nằm trong RAM. Kết thúc phòng không xóa lớp. Không dùng Supabase, dịch vụ ảnh ngoài hoặc nhận diện khuôn mặt.

## Chạy và cấp tài khoản

Yêu cầu Node.js **24 trở lên**, thư mục dữ liệu có volume bền vững. Không đặt dữ liệu trong `dist`, Git, `/tmp` hoặc lớp filesystem tạm của container.

```sh
npm ci
export CLASSROOM_DB_PATH=/workspace/duaxe-data/classroom.sqlite
export CLASSROOM_AVATAR_DIR=/workspace/duaxe-data/avatars
# Khi máy chủ đang dừng, tạo tài khoản thật do giáo viên/quản trị viên sở hữu:
npm run classroom -- teacher co@example.edu.vn
# Nhập mật khẩu 12–200 ký tự trong terminal; không hiện ký tự hoặc đưa vào lịch sử lệnh.
npm run server
# Terminal khác:
npm run dev
```

Không có tài khoản hay mật khẩu mặc định. Các test tự tạo tài khoản giả trong thư mục tạm riêng và dọn sau khi kết thúc. Email chỉ dùng đăng nhập; không gửi email. Mật khẩu scrypt + salt ngẫu nhiên; phiên giáo viên 12 giờ, token ngẫu nhiên được băm SHA-256 trong DB. Cookie `HttpOnly`, `SameSite=Strict`; `NODE_ENV=production` bật `Secure`. Đăng xuất thu hồi phiên hiện tại.

Máy chủ không tự đọc `.env`: đặt biến môi trường trong shell/process manager/container. Vite đọc biến `VITE_*` khi chạy/build. Xem `.env.example`; không đưa khóa hoặc đường dẫn riêng vào biến `VITE_*`.

Production: `npm run build`, `NODE_ENV=production npm run server:start`; CLI đã build chạy bằng `node dist-server/classroom/cli.js ...` (vẫn cần các production dependencies). Dùng HTTPS với reverse proxy cùng origin cho ứng dụng, `/api` và `/socket.io` (WebSocket upgrade), đặt `CORS_ORIGINS` đúng origin HTTPS. Không mở static route tới DB hoặc thư mục ảnh. Không dùng hai domain không cùng site cho frontend và API vì cookie SameSite=Strict sẽ bị chặn. Không ghi cookie, request body upload, mật khẩu hoặc token Socket.IO vào log reverse proxy.

Thư mục tạo mới có quyền 0700, DB/ảnh/manifest 0600. Chạy bằng tài khoản hệ điều hành riêng; các thư mục có sẵn cần được quản trị viên kiểm tra quyền. `CLASSROOM_DB_PATH` và `CLASSROOM_AVATAR_DIR` phải được gắn volume trong container, cùng bản backup. Một tiến trình Node quản lý DB và RAM phòng; không chạy nhiều worker/process dùng chung DB/avatar directory. Không dùng NFS cho WAL. Chưa có clustering hay failover.

## Cách sử dụng

1. Mở **Giáo viên → Danh sách học sinh**, đăng nhập, bấm **Quản lý lớp và hồ sơ**. Tạo lớp và năm học; chọn lớp để xem số lượng, tìm kiếm, sắp xếp, đổi tên/xóa/xuất JSON.
2. **Thêm học sinh**: họ tên, tên ngắn trên xe, lớp, trạng thái. **Sửa** cho phép chuyển lớp; ID giữ nguyên. Mô hình này mỗi học sinh thuộc **một lớp** tại một thời điểm, chưa có nhiều lớp đồng thời. Hai học sinh trùng tên có UUID khác nhau; không gộp theo tên.
3. Bấm **Ảnh** trên thẻ, chọn JPG/PNG/WebP ≤2 MB, xoay, phóng to/căn ngang/dọc, xem trước tròn và lưu. Ảnh đầu vào tối đa 16 triệu pixel. Máy chủ kiểm tra nội dung thật, từ chối ảnh động/định dạng khác, xoay EXIF, cắt 128 × 128, chuyển WebP và bỏ metadata. Thay ảnh/xóa hồ sơ sẽ dọn ảnh cũ không còn tham chiếu. **Sửa → Xóa ảnh** quay về avatar mặc định.
4. Nhập danh sách: tải CSV mẫu hoặc Excel `.xlsx` có **dòng đầu là tiêu đề, cột 1 họ tên, cột 2 tên hiển thị**. Chỉ đọc sheet đầu, tối đa 1.000 dòng và 2 MB; giới hạn ZIP giải nén 12 MB/200 entries. CSV UTF-8 có/không BOM. Xem trước thiếu tên, tên quá dài và trùng tên; chọn lớp đích trước khi tải tệp. **Xác nhận nhập** tạo riêng từng dòng hợp lệ, báo số thành công và số dòng lỗi. Cảnh báo trùng tên không ngăn nhập. Không nhập ảnh hàng loạt; thêm ảnh từng bé sau đó.
5. Tạo phòng: chọn lớp → soạn/nhập bộ câu hỏi → chọn 1–20 hồ sơ đang học → **Tạo phòng chơi**. Màn chờ có ảnh, tên, chưa tham gia/online/offline. Bỏ chọn hoặc giải phóng hồ sơ trước khi bắt đầu. Nếu không chọn lớp, chế độ chơi nhanh nhập tên vẫn giữ hành vi cũ, không cấp quyền truy cập dữ liệu lâu dài.
6. Học sinh quét QR, chọn ảnh/tên, xác nhận và chọn màu xe. Server gắn `studentId` với `playerId` một lần, phát token bí mật riêng; hồ sơ đã có người dùng bị khóa. Tranh chấp hai thiết bị được giải quyết đồng bộ nguyên tử trong tiến trình Node. Mã phòng/QR chỉ cho xem tối đa 20 tên hiển thị và ảnh đã chọn của phòng, không cho xem họ tên đầy đủ, lớp khác hay API quản trị.
7. Chọn nhầm: trước khi bắt đầu, giáo viên **Giải phóng hồ sơ** rồi học sinh kết nối/chọn lại. Token cũ bị vô hiệu, phiên mới có `playerId` mới. Bỏ chọn khỏi phòng không xóa hồ sơ lâu dài. Đang đua không cho giải phóng để tránh mất kết quả; kết thúc và tạo phòng mới nếu cần sửa lựa chọn sau khi bắt đầu.
8. Đứt mạng: giữ điểm, làn, quãng đường, câu hỏi trên server theo quy tắc game; khôi phục bằng token đã lưu. Một token mở nhiều tab sẽ thay thế tab trước. Không dùng tên/deviceId để khôi phục. Nếu server khởi động lại, lớp/ảnh còn nguyên nhưng phòng RAM và token phòng cũ hết hiệu lực.

Danh sách chờ, xe, bảng xếp hạng và tổng kết dùng cùng ánh xạ `studentId` + `playerId`; không dùng rank/chỉ số mảng để chọn ảnh. JSON/CSV kết quả có ID hồ sơ/ảnh và ID người chơi, không chứa ảnh hoặc token. Xuất dữ liệu lớp JSON chứa thông tin hồ sơ và ID ảnh; bản xuất đầy đủ kèm file ảnh dùng quy trình backup quản trị bên dưới.

## Database và tệp ảnh

Migration tự chạy theo `PRAGMA user_version=1`, transaction, foreign keys ON, WAL, busy timeout 5 giây. Bản DB có version mới hơn ứng dụng bị từ chối; không drop bảng hay tự ghi đè dữ liệu hiện có.

| Bảng | Các trường chính / quan hệ |
|---|---|
| teachers | id UUID, email unique, password salt:scrypt, createdAt |
| sessions | tokenHash, teacherId → teachers CASCADE, expiresAt |
| classes | id UUID, ownerId → teachers, name, schoolYear, createdAt, updatedAt |
| students | id UUID, classId → classes CASCADE, fullName, displayName, avatarId → avatars SET NULL, status, createdAt, updatedAt |
| avatars | id UUID, ownerId → teachers, storageKey unique, mimeType, fileSize, createdAt |

Index `students_class`, `classes_owner`. SQL tham số hóa; quyền sở hữu được kiểm tra trên lớp/học sinh/ảnh. Không lưu Base64 vào SQLite. Ảnh là `<CLASSROOM_AVATAR_DIR>/<UUID>.webp`; tên tệp do server tạo, không nhận đường dẫn từ client. Upload ghi `.part`, rename và transaction thay tham chiếu; ảnh cũ đã ghi nhận trong DB được GC. Sau dừng bất thường, file chưa kịp ghi nhận trong DB có thể còn lại; không tự xóa tệp chưa biết để tránh động tới dữ liệu có sẵn. Quản trị viên kiểm tra đối chiếu storageKey trong DB trước khi dọn file mồ côi; chỉ dùng thư mục ảnh riêng cho Store này. Không dùng `public/static`.

Ảnh trong phòng là bản sao WebP nhỏ được nạp vào RAM khi tạo phòng, gửi riêng qua `avatars` lúc vào/khôi phục (và khi bỏ chọn), không nằm trong frame 10 Hz. Client giữ tối đa 20 hồ sơ phòng, Phaser tái sử dụng texture theo avatarId và sprite theo playerId, loại texture khi bỏ chọn/hủy scene, xóa cache khi phòng hết hạn. Avatar và tên có vùng đặt nhãn riêng, có thể ẩn khi không còn chỗ trong tình huống xe dồn sát; chọn xe hoặc bảng xếp hạng để xem rõ. Không thay tọa độ thi đấu để giãn xe. Renderer sao chép mảng snapshot trước khi ưu tiên xe theo dõi, tránh đổi thứ tự bảng xếp hạng React lúc tạm dừng.

Xóa/chuyển/sửa hồ sơ lâu dài không sửa bản sao trong phòng đã tạo: cuộc đua vẫn hoạt động; phòng hết hạn dọn bản sao RAM. TTL mặc định: 2 giờ từ tạo, 10 phút sau giáo viên mất kết nối, 15 phút sau kết thúc. Khởi động lại cũng dọn RAM. Browser còn giữ dữ liệu tối thiểu của phòng đến hết hạn/unmount; server không thể thu hồi một ảnh đã được thiết bị chụp hoặc sao chép.

## API

Tất cả `/api/*` trừ POST login yêu cầu cookie giáo viên. Mutations yêu cầu `X-Classroom-Request: 1`; origin phải trong allowlist. Body upload/import tối đa 2 MB, CRUD 8 KB, login 4 KB. Rate limit 300 request/phút/IP, login 10/phút/IP, tối đa 2 ảnh đang xử lý đồng thời. Không cấu hình trust proxy tự động; sau reverse proxy có thể dùng chung bucket theo IP proxy, cần cân nhắc khi nhiều giáo viên cùng thao tác.

| Method | Đường dẫn | Nội dung |
|---|---|---|
| POST | /api/login | email, password → cookie |
| GET / POST | /api/me / /api/logout | Kiểm tra / thu hồi phiên |
| GET / POST | /api/classes | Danh sách riêng / tạo lớp |
| PATCH / DELETE | /api/classes/:id | Sửa / xóa lớp và hồ sơ liên quan |
| GET | /api/classes/:id/students | Danh sách đầy đủ dành cho chủ lớp |
| GET | /api/classes/:id/export | JSON dữ liệu lớp (không ảnh nhúng) |
| POST | /api/classes/:id/preview?format=csv\|xlsx | Body tệp thô → preview lỗi/trùng |
| POST | /api/classes/:id/import | Array {fullName,displayName} → success/errors |
| POST | /api/students | Tạo hồ sơ |
| PATCH / DELETE | /api/students/:id | Sửa/chuyển lớp / xóa |
| POST / DELETE | /api/students/:id/avatar | Body ảnh thô / xóa ảnh |
| GET | /api/avatars/:id | WebP riêng tư, kiểm tra owner, no-store |

Socket request mở rộng: `create {set,classId,studentIds}`, `preview {code}`, `claim {code,studentId,color}`, `release {studentId,remove?}`. Create từ lớp và release yêu cầu cookie giáo viên sở hữu lớp; release còn cần quyền giáo viên của phòng. Khi đăng nhập, giao diện nối lại Socket.IO để handshake nhận cookie mới. Lệnh điều khiển/đáp án, chống lặp và sequence giữ nguyên. Giao thức không chấp nhận client tự gửi điểm/vị trí/ảnh để ghi vào hồ sơ.

## Backup, kiểm tra và khôi phục

Quy trình **offline**, cần dừng máy chủ sạch trước khi chạy. Từ giai đoạn 7, kernel `flock` trên `<db>.guard` ngăn server/CLI khác mở Store cùng lúc; `<db>.lock` chỉ là metadata định dạng 2. Yêu cầu Linux/util-linux và filesystem local. Nhờ đó không có thay ảnh/xóa ảnh xen giữa snapshot DB và sao chép ảnh. SQLite `VACUUM INTO` tạo DB nhất quán, chỉ copy ảnh được DB tham chiếu, manifest SHA-256 cho DB và từng ảnh. Sessions bị xóa khỏi bản backup để không phục hồi cookie cũ.

```sh
# Dừng server bằng SIGTERM/Ctrl-C, giữ cùng hai biến CLASSROOM_*.
npm run classroom -- backup /duong-dan-volume/backup-2026-11-05
npm run classroom -- verify /duong-dan-volume/backup-2026-11-05
# Khôi phục vào thư mục MỚI/RỖNG, không ghi đè bản đang dùng:
npm run classroom -- restore /duong-dan-volume/backup-2026-11-05 /duong-dan-volume/restored-new
# Chuyển cấu hình sau khi verify, giữ bản cũ để quay lại nếu cần:
export CLASSROOM_DB_PATH=/duong-dan-volume/restored-new/classroom.sqlite
export CLASSROOM_AVATAR_DIR=/duong-dan-volume/restored-new/avatars
npm run server
```

`verify` kiểm tra checksum, SQLite integrity_check, foreign_key_check và đủ ảnh được tham chiếu. `restore` từ chối target không rỗng. Di chuyển máy chủ: dừng server nguồn, backup/verify, sao chép cả thư mục backup qua kênh riêng, verify trên máy đích, restore mới và cấu hình quyền/tài khoản chạy. Không đưa backup vào Git hoặc phục vụ qua web. Mã hash kiểm tra hỏng tệp, không phải chữ ký chống giả mạo; chỉ phục hồi nguồn backup đáng tin cậy. Mã hóa bản backup khi lưu/chuyển bằng công cụ của hạ tầng.

Giai đoạn 7 thay cơ chế khóa: sau SIGKILL, kernel tự giải phóng khóa `.guard`, server mới khởi động lại mà không xóa file. Không xóa/rename `.guard`, DB, `-wal`, `-shm`. File `.lock` legacy chỉ chứa PID bị từ chối mở tự động; cần dừng writer cũ, xác minh cùng host/namespace và lưu trữ riêng metadata cũ theo [CLASSROOM_READINESS.md](CLASSROOM_READINESS.md#khóa-và-vận-hành-sau-crash). Không xóa khóa mù quáng.

## Quyền riêng tư và vận hành

Chỉ thu họ tên, tên hiển thị, lớp, trạng thái, ảnh. Nhà trường cần có sự đồng ý phù hợp của phụ huynh/người giám hộ và thông báo mục đích, phạm vi xem ảnh, thời hạn giữ, cách yêu cầu xuất/xóa. Có thể dùng biểu tượng mặc định và tên ngắn nếu không dùng ảnh. Không bật thu thập ngày sinh/địa chỉ/điện thoại. Không có telemetry gửi ảnh ra dịch vụ khác.

Quy định thời hạn lưu giữ theo chính sách trường, ví dụ rà soát cuối năm học; không tự áp một thời hạn pháp lý. Xóa hồ sơ/lớp dọn ảnh đang dùng trên máy chủ; chủ backup phải áp cùng quy trình hết hạn/xóa cho bản sao lưu. Trong phòng hiện tại, bản sao nhỏ tồn tại đến khi phòng được dọn. QR là lời mời xem các hồ sơ đã chọn của phòng, chỉ chia sẻ trong lớp; không đăng QR công khai. Chọn hồ sơ là nhận diện thân thiện cho trẻ, chưa phải xác thực danh tính thực ngoài đời; giáo viên kiểm tra trước khi bắt đầu.

Chưa có tự đăng ký, quên mật khẩu qua email, MFA, chia sẻ lớp giữa nhiều giáo viên, xóa tài khoản bằng UI, audit log, mã hóa DB tại rest hoặc phân quyền nhà trường nhiều cấp. Dùng volume mã hóa và quản trị truy cập hệ điều hành nếu cần. SQLite và API đồng bộ phù hợp quy mô lớp, chưa benchmark nhiều lớp lớn/tải upload liên tục. Phòng/kết quả chưa lưu lâu dài; xuất kết quả trước khi server dừng/phòng hết hạn.

## Kiểm thử và các tệp

Các bài tự động mới nằm trong `tests/classroom.test.ts`, `tests/classroom-api.test.ts`; `scripts/classroom-browser.ts` chạy server/Vite riêng, dùng tài khoản và ảnh màu giả, dọn dữ liệu sau test. Chi tiết kết quả đo thực tế ở phần cuối tài liệu này; không xem mô phỏng là kiểm thử 20 điện thoại thật.

```sh
npm run typecheck
npm test
npm run build
npm run test:persistence
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium npm run test:classroom-browser
```

Các tệp **mới** của lần bổ sung này:
- `shared/classroom.ts`
- `server/classroom/Store.ts`, `api.ts`, `import.ts`, `cli.ts`
- `src/classroom/api.ts`, `Avatar.tsx`, `AvatarCrop.tsx`, `ClassroomPanel.tsx`
- `tests/classroom.test.ts`, `tests/classroom-api.test.ts`
- `scripts/classroom-browser.ts`, `scripts/persistence-smoke.ts`, `CLASSROOMS.md`
- `benchmarks/classroom-metrics.json` và các ảnh `classroom-*.png` (dữ liệu giả)

Các tệp **chỉnh sửa**:
- `server/app.ts`, `server/index.ts`, `server/Room.ts`, `shared/protocol.ts`
- `src/online/useRoom.ts`, `OnlineApp.tsx`, `RemoteTrack.tsx`, `export.ts`
- `src/game/RaceScene.ts`, `src/game/perspective.ts`, `src/styles.css`
- `package.json`, `package-lock.json`, `vite.config.ts`, `.env.example`, `.gitignore`, `README.md`, `tsconfig.json`, `scripts/browser-smoke.cjs`

`RaceModel`, logic câu hỏi và đường đua thi đấu được giữ nguyên. Toàn bộ repository hiện vẫn là tệp chưa được Git theo dõi từ các giai đoạn trước; danh sách trên phân biệt theo phạm vi công việc lần này, không khẳng định có một baseline commit để diff.

## Kết quả kiểm tra trong môi trường cloud

Ngày 05/11/2026, Node 24.22.1, Chromium headless phần mềm, Vite dev, mạng loopback:

- TypeScript và build client/server/CLI: đạt. Vite vẫn cảnh báo chunk Phaser khoảng 1,50 MB chưa nén (345 KB gzip); chunk chỉ tải ở màn đường đua, không tải trên màn học sinh.
- **31/31 test tự động đạt**: CRUD/chuyển lớp, trùng tên, quyền sở hữu, cookie/CSRF/CORS, ảnh/EXIF/giới hạn, CSV/XLSX, restart Store, backup/restore/checksum, 20 client, tranh cùng hồ sơ, giải phóng/token cũ, đáp án đồng thời/chống lặp, hết hạn và các regression game/câu hỏi.
- Smoke test bản đã build: tạo lớp/học sinh/WebP qua HTTP, dừng và khởi động lại tiến trình Node; lớp/ảnh/cookie phiên còn nguyên. CLI đã build thực hiện backup → verify → restore vào thư mục mới và kiểm tra lại DB/ảnh: đạt.
- Chromium: đăng nhập, tạo lớp/học sinh, cắt/xoay/upload, CSV preview/import 19 dòng, chọn 20 hồ sơ có ảnh, QR/claim, tăng tốc/chuyển làn, pause/resume/end và tổng kết đạt. Tất cả 20 avatar nhìn thấy lúc xuất phát; đối chiếu texture với studentId/playerId sau đổi hạng và đổi camera đạt. Điện thoại giả lập không tải Phaser, không có canvas hay tràn ngang. Màn chơi đơn mở đúng một canvas, không có lỗi JavaScript.
- Mô phỏng offline **22 giây** rồi nối lại: còn đúng 20 người chơi, học sinh giữ 10 điểm và câu hỏi tiếp theo. Không mô phỏng được đặc tính radio/AP hoặc chuyển vùng của điện thoại thật bằng phép thử này.
- Cửa sổ đo 8 giây: **rAF 37,42 FPS**, frame P95 **50 ms**; bộ đo rolling trong Phaser **41,18 FPS**, P95 **30 ms**. Hai cửa sổ đo khác nhau nên không coi là cùng một chỉ số.
- 19 bot gửi đáp án đồng thời, RTT từ emit đến ack: median **63,91 ms**, P95 **82,92 ms**. Đây là RTT trên loopback có render/Node cùng máy, không phải độ trễ Internet.
- Heap trang giáo viên trước/sau: **20,58 / 19,80 MiB**; 20 texture avatar, 67 texture tổng. Chưa đo bộ nhớ GPU hay soak test nhiều giờ; số này không chứng minh không rò rỉ.
- Trong khi camera theo nhóm dẫn đầu có **16 avatar nhìn thấy** tại thời điểm lấy mẫu: xe ngoài vùng nhìn/nhãn quá sát có thể ẩn. Toàn bộ 20 vẫn có trong bảng xếp hạng và bản đồ; toàn cảnh/đổi xe theo dõi để xem các bé khác.

Số đo lưu tại [benchmarks/classroom-metrics.json](benchmarks/classroom-metrics.json). Ảnh minh chứng dùng avatar màu giả: [xuất phát](benchmarks/classroom-start.png), [toàn cảnh](benchmarks/classroom-overview.png), [giáo viên](benchmarks/classroom-teacher.png), [điện thoại](benchmarks/classroom-phone.png).

Bản trước từng đo khoảng 42,95 rAF FPS trên cloud ở lượt chạy khác. Lượt có avatar này thấp hơn; chưa có so sánh A/B đủ kiểm soát để quy mức giảm cho riêng ảnh. Không khẳng định đã giữ 60 FPS hoặc không giảm hiệu năng. Cần benchmark trên máy trình chiếu thật, đặc biệt nhãn 20 xe, ảnh thực và màn hình độ phân giải cao. Nhãn/texture có giới hạn, không tăng theo từng tick; ưu tiên tiếp theo nếu máy yếu là giảm tần suất cập nhật vị trí nhãn và đo CPU/GPU cụ thể.

## Kiểm tra 20 điện thoại thật qua Wi-Fi

1. Máy giáo viên/server và 20 điện thoại cùng Wi-Fi. Dùng IP LAN của máy (ví dụ `http://192.168.1.10:5173`) cho trang giáo viên/QR; thêm origin đó vào `CORS_ORIGINS`. Vite đã bind `0.0.0.0`, proxy cả `/api` và `/socket.io`. Mở firewall cổng frontend trên LAN. Kiểm tra AP không bật client isolation. Trong thử LAN HTTP không bật `NODE_ENV=production`; dùng HTTPS cho vận hành thực.
2. Dùng lớp thử, 20 ảnh biểu tượng giả khác nhau và tên/số rõ ràng. Đăng nhập giáo viên, chọn lớp/20 bé/bộ đề, tạo phòng. Kiểm tra từng điện thoại chọn hồ sơ riêng; dùng máy thứ 21 chọn hồ sơ đã dùng để xác nhận bị chặn. Giải phóng một hồ sơ chọn nhầm và xác nhận token cũ không lấy lại được.
3. Xuất phát, cùng trả lời, chuyển làn, tạo vượt nhau; kiểm tra ảnh/số/tên đúng xe. Xem dẫn đầu, toàn cảnh và từng bé; kiểm tra bảng xếp hạng, thu/hiện bảng khi trình chiếu. Mở DevTools trên máy giáo viên lấy `canvas.dataset.performance`, đo FPS/heap tối thiểu 10 phút.
4. Tắt Wi-Fi một điện thoại trên 25 giây rồi bật lại, mở tab trùng, tắt màn hình/đưa app nền rồi quay lại. Xác nhận không tăng số người, không mất điểm/câu/làn. Tắt mạng giáo viên: phòng phải tạm dừng, nối lại rồi chủ động tiếp tục. Thử pause/resume/end, xuất JSON/CSV không có ảnh/token.
5. Dừng và khởi động lại server sau khi xuất kết quả; đăng nhập lại nếu cần, lớp/ảnh phải còn; phòng cũ kết thúc vì lưu RAM. Tạo buổi học mới từ cùng danh sách. Thử backup/verify/restore trên **thư mục mới**, không trên dữ liệu đang sử dụng.
6. Ghi model điện thoại, trình duyệt, cấu hình máy chiếu, AP/Wi-Fi, FPS, thời gian reconnect, độ trễ và lỗi; báo cáo riêng với số mô phỏng ở trên. Chưa thực hiện checklist này trên thiết bị thật trong phiên làm việc hiện tại.
