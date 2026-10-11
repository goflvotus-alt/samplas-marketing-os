// SAMPLAS-wide Creator candidate pool. Candidates are no longer owned by one seeding project:
// one record per Instagram ID, pool-wide status, project-only exclusions, explicit project seeding.
// No gender field and no inference from appearance: usage purposes come only from the user,
// the recorded recommendation text, or a manual edit.
import { createHash } from 'node:crypto';
import { PURPOSE_TAGS, STYLE_TAGS } from './creator-db.mjs';

export const POOL_STATUSES = ['pending', 'interested', 'held', 'excluded'];
export const PURPOSE_SOURCES = ['user_confirmed', 'recommendation_text', 'manual'];
export const EVIDENCE_TYPES = ['samplas_visit', 'samplas_tag', 'brand_wear', 'past_seeding'];
export const PRIORITY_FOLLOWERS = { min: 5000, max: 29999 };
const POOL_PATCH_FIELDS = ['purposes', 'purposeSource', 'styles', 'memo', 'samplasEvidence'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const object = v => v && typeof v === 'object' && !Array.isArray(v);
export const handleOf = v => String(v || '').trim().replace(/^@+/, '').toLowerCase();
export const candidateIdOf = handle => 'candidate-' + createHash('sha256').update(handle).digest('hex').slice(0, 20);
const isoDate = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const httpsUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };

export function isPriority(followers) {
  return Number.isSafeInteger(followers) && followers >= PRIORITY_FOLLOWERS.min && followers <= PRIORITY_FOLLOWERS.max;
}

function tagList(value, allowed, name) {
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(t => !allowed.includes(t))) throw fail('invalid_' + name);
  return value;
}

export function validateSamplasEvidence(rows) {
  if (!Array.isArray(rows) || rows.length > 200) throw fail('invalid_samplasEvidence');
  for (const e of rows) {
    if (!object(e) || Object.keys(e).some(k => !['type', 'observedAt', 'verifiedBy', 'url', 'note', 'projectName'].includes(k))) throw fail('invalid_samplasEvidence');
    // Only actually confirmed facts: who verified it and when.
    if (!EVIDENCE_TYPES.includes(e.type) || !['manual', 'observed'].includes(e.verifiedBy) || !isoDate(e.observedAt)) throw fail('invalid_samplasEvidence');
    if (e.url !== undefined && !httpsUrl(e.url)) throw fail('invalid_samplasEvidence');
    for (const k of ['note', 'projectName']) if (e[k] !== undefined && (typeof e[k] !== 'string' || e[k].length > 1000)) throw fail('invalid_samplasEvidence');
  }
  return rows;
}

export function validatePoolPatch(patch) {
  if (!object(patch) || !Object.keys(patch).length || Object.keys(patch).some(k => !POOL_PATCH_FIELDS.includes(k))) throw fail('invalid_pool_patch');
  if ('purposes' in patch) tagList(patch.purposes, PURPOSE_TAGS, 'purposes');
  if ('purposeSource' in patch && !PURPOSE_SOURCES.includes(patch.purposeSource)) throw fail('invalid_purposeSource');
  if ('purposes' in patch && patch.purposes.length && !('purposeSource' in patch)) throw fail('purposeSource_required');
  if ('styles' in patch) tagList(patch.styles, STYLE_TAGS, 'styles');
  if ('memo' in patch && (typeof patch.memo !== 'string' || patch.memo.length > 10000)) throw fail('invalid_memo');
  if ('samplasEvidence' in patch) validateSamplasEvidence(patch.samplasEvidence);
  return patch;
}

const CANDIDATE_ID = /^candidate-[a-f0-9]{20}$/;
export function validatePoolPayload(body) {
  if (!object(body) || Object.keys(body).some(k => !['version', 'operations'].includes(k)) || !Number.isInteger(body.version) || body.version < 1 || !Array.isArray(body.operations) || !body.operations.length || body.operations.length > 100) throw fail('malformed_payload');
  for (const op of body.operations) {
    if (!object(op) || typeof op.candidateId !== 'string' || !CANDIDATE_ID.test(op.candidateId)) throw fail('invalid_operation');
    const keys = { review_pool_candidate: ['type', 'candidateId', 'status'], undo_pool_review: ['type', 'candidateId', 'reviewedAt'], update_pool_candidate: ['type', 'candidateId', 'patch'] }[op.type];
    if (!keys || Object.keys(op).some(k => !keys.includes(k))) throw fail('invalid_operation');
    if (op.type === 'review_pool_candidate' && !['interested', 'held', 'excluded', 'pending'].includes(op.status)) throw fail('invalid_pool_status');
    if (op.type === 'undo_pool_review' && !isoDate(op.reviewedAt)) throw fail('invalid_pool_undo');
    if (op.type === 'update_pool_candidate') validatePoolPatch(op.patch);
  }
  return body;
}

export function requirePool(doc) {
  if (!object(doc?.creatorPool) || !Array.isArray(doc.creatorPool.candidates)) throw fail('creator_pool_not_migrated', 404);
  return doc.creatorPool;
}

// Applies pool-only operations to a cloned document. Version handling stays with the caller.
export function applyPoolOperations(doc, operations, now = () => new Date().toISOString()) {
  const next = structuredClone(doc), pool = requirePool(next);
  for (const op of operations) {
    const c = pool.candidates.find(x => x.id === op.candidateId);
    if (!c) throw fail('candidate_not_found', 404);
    if (op.type === 'update_pool_candidate') {
      for (const [k, v] of Object.entries(op.patch)) c[k] = v;
      if (Array.isArray(c.purposes) && !c.purposes.length) delete c.purposeSource;
      continue;
    }
    if (op.type === 'undo_pool_review') {
      const last = pool.lastClassification;
      if (!last || last.candidateId !== c.id || last.reviewedAt !== op.reviewedAt || c.reviewedAt !== last.reviewedAt || c.status !== last.status) throw fail('pool_undo_conflict', 409);
      c.status = last.previousStatus;
      if (last.previousReviewedAt) c.reviewedAt = last.previousReviewedAt; else delete c.reviewedAt;
      delete pool.lastClassification;
      continue;
    }
    const previousStatus = c.status, previousReviewedAt = c.reviewedAt || null;
    c.status = op.status;
    c.reviewedAt = now();
    pool.lastClassification = { candidateId: c.id, previousStatus, previousReviewedAt, status: c.status, reviewedAt: c.reviewedAt };
  }
  pool.version += 1;
  pool.updatedAt = now();
  return next;
}

export function poolView(doc) {
  const pool = requirePool(doc);
  const seedingsOf = id => doc.seedings.filter(r => r.creatorId === id);
  const candidates = pool.candidates.map(c => ({ ...c, priority: isPriority(c.followers) }))
    .sort((a, b) => (b.priority - a.priority) || String(b.registeredAt || '').localeCompare(String(a.registeredAt || '')));
  const creators = doc.creators.map(c => {
    const followers = c.metaObservation?.followersCount ?? null, rs = seedingsOf(c.id);
    return { id: c.id, instagramId: c.instagram, memo: c.memo || '', tags: c.tags || null, connectionEvidence: c.connectionEvidence || [], followers, priority: isPriority(followers),
      seedingCount: rs.length, projects: rs.map(r => doc.projects.find(p => p.id === r.projectId)?.name).filter(Boolean) };
  });
  const count = s => pool.candidates.filter(c => c.status === s).length;
  return { ok: true, version: pool.version, updatedAt: pool.updatedAt || null, lastClassification: pool.lastClassification || null, priorityFollowers: PRIORITY_FOLLOWERS,
    candidates, creators, counts: { candidates: pool.candidates.length, pending: count('pending'), interested: count('interested'), held: count('held'), excluded: count('excluded'), creators: doc.creators.length, priority: candidates.filter(c => c.priority).length } };
}

// Non-destructive migration: only adds `creatorPool`. Every legacy project candidate is copied with all
// fields; its legacy decision stays visible in projectReviews. Pool status defaults to the legacy status.
// assignments[instagramId] = {purposes, purposeSource, projectOnlyExclusion}
export function buildPoolMigration(doc, { sourceRev, assignments = {}, now = new Date().toISOString() } = {}) {
  if (doc.creatorPool) throw fail('creator_pool_already_migrated', 409);
  if (!sourceRev) throw fail('sourceRev_required');
  const next = structuredClone(doc), byHandle = new Map(), creatorHandles = new Set(doc.creators.map(c => handleOf(c.instagram))), warnings = [];
  for (const [handle, a] of Object.entries(assignments)) {
    if (!object(a) || Object.keys(a).some(k => !['purposes', 'purposeSource', 'projectOnlyExclusion'].includes(k))) throw fail('invalid_assignment');
    if (a.purposes) { tagList(a.purposes, PURPOSE_TAGS, 'purposes'); if (!PURPOSE_SOURCES.includes(a.purposeSource)) throw fail('invalid_purposeSource'); }
    if (a.projectOnlyExclusion !== undefined && typeof a.projectOnlyExclusion !== 'boolean') throw fail('invalid_assignment');
    if (handle !== handleOf(handle)) throw fail('invalid_assignment');
  }
  const sourceProjects = [];
  for (const p of doc.projects) {
    const items = p.aiCandidates?.items || [];
    sourceProjects.push({ id: p.id, name: p.name, version: p.version, items: items.length });
    for (const item of items) {
      const handle = handleOf(item.instagramId), a = assignments[handle] || {};
      const review = { projectId: p.id, projectName: p.name, status: item.status === 'excluded' ? 'excluded' : item.status === 'approved' ? 'seeded' : 'reviewed', at: item.reviewedAt || item.registeredAt || null, legacyStatus: item.status, legacyVersion: p.version };
      const existing = byHandle.get(handle);
      if (existing) { existing.projectReviews.push(review); warnings.push({ instagramId: handle, warning: 'same_handle_in_several_projects' }); continue; }
      if (creatorHandles.has(handle) && item.status !== 'approved') warnings.push({ instagramId: handle, warning: 'already_in_creator_db' });
      const legacy = item.status === 'approved' ? 'interested' : POOL_STATUSES.includes(item.status) ? item.status : 'pending';
      const status = a.projectOnlyExclusion && item.status === 'excluded' ? 'pending' : legacy;
      const c = { ...structuredClone(item), id: item.id || candidateIdOf(handle), instagramId: handle, status, projectReviews: [review],
        ...(a.purposes ? { purposes: a.purposes, purposeSource: a.purposeSource } : {}) };
      if (status === 'pending') delete c.reviewedAt;
      if (item.status === 'approved') c.creatorId = doc.creators.find(x => handleOf(x.instagram) === handle)?.id || null;
      byHandle.set(handle, c);
    }
  }
  for (const handle of Object.keys(assignments)) if (!byHandle.has(handle)) throw fail('assignment_for_unknown_candidate: ' + handle);
  next.creatorPool = { version: 1, updatedAt: now, candidates: [...byHandle.values()], migration: { migratedAt: now, sourceRev, sourceProjects } };
  const plan = {
    sourceRev, candidates: next.creatorPool.candidates.length,
    status: Object.fromEntries(POOL_STATUSES.map(s => [s, next.creatorPool.candidates.filter(c => c.status === s).length])),
    projectOnlyExclusions: next.creatorPool.candidates.filter(c => c.status !== 'excluded' && c.projectReviews.some(r => r.status === 'excluded')).map(c => c.instagramId),
    purposes: next.creatorPool.candidates.map(c => ({ instagramId: c.instagramId, purposes: c.purposes || [], purposeSource: c.purposeSource || null, status: c.status })),
    unchanged: { projects: doc.projects.length, creators: doc.creators.length, seedings: doc.seedings.length }, warnings
  };
  return { next, plan };
}

// Registration without a project. Mirrors the existing project registration contract.
export function validatePoolRegistration(body) {
  if (!object(body) || Object.keys(body).some(k => !['version', 'candidates'].includes(k)) || !Number.isInteger(body.version) || body.version < 1 || !Array.isArray(body.candidates) || body.candidates.length < 1 || body.candidates.length > 10) throw fail('malformed_payload');
  const seen = new Set();
  const candidates = body.candidates.map(c => {
    if (!object(c) || Object.keys(c).some(k => !['instagramId', 'profileUrl', 'recommendationReason', 'source', 'purposes'].includes(k)) || typeof c.instagramId !== 'string') throw fail('invalid_candidate');
    const instagramId = handleOf(c.instagramId);
    if (!/^[a-z0-9._]{1,30}$/.test(instagramId) || ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct'].includes(instagramId)) throw fail('invalid_instagramId');
    let u; try { u = new URL(c.profileUrl); } catch { throw fail('invalid_profileUrl'); }
    if (typeof c.profileUrl !== 'string' || u.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(u.hostname) || u.port || u.username || u.password || handleOf(u.pathname.replace(/^\//, '').replace(/\/$/, '')) !== instagramId) throw fail('invalid_profileUrl');
    for (const key of ['recommendationReason', 'source']) if (typeof c[key] !== 'string' || !c[key].trim() || c[key].length > 4000) throw fail('invalid_' + key);
    if (c.purposes !== undefined) tagList(c.purposes, PURPOSE_TAGS, 'purposes');
    if (seen.has(instagramId)) throw fail('duplicate_candidate', 409);
    seen.add(instagramId);
    return { instagramId, profileUrl: 'https://www.instagram.com/' + instagramId + '/', recommendationReason: c.recommendationReason.trim(), source: c.source.trim(), ...(c.purposes?.length ? { purposes: c.purposes } : {}) };
  });
  return { version: body.version, candidates };
}

export function assertPoolRegistrationAllowed(doc, candidates) {
  const pool = requirePool(doc);
  for (const input of candidates) {
    const existing = pool.candidates.find(c => handleOf(c.instagramId) === input.instagramId);
    if (existing) throw fail(existing.status === 'excluded' ? 'candidate_excluded' : 'duplicate_candidate', 409);
    if (doc.creators.some(c => handleOf(c.instagram) === input.instagramId)) throw fail('creator_already_exists', 409);
  }
}

export function poolCandidateRecord(input, profile, now = new Date().toISOString()) {
  const base = { ...input, id: candidateIdOf(input.instagramId), origin: 'chatgpt-research', registeredAt: now, status: 'pending', profileImage: '', posts: [], history: [], projectReviews: [],
    ...(input.purposes ? { purposeSource: 'user_confirmed' } : {}),
    assessment: { method: 'submitted-research', aiStatus: 'submitted', reasons: [input.recommendationReason], salesEstimate: '추정 · 판매 기여도 미검증', collaborationEstimate: '추정 · 협찬 가능성 미검증' } };
  if (!profile) return { ...base, imageStatus: 'unavailable', imageError: 'IMAGE_UNAVAILABLE' };
  return { ...base, ...profile, imageStatus: profile.profileImage && profile.posts?.some(p => p.imageUrl) ? 'available' : 'unavailable' };
}

// Project-scoped pool operations (used inside the project PUT, same CAS as the seeding write).
export function poolProjectCandidate(doc, candidateId, project) {
  const pool = requirePool(doc), c = pool.candidates.find(x => x.id === candidateId);
  if (!c) throw fail('candidate_not_found', 404);
  if (c.status === 'excluded') throw fail('candidate_excluded', 409);
  if (c.projectReviews.some(r => r.projectId === project.id && r.status === 'excluded')) throw fail('candidate_excluded_for_project', 409);
  return { pool, c };
}
