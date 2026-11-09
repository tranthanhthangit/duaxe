import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { RaceScene } from './RaceScene';
import type { RaceCommand, RaceSnapshot } from './config';
export function GameCanvas({ onSnapshot, connect }: { onSnapshot:(s:RaceSnapshot)=>void; connect:(send:((c:RaceCommand)=>void)|null)=>void }) {
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const scene=new RaceScene(onSnapshot);
    const game=new Phaser.Game({ type:Phaser.AUTO, parent:host.current!, width:900,height:600, backgroundColor:'#b2e7f5', scene, scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH}, render:{antialias:true}, fps:{target:60} });
    connect(command=>scene.command(command));
    return ()=>{connect(null);game.destroy(true);};
  },[onSnapshot,connect]);
  return <div className="canvas-host" ref={host} role="img" aria-label="Đường đua hoạt hình ba làn với năm xe đua. Dùng các nút hoặc phím mũi tên để chuyển làn."/>;
}
