import { randomUUID } from 'node:crypto';
import { getDropboxAccessToken, asciiSafeJson } from './dropbox-report-uploader.mjs';
export const STORE_PATH='/SAMPLAS WORK/병구 작업/시딩 관련 자동화/SEEDING_DIRECTOR_LITE/seeding.json';
export const normalizeId=v=>String(v||'').trim().replace(/^@+/,'').toLowerCase();
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k), object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const aliases={contactStatus:'contact',formStatus:'response',shippingStatus:'shipping',uploadDeadline:'deadline'};
export const PROJECT_FIELDS=['name','brand','productName','publicFormUrl','editFormUrl','responseSheetUrl','responseSheetId','responseSheetName','dmMessage','shortMessage','followupMessage','startDate','endDate','storyCountsAsComplete','responseSync'];
export const RECORD_FIELDS=['product','contactStatus','formStatus','shippingStatus','size','name','phone','address','responseAt','uploadWithin7Days','repostConsent','carrier','trackingNumber','shippedAt','deliveryStatus','deliveredAt','uploadDeadline','uploadStatus','uploadedAt','postUrl','postType','memo','followup','followupContactedAt','uploadStatusMode','uploadVerifiedBy','uploadCheckedAt','trackingCheckedAt','trackingSource','trackingError','trackingHistory','responseSource','responseRow','sourceTimestamp','shippedRecordedAt','uploadedRecordedAt','uploadCheckSuggestion'];
const enums={contactStatus:['미연락','DM 완료','무응답','제외'],formStatus:['미응답','응답 완료'],shippingStatus:['미출고','출고 완료'],deliveryStatus:['tracking_missing','registered','picked_up','in_transit','out_for_delivery','delivered','exception','unknown'],uploadStatus:['waiting','check_required','completed','overdue','unavailable'],postType:['feed','reel','story','unknown'],uploadStatusMode:['auto','manual'],uploadVerifiedBy:['','manual','external_check','api']};
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const plus7=v=>{const d=new Date(v+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10)};
const dateFields=['shippedAt','deliveredAt','uploadDeadline','uploadedAt','startDate','endDate'];
export function validatePatch(patch,fields){
 if(!object(patch)||!Object.keys(patch).length)throw error('patch must be a non-empty object');
 for(const [k,v] of Object.entries(patch)){
  if(!fields.includes(k))throw error('field_not_allowed: '+k);
  if(enums[k]&&!enums[k].includes(v))throw error('invalid '+k);
  if(['followup','storyCountsAsComplete'].includes(k)){if(typeof v!=='boolean')throw error('invalid '+k);}
  else if(k==='responseRow'){if(!Number.isInteger(v)||v<1)throw error('invalid responseRow');}
  else if(k==='trackingHistory'){if(!Array.isArray(v)||v.length>200)throw error('invalid trackingHistory');}
  else if(['responseSync','uploadCheckSuggestion'].includes(k)){if(!object(v))throw error('invalid '+k);}
  else if(typeof v!=='string'||v.length>20000)throw error('invalid '+k);
  if(dateFields.includes(k)&&v){const d=new Date(v+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==v)throw error('invalid '+k);}
  if(/Url$/.test(k)&&v){try{if(!['http:','https:'].includes(new URL(v).protocol))throw 0;}catch{throw error('invalid '+k);}}
 }
}
export function validatePayload(body){
 if(!object(body)||Object.keys(body).some(k=>!['version','operations'].includes(k))||!Number.isInteger(body.version)||body.version<1||!Array.isArray(body.operations)||!body.operations.length||body.operations.length>500)throw error('malformed_payload');
 for(const op of body.operations){
  if(!object(op)||!['update_seeding','add_seeding','remove_seeding','update_project','add_creator_to_project','update_creator'].includes(op.type))throw error('invalid_operation');
  const allowed=op.type==='update_project'?['type','patch']:op.type==='remove_seeding'?['type','instagramId']:['type','instagramId','patch'];
  if(Object.keys(op).some(k=>!allowed.includes(k)))throw error('invalid_operation_field');
  if(op.type!=='update_project'&&!/^[a-z0-9._]{1,30}$/.test(normalizeId(op.instagramId)))throw error('invalid_instagramId');
  if(op.type==='update_project')validatePatch(op.patch,PROJECT_FIELDS);
  else if(op.type==='update_creator')validatePatch(op.patch,['memo']);
  else if(op.type==='update_seeding')validatePatch(op.patch,RECORD_FIELDS);
  else if(op.type!=='remove_seeding'&&op.patch!==undefined)validatePatch(op.patch,RECORD_FIELDS);
 }
 return body;
}
function applyPatch(r,patch){
 const oldTracking=r.trackingNumber;
 for(const [k,v] of Object.entries(patch))r[aliases[k]||k]=v;
 if(own(patch,'formStatus'))r.formStatus=r.response;
 if(own(patch,'trackingNumber')&&r.trackingNumber){r.shipping='출고 완료';if(!r.shippedAt)r.shippedAt=today();if(!oldTracking&&(!r.deliveryStatus||r.deliveryStatus==='tracking_missing'))r.deliveryStatus='registered';}
 if(r.deliveredAt)r.deliveryStatus='delivered';
 const basis=r.deliveredAt||r.shippedAt;if(basis)r.deadline=plus7(basis);r.uploadDeadline=r.deadline||'';
 if(r.shippedAt&&r.deliveredAt&&r.shippedAt>r.deliveredAt)throw error('deliveredAt precedes shippedAt');
 if(own(patch,'postUrl')&&r.postUrl){r.uploadStatus='completed';r.uploadStatusMode='manual';r.uploadVerifiedBy='manual';r.uploadedAt||=today();r.uploadCheckedAt=new Date().toISOString();}
 if(own(patch,'uploadStatus')&&!own(patch,'uploadStatusMode')){r.uploadStatusMode='manual';r.uploadVerifiedBy='manual';r.uploadCheckedAt=new Date().toISOString();if(r.uploadStatus==='completed')r.uploadedAt||=today();}
}
export function effectiveStatus(r){
 if(r.uploadStatusMode==='manual'||r.uploadStatus==='completed'||r.uploadStatus==='unavailable')return r.uploadStatus;
 if(r.postUrl)return 'completed';const deadline=r.deliveredAt?plus7(r.deliveredAt):r.shippedAt?plus7(r.shippedAt):r.deadline;
 if(!deadline)return r.shipping==='출고 완료'?'check_required':'waiting';if(deadline<today())return 'overdue';return (new Date(deadline+'T12:00:00Z')-new Date(today()+'T12:00:00Z'))/86400000<=1?'check_required':'waiting';
}
export function recordView(r,c){const result={id:r.id,creatorId:r.creatorId,instagramId:c.instagram};for(const k of RECORD_FIELDS)result[k]=r[aliases[k]||k]??(['followup'].includes(k)?false:k==='trackingHistory'?[]:'');result.formStatus=r.formStatus||r.response;result.uploadStatus=effectiveStatus(r);return result;}
export function projectView(p){return {...p,productName:p.product||'',startDate:p.start||'',endDate:p.end||''};}
export function summary(rs){const active=rs.filter(r=>r.contact!=='제외');return {total:rs.length,contacted:active.filter(r=>['DM 완료','무응답'].includes(r.contact)).length,responded:active.filter(r=>r.response==='응답 완료').length,shipped:active.filter(r=>r.shipping==='출고 완료').length,uploadCompleted:active.filter(r=>effectiveStatus(r)==='completed').length,uploadWaiting:active.filter(r=>r.shipping==='출고 완료'&&effectiveStatus(r)!=='completed').length,overdue:active.filter(r=>effectiveStatus(r)==='overdue').length,followUpNeeded:active.filter(r=>r.followup||r.contact==='무응답'&&!r.followupContactedAt).length};}
export function detail(doc,p){const rs=doc.seedings.filter(r=>r.projectId===p.id),ids=new Set(rs.map(r=>r.creatorId));return {ok:true,project:projectView(p),seedings:rs.map(r=>recordView(r,doc.creators.find(c=>c.id===r.creatorId))),creators:doc.creators.filter(c=>ids.has(c.id)).map(c=>{const all=doc.seedings.filter(r=>r.creatorId===c.id);return {...c,instagramId:c.instagram,projectHistory:all.map(r=>({projectName:doc.projects.find(p=>p.id===r.projectId)?.name,product:r.product,shippedAt:r.shippedAt,postUrl:r.postUrl})),shipmentCount:all.filter(r=>r.shipping==='출고 완료').length,uploadCompletedCount:all.filter(r=>effectiveStatus(r)==='completed').length,latestSeedingDate:all.map(r=>r.shippedAt).filter(Boolean).sort().at(-1)||''};}),summary:summary(rs)};}
export function applyOperations(doc,p,operations){
 const next=structuredClone(doc),project=next.projects.find(x=>x.id===p.id);
 for(const op of operations){
  if(op.type==='update_project'){if(op.patch.name&&next.projects.some(x=>x.id!==p.id&&x.name.normalize('NFC')===op.patch.name.normalize('NFC')))throw error('duplicate_project_name');for(const [k,v] of Object.entries(op.patch))project[({productName:'product',startDate:'start',endDate:'end'})[k]||k]=v;continue;}
  const handle=normalizeId(op.instagramId);let c=next.creators.find(x=>normalizeId(x.instagram)===handle),r=c&&next.seedings.find(x=>x.projectId===p.id&&x.creatorId===c.id);
  if(op.type==='update_creator'){if(!c)throw error('creator_not_found');Object.assign(c,op.patch);continue;}
  if(op.type==='update_seeding'){if(!r)throw error('seeding_not_found');applyPatch(r,op.patch);}
  else if(op.type==='remove_seeding'){if(!r)throw error('seeding_not_found');next.seedings=next.seedings.filter(x=>x.id!==r.id);}
  else {
   if(r)throw error('duplicate_instagramId');if(op.type==='add_creator_to_project'&&!c)throw error('creator_not_found');
   if(!c){c={id:randomUUID(),instagram:handle,memo:''};next.creators.push(c);}
   r={id:randomUUID(),projectId:p.id,creatorId:c.id,product:project.product||'',contact:'미연락',response:'미응답',formStatus:'미응답',shipping:'미출고',uploadStatus:'waiting',uploadStatusMode:'auto',deliveryStatus:'tracking_missing',shippedAt:'',deliveredAt:'',trackingNumber:'',postUrl:'',memo:'',size:'',carrier:'',deadline:'',followup:false};applyPatch(r,op.patch||{});next.seedings.push(r);
  }
 }
 project.version=p.version+1;project.updatedAt=new Date().toISOString();return next;
}
async function read({env,fetchImpl}){
 const token=await getDropboxAccessToken({env,fetchImpl});const res=await fetchImpl('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Dropbox-API-Arg':asciiSafeJson({path:STORE_PATH})},signal:AbortSignal.timeout(20000)});
 if(!res.ok){if(res.status===409)return {doc:null,rev:null,token};throw error('seeding_store_unavailable',502);}
 const doc=await res.json();const rev=JSON.parse(res.headers.get('dropbox-api-result')||'{}').rev;
 if(!rev||doc.schemaVersion!==1||!['projects','seedings','creators'].every(k=>Array.isArray(doc[k])))throw error('invalid_seeding_store',502);return {doc,rev,token};
}
export async function handleSeeding(method,path,name,payload,{env=process.env,fetchImpl=fetch}={}){
 if(method==='PUT')validatePayload(payload);
 const {doc,rev,token}=await read({env,fetchImpl});
 if(path.endsWith('/projects')){if(method!=='GET')throw error('Method Not Allowed',405);return {status:200,body:{ok:true,projects:(doc?.projects||[]).map(p=>({name:p.name,brand:p.brand,product:p.product,version:p.version,updatedAt:p.updatedAt,counts:summary(doc.seedings.filter(r=>r.projectId===p.id))}))}};}
 if(!name?.trim())throw error('name is required');const p=doc?.projects.find(p=>p.name.normalize('NFC')===name.normalize('NFC'));
 if(!p)throw error('project_not_found',404);if(method==='GET')return {status:200,body:detail(doc,p),etag:`"seeding-${p.version}"`};if(method!=='PUT')throw error('Method Not Allowed',405);
 if(payload.version!==p.version)return {status:409,body:{ok:false,error:'version_conflict',currentVersion:p.version}};
 const next=applyOperations(doc,p,payload.operations),res=await fetchImpl('https://content.dropboxapi.com/2/files/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream','Dropbox-API-Arg':asciiSafeJson({path:STORE_PATH,mode:{'.tag':'update',update:rev},autorename:false,mute:true})},body:JSON.stringify(next),signal:AbortSignal.timeout(20000)});
 if(res.status===409){const latest=await read({env,fetchImpl});return {status:409,body:{ok:false,error:'version_conflict',currentVersion:latest.doc?.projects.find(x=>x.id===p.id)?.version??p.version}};}
 if(!res.ok)throw error('seeding_write_failed',502);const np=next.projects.find(x=>x.id===p.id);return {status:200,body:detail(next,np),etag:`"seeding-${np.version}"`};
}
