const hints = {
 CONFIG: 'Kiểm tra STORAGE_DRIVER, Auth/Storage drivers và deployment gate.',
 TURNSTILE_CONFIG: 'Kiểm tra TURNSTILE_SECRET_KEY, TURNSTILE_EXPECTED_HOSTNAME và HTTPS CORS_ORIGINS.',
 MODULES: 'Không tải được module backend; kiểm tra dependencies và native modules của image.',
 CLOUD_CONFIG: 'Kiểm tra SUPABASE_URL, SUPABASE_STORAGE_KEY và SUPABASE_AVATAR_BUCKET.',
 PRIVATE_BUCKET: 'Không xác minh được private bucket; kiểm tra tên bucket, quyền key và kết nối Supabase Storage.',
 POSTGRES_CONFIG: 'Kiểm tra DATABASE_URL, cấu hình TLS và pool; không dùng transaction pooler.',
 POSTGRES_OPEN: 'Không mở được PostgreSQL/writer; kiểm tra kết nối, TLS, quyền/schema và instance đang giữ writer lock.',
 SCHEMA: 'Không đọc được hoặc thiếu schema003/004; cần review migration, không tự apply.',
 AUTH_SETTINGS: 'Không xác minh được Auth settings; cần signup bật và email confirmation bắt buộc.',
} as const;
export type StorageStartupStage=keyof typeof hints;
/** Never retain the original exception: it can contain URLs, keys or SQL data. */
export class StorageStartupError extends Error {
 constructor(readonly stage:StorageStartupStage){super('STORAGE_INIT_'+stage);}
}
export function storageStartupMessage(error:unknown){
 if(error instanceof StorageStartupError&&Object.hasOwn(hints,error.stage))return `[STORAGE_INIT_${error.stage}] ${hints[error.stage]}`;
 return '[STORAGE_INIT_UNKNOWN] Không thể khởi tạo storage; không ghi nội dung lỗi nhạy cảm.';
}
