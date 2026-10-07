# Cafe24 proxy / internal auth audit — read only (2026-10-07)

No env, `.env`, secret, git or Production change. No secret value is printed here. Only presence, lengths and HTTP status codes are recorded.

## Correction to earlier notes

Earlier today `CODE-IDENTITY-SPLIT-ONE-CLICK.md` (UNDER THE SIGN dry-run) and the session summary said "the local `CAFE24_PROXY_SECRET` does not match Render". That was wrong.

- Local `.env` has `CAFE24_PROXY_SECRET` **empty**, so those 401s came from sending an empty token header.
- There is no local/Render value mismatch.
- Neither side uses the proxy secret.

## A. Auth surface map

| File | Caller | Target | Auth method sent / checked | Env key | R/W | Production? |
|---|---|---|---|---|---|---|
| server.mjs `isAuthorizedInternalRequest` | inbound internal routes | — | token if `CAFE24_PROXY_SECRET` non-empty; Basic if `CAFE24_PROXY_BASIC_AUTH` set; localhost only if both empty | both | check | yes |
| server.mjs `isAuthorizedOperatorAction` | split, re-key, ECOUNT import | — | localhost, or internal (above), or same-origin operator session cookie | above + `SAMPLAS_OPERATOR_BASIC_AUTH` (session login) | check | yes |
| server.mjs `isLocalRequest` | localhost bypass | — | Host header 127.0.0.1 / localhost / ::1 | — | check | local only in practice |
| scripts/ai-audit.mjs `isAiAuditAuthorized` | `/api/ai-audit/*` | — | `x-samplas-internal-token` equal to `AI_AUDIT_SECRET`, falling back to `CAFE24_PROXY_SECRET` | `AI_AUDIT_SECRET` | check | yes |
| scripts/mcp/* | `/mcp` | — | OAuth (`MCP_AUTH_MODE`, default oauth) | MCP_* / OAUTH_* | check | yes |
| server.mjs ~2588, ~6468 | local server → `CAFE24_PROXY_BASE_URL` (orders, brands, other proxy calls) | Render | token if set, plus Basic if set | both | read | local only (Render runs local_oauth, no proxy URL) |
| intelligence-service.mjs ~592 | intelligence → proxy | Render | token if set, plus Basic | both | read | local only |
| scripts/cafe24-script-client.mjs | build-price-audit, diagnose-cafe24-ecount-product-matching | Render proxy | token if set, plus Basic | both | read | yes (target) |
| scripts/build-price-audit.mjs | price audit | Render | token if set, plus Basic | both | read | yes |
| scripts/probe-cafe24-render-product-identity.mjs | probe | Render | token if set, plus Basic | both | read | yes |
| scripts/upload-cafe24-csv-to-render.mjs | CSV upload | Render | token if set, plus Basic | both | **write** | yes |
| scripts/upload-work-snapshots-to-render.mjs | snapshot upload | Render | token if set, plus Basic | both | **write** | yes |
| scripts/check-render-deployment.mjs | deploy check | Render | Basic only | BASIC_AUTH | read | yes |
| scripts/apply-cafe24-brand-aliases.mjs | alias apply | Render | Basic only | BASIC_AUTH | write | yes |
| scripts/verify-render-snapshot-sync.mjs | snapshot verify | Render | none (public GETs) | — | read | yes |
| POS-PRICE/deploy/server.mjs, baselines/* | separate or legacy copies | — | token if set, plus Basic | both | — | not this service |
| ~/Library/SAMPLAS/*, LaunchAgents, launcher_v2, registry.json | Mac autostart | local only | none | — | — | no Production calls (registry only lists `renderUrl`) |

Every outbound caller adds the token header only when `CAFE24_PROXY_SECRET` is non-empty, and almost all of them also send Basic. **No caller relies on the token alone.**

## B. Production auth logic

- Internal routes such as `/api/cafe24/brands`, `/api/pending-brands/refresh`, review and the identity tools accept:
  - `x-samplas-internal-token`, only when Render's `CAFE24_PROXY_SECRET` is non-empty; or
  - `Authorization: Basic` equal to `CAFE24_PROXY_BASIC_AUTH`.
  - Localhost-only applies when both are empty, which is not the case on Render.
- Operator actions (split, re-key, ECOUNT import): internal auth, or a same-origin operator session created with `SAMPLAS_OPERATOR_BASIC_AUTH`.
- AI audit: a separate secret (`AI_AUDIT_SECRET`, falling back to `CAFE24_PROXY_SECRET`). It does not accept Basic.
- MCP: OAuth, a separate domain.
- `CAFE24_PROXY_SECRET` is read on Production in two places: the internal token check, and as the AI audit fallback. Production never sends it outbound (no `CAFE24_PROXY_BASE_URL` on Render; `cafe24Mode: local_oauth`).

## C. Render env evidence (no dashboard access; inferred)

| Key | Status | Evidence |
|---|---|---|
| `CAFE24_PROXY_BASIC_AUTH` | **PRESENT, USED, matches local** | Local Basic → `/api/cafe24/brands` 200. 2026-07-02 record: set, 20 chars. Local: 20 chars. |
| `AI_AUDIT_SECRET` | **PRESENT, USED** | The local `SAMPLAS_AI_AUDIT_SECRET` value → `/api/ai-audit/health` 200, but the same value → `/api/cafe24/brands` 401. If AI audit were using the `CAFE24_PROXY_SECRET` fallback, the brands route would accept it too. |
| `CAFE24_PROXY_SECRET` | **ABSENT per the 2026-07-02 record; current value unverifiable (empty, or set to something no local file holds)**. Effectively **UNUSED**: no local credential matches it and every caller authenticates with Basic. | Synthetic token → 401; empty local value → 401; AI audit value → 401. |
| `SAMPLAS_OPERATOR_BASIC_AUTH` | not probed (session login is a POST) | — |

## D. Local usage

| Local key | State |
|---|---|
| `.env` `CAFE24_PROXY_SECRET` | EMPTY |
| `.env` `CAFE24_PROXY_BASIC_AUTH` | set, 20 chars |
| `.env` `CAFE24_PROXY_BASE_URL` | set (points to Render) |
| `~/Library/SAMPLAS/.env` `SAMPLAS_AI_AUDIT_SECRET` | set, 32 chars. Used by the ChatGPT/AI-audit integration, not by Cafe24 calls. |

Dependent local jobs:

| Job | Effect |
|---|---|
| Cafe24 orders and brands via the local proxy (local server, intelligence service) | Basic, works |
| price audit, product-identity probe, ECOUNT matching diagnostic | Basic, works |
| CSV and snapshot upload to Render (writes) | Basic, works |
| deploy check | Basic, works |
| alias apply | Basic, works |
| pending refresh, split and re-key tools used today | Basic, works |
| Mac autostart / launcher | no Production auth |
| MCP | OAuth |
| weekly reports | run inside the server; no proxy auth |

## E. Read-only verification (GET only; values never printed)

| Route | Credential | HTTP |
|---|---|---|
| `/api/cafe24/brands` | none | 401 |
| `/api/cafe24/brands` | Basic (`CAFE24_PROXY_BASIC_AUTH`) | **200** |
| `/api/cafe24/brands` | token = local `CAFE24_PROXY_SECRET` (empty) | 401 |
| `/api/cafe24/brands` | token = synthetic invalid value | 401 |
| `/api/cafe24/brands` | token = `SAMPLAS_AI_AUDIT_SECRET` | 401 |
| `/api/ai-audit/health` | none | 401 |
| `/api/ai-audit/health` | token = `SAMPLAS_AI_AUDIT_SECRET` | **200** |
| `/api/ai-audit/health` | Basic | 401 |

## F. Failure risk

- Nothing in use fails today: every Production caller sends Basic, and Basic matches.
- Latent risk 1: if someone puts the AI audit secret into `CAFE24_PROXY_SECRET`, or sets Render's proxy secret, nothing breaks, but it widens the internal surface for no reason.
- Latent risk 2: on Render, if `AI_AUDIT_SECRET` were removed, AI audit would silently fall back to `CAFE24_PROXY_SECRET`. That fallback couples two unrelated secrets.
- Latent risk 3: docs (`.env.example`, `outputs/remaining-integrations-guide.txt`) still tell operators to set `CAFE24_PROXY_SECRET` "with the same value". That invites the confusion seen today.

## G. Canonical auth decision

**Option A: Basic auth (`CAFE24_PROXY_BASIC_AUTH`) is canonical for internal and proxy calls.**
- It is the only internal credential that is present on both sides with matching values.
- Every Production caller sends it.
- It is verified 200.

The token path (`CAFE24_PROXY_SECRET`) is configured on neither side in any usable form. AI audit (`AI_AUDIT_SECRET`) and MCP (OAuth) are separate, intentional auth domains, not alternatives.

## H. Cleanup plan (next step, not done)

1. Keep `CAFE24_PROXY_BASIC_AUTH` (Render and local) as the single internal credential.
2. Deprecate `CAFE24_PROXY_SECRET` as an internal-route credential:
   - Make sure it stays empty on Render, through a dashboard check by the operator.
   - Leave the code path in place for one release, or remove it together with the `.env.example` and docs lines that suggest it.
3. Remove the AI audit fallback to `CAFE24_PROXY_SECRET` once Render's `AI_AUDIT_SECRET` is confirmed in the dashboard, so the two domains are independent.
4. Scripts:
   - No change is needed for them to work, because they already send Basic.
   - Optionally drop the unused token header from `cafe24-script-client`, `build-price-audit`, the upload scripts and the probe, in the same commit as step 2.
5. Secret rotation: not required. No secret was exposed during this audit. Rotate `CAFE24_PROXY_BASIC_AUTH` only on the normal schedule; local `.env` and Render must change together.
6. Launcher/autostart: no impact.
7. A Render redeploy is needed only if code or env changes in steps 2–3.

## I. Mutation check

- Production: only GET probes. No write endpoint was called. 401s do not change state.
- Render env, `.env` and `~/Library/SAMPLAS/.env`: unchanged (read for presence and length only).
- git: no commit or push. This report is a new untracked file.
- No secret value was printed to the terminal or written to this report.

## J. Verdict

CAFE24 PROXY AUTH AUDIT — READ ONLY COMPLETE
