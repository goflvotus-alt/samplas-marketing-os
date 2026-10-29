> Superseded on 2026-10-29 by the user-approved no-paid-image-API direction. Current architecture and gates: docs/instagram-product-tags/claude-render-integration.md. This file preserves the earlier plan only.

# Instagram scheduled receipt → Render vision

Goal: keep Claude web scheduling and its Chrome/READY ownership; use a verified success receipt to register with the existing API, then Render detects publication, analyzes images, matches stock and group approval, approves high-confidence tags, and uses the unchanged PR45–48 write/checkpoint/read-back path.

Confirmed seam: existing `newPostRecord`/`register` API. Scheduling success is supported by Claude's TAEGLOBAL memory, nt6 image/caption/slot read-back and saved calendar evidence; no durable scheduling engine was found in Marketing OS DEV or the repo. Do not promote scratchpad scripts to an engine or modify them. Provide an independently callable success adapter, not a replacement scheduler. No Claude calls after registration.

Implementation (inline; user's detailed scope authorizes local implementation):
- [x] Add mocked tests for receipt validation, duplicate registration/conflicts, vision request validation, paid-call checkpoint and cached results, automatic approval and unchanged unknown-outcome holds.
- [x] Add browser-free receipt adapter calling only `/posts`, no upload/move operations.
- [x] Add OpenAI Responses image analysis: manifest images from read-only Dropbox plus same-brand Meta reference images, strict JSON findings schema and local validation. Bounded inputs, no silent candidate truncation, no automatic paid-call retry; missing credentials/uncertain results hold.
- [x] Add explicit per-post autoTag opt-in plus global vision-off gate. Analyze only after publish match. Persist analysis before API, reuse findings; approve only existing PROPOSED candidates that pass fresh Cafe24 and IG group approval. Keep variant UNVERIFIED distinct and require per-post acceptance as before.
- [x] Wire existing server service, document receipt seam/limits/env and review deployment prerequisites. No production changes.
- [x] Run focused tests, syntax checks, inspect complete diff; commit/push one branch and create one Draft PR.

Risks to prove: duplicated schedule receipt cannot reset a job; untrusted AI output cannot choose an unseen product or slide; incomplete catalogs/manifest or API failure cannot autoapprove; concurrent runs/held records cannot repeat AI or POST; existing file/manual mappings and all write gates continue unchanged. Image recognition is mocked here; production image accuracy requires a separate read-only evaluation before rollout.

Verification: 65/65 focused mock tests pass; server/runner/vision/registration syntax checks and git diff --check pass. Existing tag execution module is unchanged. No real image API call, Chrome access, Dropbox mutation, scheduling, Instagram POST, environment update, merge or deploy performed. Draft PR creation is the final delivery step.
