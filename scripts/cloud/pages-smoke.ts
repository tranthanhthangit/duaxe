/** Executes the compiled Worker locally; no Cloudflare API/deployment. */
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const source=await readFile('/tmp/duaxe-pages-check/index.js','utf8');
const options=(mode:string)=>({...convertV4MiniflareOptions({name:'duaxe-pages-local',modules:true,script:source,compatibilityDate:'2026-11-01',bindings:{ACCESS_MODE:mode}}),telemetry:{enabled:false}});
const worker=new Miniflare(options('closed'));
try{
 const paths=['/','/assets/app.js','/?mode=student&room=ABC234','/api/classes','/socket.io/?EIO=4&transport=websocket'];
 for(const path of paths){const response=await worker.dispatchFetch('https://school.pages.dev'+path);assert.equal(response.status,503,path);assert.equal(response.headers.get('Cache-Control'),'no-store');}
 await worker.setOptions(options('pilot'));
 for(const path of paths)assert.equal((await worker.dispatchFetch('https://school.pages.dev'+path)).status,403,path);
 await mkdir('benchmarks/production-local',{recursive:true});await writeFile('benchmarks/production-local/pages-gate.json',JSON.stringify({environment:'Local workerd/Miniflare compiled Pages Worker; no hosted Cloudflare',closedPaths:paths,closedStatus:503,pilotWithoutIdentity:403,passed:true},null,2)+'\n');console.log('PASS compiled Pages Worker: static assets, SPA, API and Socket.IO path all fail closed.');
}finally{await worker.dispose();}
