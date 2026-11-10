/** Local React + Supabase SDK with intercepted provider calls. No real email/database. */
import {chromium} from 'playwright';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import assert from 'node:assert/strict';
const define=Object.fromEntries(Object.entries({VITE_AUTH_DRIVER:'supabase',VITE_SELF_SIGNUP_ENABLED:'true',VITE_TURNSTILE_SITE_KEY:'synthetic',VITE_SUPABASE_URL:'https://supabase.mock.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',VITE_SERVER_URL:''}).map(([k,v])=>['import.meta.env.'+k,JSON.stringify(v)]));
const vite=await createServer({configFile:false,plugins:[react()],define,server:{host:'127.0.0.1',port:5194,strictPort:true}});await vite.listen();
let browser;
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1000,height:650}});let calls=0,meCalls=0,code='captcha_failed',status=400;const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/socket.io/**',r=>r.abort());
 await page.route('**/api/me',r=>{meCalls++;return r.fulfill({status:401,body:'{}'});});
 await page.route('https://challenges.cloudflare.com/**',r=>r.fulfill({contentType:'application/javascript',body:`window.turnstile={render(el,o){const b=document.createElement('button');b.type='button';b.textContent='Synthetic verify';b.onclick=()=>o.callback('synthetic-token');el.append(b);return 'mock';},remove(){}};`}));
 await page.route('https://supabase.mock.invalid/**',async r=>{if(r.request().method()==='OPTIONS'){await r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});return;}calls++;await r.fulfill({status,headers:{'x-supabase-api-version':'2024-01-01','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'x-supabase-api-version'},contentType:'application/json',body:JSON.stringify(status===200?{user:{id:'synthetic',identities:[]},session:null}:{code,msg:'provider private details'})});});
 await page.goto('http://127.0.0.1:5194/?mode=teacher&fresh=1');
 await page.getByRole('button',{name:'Đăng ký giáo viên',exact:true}).click();
 await page.getByLabel('Họ và tên',{exact:true}).fill('Test Teacher');await page.getByLabel('Email',{exact:true}).fill('synthetic@example.test');
 const password=page.getByLabel('Mật khẩu',{exact:true}),confirm=page.getByLabel('Nhập lại mật khẩu',{exact:true});
 const submit=()=>page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();
 const expectAlert=async(text:string)=>{const a=page.getByRole('alert').filter({hasText:text});await a.waitFor({timeout:10000}).catch(async e=>{console.error('Visible feedback:',await page.getByRole('alert').allTextContents(),'provider calls',calls);throw e;});assert.equal(await a.evaluate(e=>document.activeElement===e),true);const box=await a.boundingBox();assert.ok(box&&box.y>=0&&box.y<650);};
 await password.fill('short1');await confirm.fill('short1');await submit();await expectAlert('12–200');assert.equal(calls,0);
 await password.fill('Synthetic-Password-234');await confirm.fill('different');await submit();await expectAlert('chưa giống');assert.equal(calls,0);
 await confirm.fill('Synthetic-Password-234');await submit();await expectAlert('hoàn thành xác minh');assert.equal(calls,0);
 for(const [c,s,message] of [['captcha_failed',400,'hết hạn'],['email_address_not_authorized',400,'SMTP'],['over_email_send_rate_limit',429,'Quá nhiều'],['unexpected_failure',500,'Auth logs']] as const){code=c;status=s;await page.getByText('Synthetic verify',{exact:true}).click();await submit();await expectAlert(message);}
 status=200;await page.getByText('Synthetic verify',{exact:true}).click();await submit();await page.getByRole('status').filter({hasText:'liên kết xác nhận'}).waitFor();
 assert.equal(calls,5);assert.equal(meCalls,0);assert.deepEqual(errors,[]);
 console.log('PASS: short/mismatched password, missing CAPTCHA, CAPTCHA/SMTP/rate/provider errors, confirmation notice, focused visible feedback, no anonymous /me. Mock providers only.');
}finally{await browser?.close();await vite.close();}
