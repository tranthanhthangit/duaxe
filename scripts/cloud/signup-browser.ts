const evidence=process.env.AUTH_9B3_OUTPUT??'benchmarks/self-signup';
/** Actual browser SDK/React, local PG and mocked Auth/Turnstile. No hosted emails. */
import {chromium} from 'playwright';
import {createServer as createVite} from 'vite';
import react from '@vitejs/plugin-react';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pgFixture} from '../../tests/helpers/postgres';
import {mockSupabase} from '../../tests/helpers/supabase';
import {migratePostgres} from '../../server/storage/postgres/migrate';
import {TeacherSignup} from '../../server/cloud/TeacherSignup';
import {SupabaseTeacherAuth} from '../../server/cloud/TeacherAuth';
import {authUserStatus} from '../../server/cloud/AuthUserStatus';
import {createGameServer} from '../../server/app';
import type {Storage} from '../../server/storage/contracts';

const f=await pgFixture(),mock=await mockSupabase();await migratePostgres(f.pool,4);
const legacy=await f.seedTeacher(),storage=await f.connect(),legacyClass=await storage.classrooms.saveClass(legacy.id,{name:'Existing owner class'}),signup=new TeacherSignup(storage.db,mock.origin,mock.secret,async token=>{assert.ok(token?.startsWith('synthetic-captcha-teacher-profile-'));}),adapter:Storage=storage;
adapter.teachers=new SupabaseTeacherAuth(storage.db,mock.issuer,undefined,authUserStatus(mock.origin,mock.secret),true,(a,t)=>signup.provision(a,t));
const base='http://127.0.0.1:5187',server=createGameServer({storage:adapter,origins:[base]});await server.ready;server.http.listen(0,'127.0.0.1');await once(server.http,'listening');const address=server.http.address();assert.ok(address&&typeof address==='object');
const vite=await createVite({configFile:false,plugins:[react()],define:{'import.meta.env.VITE_AUTH_DRIVER':'"supabase"','import.meta.env.VITE_SELF_SIGNUP_ENABLED':'"true"','import.meta.env.VITE_TURNSTILE_SITE_KEY':'"synthetic-turnstile-key"','import.meta.env.VITE_SUPABASE_URL':'"https://supabase.mock.invalid"','import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':'"sb_publishable_synthetic"','import.meta.env.VITE_SERVER_URL':'""'},server:{host:'127.0.0.1',port:5187,strictPort:true,proxy:{'/api':'http://127.0.0.1:'+address.port,'/socket.io':{target:'http://127.0.0.1:'+address.port,ws:true}}}});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors:string[]=[],passwords=new Map<string,string>(),codes=new Set<string>(),usedCaptcha=new Set<string>();let current='',sessionId=randomUUID(),signupCalls=0,authCreates=0,resends=0,recoveries=0,updates=0,throttleResend=false;
try{
 const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.route('https://challenges.cloudflare.com/**',r=>r.fulfill({contentType:'application/javascript',body:`(()=>{let n=0;const widgets=new Map();window.turnstile={render(el,o){const id='mock-'+(++n);const b=document.createElement('button');b.type='button';b.textContent='Xác minh thử nghiệm';b.onclick=()=>o.callback('synthetic-captcha-'+o.action+'-'+crypto.randomUUID());el.append(b);widgets.set(id,b);return id;},remove(id){widgets.get(id)?.remove();widgets.delete(id);}};})()`}));
 const authUser=()=>({...mock.adminUsers.get(current)!,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},created_at:new Date().toISOString()});
 const session=async()=>({access_token:await mock.token(current,{session_id:sessionId}),token_type:'bearer',expires_in:3600,refresh_token:'synthetic-refresh-token',user:authUser()});
 await context.route('https://supabase.mock.invalid/**',async route=>{
  const request=route.request(),url=new URL(request.url()),headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'*','Content-Type':'application/json'};if(request.method()==='OPTIONS'){await route.fulfill({status:200,headers,body:'{}'});return;}
  const p=request.postData()?request.postDataJSON():{};let status=200,body:unknown={};
  const captcha=()=>{const token=p.gotrue_meta_security?.captcha_token;if(typeof token!=='string'||!token.startsWith('synthetic-captcha-')||usedCaptcha.has(token))return false;usedCaptcha.add(token);return true;};
  if(url.pathname.endsWith('/signup')){
   signupCalls++;if(!captcha()){status=400;body={code:'captcha_failed',msg:'captcha required'};}
   else{
    assert.equal(url.searchParams.get('redirect_to'),base+'/?mode=teacher&auth=confirm&fresh=1');const email=p.email.toLowerCase(),old=[...mock.adminUsers.values()].find(u=>u.email===email);
    if(old){body={user:{...old,identities:[]},session:null};}
    else{current=randomUUID();mock.adminUsers.set(current,{id:current,email,email_confirmed_at:null,user_metadata:p.data});passwords.set(current,p.password);authCreates++;body={user:authUser(),session:null};}
   }
  }else if(url.pathname.endsWith('/token')){
   const grant=url.searchParams.get('grant_type');
   if(grant==='password'){
    const user=[...mock.adminUsers.values()].find(u=>u.email===p.email.toLowerCase());
    if(!captcha()||!user||passwords.get(user.id)!==p.password||!user.email_confirmed_at){status=400;body={code:'email_not_confirmed',error:'invalid_grant',error_description:'Email not confirmed or invalid credentials'};}
    else{current=user.id;sessionId=randomUUID();body=await session();}
   }else if(grant==='pkce'){
    if(codes.has(p.auth_code)||!['confirmation-code','recovery-code','legacy-confirmation','confirm-before-reset','first-login-reset'].includes(p.auth_code)){status=400;body={error:'invalid_grant',error_description:'Used or expired link'};}
    else{codes.add(p.auth_code);mock.adminUsers.get(current)!.email_confirmed_at=new Date().toISOString();sessionId=randomUUID();body=await session();}
   }else body=await session();
  }else if(url.pathname.endsWith('/resend')){assert.ok(captcha());resends++;status=throttleResend?429:200;body=throttleResend?{code:'over_email_send_rate_limit',msg:'Too many requests'}:{};}
  else if(url.pathname.endsWith('/recover')){assert.ok(captcha());assert.equal(url.searchParams.get('redirect_to'),base+'/?mode=teacher&auth=recovery&fresh=1');recoveries++;}
  else if(url.pathname.endsWith('/user')){if(request.method()==='PUT'){passwords.set(current,p.password);updates++;}body=authUser();}
  await route.fulfill({status,headers,body:JSON.stringify(body)});
 });
 const verify=()=>page.getByRole('button',{name:'Xác minh thử nghiệm',exact:true}).click();
 const signupForm=async(email:string)=>{await page.getByRole('button',{name:'Đăng ký giáo viên',exact:true}).click();await page.getByLabel('Họ và tên',{exact:true}).fill('Cô Nguyễn Thị Mai');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Mật khẩu',{exact:true}).fill('Synthetic-Password-234');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('Synthetic-Password-234');};
 const finishProfile=async()=>{await page.getByRole('button',{name:'Hoàn tất đăng nhập',exact:true}).waitFor();await verify();await page.getByRole('button',{name:'Hoàn tất đăng nhập',exact:true}).click();};
 const login=async(email:string,password='Synthetic-Password-234')=>{await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);await verify();await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();};
 const freshEmail='signup-synthetic@example.test';await page.goto(base+'/?mode=teacher&fresh=1');await signupForm(freshEmail);
 await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();await page.getByRole('alert').filter({hasText:'hoàn thành xác minh'}).waitFor();assert.equal(signupCalls,0);
 await verify();await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();await page.getByRole('status').filter({hasText:'liên kết xác nhận'}).waitFor();assert.equal(authCreates,1);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'1');const uid=current;
 await signupForm(freshEmail);await verify();await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();await page.getByRole('status').filter({hasText:'liên kết xác nhận'}).waitFor();assert.equal(authCreates,1);
 await login(freshEmail);await page.getByRole('alert').filter({hasText:'Email hoặc mật khẩu'}).waitFor();assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teacher_auth_links')).rows[0].n,'0');
 await page.goto(base+'/?mode=teacher&auth=confirm&fresh=1&code=confirmation-code');await page.getByRole('status').filter({hasText:'Email đã được xác nhận'}).waitFor();assert.equal(page.url().includes('code='),false);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'1');
 await login(freshEmail);await finishProfile();await page.getByLabel('1. Chọn lớp').waitFor();const teacher=(await f.pool.query('SELECT teacher_id FROM duaxe.teacher_auth_links WHERE auth_user_id=$1',[uid])).rows[0].teacher_id;assert.notEqual(teacher,uid);assert.notEqual(teacher,legacy.id);assert.equal((await f.pool.query('SELECT full_name FROM duaxe.teacher_profiles WHERE teacher_id=$1',[teacher])).rows[0].full_name,'Cô Nguyễn Thị Mai');
 const ownCheck=await page.evaluate(async id=>{const modulePath='/src/classroom/api.ts';const m=await import(modulePath);try{await m.api('/classes/'+id+'/students');return false;}catch{return true;}},legacyClass);assert.equal(ownCheck,true);
 await page.reload();await page.getByLabel('1. Chọn lớp').waitFor();await page.evaluate("import('/src/classroom/api.ts').then(async m=>{await m.api('/auth/profile','POST');await m.api('/auth/profile','POST');})");assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teacher_profiles')).rows[0].n,'1');
 await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.getByRole('button',{name:'Đăng nhập',exact:true}).waitFor();
 for(const code of ['confirmation-code','expired-link']){await page.goto(base+'/?mode=teacher&auth=confirm&fresh=1&code='+code);await page.getByRole('alert').filter({hasText:'Liên kết đã hết hạn'}).waitFor();assert.equal(await page.getByLabel('1. Chọn lớp').count(),0);assert.equal(page.url().includes('code='),false);}
 await page.getByRole('button',{name:'Gửi lại email xác nhận',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill(freshEmail);await verify();await page.getByRole('button',{name:'Gửi email xác nhận',exact:true}).click();await page.getByRole('status').filter({hasText:'liên kết xác nhận'}).waitFor();assert.equal(resends,1);throttleResend=true;await verify();await page.getByRole('button',{name:'Gửi email xác nhận',exact:true}).click();await page.getByRole('alert').filter({hasText:'Vui lòng chờ'}).waitFor();
 await page.getByRole('button',{name:'Quay lại đăng nhập',exact:true}).click();await page.getByRole('button',{name:'Quên mật khẩu?',exact:true}).click();await verify();await page.getByRole('button',{name:'Gửi liên kết đặt lại',exact:true}).click();await page.getByRole('status').filter({hasText:'Nếu email đủ điều kiện'}).waitFor();assert.equal(recoveries,1);
 current=uid;await page.goto(base+'/?mode=teacher&auth=recovery&fresh=1&code=recovery-code');await page.getByLabel('Mật khẩu mới',{exact:true}).fill('Synthetic-New-Password-456');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('Synthetic-New-Password-456');assert.equal(await page.getByRole('button',{name:'Xác minh thử nghiệm',exact:true}).count(),0);await page.getByRole('button',{name:'Lưu mật khẩu',exact:true}).click();await page.getByRole('button',{name:'Đăng nhập',exact:true}).waitFor();assert.equal(updates,1);
 const resetEmail='first-reset-synthetic@example.test';await signupForm(resetEmail);await verify();await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();await page.getByRole('status').filter({hasText:'liên kết xác nhận'}).waitFor();const firstResetUid=current;await page.goto(base+'/?mode=teacher&auth=confirm&fresh=1&code=confirm-before-reset');await page.getByRole('status').filter({hasText:'Email đã được xác nhận'}).waitFor();assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teacher_auth_links WHERE auth_user_id=$1',[firstResetUid])).rows[0].n,'0');
 await page.getByRole('button',{name:'Quên mật khẩu?',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill(resetEmail);await verify();await page.getByRole('button',{name:'Gửi liên kết đặt lại',exact:true}).click();await page.getByRole('status').filter({hasText:'Nếu email đủ điều kiện'}).waitFor();await page.goto(base+'/?mode=teacher&auth=recovery&fresh=1&code=first-login-reset');await page.getByLabel('Mật khẩu mới',{exact:true}).fill('Synthetic-First-Reset-789');await page.getByLabel('Nhập lại mật khẩu',{exact:true}).fill('Synthetic-First-Reset-789');await page.getByRole('button',{name:'Lưu mật khẩu',exact:true}).click();await page.getByText('Vui lòng xác minh thêm để hoàn tất tài khoản.',{exact:true}).waitFor();await verify();await page.getByRole('button',{name:'Hoàn tất đăng xuất',exact:true}).click();await page.getByRole('button',{name:'Đăng nhập',exact:true}).waitFor();assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teacher_auth_links WHERE auth_user_id=$1',[firstResetUid])).rows[0].n,'1');
 await signupForm(legacy.email);await verify();await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();await page.getByRole('status').filter({hasText:'liên kết xác nhận'}).waitFor();await page.goto(base+'/?mode=teacher&auth=confirm&fresh=1&code=legacy-confirmation');await page.getByRole('status').filter({hasText:'Email đã được xác nhận'}).waitFor();await login(legacy.email);await finishProfile();await page.getByRole('alert').filter({hasText:'hồ sơ cũ cần đối chiếu'}).waitFor();assert.equal((await f.pool.query('SELECT id FROM duaxe.teachers WHERE email=$1',[legacy.email])).rows[0].id,legacy.id);assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teachers')).rows[0].n,'3');assert.equal((await f.pool.query('SELECT count(*) n FROM duaxe.teacher_auth_links WHERE teacher_id=$1',[legacy.id])).rows[0].n,'0');
 assert.deepEqual(errors,[]);await mkdir(evidence,{recursive:true});await writeFile(evidence+'/browser.json',JSON.stringify({environment:'Local PostgreSQL17 + real React/Supabase SDK/Chromium; Auth and Turnstile emulated, no real SMTP',checks:{captchaRequiredBeforeRequest:true,oneUseCaptchaPassedToProvider:true,signup:true,duplicateEmailGeneric:true,noTeacherBeforeConfirmation:true,unconfirmedLoginDenied:true,confirmationCallbackScrubbed:true,explicitLoginAfterConfirmation:true,idempotentTeacherId:true,noAdminApprovalForNewTeacher:true,crossTenantDenied:true,reload:true,usedAndExpiredLinksDenied:true,resendAnd429:true,passwordRecovery:true,recoveryBeforeFirstLoginCreatesProfileWithoutApproval:true,legacyEmailCannotBeClaimed:true},pageErrors:errors.length,hostedAuthTested:false,realEmailSent:false},null,2)+'\n');
}finally{await browser.close();await server.idle();await server.close();await vite.close();await f.close();await mock.close();}

console.log('LOCAL MOCK CONTRACTS COMPLETED: signup/CAPTCHA UI. Hosted Auth/SMTP/Turnstile NOT TESTED.');
