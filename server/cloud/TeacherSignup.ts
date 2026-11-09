import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {SQL} from '../storage/postgres/Database';
import {verifiedAuthUser} from './AuthUserStatus';
import {ProfileCaptchaError} from './Turnstile';
export interface ConfirmedActor {userId:string;sessionId:string;issuedAt:number}
type Transactional=SQL&{transaction<T>(operation:(sql:SQL)=>Promise<T>):Promise<T>};
export async function assertTeacherSignupSettings(origin:string,key:string){
 const response=await fetch(origin+'/auth/v1/settings',{headers:{apikey:key},redirect:'error',signal:AbortSignal.timeout(3000)});
 if(!response.ok)throw Error('Chưa xác nhận cấu hình đăng ký.');const settings=await response.json();
 if(settings.disable_signup!==false||settings.mailer_autoconfirm!==false||settings.external?.email!==true)throw Error('Đăng ký email cần được bật và bắt buộc xác nhận email tại Supabase.');
}
export class SignupConflict extends Error {constructor(){super('Email này có hồ sơ cũ cần đối chiếu an toàn. Vui lòng liên hệ hỗ trợ để giữ đúng dữ liệu của cô.');}}
export class SignupRateLimit extends Error {constructor(){super('Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau một phút.');}}
/** Only called after the existing JWT verifier. No user-supplied IDs or roles. */
export class TeacherSignup {
 private attempts=new Map<string,{count:number;until:number}>();
 private getUser:ReturnType<typeof verifiedAuthUser>;
 constructor(private db:Transactional,private origin:string,private key:string,private verify?:(token?:string)=>Promise<void>){this.getUser=verifiedAuthUser(origin,key);}
 async assertProviderConfig(){await assertTeacherSignupSettings(this.origin,this.key);}
 async provision(actor:ConfirmedActor,captchaToken?:string):Promise<string|null>{
  const now=Date.now();for(const [id,bucket]of this.attempts)if(bucket.until<=now)this.attempts.delete(id);
  let bucket=this.attempts.get(actor.userId);if(!bucket){if(this.attempts.size>=1000)throw new SignupRateLimit();bucket={count:0,until:now+60000};this.attempts.set(actor.userId,bucket);}
  if(++bucket.count>10)throw new SignupRateLimit();
  const user=await this.getUser(actor.userId);if(!user)return null;
  await this.assertProviderConfig();
  if(!captchaToken)throw new ProfileCaptchaError('PROFILE_CAPTCHA_REQUIRED');
  if(!this.verify)throw new ProfileCaptchaError('PROFILE_CAPTCHA_UNAVAILABLE');
  await this.verify(captchaToken);
  const email=z.email().max(150).parse(user.email!.trim().toLowerCase());
  // user_metadata is editable and is used ONLY as display text, never authorization.
  const name=z.string().trim().min(2).max(100).regex(/^[^\u0000-\u001f\u007f]+$/).parse(user.user_metadata?.full_name).replace(/\s+/g,' ');
  return this.db.transaction(async sql=>{
   await sql.query('SELECT pg_advisory_xact_lock(hashtext($1),903)',[actor.userId]);
   if((await sql.query('SELECT 1 FROM duaxe.teacher_auth_revocations WHERE session_id=$1 UNION ALL SELECT 1 FROM duaxe.teacher_auth_cutoffs WHERE auth_user_id=$2 AND valid_after>=$3',[actor.sessionId,actor.userId,actor.issuedAt])).rowCount)return null;
   const existing=(await sql.query('SELECT teacher_id,enabled FROM duaxe.teacher_auth_links WHERE auth_user_id=$1',[actor.userId])).rows[0];
   if(existing)return existing.enabled?existing.teacher_id:null;
   // Never recover/link a legacy profile by email, even when email is confirmed.
   if((await sql.query('SELECT 1 FROM duaxe.teachers WHERE lower(btrim(email))=$1',[email])).rowCount)throw new SignupConflict();
   const teacherId=randomUUID();
   try{await sql.query('INSERT INTO duaxe.teachers(id,email,password,created_at) VALUES($1,$2,$3,now())',[teacherId,email,'!supabase-auth-only']);}
   catch(e){if((e as {sqlState?:string}).sqlState==='23505'||(e as {code?:string}).code==='23505')throw new SignupConflict();throw e;}
   await sql.query('INSERT INTO duaxe.teacher_profiles(teacher_id,full_name) VALUES($1,$2)',[teacherId,name]);
   await sql.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2)',[actor.userId,teacherId]);
   return teacherId; // Transaction wrapper returns only after durable COMMIT.
  });
 }
}
