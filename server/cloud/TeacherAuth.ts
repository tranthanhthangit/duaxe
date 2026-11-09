import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey,type JWTPayload} from 'jose';
import type {TeacherRepository} from '../storage/contracts';
import type {SQL} from '../storage/postgres/Database';
import {createHash} from 'node:crypto';
import type {ConfirmedActor} from './TeacherSignup';

/** Explicit Auth user -> existing teacher ID mapping, never email auto-linking. */
export class SupabaseTeacherAuth implements TeacherRepository {
 readonly bearerOnly=true;
 private key:JWTVerifyGetKey;
 private statuses=new Map<string,number>();
 constructor(private db:SQL,private issuer:string,key?:JWTVerifyGetKey,private currentUser?:(token:string,id:string)=>Promise<boolean>,private accountCutoffs=false,private signup?:(actor:ConfirmedActor,token?:string)=>Promise<string|null>){
  this.key=key??createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'),{timeoutDuration:3000,cooldownDuration:30000,cacheMaxAge:600000});
 }
 async login():Promise<string>{throw Error('Đăng nhập Supabase trên trình duyệt.');}
 get selfSignup(){return !!this.signup;}
 async ensureTeacher(header:string,captchaToken?:string):Promise<string|null>{
  const payload=await this.claims(header);if(!payload||!this.signup)return null;
  const owner=await this.authenticate(header,{fresh:true});if(owner)return owner;
  return this.signup({userId:payload.sub!,sessionId:payload.session_id as string,issuedAt:payload.iat!},captchaToken);
 }
 private async claims(header:string):Promise<JWTPayload|null>{
  if(!/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(header))return null;
  try{
   const {payload}=await jwtVerify(header.slice(7),this.key,{issuer:this.issuer,audience:'authenticated',algorithms:['ES256','RS256'],requiredClaims:['exp','sub','iat','session_id'],clockTolerance:5});
   if(typeof payload.iat!=='number'||!Number.isInteger(payload.iat)||payload.iat<0||payload.iat>Math.floor(Date.now()/1000)+5)return null;
   if(payload.role!=='authenticated'||typeof payload.sub!=='string'||!/^[a-f0-9-]{36}$/i.test(payload.sub)||typeof payload.session_id!=='string'||!/^[a-f0-9-]{36}$/i.test(payload.session_id)||payload.is_anonymous===true)return null;
   return payload;
  }catch{return null;}
 }
 async authenticate(header='',options?:{fresh?:boolean}):Promise<string|null>{
  const payload=await this.claims(header);if(!payload)return null;
  const owner=(await this.db.query('SELECT teacher_id FROM duaxe.teacher_auth_links WHERE auth_user_id=$1 AND enabled AND NOT EXISTS(SELECT 1 FROM duaxe.teacher_auth_revocations WHERE session_id=$2)'+(this.accountCutoffs?' AND NOT EXISTS(SELECT 1 FROM duaxe.teacher_auth_cutoffs WHERE auth_user_id=$1 AND valid_after>=$3)':''),this.accountCutoffs?[payload.sub,payload.session_id,payload.iat]:[payload.sub,payload.session_id])).rows[0]?.teacher_id;
  if(!owner)return null;
  if(this.currentUser){
   const digest=createHash('sha256').update(header).digest('hex'),now=Date.now();
   if(options?.fresh||(this.statuses.get(digest)??0)<=now){
    this.statuses.delete(digest);
    if(!await this.currentUser(header.slice(7),payload.sub!))return null;
    for(const [key,until]of this.statuses)if(until<=now)this.statuses.delete(key);
    if(this.statuses.size>=256)this.statuses.delete(this.statuses.keys().next().value!);
    this.statuses.set(digest,now+10000);
   }
  }
  return owner;
 }
 async revokeAll(header:string):Promise<void>{
  const payload=await this.claims(header);if(!payload||!this.accountCutoffs)throw Error('Không thể xác nhận thu hồi phiên.');
  const db=this.db as SQL&{transaction?:<T>(operation:(sql:SQL)=>Promise<T>)=>Promise<T>};if(!db.transaction)throw Error('Cần transaction bền vững.');
  await db.transaction(async sql=>{
   const result=await sql.query('INSERT INTO duaxe.teacher_auth_cutoffs(auth_user_id,valid_after) SELECT auth_user_id,$2 FROM duaxe.teacher_auth_links WHERE auth_user_id=$1 AND enabled ON CONFLICT(auth_user_id) DO UPDATE SET valid_after=GREATEST(duaxe.teacher_auth_cutoffs.valid_after,EXCLUDED.valid_after)',[payload.sub,Math.floor(Date.now()/1000)]);
   if(result.rowCount!==1)throw Error('Không thể xác nhận thu hồi phiên.');
  });
 }
 async logout(header=''):Promise<void>{
  const payload=await this.claims(header);if(!payload)return;
  const db=this.db as SQL&{transaction?:<T>(operation:(sql:SQL)=>Promise<T>)=>Promise<T>};
  if(!db.transaction)throw Error('Cần transaction bền vững để đăng xuất.');
  await db.transaction(sql=>sql.query('INSERT INTO duaxe.teacher_auth_revocations(session_id) VALUES($1) ON CONFLICT DO NOTHING',[payload.session_id]));
 }
}
