import type { RoomProfile } from '../../shared/classroom';
import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { RaceScene } from '../game/RaceScene';
import type { RoomView } from '../../shared/protocol';
/** Snapshot targets are interpolated at render rate; this scene never simulates physics. */
export default function RemoteTrack({room,focusId,avatars}:{room:RoomView;focusId?:string;avatars:Record<string,RoomProfile>}){
 const host=useRef<HTMLDivElement>(null),scene=useRef<RaceScene|null>(null);
 const latest=useRef({room,focusId,avatars});latest.current={room,focusId,avatars};
 useEffect(()=>{
  const renderer=new RaceScene(()=>{},true);scene.current=renderer;
  renderer.setRemote(latest.current.room,latest.current.focusId);renderer.setAvatars(latest.current.avatars);
  const game=new Phaser.Game({type:Phaser.AUTO,parent:host.current!,width:900,height:600,backgroundColor:'#b2e7f5',scene:renderer,scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},fps:{target:60},render:{antialias:true}});
  const resize=new ResizeObserver(()=>game.scale.refresh());resize.observe(host.current!);
  return ()=>{resize.disconnect();scene.current=null;game.destroy(true);};
 },[]);
 useEffect(()=>{scene.current?.setRemote(room,focusId);},[room,focusId]);
 useEffect(()=>{scene.current?.setAvatars(avatars);},[avatars]);
 return <div className="stage"><div className="canvas-host" ref={host} role="img" aria-label="Đường đua trực tuyến theo trạng thái máy chủ"/><span className="scene-label">{focusId==='overview'?'TOÀN BỘ ĐƯỜNG ĐUA':focusId==='leaders'?'THEO NHÓM DẪN ĐẦU':'THEO XE ĐÃ CHỌN'}</span></div>;
}
