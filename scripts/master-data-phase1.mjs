import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

export const REVENUE_POLICY = Object.freeze({
  includeWhen: "isOfflineRevenue === true",
  includeGift: true,
  includeDelivery: true,
  includeBlankCustomer: true,
  includeNegativeReturns: true,
  unclassifiedClientType: "unassigned",
  personalPaymentExclusion: "proven_duplicate_only"
});

export const APPROVAL_STATUSES = Object.freeze(["review", "approved", "merged", "rejected"]);

const approvalTransitions = Object.freeze({
  review: new Set(["approved", "rejected"]),
  approved: new Set(["merged"]),
  merged: new Set(),
  rejected: new Set()
});

const masterArrayFields = ["aliases", "brand_codes", "cafe24_product_ids", "ecount_codes"];
const masterIdFields = Object.freeze({
  identity: "id",
  brand: "brand_id",
  product: "product_id"
});

export function withApprovalMetadata(candidate) {
  const snapshot = {
    reviewedAt: null,
    reviewedBy: null,
    approvedAt: null,
    approvedBy: null,
    mergedAt: null,
    mergedBy: null,
    mergeReason: null,
    ...candidate
  };
  for (const field of masterArrayFields) {
    if (Array.isArray(candidate?.[field])) snapshot[field] = Object.freeze([...candidate[field]]);
  }
  return snapshot;
}

export function transitionMasterCandidate(candidate, nextStatus, options = {}) {
  const current = withApprovalMetadata(candidate);
  if (!approvalTransitions[current.status]?.has(nextStatus)) {
    throw new Error(`Invalid approval transition: ${current.status} -> ${nextStatus}`);
  }
  const actor = String(options.actor || "").trim();
  const timestamp = String(options.timestamp || "").trim();
  if (!actor || !timestamp) throw new Error("actor and timestamp are required");

  const next = { ...current, status: nextStatus, reviewedAt: current.reviewedAt || timestamp, reviewedBy: current.reviewedBy || actor };
  if (nextStatus === "approved") {
    next.approvedAt = timestamp;
    next.approvedBy = actor;
  }
  if (nextStatus !== "merged") return { candidate: next, history: null };

  const entityType = String(options.entityType || "").trim();
  const idField = masterIdFields[entityType];
  if (!idField) throw new Error("entityType must be identity, brand, or product");
  const entityId = String(current[idField] || "").trim();
  if (!entityId) throw new Error(`entityType ${entityType} requires ${idField}`);
  const currentCanonical = String(options.currentCanonical || "").trim();
  const mergeReason = String(options.mergeReason || "").trim();
  if (!currentCanonical || !mergeReason) throw new Error("currentCanonical and mergeReason are required");
  if (currentCanonical === String(current.canonical_name || "").trim()) {
    throw new Error("Cannot merge a candidate into itself");
  }
  const approvedBy = String(current.approvedBy || "").trim();
  if (!approvedBy) throw new Error("approvedBy is required before merge");
  next.mergedAt = timestamp;
  next.mergedBy = actor;
  next.mergeReason = mergeReason;
  return {
    candidate: next,
    history: {
      entityType,
      entityId,
      previousCanonical: current.canonical_name,
      currentCanonical,
      timestamp,
      approvedBy,
      mergeReason
    }
  };
}

export function appendMergeHistory(history, entry) {
  return Object.freeze([...(history || []), Object.freeze({ ...entry })]);
}

export function buildApprovalPreview({ orders = [], products = [], customers = [] } = {}) {
  const uniqueOrders = new Map();
  for (const order of orders) {
    const id = String(order?.orderId ?? "").trim();
    if (id) uniqueOrders.set(id, order);
  }
  const uniqueIds = (rows, field) => new Set(rows.map((row) => String(row?.[field] ?? "").trim()).filter(Boolean));
  return {
    affectedOrders: uniqueOrders.size,
    affectedRevenue: [...uniqueOrders.values()].reduce((sum, order) => sum + Number(order.revenue || 0), 0),
    affectedProducts: uniqueIds(products, "productId").size,
    affectedCustomers: uniqueIds(customers, "customerId").size
  };
}

export async function readMasterDataCandidates(
  file = join(root, "config", "master-data-candidates.json")
) {
  return JSON.parse(await readFile(file, "utf8"));
}
