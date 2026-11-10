import {timingSafeEqual} from 'node:crypto';
import type {IncomingHttpHeaders} from 'node:http';
export interface DeploymentAccess {mode:'closed'|'pilot'|'live';key:string}
export function deploymentAccess(env:NodeJS.ProcessEnv):DeploymentAccess|undefined {
 if(env.NODE_ENV!=='production'&&env.TEACHER_AUTH_DRIVER!=='supabase'&&env.AVATAR_STORAGE_DRIVER!=='supabase')return undefined;
 if(env.STORAGE_DRIVER!=='postgres'||env.TEACHER_AUTH_DRIVER!=='supabase'||env.AVATAR_STORAGE_DRIVER!=='supabase')throw Error('Production cần PostgreSQL, Supabase Auth và private Storage.');
 if(!env.CORS_ORIGINS||env.CORS_ORIGINS.split(',').some(origin=>{try{const u=new URL(origin.trim());return u.protocol!=='https:'||u.origin!==origin.trim()||['localhost','127.0.0.1'].includes(u.hostname);}catch{return true;}}))throw Error('Production cần exact HTTPS CORS origins.');
 const mode=env.PRODUCTION_ACCESS_MODE??'closed',key=env.BACKEND_GATEWAY_KEY??'';
 if(!['closed','pilot','live'].includes(mode)||!/^[A-Za-z0-9_-]{43,128}$/.test(key))throw Error('Thiếu production gate/key hợp lệ.');
 return {mode:mode as DeploymentAccess['mode'],key};
}
export function gatewayDenialReason(access:DeploymentAccess|undefined,headers:IncomingHttpHeaders):'MODE_CLOSED'|'KEY_MISSING'|'KEY_MISMATCH'|undefined {
 if(!access)return undefined;
 if(access.mode==='closed')return 'MODE_CLOSED';
 const supplied=headers['x-deployment-key'];
 if(typeof supplied!=='string'||!supplied)return 'KEY_MISSING';
 if(Buffer.byteLength(supplied)!==Buffer.byteLength(access.key)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(access.key)))return 'KEY_MISMATCH';
 return undefined;
}
export function gatewayAllowed(access:DeploymentAccess|undefined,headers:IncomingHttpHeaders){
 return gatewayDenialReason(access,headers)===undefined;
}
/** Per-server, throttled constant labels only: no headers, URLs or key fingerprints. */
export function gatewayGuard(access:DeploymentAccess|undefined,log:(message:string)=>void=console.warn,now:()=>number=Date.now){
 const last=new Map<string,number>();
 return (headers:IncomingHttpHeaders)=>{
  const reason=gatewayDenialReason(access,headers);if(!reason)return true;
  const at=now();if(!last.has(reason)||at-last.get(reason)!>=30000){last.set(reason,at);log('[DEPLOYMENT_GATE_'+reason+']');}
  return false;
 };
}
