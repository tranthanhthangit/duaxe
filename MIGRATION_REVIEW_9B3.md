# Review migration003/004 — cần phê duyệt trước production

Ngày07/11/2026 (UTC+7). **Chỉ review, chưa thực thi SQL trên Supabase.** Trạng thái thực production đang BLOCKED vì TCP PostgreSQL chưa được cấp; không suy luận từ kết quả local rằng production đã/chưa có schema.

## Những SQL runner sẽ dùng

`cloud:operator schema --self-signup --apply` gọi runner target4. Runner mở BEGIN, lấy `pg_advisory_xact_lock(924,900)`, tạo/kiểm private schema duaxe/schema_migrations, rồi kiểm checksum version1..4. Version đã có đúng checksum được bỏ qua; version thiếu chạy nguyên văn file dưới đây và INSERT(version,checksum) vào schema_migrations. Sau đó COMMIT; lỗi yêu cầu ROLLBACK. Operator giữ writer advisory lock924/901 để từ chối khi runtime đang ghi. Không tự cấp quyền operator, dùng runtime key hoặc bỏ lock để áp migration.

**Nếu database hiện ở2: pending003+004. Nếu ở3: pending004. Nếu trống/ở1: pending còn gồm001/002; không được coi phê duyệt003/004 là phê duyệt toàn bộ001..004.** Nếu đã ở4 và checksum khớp thì không chạy DDL lại. Thiếu version ở giữa, checksum khác hoặc version lạ phải dừng đối chiếu. `schema --self-signup` mặc định chỉ plan, không connect.

Metadata SQL để đọc trước khi xin duyệt: BEGIN READ ONLY; tra to_regclass duaxe.schema_migrations/teachers; SELECT version,checksum; catalog pg_class/pg_indexes/pg_policies; kiểm role; đếm nhóm lower(btrim(email)) trùng (không xuất email); ROLLBACK. Công cụ mới `cloud:migration-review` mặc định chỉ in hash nguồn; --connect cần exact DB host/name + CLOUD_READONLY_REVIEW=1, giữ TLS verify-full. Không dùng migration runner như một phép thử kết nối.

## Tiền đề và ảnh hưởng

-004 không tham chiếu trực tiếp bảng003 trong DDL; nó cần teachers của001 và teacher_auth_links của002. **Chuỗi migration và runtime self-signup vẫn bắt buộc003 trước004**, vì Auth dùng revocation/cutoff và công cụ migration dùng journal. Không chạy riêng004 rồi bỏ003.
-003 thêm cutoff và journal; không đổi teacherId/password/điểm/lịch sử. Journal FORCE RLS không policy runtime nên operator cần quyền thật phù hợp, chưa xác minh trên Supabase.
-004 thêm unique index case/space-insensitive và profile teacher FK; duplicate email làm transaction thất bại, không tự merge hoặc chỉnh dữ liệu. Không CONCURRENTLY: index có thể giữ lock ghi trong lúc tạo, cần maintenance/stop writer và đo kích thước thực.
-004 mở INSERT mapping cho duaxe_runtime, vẫn không UPDATE enabled/teacher_id. Backend xác minh Auth UUID/email/owner; Data API/browser không được grant runtime hoặc expose private schema. Policy backend-wide không tự tách tenant cho Node.
-Không có rollback down-migration tự động an toàn cho003/004. Khi có user/profile/cutoff/journal mới, không DROP để quay về. Rollback feature bằng đóng admission/flag trong artifact hỗ trợ4 và giữ dữ liệu; restore backup cần review revocation để tránh làm sống lại token cũ.
-Trước áp: backup DB/Auth/Storage/SQLite+ảnh, restore rehearsal, inventory versions/hashes/role/RLS, xử lý email trùng trên bản sao, bảo toàn legacy IDs, dừng writer, duyệt đúng tập pending. Không migration hoặc xóa SQLite nguồn.

## Danh sách toàn bộ file/checksum

- 001: `server/storage/postgres/migrations/001_storage.sql` · `cfb42968292938fb93b55b17287b7a0e01270dfeca71def844a6cba1fcca5a5b`
- 002: `server/storage/postgres/migrations/002_cloud.sql` · `aeb394eadd4239311799470434fe025d005f179922163df331d7a1d846efb10f`
- 003: `server/storage/postgres/migrations/003_auth_migration.sql` · `6172d9546cc72b6792b46d5b766ddd4b8da7d8d63b0ad1bc1f935c68bafea927`
- 004: `server/storage/postgres/migrations/004_teacher_signup.sql` · `6f6bb72797d0ae1aca7dc6844242fbe6be92cac410db9e44fc6a14e427a94a14`

## SQL 003 — nguyên văn từ migration hiện tại

SHA-256: `6172d9546cc72b6792b46d5b766ddd4b8da7d8d63b0ad1bc1f935c68bafea927`

```sql
-- Additive session cutoff + operator journal. No passwords, JWT or reset links.
CREATE TABLE duaxe.teacher_auth_cutoffs(
 auth_user_id uuid PRIMARY KEY REFERENCES duaxe.teacher_auth_links(auth_user_id),
 valid_after bigint NOT NULL CHECK(valid_after>=0)
);
ALTER TABLE duaxe.teacher_auth_cutoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.teacher_auth_cutoffs FORCE ROW LEVEL SECURITY;
CREATE POLICY backend ON duaxe.teacher_auth_cutoffs TO duaxe_runtime USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON duaxe.teacher_auth_cutoffs TO duaxe_runtime;
REVOKE ALL ON duaxe.teacher_auth_cutoffs FROM PUBLIC;
CREATE TABLE duaxe.auth_migration_batches(
 id uuid PRIMARY KEY,manifest_checksum text NOT NULL CHECK(manifest_checksum ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN ('prepared','rolled_back')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE duaxe.auth_migration_items(
 batch_id uuid NOT NULL REFERENCES duaxe.auth_migration_batches,
 teacher_id uuid NOT NULL REFERENCES duaxe.teachers,
 email_digest text NOT NULL CHECK(email_digest ~ '^[a-f0-9]{64}$'),auth_user_id uuid,
 owned boolean NOT NULL DEFAULT false,mapping_created boolean NOT NULL DEFAULT false,
 invite_requested_at timestamptz,
 state text NOT NULL CHECK(state IN ('planned','created','linked','rolled_back')),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(batch_id,teacher_id),
 UNIQUE(batch_id,auth_user_id)
);
ALTER TABLE duaxe.auth_migration_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.auth_migration_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE duaxe.auth_migration_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.auth_migration_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON duaxe.auth_migration_batches,duaxe.auth_migration_items FROM PUBLIC,duaxe_runtime;
-- No policies/grants for runtime or Data API roles. Explicit operator only.
```

## SQL 004 — nguyên văn từ migration hiện tại

SHA-256: `6f6bb72797d0ae1aca7dc6844242fbe6be92cac410db9e44fc6a14e427a94a14`

```sql
-- Explicit operator migration. Existing teacher/auth IDs and hashes are unchanged.
-- Reject a legacy case/space collision instead of silently merging accounts.
CREATE UNIQUE INDEX teachers_normalized_email ON duaxe.teachers(lower(btrim(email)));
CREATE TABLE duaxe.teacher_profiles(
 teacher_id uuid PRIMARY KEY REFERENCES duaxe.teachers(id) ON DELETE CASCADE,
 full_name text NOT NULL CHECK(char_length(full_name) BETWEEN 2 AND 100),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE duaxe.teacher_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE duaxe.teacher_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY backend ON duaxe.teacher_profiles TO duaxe_runtime USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON duaxe.teacher_profiles TO duaxe_runtime;
GRANT INSERT ON duaxe.teacher_auth_links TO duaxe_runtime;
REVOKE ALL ON duaxe.teacher_profiles FROM PUBLIC;
-- No browser/Data API policy. Backend derives all ownership from verified Auth UUID.
```

## Ranh giới phê duyệt

Chưa có quyền áp SQL nào trên production trong tác vụ9B.3. Khi TCP được cấp và metadata xác minh xong, review này cần được cập nhật đúng pending; người dùng phê duyệt tập SQL/hashes, target, backup/restore và maintenance trước apply. Không chạy trực tiếp code block trong Dashboard để bỏ qua target guards/checksum/writer exclusion. SQL001/002 vẫn là nguồn canonical trong repository và phải review riêng nếu production chưa có chúng.
