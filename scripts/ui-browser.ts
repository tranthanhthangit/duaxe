/** Layout/interaction regression using synthetic rooms only. Original artwork is not substituted. */
import {chromium} from 'playwright';
import {createServer as createVite, type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {io,type Socket} from 'socket.io-client';
import {ClassroomStore} from '../server/classroom/Store';
import {createGameServer} from '../server/app';
import type {Credential,Reply} from '../shared/protocol';
const base='http://127.0.0.1:5181',dir=mkdtempSync(join(tmpdir(),'duaxe-ui-')),output=process.env.UI_EVIDENCE_DIR||join(dir,'screenshots');mkdirSync(output,{recursive:true});
const store=new ClassroomStore(join(dir,'db.sqlite'),join(dir,'avatars')),backend=createGameServer({origins:[base],store});
backend.http.listen(0,'127.0.0.1');await once(backend.http,'listening');const address=backend.http.address();assert.ok(address&&typeof address==='object');
const sceneFixture:Plugin={name:'ui-scene-fixture',configureServer(server){server.middlewares.use('/scene-check.html',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<div id="game"></div><script type="module">
import {RaceScene,Phaser} from '/src/game/RaceScene.ts';
const scene=new RaceScene(()=>{},true);window.scene=scene;let sequence=0;
new Phaser.Game({type:Phaser.AUTO,parent:'game',width:900,height:600,scene,render:{antialias:true}});
window.atDistance=(distance)=>scene.setRemote({code:'CHECK1',sequence:++sequence,status:'running',elapsed:100,teacherOnline:true,expiresAt:Date.now()+90000,title:'Fixture',totalQuestions:3,players:Array.from({length:20},(_,i)=>({id:'p'+i,name:'Bạn '+i,number:i+1,rank:i+1,lane:i%3,distance:distance-Math.floor(i/3)*42,speed:29,color:0x62b2e3,points:0,correct:0,wrong:0,online:true,boost:0,slow:0}))},'overview');
window.atDistance(0);
</script>`);});}};
const target='http://127.0.0.1:'+address.port,vite=await createVite({configFile:false,plugins:[react(),sceneFixture],server:{host:'127.0.0.1',port:5181,strictPort:true,proxy:{'/api':{target},'/socket.io':{target,ws:true}}}});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}),bots:Socket[]=[],errors:string[]=[];
const ask=<T,>(s:Socket,data:unknown)=>new Promise<T>((resolve,reject)=>s.timeout(5000).emit('request',data,(e:Error|null,r:Reply<T>)=>e||!r.ok?reject(e||Error(r.ok?'':r.error)):resolve(r.data)));
const connect=async()=>{const s=io(target,{autoConnect:false,transports:['websocket']});bots.push(s);const p=new Promise<void>((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});s.connect();await p;return s;};
const viewports=[{width:1920,height:1080},{width:1366,height:768},{width:768,height:1024},{width:390,height:844}];
try{
 for(const size of viewports){
  const context=await browser.newContext({viewport:size}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const layout=async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Horizontal overflow at ${size.width}`);};
  await page.goto(base);await page.locator('.home-actions').waitFor();await layout();
  assert.equal(await page.locator('canvas').count(),0);assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>/RaceScene|phaser|RemoteTrack/.test(r.name))),false);
  await page.getByRole('button',{name:'Hướng dẫn chơi',exact:false}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  await page.screenshot({path:join(output,`home-${size.width}.png`),fullPage:true});
  await page.getByRole('link',{name:'Tài khoản giáo viên',exact:false}).click();await page.getByLabel('Email',{exact:true}).waitFor();await layout();
  await page.screenshot({path:join(output,`create-${size.width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Tạo phòng chơi',exact:true}).click();await page.locator('.room-code').waitFor();const code=await page.locator('.room-code').innerText();
  const joinUrl=await page.locator('.qr-panel input').inputValue();assert.equal(new URL(joinUrl).searchParams.get('room'),code);assert.equal(new URL(joinUrl).searchParams.get('mode'),'student');assert.equal(joinUrl.includes('token'),false);
  const students=await Promise.all(Array.from({length:20},()=>connect()));await Promise.all(students.map((s,i)=>ask<Credential>(s,{type:'join',code,name:'Bạn '+(i+1),color:[0xffbd42,0x9b80ed,0xff7c8e,0x4ac6b4,0x59a9ef][i%5]})));
  await page.locator('.ranking li').nth(19).waitFor();await page.locator('canvas').waitFor();await layout();
  const qr=await page.locator('.qr-panel svg').boundingBox();assert.ok(qr&&qr.width>=180&&qr.height>=180,'Lobby QR stays large');
  await page.screenshot({path:join(output,`lobby-${size.width}.png`),fullPage:true});
  await page.getByRole('button',{name:'▶ Bắt đầu',exact:true}).click();await page.locator('.race-screen').waitFor();await page.getByRole('button',{name:'Toàn cảnh',exact:true}).click();await page.waitForTimeout(1200);await layout();
  assert.equal(await page.locator('.ranking li').count(),20);assert.equal(await page.locator('.progress-map button').count(),20);
  await page.screenshot({path:join(output,`race-${size.width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Ẩn bảng xếp hạng',exact:true}).click();assert.equal(await page.locator('.ranking').isVisible(),false);await page.getByRole('button',{name:'Hiện bảng xếp hạng',exact:true}).click();await page.getByRole('button',{name:'Nhóm dẫn đầu',exact:true}).click();
  await page.getByRole('button',{name:'Ⅱ Tạm dừng',exact:true}).click();await page.getByRole('button',{name:'▶ Tiếp tục',exact:true}).click();await page.getByRole('button',{name:'■ Kết thúc',exact:true}).click();await page.getByRole('heading',{name:'Tổng kết cuộc đua'}).waitFor();
  await context.close();students.forEach(s=>s.disconnect());console.log('PASS responsive home/create/lobby/20-car race',size.width,size.height);
 }
 // Transparent fixture only tests the geometry of future supplied art. Never published as an asset/screenshot.
 const fixture=await sharp({create:{width:1672,height:941,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
 for(const size of [viewports[0],viewports[2],viewports[3]]){
  const context=await browser.newContext({viewport:size}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/assets/game-ui/*-background.png',r=>r.fulfill({status:200,contentType:'image/png',body:fixture}));
  await page.goto(base);await page.locator('main[data-art=ready]').waitFor();const img=await page.locator('.design-backdrop img').boundingBox();assert.ok(img);assert.ok(Math.abs(img.width/img.height-1672/941)<.01);
  await page.getByRole('link',{name:'Tạo phòng chơi',exact:false}).click();await page.locator('.entry-screen[data-art=ready]').waitFor();
  const form=await page.locator('.online-entry').boundingBox();assert.ok(form);if(size.width>800){assert.ok(form.x>=size.width*.28);assert.ok(form.y>size.width*.23);}else assert.ok(form.y>=size.width*941/1672);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await context.close();
 }
 const scenePage=await browser.newPage({viewport:{width:1000,height:750}});scenePage.on('pageerror',e=>errors.push(e.message));await scenePage.goto(base+'/scene-check.html');
 await scenePage.waitForFunction(()=>{const s=(window as unknown as {scene?:{finishLabel?:{visible:boolean}}}).scene;return s?.finishLabel!==undefined;});
 assert.equal(await scenePage.evaluate(()=>((window as unknown as {scene:{finishLabel:{visible:boolean}}}).scene.finishLabel.visible)),false,'No finish gate at the starting grid');
 await scenePage.evaluate('window.atDistance(3180)');await scenePage.waitForFunction('window.scene.finishLabel.visible');await scenePage.waitForTimeout(1500);await scenePage.screenshot({path:join(output,'finish-gate.png')});
 const projected=await scenePage.evaluate(`(()=>{const s=window.scene,depth=Math.pow(Math.max(0,Math.min(1,1-(3200-s.cameraDistance)/s.cameraRange)),2),scale=.22+depth*.88;return {labelY:s.finishLabel.y,expectedY:168+depth*372-120*scale,cars:s.model.cars.length};})()` ) as {labelY:number;expectedY:number;cars:number};assert.ok(Math.abs(projected.labelY-projected.expectedY)<.01);assert.equal(projected.cars,20);await scenePage.close();
 const motion=await browser.newContext({reducedMotion:'reduce'}),page=await motion.newPage();await page.goto(base+'/?mode=teacher&fresh=1');await page.locator('.online-entry').waitFor();assert.equal(await page.locator('.online-entry').evaluate(el=>getComputedStyle(el).animationName),'none');await motion.close();
 assert.deepEqual(errors,[]);writeFileSync(join(output,'checks.json'),JSON.stringify({passed:true,viewports,originalArtworkAvailable:['home-background.png','create-room-background.png','race-background.png'].every(name=>existsSync(join('public/assets/game-ui',name))),syntheticFixtureOnlyForGeometry:true,finishGateWorldCoordinateChecked:true,noJavaScriptErrors:true},null,2));console.log('PASS artwork aspect ratio/safe areas and reduced motion; screenshots:',output);
}finally{bots.forEach(s=>s.disconnect());await browser.close();await vite.close();await backend.close();store.close();rmSync(dir,{recursive:true,force:true});}
