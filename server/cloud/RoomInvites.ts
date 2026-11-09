import {randomBytes,createHash} from 'node:crypto';
import type {PostgresDatabase} from '../storage/postgres/Database';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export class RoomInvites {
 constructor(private db:PostgresDatabase){}
 async issue(owner:string,code:string){
  const token=randomBytes(32).toString('base64url');let expiresAt=0;
  await this.db.transaction(async sql=>{
   const room=(await sql.query("SELECT created_at FROM duaxe.race_sessions WHERE code=$1 AND owner_id=$2 AND status IN ('ready','running','paused') FOR UPDATE",[code,owner])).rows[0];
   if(!room)throw Error('Không có quyền tạo liên kết phòng.');expiresAt=Number(room.created_at)+2*3600000;if(expiresAt<=Date.now())throw Error('Phòng hết hạn.');
   await sql.query('INSERT INTO duaxe.room_invites VALUES($1,$2,$3) ON CONFLICT(room_code) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at',[code,hash(token),expiresAt]);
  });return {token,expiresAt};
 }
 async verify(code:string,token:string){if(!/^[A-Za-z0-9_-]{43}$/.test(token))return false;return !!(await this.db.query("SELECT 1 FROM duaxe.room_invites i JOIN duaxe.race_sessions r ON r.code=i.room_code WHERE i.room_code=$1 AND i.token_hash=$2 AND i.expires_at>$3 AND r.status='ready'",[code,hash(token),Date.now()])).rowCount;}
}
