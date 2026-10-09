import test from "node:test";
import assert from "node:assert/strict";
import { buildTaggedUploadPlans, taggedPostType, seoulDateFromTimestamp } from "../scripts/seeding-tagged-upload-matcher.mjs";

const detail = (name, version, seedings) => ({ project: { name, version }, seedings });

test("maps a tagged reel to the matching shipped creator", () => {
  const plans = buildTaggedUploadPlans([
    detail("A", 3, [{ id: "s1", instagramId: "@Creator.One", shippingStatus: "출고 완료", shippedAt: "2026-10-01", uploadStatus: "waiting", uploadStatusMode: "auto", postUrl: "" }])
  ], [{ id: "m1", username: "creator.one", permalink: "https://www.instagram.com/reel/abc/", timestamp: "2026-10-03T03:00:00Z", media_type: "VIDEO" }], "2026-10-09T04:00:00Z");
  assert.equal(plans.length, 1);
  assert.equal(plans[0].operations[0].patch.uploadStatus, "completed");
  assert.equal(plans[0].operations[0].patch.uploadVerifiedBy, "api");
  assert.equal(plans[0].operations[0].patch.postType, "reel");
});

test("preserves manual, completed, unavailable, and pre-shipment records", () => {
  const seedings = [
    { id: "manual", instagramId: "creator", shippingStatus: "출고 완료", shippedAt: "2026-10-01", uploadStatus: "waiting", uploadStatusMode: "manual", postUrl: "" },
    { id: "done", instagramId: "creator", shippingStatus: "출고 완료", shippedAt: "2026-10-01", uploadStatus: "completed", uploadStatusMode: "auto", postUrl: "" },
    { id: "na", instagramId: "creator", shippingStatus: "출고 완료", shippedAt: "2026-10-01", uploadStatus: "unavailable", uploadStatusMode: "auto", postUrl: "" },
    { id: "future", instagramId: "creator", shippingStatus: "출고 완료", shippedAt: "2026-10-10", uploadStatus: "waiting", uploadStatusMode: "auto", postUrl: "" }
  ];
  assert.deepEqual(buildTaggedUploadPlans([detail("A", 1, seedings)],[{ id: "m", username: "creator", permalink: "https://www.instagram.com/p/x/", timestamp: "2026-10-09T00:00:00Z" }]), []);
});

test("one tagged post is assigned only to the most recent eligible shipment", () => {
  const plans = buildTaggedUploadPlans([
    detail("OLDER", 4, [{ id: "old", instagramId: "creator", shippingStatus: "출고 완료", shippedAt: "2026-09-01", uploadStatus: "waiting", uploadStatusMode: "auto", postUrl: "" }]),
    detail("NEWER", 7, [{ id: "new", instagramId: "creator", shippingStatus: "출고 완료", shippedAt: "2026-10-01", uploadStatus: "waiting", uploadStatusMode: "auto", postUrl: "" }])
  ], [{ id: "m", username: "creator", permalink: "https://www.instagram.com/p/x/", timestamp: "2026-10-05T00:00:00Z" }]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].name, "NEWER");
});

test("normalizes Seoul date and feed type", () => {
  assert.equal(seoulDateFromTimestamp("2026-10-08T16:30:00Z"), "2026-10-09");
  assert.equal(taggedPostType({ media_type: "IMAGE", permalink: "https://www.instagram.com/p/x/" }), "feed");
});
