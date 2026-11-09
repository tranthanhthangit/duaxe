import { useEffect } from 'react';
import { QuestionSession } from './model';
import { readQuestion, stopSpeech } from './audio';
export function QuestionPanel({session,active,onAnswer,onNext}:{session:QuestionSession;active:boolean;onAnswer:(questionId:string,optionId:string)=>void;onNext:()=>void}){
 const q=session.current,result=session.result,totals=session.totals;
 useEffect(()=>{if(!active)stopSpeech();return stopSpeech;},[active,q?.id]);
 return <section className="question-card"><div className="card-heading"><span className="square-icon">✦</span><div><p>CÙNG BÉ SUY NGHĨ</p><h2>{session.set.title}</h2></div></div>
 <p className="question-counter">Câu {Math.min(session.index+1,session.set.questions.length)} / {session.set.questions.length} · Đúng {totals.correct} · Sai {totals.wrong}</p>
 {q?<><div className="question-clock" role="timer">{result?'Đã ghi nhận':`${Math.ceil(session.remaining)} giây`}</div>{q.image&&<img className="question-image" src={q.image} alt="Hình minh họa cho câu hỏi"/>}<h3>{q.text}</h3>{'speechSynthesis' in window&&<button className="read-button" disabled={!active} onClick={()=>readQuestion(q.text+'. '+q.options.map(o=>o.text).join('. '))}>🔊 Đọc câu hỏi</button>}
 <div className="answer-grid">{q.options.map((o,i)=><button key={o.id} disabled={!active||!!result} className={result?(o.id===q.correctOptionId?'answer-right':o.id===result.selectedOptionId?'answer-wrong':''):''} onClick={()=>onAnswer(q.id,o.id)}><span>{String.fromCharCode(65+i)}</span>{o.text}</button>)}</div>
 <p className="feedback" aria-live="polite">{result?(result.timedOut?'Hết giờ rồi! Cùng xem đáp án đúng nhé.':result.correct?'🌟 Chính xác! Bé nhận 3 giây tăng tốc.':'Cố gắng nhé! Đáp án đúng được tô xanh.'):'Chọn một đáp án để giúp xe tăng tốc.'}</p>{result&&<button className="primary" disabled={!active} onClick={onNext}>{session.index===session.set.questions.length-1?'Xem kết quả':'Câu tiếp theo →'}</button>}</>:<><h3>Hoàn thành bộ câu hỏi! 🌟</h3><p>Bé trả lời đúng {totals.correct}/{session.set.questions.length} câu. Tiếp tục đua đến đích nhé!</p></>}
 {session.results.length>0&&<details className="results"><summary>Kết quả trong phiên ({session.results.length})</summary><ol>{session.results.map(r=><li key={r.questionId}>{session.set.questions.find(q=>q.id===r.questionId)?.text}<br/>{r.selectedOptionId?session.set.questions.find(q=>q.id===r.questionId)?.options.find(o=>o.id===r.selectedOptionId)?.text:'Không trả lời'} · {r.correct?'Đúng':'Sai'} · {r.responseTime.toFixed(1)} giây</li>)}</ol></details>}
 </section>;
}
