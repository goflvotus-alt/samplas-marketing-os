# Instagram product tags (Phase 1–2)

Module: `scripts/instagram-product-tags.mjs`.
Tagging uses the Meta Graph API with the existing Production token (`resolveMetaAccessToken`). It needs no Chrome.

## Flow per post

1. `preflight` checks the app, permissions, the IG user (@samplaskr), eligibility, the catalog's business and `available_catalogs`. It runs when the plan is built and again before any write.
2. `resolveMedia` checks that the post owner is @samplaskr. It maps carousel children to `manifest.json` order, and the child count must equal the manifest item count.
3. `buildTagPlan` builds the plan from `product-tags.json`.
   - A product already tagged on the slide is never sent again.
   - Each new tag must pass `checkTagCandidate` (rule adopted 2026-10-28 from live data):
     - a person approved it, x/y are in 0..1, and `metaProductId` is given (never guessed);
     - IG `catalog_product_search` (q = product_no) lists the product group with `review_status: "approved"`, and `metaProductId` is the group's `product_id` or one of its `product_variants`. The catalog API's own `review_status` is "" on live items and is not used;
     - the catalog item is in the product_no group (`retailer_id` = `<product_no>.<variant code>`) and has `availability: "in stock"`;
     - Cafe24 has selling=T and display=T. Exactly one option has the same variant code, and that option is available (quantity > 0, not sold out). The Cafe24 data must be for this product_no and no older than 10 minutes.
   - Approval is known per product group only. Per-variant approval is recorded as `UNVERIFIED`; only the read-back after tagging can set it to `APPROVED_IN_READBACK`.
4. `applyTagPlan` is off unless `write: true`, `acceptUnverifiedVariantApproval: true` and `INSTAGRAM_PRODUCT_TAG_WRITES=on`. It reads the slide again right before the POST and sends only product ids that are absent. After an error it reads the slide again and retries only the ids still absent.
5. `verifyTagPlan` reads the tags back. Each planned tag must be present, approved and within ±0.01 of its x/y. Tags that existed before must still be there.

Tag states: `PENDING`, `PRODUCT_TAGGING`, `TAG_VERIFIED`, `TAG_REVIEW_REQUIRED`. Any review item holds the whole post.

## Cafe24 option data

`GET /api/instagram-product-tags/cafe24/<product_no>` is read-only. It uses the same internal auth as `/api/cafe24/products/*` and the global API gate.

It reuses `fetchCafe24ProductCatalogRow` (detail plus variants with inventories) and returns `toTagCafe24View`:

```json
{ "productNo": 15195, "selling": "T", "display": "T", "fetchedAt": "...",
  "options": [{ "variantCode": "P0000WML000C", "available": true }] }
```

Raw quantities are not returned. When a Cafe24 read fails, the row comes back with selling/display "F" or no options, and every tag for that product goes to review.

## `READY/<brand>/product-tags.json`

```json
{ "schemaVersion": 1, "folderName": "TAEGLOBAL-26AW",
  "post": { "mediaId": null, "permalink": null },
  "slides": [{ "order": 1, "savedAsset": "assets/01.jpg",
    "tags": [{ "productNo": 12345, "metaProductId": "2801...", "name": "...", "color": "BLACK",
      "x": 0.5, "y": 0.6, "evidence": "how it was matched", "approved": true, "status": "PENDING" }] }] }
```

`order` and `savedAsset` must match `manifest.json`. A person sets `approved`. `withTagStatus()` writes `status`, `reason` and the resolved `metaProductId` back.

READY images carry no product data. Slides are never matched to products by name or image similarity. Without this file nothing is tagged.

## Operating limits

- Graph has no conditional write. If someone adds the same product in the instant between our read and our POST, that tag moves to our x/y. Run tagging from one runner only, and do not tag the same post in the app at the same time.
- There is no delete API. A wrong tag must be removed by hand in the Instagram app.
- Limits used: 5 tags per carousel slide and 20 per post. Meta also allows 25 tagged posts per 24 hours, and a carousel counts as one.

## Proposal: when a READY folder moves to UPLOADED

The current move behaviour stays as it is. This is a proposal only.

| Post state | Tag state | Move? |
|---|---|---|
| PUBLISHED confirmed (permalink + caption hash + slide count) | `TAG_VERIFIED` | Move. Write `product-tags.json` with the statuses first. |
| PUBLISHED confirmed | no `product-tags.json`, or a file with no tags | Move. Record "no tags" in the move log. |
| PUBLISHED confirmed | `TAG_REVIEW_REQUIRED` | Keep in READY. The tags still need work, and the folder is the working copy. Mark the post as published in the queue metadata so it is never posted twice. |
| PUBLISHED confirmed | API error (preflight, Graph 5xx, token) | Keep in READY. Retry the plan and verify later. Never POST again before a read-back. |
| Publish not confirmed (not found, mismatch, still SCHEDULED) | any | Keep in READY. Do not tag. Tags need the published media id. |

A move is always the last step, after the read-back. The source of truth for "published" is the Graph media read: shortcode, permalink, owner @samplaskr and timestamp.
