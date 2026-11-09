import type {AuthAdmin,AuthUser} from './TeacherMigration';
/** Operator-only client: no password/hash import and no delete-account operation. */
export class SupabaseAuthAdmin implements AuthAdmin {
 constructor(private origin:string,private key:string){}
 private async request(path:string,method='GET',body?:unknown):Promise<any>{
  const response=await fetch(this.origin+'/auth/v1'+path,{method,headers:{apikey:this.key,Authorization:'Bearer '+this.key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!response.ok)throw Error('Auth admin request not confirmed');return response.json();
 }
 async list():Promise<AuthUser[]>{
  const users:AuthUser[]=[];for(let page=1;page<=100;page++){
   const body=await this.request('/admin/users?page='+page+'&per_page=1000');if(!Array.isArray(body.users))throw Error('Invalid Auth users response');users.push(...body.users);if(body.users.length<1000)return users;
  }throw Error('Auth inventory too large; use reviewed export');
 }
 async get(id:string){const body=await this.request('/admin/users/'+id);return (body.user??body) as AuthUser;}
 async create(email:string,metadata:Record<string,string>){const body=await this.request('/admin/users','POST',{email,email_confirm:false,app_metadata:metadata});return (body.user??body) as AuthUser;}
 async invite(email:string,redirect:string){await this.request('/invite?redirect_to='+encodeURIComponent(redirect),'POST',{email});}
}
