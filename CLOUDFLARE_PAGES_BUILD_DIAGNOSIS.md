# Sửa cấu hình Cloudflare Pages — 10/11/2026

## Nguyên nhân và phạm vi xác minh

Repository có `wrangler.toml` với `pages_build_output_dir="dist"`. Khóa này **opt-in cấu hình deploy từ Wrangler**, khiến file trở thành nguồn cấu hình chính của Pages. Trong khi đó `[vars]` chỉ có `ACCESS_MODE="closed"`, không có cấu hình build public người dùng nhập Dashboard. Log mới do người dùng cung cấp cho thấy Pages đọc file và chỉ liệt kê ACCESS_MODE; Node không nhận VITE_AUTH_DRIVER. Đây là xung đột giữa hai nguồn quản lý cấu hình, không phải Vite tự xóa biến.

Đính chính nhận xét ban đầu: Node không import Wrangler, nhưng **Cloudflare đọc Wrangler trước khi chạy Node**. Vì vậy chỉ nhìn vào check-build.ts chưa đủ để kết luận Wrangler không ảnh hưởng. Danh sách log biến non-secret không phải bản dump đầy đủ mọi secret; ở đây còn có bằng chứng guard không nhận giá trị hợp lệ.

Tài liệu Cloudflare được đọc trong lượt này:

- [Wrangler configuration / source of truth và local-only](https://developers.cloudflare.com/pages/functions/wrangler-configuration/): có pages_build_output_dir là opt-in; bỏ khóa đó cho phép file chỉ dùng local và Dashboard quản lý hosted config.
- [Build image / override versions](https://developers.cloudflare.com/pages/configuration/build-image/): hỗ trợ NODE_VERSION hoặc .node-version/.nvmrc; build image v3 không chọn Node từ package.json engines. Default trong tài liệu là22.23.4, khớp log.

Không có quyền đọc Dashboard/API Cloudflare trong lượt này: chưa xác minh snapshot biến Production/Preview thực tế hoặc chạy lại build hosted. Bản sửa xử lý nguồn cấu hình xung đột trong repository; biến từng bị ghi đè hoặc chưa lưu trên Dashboard vẫn cần kiểm lại. Chưa nghiệm thu thành công deployment cloud.

## Cách sửa đã chọn: Dashboard quản lý hosted configuration

- `wrangler.toml`: bỏ duy nhất khóa opt-in `pages_build_output_dir`; giữ name, compatibility_date và `[vars] ACCESS_MODE="closed"`. Bổ sung chú thích rõ local-only và Dashboard output=dist. Không thêm env.production/env.preview hoặc bảng vars rỗng có thể thay thế toàn bộ bindings. Không dùng `keep_vars` của Workers như một cách vá Pages.
- `.node-version`: nội dung24. Không thay engines>=24. Nếu Dashboard còn NODE_VERSION22, sửa thành24 hoặc bỏ giá trị xung đột; kiểm log actual Node24 sau build mới.
- `package.json`: giữ build:pages có diagnostic, precheck rồi `npm run build`. Không gán cứng env trên command.
- `scripts/cloud/build-env.mjs`: trạng thái missing/empty/present, whitespace, boolean so sánh chính xác và Node version; không in key/secret hoặc toàn bộ process.env. Có lệnh cloud:diagnose-build-env.
- `scripts/cloud/check-build.ts`: vẫn bắt buộc Supabase Auth, key public, HTTPS, gateway cùng origin và Turnstile khi signup bật; lỗi auth driver nay phân biệt thiếu/rỗng/sai/whitespace. Không tự trim, default hoặc bỏ guard.
- `tests/pages-build-env.test.ts`:4 test về diagnostic không lộ giá trị và guard vẫn chặn cấu hình sai.

Bản diagnostic/check-build/package/tests đã có trong working tree từ lượt trước và được giữ lại. Thay đổi mới lượt này là Wrangler, .node-version và cập nhật báo cáo này. Không thay database/migrations/RaceModel/luật đua/Functions code/bindings trên dịch vụ.

Vì file Wrangler trở về local-only, **runtime production/preview phải được kiểm trong Dashboard**. Giữ ACCESS_MODE=closed ở cả hai môi trường trước deploy. Functions đã có mặc định closed khi binding vắng; nhưng nếu Dashboard đang có pilot/live thì cần đưa về closed, không giả định giá trị local sẽ override. Giữ nguyên các bindings hiện có, sửa từng biến cần thiết, không xóa hàng loạt hoặc chạy download-config đè file.

## Cloudflare Pages Dashboard

Đúng project Pages `duaxe` (URL .pages.dev), không phải Worker cũ chạy `npx wrangler deploy`:

- Production branch: main.
- Root directory: gốc repo.
- Build command: `npm run build:pages`.
- Build output directory: `dist` (nay do Dashboard quản lý).
- Functions compatibility date: giữ2026-11-01 như cấu hình cũ nếu đang đặt giá trị đó; Wrangler local-only không tự quản lý runtime date hosted.
- Production và Preview có cấu hình riêng. Nhập/kiểm cả hai nếu muốn build preview. Không mở live trong đợt sửa này.

### Biến build-time public

| Biến | Giá trị / yêu cầu |
|---|---|
| NODE_VERSION |24; .node-version cũng yêu cầu24 |
| VITE_AUTH_DRIVER |supabase, đúng chữ thường, không quote/space |
| VITE_SUPABASE_URL |Project URL HTTPS thật |
| VITE_SUPABASE_PUBLISHABLE_KEY |Publishable key hoặc anon key; không service role/secret key |
| VITE_PUBLIC_APP_URL |https://duaxe.pages.dev cho production; xác nhận URL thực tế. Preview cần URL hợp lệ của môi trường nếu muốn QR đúng |
| VITE_SELF_SIGNUP_ENABLED |true theo chính sách self-signup |
| VITE_TURNSTILE_SITE_KEY |Site key công khai thật; hostname phù hợp môi trường |
| VITE_SERVER_URL |Để trống/không khai báo; gateway dùng cùng origin |

Không in env hoặc đưa `.env` thật vào Git. Precheck chạy trước Vite và không tự nạp dotenv; cấu hình cần có trong process.env lúc build. NODE_VERSION chọn Node build, không chọn runtime Pages Functions.

### Runtime Pages Functions

| Binding | Cách cấu hình |
|---|---|
| ACCESS_MODE |closed, cho cả Production và Preview |
| BACKEND_URL |URL HTTPS backend Railway thật |
| SUPABASE_PUBLIC_ORIGIN |Project origin HTTPS, dùng CSP |
| BACKEND_GATEWAY_KEY |Secret binding, giữ giá trị khớp Railway, không đưa vào Git hoặc VITE_ |
| CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD |Giữ nếu đã có; cần khi được phép chuyển pilot sau này |

Runtime bindings được đọc qua context.env. Không cần cấp DATABASE_URL, SUPABASE_STORAGE_KEY, TURNSTILE_SECRET_KEY hoặc SMTP password cho frontend build. Backend và Supabase Dashboard giữ các secret tương ứng. Không thay runtime bindings bằng VITE_ hoặc ngược lại.

## Xác minh sau khi bản sửa được duyệt và push

Log build mới phải thể hiện:

1. Wrangler không còn được dùng làm nguồn cấu hình deploy Pages từ khóa pages_build_output_dir; nếu log vẫn đọc khóa này, đang dùng commit/branch/root khác hoặc file cấu hình khác.
2. Node thực tế24.x (không chỉ NODE_VERSION có mặt).
3. `pages-build-env-v1`: authDriverExactlySupabase=true; biến URL/key/sitekey=present; không in giá trị.
4. Precheck thành công, TypeScript/Vite/backend compile hoàn tất và output dist được dùng.
5. Pages Functions được compile từ thư mục functions. Build thành công không đồng nghĩa Supabase/SMTP/Turnstile/Socket.IO đã nghiệm thu.

Nếu biến vẫn missing sau chuyển về Dashboard mode: kiểm lại đúng project Pages, environment của deployment và biến đã lưu. Nếu control Dashboard vẫn khóa do deployment cũ dùng Wrangler, thực hiện quy trình chuyển về Dashboard của Cloudflare trước khi nhập lại các biến; không thêm secret vào TOML để lách. Cần screenshot/log metadata mới để xác nhận provider state, không gửi secret.

## Kiểm thử local

- Node24.22.1, `npm run build:pages` với biến public giả truyền qua process env: đạt TypeScript, Vite và backend build. Không gọi Supabase.
-4/4 test build-env đạt; missing/empty/quoted/whitespace bị chặn, VITE secret và Turnstile test key vẫn bị chặn.
- `npm run cloud:check-pages`: compile Pages Functions thành công với Wrangler local-only.
- Kiểm dist/index.html và2 entry assets được tham chiếu: tồn tại; không có SQLite/private key trong dist.
- `npm run test:pages-gate`: kiểm local workerd đóng static/SPA/API/Socket.IO và pilot không identity. Kết quả chi tiết xác nhận trong log local.
- Cảnh báo bundle Phaser>500kB vẫn tồn tại như trước; không thay đồ họa để xử lý lỗi config.
- Không chạy toàn bộ database integration suite vì không sửa logic lưu trữ; không chạy production migration/deploy.

## Commit/push khi người dùng sẵn sàng build lại

Chưa commit hoặc push trong lượt này. Push main có thể tự kích hoạt Cloudflare/Railway; chỉ chạy khi đã kiểm bindings và đồng ý build/deploy theo cấu hình mới.

```sh
git add .node-version wrangler.toml package.json scripts/cloud/build-env.mjs scripts/cloud/check-build.ts tests/pages-build-env.test.ts CLOUDFLARE_PAGES_BUILD_DIAGNOSIS.md
git diff --cached --check
git diff --cached
git commit -m "Fix Pages configuration source and pin Node 24"
git push origin HEAD:main
```

Nhánh local hiện là work, vì vậy HEAD:main gửi đúng commit hiện tại tới main. Không force push; nếu remote đã thay đổi thì fetch/reconcile trước. Sau push xem deployment của commit mới, không retry commit cũ. Nếu auto build tắt, dùng Dashboard tạo build từ commit mới sau khi xác nhận. Không chạy wrangler deploy (Workers) cho frontend Pages.
