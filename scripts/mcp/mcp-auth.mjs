// Authentication for the read-only MCP endpoint (plan §3). Modes (MCP_AUTH_MODE):
// - "oauth" (default): OAuth 2.1 resource server; one scope, samplas.read; tokens verified
//   against the authorization server's public JWKS. No shared secret.
// - "none": no authentication, for the private-plugin connection test only. Must be set explicitly.
// - "dev-noauth": local development; honored only off Render and from loopback.
// Any other value fails closed (503).
import { createRemoteJWKSet, jwtVerify } from "jose";

export const READ_SCOPE = "samplas.read";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const AUTH_MODES = new Set(["oauth", "none", "dev-noauth"]);

export function createMcpAuth({ resourceUrl, issuer, audience = resourceUrl, jwksUrl, allowedSubjects = [], mode = "oauth", isRender = false, jwks }) {
  const validMode = AUTH_MODES.has(mode);
  const noAuth = mode === "none";
  const devNoAuth = mode === "dev-noauth" && !isRender;
  const configured = Boolean(resourceUrl && issuer && audience && allowedSubjects.length);
  const metadataUrl = resourceUrl ? new URL("/.well-known/oauth-protected-resource", resourceUrl).href : null;
  const keys = jwks || (configured ? createRemoteJWKSet(new URL(jwksUrl || new URL(".well-known/jwks.json", issuer.endsWith("/") ? issuer : `${issuer}/`))) : null);
  const subjects = new Set(allowedSubjects);

  function challenge(error, description) {
    const parts = [`resource_metadata="${metadataUrl}"`, `scope="${READ_SCOPE}"`];
    if (error) parts.push(`error="${error}"`);
    if (description) parts.push(`error_description="${description}"`);
    return `Bearer ${parts.join(", ")}`;
  }
  const deny = (error, description) => ({ ok: false, status: 401, error: error || "missing_token", wwwAuthenticate: challenge(error, description) });

  async function authenticate(req) {
    if (!validMode) return { ok: false, status: 503, error: "invalid_auth_mode" };
    if (noAuth) return { ok: true, subject: "anonymous" };
    if (devNoAuth && LOOPBACK.has(req.socket?.remoteAddress)) return { ok: true, subject: "dev-noauth" };
    if (!configured) return { ok: false, status: 503, error: "not_configured" };
    const header = String(req.headers.authorization || "");
    if (!header) return deny(null, null);
    const match = header.match(/^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/);
    if (!match) return deny("invalid_token", "Malformed bearer token");
    let payload;
    try {
      ({ payload } = await jwtVerify(match[1], keys, { issuer, audience, algorithms: ["RS256"], clockTolerance: 60 }));
    } catch {
      return deny("invalid_token", "Token is invalid or expired");
    }
    const scopes = new Set([...String(payload.scope || "").split(" "), ...(Array.isArray(payload.permissions) ? payload.permissions : [])]);
    if (!scopes.has(READ_SCOPE)) return deny("insufficient_scope", `Requires ${READ_SCOPE}`);
    if (!subjects.has(payload.sub)) return deny("insufficient_scope", "Account is not allowed");
    return { ok: true, subject: payload.sub };
  }

  function protectedResourceMetadata() {
    return {
      resource: resourceUrl,
      authorization_servers: [issuer],
      scopes_supported: [READ_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "SAMPLAS Marketing OS"
    };
  }

  // ChatGPT reads these per-tool security schemes from tools/list.
  const securitySchemes = noAuth ? [{ type: "noauth" }] : [{ type: "oauth2", scopes: [READ_SCOPE] }];

  return { authenticate, protectedResourceMetadata, challenge, configured: validMode && configured, devNoAuth, noAuth, validMode, securitySchemes };
}
