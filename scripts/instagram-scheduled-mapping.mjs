// Reuse findings prepared during Claude scheduling. No image model or paid API is involved.
import {buildAutoMapping} from './instagram-product-tag-automap.mjs';
import {checkTagCandidate,SAMPLAS_META} from './instagram-product-tags.mjs';

export function validateScheduledProposal(p,folderName,slideCount) {
  const problems=[];
  if(p?.schemaVersion!==1 || p?.folderName!==folderName || typeof p?.brand!=='string' || !p.brand.trim() || typeof p?.preparedBy!=='string' || !p.preparedBy.trim())problems.push('proposal_identity');
  if(!Array.isArray(p?.mappings) || p.mappings.length>100) return [...problems,'proposal_mappings'];
  for(const m of p.mappings) {
    if(!Number.isInteger(m?.slideIndex) || m.slideIndex<1 || m.slideIndex>slideCount || !/^assets\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(m.savedAsset || ''))problems.push('proposal_slide');
    if(typeof m?.reviewRequired!=='boolean' || typeof m?.evidence!=='string' || !m.evidence.trim())problems.push('proposal_evidence');
    if(m.productNo!=null && (!Number.isInteger(m.productNo)||m.productNo<=0))problems.push('proposal_product');
    if(!m.reviewRequired && (!Number.isInteger(m.productNo) || ![m.x,m.y].every(v=>typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1)))problems.push('proposal_coordinates_or_product');
    if(m.metaProductId!=null && (typeof m.metaProductId!=='string' || !/^\d+$/.test(m.metaProductId)))problems.push('proposal_meta_id');
    if([m.color,m.option].some(v=>v!=null && typeof v!=='string'))problems.push('proposal_option');
    if(m.variantCode!=null && (typeof m.variantCode!=='string' || !m.variantCode.trim()))problems.push('proposal_variant');
    if(m.confidence!=null && !(typeof m.confidence==='number' && Number.isFinite(m.confidence) && m.confidence>=0 && m.confidence<=1))problems.push('proposal_confidence');
  }
  return [...new Set(problems)];
}

export async function buildScheduledMapping({proposal,manifest,graph,getCafe24Product,now=Date.now(),expected=SAMPLAS_META}) {
  if(validateScheduledProposal(proposal,manifest?.folderName,manifest?.items?.length).length)throw new Error('invalid_scheduled_proposal');
  if(!Array.isArray(manifest.items) || manifest.items.some((m,i)=>m.order!==i+1) || proposal.mappings.some(m=>manifest.items[m.slideIndex-1]?.savedAsset!==m.savedAsset))throw new Error('proposal_manifest_mismatch');
  const findings={schemaVersion:1,folderName:proposal.folderName,brand:proposal.brand,analyzer:proposal.preparedBy,
    slides:manifest.items.map(m=>({order:m.order,savedAsset:m.savedAsset,items:proposal.mappings.filter(x=>x.slideIndex===m.order).map(x=>({
      label:x.label || 'scheduled garment',x:x.x,y:x.y,color:x.color,metaProductId:x.metaProductId,variantCode:x.variantCode,
      candidates:Number.isInteger(x.productNo)?[{productNo:x.productNo,confidence:x.reviewRequired?0:(x.confidence??0),evidence:x.evidence}]:[]
    }))}))};
  const out=await buildAutoMapping({graph,findings,manifest,getCafe24Product,expected,now});
  if(!out.ok)throw new Error('invalid_scheduled_findings');
  for(const s of out.mapping.slides)for(const t of s.tags) {
    const input=proposal.mappings.find(x=>x.slideIndex===s.order && x.productNo===t.productNo);
    Object.assign(t,{color:input.color??null,option:input.option??null,requestedVariantCode:input.variantCode??null,reviewRequired:input.reviewRequired});
    if(input.option && !input.variantCode)Object.assign(t,{status:'TAG_REVIEW_REQUIRED',reason:'option_identifier_required'});
    if(t.status==='PROPOSED') {
      let result;
      try {result=await checkTagCandidate(graph,{...expected,productNo:t.productNo,metaProductId:t.metaProductId,cafe24:await getCafe24Product(t.productNo)});}
      catch {result={ok:false,reason:'candidate_validation_unavailable'};}
      if(!result.ok)Object.assign(t,{status:'TAG_REVIEW_REQUIRED',reason:result.reason});
      else t.approval=result.product.approval;
    }
  }
  out.mapping.source={...out.mapping.source,kind:'claude-scheduled-proposal',state:'AWAITING_HUMAN_APPROVAL',validatedAt:new Date().toISOString()};
  return out.mapping;
}
