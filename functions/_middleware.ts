import {createRemoteJWKSet,jwtVerify} from 'jose';
export interface Bindings {ACCESS_MODE?:string;BACKEND_URL?:string;BACKEND_GATEWAY_KEY?:string;CF_ACCESS_TEAM_DOMAIN?:string;CF_ACCESS_AUD?:string;SUPABASE_PUBLIC_ORIGIN?:string}
export interface Context {request:Request;env:Bindings;next():Promise<Response>}
const keysets=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
export async function onRequest(context:Context){
 const {env,request}=context,mode=env.ACCESS_MODE??'closed';
 if(!['pilot','live'].includes(mode))return new Response('Ứng dụng chưa mở truy cập.',{status:503,headers:{'Cache-Control':'no-store'}});
 if(mode==='pilot'){
  try{const host=env.CF_ACCESS_TEAM_DOMAIN??'';if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host)||!env.CF_ACCESS_AUD)throw Error();
   const origin='https://'+host;let keys=keysets.get(origin);if(!keys){keys=createRemoteJWKSet(new URL(origin+'/cdn-cgi/access/certs'));keysets.set(origin,keys);}
   const {payload}=await jwtVerify(request.headers.get('cf-access-jwt-assertion')??'',keys,{issuer:origin,audience:env.CF_ACCESS_AUD,algorithms:['RS256'],requiredClaims:['exp']});
   if(!(typeof payload.sub==='string'&&payload.sub)&&!(typeof payload.common_name==='string'&&payload.common_name))throw Error();
  }catch{return new Response('Chỉ dành cho nhóm kiểm thử được cấp quyền.',{status:403,headers:{'Cache-Control':'no-store'}});}
 }
 const authPage=new URL(request.url).searchParams.get('mode')==='teacher';const challenge=authPage?'https://challenges.cloudflare.com':'';
 const response=await context.next();if(response.status===101)return response;
 const headers=new Headers(response.headers);headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 let authOrigin='';try{const u=new URL(env.SUPABASE_PUBLIC_ORIGIN??'');if(u.protocol==='https:')authOrigin=u.origin;}catch{}
 headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self' ${challenge}; frame-src 'self' ${challenge}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss://${new URL(request.url).host} ${authOrigin} ${challenge}; font-src 'self'; media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
