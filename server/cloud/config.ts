export function cloudConfig(env:NodeJS.ProcessEnv=process.env){
 const url=new URL(env.SUPABASE_URL??'');
 if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('SUPABASE_URL phải là HTTPS origin.');
 if(!env.SUPABASE_STORAGE_KEY)throw Error('Thiếu secret Storage chỉ dành cho backend.');
 const bucket=env.SUPABASE_AVATAR_BUCKET??'student-avatars';
 if(!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket))throw Error('Tên private bucket không hợp lệ.');
 return {origin:url.origin,bucket,storageKey:env.SUPABASE_STORAGE_KEY};
}
