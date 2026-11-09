export interface SchoolClass {id:string;name:string;schoolYear:string;createdAt:string;updatedAt:string;studentCount:number}
export interface Student {id:string;classId:string;fullName:string;displayName:string;avatarId:string|null;status:'active'|'inactive';createdAt:string;updatedAt:string}
export interface RosterEntry {studentId:string;displayName:string;avatarId:string|null;playerId?:string;online:boolean}
export interface RoomProfile extends RosterEntry {avatarData?:string}
export interface ImportRow {row:number;fullName:string;displayName:string;error?:string;duplicate:boolean}
