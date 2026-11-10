const hints = {
 PRIVATE_BUCKET_KEY_FORMAT: 'SUPABASE_STORAGE_KEY chứa khoảng trắng, xuống dòng hoặc ký tự không hợp lệ cho header; dán lại key đầy đủ.',
 PRIVATE_BUCKET_DNS: 'Không phân giải được hostname Supabase; đối chiếu Project URL và DNS/network của Railway.',
 PRIVATE_BUCKET_TIMEOUT: 'Kết nối Storage quá thời gian; kiểm tra outbound networking và trạng thái Supabase.',
 PRIVATE_BUCKET_TLS: 'TLS/certificate Storage thất bại; kiểm tra cấu hình CA, không tắt xác minh TLS.',
 PRIVATE_BUCKET_CONNECTION: 'Kết nối Storage bị từ chối/reset hoặc không có đường mạng; kiểm tra outbound networking.',

 PRIVATE_BUCKET_NETWORK: 'Không nhận được phản hồi Storage: kiểm tra mạng, DNS, TLS hoặc timeout.',
 PRIVATE_BUCKET_HTTP_400: 'Storage trả HTTP400; kiểm tra project, bucket và key.',
 PRIVATE_BUCKET_HTTP_401: 'Storage trả HTTP401; kiểm tra key và project tương ứng.',
 PRIVATE_BUCKET_HTTP_403: 'Storage trả HTTP403; kiểm tra quyền key và chính sách truy cập.',
 PRIVATE_BUCKET_HTTP_404: 'Storage trả HTTP404; kiểm tra bucket trong đúng project.',
 PRIVATE_BUCKET_HTTP_5XX: 'Storage trả lỗi máy chủ HTTP5xx; kiểm tra trạng thái dịch vụ.',
 PRIVATE_BUCKET_HTTP_OTHER: 'Storage trả HTTP không thành công khác; chưa xác minh được bucket.',
 PRIVATE_BUCKET_PUBLIC: 'Bucket đang public; cần chuyển về private.',
 PRIVATE_BUCKET_RESPONSE: 'Metadata bucket không phải JSON hợp lệ hoặc thiếu public=false.',

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

/** Inspect only allowlisted error codes; never emit provider messages or causes. */
export function bucketNetworkStage(error:unknown):StorageStartupStage {
 const pending:unknown[]=[error],seen=new Set<unknown>();
 for(let i=0;pending.length&&i<16;i++){
  const value=pending.shift();if(!value||typeof value!=='object'||seen.has(value))continue;seen.add(value);
  const e=value as {name?:unknown;code?:unknown;cause?:unknown;errors?:unknown};
  if(['ENOTFOUND','EAI_AGAIN'].includes(String(e.code)))return 'PRIVATE_BUCKET_DNS';
  if(['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(String(e.code))||e.name==='TimeoutError'||e.name==='AbortError')return 'PRIVATE_BUCKET_TIMEOUT';
  if(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_TLS_CERT_ALTNAME_INVALID'].includes(String(e.code)))return 'PRIVATE_BUCKET_TLS';
  if(['ECONNREFUSED','ECONNRESET','ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET'].includes(String(e.code)))return 'PRIVATE_BUCKET_CONNECTION';
  pending.push(e.cause);if(Array.isArray(e.errors))pending.push(...e.errors.slice(0,8));
 }
 return 'PRIVATE_BUCKET_NETWORK';
}
