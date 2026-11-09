import {storageStartupMessage} from './storage/startupError';
import {deploymentAccess} from './cloud/DeploymentGate';
import { createStorage } from './storage/factory';
import { createGameServer } from './app';
const port=Number(process.env.PORT??3001);
const origins=(process.env.CORS_ORIGINS??'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s=>s.trim()).filter(Boolean);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT không hợp lệ');
if(!origins.length||origins.some(origin=>{try{return new URL(origin).origin!==origin;}catch{return true;}}))throw new Error('CORS_ORIGINS phải chứa các origin đầy đủ, cách nhau bởi dấu phẩy.');
const access=deploymentAccess(process.env);
let storage:Awaited<ReturnType<typeof createStorage>>;
try{storage=await createStorage();}catch(error){console.error(storageStartupMessage(error));process.exit(1);}
const server=createGameServer({origins,storage,deployment:access});
let stopping=false;
async function shutdown(){
 if(stopping)return;stopping=true;
 try{await server.close();await storage.close();process.exit(0);}
 catch{console.error('Shutdown không hoàn tất trong giới hạn; tiến trình sẽ dừng, không đóng storage đang bận.');process.exit(1);}
}
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void shutdown());
try{await server.ready;if(!stopping)server.http.listen(port,'0.0.0.0',()=>console.log(`Game server listening on port ${port}`));}
catch{console.error('Không thể khởi động lưu trữ.');await server.close().catch(()=>{});await storage.close();process.exitCode=1;}
