# Claude scheduling → Render: no additional paid image API

## Current policy

Claude Code retains Instagram web scheduling (`run2.mjs` → `f3.mjs` → final `nt6.mjs` verification), Chrome CDP 9333 and upload/folder movement. During the existing preparation work, Claude reuses already checked image/product information and writes a small mapping proposal into the task's nonsecret registration config **outside Dropbox**. No repeated image analysis is required. Unknown garments stay review-required; omitted or ambiguous products are never guessed.

Render does not invoke Claude or any image inference service after publication. The previous image API module is preserved as inactive historical code, disconnected from the server and runner. VISION remains default OFF, no OPENAI_API_KEY is required or consumed, and no replacement paid provider is introduced. No key purchase, billing change or production configuration is part of this PR.

## Actual scheduling seam

Historical TAEGLOBAL execution is confirmed: `run2.mjs f3.mjs` succeeded at 2026-10-28 12:32 KST; final `nt6` at 12:35:56 confirmed one matching reservation, seven 1080×1350 originals in exact order, correct caption and 20:00 KST slot. These are existing case-specific scripts, not a newly invented scheduler.

`igtest-success-hook.patch` is already applied locally after preserving originals under `/private/tmp/pr49-integration/igtest-before`. No scheduling step was executed. The optional observer in run2 records f3's typed success first; only subsequent complete matching nt6 observations can call the existing /posts API. Subset verification, duplicate matching reservations or wrong caption/slot/order/dimensions prevent registration. Hook settings remain inactive until the Claude task is explicitly configured; no Chrome profile or scheduling logic has been replaced.

## Proposal in the existing registration config

```json
{
  "mappingProposal": {
    "schemaVersion": 1,
    "folderName": "TAEGLOBAL-26AW",
    "brand": "TAEGLOBAL",
    "preparedBy": "Claude scheduling preparation; reused verified findings",
    "mappings": [{
      "slideIndex": 1,
      "savedAsset": "assets/01.jpg",
      "productNo": 15570,
      "metaProductId": "28840522035586978",
      "variantCode": "P0000XAW000F",
      "color": "GRAY",
      "option": "M",
      "x": 0.51, "y": 0.33,
      "evidence": "Previously checked distinctive print, cut and hardware",
      "confidence": 0.9,
      "reviewRequired": false
    }]
  }
}
```

`slideIndex` is one-based. Use all known garments; uncertain entries use `reviewRequired:true`, may omit product identifiers, and include the reason in evidence. Cafe24 productNo is a queryable identifier when the exact Meta ID is not known. If Meta ID or variantCode is supplied, validation must honor it: an unavailable requested option is review, never silently replaced with a different option. An option label without its exact variantCode requires review. Confidence is reused from existing findings; absent confidence does not invent a score and stays review. `reviewRequired:false` is a proposal assertion, never an approval.

The existing config also contains folderName, explicit-timezone slotIso, captionSha256, slideCount and per-image dimensions. The observer passes mappingProposal in the **same** /posts request, not another image-analysis job. Same receipt/proposal is idempotent; changed content conflicts rather than overwriting an approved/held job. Source approval flags are ignored: registration always starts these jobs with variant acceptance false and no approved mapping.

A failed/uncertain registration is checkpointed in the local outbox before network access. No automatic retry and no reservation cancellation/recreation. Explicit registration-only recovery uses the saved receipt. The observer never calls scheduling or browser code. No secret is stored in config/outbox, and outbox paths in Dropbox/READY/UPLOADED are refused.

## Render and human approval

1. Store the supplied proposal, unapproved, with the scheduled-post identity.
2. Existing runner detects publication via @samplaskr account, caption hash, slot and slide count; resolve READY or the unique UPLOADED folder read-only.
3. Convert supplied findings through the existing automapper. Validate manifest identity, exact product/variant, brand/color, current Cafe24 sellability and current Meta in-stock status. Existing confidence ≥0.8 and competing-candidate rules still apply.
4. Require exact membership in IG catalog_product_search and approved product group. Catalog ad eligibility is not substituted for IG shopping approval. Persist validation timestamp; past validation is not current stock.
5. Store source `AWAITING_HUMAN_APPROVAL`, every tag `approved:false`. Jobs stay TAG_REVIEW_REQUIRED and cannot POST, even with WRITES on. API errors, uncertainty or missing matches also require review.
6. A person reviews the exact mapping and submits the existing /automap/approve route with approvedBy, matching builtAt and selected `{order,productNo}` picks. Supplied-proposal jobs recheck live candidate/stock/group validity at approval time. Explicit `acceptUnverifiedVariantApproval:true` in that approval is a **separate** human decision; default false. Variant approval remains UNVERIFIED until Graph read-back. No automatic approval policy exists in this path.
7. After approval, the existing runner builds and revalidates the tag plan again using fresh reads. Actual posting still requires WRITES=on; polling requires AUTORUN=on. Deduplication, first uncertain-result stop, durable POST_OUTCOME_UNKNOWN and GET read-back from PR45–48 are unchanged. Registration retries cannot reset those states.

No automatic-approval rollout is included. It requires a separate policy decision after accuracy is established for a defined scope.

## Focused replay and operating status

`test/fixtures/instagram-scheduled-taeglobal.json` records public TAEGLOBAL identities and historical stock observations with their original timestamps. The replay freezes time to those observations; it never claims that inventory is current. It exercises verified schedule → isolated registration → publish detection → seven exact product/coordinate proposals → mandatory human gate → explicit fixture-human approval → seven-tag plan with WRITES off. Stale stock rejects approval. No real registration, image API or tag POST occurs. Separate regressions cover unapproved jobs with WRITES on, requested-variant mismatch, candidate API failure, registration recovery and POST_OUTCOME_UNKNOWN.

Initial operation still needs a reviewed deployment, the existing Claude task's observer/config connection, and human approval of each new post. No deployment, main merge, real reservation/post, TAEGLOBAL rePOST, flag activation, Chrome profile or Dropbox source changes have occurred. The earlier `pr49-integration-2026-10-29.json` describes the superseded paid-image evaluation branch and is historical evidence only; an image API key/accuracy evaluation is no longer a prerequisite for this architecture.

Additional work estimate (not a measured benchmark): for a post with reusable validated data, serialize/check seven rows and submit one registration request, typically tens of seconds to a few minutes. Uncertain items require human review and have no fixed estimate. No new image model call is added; existing Claude Code use and existing Meta/Cafe24/Render operations remain within their existing accounts and limits, not a claim that those services have zero operating cost.
