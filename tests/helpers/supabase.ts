/** Local emulator, not evidence of Supabase's hosted Auth/Storage implementation. */
import {createServer,type RequestListener} from 'node:http';
import {createServer as createSecureServer} from 'node:https';
import {once} from 'node:events';
import {generateKeyPair,exportJWK,SignJWT,jwtVerify,createLocalJWKSet} from 'jose';
import {randomUUID} from 'node:crypto';
import type {AuthUser} from '../../server/cloud/TeacherMigration';
export async function mockSupabase(tls?:{key:Buffer;cert:Buffer}){
 const keys=await generateKeyPair('ES256'),jwk={...await exportJWK(keys.publicKey),kid:'synthetic-key',alg:'ES256',use:'sig'},objects=new Map<string,Buffer>(),adminUsers=new Map<string,AuthUser>();
 const invitations:string[]=[];let creates=0;let authSettings={disable_signup:false,mailer_autoconfirm:false,external:{email:true}};
 const sessions=new Map<string,string>();
 const secret=randomUUID(),bucket='student-avatars';let publicBucket=false,reads=0;
 const handler:RequestListener=async(req,res)=>{
  try{
   const url=new URL(req.url!,'http://local'),send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
   if(url.pathname==='/auth/v1/settings')return send(200,authSettings);
   if(url.pathname==='/auth/v1/.well-known/jwks.json')return send(200,{keys:[jwk]});
   if(url.pathname==='/auth/v1/user'&&req.headers.apikey===secret){
    try{const {payload}=await jwtVerify((req.headers.authorization??'').slice(7),createLocalJWKSet({keys:[jwk]}));const user=adminUsers.get(payload.sub!);return send(user?200:401,user??{});}catch{return send(401,{});}
   }
   if(req.headers.apikey!==secret||req.headers.authorization!=='Bearer '+secret)return send(401,{error:'denied'});
   if(url.pathname==='/auth/v1/admin/users'){
    if(req.method==='GET')return send(200,{users:[...adminUsers.values()]});
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const value=JSON.parse(Buffer.concat(chunks).toString());
    if([...adminUsers.values()].some(u=>u.email===value.email))return send(422,{});
    if(value.password||value.password_hash||value.email_confirm!==false)return send(400,{});
    const user={id:randomUUID(),email:value.email,email_confirmed_at:null,app_metadata:value.app_metadata};adminUsers.set(user.id,user);creates++;return send(200,user);
   }
   if(url.pathname==='/auth/v1/invite'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const value=JSON.parse(Buffer.concat(chunks).toString());invitations.push(value.email);return send(200,{});}
   if(url.pathname.startsWith('/auth/v1/admin/users/')){const user=adminUsers.get(url.pathname.split('/').at(-1)!);return send(user?200:404,user??{});}
   if(url.pathname==='/storage/v1/bucket/'+bucket)return send(200,{id:bucket,public:publicBucket});
   const prefix='/storage/v1/object/',path=url.pathname.slice(prefix.length).replace(/^authenticated\//,'');
   if(!url.pathname.startsWith(prefix)||!path.startsWith(bucket+'/'))return send(404,{});
   if(req.method==='GET'){reads++;const value=objects.get(path);if(!value)return send(404,{});res.writeHead(200,{'Content-Type':'image/webp','Content-Length':value.length});res.end(value);return;}
   if(req.method==='POST'){if(objects.has(path))return send(409,{});const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)return send(413,{});chunks.push(chunk);}objects.set(path,Buffer.concat(chunks));return send(200,{});}
   if(req.method==='DELETE'){objects.delete(path);return send(200,{});}send(405,{});
  }catch{res.writeHead(500);res.end();}
 };const server=tls?createSecureServer(tls,handler):createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('Mock listen failed');
 const origin=(tls?'https://':'http://')+'127.0.0.1:'+address.port,issuer=origin+'/auth/v1';
 return {origin,issuer,secret,bucket,objects,adminUsers,invitations,setAuthSettings:(value:Partial<typeof authSettings>)=>{authSettings={...authSettings,...value};},creates:()=>creates,keys:{keys:[jwk]},setPublic:(value:boolean)=>{publicBucket=value;},reads:()=>reads,
  token:async(userId:string,overrides:Record<string,unknown>={})=>{if(!adminUsers.has(userId))adminUsers.set(userId,{id:userId,email:userId+'@example.test',email_confirmed_at:new Date().toISOString()});return new SignJWT({role:'authenticated',session_id:sessions.get(userId)??(sessions.set(userId,randomUUID()),sessions.get(userId)),...overrides}).setProtectedHeader({alg:'ES256',kid:jwk.kid}).setIssuer(typeof overrides.iss==='string'?overrides.iss:issuer).setAudience(typeof overrides.aud==='string'?overrides.aud:'authenticated').setSubject(userId).setIssuedAt(typeof overrides.iat==='number'?overrides.iat:Math.floor(Date.now()/1000)).setExpirationTime(typeof overrides.exp==='number'?overrides.exp:'1h').sign(keys.privateKey);},
  close:()=>new Promise<void>(resolve=>server.close(()=>resolve())),
 };
}
