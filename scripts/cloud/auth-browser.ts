const evidence=process.env.AUTH_REGRESSION_OUTPUT??'benchmarks/auth-production';
/** Real React + Supabase browser SDK, local PG and intercepted synthetic Auth only. */
import {chromium} from 'playwright';
import {createServer as createVite} from 'vite';
import react from '@vitejs/plugin-react';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pgFixture} from '../../tests/helpers/postgres';
import {mockSupabase} from '../../tests/helpers/supabase';
import {migratePostgres} from '../../server/storage/postgres/migrate';
import {SupabaseTeacherAuth} from '../../server/cloud/TeacherAuth';
import {authUserStatus} from '../../server/cloud/AuthUserStatus';
import {RoomInvites} from '../../server/cloud/RoomInvites';
import {createGameServer} from '../../server/app';
import type {Storage} from '../../server/storage/contracts';

const f=await pgFixture(),mock=await mockSupabase();await migratePostgres(f.pool,3);
const teacher=await f.seedTeacher(),uid=randomUUID(),token=await mock.token(uid),user={id:uid,email:teacher.email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString(),email_confirmed_at:new Date().toISOString()};
mock.adminUsers.set(uid,user);await f.pool.query('INSERT INTO duaxe.teacher_auth_links(auth_user_id,teacher_id) VALUES($1,$2)',[uid,teacher.id]);
const storage=await f.connect(),adapter:Storage=storage;adapter.teachers=new SupabaseTeacherAuth(storage.db,mock.issuer,undefined,authUserStatus(mock.origin,mock.secret),true);
adapter.invites=new RoomInvites(storage.db);const classId=await storage.classrooms.saveClass(teacher.id,{name:'Lớp không bị mất'});await storage.classrooms.saveStudent(teacher.id,{classId,fullName:'Synthetic child',displayName:'Child',status:'active'});
const backend=createGameServer({storage:adapter,origins:['http://127.0.0.1:5186']});await backend.ready;backend.http.listen(0,'127.0.0.1');await once(backend.http,'listening');const address=backend.http.address();assert.ok(address&&typeof address==='object');
const base='http://127.0.0.1:5186',vite=await createVite({configFile:false,plugins:[react()],define:{'import.meta.env.VITE_AUTH_DRIVER':'"supabase"','import.meta.env.VITE_SUPABASE_URL':'"https://supabase.mock.invalid"','import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':'"sb_publishable_synthetic"','import.meta.env.VITE_SERVER_URL':'""'},server:{host:'127.0.0.1',port:5186,strictPort:true,proxy:{'/api':'http://127.0.0.1:'+address.port,'/socket.io':{target:'http://127.0.0.1:'+address.port,ws:true}}}});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
let recoveries=0,updates=0,refreshes=0,globalSignouts=0,password=teacher.password;const errors:string[]=[];
try{
 const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const session=async()=>({access_token:await mock.token(uid),token_type:'bearer',expires_in:3600,refresh_token:'synthetic-refresh-token',user});
 let loseCutoffAck=true;await context.route(base+'/api/auth/revoke-sessions',async route=>{if(loseCutoffAck){loseCutoffAck=false;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');}else await route.continue();});
 await context.route('https://supabase.mock.invalid/**',async route=>{
  const request=route.request(),url=new URL(request.url()),headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'*','Content-Type':'application/json'};
  if(request.method()==='OPTIONS'){await route.fulfill({status:200,headers,body:'{}'});return;}
  let body:unknown={},status=200;
  if(url.pathname.endsWith('/token')){
   const input=request.postDataJSON();
   if(url.searchParams.get('grant_type')==='password'&&(input.email!==teacher.email||input.password!==password)){status=400;body={error:'invalid_grant',error_description:'Invalid login credentials'};}
   else{if(url.searchParams.get('grant_type')==='refresh_token')refreshes++;body=await session();}
  }else if(url.pathname.endsWith('/recover')){
   recoveries++;assert.equal(url.searchParams.get('redirect_to'),base+'/?mode=teacher&auth=recovery&fresh=1');
  }else if(url.pathname.endsWith('/user')){
   if(request.method()==='PUT'){password=request.postDataJSON().password;updates++;}body=user;
  }else if(url.pathname.endsWith('/logout')){if(url.searchParams.get('scope')==='global')globalSignouts++;}
  await route.fulfill({status,headers,body:JSON.stringify(body)});
 });
 await page.goto(base+'/?mode=teacher&fresh=1');await page.getByRole('button',{name:'Đăng nhập',exact:true}).waitFor();assert.equal(await page.getByLabel('1. Chọn lớp').count(),0);
 await page.getByLabel('Email',{exact:true}).fill(teacher.email);await page.getByLabel('Mật khẩu',{exact:true}).fill('wrong-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByRole('alert').filter({hasText:'Email hoặc mật khẩu'}).waitFor();
 await page.getByRole('button',{name:'Quên mật khẩu?',exact:true}).click();await page.getByRole('button',{name:'Gửi liên kết đặt lại',exact:true}).click();await page.getByRole('status').filter({hasText:'Nếu email đủ điều kiện'}).waitFor();assert.equal(recoveries,1);
 // PKCE reset callback uses the verifier previously persisted by the actual SDK.
 await page.goto(base+'/?mode=teacher&auth=recovery&fresh=1&code=synthetic-pkce-code');await page.getByLabel('Mật khẩu mới',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.has('code'),false);
 await page.getByLabel('Mật khẩu mới',{exact:true}).fill('weak');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('weak');await page.getByRole('button',{name:'Lưu mật khẩu',exact:true}).click();await page.getByRole('alert').filter({hasText:'12–200'}).waitFor();assert.equal(updates,0);
 await page.getByLabel('Mật khẩu mới',{exact:true}).fill('Synthetic-New-Password-234');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('Synthetic-New-Password-234');await page.getByRole('button',{name:'Lưu mật khẩu',exact:true}).click();await page.getByRole('alert').filter({hasText:'chưa xác nhận thu hồi phiên'}).waitFor();assert.equal(updates,1);assert.equal(globalSignouts,0);await page.getByRole('button',{name:'Hoàn tất đăng xuất',exact:true}).click();await page.getByRole('button',{name:'Đăng nhập',exact:true}).waitFor();assert.equal(updates,1);assert.equal(globalSignouts,1);
 // Start a genuinely new synthetic Auth session after durable logout revocation.
 const newSession=randomUUID();const originalToken=mock.token;mock.token=(id,overrides={})=>originalToken(id,{session_id:newSession,...overrides});
 await page.getByLabel('Email',{exact:true}).fill(teacher.email);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.getByLabel('1. Chọn lớp').waitFor();await page.reload();await page.getByLabel('1. Chọn lớp').waitFor();
 await page.evaluate("import('/src/classroom/auth.ts').then(m=>m.authClient.auth.refreshSession()).then(r=>{if(r.error)throw Error('Refresh failed')})");assert.ok(refreshes>=1);
 await page.getByLabel('1. Chọn lớp').selectOption(classId);await page.getByRole('button',{name:'Chọn 20 bé đầu',exact:true}).click();await page.getByRole('button',{name:'Tạo phòng chơi',exact:true}).click();await page.locator('.room-code').waitFor();
 // Signout from a second tab clears the active race and protected data too.
 const second=await context.newPage();await second.goto(base+'/?mode=teacher&fresh=1');await second.getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.getByRole('button',{name:'Đăng nhập',exact:true}).waitFor();assert.equal(await page.getByLabel('1. Chọn lớp').count(),0);assert.equal(await page.locator('.room-code').count(),0);await second.close();
 // Invalid callback is scrubbed and cannot render a reset form or admin list.
 await page.goto(base+'/?mode=teacher&auth=recovery&error=access_denied&error_description=expired');await page.getByRole('alert').filter({hasText:'Liên kết đã hết hạn'}).waitFor();assert.equal(page.url().includes('error_description'),false);assert.equal(await page.getByLabel('Mật khẩu mới').count(),0);
 const inviteToken=await mock.token(uid,{session_id:randomUUID()});await page.goto(base+'/?mode=teacher&auth=recovery&fresh=1#type=invite&access_token='+inviteToken+'&refresh_token=synthetic-invite-refresh');await page.getByLabel('Mật khẩu mới',{exact:true}).waitFor();assert.equal(new URL(page.url()).hash,'');assert.equal(await page.getByLabel('1. Chọn lớp').count(),0);
 assert.deepEqual(errors,[]);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.classes WHERE owner_id=$1',[teacher.id])).rows[0].n,'1');
 await mkdir(evidence,{recursive:true});await writeFile(evidence+'/browser.json',JSON.stringify({environment:'Local PG17 + synthetic Auth interception + actual Chromium/Supabase SDK; no hosted Supabase, no SMTP sent',checks:{protectedTeacherView:true,wrongPassword:true,recoveryRequest:true,pkceReset:true,weakPasswordRejected:true,globalSignout:true,lostCutoffAckRetryWithoutSecondPasswordChange:true,sessionReload:true,refresh:true,crossTabSignout:true,crossTabClearsActiveRace:true,invalidLinkScrubbed:true,inviteFragmentScrubbed:true,teacherIdAndClassPreserved:true},pageErrors:errors.length,realSupabase:false},null,2)+'\n');
 console.log('PASS Auth browser: login/errors/recovery/PKCE/password policy/logout/refresh/two tabs; synthetic provider only.');
}finally{await browser.close();await vite.close();await backend.close();await f.close();await mock.close();}
