// Shared Product Registry aggregate summary.
//
// Intentionally recomputes only fields that are derivable from registry entries
// alone. reviewQueueCount and cafe24AnchorCoverage have separate source semantics
// and therefore remain preserved from the existing summary.

function confidenceBucket(confidence) {
  const value = Number(confidence);
  if (value === 100) return "100";
  if (value >= 95) return "95-99";
  if (value >= 80) return "80-94";
  if (value >= 60) return "60-79";
  return "0-59";
}

export function recomputeProductRegistrySummary(entries = [], existingSummary = {}) {
  const rows = Array.isArray(entries) ? entries : [];

  const confidenceDistribution = {
    "100": 0,
    "95-99": 0,
    "80-94": 0,
    "60-79": 0,
    "0-59": 0
  };

  const byBrand = new Map();

  for (const entry of rows) {
    confidenceDistribution[confidenceBucket(entry?.confidence)] += 1;

    const brand =
      entry?.brandName ||
      entry?.brandId ||
      "UNASSIGNED";

    byBrand.set(brand, (byBrand.get(brand) || 0) + 1);
  }

  return {
    ...(existingSummary || {}),
    registryCount: rows.length,
    verifiedCount: rows.filter((entry) => entry?.verified === true).length,
    confidenceDistribution,
    brandCounts: [...byBrand.entries()]
      .map(([brandName, count]) => ({ brandName, count }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          String(a.brandName).localeCompare(String(b.brandName))
      )
  };
}
