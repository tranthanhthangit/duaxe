import type {Context} from './_middleware';
export async function gateway({request,env}:Context){
 try{
  const target=new URL(env.BACKEND_URL??'');if(target.protocol!=='https:'||target.pathname!=='/'||target.username||target.password||target.search||target.hash||!env.BACKEND_GATEWAY_KEY)throw Error();
  const incoming=new URL(request.url);target.pathname=incoming.pathname;target.search=incoming.search;
  const headers=new Headers(request.headers);headers.delete('cookie');headers.set('X-Deployment-Key',env.BACKEND_GATEWAY_KEY);headers.delete('host');headers.delete('cf-access-client-id');headers.delete('cf-access-client-secret');headers.delete('cf-access-jwt-assertion');
  const init={method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual' as const,duplex:'half' as const};const response=await fetch(new Request(target.href,init));
  if(response.status===101)return response;
  const out=new Headers(response.headers);out.set('Cache-Control','no-store');out.delete('set-cookie');return new Response(response.body,{status:response.status,statusText:response.statusText,headers:out});
 }catch{return new Response('Máy chủ đang bảo trì.',{status:503,headers:{'Cache-Control':'no-store'}});}
}
