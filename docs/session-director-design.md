# SAMPLAS SESSION DIRECTOR: design (approved 2026-10-13, T1–T5 in scope)

SAMPLAS SESSION is a small offline community programme. SESSION DIRECTOR is a new, independent operating tool for it.
- **Not touched:** POPUP DIRECTOR, Seeding and their data.

## 1. Architecture

| Part | Where | Notes |
|---|---|---|
| Storage | Dropbox `/SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR/<sessionId>/session.json` | Test projects use `/SAMPLAS WORK/SAMPLAS SESSION/_DIRECTOR_TEST/<sessionId>/session.json` |
| API | Marketing OS (Render), `/api/session-director/*` | `scripts/session-*.mjs` |
| MCP | `/api/session-director/mcp` | Same service layer as REST |
| Web app (T6+) | New private GitHub repo `samplas-session-director` on Vercel | Direct Vercel URL access, no Google OAuth; the server-side proxy holds the secret and signs the fixed actor `web@session.local` |
| Plugin (T11) | ChatGPT Sites worker | Owner OAuth → MCP secret |

- **One session = one JSON file.** A session never reads or writes another session's file.
- **Writes are operations** (`{version, operations[]}`), never whole-document replacement.
  - Concurrency: project `version` check plus a Dropbox rev compare-and-swap (`mode: update`).
  - A conflict returns 409 and is never retried automatically.
  - Each Dropbox request obtains a fresh access token through the existing refresh-token helper and credentials. No upload is automatically replayed, even after an authentication or network failure.
  - Authentication failures return `502 dropbox_auth_failed`; transport/body-read failures return `502 dropbox_network_failed`. Neither exposes upstream response bodies or credential values. After an ambiguous write, read the current document before offering any manual resend.

## 2. Authentication (separate from every other SAMPLAS service)

The web app has no sign-in screen. Render must allow the fixed signed actor with `SESSION_OPERATOR_EMAILS=web@session.local`. This identifies the web proxy, not an individual person. Leave `SESSION_APPROVER_EMAILS` unset by default: corrections can be proposed, but not approved. MCP writes default to `off`.

`/api/session-director/` is outside the generic `/api/*` read gate and accepts only its own credentials. AI audit token, Basic and operator session are all refused.

| Caller | Credential | Actor |
|---|---|---|
| Web app (Vercel server) | `x-session-director-token` = `SESSION_WEB_SECRET` | `x-session-actor`: `base64url(JSON{email, iat, exp})` + `.` + `base64url(HMAC-SHA256(SESSION_WEB_SECRET, "session-actor:v1." + payload))`. Lifetime at most 300 s. Render verifies signature, expiry and `SESSION_OPERATOR_EMAILS`. The approver role comes only from Render's own `SESSION_APPROVER_EMAILS`. |
| MCP (Sites worker) | `x-session-mcp-token` = `SESSION_MCP_SECRET` | `chatgpt:<x-session-mcp-user>`. The MCP secret opens only the MCP path. |

- **Writes through MCP** are refused (403 `mcp_writes_disabled`) unless `SESSION_MCP_WRITES=on`. The default is off.
- **ChatGPT can never:**
  - approve or reject an answer correction
  - write `liveLog`
  - archive a session
  - delete anything
- **Unset secrets fail closed** (503 `not_configured`).

## 3. Document

```
{ schemaVersion: 1, id, number, isTest, version, createdAt, updatedAt,
  status: PLANNING|GUEST_CONFIRMED|RECRUITING|READY|DONE|ARCHIVED,
  title, theme, date|null, timeStart, timeEnd, venue, owners[],
  guest: { name, handle, bio },
  sections: [{ id, key, title, start, end, order }],
  questions: [{ id, sectionId, order, code, durationMin, hidden,
                askText,          // what the MC reads
                sentText,         // what was sent to the guest
                guestAnswer: null | { currentRev, revisions: [...append only], pending: [...] },
                mc: { summary, keywords[], episodes, followUps[], toAudience[], directionNotes, cautions, liveMemo, basedOnRev } }],
  tasks: [{ id, title, due, owner, done, group }],
  liveLog: { runs: [{ runId, deviceId, savedAt, savedBy, baseVersion, startedAt, endedAt, done{}, actual{}, notes }] },
  changes: [{ v, at, actor, op, target, before, after }]   // last 200
}
```

**Guest answers**
- Rev 1 is written once by `import_guest_answer`.
- A correction is only `propose_answer_correction` followed by `approve_answer_correction` (approver, web only). Approval appends a new revision and moves `currentRev`.
- Revisions are never edited or removed. A rejection is recorded.
- MC notes keep `basedOnRev`, so a newer original marks them for review.

**LIVE MODE** runs from a device-local copy (IndexedDB) and never writes while running.
- On end it sends `save_live_log` once, keyed by `runId`. A repeated `runId` with the same content is a no-op.
- A 409 is resolved only for the `liveLog` area: the client re-reads, checks that no run with this `runId` exists, and offers one manual resend. Nothing is resent automatically.

## 4. Operations

| op | Who | Effect |
|---|---|---|
| `update_project {patch}` | web, mcp | title, theme, date, timeStart, timeEnd, venue, owners, guest, status (mcp: not ARCHIVED) |
| `update_section {sectionId, patch}` | web, mcp | key, title, start, end |
| `update_question {questionId, patch}` | web, mcp | askText, sentText, durationMin, hidden, code |
| `update_question_mc {questionId, patch}` | web, mcp | summary, keywords, episodes, followUps, toAudience, directionNotes (intent, bridge to the next question, when to hand over to participants), cautions, liveMemo |
| `move_question {questionId, sectionId, beforeQuestionId}` | web, mcp | order |
| `add_question {sectionId, question}` | web, mcp | new id |
| `add_task` / `update_task` | web, mcp | |
| `import_guest_answer {questionId, text, source}` | web | rev 1 only; 409 if one exists |
| `propose_answer_correction {questionId, text, reason, evidence}` | web, mcp | pending entry |
| `approve_answer_correction` / `reject_answer_correction {questionId, proposalId}` | web approver | appends a rev, or records the rejection |
| `save_live_log {run}` | web | liveLog only |

Fields not listed are rejected (400), so `guestAnswer` cannot be reached by a normal edit.

## 5. MCP tools

- **Read:** `listSessionProjects`, `getSessionProject`, `getSessionCueSheet`.
- **Write** (off by default): `createSessionProject`, `updateSessionProject`, `updateSessionCueSheet`.
- **Every write:**
  - needs the latest `version`
  - returns 409 with `currentVersion` on a mismatch
  - is read back before success is reported
  - never auto-retries

## 6. Guest answer import (DOCX)

1. `scripts/session-docx-import.mjs propose <docx>` writes a proposal: sections and times, the questions (Q1…, LAST) with `askText` (the cue part), `sentText` and answer text (the "사전 전달 질문" part). Each answer carries a sha256 and boundary notes.
2. A person checks the boundaries (an answer can start on the question line).
3. `verify <docx> <session.json|proposal>` recomputes each answer from the docx and compares the sha256 values.
   - Normalisation is only CRLF→LF and trimming each block's ends. Typos stay as written.

The import itself (a Dropbox write) needs a separate approval.

## 7. Plan

| # | Task |
|---|---|
| T1 | Model and operations |
| T2 | Dropbox layer |
| T3 | REST and auth |
| T4 | MCP |
| T5 | DOCX proposal and verify |
| T6–T11 | Web app, print, LIVE, worker. Separate approval. |
| T12–T14 | Production steps, each approved separately |
