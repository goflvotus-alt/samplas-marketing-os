import assert from "node:assert/strict";
import {
  classifyRecoveryGate,
  classifyRecoveryResult
} from "../scripts/recover-cafe24-api-access-and-probe.mjs";

const envSummary = [
  { name: "CAFE24_MALL_ID", present: true, empty: false },
  { name: "CAFE24_CLIENT_ID", present: true, empty: false },
  { name: "CAFE24_CLIENT_SECRET", present: true, empty: false }
];

assert.deepEqual(classifyRecoveryGate({ exists: false }, envSummary), {
  canRefreshSafely: false,
  reason: "token_store_missing"
});

assert.deepEqual(classifyRecoveryGate({ exists: true, status: "reauth_required", hasAccessToken: true, hasRefreshToken: true }, envSummary), {
  canRefreshSafely: false,
  reason: "token_store_reauth_required"
});

assert.deepEqual(classifyRecoveryGate({ exists: true, status: "active", hasAccessToken: true, hasRefreshToken: false }, envSummary), {
  canRefreshSafely: false,
  reason: "token_store_missing_token"
});

assert.deepEqual(classifyRecoveryGate(
  { exists: true, status: "active", hasAccessToken: true, hasRefreshToken: true },
  [{ name: "CAFE24_MALL_ID", present: false, empty: true }, ...envSummary.slice(1)]
), {
  canRefreshSafely: false,
  reason: "refresh_env_missing",
  missing: ["CAFE24_MALL_ID"]
});

assert.deepEqual(classifyRecoveryGate({ exists: true, status: "active", hasAccessToken: true, hasRefreshToken: true }, envSummary), {
  canRefreshSafely: true,
  reason: "existing_server_refresh_path_available"
});

assert.equal(classifyRecoveryResult({ canRefreshSafely: true }, { productDetailSuccess: true }), "access_recovered");
assert.equal(classifyRecoveryResult({ canRefreshSafely: false, reason: "token_store_missing" }, { productDetailSuccess: false, productDetailStatus: 401 }), "reauth_or_token_store_setup_required");
assert.equal(classifyRecoveryResult({ canRefreshSafely: true }, { productDetailSuccess: false, productDetailStatus: 401 }), "refresh_required_but_not_executed_by_safety_gate");
assert.equal(classifyRecoveryResult({ canRefreshSafely: true }, { productDetailSuccess: false, productDetailStatus: 500 }), "unable_to_determine");

console.log("cafe24 oauth access recovery tests passed");
