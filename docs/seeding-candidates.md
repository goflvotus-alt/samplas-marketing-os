# Seeding AI candidates (not deployed)

Optional project field: `aiCandidates: {enabled: false, items: [], runs: {"YYYY-MM-DD": {id,status,startedAt,finishedAt,count,provider,error}}}`. Existing projects are never auto-initialized. Item IDs are stable hashes of normalized Instagram handles; exclusion records remain in the items array. This field contains public account research, available Meta verification/media, evidence and review state; no image binary. ChatGPT-submitted candidates may remain unverified with imageStatus unavailable.

Authenticated routes reuse `x-samplas-internal-token` and the existing server auth guard:
- `POST /api/ai-audit/seeding/candidates/research?name=...`: explicit collection; takes no project replacement payload. Missing search credentials returns 503, no run is saved. A persisted daily claim precedes external work. No duplicate day or automatic retry. Failed research preserves candidates and records error. Network outcomes require canonical GET before further action.
- `GET /api/ai-audit/seeding/candidates/media?name=...&id=...`: Business Discovery media refresh, read-only, no arbitrary handle or URL input.
- Existing `PUT /api/ai-audit/seeding/project?name=...`, `{version,operations:[{type:"review_candidate",candidateId,status:"approved"|"held"|"excluded"}]}`. Approval and canonical seeding/Creator initialization share one Dropbox rev CAS. Duplicate Creator IDs reject. Held candidates remain; excluded candidates cannot be reapproved; approved candidates cannot be removed through review.
- Same PUT accepts `{type:"configure_candidates",enabled:true|false}`. The review PUT does not accept client-created candidate data or verified flags. Candidate submission is handled by the separate POST contract below.

Configuration names only (values are never logged): `TAVILY_API_KEY` preferred, `BRAVE_SEARCH_API_KEY` alternative. Persistent existing Meta credential is reused; no OAuth changes. `OPENAI_API_KEY` optionally enables actual visual evaluation; `SEEDING_CANDIDATES_MODEL` overrides the default model. Without it, cards explicitly show caption evidence and unverified fit/estimates, not a claim of AI visual analysis. Collection itself requires real Business Discovery validation and at least 3 actual media URLs. All external requests are bounded and errors sanitized.

`SEEDING_CANDIDATES_ENABLED=true` plus project opt-in enables minute checks, first run at/after 10:00 Asia/Seoul. Global flag defaults OFF; no production activation performed. No new paid accounts or credentials were provisioned. Server downtime means catch-up after 10 rather than an exact-time guarantee. An interrupted running claim deliberately blocks automatic retries: owner intervention/readback is needed. Whole-file rev conflicts fail closed, including writes from other projects.

Run tests with Node's test runner. All fixtures and network adapters are isolated; no production candidate registration is needed. Production rollout, credentials, schedule activation and real collection require separate authorization.

## ChatGPT-researched candidate import (preferred, no search key required)

`POST /api/ai-audit/seeding/candidates`, authenticated using existing internal-token header. Exact body:

```json
{"name":"<project name>","version":1,"candidates":[{"instagramId":"<actual handle>","profileUrl":"https://www.instagram.com/<actual handle>/","recommendationReason":"<research evidence>","source":"<discovery source URL or description>"}]}
```

Accepts 1–10 candidates. GET latest version first. Normalizes handles; rejects malformed inputs and duplicate handles within batch before external calls. Existing candidates, approved/excluded history, Creator DB and seeding records reject registration with 409. Entire batch is all-or-nothing; no partial duplicate skips. Metadata and supplied recommendation are saved separately from Meta verification: `origin: chatgpt-research`, `registeredAt`, `source`, `recommendationReason`. Failed Meta or missing credential produces `imageStatus: unavailable`, `imageError: IMAGE_UNAVAILABLE`, empty images and **no fabricated verifiedAt**; registration still succeeds. Registration never creates a seeding recipient. Explicit user approval can register an image-unavailable candidate after direct profile review.

Response 201 is existing project detail with new version/ETag. Mandatory caller workflow: GET latest → POST once → GET readback; check that all submitted handles exist once with pending status. On 409 read current project and return conflict; on network ambiguity GET before any user-authorized retry. Do not retry automatically. Registration rechecks the whole current Creator DB inside the existing atomic Dropbox rev-CAS seam; existing seeding data and other projects are preserved.

Unpublished Private Plugin tool definition: `seeding-candidates-tool.json`; exact OpenAPI: `seeding-candidates-openapi.json`. Proposed tool `registerSeedingCandidates`; existing four tools remain unchanged. Sites must forward its existing `SAMPLAS_INTERNAL_TOKEN` server-side; no client secret input. These are contracts only: no Plugin publication or deployment performed. The optional Tavily/Brave research module and disabled scheduler remain available but are not prerequisites for this POST or review actions.
