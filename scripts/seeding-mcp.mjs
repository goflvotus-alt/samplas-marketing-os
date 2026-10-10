// Separate stateless MCP bridge. REST owns validation, storage, versions and Dropbox rev CAS.
// Authentication is enforced by server.mjs's existing /api/ai-audit/* guard.
import { validateCandidateRegistration } from './seeding-candidates.mjs';
import { validatePayload, validateCreate, CREATE_FIELDS, PROJECT_FIELDS, RECORD_FIELDS } from './seeding-store.mjs';
export const SEEDING_MCP_PATH='/api/ai-audit/seeding/mcp';
const protocols=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fields=keys=>Object.fromEntries(keys.map(k=>[k,{}]));
const patch=keys=>({type:'object',minProperties:1,additionalProperties:false,properties:fields(keys)});
const operation=(type,keys,required=['type','instagramId'])=>({type:'object',additionalProperties:false,required,properties:{type:{const:type},...(type==='update_project'?{}:{instagramId:{type:'string'}}),...(keys?{patch:patch(keys)}:{})}});
const operationSchema={oneOf:[operation('update_project',PROJECT_FIELDS,['type','patch']),operation('update_creator',['memo'],['type','instagramId','patch']),operation('update_seeding',RECORD_FIELDS,['type','instagramId','patch']),operation('add_seeding',RECORD_FIELDS),operation('add_creator_to_project',RECORD_FIELDS),operation('remove_seeding')]};
const name={type:'string',minLength:1,description:'Exact project name from listSeedingProjects; URL encoded internally.'};
export const SEEDING_TOOLS=[
 {name:'listSeedingProjects',description:'List SAMPLAS seeding projects.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'getSeedingProject',description:'Read a seeding project and its latest version before editing. Detail contains private recipient information; call only when needed.',inputSchema:{type:'object',properties:{name},required:['name'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'updateSeedingProject',description:'Apply user-requested changes using the exact production update contract and latest project version. On 409, read the project again and return the conflict. Never blindly retry. PUT body is {version, operations}; name is a query parameter. Use update_seeding patches: contactStatus="DM 완료", shippingStatus="출고 완료", trackingNumber (string), deliveredAt (YYYY-MM-DD), uploadStatus="completed", postUrl, memo. Read back after every successful write; ambiguous failures require a fresh get before retrying.',inputSchema:{type:'object',properties:{name,version:{type:'integer',minimum:1},operations:{type:'array',minItems:1,maxItems:500,items:operationSchema}},required:['name','version','operations'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}}
 ,{name:'createSeedingProject',description:'Create a new empty seeding project. Never retry an ambiguous creation without reading by name first. No recipients are copied.',inputSchema:{type:'object',additionalProperties:false,required:['name','brand','productName','publicFormUrl','responseSheetUrl','responseSheetName','startDate'],properties:{...Object.fromEntries(CREATE_FIELDS.map(k=>[k,{type:['targetCount','responseSheetGid'].includes(k)?'integer':'string'}]))}},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}}
];
SEEDING_TOOLS.push({"name": "registerSeedingCandidates", "description": "Register user-requested, externally researched Instagram candidates, not seeding recipients. Read latest project first. Submit exact production contract. No automatic retry after network failures. On 409 GET latest state and return conflict. After 201 GET readback and verify handles. Image lookup failure does not reject registration; user approval remains required.", "inputSchema": {"type": "object", "additionalProperties": false, "required": ["name", "version", "candidates"], "properties": {"name": {"type": "string", "minLength": 1, "maxLength": 200}, "version": {"type": "integer", "minimum": 1, "description": "Latest version from getSeedingProject."}, "candidates": {"type": "array", "minItems": 1, "maxItems": 10, "items": {"type": "object", "additionalProperties": false, "required": ["instagramId", "profileUrl", "recommendationReason", "source"], "properties": {"instagramId": {"type": "string", "description": "Actual Instagram handle; leading @ is accepted."}, "profileUrl": {"type": "string", "format": "uri", "description": "HTTPS instagram.com profile URL matching the handle."}, "recommendationReason": {"type": "string", "minLength": 1, "maxLength": 4000}, "source": {"type": "string", "minLength": 1, "maxLength": 4000, "description": "Discovery source URL or source description. Never fetched automatically."}}}}}}, "annotations": {"readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false}});
const fail=(status,error)=>({status,body:{ok:false,error}});
export function createSeedingRestClient({baseUrl,token,fetchImpl=fetch}){
 const base=new URL(baseUrl);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('Invalid fixed upstream');
 return async function request(method,path,projectName,body){
  if(!['GET','PUT','POST'].includes(method)||!['projects','project','candidates'].includes(path)||method==='PUT'&&path!=='project'||method==='POST'&&!['projects','candidates'].includes(path)||path==='candidates'&&method!=='POST')return fail(400,'invalid_upstream_request');
  const url=new URL('/api/ai-audit/seeding/'+path,base);if(projectName!==undefined)url.searchParams.set('name',projectName);
  try{
   const response=await fetchImpl(url,{method,redirect:'manual',headers:{Accept:'application/json','Content-Type':'application/json','x-samplas-internal-token':token},...(method!=='GET'?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
   if(response.status>=300&&response.status<400)return fail(502,'production_redirect_rejected');
   let result;try{result=await response.json()}catch{return fail(502,'production_invalid_response')}
   if(!object(result))return fail(502,'production_invalid_response');
   return {status:response.status,body:result};
  }catch{return fail(502,method!=='GET'?'write_outcome_unknown_read_before_retry':'production_unreachable')}
 };
}
export async function callSeedingTool(tool,args={},request){
 if(!SEEDING_TOOLS.some(t=>t.name===tool))return fail(400,'unknown_tool');
 if(!object(args))return fail(400,'invalid_arguments');
 const allowed=tool==='registerSeedingCandidates'?['name','version','candidates']:tool==='createSeedingProject'?CREATE_FIELDS:tool==='listSeedingProjects'?[]:tool==='getSeedingProject'?['name']:['name','version','operations'];
 if(Object.keys(args).some(k=>!allowed.includes(k)))return fail(400,'invalid_arguments');
 if(tool==='listSeedingProjects'){
  const result=await request('GET','projects');
  // Fail closed rather than allowing accidental REST list/detail schema drift to disclose PII.
  if(result.status===200&&(!Array.isArray(result.body.projects)||result.body.projects.some(p=>!object(p)||Object.keys(p).some(k=>!['name','brand','product','version','updatedAt','targetCount','counts'].includes(k)))))return fail(502,'invalid_project_list');
  return result;
 }
 if(typeof args.name!=='string'||!args.name.trim())return fail(400,'name_required');
 if(tool==='registerSeedingCandidates'){
  let input;try{input=validateCandidateRegistration(args)}catch(error){return fail(error.status||400,error.message)}
  const latest=await request('GET','project',input.name);
  if(latest.status!==200||!latest.body.ok)return latest;
  if(latest.body.project?.version!==input.version)return {status:409,body:{ok:false,error:'version_conflict',currentVersion:latest.body.project?.version}};
  const registered=await request('POST','candidates',undefined,args);
  if(registered.status===409){const current=await request('GET','project',input.name);return {status:409,body:{...registered.body,...(current.status===200?{currentVersion:current.body.project?.version}:{readbackError:current.body.error})}};}
  if(registered.status!==201||!registered.body.ok)return registered;
  const readback=await request('GET','project',input.name);
  if(readback.status!==200||!readback.body.ok)return fail(502,'registration_succeeded_readback_failed');
  const items=readback.body.project?.aiCandidates?.items||[];
  if(readback.body.project?.id!==registered.body.project?.id||readback.body.project?.version!==registered.body.project?.version||input.candidates.some(c=>items.filter(x=>x.instagramId===c.instagramId&&x.status==='pending').length!==1))return fail(409,'registration_readback_changed');
  return {status:201,body:{...readback.body,verified:true}};
 }
 if(tool==='createSeedingProject'){
  let input;try{input=validateCreate(args)}catch{return fail(400,'malformed_payload')}
  const created=await request('POST','projects',undefined,args);
  if(created.status!==201||!created.body.ok)return created;
  const readback=await request('GET','project',input.name);
  if(readback.status!==200||readback.body.project?.id!==created.body.project?.id||JSON.stringify(readback.body.project)!==JSON.stringify(created.body.project))return fail(502,'create_succeeded_readback_failed');
  return {status:201,body:{...readback.body,verified:true}};
 }
 if(tool==='getSeedingProject')return request('GET','project',args.name);
 const payload={version:args.version,operations:args.operations};
 try{validatePayload(payload)}catch{return fail(400,'malformed_payload')}
 const latest=await request('GET','project',args.name);
 if(latest.status!==200||!latest.body.ok)return latest;
 if(latest.body.project?.version!==args.version)return {status:409,body:{ok:false,error:'version_conflict',currentVersion:latest.body.project?.version,latest:latest.body}};
 const updated=await request('PUT','project',args.name,payload);
 if(updated.status===409){const current=await request('GET','project',args.name);return {status:409,body:{...updated.body,...(current.status===200?{currentVersion:current.body.project?.version,latest:current.body}:{readbackError:current.body.error})}}}
 if(updated.status!==200||!updated.body.ok)return updated;
 // A project rename is supported by the existing REST contract.
 const readback=await request('GET','project',updated.body.project?.name||args.name);
 if(readback.status!==200||!readback.body.ok)return {status:502,body:{ok:false,error:'write_succeeded_readback_failed',writtenVersion:updated.body.project?.version}};
 if(['project','seedings','creators','summary'].some(k=>JSON.stringify(readback.body[k])!==JSON.stringify(updated.body[k])))return {status:409,body:{ok:false,error:'readback_changed',writtenVersion:updated.body.project?.version,currentVersion:readback.body.project?.version}};
 return {status:200,body:{...readback.body,verified:true}};
}
export async function seedingRpc(message,request){
 const id=message?.id??null,error=(code,text)=>({status:200,body:{jsonrpc:'2.0',id,error:{code,message:text}}});
 if(!object(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')return error(-32600,'Invalid Request');
 if(!Object.hasOwn(message,'id'))return message.method==='notifications/initialized'?{status:202,body:null}:error(-32600,'Unsupported notification');
 if(!(typeof id==='string'||typeof id==='number'&&Number.isFinite(id)))return error(-32600,'Invalid id');
 const params=message.params??{};if(!object(params))return error(-32602,'Invalid params');
 let result;
 if(message.method==='initialize')result={protocolVersion:protocols.includes(params.protocolVersion)?params.protocolVersion:protocols[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'samplas-seeding-projects',version:'1.0.0'},instructions:'Private SEEDING only. List contains counts, not recipient contacts. Read latest before user-requested edits. Use exact version/operations REST contract. Never automatically retry conflicts or ambiguous writes.'};
 else if(message.method==='ping')result={};
 else if(message.method==='tools/list')result={tools:SEEDING_TOOLS};
 else if(message.method==='tools/call'){
  const outcome=await callSeedingTool(params.name,params.arguments??{},request),structuredContent={...outcome.body,httpStatus:outcome.status};
  result={content:[{type:'text',text:JSON.stringify(structuredContent)}],structuredContent,isError:![200,201].includes(outcome.status)||!outcome.body.ok};
 }else return error(-32601,'Method not found');
 return {status:200,body:{jsonrpc:'2.0',id,result}};
}
export async function serveSeedingMcp(req,res,request){
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body===null?'':JSON.stringify(body))};
 if(req.method!=='POST'){res.setHeader('Allow','POST');return send(405,{error:'Stateless MCP accepts POST only'})}
 if(req.headers.origin)return send(403,{error:'Browser origin requests are not supported'});
 if(req.headers['mcp-protocol-version']&&!protocols.includes(req.headers['mcp-protocol-version']))return send(400,{error:'Unsupported MCP protocol version'});
 let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2_000_000)return send(413,{error:'Request too large'});chunks.push(chunk)}
 let message;try{message=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return send(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})}
 const outcome=await seedingRpc(message,request);return send(outcome.status,outcome.body);
}
