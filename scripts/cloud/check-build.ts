/** Validate public build config; never prints key/credential contents. */
if(process.env.VITE_AUTH_DRIVER!=='supabase'){
 const value=process.env.VITE_AUTH_DRIVER;
 const state=value===undefined?'missing':value===''?'empty':value!==value.trim()?'surrounding whitespace':'unexpected value';
 throw Error(`Pages build requires VITE_AUTH_DRIVER=supabase (${state} in Node process.env). Check this Pages project's build variables for the deployment environment; runtime bindings and .env files are not loaded by this precheck.`);
}
const url=new URL(process.env.VITE_SUPABASE_URL??'');if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||['localhost','127.0.0.1'].includes(url.hostname))throw Error('Expected Supabase HTTPS origin.');
if(process.env.VITE_SERVER_URL)throw Error('Pages uses same-origin gateway; leave VITE_SERVER_URL empty.');
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY??'';
let publicKey=key.startsWith('sb_publishable_');try{if(key.split('.').length===3)publicKey=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='anon';}catch{}
if(!publicKey)throw Error('Only a publishable/anon key may be bundled.');
if(Object.keys(process.env).some(name=>name.startsWith('VITE_')&&/SECRET|PASSWORD|SERVICE_ROLE|DATABASE|GATEWAY/.test(name)))throw Error('Server secret name found in VITE_ build variables.');
if(process.env.VITE_PUBLIC_APP_URL){const app=new URL(process.env.VITE_PUBLIC_APP_URL);if(app.protocol!=='https:'||app.username||app.password||app.search||app.hash||['localhost','127.0.0.1'].includes(app.hostname))throw Error('Expected public HTTPS app URL.');}
if(process.env.VITE_SELF_SIGNUP_ENABLED==='true'&&(!/^[A-Za-z0-9_-]{10,120}$/.test(process.env.VITE_TURNSTILE_SITE_KEY??'')||/^[123]x000000/.test(process.env.VITE_TURNSTILE_SITE_KEY??'')))throw Error('Self-signup requires a real public Turnstile site key; test keys are not a production setting.');
console.log('Pages public configuration validated. This is not a deployment or connectivity test.');
