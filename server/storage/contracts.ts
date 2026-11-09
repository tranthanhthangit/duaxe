import type { Room } from '../Room';
import type { SchoolClass, Student, RoomProfile } from '../../shared/classroom';
import type { Report } from '../../shared/protocol';

export type RoomCheckpoint = ReturnType<Room['checkpoint']>;
/** Immutable aggregate: answers, quiz/race reward and receipts MUST commit atomically. */
export interface RoomRecord { checkpoint: RoomCheckpoint; report: Report }
export interface StoredRoom { code: string; checkpoint: unknown }
export interface HistoryEntry {code:string;classId:string|null;status:string;createdAt:number;startedAt:number|null;finishedAt:number|null;updatedAt:number;error:string|null}
export interface TeacherRepository {
 readonly bearerOnly?:boolean;
 readonly selfSignup?:boolean;
 ensureTeacher?(credential:string,captchaToken?:string):Promise<string|null>;
 login(email:string,password:string):Promise<string>;
 authenticate(cookie?:string,options?:{fresh?:boolean}):Promise<string|null>;
 logout(cookie?:string):Promise<void>;
 revokeAll?(credential:string):Promise<void>;
}
export interface ClassroomRepository {
 ownClass(owner:string,id:string):Promise<void>;
 classes(owner:string):Promise<SchoolClass[]>;
 saveClass(owner:string,input:unknown,id?:string):Promise<string>;
 deleteClass(owner:string,id:string):Promise<void>;
 students(owner:string,classId:string):Promise<Student[]>;
 student(owner:string,id:string):Promise<Student>;
 saveStudent(owner:string,input:unknown,id?:string):Promise<string>;
 deleteStudent(owner:string,id:string):Promise<void>;
 profiles(owner:string,classId:string,ids:string[]):Promise<RoomProfile[]>;
 exportClass(owner:string,id:string):Promise<{version:number;class:SchoolClass|undefined;students:Student[]}>;
 importStudents(owner:string,classId:string,rows:{fullName:string;displayName:string}[]):Promise<{success:number;errors:{row:number;error:string}[]}>;
}
export interface AvatarRepository {
 read(owner:string,id:string):Promise<Buffer>;
 upload(owner:string,studentId:string,bytes:Buffer):Promise<string>;
 remove(owner:string,studentId:string):Promise<void>;
}
export interface RoomRepository {
 has(code:string):Promise<boolean>;
 /** Reject an equal/older checkpoint.sequence inside the same transaction as the write. */
 save(record:RoomRecord):Promise<void>;
 loadActive():Promise<StoredRoom[]>;
 markCorrupt(code:string):Promise<void>;
 expire(code:string):Promise<void>;
 list(owner:string,classId:string,from:string,to:string):Promise<HistoryEntry[]>;
 report(owner:string,code:string):Promise<Report>;
 delete(owner:string,code:string):Promise<void>;
}
export interface Storage {
 invites?:{issue(owner:string,code:string):Promise<{token:string;expiresAt:number}>;verify(code:string,token:string):Promise<boolean>};
 teachers:TeacherRepository;
 classrooms:ClassroomRepository;
 avatars:AvatarRepository;
 rooms:RoomRepository;
 /** Caller owns lifecycle: close only after the server has drained successfully. */
 assertWritable?():void;
 onUnavailable?(listener:()=>void):()=>void;
 close():Promise<void>;
}
export class StaleCheckpointError extends Error {
 constructor(){super('Checkpoint cũ hoặc trùng phiên bản bị từ chối.');}
}
