// Read-only Google Sheets access for SESSION participants, with a SESSION-only service account.
//   SESSION_GOOGLE_SERVICE_ACCOUNT_JSON  the service account key (JSON); scope spreadsheets.readonly only
// The sheet must be shared with that account as a viewer. Nothing here can write to a sheet.
// Local development only (never on Render): SESSION_LOCAL_SHEETS_FILE = JSON { "<sheetId>": [[header...], [row...]] }.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { SessionError } from "./session-store.mjs";
import { localStoreAllowed } from "./session-local-dropbox.mjs";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function serviceAccount(env) {
  try {
    const key = JSON.parse(env.SESSION_GOOGLE_SERVICE_ACCOUNT_JSON || "");
    if (typeof key.client_email === "string" && typeof key.private_key === "string") return key;
  } catch { /* not configured */ }
  return null;
}

export const sheetsConfigured = (env) => Boolean(serviceAccount(env)) || (localStoreAllowed(env) && Boolean(env.SESSION_LOCAL_SHEETS_FILE));

async function accessToken(env, fetchImpl, now) {
  const key = serviceAccount(env);
  const iat = Math.floor(now() / 1000);
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const response = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }) });
  if (!response.ok) throw new SessionError(502, "sheets_auth_failed", `Google token request failed (HTTP ${response.status})`);
  return (await response.json()).access_token;
}

// Returns the sheet's rows (first row = header). Errors carry status codes only, never sheet contents.
export async function readSheetRows({ env, sheetId, range, fetchImpl = fetch, now = Date.now }) {
  if (localStoreAllowed(env) && env.SESSION_LOCAL_SHEETS_FILE) {
    const sheets = JSON.parse(readFileSync(env.SESSION_LOCAL_SHEETS_FILE, "utf8"));
    if (!Array.isArray(sheets[sheetId])) throw new SessionError(404, "sheet_not_found", "sheet not found or not shared with the service account");
    return sheets[sheetId];
  }
  if (!serviceAccount(env)) throw new SessionError(503, "participants_sync_disabled", "SESSION_GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  let token, response;
  try {
    token = await accessToken(env, fetchImpl, now);
    response = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range || "A:H")}?majorDimension=ROWS`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    if (error instanceof SessionError) throw error;
    throw new SessionError(502, "sheets_network_failed", "Google Sheets could not be reached");
  }
  if ([403, 404].includes(response.status)) throw new SessionError(404, "sheet_not_found", "sheet not found or not shared with the service account");
  if (!response.ok) throw new SessionError(502, "sheets_failed", `Google Sheets read failed (HTTP ${response.status})`);
  return (await response.json()).values || [];
}
