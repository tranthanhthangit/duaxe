import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './ui/game-ui.css';
const HomeScreen=lazy(()=>import('./ui/HomeScreen'));
const SoloApp=lazy(()=>import('./SoloApp'));
const OnlineApp=lazy(()=>import('./online/OnlineApp'));
declare global { interface Window { __reactProfile?:{commits:number;totalMs:number;maxMs:number} } }
const profile=new URLSearchParams(location.search).get('profile')==='1';
const measure:React.ProfilerOnRenderCallback=(_id,_phase,duration)=>{if(!profile)return;const value=window.__reactProfile??={commits:0,totalMs:0,maxMs:0};value.commits++;value.totalMs+=duration;value.maxMs=Math.max(value.maxMs,duration);};
const mode=new URLSearchParams(location.search).get('mode')??'home';
createRoot(document.getElementById('root')!).render(<React.StrictMode><React.Profiler id="application" onRender={measure}>{mode!=='home'&&<nav className="mode-nav" aria-label="Chế độ chơi"><a href="./">⌂ Trang chủ</a><a href="?mode=solo">Chơi đơn</a><a href="?mode=teacher">Giáo viên · Tạo phòng</a><a href="?mode=student">Học sinh · Vào phòng</a></nav>}<Suspense fallback={<p className="loading">Đang tải trò chơi…</p>}>{mode==='teacher'||mode==='student'?<OnlineApp role={mode==='teacher'?'teacher':'student'}/>:mode==='solo'?<SoloApp/>:<HomeScreen/>}</Suspense></React.Profiler></React.StrictMode>);
