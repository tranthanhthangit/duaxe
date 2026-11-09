import {createClient} from '@supabase/supabase-js';
export const cloudAuth=import.meta.env.VITE_AUTH_DRIVER==='supabase';
export const selfSignup=cloudAuth&&import.meta.env.VITE_SELF_SIGNUP_ENABLED==='true';
export const captchaSiteKey=cloudAuth?import.meta.env.VITE_TURNSTILE_SITE_KEY??'':'';
const origin=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(cloudAuth&&(!origin||!key||!origin.startsWith('https://')))throw Error('Thiếu cấu hình Supabase Auth công khai.');
export const authClient=cloudAuth?createClient(origin!,key!,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce',storageKey:'duaxe-teacher-auth'}}):null;
export async function teacherToken(){if(!authClient)return '';const {data,error}=await authClient.auth.getSession();if(error)throw Error('Phiên đăng nhập cần được làm mới.');return data.session?.access_token??'';}
const challenge=(token?:string)=>{if(captchaSiteKey&&!token)throw Error('Vui lòng hoàn thành xác minh trước khi gửi.');return token;};
export async function loginTeacher(email:string,password:string,captchaToken?:string){if(!authClient)throw Error('Auth chưa cấu hình.');const {error}=await authClient.auth.signInWithPassword({email,password,options:{captchaToken:challenge(captchaToken)}});if(error)throw Error(error.status===429?'Thử lại sau: quá nhiều lần đăng nhập.':'Email hoặc mật khẩu không đúng, hoặc email chưa được xác minh.');}
export async function logoutTeacher(){if(authClient){const {error}=await authClient.auth.signOut({scope:'local'});if(error)throw Error('Chưa đăng xuất được.');}}
export function recoveryRedirect(){return new URL('/?mode=teacher&auth=recovery&fresh=1',location.origin).href;}
export function confirmationRedirect(){return new URL('/?mode=teacher&auth=confirm&fresh=1',location.origin).href;}
export function validateTeacherPassword(password:string){if(password.length<12||password.length>200||!/[a-z]/.test(password)||!/[A-Z]/.test(password)||!/[0-9]/.test(password))throw Error('Mật khẩu cần 12–200 ký tự, có chữ hoa, chữ thường và số.');}
export async function signupTeacher(fullName:string,email:string,password:string,captchaToken:string){
 if(!authClient||!selfSignup||!captchaSiteKey)throw Error('Đăng ký chưa được cấu hình an toàn.');
 const name=fullName.trim().replace(/\s+/g,' ');if(name.length<2||name.length>100||/[\u0000-\u001f\u007f]/.test(name))throw Error('Họ tên cần từ 2 đến 100 ký tự.');validateTeacherPassword(password);
 const {data,error}=await authClient.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:confirmationRedirect(),captchaToken:challenge(captchaToken),data:{full_name:name}}});
 if(error&&!['user_already_exists','email_exists'].includes(error.code??''))throw Error(error.status===429?'Quá nhiều lần đăng ký. Vui lòng chờ rồi thử lại.':'Chưa đăng ký được. Kiểm tra thông tin, xác minh và kết nối.');
 if(data.session){await logoutTeacher();throw Error('Dịch vụ chưa bật xác nhận email bắt buộc. Đăng ký tạm dừng.');}
}
export async function resendTeacherConfirmation(email:string,captchaToken:string){
 if(!authClient||!selfSignup)throw Error('Đăng ký chưa được bật.');const {error}=await authClient.auth.resend({type:'signup',email:email.trim(),options:{emailRedirectTo:confirmationRedirect(),captchaToken:challenge(captchaToken)}});
 if(error)throw Error(error.status===429?'Vui lòng chờ trước khi gửi lại email.':'Chưa gửi được yêu cầu xác nhận. Thử lại sau.');
}
export async function requestTeacherRecovery(email:string,captchaToken?:string){
 if(!authClient)throw Error('Auth chưa cấu hình.');
 const {error}=await authClient.auth.resetPasswordForEmail(email.trim(),{redirectTo:recoveryRedirect(),captchaToken:challenge(captchaToken)});
 if(error)throw Error(error.status===429?'Vui lòng chờ trước khi yêu cầu email tiếp theo.':'Chưa gửi được yêu cầu. Kiểm tra kết nối và thử lại.');
}
let recovery:Promise<'none'|'reset'|'confirmed'>|undefined;
/** Consume only the provider recovery/invite callback; scrub credentials before any await. */
export function consumeTeacherCallback():Promise<'none'|'reset'|'confirmed'>{
 if(recovery)return recovery;
 recovery=(async()=>{
  if(!authClient)return 'none';
  const url=new URL(location.href),hash=new URLSearchParams(url.hash.slice(1));
  const confirmation=url.searchParams.get('auth')==='confirm'||['signup','email'].includes(hash.get('type')??'');
  const recognized=confirmation||url.searchParams.get('auth')==='recovery'||['recovery','invite'].includes(hash.get('type')??'');
  if(!recognized)return 'none';
  const code=url.searchParams.get('code'),access=hash.get('access_token'),refresh=hash.get('refresh_token'),failed=hash.has('error')||url.searchParams.has('error');
  url.hash='';for(const key of ['code','auth','error','error_code','error_description'])url.searchParams.delete(key);history.replaceState(null,'',url);
  if(failed||!code&&!(access&&refresh))throw Error('Liên kết đã hết hạn hoặc không hợp lệ. Hãy yêu cầu email mới.');
  const result=code?await authClient.auth.exchangeCodeForSession(code):await authClient.auth.setSession({access_token:access!,refresh_token:refresh!});
  if(result.error||!result.data.session)throw Error('Liên kết đã hết hạn hoặc không hợp lệ. Mở email trên trình duyệt đã yêu cầu hoặc xin liên kết mới.');
  if(confirmation){await logoutTeacher();return 'confirmed';}return 'reset';
 })();return recovery;
}
export async function consumeTeacherRecovery(){return await consumeTeacherCallback()==='reset';}
export async function setTeacherPassword(password:string){
 if(!authClient)throw Error('Auth chưa cấu hình.');
 validateTeacherPassword(password);
 const {error}=await authClient.auth.updateUser({password});if(error)throw Error('Chưa đổi được mật khẩu. Kiểm tra chính sách mật khẩu hoặc yêu cầu liên kết mới.');recovery=Promise.resolve('none');
}
