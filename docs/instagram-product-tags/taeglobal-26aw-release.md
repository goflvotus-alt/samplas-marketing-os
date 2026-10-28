# TAEGLOBAL product tags: release verification

PR #45 prepares seven proposed tags for the published TAEGLOBAL carousel. The brand comparison tolerates the observed `[tae global : …]` prefix while keeping a leading, exact brand boundary. The existing raw Cafe24 inventory evaluator is unchanged: `display_soldout=T` is a display setting, not proof of zero stock.

## Pending evidence

[`taeglobal-26aw.pending.json`](taeglobal-26aw.pending.json) preserves all seven slide IDs, product IDs, coordinates, confidence values and `approved:false`. Its state is `AWAITING_APPROVAL`; variant approval stays `UNVERIFIED`. It is historical review evidence, not a registered runner record, findings payload or approved `product-tags.json`. Do not upload it to READY/UPLOADED or copy it into a runtime record. Regenerate proposals from current data before approval.

Evidence: STEP2 Cafe24 raw GET validation on 2026-10-28 at 20:22 KST; Meta results reused from the same day's HANDOFF. M was available for all four products; the other twelve options were sold out. The deployed PR #44 route incorrectly returned `available:false` for every option. No live deployment is verified by this document.

| Slides | Cafe24 product | M variant | Meta Product ID | Coordinates |
| --- | --- | --- | --- | --- |
| 1, 2 | 15570 | P0000XAW000F | 28840522035586978 | (0.51, 0.33), (0.42, 0.62) |
| 3, 4 | 15568 | P0000XAU000B | 28945118551841223 | (0.49, 0.31), (0.55, 0.55) |
| 5, 6 | 15567 | P0000XAT000B | 38787412537572516 | (0.52, 0.31), (0.57, 0.55) |
| 7 | 15573 | P0000XAZ000F | 28378636105098089 | (0.51, 0.33) |

## Verification after an independently approved production deployment

1. Confirm the production release contains PR #45 and the brand fix commit. Keep `INSTAGRAM_PRODUCT_TAG_WRITES` and `INSTAGRAM_PRODUCT_TAG_AUTORUN` disabled. A merge, deployment or gate change requires separate authorization; this runbook grants none.
2. With authorization to use Render Shell, run the read-only check below in the deployed service. If using Chrome 9333, validate the dedicated SAMPLAS profile with the existing browser guard, open only an owned Shell tab, and close only that tab. Stop on missing auth, 401/403, non-JSON, unexpected fields or any assertion failure. Do not refresh tokens, print credentials or retry through another identity.
3. Expect four `PASS` lines: exactly the documented M variant is `IN_STOCK / available:true`, and three others are `SOLD_OUT / available:false`. The check performs only four local HTTP GETs and prints no quantities or credentials. It does not create records or approve/apply tags. If inventory has changed, stop and regenerate the candidate list rather than changing the expectation to force a pass.

```sh
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
const env = process.env;
assert.notEqual(env.INSTAGRAM_PRODUCT_TAG_WRITES, "on", "write gate must stay disabled");
assert.notEqual(env.INSTAGRAM_PRODUCT_TAG_AUTORUN, "on", "autorun must stay disabled");
assert.ok(env.CAFE24_PROXY_BASIC_AUTH && /^\d+$/.test(env.PORT || ""), "service auth/port missing");
const expected = [
  [15570, "P0000XAW000", "EFGH", "F"],
  [15568, "P0000XAU000", "ABCD", "B"],
  [15567, "P0000XAT000", "ABCD", "B"],
  [15573, "P0000XAZ000", "EFGH", "F"]
];
for (const [no, prefix, suffixes, m] of expected) {
  const response = await fetch(`http://127.0.0.1:${env.PORT}/api/instagram-product-tags/cafe24/${no}`, {
    method: "GET", signal: AbortSignal.timeout(30000),
    headers: { authorization: `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}` }
  });
  assert.equal(response.status, 200, `${no}: HTTP ${response.status}`);
  const view = await response.json();
  assert.equal(Number(view.productNo), no);
  assert.equal(view.selling, "T");
  assert.equal(view.display, "T");
  const age = Date.now() - Date.parse(view.fetchedAt);
  assert.ok(age >= 0 && age <= 600000, `${no}: stale or missing fetchedAt`);
  assert.ok(Array.isArray(view.options));
  assert.deepEqual(view.options.map((o) => o.variantCode).sort(), [...suffixes].map((s) => prefix + s).sort());
  for (const option of view.options) {
    const isM = option.variantCode === prefix + m;
    assert.equal(option.available, isM, `${no}: unexpected available for ${option.variantCode}`);
    assert.equal(option.state, isM ? "IN_STOCK" : "SOLD_OUT", `${no}: unexpected option state`);
  }
  console.log(`PASS ${no}: ${prefix + m} available; other 3 sold out`);
}
NODE
```

4. Recheck the current Meta group approval, exact M Product IDs, availability and existing slide tags using GET only, then dry-run the seven findings without saving records. Confirm the asset order, coordinates and one proposal per slide. Keep the other six low-confidence garments under review. The 15570 catalog/search count difference remains unresolved; do not infer additional variant IDs from the snapshot.
5. Stop for separate authorization before post registration, named approval of a fresh proposal (`builtAt` must match), write-gate activation, or any real Instagram product-tag POST. Variant-level approval remains unverified until an authorized POST and read-back. AUTORUN is unnecessary for a separately approved one-time application.

## Focused verification

```sh
node --test test/instagram-product-tag-automap.test.mjs test/instagram-product-tag-runner.test.mjs test/instagram-product-tags.test.mjs
git diff --check
```

The combined regression replays the seven recorded identities with mock GETs and synthetic stock values. It tests the spaced brand with M in stock, sold out and unknown inventory; only the in-stock case proposes tags, and every proposal stays unapproved. It also checks the unchanged tag planner's group approval and stock gates. It makes no live calls and never uses real stock quantities.

Compare the shared `test/instagram-product-tags.test.mjs` against the exact current main SHA. The older full-suite failure lists in the handoff match between PR HEAD `8f6e85d` and main `16b4c6a`; they are historical evidence only. Focused results do not establish a fresh full-suite result.

### STEP3 verification record (2026-10-28)

- Current main: `16b4c6ac859098afc3325f89b06564ed1eaf2e51`; shared tag tests: **22/22 passed**.
- PR candidate: based on `8f6e85d234632a608e2baa76a3affffc67550e7d` plus the brand fix and focused regression; **44/44 passed** (automap 6, runner 15, tags 23).
- **Zero new failures in the focused comparison.** No full-suite rerun. Historical full-suite failure lists for the unchanged base SHAs were byte-identical; this does not prove a current full-suite result.
- Tests ran from clean temporary source snapshots using the same installed dependencies. The first direct PR test attempt passed 43/44 but its local policy seed write was blocked by the filesystem sandbox; the exact-source temporary snapshot completed 44/44. No product-code change was made for that environment error.
- `git diff --check` passed. Existing HANDOFF, STEP2, node_modules link and original worktree files were preserved. The new pending snapshot never sets approval or write gates.
