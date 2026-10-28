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
     - Cafe24 has selling=T and display=T. Exactly one option has the same variant code, and that option is available (state `IN_STOCK` or `UNLIMITED`). An `UNKNOWN` option goes to review as `cafe24_option_uncertain`. The Cafe24 data must be for this product_no and no older than 10 minutes.
   - Approval is known per product group only. Per-variant approval is recorded as `UNVERIFIED`; only the read-back after tagging can set it to `APPROVED_IN_READBACK`.
4. `applyTagPlan` is off unless `write: true`, `acceptUnverifiedVariantApproval: true` and `INSTAGRAM_PRODUCT_TAG_WRITES=on`. It reads the slide again right before the POST and sends only product ids that are absent. After an error it reads the slide again and retries only the ids still absent.
5. `verifyTagPlan` reads the tags back. Each planned tag must be present, approved and within ±0.01 of its x/y. Tags that existed before must still be there.

Tag states: `PENDING`, `PRODUCT_TAGGING`, `TAG_VERIFIED`, `TAG_REVIEW_REQUIRED`. Any review item holds the whole post.

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

`order` and `savedAsset` must match `manifest.json`. A person sets `approved`. `withTagStatus()` writes `status`, `reason` and the resolved `metaProductId` back.

READY images carry no product data. Slides are never matched to products by name or image similarity. Without this file nothing is tagged.

## Operating limits

- Graph has no conditional write. If someone adds the same product in the instant between our read and our POST, that tag moves to our x/y. Run tagging from one runner only, and do not tag the same post in the app at the same time.
- There is no delete API. A wrong tag must be removed by hand in the Instagram app.
- Limits used: 5 tags per carousel slide and 20 per post. Meta also allows 25 tagged posts per 24 hours, and a carousel counts as one.

## Interface with the upload automation (separate session)

Upload automation (web scheduling of READY folders) and shopping tags are developed in separate sessions and branches.
This section is the contract between them. Neither side edits the other's files.

### Handoff: upload -> tags

After a post is scheduled (and its crop and order are checked), the upload side registers it once:

```
POST /api/instagram-product-tags/posts        (internal auth)
{ "folderName": "TAEGLOBAL-26AW",              // READY/<folderName>, [A-Za-z0-9._-], no ".."
  "slotIso": "2026-10-28T11:00:00.000Z",       // scheduled time
  "caption": "...",                             // or "captionSha256": "<64 hex>" (NFC, CRLF->LF, trimmed)
  "slideCount": 7,                              // 1..20, must equal manifest.json items
  "acceptUnverifiedVariantApproval": false }    // per-post approval, default off
-> 201 { ok: true, record } | 400 { ok: false, problems: [...] }  ("already_registered" on a repeat)
```

In code: `createProductTagService(...).register(input)` / `newPostRecord(input)` in `scripts/instagram-product-tag-runner.mjs`.
Status read: `GET /api/instagram-product-tags/posts?folder=<name>`; `record.publish.state` is `SCHEDULED | NOT_FOUND | MISMATCH | PUBLISHED`.

The tag side finds the published media by caption hash + slot + slide count through the Graph API. It needs no media id and no Chrome from the upload side.

### Run flow (tag side, decided 2026-10-28)

1. Autorun (`INSTAGRAM_PRODUCT_TAG_AUTORUN=on`, every 10 minutes) or `POST /api/instagram-product-tags/run {folderName}` runs each registered post that is due.
2. Publish check (`findPublishedMedia`). Until `PUBLISHED`, nothing else happens.
3. Folder lookup (`readFolder`): `READY/<folder>` first, else exactly one `UPLOADED/<stamp> <folder>` (stamp starts with a digit, no spaces; name match ignores case like Dropbox). Read only.
   - Not found anywhere (for example mid-move): `folder.state: NOT_FOUND`, tags stay `PENDING` with reason `folder_not_found`, next run looks again, with no time limit (a post still unpublished 48 hours after its slot is no longer checked).
   - More than one UPLOADED match: `TAG_REVIEW_REQUIRED`, reason `folder_ambiguous`, with the paths in `record.folder.paths`.
4. Plan, gated POST, read-back (see "Flow per post").
5. Done when `PUBLISHED` and `TAG_VERIFIED` or `NO_TAGS`. A finished post is not run again.

Publish state and tag state are separate. A tag failure never re-posts, never edits the schedule and never moves a file.
`record.moveAdvice` (`HELD` / `READY_TO_MOVE`, from `decideMove`) is status only. The upload side may read it; it does not have to wait for it.

### Ownership

| Item | Owner | Other side |
|---|---|---|
| Instagram web composer, scheduling, `/scheduled_content/` | upload | never |
| `READY/<folder>/manifest.json`, images, `_queue-metadata.json` | upload | read only |
| `READY/<folder>/product-tags.json` | tags (a person approves) | read only |
| Tag records in `WORK_DIR/instagram-product-tags/` | tags | read via GET |
| Graph `product_tags` POST | tags | never |
| `scripts/instagram-browser-guard.mjs` (dedicated Chrome, port 9333, @samplaskr check) | upload (written on the tags branch, kept for the upload side) | tag runner never imports it |
| READY -> UPLOADED move | upload only | never; reads the folder wherever it is |
| Chrome CDP 9333 | upload only | never connects |
| `server.mjs` shopping tag routes and wiring | tags | never |
