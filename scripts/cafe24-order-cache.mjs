import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { trustedCafe24OrderDate } from "./cafe24-order-amount.mjs";

const CACHE_FILE_PATTERN = /^cafe24-(csv-|proxy-)?orders-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$/;

function orderKey(order) {
  const value = order?.order_id ?? order?.orderId ?? order?.order_no ?? order?.orderNo;
  return value == null || value === "" ? null : String(value);
}

function completeness(value) {
  if (value == null || value === "") return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + completeness(item), value.length ? 1 : 0);
  if (typeof value === "object") return Object.values(value).reduce((sum, item) => sum + completeness(item), 1);
  return 1;
}

function cacheType(prefix) {
  return prefix === "csv-" ? "csv" : "api";
}

export async function loadCanonicalCafe24OrderCache({ workDir, since, until } = {}) {
  const names = await readdir(workDir).catch(() => []);
  const files = [];
  for (const name of names) {
    const match = name.match(CACHE_FILE_PATTERN);
    if (!match) continue;
    const [, prefix, fileStart, fileEnd] = match;
    if (since && until && (fileEnd < since || fileStart > until)) continue;
    try {
      files.push({
        name,
        fileStart,
        fileEnd,
        type: cacheType(prefix),
        mtimeMs: (await stat(join(workDir, name))).mtimeMs
      });
    } catch {
      // A cache removed between readdir/stat is simply no longer a candidate.
    }
  }
  files.sort((left, right) =>
    left.fileEnd.localeCompare(right.fileEnd) ||
    left.mtimeMs - right.mtimeMs ||
    left.name.localeCompare(right.name)
  );

  const keyed = new Map();
  const unkeyed = [];
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(await readFile(join(workDir, file.name), "utf8"));
    } catch {
      continue;
    }
    for (const [index, order] of (data?.orders || []).entries()) {
      const orderDate = trustedCafe24OrderDate(order);
      if (!orderDate || (since && orderDate < since) || (until && orderDate > until)) continue;
      const record = { order, orderDate, type: file.type, file, index, completeness: completeness(order) };
      const key = orderKey(order);
      if (!key) {
        unkeyed.push(record);
        continue;
      }
      const previous = keyed.get(key);
      if (!previous ||
          file.fileEnd > previous.file.fileEnd ||
          (file.fileEnd === previous.file.fileEnd && file.mtimeMs > previous.file.mtimeMs) ||
          (file.fileEnd === previous.file.fileEnd && file.mtimeMs === previous.file.mtimeMs &&
            record.completeness > previous.completeness)) {
        keyed.set(key, record);
      }
    }
  }

  const records = [...keyed.values(), ...unkeyed].sort((left, right) =>
    left.orderDate.localeCompare(right.orderDate) ||
    (orderKey(left.order) || `${left.file.name}:${left.index}`)
      .localeCompare(orderKey(right.order) || `${right.file.name}:${right.index}`) ||
    left.file.name.localeCompare(right.file.name) ||
    left.index - right.index
  );
  return {
    orders: records.map((record) => record.order),
    records,
    cacheFiles: files.map((file) => file.name)
  };
}
