import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {getVeilFoundStatus,previewVeilPosts,runVeilFoundPublisher} from './veil-found-publisher.mjs';
const fail=(code,status=400)=>Object.assign(new Error(code),{status});
const hash=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
export const VEIL_TOOLS=['getUploadStatus','previewReadyPosts','scheduleUpload','runUpload','getUploadHistory'].map(name=>({name,description:({getUploadStatus:'Read Meta/Dropbox connection and last results.',previewReadyPosts:'Read READY originals, exact four-line captions and real Instagram duplicates. Present posts to user before approval.',scheduleUpload:'Schedule once ONLY after explicit user approval of these previewed posts and time. Never retry an ambiguous request.',runUpload:'Publish ONLY these explicitly user-approved previewed posts. Never retry an ambiguous request; read history first.',getUploadHistory:'Read publication and schedule outcomes.'})[name],inputSchema:{type:'object',additionalProperties:false,properties:['runUpload','scheduleUpload'].includes(name)?{approval:{const:true,description:'Explicit user approval of exact previewed posts is required.'},requestId:{type:'string',minLength:8,maxLength:100},posts:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,required:['number','path','revision','caption'],properties:{number:{type:'integer',minimum:1},path:{type:'string'},revision:{type:'string'},caption:{type:'string'}}}},...(name==='scheduleUpload'?{scheduledAt:{type:'string',description:'ISO timestamp including Z or UTC offset; future time.'}}:{})}:{},...(['runUpload','scheduleUpload'].includes(name)?{required:['approval','requestId','posts',...(name==='scheduleUpload'?['scheduledAt']:[])]}:{})},annotations:{readOnlyHint:!['runUpload','scheduleUpload'].includes(name),destructiveHint:['runUpload','scheduleUpload'].includes(name),idempotentHint:!['runUpload','scheduleUpload'].includes(name),openWorldHint:true}}));
export function validateUploadInput(name,args,now=new Date()){
 if(!args||Array.isArray(args)||typeof args!=='object')throw fail('malformed_payload');
 const tool=VEIL_TOOLS.find(t=>t.name===name);if(!tool)throw fail('unknown_tool',404);
 if(Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k)))throw fail('malformed_payload');
 if(!['runUpload','scheduleUpload'].includes(name))return args;
 if(args.approval!==true||typeof args.requestId!=='string'||!/^[\w-]{8,100}$/.test(args.requestId)||!Array.isArray(args.posts)||args.posts.length<1||args.posts.length>10)throw fail('explicit_approval_and_posts_required');
 const nums=new Set();for(const p of args.posts){if(!p||Object.keys(p).sort().join(',')!=='caption,number,path,revision'||!Number.isInteger(p.number)||p.number<1||nums.has(p.number)||!['path','caption','revision'].every(k=>typeof p[k]==='string'&&p[k].length>0)||p.path.includes('..'))throw fail('malformed_posts');nums.add(p.number);}
 if(name==='scheduleUpload'&&(typeof args.scheduledAt!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(args.scheduledAt)||!Number.isFinite(Date.parse(args.scheduledAt))||Date.parse(args.scheduledAt)<=now.getTime()))throw fail('invalid_schedule_time');
 return args;
}
export function createVeilControl({env=process.env,workDir,now=()=>new Date(),preview=previewVeilPosts,publish=runVeilFoundPublisher,status=getVeilFoundStatus}={}){
 const file=join(workDir,'veil-found-control.json'),lock=join(workDir,'veil-found-control.lock');
 async function read(){try{return JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return {version:1,requests:[],history:[]};throw fail('control_state_unreadable',503);}}
 async function save(data){await mkdir(workDir,{recursive:true});const temp=file+'.'+randomUUID();await writeFile(temp,JSON.stringify(data),{mode:0o600});await rename(temp,file);}
 async function exclusive(fn){await mkdir(workDir,{recursive:true});let handle;try{handle=await open(lock,'wx',0o600)}catch(e){if(e.code==='EEXIST')throw fail('upload_busy_or_recovery_required',409);throw e;}try{return await fn()}finally{await handle.close();await unlink(lock);}}
 async function validatePosts(posts){const current=await preview({env,workDir});for(const p of posts){const c=current.posts.find(c=>c.number===p.number);if(!c||!c.valid||c.duplicate||['path','revision','caption'].some(k=>c[k]!==p[k]))throw fail('preview_changed_or_duplicate',409);}}
 async function execute(data,request){
  request.status='running';await save(data); // crash/network ambiguity is never automatically retried
  try{await validatePosts(request.posts);const result=await publish({env,workDir,force:true,approvedPosts:request.posts,onEvent:async event=>{data.history.push({...event,requestId:request.requestId,at:now().toISOString()});await save(data);}});request.status=result.ok&&!result.skipped?'succeeded':'not_published';request.result=result;}
  catch(e){request.status='failed_or_unknown';request.error='upload_failed_read_history_and_instagram_before_retry';request.errorCode=typeof e.code==='number'?e.code:undefined;}
  data.history.push({requestId:request.requestId,status:request.status,at:now().toISOString()});await save(data);return {ok:request.status==='succeeded',request};
 }
 async function call(name,args={}){
  validateUploadInput(name,args,now());
  if(name==='previewReadyPosts')return preview({env,workDir});
  if(name==='getUploadHistory'){const d=await read();return {ok:true,requests:d.requests,history:d.history};}
  if(name==='getUploadStatus'){const d=await read();return {ok:true,...await status({env,workDir}),lastResult:d.history.at(-1)||null,oneTimeSchedulerEnabled:env.VEIL_FOUND_ONCE_ENABLED==='true'};}
  return exclusive(async()=>{const data=await read(),existing=data.requests.find(r=>r.requestId===args.requestId);if(existing){if(existing.digest!==hash(args))throw fail('request_id_conflict',409);return {ok:existing.status==='succeeded'||existing.status==='scheduled',replayed:true,request:existing};}
   await validatePosts(args.posts);const request={...args,digest:hash(args),createdAt:now().toISOString(),status:name==='scheduleUpload'?'scheduled':'pending'};data.requests.push(request);await save(data);if(name==='scheduleUpload')return {ok:true,executionEnabled:env.VEIL_FOUND_ONCE_ENABLED==='true',...(env.VEIL_FOUND_ONCE_ENABLED!=='true'?{warning:'one_time_scheduler_disabled'}:{}),request};return execute(data,request);
  });
 }
 async function tick(){if(env.VEIL_FOUND_ONCE_ENABLED!=='true')return {skipped:true,reason:'disabled'};return exclusive(async()=>{const d=await read(),r=d.requests.find(r=>r.status==='scheduled'&&Date.parse(r.scheduledAt)<=now().getTime());return r?execute(d,r):{skipped:true,reason:'not_due'};});}
 async function record(event){return exclusive(async()=>{const d=await read();d.history.push({...event,at:now().toISOString()});await save(d);});}
 return {call,tick,record};
}
export async function serveVeilRpc(req,res,control){
 const send=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(req.method!=='POST')return send({error:'method_not_allowed'},405);
 let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>100000)return send({error:'request_too_large'},413);}
 let m;try{m=JSON.parse(text)}catch{return send({error:'parse_error'},400)}
 const reply=result=>send({jsonrpc:'2.0',id:m.id,result});
 if(!m||m.jsonrpc!=='2.0'||typeof m.method!=='string'||(m.method!=='notifications/initialized'&&!['string','number'].includes(typeof m.id)))return send({error:'invalid_request'},400);
 if(m.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(m.method==='initialize')return reply({protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'samplas-veil-found',version:'1.0.0'}});
 if(m.method==='notifications/initialized'){res.writeHead(202);return res.end();}
 if(m.method==='tools/list')return reply({tools:VEIL_TOOLS});
 if(m.method!=='tools/call')return send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});
 try{const result=await control.call(m.params?.name,m.params?.arguments);return reply({content:[{type:'text',text:JSON.stringify(result)}],isError:!result.ok});}catch(e){return reply({content:[{type:'text',text:JSON.stringify({ok:false,error:e.status?e.message:'request_failed',httpStatus:e.status||502})}],isError:true});}
}
