# Instagram product tags

Modules: `scripts/instagram-product-tags.mjs` (planner, apply, read-back) and `scripts/instagram-product-tag-runner.mjs` (feed post pipeline, see below).
Tagging uses the Meta Graph API with the existing Production token (`resolveMetaAccessToken`). It needs no Chrome.

## Flow per post

1. `preflight` checks the app, permissions, the IG user (@samplaskr), eligibility, the catalog's business and `available_catalogs`. It runs when the plan is built and again before any write.
2. `resolveMedia` checks that the post owner is @samplaskr. It maps carousel children to `manifest.json` order, and the child count must equal the manifest item count.
3. `buildTagPlan` builds the plan from `product-tags.json`.
   - A product already tagged on the slide is never sent again. It counts as `TAG_VERIFIED` only when Graph shows it `approved` within ±0.01 of the mapped x/y. Otherwise it is `existing_tag_not_approved` or `existing_tag_position_differs`, and it is never moved.
   - Each new tag must pass `checkTagCandidate` (rule adopted 2026-10-28 from live data):
     - a person approved it, x/y are in 0..1, and `metaProductId` is given (never guessed);
     - IG `catalog_product_search` (q = product_no) lists the product group with `review_status: "approved"`, and `metaProductId` is the group's `product_id` or one of its `product_variants`. The catalog API's own `review_status` is "" on live items and is not used;
     - the catalog item is in the product_no group (`retailer_id` = `<product_no>.<variant code>`) and has `availability: "in stock"`;
     - Cafe24 has selling=T and display=T. Exactly one option has the same variant code, and that option is available (state `IN_STOCK` or `UNLIMITED`). An `UNKNOWN` option goes to review as `cafe24_option_uncertain`. The Cafe24 data must be for this product_no and no older than 10 minutes.
   - Approval is known per product group only. Per-variant approval is recorded as `UNVERIFIED`; only the read-back after tagging can set it to `APPROVED_IN_READBACK`.
4. `applyTagPlan` is off unless `write: true`, `acceptUnverifiedVariantApproval: true` and `INSTAGRAM_PRODUCT_TAG_WRITES=on`. It reads the slide again right before the POST and sends only product ids that are absent. Each batch is POSTed at most once. After an error it reads the slide again but never rePOSTs missing tags, including after transient errors.
5. `verifyTagPlan` reads the tags back. Each planned tag must be present, approved and within ±0.01 of its x/y. Tags that existed before must still be there.

Tag states: `PENDING`, `PRODUCT_TAGGING`, `TAG_VERIFIED`, `TAG_REVIEW_REQUIRED`, `POST_OUTCOME_UNKNOWN`. Any review item holds the whole post. An unconfirmed attempted POST is `POST_OUTCOME_UNKNOWN`, not a completed or retryable job. GET verification may confirm success; it never sends another POST.

## Cafe24 option data

`GET /api/instagram-product-tags/cafe24/<product_no>` is read-only. It uses the same internal auth as `/api/cafe24/products/*` and the global API gate.

It reads the raw Cafe24 product detail and variants (`embed=inventories`) and returns `toTagCafe24View`:

```json
{ "productNo": 15195, "selling": "T", "display": "T", "fetchedAt": "...",
  "options": [{ "variantCode": "P0000WML000C", "state": "IN_STOCK", "available": true }] }
```

The option state comes from `evaluateOption` in `scripts/veil-found-soldout-audit.mjs`:

| Cafe24 option | state | available |
|---|---|---|
| variant selling or display F | `NOT_SELLING` | false |
| no inventory data, or use_inventory not T/F | `UNKNOWN` | false (review) |
| use_inventory F (stock not tracked) | `UNLIMITED` | true |
| use_inventory T, quantity > 0 | `IN_STOCK` | true |
| use_inventory T, quantity 0, display_soldout T | `SOLD_OUT` | false |
| use_inventory T, quantity 0, display_soldout F | `UNKNOWN` | false (review) |

`display_soldout` is a shop setting: show "sold out" when stock reaches 0. It is not the current state. The shared `normalizeCafe24ProductRow` reads it as sold out, so this route does not use that row. That function is unchanged.

Raw quantities are not returned. When a Cafe24 read fails, the route returns 500. In proxy mode (`CAFE24_PROXY_BASE_URL`, local runner) it asks the same route on Render and returns 502 for any answer that is not a tag view for this product. Either way, every tag for that product goes to review.

Both stock checks must pass, so an option is tagged only when Meta and Cafe24 agree it is in stock. On 2026-10-28 they agreed for 15195: only L was in stock on both.

## `READY/<brand>/product-tags.json`

```json
{ "schemaVersion": 1, "folderName": "TAEGLOBAL-26AW",
  "post": { "mediaId": null, "permalink": null },
  "slides": [{ "order": 1, "savedAsset": "assets/01.jpg",
    "tags": [{ "productNo": 12345, "metaProductId": "2801...", "name": "...", "color": "BLACK",
      "x": 0.5, "y": 0.6, "evidence": "how it was matched", "approved": true, "status": "PENDING" }] }] }
```

`order` and `savedAsset` must match `manifest.json`. A person writes this file and sets `approved`. The runner only reads it: statuses are kept in the runner's record, never written back to READY. A file whose slides list no tags means "this post has no tags" (`NO_TAGS`).

READY images carry no product data. Without this file the runner uses the record's approved auto mapping (below). Without either, nothing is tagged and the post is `TAG_REVIEW_REQUIRED` (`product_tags_missing`, or `auto_mapping_not_approved` while an auto mapping waits for a person).

## Auto mapping (`scripts/instagram-product-tag-automap.mjs`)

Marketing OS has no vision model. The visual step happens outside it: a person or a Claude session looks at the slides and the Cafe24 product images and writes **findings**: per slide, each garment with its x/y and Cafe24 candidates, each with a confidence (0..1) and the evidence (print, hardware, color, cut). `analyzer` names who looked.

```json
{ "schemaVersion": 1, "folderName": "TAEGLOBAL-26AW", "analyzer": "...",
  "slides": [{ "order": 1, "savedAsset": "assets/01.jpg",
    "items": [{ "label": "down jacket", "x": 0.51, "y": 0.33,
      "candidates": [{ "productNo": 15570, "confidence": 0.9, "evidence": "..." }] }] }] }
```

`POST /api/instagram-product-tags/automap` with `{ folderName, findings }` checks each garment and stores a product-tags.json proposal in the runner record (`autoMapping`), never in the feed folder:
- The top candidate needs confidence ≥ 0.8 (`visual_low_confidence`). A second candidate at 0.5 or more makes it `visual_ambiguous_candidates`. Lower ones are only noted alternatives. A garment with no candidate is a slide review entry (`no_catalog_match`).
- Every Meta row of the product group must start with the brand tag, for example `[TAEGLOBAL : ...]` (`brand_mismatch`). Brand only narrows the search; it never picks the product.
- Color: the group has one Meta `color`, or the garment's `color` in findings names exactly one of them. Otherwise `color_unconfirmed` or `color_not_in_product`. Size is not visible, so any in-stock size of that color is the same product.
- The Meta Product ID is the first Cafe24 option of that color, in Cafe24 order, that is available in Cafe24 and `in stock` in Meta. None gives `no_in_stock_option`.
- Every tag comes out `approved: false`, `PROPOSED` or `TAG_REVIEW_REQUIRED` with the reason, confidence and evidence.

`POST /api/instagram-product-tags/automap/approve` with `{ folderName, approvedBy, builtAt, tags: [{ order, productNo }] }` is the person's decision. `builtAt` is the `source.builtAt` of the mapping the person reviewed; a newer mapping gives `mapping_changed`. At least one tag must be listed (a post without tags uses an empty product-tags.json). Only `PROPOSED` tags can be listed. They become `approved: true`, and every other tag is dropped from this post (`skipped`). After that the runner uses the mapping like product-tags.json, with every check above (`buildTagPlan`, stock, write gates). A new automap call replaces the mapping and needs a new approval. Both calls refuse a record whose tags are final. Run, automap and approve are serialized per folder in the server process.

## Operating limits

- Graph has no conditional write. If someone adds the same product in the instant between our read and our POST, that tag moves to our x/y. Run tagging from one runner only, and do not tag the same post in the app at the same time.
- There is no delete API. A wrong tag must be removed by hand in the Instagram app.
- Limits used: 5 tags per carousel slide and 20 per post. Meta also allows 25 tagged posts per 24 hours, and a carousel counts as one.

## Feed post pipeline (runner)

Roles:
- Publishing stays with the Instagram web scheduling. The runner never publishes, re-posts or deletes a post.
- The upload automation alone moves `READY/<folder>` to `UPLOADED/<yyyymmdd-HHMMSS> <folder>`, and it alone uses the Chrome on CDP 9333.
- The runner never moves, writes or deletes feed files, and it uses no browser. A tag problem never holds publishing or the move.

Steps:
1. A person registers the scheduled post: `POST /api/instagram-product-tags/posts` with `{ folderName, slotIso, caption | captionSha256, slideCount, acceptUnverifiedVariantApproval }`. The approval defaults to false.
2. Publish check (`findPublishedMedia`, ported from the verify-feed-post check used for the 10/27-28 posts). The account must be @samplaskr, and exactly one of the 25 newest posts must have the caption hash. It must have gone live at or after the slot (5 minutes early allowed) and have `slideCount` slides. Results: `SCHEDULED` (before the slot), `NOT_FOUND`, `MISMATCH` or `PUBLISHED` with the media id.
3. The folder is found where it is now. `READY/<folder>` is checked first. If it is not there, the runner uses the one `UPLOADED` folder named `<yyyymmdd-HHMMSS> <folder>`. Two matches give `uploaded_folder_ambiguous`, and no match gives `folder_not_found`. Both are review. `manifest.json` and `product-tags.json` are downloaded from that folder (Dropbox `list_folder` and `download` only). The manifest item count must equal `slideCount`. The record keeps where the files were read (`files.location`, `files.path`).
4. `buildTagPlan` runs on the published media id: owner check, children in manifest order, existing tags, and the approval and stock rule.
5. When the plan is `PENDING`, `applyTagPlan` sends only absent product ids, then `verifyTagPlan` reads them back. This needs both of the following:
   - the record approval `acceptUnverifiedVariantApproval`
   - env `INSTAGRAM_PRODUCT_TAG_WRITES=on`
6. Before each POST, the runner durably saves the attempted tags as `POST_OUTCOME_UNKNOWN` in its own record. A failed checkpoint prevents the POST. Successful tags still require approved, correctly positioned read-back. A missing, mismatched or unreadable result stays held, even if the POST returned success. The hold survives process restart or a failed final save. The existing `MAX_WRITE_RUNS` cap remains in place.

Held records are excluded from autorun, and manual `/run` returns `post_outcome_unknown` without replanning or sending tags. Rebuilding or approving an auto mapping cannot clear this hold. A separate human-authorized reconciliation is required before any further POST; this patch adds no unlock/retry endpoint. Other posts retain their existing processing. No write gate is enabled by these changes.

`TAG_VERIFIED` and `NO_TAGS` are final: the record is not run again. The record is `WORK_DIR/instagram-product-tags/posts/<folder>.json`. It holds `publish`, `tags` (per tag: slide, product, state, reason, approval), `files` and `lastError`, each kept separately. One run per folder at a time.

Routes, all with internal auth (automap routes above):
- `GET /api/instagram-product-tags/posts` lists the records; add `?folder=` for one record.
- `POST /api/instagram-product-tags/posts` registers a post.
- `POST /api/instagram-product-tags/run` with `{ folderName }` runs one post now.

Autorun every 10 minutes, off unless `INSTAGRAM_PRODUCT_TAG_AUTORUN=on`. It runs records that are not final and whose slot has passed. It stops looking for a post still `NOT_FOUND` 48 hours after its slot.
