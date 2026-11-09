import type { RosterEntry } from './classroom';
import type { CarState, RaceStatus } from '../src/game/config';
import type { AnswerResult, Question, QuestionSet } from '../src/questions/model';
export type Role = 'teacher' | 'student';
export interface Credential { code: string; role: Role; playerId: string; token: string }
export interface PlayerView extends CarState { studentId?:string; avatarId?:string|null; number: number; online: boolean; rank: number; correct: number; wrong: number; points: number; boost: number; slow: number }
export interface RoomView { roster?:RosterEntry[]; code: string; status: RaceStatus; elapsed: number; sequence: number; teacherOnline: boolean; expiresAt: number; title: string; totalQuestions: number; players: PlayerView[] }
export type PublicQuestion = Omit<Question, 'correctOptionId'>;
export interface StudentView { index: number; remaining: number; complete: boolean; result?: AnswerResult }
export interface Frame { room: RoomView; self?: StudentView }
export interface ReportRow extends PlayerView { answers: (AnswerResult & { questionText: string; selectedText: string | null; correctText: string })[] }
export interface Report { code: string; title: string; elapsed: number; players: ReportRow[] }
type Operation =
 | { type: 'create'; set: QuestionSet; classId?:string; studentIds?:string[] }
 | { type: 'join'; code: string; name: string; color: number }
 | {type:'preview';code:string}
 | {type:'recoverTeacher';code:string}
 | {type:'claim';code:string;studentId:string;color:number}
 | {type:'release';studentId:string;remove?:boolean}
 | { type: 'resume'; credential: Credential }
 | { type: 'configure'; set: QuestionSet }
 | { type: 'control'; action: 'start' | 'pause' | 'resume' | 'end' }
 | { type: 'answer'; questionId: string; optionId: string }
 | { type: 'next'; questionId: string }
 | { type: 'lane'; direction: -1 | 1 }
 | { type: 'report' };
export type Reply<T=unknown> = { ok: true; data: T } | { ok: false; error: string };
export interface Membership { code: string; role: Role; playerId: string }

export type Request = Operation & { commandId?: string };
export interface QuestionMessage {code:string;sequence:number;index:number;question:PublicQuestion|null}
