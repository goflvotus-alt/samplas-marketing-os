// Optional Creator metadata. No gender inference, generated accounts, or score calculation.
export const PURPOSE_TAGS=['남성복 시딩','여성복 시딩','남성 팝업 초대','여성 팝업 초대'];
export const STYLE_TAGS=['스트릿','빈티지','미니멀','아방가르드','록시크','캐주얼'];
export const CREATOR_FIELDS=['memo','tags','suggestedTags','connectionEvidence'];
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const bad=()=>{throw Object.assign(Error('invalid_creator_metadata'),{status:400})};
const date=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT/.test(x)&&Number.isFinite(Date.parse(x));
const https=x=>{try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password}catch{return false}};
function tags(x){if(!object(x)||Object.keys(x).some(k=>!['purposes','styles'].includes(k)))bad();for(const [k,allowed] of [['purposes',PURPOSE_TAGS],['styles',STYLE_TAGS]])if(!Array.isArray(x[k])||new Set(x[k]).size!==x[k].length||x[k].some(t=>!allowed.includes(t)))bad();}
export function validateCreatorPatch(patch){
 if(!object(patch)||!Object.keys(patch).length||Object.keys(patch).some(k=>!CREATOR_FIELDS.includes(k)))bad();
 if('memo' in patch&&(typeof patch.memo!=='string'||patch.memo.length>10000))bad();
 if('tags' in patch)tags(patch.tags);
 if('suggestedTags' in patch){const s=patch.suggestedTags;if(!object(s)||Object.keys(s).some(k=>!['tags','source','suggestedAt'].includes(k))||s.source!=='ai'||!date(s.suggestedAt))bad();tags(s.tags);}
 if('connectionEvidence' in patch){const rows=patch.connectionEvidence;if(!Array.isArray(rows)||rows.length>200)bad();const keys=new Set();for(const e of rows){if(!object(e)||Object.keys(e).some(k=>!['type','target','handle','url','mediaId','publishedAt','checkedAt','source','scope','excerpt'].includes(k))||!['caption_mention','photo_tag','internal_history'].includes(e.type)||!['observed','manual_verified'].includes(e.source)||!https(e.url)||!date(e.checkedAt)||typeof e.target!=='string'||!e.target||e.target.length>100||typeof e.mediaId!=='string'||!e.mediaId||e.mediaId.length>200||!object(e.scope))bad();if(e.publishedAt&&!date(e.publishedAt))bad();if(e.handle&&!/^[a-z0-9._]{1,30}$/.test(e.handle))bad();if(e.excerpt&&(typeof e.excerpt!=='string'||e.excerpt.length>1500))bad();const s=e.scope;if(Object.keys(s).some(k=>!['postsChecked','from','until','paginationComplete','captionTruncated'].includes(k))||!Number.isInteger(s.postsChecked)||s.postsChecked<0||s.postsChecked>10000||typeof s.paginationComplete!=='boolean'||typeof s.captionTruncated!=='boolean'||s.from&&!date(s.from)||s.until&&!date(s.until))bad();const key=[e.type,e.target,e.mediaId].join('|');if(keys.has(key))bad();keys.add(key);}}
}
export function mergeMetaObservation(previous,account,now=new Date().toISOString()){
 if(!account)return {...(previous||{followersCount:null,latestObservedPostAt:null,lastSuccessAt:null,coverage:null}),status:'error',checkedAt:now,error:'META_READ_FAILED'};
 const posts=account.posts||[],dates=posts.map(p=>p.timestamp).filter(date).sort((a,b)=>Date.parse(a)-Date.parse(b));
 return {followersCount:Number.isSafeInteger(account.followers)&&account.followers>=0?account.followers:null,latestObservedPostAt:dates.at(-1)||null,status:'ready',checkedAt:now,lastSuccessAt:now,error:null,coverage:{postsChecked:posts.length,from:dates[0]||null,until:dates.at(-1)||null,paginationComplete:account.coverage?.paginationComplete===true,captionTruncated:true},source:'meta_business_discovery',graphVersion:account.graphVersion||null};
}
