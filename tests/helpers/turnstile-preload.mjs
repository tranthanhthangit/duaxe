// Explicit local process-test loader, never imported by the application entrypoint.
// Refuse a hosted DB/provider even if someone accidentally adds this loader to Node.
const db=new URL(process.env.DATABASE_URL??''),provider=new URL(process.env.SUPABASE_URL??'');
if(db.hostname!=='127.0.0.1'||provider.hostname!=='127.0.0.1'||process.env.TURNSTILE_EXPECTED_HOSTNAME!=='classroom.test.invalid')throw Error('Local fixture preload refuses non-loopback targets');
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 if(String(input)==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){
  const body=JSON.parse(String(init?.body));if(body.response!=='synthetic-local-enrollment-token')return new Response(JSON.stringify({success:false}));
  return new Response(JSON.stringify({success:true,hostname:'classroom.test.invalid',action:'teacher-profile',challenge_ts:new Date().toISOString()}));
 }
 return original(input,init);
};
