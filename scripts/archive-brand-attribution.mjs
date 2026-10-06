// Brand-attribution-only rebuild of a saved monthly archive after an identity change (e.g.
// SPLIT_CODE_IDENTITY). Only commerce.brandSales rows change; sales totals, online amounts and every
// other archive section stay as saved.
//
// The offline part of each row is recomputed through the official merge: `before` and `after` are
// offline-only buckets from mergeOfflineBrandSales for the same month, resolved against the pre-change
// and current canonical state. A row becomes row - before + after. The rebuild refuses to run unless the
// `before` buckets reproduce the saved offline amounts exactly, so a stale snapshot or a different
// identity state can never be written into an archive.

const OFFLINE_FIELDS = ["salesAmount", "canonicalPaidAmount", "offlineSalesAmount", "quantitySold", "orderCount"];
const SALES_FIELDS = ["grossAmount", "paidAmount"];
const num = (value) => Number(value || 0);
const byCode = (rows) => new Map(rows.map((row) => [String(row.brand_code || ""), row]));

export function attributionError(code, message) {
  return Object.assign(new Error(message), { code, status: 409 });
}

/**
 * @param {object} p
 * @param {Array} p.brandSales  saved archive commerce.brandSales (online + offline merged)
 * @param {Array} p.before      offline-only buckets with the pre-change canonical
 * @param {Array} p.after       offline-only buckets with the current canonical
 * @param {Map<string,string>} p.names new labels for codes whose canonical name changed (empty names are ignored)
 */
export function rebuildArchiveBrandSales({ brandSales = [], before = [], after = [], names = new Map() }) {
  const saved = byCode(brandSales);
  const beforeMap = byCode(before);
  const afterMap = byCode(after);

  // The pre-change state must reproduce the archive's offline attribution exactly.
  for (const row of brandSales) {
    const code = String(row.brand_code || "");
    if (num(row.offlineSalesAmount) !== num(beforeMap.get(code)?.offlineSalesAmount)) {
      throw attributionError("ARCHIVE_SOURCE_MISMATCH", `Saved offline ${code}=${num(row.offlineSalesAmount)} differs from recomputed ${num(beforeMap.get(code)?.offlineSalesAmount)}`);
    }
  }
  for (const [code, bucket] of beforeMap) {
    if (!saved.has(code) && num(bucket.offlineSalesAmount) !== 0) throw attributionError("ARCHIVE_SOURCE_MISMATCH", `Recomputed offline ${code} is missing from the archive`);
  }

  const offlineKey = (bucket) => JSON.stringify([...OFFLINE_FIELDS.map((f) => num(bucket?.[f])), ...SALES_FIELDS.map((f) => num(bucket?.sales?.[f]))]);
  const changedCodes = new Set([...beforeMap.keys(), ...afterMap.keys()].filter((code) => offlineKey(beforeMap.get(code)) !== offlineKey(afterMap.get(code))));
  for (const [code, name] of names) if (name && saved.has(code) && saved.get(code).brand_name !== name) changedCodes.add(code);

  const next = [];
  const changes = [];
  for (const row of brandSales) {
    const code = String(row.brand_code || "");
    if (!changedCodes.has(code)) { next.push(row); continue; }
    const b = beforeMap.get(code) || {};
    const a = afterMap.get(code) || {};
    const updated = { ...row, sales: { ...(row.sales || {}) } };
    for (const field of OFFLINE_FIELDS) updated[field] = num(row[field]) - num(b[field]) + num(a[field]);
    for (const field of SALES_FIELDS) updated.sales[field] = num(row.sales?.[field]) - num(b.sales?.[field]) + num(a.sales?.[field]);
    if (names.get(code)) updated.brand_name = names.get(code);
    changes.push({ brand_code: code, before: { brand_name: row.brand_name, salesAmount: num(row.salesAmount), onlinePaidAmount: num(row.onlinePaidAmount), offlineSalesAmount: num(row.offlineSalesAmount) },
      after: { brand_name: updated.brand_name, salesAmount: updated.salesAmount, onlinePaidAmount: num(updated.onlinePaidAmount), offlineSalesAmount: updated.offlineSalesAmount } });
    next.push(updated);
  }
  for (const [code, bucket] of afterMap) {
    if (saved.has(code) || !changedCodes.has(code) || num(bucket.offlineSalesAmount) === 0) continue;
    const created = { ...bucket, onlinePaidAmount: 0, ...(names.get(code) ? { brand_name: names.get(code) } : {}) };
    changes.push({ brand_code: code, before: null, after: { brand_name: created.brand_name, salesAmount: num(created.salesAmount), onlinePaidAmount: 0, offlineSalesAmount: num(created.offlineSalesAmount) } });
    next.push(created);
  }

  const total = (rows, field) => rows.reduce((sum, row) => sum + num(row[field]), 0);
  const totals = {
    salesAmount: { before: total(brandSales, "salesAmount"), after: total(next, "salesAmount") },
    offlineSalesAmount: { before: total(brandSales, "offlineSalesAmount"), after: total(next, "offlineSalesAmount") },
    onlinePaidAmount: { before: total(brandSales, "onlinePaidAmount"), after: total(next, "onlinePaidAmount") }
  };
  for (const [field, pair] of Object.entries(totals)) {
    if (pair.before !== pair.after) throw attributionError("ARCHIVE_TOTAL_MISMATCH", `${field} total changed ${pair.before} -> ${pair.after}`);
  }
  next.sort((left, right) => num(right.salesAmount) - num(left.salesAmount));
  return { brandSales: next, changes, totals };
}
