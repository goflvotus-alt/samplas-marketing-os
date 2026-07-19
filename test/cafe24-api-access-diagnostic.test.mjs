import assert from "node:assert/strict";
import {
  classifyEndpointResult,
  compareAccessPaths,
  describeEnvValue,
  redactSensitive
} from "../scripts/diagnose-cafe24-api-access.mjs";

assert.deepEqual(describeEnvValue("A", undefined, "missing"), {
  name: "A",
  present: false,
  source: "missing",
  length: 0,
  empty: true,
  containsWhitespace: false,
  hasLeadingOrTrailingWhitespace: false,
  looksPlaceholder: false
});

const present = describeEnvValue("CAFE24_ACCESS_TOKEN", " token-value ", ".env");
assert.equal(present.present, true);
assert.equal(present.containsWhitespace, true);
assert.equal(present.hasLeadingOrTrailingWhitespace, true);
assert.equal(present.length, 13);

assert.equal(describeEnvValue("X", "placeholder", ".env").looksPlaceholder, true);
assert.equal(describeEnvValue("X", "realistic-value", ".env").looksPlaceholder, false);

const redacted = redactSensitive({
  access_token: "abc",
  nested: {
    Authorization: "Bearer abc.def.ghi",
    ok: "Bearer abc.def.ghi"
  },
  list: [{ refreshToken: "secret" }]
});
assert.equal(redacted.access_token, "[REDACTED]");
assert.equal(redacted.nested.Authorization, "[REDACTED]");
assert.equal(redacted.nested.ok, "Bearer [REDACTED]");
assert.equal(redacted.list[0].refreshToken, "[REDACTED]");

assert.equal(classifyEndpointResult({ ok: true }), "supported");
assert.equal(classifyEndpointResult({ ok: false, category: "endpoint_not_found_unconfirmed", authPrerequisiteFailed: true }), "cannot_confirm_until_auth_succeeds");
assert.equal(classifyEndpointResult({ ok: false, category: "endpoint_not_found_unconfirmed", authPrerequisiteFailed: false }), "endpoint_path_invalid_or_unsupported");
assert.equal(classifyEndpointResult({ ok: false, category: "insufficient_scope" }), "insufficient_scope");
assert.equal(classifyEndpointResult({ ok: false, category: "network_failure" }), "network_failure");

const diff = compareAccessPaths(
  { apiVersion: "2025-06-01", tokenRefreshBehavior: "refresh" },
  { apiVersion: "2025-06-01", tokenRefreshBehavior: "no_refresh" }
);
assert.deepEqual(diff, [{ field: "tokenRefreshBehavior", existing: "refresh", probe: "no_refresh" }]);

const deterministic = compareAccessPaths({ z: 1, a: 2 }, { z: 2, a: 2 }).map((row) => row.field);
assert.deepEqual(deterministic, ["z"]);

console.log("cafe24 api access diagnostic tests passed");
