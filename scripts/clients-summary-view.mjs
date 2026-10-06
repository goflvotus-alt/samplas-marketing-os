// Summary serialization for GET /api/intelligence/clients?view=summary. It takes the same
// canonical payload the full response is built from and keeps only aggregate and coverage
// fields (allowlist), so no client names, aliases, purchase details or top-10 rows leave the server.
const SUMMARY_FIELDS = ["ok", "periodStart", "periodEnd", "storeCode", "summary", "typeBreakdown", "meta", "coverage", "storeCoverage", "accounting"];

export function toClientsSummaryView(payload) {
  const view = { view: "summary" };
  for (const key of SUMMARY_FIELDS) if (key in payload) view[key] = payload[key];
  return view;
}
