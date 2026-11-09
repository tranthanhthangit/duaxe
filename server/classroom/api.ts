import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { Storage } from '../storage/contracts';
import { parseRoster } from './import';
import {ProfileCaptchaError} from '../cloud/Turnstile';
import {SignupConflict,SignupRateLimit} from '../cloud/TeacherSignup';
async function body(req:IncomingMessage,max=2*1024*1024){let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error('Yêu cầu quá lớn.');chunks.push(chunk);}return Buffer.concat(chunks);}
export function classroomApi(storage:Storage,origins:string[],onDeleteHistory?:(owner:string,code:string)=>Promise<void>){
 const store=storage.classrooms,teachers=storage.teachers,avatars=storage.avatars,history=storage.rooms;
 const buckets=new Map<string,{n:number;until:number}>();let uploads=0;
 return async(req:IncomingMessage,res:ServerResponse)=>{
 const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 try{
 const origin=req.headers.origin;if(origin&&!origins.includes(origin))return send(403,{error:'Origin không được phép.'});
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Credentials','true');}
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Classroom-Request,Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE');res.writeHead(204);res.end();return;}
 const url=new URL(req.url!,'http://local'),parts=url.pathname.split('/').filter(Boolean),method=req.method;
 for(const [key,b]of buckets)if(b.until<Date.now())buckets.delete(key);
 const enroll=url.pathname==='/api/auth/profile';const key=(req.socket.remoteAddress??'unknown')+(enroll?':enroll':url.pathname==='/api/login'?':login':':api');let bucket=buckets.get(key);if(!bucket){if(buckets.size>5000)return send(429,{error:'Thử lại sau.'});bucket={n:0,until:Date.now()+60000};buckets.set(key,bucket);}if(++bucket.n>(enroll?20:url.pathname==='/api/login'?10:300))return send(429,{error:'Quá nhiều yêu cầu, thử lại sau một phút.'});
 if(method!=='GET'&&req.headers['x-classroom-request']!=='1')return send(403,{error:'Thiếu xác nhận yêu cầu.'});
 const cookie=teachers.bearerOnly?req.headers.authorization??'':req.headers.cookie??'';
 const cookieValue=(value:string,maxAge:number)=>`teacher_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`;
 if(enroll&&method==='POST'){
  if(!teachers.bearerOnly||!teachers.selfSignup||!teachers.ensureTeacher)return send(404,{error:'Đăng ký chưa được bật.'});
  const bytes=await body(req,4096),input=z.object({captchaToken:z.string().min(1).max(2048).optional()}).strict().parse(bytes.length?JSON.parse(bytes.toString()):{});
  const id=await teachers.ensureTeacher(cookie,input.captchaToken);return id?send(200,{id}):send(401,{error:'Cần đăng nhập và xác nhận email trước khi sử dụng.'});
 }
 if(url.pathname==='/api/login'&&method==='POST'){if(teachers.bearerOnly)return send(400,{error:'Đăng nhập bằng Supabase Auth trên trình duyệt.'});const p=z.object({email:z.string().email().max(150),password:z.string().min(1).max(200)}).parse(JSON.parse((await body(req,4096)).toString()));try{const token=await teachers.login(p.email,p.password);res.setHeader('Set-Cookie',cookieValue(token,43200));return send(200,{ok:true});}catch{return send(401,{error:'Email hoặc mật khẩu không đúng.'});}}
 const owner=await teachers.authenticate(cookie,{fresh:method!=='GET'||url.pathname==='/api/me'});if(!owner)return send(401,{error:'Vui lòng đăng nhập giáo viên.'});
 if(url.pathname==='/api/me'&&method==='GET')return send(200,{id:owner});
 if(url.pathname==='/api/logout'&&method==='POST'){await teachers.logout(cookie);if(!teachers.bearerOnly)res.setHeader('Set-Cookie',cookieValue('',0));return send(200,{ok:true});}
 if(url.pathname==='/api/auth/revoke-sessions'&&method==='POST'&&teachers.bearerOnly&&teachers.revokeAll){await teachers.revokeAll(cookie);return send(200,{ok:true});}
 if(parts[1]==='rooms'&&parts[3]==='invite'&&method==='POST'&&/^[A-HJ-NP-Z2-9]{6}$/.test(parts[2])&&storage.invites)return send(200,await storage.invites.issue(owner,parts[2]));
 if(parts[1]==='history'){
 const code=parts[2];
 if(!code&&method==='GET'){const from=url.searchParams.get('from')??'',to=url.searchParams.get('to')??'';if([from,to].some(v=>v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))))return send(400,{error:'Ngày không hợp lệ.'});return send(200,await history.list(owner,url.searchParams.get('classId')??'',from,to));}
 if(code&&/^[A-HJ-NP-Z2-9]{6}$/.test(code)){if(method==='GET')return send(200,await history.report(owner,code));if(method==='DELETE'){if(onDeleteHistory)await onDeleteHistory(owner,code);else await history.delete(owner,code);return send(200,{ok:true});}}return send(400,{error:'Mã buổi học không hợp lệ.'});
 }
 const id=parts[2];if(id&&!z.string().uuid().safeParse(id).success)return send(400,{error:'ID không hợp lệ.'});
 if(parts[1]==='classes'){
  if(method==='GET'&&!id)return send(200,await store.classes(owner));
  if(method==='POST'&&!id)return send(201,{id:await store.saveClass(owner,JSON.parse((await body(req,8192)).toString()))});
  if(method==='PATCH'&&id&&parts.length===3)return send(200,{id:await store.saveClass(owner,JSON.parse((await body(req,8192)).toString()),id)});
  if(method==='DELETE'&&id&&parts.length===3){await store.deleteClass(owner,id);return send(200,{ok:true});}
  if(method==='GET'&&parts[3]==='export')return send(200,await store.exportClass(owner,id));
  if(method==='GET'&&parts[3]==='students')return send(200,await store.students(owner,id));
  if(method==='POST'&&parts[3]==='preview'){const existing=await store.students(owner,id);return send(200,await parseRoster(await body(req),url.searchParams.get('format')??'csv',existing.map(s=>s.fullName)));}
  if(method==='POST'&&parts[3]==='import'){
   const rows=z.array(z.object({fullName:z.string().max(1000),displayName:z.string().max(1000)})).max(1000).parse(JSON.parse((await body(req)).toString()));return send(200,await store.importStudents(owner,id,rows));
  }
 }
 if(parts[1]==='students'){
  if(method==='POST'&&!id)return send(201,{id:await store.saveStudent(owner,JSON.parse((await body(req,8192)).toString()))});
  if(method==='PATCH'&&id&&parts.length===3)return send(200,{id:await store.saveStudent(owner,JSON.parse((await body(req,8192)).toString()),id)});
  if(method==='DELETE'&&parts[3]==='avatar'){await avatars.remove(owner,id);return send(200,{ok:true});}
  if(method==='DELETE'&&id&&parts.length===3){await store.deleteStudent(owner,id);return send(200,{ok:true});}
  if(method==='POST'&&parts[3]==='avatar'){const mime=req.headers['content-type']?.split(';')[0].trim().toLowerCase();if(teachers.bearerOnly&&mime&&!['image/jpeg','image/png','image/webp','application/octet-stream'].includes(mime))return send(400,{error:'Chỉ chấp nhận ảnh JPG, PNG, WebP.'});if(uploads>=2)return send(429,{error:'Đang xử lý ảnh. Thử lại sau.'});uploads++;try{return send(200,{id:await avatars.upload(owner,id,await body(req))});}finally{uploads--;}}
 }
 if(parts[1]==='avatars'&&id&&method==='GET'){const bytes=await avatars.read(owner,id);res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return;}
 send(404,{error:'Không tìm thấy API.'});
 }catch(error){if(error instanceof ProfileCaptchaError)return send(error.code==='PROFILE_CAPTCHA_REQUIRED'?428:error.code==='PROFILE_CAPTCHA_INVALID'?403:503,{error:error.message,code:error.code});send(error instanceof SignupConflict?409:error instanceof SignupRateLimit?429:400,{error:error instanceof SignupConflict||error instanceof SignupRateLimit?error.message:error instanceof z.ZodError?'Dữ liệu chưa hợp lệ.':error instanceof Error&&/quyền|tìm thấy|MB|tên|lớp|dòng|ảnh|Workbook|sheet|CSV/.test(error.message)?error.message:'Không thể xử lý yêu cầu. Kiểm tra định dạng tệp và dữ liệu.'});}
 };
}
