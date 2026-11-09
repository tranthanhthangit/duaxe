import React, { useCallback, useRef, useState } from 'react';
import { GameCanvas } from './game/GameCanvas';
import { RaceModel } from './game/RaceModel';
import { raceConfig, type RaceCommand } from './game/config';
import './styles.css';
import { defaultSet, QuestionSession, type QuestionSet } from './questions/model';
import { QuestionPanel } from './questions/QuestionPanel';
import { QuestionEditor } from './questions/QuestionEditor';
import { playFeedback, stopSpeech } from './questions/audio';
export default function SoloApp(){
  const [state,setState]=useState(()=>new RaceModel().snapshot());
  const session=useRef(new QuestionSession(defaultSet));
  const [,refresh]=useState(0);
  const [editing,setEditing]=useState(false);
  const receive=useCallback((snapshot:ReturnType<RaceModel['snapshot']>)=>{
    const count=session.current.results.length;
    session.current.sync(snapshot.elapsed,snapshot.status);
    if(session.current.results.length>count&&session.current.result?.timedOut){stopSpeech();playFeedback(false);}
    setState(snapshot);
  },[]);
  const send=useRef<((c:RaceCommand)=>void)|null>(null);
  const connect=useCallback((handler:((c:RaceCommand)=>void)|null)=>{send.current=handler;},[]);
  const command=(c:RaceCommand)=>{
    if(c.type==='restart'){session.current.reset();stopSpeech();}
    send.current?.(c);
  };
  const answer=(questionId:string,optionId:string)=>{
    const result=session.current.answer(questionId,optionId);
    if(!result)return;
    stopSpeech();playFeedback(result.correct);
    command({type:result.correct?'boost':'clearBoost'});
    refresh(n=>n+1);
  };
  const apply=(set:QuestionSet)=>{
    session.current=new QuestionSession(set);command({type:'restart'});setEditing(false);
  };
  const active=state.status==='running';
  return <main>
    <header><a className="brand" href="./"><span className="brand-icon">✿</span><span>Vui học <b>cùng cô</b><small>MỖI NGÀY MỘT ĐIỀU HAY</small></span></a><button className="teacher-button" onClick={()=>{if(state.status==='running')command({type:'pause'});stopSpeech();setEditing(value=>!value);}}>⚙ {editing?'Trở về đường đua':'Quản lý câu hỏi'}</button></header>
    <section className="intro"><div><p className="eyebrow">GÓC CHƠI THÔNG MINH <span> / </span> BÉ TẬP LÀM TÀI XẾ</p><h1>Đường đua <em>tri thức</em><span>⚑</span></h1><p>Trả lời thật hay, tăng tốc thật nhanh. Cùng bé chinh phục đường đua!</p></div><div className="level"><span>★</span><div>ĐƯỜNG ĐUA 01<strong>Khu vườn diệu kỳ</strong></div></div></section>
    {editing&&<QuestionEditor initial={session.current.set} onApply={apply} onClose={()=>setEditing(false)}/>}
    <div className="layout" hidden={editing}><section className="race-card">
      <div className="race-top"><span><i className={active?'live':''}/> {active?'Đang trên đường đua':state.status==='paused'?'Đường đua tạm nghỉ':state.status==='finished'?'Bé đã về đích!':'Sẵn sàng khám phá'}</span><span>☀ Trời đẹp · {raceConfig.lanes} làn xe</span></div>
      <div className="stage"><GameCanvas onSnapshot={receive} connect={connect}/>
        <div className="hud"><div><small>TỐC ĐỘ</small><strong>{state.speed}<span> km/h</span></strong></div><div><small>THỨ HẠNG</small><strong>{state.rank}<span> / {raceConfig.carCount}</span></strong></div><div><small>QUÃNG ĐƯỜNG</small><strong>{Math.floor(state.distance)}<span> m</span></strong></div></div>
        {state.status!=='running'&&<div className="overlay"><div className="overlay-icon">{state.status==='finished'?'🏆':state.status==='paused'?'Ⅱ':'⚑'}</div><h2>{state.status==='finished'?`Tuyệt vời! Bé về hạng ${state.rank}`:state.status==='paused'?'Nghỉ một chút nhé!':'Sẵn sàng, bé tài xế?'}</h2><p>{state.status==='finished'?'Mỗi câu trả lời là một bước tiến mới.':state.status==='paused'?'Đường đua đang chờ bé quay lại.':'Trả lời đúng để chiếc xe vàng tăng tốc!'}</p><button className="primary" onClick={()=>{if(state.status==='finished')command({type:'restart'});command({type:'start'});}}>{state.status==='finished'?'Chơi thêm lần nữa':state.status==='paused'?'Tiếp tục đua →':'Bắt đầu đua →'}</button></div>}
        {active&&(state.boost>0||state.slow>0)&&<div className={'effect '+(state.slow>0?'slow':'')}>{state.slow>0?'⚠ Chạm chóp rồi! Bé chậm lại một chút.':'⚡ Tăng tốc! Bé giỏi lắm!'}</div>}
        <span className="scene-label">KHU VƯỜN DIỆU KỲ</span>
      </div>
      <div className="progress"><div style={{width:`${state.distance/raceConfig.trackLength*100}%`}}/></div>
      <div className="controls"><div className="control-actions"><button onClick={()=>command({type:state.status==='running'?'pause':'start'})} disabled={state.status==='finished'}>{active?'Ⅱ Tạm dừng':'▶ '+(state.status==='paused'?'Tiếp tục':'Bắt đầu')}</button><button className="restart" onClick={()=>command({type:'restart'})}>↻ Chơi lại</button></div><div className="lane-controls"><span>Chuyển làn</span><button aria-label="Chuyển làn trái" disabled={!active} onClick={()=>command({type:'lane',direction:-1})}>←</button><button aria-label="Chuyển làn phải" disabled={!active} onClick={()=>command({type:'lane',direction:1})}>→</button></div></div>
    </section><aside><QuestionPanel session={session.current} active={active&&!editing} onAnswer={answer} onNext={()=>{if(session.current.next()){stopSpeech();refresh(n=>n+1);}}}/>
    <section className="ranking"><div className="ranking-title"><h2>🏆 Bảng xếp hạng</h2><span>TRỰC TIẾP</span></div><ol>{state.cars.map((car,i)=><li className={car.id==='car-0'?'you':''} key={car.id}><span className="position">{i+1}</span><span className="car-dot" style={{background:'#'+car.color.toString(16).padStart(6,'0')}}>▰</span><strong>{car.name}{car.id==='car-0'&&<small>BẠN</small>}</strong><span>{Math.floor(car.distance)} m</span></li>)}</ol></section></aside></div>
    <footer><span>💡 <b>Mẹo nhỏ:</b> Dùng phím <kbd>←</kbd> <kbd>→</kbd> để chuyển làn, tránh những chiếc chóp trên đường nhé!</span><span>🌱 Học vui · Lớn khôn mỗi ngày</span></footer>
  </main>;
}
