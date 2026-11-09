import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function run(file:string, values:NodeJS.ProcessEnv={}){
 const env={...process.env};
 for(const name of Object.keys(env))if(name.startsWith('VITE_')||name.startsWith('CF_PAGES')||name==='NODE_VERSION')delete env[name];
 return spawnSync(process.execPath,['--import','tsx',file],{env:{...env,...values},encoding:'utf8'});
}
const diagnostic='scripts/cloud/build-env.mjs',check='scripts/cloud/check-build.ts';
const valid={VITE_AUTH_DRIVER:'supabase',VITE_SUPABASE_URL:'https://project.example.test',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',VITE_SELF_SIGNUP_ENABLED:'true',VITE_TURNSTILE_SITE_KEY:'synthetic-public-site-key'};
test('build diagnostic distinguishes missing and empty variables without printing supplied values',()=>{
 const marker='private-marker-do-not-print';
 const result=run(diagnostic,{VITE_AUTH_DRIVER:marker,VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:marker,VITE_DATABASE_SECRET:marker,SMTP_PASSWORD:marker});
 assert.equal(result.status,0);assert.equal((result.stdout+result.stderr).includes(marker),false);
 const data=JSON.parse(result.stdout);assert.equal(data.authDriverExactlySupabase,false);
 assert.equal(data.variables.VITE_SUPABASE_URL.state,'empty');assert.equal(data.variables.VITE_TURNSTILE_SITE_KEY.state,'missing');
});
test('build diagnostic reports exact match and whitespace without correcting either',()=>{
 const good=JSON.parse(run(diagnostic,{...valid,NODE_VERSION:'24',CF_PAGES:'1'}).stdout);
 assert.equal(good.authDriverExactlySupabase,true);assert.equal(good.cloudflarePages,true);
 const bad=JSON.parse(run(diagnostic,{VITE_AUTH_DRIVER:' supabase\n'}).stdout);
 assert.equal(bad.authDriverExactlySupabase,false);assert.equal(bad.variables.VITE_AUTH_DRIVER.surroundingWhitespace,true);
});
test('precheck still rejects missing, empty, quoted and whitespace auth driver',()=>{
 for(const [value,reason] of [[undefined,'missing'],['','empty'],['"supabase"','unexpected value'],['supabase ','surrounding whitespace']] as const){
  const env={...valid};if(value===undefined)delete (env as NodeJS.ProcessEnv).VITE_AUTH_DRIVER;else env.VITE_AUTH_DRIVER=value;
  const result=run(check,env);assert.notEqual(result.status,0);assert.ok(result.stderr.includes(reason));
 }
});
test('precheck accepts explicit public configuration and preserves secret/test-key guards',()=>{
 assert.equal(run(check,valid).status,0);
 assert.notEqual(run(check,{...valid,VITE_DATABASE_SECRET:'synthetic-private-value'}).status,0);
 assert.notEqual(run(check,{...valid,VITE_TURNSTILE_SITE_KEY:'1x00000000000000000000AA'}).status,0);
});
