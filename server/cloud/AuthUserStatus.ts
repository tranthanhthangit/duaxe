/** Fresh provider status for sensitive operations. Never uses user_metadata for roles. */
import type {AuthUser} from './TeacherMigration';
export function verifiedAuthUser(origin:string,apiKey:string){
 return async(expectedId:string):Promise<(AuthUser&{user_metadata?:Record<string,unknown>})|null>=>{
  try{
   // JWT signature/issuer/audience/expiry have already been verified locally.
   // Admin status is needed here: public /user need not expose banned_until.
   // Reuse the server-only service key, never the browser publishable key.
   const response=await fetch(origin+'/auth/v1/admin/users/'+expectedId,{headers:{apikey:apiKey,Authorization:'Bearer '+apiKey},redirect:'error',signal:AbortSignal.timeout(3000)});
   if(!response.ok)return null;
   const body=await response.json(),user=body.user??body;
   return user.id===expectedId&&typeof user.email==='string'&&!!user.email_confirmed_at&&Number.isFinite(Date.parse(user.email_confirmed_at))&&user.is_anonymous!==true&&(!user.banned_until||Date.parse(user.banned_until)<=Date.now())&&!user.deleted_at?user:null;
  }catch{return null;} // Provider outage must not grant teacher privileges.
 };
}
export function authUserStatus(origin:string,apiKey:string){const get=verifiedAuthUser(origin,apiKey);return async(_token:string,id:string)=>!!await get(id);}
