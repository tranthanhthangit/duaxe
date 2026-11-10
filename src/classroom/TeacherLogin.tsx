import {useEffect,useRef,useState} from 'react';
import {api,apiBase,ApiError} from './api';
import {authClient,cloudAuth,selfSignup,captchaSiteKey,consumeTeacherCallback,teacherToken,requestTeacherRecovery,setTeacherPassword,signupTeacher,resendTeacherConfirmation} from './auth';
import {AuthChallenge} from './AuthChallenge';

/** Reuses the existing classroom panel/form styles; no new route or student Auth. */
export function TeacherLogin({onLogin}:{onLogin:()=>Promise<void>}){
 const [mode,setMode]=useState<'login'|'activate'|'signup'|'resend'|'forgot'|'reset'|'checking'>('checking'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[fullName,setFullName]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[passwordSaved,setPasswordSaved]=useState(false),[captcha,setCaptcha]=useState(''),[challengeAttempt,setChallengeAttempt]=useState(0),[profileChallenge,setProfileChallenge]=useState(false);
 const feedback=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(error||notice){feedback.current?.focus();feedback.current?.scrollIntoView({block:'nearest'});}},[error,notice]);
 const [confirmEntry]=useState(()=>new URLSearchParams(location.search).get('auth')==='confirm'||/type=(signup|email)/.test(location.hash));
 useEffect(()=>{let active=true;void consumeTeacherCallback().then(v=>{if(active){setMode(v==='reset'?'reset':'login');if(v==='confirmed')setNotice('Email đã được xác nhận. Cô hãy đăng nhập để bắt đầu.');}}).catch(e=>{if(active){setError(e.message);setMode(confirmEntry?'login':'forgot');}});return()=>{active=false;};},[confirmEntry]);
 useEffect(()=>{setCaptcha('');setChallengeAttempt(n=>n+1);if(mode!=='reset'&&mode!=='activate')setProfileChallenge(false);},[mode]);
 const submit=async()=>{
  setBusy(true);setError('');setNotice('');try{
   if(mode==='activate'){await api('/auth/profile','POST',{captchaToken:captcha});await api('/me');await onLogin();return;}
   if(mode==='signup'){if(password!==confirm)throw Error('Hai mật khẩu chưa giống nhau.');await signupTeacher(fullName,email,password,captcha);setPassword('');setConfirm('');setMode('login');setNotice('Nếu email đủ điều kiện, cô sẽ nhận được liên kết xác nhận. Hãy kiểm tra hộp thư và thư rác trước khi đăng nhập.');return;}
   if(mode==='resend'){await resendTeacherConfirmation(email,captcha);setNotice('Nếu email đủ điều kiện, liên kết xác nhận sẽ được gửi. Vui lòng chờ trước khi gửi lại.');return;}
   if(mode==='forgot'){await requestTeacherRecovery(email,captcha);setNotice('Nếu email đủ điều kiện, cô sẽ nhận được liên kết. Kiểm tra cả thư rác; chờ một phút trước khi gửi lại.');return;}
   if(mode==='reset'){
    if(passwordSaved){await new Promise(resolve=>setTimeout(resolve,1100));const refreshed=await authClient!.auth.refreshSession();if(refreshed.error)throw Error('Mật khẩu đã đổi; cần đăng nhập lại hoặc nhờ quản trị viên hỗ trợ để hoàn tất thu hồi phiên.');}
    if(!passwordSaved){if(password!==confirm)throw Error('Hai mật khẩu chưa giống nhau.');await setTeacherPassword(password);setPasswordSaved(true);}
    if(selfSignup)await api('/auth/profile','POST',profileChallenge?{captchaToken:captcha}:undefined); // Confirmed user may recover before their first login.
    // Persist an all-session cutoff when mapped, then revoke provider refresh tokens.
    const token=await teacherToken();let response:Response;
    try{response=await fetch(apiBase+'/api/auth/revoke-sessions',{method:'POST',credentials:'omit',headers:{Authorization:'Bearer '+token,'X-Classroom-Request':'1'}});}catch{throw Error('Mật khẩu đã đổi nhưng chưa xác nhận thu hồi phiên. Kiểm tra kết nối rồi bấm Hoàn tất đăng xuất.');}
    if(!response.ok)throw Error('Mật khẩu đã đổi nhưng backend chưa xác nhận thu hồi phiên. Kiểm tra kết nối và email đã xác nhận rồi bấm Hoàn tất đăng xuất; liên hệ hỗ trợ nếu vẫn gặp lỗi.');
    const signedOut=await authClient?.auth.signOut({scope:'global'});if(signedOut?.error)throw Error('Mật khẩu đã đổi. Chưa xác nhận đăng xuất toàn bộ phiên; hãy đăng nhập lại và liên hệ quản trị viên.');
    // JWT iat has second precision. A new login in the revoked second is denied.
    await new Promise(resolve=>setTimeout(resolve,1100));
    setPassword('');setConfirm('');setPasswordSaved(false);setMode('login');setNotice('Đã đặt mật khẩu và đăng xuất các phiên cũ. Cô có thể đăng nhập lại.');return;
   }
   await api('/login','POST',{email,password,captchaToken:captcha});setPassword('');await onLogin();
  }catch(e){if(e instanceof ApiError&&e.code==='PROFILE_CAPTCHA_REQUIRED'){if(mode==='reset')setProfileChallenge(true);else{setPassword('');setMode('activate');}setNotice('Vui lòng xác minh thêm để hoàn tất tài khoản.');}else setError((e as Error).message);}finally{setBusy(false);setCaptcha('');setChallengeAttempt(n=>n+1);}
 };
 if(mode==='checking')return <p role="status">Đang kiểm tra phiên giáo viên…</p>;
 return <><h3>{mode==='activate'?'Hoàn tất tài khoản giáo viên':mode==='reset'?'Đặt mật khẩu giáo viên':mode==='forgot'?'Quên mật khẩu':mode==='signup'?'Đăng ký giáo viên':mode==='resend'?'Gửi lại email xác nhận':'Danh sách học sinh · Đăng nhập giáo viên'}</h3>{(error||notice)&&<p ref={feedback} tabIndex={-1} role={error?'alert':'status'}>{error||notice}</p>}<form onSubmit={e=>{e.preventDefault();void submit();}}>
 {mode==='signup'&&<label>Họ và tên<input autoComplete="name" required minLength={2} maxLength={100} value={fullName} onChange={e=>setFullName(e.target.value)}/></label>}
 {mode!=='reset'&&mode!=='activate'&&<label>Email<input type="email" autoComplete="username" required maxLength={150} value={email} onChange={e=>setEmail(e.target.value)}/></label>}
 {(mode==='login'||mode==='reset'||mode==='signup')&&<label>{mode==='reset'?'Mật khẩu mới':'Mật khẩu'}<input type="password" autoComplete={mode==='reset'||mode==='signup'?'new-password':'current-password'} required disabled={mode==='reset'&&passwordSaved} aria-describedby={mode==='signup'||mode==='reset'?'teacher-password-help':undefined} maxLength={200} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
 {(mode==='reset'||mode==='signup')&&<small id="teacher-password-help">Từ 12 đến 200 ký tự, gồm chữ hoa, chữ thường và số. Không chia sẻ mật khẩu.</small>}
 {(mode==='reset'||mode==='signup')&&<><label>Nhập lại mật khẩu<input type="password" autoComplete="new-password" required disabled={passwordSaved} maxLength={200} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label></>}
 {captchaSiteKey&&(mode!=='reset'||profileChallenge)&&<AuthChallenge key={challengeAttempt} onToken={setCaptcha} action={mode==='activate'||profileChallenge?'teacher-profile':'teacher-auth'}/>}
 <button disabled={busy}>{mode==='activate'?'Hoàn tất đăng nhập':mode==='reset'?(passwordSaved?'Hoàn tất đăng xuất':'Lưu mật khẩu'):mode==='signup'?'Tạo tài khoản':mode==='resend'?'Gửi email xác nhận':mode==='forgot'?'Gửi liên kết đặt lại':'Đăng nhập'}</button></form>
 {cloudAuth&&mode==='login'&&<button disabled={busy} onClick={()=>{setError('');setMode('forgot');}}>Quên mật khẩu?</button>}
 {selfSignup&&mode==='login'&&<><button disabled={busy} onClick={()=>{setError('');setMode('signup');}}>Đăng ký giáo viên</button><button disabled={busy} onClick={()=>{setError('');setMode('resend');}}>Gửi lại email xác nhận</button></>}
 {(mode==='forgot'||mode==='signup'||mode==='resend')&&<button disabled={busy} onClick={()=>{setMode('login');setError('');}}>Quay lại đăng nhập</button>}
 <small>{selfSignup?'Giáo viên tự đăng ký và xác nhận email để sử dụng.':'Tài khoản do quản trị viên cấp.'} Hồ sơ được lưu riêng cho từng giáo viên.</small></>;
}
