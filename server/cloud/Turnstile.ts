/** Application enrollment proof is distinct from the token consumed by Supabase. */
import {createHash} from 'node:crypto';
export class ProfileCaptchaError extends Error {
 constructor(readonly code:'PROFILE_CAPTCHA_REQUIRED'|'PROFILE_CAPTCHA_INVALID'|'PROFILE_CAPTCHA_UNAVAILABLE'){
  super(code==='PROFILE_CAPTCHA_REQUIRED'?'Vui lòng xác minh để hoàn tất tài khoản.':code==='PROFILE_CAPTCHA_INVALID'?'Xác minh hết hạn hoặc không hợp lệ. Vui lòng thử lại.':'Dịch vụ xác minh chưa sẵn sàng. Vui lòng thử lại sau.');
 }
}
export class TurnstileVerifier {
 private readonly host:string;
 private used=new Map<string,number>();
 constructor(private secret:string,hostname:string,private request:typeof fetch=fetch){
  if(secret.length<20||/^[123]x000000/.test(secret))throw Error('Cần Turnstile server secret thực; không dùng test key trong runtime.');
  if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)||hostname.includes('..')||!hostname.includes('.')||['localhost','127.0.0.1'].includes(hostname))throw Error('Cần hostname frontend production chính xác.');
  this.host=hostname;
 }
 async verify(token?:string){
  if(!token)throw new ProfileCaptchaError('PROFILE_CAPTCHA_REQUIRED');
  if(token.length>2048||!/^[\x21-\x7e]+$/.test(token))throw new ProfileCaptchaError('PROFILE_CAPTCHA_INVALID');
  const now=Date.now();for(const [hash,until]of this.used)if(until<=now)this.used.delete(hash);
  const hash=createHash('sha256').update(token).digest('hex');if(this.used.has(hash))throw new ProfileCaptchaError('PROFILE_CAPTCHA_INVALID');
  if(this.used.size>=10000)throw new ProfileCaptchaError('PROFILE_CAPTCHA_UNAVAILABLE');this.used.set(hash,now+300000);
  try{
   const response=await this.request('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:this.secret,response:token}),redirect:'error',signal:AbortSignal.timeout(3000)});
   if(!response.ok)throw new ProfileCaptchaError('PROFILE_CAPTCHA_UNAVAILABLE');
   const data=await response.json(),at=typeof data.challenge_ts==='string'?Date.parse(data.challenge_ts):NaN,age=Date.now()-at;
   if(data.success!==true||data.hostname!==this.host||data.action!=='teacher-profile'||!Number.isFinite(age)||age< -5000||age>300000)throw new ProfileCaptchaError('PROFILE_CAPTCHA_INVALID');
  }catch(e){if(e instanceof ProfileCaptchaError)throw e;throw new ProfileCaptchaError('PROFILE_CAPTCHA_UNAVAILABLE');}
 }
}
export function enrollmentVerifier(env:NodeJS.ProcessEnv){
 const hostname=env.TURNSTILE_EXPECTED_HOSTNAME??'',origins=(env.CORS_ORIGINS??'').split(',');
 if(!origins.some(origin=>{try{const url=new URL(origin);return url.protocol==='https:'&&url.hostname===hostname&&url.origin===origin;}catch{return false;}}))throw Error('Turnstile hostname phải thuộc CORS HTTPS origin đã duyệt.');
 return new TurnstileVerifier(env.TURNSTILE_SECRET_KEY??'',hostname);
}
