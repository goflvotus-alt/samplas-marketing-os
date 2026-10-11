# SAMPLAS Creator Pool: design and migration (2026-10-11)

## 1. Current state (read only, latest Dropbox rev `0165d8c9a9895f80000000378051613`, 2026-10-11T08:45:30Z)

- **Store:** `seeding.json` (`schemaVersion: 1`) with `projects[]`, `creators[]`, `seedings[]`. Every write is a Dropbox `update`-mode upload against the read rev (rev CAS) plus the project `version` check.

  | Collection | Count |
  |---|---:|
  | creators | 26 (`id`, `instagram`, `memo`; no tags, Meta data or evidence yet) |
  | seedings | 34 |
  | projects | 3 |

- **Projects:**

  | Project | Version | Seedings | AI candidates |
  |---|---|---:|---|
  | MEANTIME SCHWARZE STUNDE | v10 | 17 | none |
  | MEANTIME × SUNDAY OFF CLUB — DOUBLE FEATURE GIFTING | v4 | 16 | none |
  | MEANTIME SCAR PATINE | v18 | 1 | 10 (`targetCount: 10`) |

- **SCAR PATINE candidate history** (Dropbox revisions):

  | Group | Registered | Classification | Versions |
  |---|---|---|---|
  | 5 women's candidates (…1a65df, …819e8c, …7fa6b6, …dd53e4, …d22f84) | 02:47Z | interested 1 / held 2 / excluded 2 | v6–v12 |
  | 5 men's candidates (…40a403, …ece359, …b13ebb, …36c428, …92a28e) | 08:42Z | all excluded | v14–v18 |

  - Each men's candidate's `recommendationReason` states menswear explicitly ("남성복·스트리트", "남성 모델 기반", "남성 패션", "남성 데일리 패션", "남성 스트리트 패션").
  - No candidate is a Creator or a seeding.
- **AI candidates live in `projects[].aiCandidates`.** Project-level operations: `review_candidate` (approved/held/excluded/interested), `undo_candidate_review` and the registration `POST /seeding/candidates {name, version, candidates}`. `approved` creates the Creator + seeding in the same CAS.
- **Creator DB** fields are already defined (`creator-db.mjs`, deployed): `tags.purposes` (남성복 시딩 / 여성복 시딩 / 남성 팝업 초대 / 여성 팝업 초대), `tags.styles`, `connectionEvidence`, `metaObservation`.

## 2. Target model (additive, `schemaVersion` stays 1)

A new top-level `creatorPool` sits next to the existing collections. Nothing existing is renamed or removed.

```
creatorPool: {
  version,                      // pool CAS counter (separate from project versions)
  candidates: [{
    id: "candidate-<sha256(handle)[:20]>",    // same id scheme as today; one per Instagram ID
    instagramId, profileUrl, origin, source, recommendationReason, registeredAt,
    followers, profileImage, biography, posts, verifiedAt, imageStatus, imageError, assessment, history,
    purposes: [PURPOSE_TAGS], purposeSource: "user_confirmed" | "recommendation_text" | "manual",
    styles: [STYLE_TAGS], memo,
    samplasEvidence: [{type: "samplas_visit"|"samplas_tag"|"brand_wear"|"past_seeding", observedAt, verifiedBy: "manual"|"observed", url?, note?}],
    status: "pending"|"interested"|"held"|"excluded",  // pool-wide decision
    reviewedAt?,
    projectReviews: [{projectId, projectName, status: "excluded"|"seeded", at, legacyStatus?, legacyVersion?}],
    creatorId?                  // set once seeded into a project
  }],
  lastClassification?: {candidateId, previousStatus, previousReviewedAt, status, reviewedAt},
  migration: {migratedAt, sourceRev, sourceProjects: [{id, name, version, items}]}
}
```

- **Pool vs project exclusion:**
  - `status: excluded` means "never for SAMPLAS".
  - `projectReviews[].status: excluded` means "not for this project only".
- **One record per Instagram ID** across the pool and Creator DB:
  - Registration rejects a handle already in the pool or the Creator DB.
  - Seeding a pool candidate reuses an existing Creator when there is one.
- **Interested does not mean seeded.** A seeding is created only by the explicit project operation `seed_pool_candidate`.
- **Purposes** are only `user_confirmed`, `recommendation_text` (the recorded reason text) or `manual`. Gender is never inferred from appearance; there is no gender field.
- **SAMPLAS evidence** needs `verifiedBy` and `observedAt`. Unverified notes stay in `memo`.
- **Priority:** follower range 5,000–29,999 is a derived flag (`priority`) used for sorting and filtering only. It never excludes anyone. `targetCount` remains a project selection goal; the pool has no size limit.

## 3. API (additive; existing routes keep their contracts)

| Route | Behaviour |
|---|---|
| `GET /api/ai-audit/seeding/pool` | `{ok, version, candidates[+priority], creators[summary], counts}`. 404 `creator_pool_not_migrated` before migration. |
| `PUT /api/ai-audit/seeding/pool` `{version, operations}` | `review_pool_candidate {candidateId, status}`, `undo_pool_review {candidateId, reviewedAt}`, `update_pool_candidate {candidateId, patch: {purposes, styles, memo, samplasEvidence}}`. Pool version + Dropbox rev CAS; 409 on conflict, never retried. |
| `POST /api/ai-audit/seeding/pool/candidates` `{version, candidates[1..10]}` | Registration without a project. Same validation and Meta lookup as today, plus optional `purposes`. All-or-nothing; duplicates in pool / Creator DB → 409. |
| `POST /api/ai-audit/seeding/pool/migrate` `{dryRun, sourceRev, assignments}` | Builds the pool from the current document. `dryRun: true` returns the plan only. A real run needs the exact current Dropbox `sourceRev` and fails if a pool already exists. |
| `PUT /api/ai-audit/seeding/project` (new op types) | `seed_pool_candidate {candidateId}` creates the canonical seeding (and the Creator if missing) in the same CAS and records `projectReviews: seeded`. `exclude_pool_candidate {candidateId}` records a project-only exclusion. Both bump the project version and the pool version. |
| Legacy, after migration | Project-level `review_candidate`/`undo_candidate_review`, `POST /seeding/candidates` and `/candidates/research` return 409 `candidates_moved_to_pool`, so the two copies cannot diverge. `project.aiCandidates` stays as read-only history. |

## 4. Migration rules (non-destructive)

- **Only one key is added:** `creatorPool`. `projects` (all `version`s and `aiCandidates`), `creators` (26) and `seedings` (34) are byte-identical before and after.
- **Every `aiCandidates.items[]` record from every project is copied, all fields kept.** The legacy status, review time and source project version are recorded in `projectReviews` (`legacyStatus`, `legacyVersion`).
- **Pool status defaults to the legacy status** (lossless). An explicit assignment can mark a legacy exclusion as project-only, which gives pool `pending` plus project `excluded`.
- **Assignments proposed for SCAR PATINE** (need confirmation before the real run):
  - **Women's 5:** `purposes: [여성복 시딩]`, `purposeSource: user_confirmed`. Pool status kept: interested 1 / held 2 / excluded 2.
  - **Men's 5:** `purposes: [남성복 시딩]`, `purposeSource: recommendation_text`. Their SCAR PATINE exclusion is kept as a project-only exclusion, and pool status becomes `pending`, so they stay available for menswear projects.
    - Alternative: keep them excluded pool-wide. That is one flag in the assignment.
- **The migration reads the latest revision at run time.** Later operational changes (any new version, candidate or seeding) are carried over as they are. The real run refuses if the rev moved since its dry run.

## 5. Safety

- Code and isolated tests only; nothing deployed.
- No Production write, no migration run, no candidate classification, no seeding approval, no DM, no secret change.
