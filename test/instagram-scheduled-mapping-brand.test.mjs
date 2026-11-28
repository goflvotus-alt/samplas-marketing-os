// Mixed-brand scheduled proposals (NEW ARRIVALS): optional per-mapping brand, proposal.brand still required.
import test from "node:test";
import assert from "node:assert/strict";
import { validateScheduledProposal } from "../scripts/instagram-scheduled-mapping.mjs";

const mapping = (over = {}) => ({ slideIndex: 1, savedAsset: "assets/01.jpg", reviewRequired: false, evidence: "front zip", productNo: 16393, x: 0.5, y: 0.5, ...over });
const proposal = (mappings, over = {}) => ({ schemaVersion: 1, folderName: "NEW-ARRIVALS-20261129", brand: "NEW ARRIVALS", preparedBy: "test", mappings, ...over });

test("per-mapping brand is optional and validated; proposal.brand stays required", () => {
  assert.deepEqual(validateScheduledProposal(proposal([mapping({ brand: "GROSSI" }), mapping({ brand: "NO/FAITH STUDIOS", productNo: 16380 }), mapping({ productNo: 16381 })]), "NEW-ARRIVALS-20261129", 20), []);
  assert.deepEqual(validateScheduledProposal(proposal([mapping({ brand: "" })]), "NEW-ARRIVALS-20261129", 20), ["proposal_brand"]);
  assert.deepEqual(validateScheduledProposal(proposal([mapping({ brand: 7 })]), "NEW-ARRIVALS-20261129", 20), ["proposal_brand"]);
  assert.deepEqual(validateScheduledProposal(proposal([mapping({ brand: "GROSSI" })], { brand: "" }), "NEW-ARRIVALS-20261129", 20), ["proposal_identity"]);
});
