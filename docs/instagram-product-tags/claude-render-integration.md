# Claude scheduling → Render shopping tags

## Confirmed responsibility and integration seam

Claude Code continues scheduling on Instagram web for @samplaskr with its dedicated Chrome CDP 9333. Only the upload automation moves READY → UPLOADED. Render never invokes Claude, opens Chrome, schedules, publishes, edits captions/images, or moves Dropbox files.

Read-only investigation covered the existing Marketing OS DEV checkout, the repository, Claude's scheduling memory, igtest scripts and the e34a0700 Claude session execution log. The successful TAEGLOBAL path is now confirmed:

- `nt4.mjs` prepared the new 4:5 draft and stopped before scheduling.
- `run2.mjs f3.mjs` executed at 2026-10-28 12:32 KST. `f3.mjs` imports `findTab`/`verify` from `tg.mjs`, checks preflight, clicks 예약 once and reads the result. The log confirms the click at 12:32:25.924 and “게시물이 예약되었습니다” by 12:32:38.
- The first calendar read showed two reservations (the old cropped version and the new original version). Registration at that point would have been premature.
- After the previously approved old-reservation cleanup, `run2.mjs nt6.mjs` completed at 12:35:56 KST: `CAL thumbs 1`, all seven 1080×1350 images, ordered matches `[[1,0],…,[7,0]]`, `captionMatch:true`, location Samplas, slot 2026-10-28 08:00 PM.

These files are historical execution/verification scripts under the existing Claude igtest scratchpad, not a maintained production engine. The saved FEED_PUBLISHER calendar observation and Claude scheduling memory corroborate the outcome; neither is a scheduler. No durable, maintained scheduling-engine entry point was found. All scratchpad scripts, logs and Chrome profiles remain unchanged.

The correct hook is **after successful scheduling AND the final unique calendar/image read-back (the nt6 verification seam)**, never merely after clicking 예약. This PR provides a browser-free independent adapter at `scripts/instagram-scheduled-registration.mjs`. The existing Claude scheduling task calls it with the result it already verified. There is no replacement scheduling engine, live hook installation, new Claude task, or post-publication Claude call in this PR. A maintained caller must adopt this adapter when its location is established.

## Success receipt contract

```js
import { registerScheduledPost } from './scripts/instagram-scheduled-registration.mjs';
const result = await registerScheduledPost({
  receipt: {
    account: 'samplaskr', state: 'SCHEDULED',
    folderName, slotIso, caption, slideCount,
    verified: { caption: true, slot: true, slides: true, order: true, dimensions: true }
  },
  baseUrl: process.env.SAMPLAS_MARKETING_OS_URL,
  authorization: `Basic ${Buffer.from(process.env.CAFE24_PROXY_BASIC_AUTH).toString('base64')}`,
  autoTag: { brand: 'TAEGLOBAL' },
  acceptUnverifiedVariantApproval: true
});
// Handle a registration failure separately: NEVER repeat scheduling or block the upload/move.
// Keep the verified receipt in the existing upload task's own state for registration-only recovery.
```

`slotIso` must carry an explicit timezone (e.g. `2026-10-29T20:00:00+09:00`). A caption hash may replace the caption. If both are present they must agree. The adapter rejects an unverified receipt, another account, or non-HTTPS destination. Authentication is the existing internal Basic auth; credentials must come from the scheduling environment, not prompts, files in this repo, or logs.

Only `POST /api/instagram-product-tags/posts` is called. The server serializes registration with run/approve operations. Repeating the same normalized identity and approval policy returns HTTP 200, `existing:true`, and preserves all publish, analysis, approvals, write counts and holds. A different slot/caption/count/policy for the same folder returns HTTP 409 `registration_conflict`. Fresh registration returns 201. No automatic network retry is added. On uncertain registration outcome, recover the receipt and retry only this idempotent registration; never click 예약 again.

`autoTag.brand` is explicit per-post consent to policy `vision-v1`. Existing records without it retain their manual/file mapping behavior. Variant `UNVERIFIED` acceptance remains a separate explicit boolean, defaults false, and is never granted by the model or automatic approver.

## Render path

1. Existing runner detects the published post via account, caption hash, slot and carousel count. Before publication no image analysis runs.
2. Find the same manifest in READY or the unique timestamped UPLOADED folder, read only. Explicit folder/order/count checks and the saved manifest fingerprint prevent applying an analysis to a changed manifest.
3. If there is no file or manual mapping and the post opted in, read its images through Dropbox download only. Limit: 8 MiB per image, 24 MiB total encoded slide data, 20 slides. Paths must remain in the located feed folder under `assets/`.
4. Read the Meta catalog through complete cursor pagination; select only exact leading brand tags, ignoring whitespace/case. Product numbers come from the existing retailer_id parser. Use one product reference image per Cafe24 product group. Fail closed for missing references, incomplete pagination, more than 40 groups or more than 100 catalog pages; never truncate competing candidates.
5. OpenAI Responses API (`gpt-4.1-mini` default, configurable model) compares slide images with catalog reference images. One request per post, `store:false`, strict JSON schema, no tools. Local validation requires every slide in order, matching asset paths, valid coordinates/confidence, nonempty evidence and only supplied product numbers. Refusal, timeout, incomplete or invalid output holds for review.
6. Persist `analysis:ANALYZING` before inference; persist findings and response ID afterwards. Failed or interrupted attempts are held without paid-call retry. Cached findings are reused. Model inference never consumes Claude Code credits; OpenAI usage is separately billed.
7. Reuse `buildAutoMapping`: confidence ≥0.8, no competing candidate ≥0.5, brand/color and both inventories. Reuse `checkTagCandidate` before automatic approval: fresh Cafe24 sellability plus IG group approval and exact Meta variant membership. Approve only the safe subset as `render:vision-v1` against the exact `builtAt`; retain review/skipped entries. Group approval is `approved`; individual variant approval stays `UNVERIFIED` until Graph read-back. Zero safe candidates stays review, not NO_TAGS.
8. Reuse the unchanged PR45–48 `buildTagPlan` → `applyTagPlan` → `verifyTagPlan` path, with live stock/account/child checks and existing-tag deduplication. Writes require WRITES=on and explicit variant acceptance. First uncertain/partial POST stops remaining slides; durable POST_OUTCOME_UNKNOWN blocks subsequent runs and cannot be cleared by registration, mapping or approval.

## Gates and rollout prerequisites

All are OFF by default; no production configuration or scheduled task was modified:

- `INSTAGRAM_PRODUCT_TAG_VISION=on`: permits opted-in image analysis/automatic proposal approval.
- `OPENAI_API_KEY`: separately provisioned API credential; absent key holds the job.
- `INSTAGRAM_PRODUCT_TAG_VISION_MODEL`: optional override, default `gpt-4.1-mini`.
- `INSTAGRAM_PRODUCT_TAG_AUTORUN=on`: existing 10-minute polling; OFF means only manual `/run` processing.
- `INSTAGRAM_PRODUCT_TAG_WRITES=on`: existing real-tag gate. VISION off does not revoke previously stored approvals; use WRITES off to stop writes.

This PR is local/mock-verified. Before enabling writes: connect the actual maintained Claude caller, separately configure credentials, then evaluate image matching and coordinates on representative real images with WRITES/AUTORUN off. Confidence is the model's estimate, not measured accuracy; similar garments/occlusion, one reference image per group, stale/changed source images, and missed detections remain material risks. Manifest fingerprinting detects metadata changes, not image bytes replaced under an unchanged manifest. The published-media identity check reuses the existing caption/time/count contract rather than pixel comparison. Confirm source assets remain immutable after scheduling.

Run one Render process/runner, as required by the existing in-process queue and checkpoints. No unlock/retry endpoint, alternate uploader, new scheduler, or Dropbox writer is introduced. Paid inference failures require human diagnosis; this PR intentionally has no automatic reset.

API references: [Images and vision](https://developers.openai.com/api/docs/guides/images-vision), [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

## 2026-10-29 final integration update

The actual historical `run2.mjs → f3.mjs/nt6.mjs` scripts now have a minimal optional result-observer seam, captured in `igtest-success-hook.patch`. The patch has been applied to the original igtest scripts after preserving exact originals in `/private/tmp/pr49-integration/igtest-before`; none was executed. No Chrome process/profile or scheduled task configuration was changed.

- f3 returns a typed result only after verified preflight and a positive scheduling-success message (errors/uncertain result never qualify).
- nt6 returns all observed calendar entries, caption hashes, slot text, image dimensions, ordered pixel comparisons and completeness. `ONLY` subset reads cannot qualify. Duplicate matching reservations block registration; unrelated calendar posts do not.
- run2 passes those results to `scripts/instagram-scheduling-registration-hook.mjs` only when its optional hook configuration is present. This hook never calls f3, nt6, Chrome or an upload engine itself. Existing scheduling behavior is preserved when the hook is unset.
- The observer stores scheduling success first. Only the subsequent complete matching nt6 result can call /posts. Registration attempts are checkpointed before network access. Failure, timeout/uncertain outcome or interrupted REGISTERING remains in a separate outbox; later observations do not automatically retry. Explicit `retryRegistration()` reuses only the exact saved receipt and policy. Neither path cancels or recreates an Instagram reservation.
- Outbox state must be outside Dropbox/READY/UPLOADED and contains no credentials. The hook refuses changed job identity/policy/destination. Server-side idempotency remains the final duplicate-registration protection.

Future caller setup needs `SAMPLAS_IG_REGISTRATION_HOOK` (absolute module path), `SAMPLAS_IG_REGISTRATION_CONFIG` (nonsecret JSON file), `SAMPLAS_IG_REGISTRATION_STATE_DIR` (local directory outside Dropbox), `SAMPLAS_MARKETING_OS_URL` and the existing Basic-auth environment credential. The nonsecret config contains folderName, explicit-timezone slotIso, captionSha256, slideCount, per-slide dimensions (e.g. `1080x1350`), optional autoTag.brand and separate variant-UNVERIFIED acceptance. No setting has been created or enabled in this task. These historical scripts still carry their original TAEGLOBAL-specific scheduling checks; the patch does not turn them into a generic scheduler or authorize replaying that reservation.

Read-only evidence is in `pr49-integration-2026-10-29.json`:

- Seven original images were read, dimensions verified as 1080×1350 and SHA256 recorded.
- Cafe24 detail and tag-view GETs for 15570/15568/15567/15573 returned 200, with only M available and the other 12 options false. Four real Cafe24 reference image GETs returned 200.
- The connected Meta catalog reader returned all 16 variants, with only the four expected M Product IDs in stock. Catalog ad `eligibility_status:eligible` is **not** substituted for IG `catalog_product_search` group approval.
- Production's existing TAEGLOBAL record remains TAG_VERIFIED, writeRuns=1. No /run, registration or approval request was sent to Production.
- Isolated local registration and mapping replay matched all seven known product IDs/coordinates using historical human-verified findings plus the current catalog/Cafe24 reads. This is a pipeline regression proof, **not a vision accuracy result**. Missing fresh IG group approval produces TAG_REVIEW_REQUIRED with zero approvals/POSTs. The existing final record is skipped as done.
- Local Meta credential is expired (code 190). Fresh child/product_tags and IG group approval were therefore not verified. No token refresh/OAuth changes or Chrome fallback were attempted. Current catalog reads were available through the separately connected catalog tool.

**Image API evaluation: BLOCKED.** No OPENAI_API_KEY exists in the current local process or the known DEV .env. The connected Render plugin exposes no read-environment-variable operation; get_service contains no environment keys. Per user instruction no Dashboard login or Chrome 9333 use is permitted. Production key existence and API billing/account access remain UNVERIFIED, not absent. No key was created or stored. Actual inference calls=0 and actual inference cost=$0; accuracy, omissions, false positives and uncertain-candidate counts are unmeasured for all seven images.

Current documented gpt-4.1-mini unit prices are input $0.40, cached input $0.10 and output $1.60 per million tokens. Exact image-request cost requires the billed image/text token usage; it cannot be established from a blocked request. The [current model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini) marks the model deprecated, so actual availability of the configured model must be verified with an authorized API project before deployment. No model was silently substituted. Prerequisites: authorized API credential location, project billing/usage limit, supported model confirmation and a real-image read-only accuracy evaluation. Do not deploy/enable autonomous tagging on the strength of the replay result.
