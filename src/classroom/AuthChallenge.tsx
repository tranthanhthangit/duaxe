import {useEffect,useRef,useState} from 'react';
import {captchaSiteKey} from './auth';
type Turnstile={render:(container:HTMLElement,options:{sitekey:string;action:string;callback:(token:string)=>void;'expired-callback':()=>void;'error-callback':()=>void})=>string;remove:(id:string)=>void};
declare global {interface Window {turnstile?:Turnstile}}
let loading:Promise<Turnstile>|undefined;
function load(){
 if(window.turnstile)return Promise.resolve(window.turnstile);if(loading)return loading;
 loading=new Promise<Turnstile>((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;
  script.onload=()=>window.turnstile?resolve(window.turnstile):reject(Error());script.onerror=()=>{script.remove();reject(Error());};document.head.append(script);
 }).catch(e=>{loading=undefined;throw e;});return loading;
}
/** Supabase consumes this one-use token; CAPTCHA enforcement lives in Auth settings. */
export function AuthChallenge({onToken,action='teacher-auth'}:{onToken:(token:string)=>void;action?:'teacher-auth'|'teacher-profile'}){
 const ref=useRef<HTMLDivElement>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!captchaSiteKey)return;let active=true,widget:string|undefined;setError(false);onToken('');
  void load().then(api=>{if(!active||!ref.current)return;widget=api.render(ref.current,{sitekey:captchaSiteKey,action,callback:token=>{if(active)onToken(token);},'expired-callback':()=>{if(active)onToken('');},'error-callback':()=>{if(active){onToken('');setError(true);}}});}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;if(widget)window.turnstile?.remove(widget);};
 },[onToken,retry,action]);
 return <><div ref={ref} aria-label="Xác minh chống đăng ký tự động"/>{error&&<p role="alert">Chưa tải được xác minh. Kiểm tra mạng. <button type="button" onClick={()=>setRetry(n=>n+1)}>Thử lại xác minh</button></p>}</>;
}
