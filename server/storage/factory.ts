import {deploymentAccess} from '../cloud/DeploymentGate';
import type {Storage} from './contracts';
import {resolve} from 'node:path';
import {realpath} from 'node:fs/promises';
import {TeacherSignup} from '../cloud/TeacherSignup';
import {authUserStatus} from '../cloud/AuthUserStatus';
import {enrollmentVerifier} from '../cloud/Turnstile';
export async function createStorage(env:NodeJS.ProcessEnv=process.env):Promise<Storage>{
 deploymentAccess(env);
 const driver=env.STORAGE_DRIVER??'sqlite';
 if(env.TEACHER_SELF_SIGNUP&&!['true','false'].includes(env.TEACHER_SELF_SIGNUP))throw Error('TEACHER_SELF_SIGNUP phải là true hoặc false.');
 if(env.TEACHER_SELF_SIGNUP==='true'&&(driver!=='postgres'||env.TEACHER_AUTH_DRIVER!=='supabase'))throw Error('Self-signup cần PostgreSQL và Supabase Auth.');
 const captcha=env.TEACHER_SELF_SIGNUP==='true'?enrollmentVerifier(env):undefined;
 if(env.TEACHER_AUTH_DRIVER&&!['legacy','supabase'].includes(env.TEACHER_AUTH_DRIVER)||env.AVATAR_STORAGE_DRIVER&&!['local','supabase'].includes(env.AVATAR_STORAGE_DRIVER))throw Error('Auth/Storage driver không hợp lệ.');
 if(driver!=='postgres'&&(env.TEACHER_AUTH_DRIVER==='supabase'||env.AVATAR_STORAGE_DRIVER==='supabase'))throw Error('Cloud Auth/Storage cần PostgreSQL; không tự fallback SQLite.');
 if(driver==='sqlite'){const {ClassroomStore}=await import('../classroom/Store');const {SQLiteStorage}=await import('./SQLiteStorage');return new SQLiteStorage(new ClassroomStore(env.CLASSROOM_DB_PATH,env.CLASSROOM_AVATAR_DIR));}
 if(driver!=='postgres')throw Error('STORAGE_DRIVER phải là sqlite hoặc postgres.');
 const cloud=env.TEACHER_AUTH_DRIVER==='supabase'||env.AVATAR_STORAGE_DRIVER==='supabase';
 if(cloud){
  if(env.TEACHER_AUTH_DRIVER!=='supabase'||env.AVATAR_STORAGE_DRIVER!=='supabase')throw Error('Cloud Auth và private Storage phải cấu hình cùng nhau.');
  const [{cloudConfig},{SupabaseAvatarObjects},{SupabaseTeacherAuth},{RoomInvites},{postgresConfig},{PostgresStorage}]=await Promise.all([import('../cloud/config'),import('../cloud/AvatarObjects'),import('../cloud/TeacherAuth'),import('../cloud/RoomInvites'),import('./postgres/config'),import('./PostgresStorage')]);
  const c=cloudConfig(env),objects=new SupabaseAvatarObjects(c.origin,c.bucket,c.storageKey);await objects.verifyPrivate();
  const storage=await PostgresStorage.connect(postgresConfig(env),'',objects);
  try{
   const version=Number((await storage.db.query('SELECT max(version) version FROM duaxe.schema_migrations')).rows[0].version),signupEnabled=env.TEACHER_SELF_SIGNUP==='true';
   if(![3,4].includes(version)||signupEnabled&&version!==4)throw Error('Cần schema cloud003 hoặc004 cho self-signup do operator áp dụng.');
   const signup=signupEnabled?new TeacherSignup(storage.db,c.origin,c.storageKey,token=>captcha!.verify(token)):undefined;if(signup)await signup.assertProviderConfig();
   const adapter:Storage=storage;adapter.teachers=new SupabaseTeacherAuth(storage.db,c.origin+'/auth/v1',undefined,authUserStatus(c.origin,c.storageKey),true,signup?(actor,token)=>signup.provision(actor,token):undefined);adapter.invites=new RoomInvites(storage.db);return adapter;
  }catch(e){await storage.close();throw e;}
 }
 if(!env.PG_AVATAR_DIR)throw Error('Cần PG_AVATAR_DIR riêng; ảnh chưa chuyển lên Storage.');
 const canonicalPath=async(path:string)=>realpath(resolve(path)).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;return resolve(path);});
 if(await canonicalPath(env.PG_AVATAR_DIR)===await canonicalPath(env.CLASSROOM_AVATAR_DIR??'/workspace/duaxe-data/avatars'))throw Error('PG_AVATAR_DIR phải khác thư mục ảnh SQLite nguồn.');
 const {postgresConfig}=await import('./postgres/config');const {PostgresStorage}=await import('./PostgresStorage');return PostgresStorage.connect(postgresConfig(env),env.PG_AVATAR_DIR);
}
