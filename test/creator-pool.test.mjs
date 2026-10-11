import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPoolMigration, applyPoolOperations, validatePoolPayload, validatePoolPatch, validatePoolRegistration, assertPoolRegistrationAllowed, poolView, isPriority, candidateIdOf } from '../scripts/creator-pool.mjs';
import { applyOperations, validatePayload, handlePool } from '../scripts/seeding-store.mjs';

const item = (handle, status, extra = {}) => ({ id: candidateIdOf(handle), instagramId: handle, origin: 'chatgpt-research', registeredAt: '2026-10-11T02:47:00.000Z', status, ...(status !== 'pending' ? { reviewedAt: '2026-10-11T06:54:00.000Z' } : {}), followers: 12000, recommendationReason: 'reason ' + handle, source: 'https://example.com/' + handle, posts: [], history: [], ...extra });
const fixture = () => ({
  schemaVersion: 1,
  projects: [
    { id: 'p1', name: 'SCHWARZE', version: 10, product: 'jacket' },
    { id: 'p2', name: 'SCAR', version: 18, product: 'denim', targetCount: 10, aiCandidates: { items: [item('w_interested', 'interested'), item('w_held', 'held'), item('w_excluded', 'excluded'), item('m_one', 'excluded', { recommendationReason: '남성복·스트리트 스타일', followers: 69636 }), item('m_two', 'excluded', { recommendationReason: '남성 패션', followers: 5000 })], runs: {}, lastClassification: { candidateId: candidateIdOf('m_two'), previousStatus: 'pending', status: 'excluded', reviewedAt: '2026-10-11T08:45:29.902Z' } } }
  ],
  creators: [{ id: 'c1', instagram: 'existing_creator', memo: 'kept' }],
  seedings: [{ id: 's1', projectId: 'p1', creatorId: 'c1', contact: 'DM 완료', shipping: '출고 완료' }]
});
const ASSIGN = {
  w_interested: { purposes: ['여성복 시딩'], purposeSource: 'user_confirmed' }, w_held: { purposes: ['여성복 시딩'], purposeSource: 'user_confirmed' }, w_excluded: { purposes: ['여성복 시딩'], purposeSource: 'user_confirmed' },
  m_one: { purposes: ['남성복 시딩'], purposeSource: 'recommendation_text', projectOnlyExclusion: true }, m_two: { purposes: ['남성복 시딩'], purposeSource: 'recommendation_text', projectOnlyExclusion: true }
};
const migrated = () => buildPoolMigration(fixture(), { sourceRev: 'rev1', assignments: ASSIGN, now: '2026-10-11T10:00:00.000Z' }).next;

test('migration only adds creatorPool; projects, versions, creators and seedings are unchanged', () => {
  const before = fixture(), { next, plan } = buildPoolMigration(before, { sourceRev: 'rev1', assignments: ASSIGN });
  assert.deepEqual(Object.keys(next).sort(), ['creatorPool', 'creators', 'projects', 'schemaVersion', 'seedings']);
  for (const k of ['schemaVersion', 'projects', 'creators', 'seedings']) assert.deepEqual(next[k], fixture()[k], k);
  assert.equal(next.creatorPool.candidates.length, 5);
  assert.deepEqual(plan.status, { pending: 2, interested: 1, held: 1, excluded: 1 });
  assert.deepEqual(plan.unchanged, { projects: 2, creators: 1, seedings: 1 });
  assert.equal(next.creatorPool.migration.sourceRev, 'rev1');
});

test('legacy decisions are kept; project-only exclusion leaves the candidate available pool-wide', () => {
  const pool = migrated().creatorPool, by = h => pool.candidates.find(c => c.instagramId === h);
  assert.deepEqual(['w_interested', 'w_held', 'w_excluded'].map(h => by(h).status), ['interested', 'held', 'excluded']);
  const m = by('m_one');
  assert.equal(m.status, 'pending');
  assert.equal(m.reviewedAt, undefined);
  assert.deepEqual(m.projectReviews.map(r => [r.projectName, r.status, r.legacyStatus, r.legacyVersion]), [['SCAR', 'excluded', 'excluded', 18]]);
  assert.deepEqual([m.purposes, m.purposeSource], [['남성복 시딩'], 'recommendation_text']);
  assert.equal(m.recommendationReason, '남성복·스트리트 스타일');
  assert.equal('gender' in m, false);
});

test('migration refuses a second run, unknown assignments and missing sourceRev', () => {
  assert.throws(() => buildPoolMigration(migrated(), { sourceRev: 'rev2' }), /already_migrated/);
  assert.throws(() => buildPoolMigration(fixture(), { sourceRev: 'rev1', assignments: { nobody: { purposes: ['남성복 시딩'], purposeSource: 'manual' } } }), /unknown_candidate/);
  assert.throws(() => buildPoolMigration(fixture(), { assignments: {} }), /sourceRev_required/);
  assert.throws(() => buildPoolMigration(fixture(), { sourceRev: 'r', assignments: { m_one: { gender: 'male' } } }), /invalid_assignment/);
});

test('pool review, undo and conflict', () => {
  const doc = migrated(), id = candidateIdOf('m_one');
  const ops = [{ type: 'review_pool_candidate', candidateId: id, status: 'interested' }];
  validatePoolPayload({ version: 1, operations: ops });
  const next = applyPoolOperations(doc, ops, () => '2026-10-11T11:00:00.000Z');
  assert.equal(next.creatorPool.version, 2);
  assert.equal(next.creatorPool.candidates.find(c => c.id === id).status, 'interested');
  assert.equal(next.seedings.length, 1, 'interest never creates a seeding');
  const undone = applyPoolOperations(next, [{ type: 'undo_pool_review', candidateId: id, reviewedAt: '2026-10-11T11:00:00.000Z' }]);
  assert.equal(undone.creatorPool.candidates.find(c => c.id === id).status, 'pending');
  assert.throws(() => applyPoolOperations(undone, [{ type: 'undo_pool_review', candidateId: id, reviewedAt: '2026-10-11T11:00:00.000Z' }]), /pool_undo_conflict/);
});

test('pool patch: purposes need a source, evidence must be verified, no free-form fields', () => {
  assert.throws(() => validatePoolPatch({ purposes: ['남성복 시딩'] }), /purposeSource_required/);
  assert.throws(() => validatePoolPatch({ gender: 'male' }), /invalid_pool_patch/);
  assert.throws(() => validatePoolPatch({ purposes: ['남자'] , purposeSource: 'manual' }), /invalid_purposes/);
  assert.throws(() => validatePoolPatch({ samplasEvidence: [{ type: 'samplas_visit', note: '방문한 듯' }] }), /invalid_samplasEvidence/);
  assert.throws(() => validatePoolPatch({ samplasEvidence: [{ type: 'guess', verifiedBy: 'manual', observedAt: '2026-10-09T05:00:00.000Z' }] }), /invalid_samplasEvidence/);
  validatePoolPatch({ purposes: ['남성복 시딩', '남성 팝업 초대'], purposeSource: 'manual', styles: ['스트릿'], samplasEvidence: [{ type: 'samplas_visit', verifiedBy: 'manual', observedAt: '2026-10-09T05:00:00.000Z', note: 'POP-UP 현장 방문 확인' }] });
});

test('project seeding only through the explicit project operation, reusing an existing Creator', () => {
  const doc = migrated(), p = doc.projects[0], id = candidateIdOf('w_interested');
  validatePayload({ version: 10, operations: [{ type: 'seed_pool_candidate', candidateId: id }] });
  const next = applyOperations(doc, p, [{ type: 'seed_pool_candidate', candidateId: id }]);
  assert.equal(next.seedings.length, 2);
  assert.equal(next.creators.length, 2);
  const c = next.creatorPool.candidates.find(x => x.id === id);
  assert.equal(c.creatorId, next.creators[1].id);
  assert.equal(c.projectReviews.at(-1).status, 'seeded');
  assert.equal(next.projects[0].version, 11);
  assert.equal(next.creatorPool.version, 2);
  assert.throws(() => applyOperations(next, next.projects[0], [{ type: 'seed_pool_candidate', candidateId: id }]), /duplicate_instagramId/);
  // Existing Creator record is reused, not duplicated.
  doc.creatorPool.candidates.push({ ...item('existing_creator', 'interested'), projectReviews: [] });
  const reuse = applyOperations(doc, doc.projects[1], [{ type: 'seed_pool_candidate', candidateId: candidateIdOf('existing_creator') }]);
  assert.equal(reuse.creators.length, 1);
});

test('pool-wide vs project-only exclusion', () => {
  const doc = migrated();
  assert.throws(() => applyOperations(doc, doc.projects[0], [{ type: 'seed_pool_candidate', candidateId: candidateIdOf('w_excluded') }]), /candidate_excluded/);
  // m_one is excluded only for SCAR: blocked there, available for SCHWARZE.
  assert.throws(() => applyOperations(doc, doc.projects[1], [{ type: 'seed_pool_candidate', candidateId: candidateIdOf('m_one') }]), /candidate_excluded_for_project/);
  assert.equal(applyOperations(doc, doc.projects[0], [{ type: 'seed_pool_candidate', candidateId: candidateIdOf('m_one') }]).seedings.length, 2);
  const ex = applyOperations(doc, doc.projects[0], [{ type: 'exclude_pool_candidate', candidateId: candidateIdOf('w_held') }]);
  const c = ex.creatorPool.candidates.find(x => x.instagramId === 'w_held');
  assert.equal(c.status, 'held');
  assert.equal(c.projectReviews.at(-1).status, 'excluded');
});

test('legacy project candidate operations are closed after migration', () => {
  const doc = migrated();
  for (const op of [{ type: 'review_candidate', candidateId: candidateIdOf('w_held'), status: 'interested' }, { type: 'undo_candidate_review', candidateId: candidateIdOf('m_two'), reviewedAt: '2026-10-11T08:45:29.902Z' }])
    assert.throws(() => applyOperations(doc, doc.projects[1], [op]), /candidates_moved_to_pool/);
  // Before migration the legacy operation still works unchanged.
  assert.equal(applyOperations(fixture(), fixture().projects[1], [{ type: 'review_candidate', candidateId: candidateIdOf('w_held'), status: 'interested' }]).projects[1].aiCandidates.items[1].status, 'interested');
});

test('registration without a project; duplicates against pool and Creator DB rejected', () => {
  const doc = migrated();
  const input = validatePoolRegistration({ version: 1, candidates: [{ instagramId: '@New_One', profileUrl: 'https://www.instagram.com/new_one/', recommendationReason: 'r', source: 's', purposes: ['남성복 시딩'] }] });
  assert.equal(input.candidates[0].instagramId, 'new_one');
  assertPoolRegistrationAllowed(doc, input.candidates);
  assert.throws(() => assertPoolRegistrationAllowed(doc, [{ instagramId: 'w_held' }]), /duplicate_candidate/);
  assert.throws(() => assertPoolRegistrationAllowed(doc, [{ instagramId: 'w_excluded' }]), /candidate_excluded/);
  assert.throws(() => assertPoolRegistrationAllowed(doc, [{ instagramId: 'existing_creator' }]), /creator_already_exists/);
  assert.throws(() => validatePoolRegistration({ version: 1, candidates: [{ instagramId: 'a', profileUrl: 'https://www.instagram.com/b/', recommendationReason: 'r', source: 's' }] }), /invalid_profileUrl/);
  assert.throws(() => validatePoolRegistration({ name: 'SCAR', version: 1, candidates: [] }), /malformed_payload/);
});

test('priority range 5,000-29,999 is a sort/filter flag, never an exclusion', () => {
  assert.deepEqual([4999, 5000, 29999, 30000, null].map(isPriority), [false, true, true, false, false]);
  const view = poolView(migrated());
  assert.equal(view.candidates.length, 5);
  assert.equal(view.candidates.at(-1).instagramId, 'm_one');
  assert.equal(view.counts.priority, 4);
  assert.equal(view.counts.creators, 1);
});

function remote() {
  let doc = fixture(), rev = 'rev1', uploads = 0, conflict = false;
  const fetchImpl = async (url, init) => {
    if (url.includes('oauth2/token')) return new Response(JSON.stringify({ access_token: 't' }));
    if (url.endsWith('/download')) return new Response(JSON.stringify(doc), { headers: { 'dropbox-api-result': JSON.stringify({ rev }) } });
    if (url.endsWith('/upload')) {
      uploads++;
      const arg = JSON.parse(init.headers['Dropbox-API-Arg']);
      assert.deepEqual(arg.mode, { '.tag': 'update', update: rev });
      if (conflict) return new Response('{}', { status: 409 });
      doc = JSON.parse(init.body); rev = 'rev' + (uploads + 1);
      return new Response('{}');
    }
    throw Error('unexpected ' + url);
  };
  return { env: { DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's', DROPBOX_REFRESH_TOKEN: 'r' }, fetchImpl, uploads: () => uploads, doc: () => doc, setConflict: v => conflict = v };
}

test('pool API: dry run never writes, real run needs the current rev, version CAS on PUT', async () => {
  const o = remote(), P = '/api/ai-audit/seeding/pool';
  await assert.rejects(handlePool('GET', P, null, o), /creator_pool_not_migrated/);
  const dry = await handlePool('POST', P + '/migrate', { dryRun: true, assignments: ASSIGN }, o);
  assert.equal(dry.body.plan.candidates, 5);
  assert.equal(o.uploads(), 0);
  assert.equal((await handlePool('POST', P + '/migrate', { dryRun: false, sourceRev: 'old', assignments: ASSIGN }, o)).body.error, 'source_rev_changed');
  assert.equal(o.uploads(), 0);
  assert.equal((await handlePool('POST', P + '/migrate', { dryRun: false, sourceRev: 'rev1', assignments: ASSIGN }, o)).status, 201);
  assert.deepEqual(o.doc().projects, fixture().projects);
  assert.equal((await handlePool('GET', P, null, o)).body.version, 1);
  const id = candidateIdOf('m_one');
  assert.equal((await handlePool('PUT', P, { version: 9, operations: [{ type: 'review_pool_candidate', candidateId: id, status: 'held' }] }, o)).body.error, 'version_conflict');
  o.setConflict(true);
  assert.equal((await handlePool('PUT', P, { version: 1, operations: [{ type: 'review_pool_candidate', candidateId: id, status: 'held' }] }, o)).body.error, 'version_conflict');
  o.setConflict(false);
  const ok = await handlePool('PUT', P, { version: 1, operations: [{ type: 'review_pool_candidate', candidateId: id, status: 'held' }] }, o);
  assert.equal(ok.body.version, 2);
  const reg = await handlePool('POST', P + '/candidates', { version: 2, candidates: [{ instagramId: 'new_one', profileUrl: 'https://www.instagram.com/new_one/', recommendationReason: 'r', source: 's' }] }, { ...o, discover: async () => { throw Error('meta down'); } });
  assert.equal(reg.status, 201);
  const added = reg.body.candidates.find(c => c.instagramId === 'new_one');
  assert.deepEqual([added.status, added.imageStatus, added.projectReviews], ['pending', 'unavailable', []]);
  assert.equal(o.doc().seedings.length, 1);
  await assert.rejects(handlePool('DELETE', P, null, o), /Method Not Allowed/);
  const media = await handlePool('GET', P + '/media', { id }, { ...o, discover: async h => ({ instagramId: h, posts: [] }) });
  assert.deepEqual(media.body.media.instagramId, 'm_one');
  await assert.rejects(handlePool('GET', P + '/media', { id: 'candidate-ffffffffffffffffffff' }, o), /candidate_not_found/);
  const before = o.uploads(); await handlePool('GET', P, null, o); assert.equal(o.uploads(), before, 'GET never writes');
});
