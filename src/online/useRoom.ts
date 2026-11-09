import {cloudAuth,teacherToken,authClient} from '../classroom/auth';
import type { RoomProfile } from '../../shared/classroom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Credential, Frame, Reply, Request, Role, QuestionMessage } from '../../shared/protocol';
import type { QuestionSet } from '../questions/model';
export function savedSession(role:Role,code?:string):Credential|null {
 try{const value=JSON.parse(localStorage.getItem(code?`race:${role}:${code}`:`race:${role}:last`)??'null');return value&&value.role===role&&typeof value.code==='string'&&typeof value.token==='string'&&typeof value.playerId==='string'?value:null;}catch{return null;}
}
function storeSession(value:Credential){try{localStorage.setItem(`race:${value.role}:${value.code}`,JSON.stringify(value));localStorage.setItem(`race:${value.role}:last`,JSON.stringify(value));}catch{/* Session still works in memory; UI warns below. */}}
export function useRoom(role:Role,initialCode:string) {
 const [expiryVersion,setExpiryVersion]=useState(0);
 const [avatars,setAvatars]=useState<Record<string,RoomProfile>>({});
 const [auth,setAuth]=useState<Credential|null>(null),[frame,setFrame]=useState<Frame|null>(null),[questionState,setQuestion]=useState<QuestionMessage|null>(null),[settings,setSettings]=useState<QuestionSet|null>(null);
 const [connected,setConnected]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[replaced,setReplaced]=useState(false),[busy,setBusy]=useState(false);
 const socket=useRef<Socket|null>(null),credential=useRef<Credential|null>(new URLSearchParams(location.search).get('fresh')==='1'?null:savedSession(role,initialCode||undefined));
 const epoch=useRef(0),lastQuestion=useRef(-1),lastFrame=useRef<Frame|null>(null);
 const request=useCallback(async<T,>(payload:Request):Promise<T>=>{
  if(cloudAuth&&role==='teacher'){const connection=socket.current,token=await teacherToken();if(!connection?.connected||!token)throw Error('Vui lòng đăng nhập giáo viên.');await new Promise<void>((r,j)=>connection.timeout(5000).emit('teacher-auth',token,(error:Error|null,reply:{ok:boolean})=>error||!reply?.ok?j(Error('Vui lòng đăng nhập giáo viên.')):r()));}
  return new Promise((resolve,reject)=>{
  const connection=socket.current;if(!connection?.connected)return reject(new Error('Chưa kết nối máy chủ.'));
  const generation=epoch.current;
  connection.timeout(8000).emit('request',{...payload,commandId:payload.commandId??('c'+crypto.getRandomValues(new Uint32Array(4)).join('-'))},(error:Error|null,reply:Reply<T>)=>{
   if(generation!==epoch.current||!connection.connected)return reject(new Error('Kết nối đã đóng.'));
   if(error)return reject(new Error('Chưa nhận được xác nhận. Hãy kết nối lại; không tạo lại người chơi ngay.'));
   if(!reply?.ok)return reject(new Error(reply?.error??'Yêu cầu thất bại.'));resolve(reply.data);
  });
 });},[role]);
 const resume=useCallback(async(value:Credential)=>{setBusy(true);setError('');try{await request<Credential>({type:'resume',credential:value});credential.current=value;setAuth(value);setReplaced(false);setReady(!!socket.current?.connected);}catch(e){const message=(e as Error).message;setError(message);setReady(false);if(/Phiên không hợp lệ|Không tìm thấy học sinh/.test(message)){try{localStorage.removeItem(`race:${value.role}:${value.code}`);localStorage.removeItem(`race:${value.role}:last`);}catch{}credential.current=null;setAuth(null);setFrame(null);setAvatars({});lastFrame.current=null;lastQuestion.current=-1;}}finally{setBusy(false);}},[request]);
 useEffect(()=>{
  const connection=io(import.meta.env.VITE_SERVER_URL||undefined,{autoConnect:false,withCredentials:true,reconnection:true,reconnectionDelay:700,reconnectionDelayMax:5000,auth:callback=>{void (role==='teacher'?teacherToken():Promise.resolve('')).then(token=>callback({teacherToken:token,invite:new URLSearchParams(location.search).get('invite')??''})).catch(()=>callback({}));}});socket.current=connection;
  connection.on('connect',()=>{epoch.current++;setConnected(true);if(credential.current)void resume(credential.current);});
  connection.on('disconnect',()=>{epoch.current++;setConnected(false);setReady(false);});
  connection.on('connect_error',()=>setError('Không kết nối được máy chủ. Kiểm tra Wi-Fi, URL máy chủ và CORS.'));
  connection.on('frame',(incoming:Frame)=>{
   const previous=lastFrame.current;if(previous?.room.code===incoming.room.code&&previous.room.sequence>=incoming.room.sequence)return;
   lastFrame.current=incoming;setFrame(incoming);
  });
  connection.on('question',(message:QuestionMessage)=>{
   if(message.sequence<=lastQuestion.current)return;
   lastQuestion.current=message.sequence;setQuestion(message);
  });connection.on('settings',setSettings);
  connection.on('avatars',(profiles:RoomProfile[])=>setAvatars(Object.fromEntries(profiles.slice(0,20).map(p=>[p.studentId,p]))));
  connection.on('released',()=>{const old=credential.current;if(old){try{localStorage.removeItem(`race:${old.role}:${old.code}`);localStorage.removeItem(`race:${old.role}:last`);}catch{}}credential.current=null;setAuth(null);setFrame(null);lastFrame.current=null;lastQuestion.current=-1;setQuestion(null);setAvatars({});setError('Cô đã giải phóng hồ sơ. Kết nối lại để chọn đúng bạn.');});
  connection.on('storage-error',(message:string)=>{setReady(false);setError(message);});
  connection.on('replaced',()=>{setReplaced(true);setReady(false);setError('Phiên này đã được mở ở tab hoặc thiết bị khác. Tab này đã ngừng điều khiển.');});
  connection.on('expired',()=>{setExpiryVersion(v=>v+1);setAvatars({});setFrame(null);setReady(false);setError('Phòng đã hết hạn. Mở Lịch sử trò chơi để xem kết quả đã lưu.');});
  const subscription=authClient?.auth.onAuthStateChange((event,session)=>{if(role==='teacher'){if(event==='SIGNED_OUT'){connection.disconnect();setReady(false);setAuth(null);setFrame(null);setAvatars({});setQuestion(null);setSettings(null);lastFrame.current=null;lastQuestion.current=-1;}else if(event==='SIGNED_IN'||event==='TOKEN_REFRESHED'){if(!connection.connected)connection.connect();else if(session?.access_token)connection.timeout(5000).emit('teacher-auth',session.access_token,(error:Error|null,reply:{ok:boolean})=>{if(error||!reply?.ok)setError('Vui lòng đăng nhập lại giáo viên.');});}}});
  connection.connect();return ()=>{subscription?.data.subscription.unsubscribe();connection.removeAllListeners();connection.disconnect();socket.current=null;};
 },[resume]);
 const act=useCallback(async<T,>(payload:Request):Promise<T|undefined>=>{setError('');setBusy(true);try{return await request<T>(payload);}catch(e){setError((e as Error).message);return undefined;}finally{setBusy(false);}},[request]);
 const enter=async(payload:Extract<Request,{type:'create'|'join'|'claim'|'recoverTeacher'}>)=>{
  // Never silently replace a valid stored student identity with a new player.
  const previous=(payload.type==='join'||payload.type==='claim')?savedSession('student',payload.code):null;
  if(previous){credential.current=previous;await resume(previous);return;}
  const value=await act<Credential>(payload);if(value){credential.current=value;storeSession(value);setAuth(value);setReady(true);}
 };
 const reconnect=()=>{setReplaced(false);setReady(false);socket.current?.disconnect();socket.current?.connect();};
 return {expiryVersion,avatars,auth,frame,question:frame?.self?.index===questionState?.index?questionState?.question??null:null,settings,connected,ready,error,replaced,busy,act,enter,reconnect,resume};
}
