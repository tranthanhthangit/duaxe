import {cloudAuth,selfSignup,teacherToken,loginTeacher,logoutTeacher} from './auth';
export class ApiError extends Error {constructor(message:string,readonly code?:string,readonly status?:number){super(message);}}
export const apiBase=import.meta.env.VITE_SERVER_URL||'';
export async function api<T>(path:string,method='GET',data?:unknown):Promise<T>{
 if(cloudAuth&&path==='/login'){const p=data as {email:string;password:string;captchaToken?:string};await loginTeacher(p.email,p.password,p.captchaToken);try{if(selfSignup)await api('/auth/profile','POST');await api('/me');}catch(e){if(!(e instanceof ApiError&&e.code==='PROFILE_CAPTCHA_REQUIRED'))await logoutTeacher();throw e;}return {ok:true} as T;}
 if(cloudAuth&&path==='/logout'){const token=await teacherToken();const r=await fetch(apiBase+'/api/logout',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Classroom-Request':'1'},credentials:'omit'});if(!r.ok&&r.status!==401)throw Error('Chưa xác nhận đăng xuất; kiểm tra kết nối.');await logoutTeacher();return {ok:true} as T;}
 const token=cloudAuth?await teacherToken():'';
 const raw=data instanceof Blob;const response=await fetch(apiBase+'/api'+path,{method,credentials:cloudAuth?'omit':'include',headers:{...(token?{Authorization:'Bearer '+token}:{}),'X-Classroom-Request':'1',...(data&&!raw?{'Content-Type':'application/json'}:{})},body:data?(raw?data:JSON.stringify(data)):undefined});
 const result=await response.json();if(!response.ok)throw new ApiError(result.error||'Không thể kết nối.',result.code,response.status);return result;
}
export function download(name:string,data:string,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function avatarUrl(id:string|null|undefined){return id?apiBase+'/api/avatars/'+id:undefined;}
