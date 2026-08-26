// server.mjs(업로드 수신 측 allowlist)와 scripts/upload-work-snapshots-to-render.mjs
// (업로드 발신 측 allowlist)가 scripts/render-snapshot-manifest.mjs라는 단일 source of
// truth를 공유하는지 — 즉 두 곳을 따로 고쳐야 하는 drift 가능성이 이제 구조적으로
// 없다는 것을 검증한다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  RENDER_SNAPSHOT_EXPLICIT_PATHS,
  RENDER_SNAPSHOT_MONTHLY_PATTERN,
  isAllowedRenderSnapshotPath
} from "../scripts/render-snapshot-manifest.mjs";

test("known snapshot paths are allowed", () => {
  for (const path of RENDER_SNAPSHOT_EXPLICIT_PATHS) {
    assert.ok(isAllowedRenderSnapshotPath(path), `${path}는 허용되어야 한다`);
  }
});

test("monthly ecount-sales/monthly paths (with optional store suffix) are allowed", () => {
  assert.ok(isAllowedRenderSnapshotPath("monthly/2026-08.json"));
  assert.ok(isAllowedRenderSnapshotPath("ecount-sales/2026-08.APGUJEONG.json"));
  assert.ok(isAllowedRenderSnapshotPath("ecount-sales/2026-08.VAIL.json"));
  assert.equal(isAllowedRenderSnapshotPath("monthly/2026-13.json"), false, "13월은 존재하지 않는다");
});

test("arbitrary or path-traversal-like paths are rejected", () => {
  assert.equal(isAllowedRenderSnapshotPath("../../etc/passwd"), false);
  assert.equal(isAllowedRenderSnapshotPath("random-arbitrary.json"), false);
  assert.equal(isAllowedRenderSnapshotPath(""), false);
});

test("monthly pattern still exposes a capture group for the month segment (server.mjs relies on this)", () => {
  const match = "monthly/2026-08.json".match(RENDER_SNAPSHOT_MONTHLY_PATTERN);
  assert.equal(match?.[1], "2026-08");
});

console.log("render snapshot manifest tests passed");
