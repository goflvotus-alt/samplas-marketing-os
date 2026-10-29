// Optional observer for the EXISTING Claude run2 f3/nt6 steps; never invokes either step or a browser.
// Outbox lives outside Dropbox and never stores credentials. Recovery retries registration only.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {captionSha256,createPostStore,newPostRecord} from './instagram-product-tag-runner.mjs';
import {registerScheduledPost} from './instagram-scheduled-registration.mjs';

export function scheduledSlotIso(text) {
  const m=String(text || '').match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일.*?(\d{1,2})\s*:\s*(\d{2})\s*(AM|PM)/);
  if(!m || +m[2]<1 || +m[2]>12 || +m[3]<1 || +m[3]>31 || +m[4]<1 || +m[4]>12 || +m[5]>59)return null;
  const hour=(+m[4]%12)+(m[6]==='PM'?12:0);
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],hour-9,+m[5]));
  const local=new Date(d.getTime()+9*3600000);
  if(local.getUTCFullYear()!==+m[1] || local.getUTCMonth()!==+m[2]-1 || local.getUTCDate()!==+m[3])return null;
  return d.toISOString();
}

export function createSchedulingRegistrationHook({config,stateDir,baseUrl,authorization,fetchImpl=fetch,now=()=>new Date().toISOString()}) {
  const input={...config,captionSha256:config?.captionSha256};
  const made=newPostRecord(input);
  if(!made.ok || !stateDir || /(?:^|\/)(?:Dropbox[^/]*|READY|UPLOADED)(?:\/|$)/i.test(resolve(stateDir)) || !Array.isArray(config.dimensions) || config.dimensions.length!==config.slideCount || config.dimensions.some(d=>!/^\d+x\d+$/.test(d)))throw new Error('invalid_hook_config');
  const identity=captionSha256(JSON.stringify([made.record,config.dimensions,baseUrl]));
  const store=createPostStore(stateDir);
  let queue=Promise.resolve();
  const serial=fn=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;};
  const get=async()=>{const saved=await store.get(config.folderName);if(saved && saved.identity!==identity)throw new Error('registration_config_changed');return saved;};
  const save=async r=>{await store.put(r);return {state:r.state,registrationAttempts:r.registrationAttempts || 0};};
  const send=async record=>{
    const pending={...record,state:'REGISTERING',registrationAttempts:(record.registrationAttempts||0)+1,attemptedAt:now()};
    await save(pending); // Before network; a crash cannot trigger an automatic second registration attempt.
    let result;
    try {result=await registerScheduledPost({receipt:pending.receipt,baseUrl,authorization,mappingProposal:config.mappingProposal,autoTag:config.mappingProposal?undefined:config.autoTag,acceptUnverifiedVariantApproval:!config.mappingProposal && config.acceptUnverifiedVariantApproval===true,fetchImpl});}
    catch {result={ok:false,error:'registration_config_or_request_failed'};}
    return save({...pending,state:result.ok?'REGISTERED':result.error==='registration_outcome_unknown'?'REGISTRATION_OUTCOME_UNKNOWN':'REGISTRATION_FAILED',
      error:result.ok?null:'registration_requires_recovery',updatedAt:now()});
  };
  return {
    observe: result=>serial(async()=>{
      let record=await get();
      if(record && ['REGISTERED','REGISTERING','REGISTRATION_FAILED','REGISTRATION_OUTCOME_UNKNOWN'].includes(record.state))return {state:record.state,registrationAttempts:record.registrationAttempts||0};
      if(result?.kind==='schedule-success') {
        if(result.ok!==true || result.account!=='samplaskr' || result.captionSha256!==made.record.captionSha256 || scheduledSlotIso(result.slotText)!==made.record.slotIso)return {state:'SCHEDULE_SUCCESS_UNVERIFIED'};
        return save({folderName:config.folderName,identity,state:'AWAITING_FINAL_VERIFICATION',scheduleConfirmedAt:result.at||now(),registrationAttempts:0});
      }
      if(result?.kind!=='schedule-verification' || !record)return {state:'AWAITING_SCHEDULE_SUCCESS'};
      const observations=Array.isArray(result.observations)?result.observations:[];
      const matches=observations.filter(o=>o.captionSha256===made.record.captionSha256 && scheduledSlotIso(o.sched)===made.record.slotIso);
      const hit=matches[0];
      const verified=result.complete===true && result.calendarCount===observations.length && matches.length===1 && hit.captionMatch===true &&
        Array.isArray(hit.sizes) && hit.sizes.length===config.slideCount && hit.sizes.every((s,i)=>s===config.dimensions[i]) &&
        Array.isArray(hit.order) && hit.order.length===config.slideCount && hit.order.every((pair,i)=>Array.isArray(pair) && pair[0]===i+1 && pair[1]===0);
      if(!verified)return save({...record,state:'VERIFICATION_FAILED',updatedAt:now()});
      const receipt={account:'samplaskr',state:'SCHEDULED',folderName:config.folderName,slotIso:made.record.slotIso,captionSha256:made.record.captionSha256,slideCount:config.slideCount,
        verified:{caption:true,slot:true,slides:true,order:true,dimensions:true}};
      return send({...record,receipt,verifiedAt:now()});
    }),
    retryRegistration:()=>serial(async()=>{
      const record=await get();
      if(!record?.receipt || !['REGISTERING','REGISTRATION_FAILED','REGISTRATION_OUTCOME_UNKNOWN'].includes(record.state))throw new Error('no_registration_to_recover');
      return send(record);
    })
  };
}

// Loaded by run2 only when the existing Claude task explicitly configures this module + nonsecret config.
export default async function observeSchedulingStep(result,{env=process.env}={}) {
  if(!env.SAMPLAS_IG_REGISTRATION_CONFIG)return {state:'REGISTRATION_HOOK_DISABLED'};
  const config=JSON.parse(await readFile(env.SAMPLAS_IG_REGISTRATION_CONFIG,'utf8'));
  const authorization=env.CAFE24_PROXY_BASIC_AUTH?`Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString('base64')}`:undefined;
  const hook=createSchedulingRegistrationHook({config,stateDir:env.SAMPLAS_IG_REGISTRATION_STATE_DIR,baseUrl:env.SAMPLAS_MARKETING_OS_URL,authorization});
  return hook.observe(result);
}
