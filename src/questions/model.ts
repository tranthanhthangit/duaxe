import type { RaceStatus } from '../game/config';
export interface Option { id: string; text: string }
export interface Question { id: string; text: string; image?: string; options: Option[]; correctOptionId: string; timeLimit: number }
export interface QuestionSet { version: 1; title: string; questions: Question[] }
export interface AnswerResult { questionId: string; selectedOptionId: string | null; correct: boolean; responseTime: number; timedOut: boolean }
export const defaultSet: QuestionSet = { version: 1, title: 'Khám phá cùng bé', questions: [
 { id:'sun', text:'Ông mặt trời mọc vào buổi nào?', options:[{id:'morning',text:'Buổi sáng'},{id:'night',text:'Buổi tối'}], correctOptionId:'morning',timeLimit:20 },
 { id:'legs', text:'Chú mèo có mấy chân?', options:[{id:'two',text:'2 chân'},{id:'four',text:'4 chân'},{id:'six',text:'6 chân'}], correctOptionId:'four',timeLimit:20 },
 { id:'light', text:'Đèn giao thông màu nào cho phép đi?', options:[{id:'red',text:'Màu đỏ'},{id:'green',text:'Màu xanh'},{id:'yellow',text:'Màu vàng'}], correctOptionId:'green',timeLimit:25 },
] };
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export function validImage(value: unknown): value is string { return typeof value==='string' && value.length<=MAX_IMAGE_BYTES*1.4 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value); }
export function parseQuestionSet(input: unknown): QuestionSet {
 const fail=():never=>{throw new Error('Bộ câu hỏi không hợp lệ. Cần 1–100 câu, mỗi câu có 2–4 đáp án, một đáp án đúng và thời gian 5–120 giây.');};
 if(!input||typeof input!=='object')return fail();
 const s=input as QuestionSet;
 if(s.version!==1||typeof s.title!=='string'||!s.title.trim()||s.title.length>120||!Array.isArray(s.questions)||!s.questions.length||s.questions.length>100)return fail();
 const ids=new Set<string>();
 const questions=s.questions.map(q=>{
  if(!q||typeof q.id!=='string'||!q.id.trim()||q.id.length>100||ids.has(q.id)||typeof q.text!=='string'||!q.text.trim()||q.text.length>1000||!Number.isInteger(q.timeLimit)||q.timeLimit<5||q.timeLimit>120||!Array.isArray(q.options)||q.options.length<2||q.options.length>4)return fail();
  ids.add(q.id);const optionIds=new Set<string>();
  const options=q.options.map(o=>{if(!o||typeof o.id!=='string'||!o.id.trim()||o.id.length>100||optionIds.has(o.id)||typeof o.text!=='string'||!o.text.trim()||o.text.length>300)return fail();optionIds.add(o.id);return {id:o.id,text:o.text.trim()};});
  if(!optionIds.has(q.correctOptionId)||(q.image!==undefined&&!validImage(q.image)))return fail();
  return {id:q.id,text:q.text.trim(),options,correctOptionId:q.correctOptionId,timeLimit:q.timeLimit,...(q.image?{image:q.image}:{})};
 });
 return {version:1,title:s.title.trim(),questions};
}
/** Local authoritative scoring boundary. Only race simulation time advances deadlines. */
export class QuestionSession {
 readonly set: QuestionSet;
 index=0; results: AnswerResult[]=[]; private startedAt=0; private elapsed=0; private status:RaceStatus='ready';
 constructor(set:QuestionSet){this.set=parseQuestionSet(set);}
 get current(){return this.set.questions[this.index];}
 get result(){return this.results.find(r=>r.questionId===this.current?.id);}
 get remaining(){return this.current?Math.max(0,this.current.timeLimit-(this.elapsed-this.startedAt)):0;}
 get totals(){return {correct:this.results.filter(r=>r.correct).length,wrong:this.results.filter(r=>!r.correct).length};}
 sync(elapsed:number,status:RaceStatus){this.elapsed=elapsed;this.status=status;if(status==='running'&&this.current&&!this.result&&this.remaining<=0)this.record(null,true);}
 answer(questionId:string,optionId:string):AnswerResult|null{
  if(this.status!=='running'||this.current?.id!==questionId||this.result||!this.current.options.some(o=>o.id===optionId))return null;
  if(this.remaining<=0){this.record(null,true);return null;}
  return this.record(optionId,false);
 }
 private record(selectedOptionId:string|null,timedOut:boolean){const q=this.current;const result={questionId:q.id,selectedOptionId,correct:selectedOptionId===q.correctOptionId,responseTime:Math.min(q.timeLimit,Math.max(0,this.elapsed-this.startedAt)),timedOut};this.results.push(result);return result;}
 next(){if(this.status!=='running'||!this.result)return false;this.index++;this.startedAt=this.elapsed;return true;}
 checkpoint(){return {index:this.index,results:this.results,startedAt:this.startedAt,elapsed:this.elapsed};}
 restore(data:ReturnType<QuestionSession['checkpoint']>){
  if(!Number.isInteger(data.index)||data.index<0||data.index>this.set.questions.length||!Number.isFinite(data.startedAt)||!Number.isFinite(data.elapsed)||data.startedAt<0||data.elapsed<data.startedAt||!Array.isArray(data.results)||new Set(data.results.map(r=>r.questionId)).size!==data.results.length)throw new Error('Quiz checkpoint invalid');
  if(data.results.length<data.index||data.results.length>Math.min(this.set.questions.length,data.index+1)||data.results.some((r,i)=>r.questionId!==this.set.questions[i]?.id))throw new Error('Quiz result order invalid');
  for(const r of data.results){const q=this.set.questions.find(q=>q.id===r.questionId);if(!q||typeof r.timedOut!=='boolean'||!Number.isFinite(r.responseTime)||r.responseTime<0||r.responseTime>q.timeLimit||(r.selectedOptionId!==null&&!q.options.some(o=>o.id===r.selectedOptionId))||r.correct!==(r.selectedOptionId===q.correctOptionId))throw new Error('Answer checkpoint invalid');}
  this.index=data.index;this.results=data.results;this.startedAt=data.startedAt;this.elapsed=data.elapsed;this.status='paused';
 }
 reset(){this.index=0;this.results=[];this.startedAt=this.elapsed=0;this.status='ready';}
}
