// Explicit ownership, never two publishing watchers. Unknown legacy content is held.
export const NEW_FEED = "/SAMPLAS WORK/병구 작업/SAMPLAS OS/ASSETS PICKER";
export const LEGACY_FEED = "/SAMPLAS WORK/병구 작업/피드 자동화";
export function legacyOwners(value = process.env.INSTAGRAM_FEED_LEGACY_FOLDERS || "[]") {
  const names = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(names) || names.some(n => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(n) || n.includes(".."))) throw Error("INVALID_LEGACY_OWNERS");
  return new Set(names);
}
export function selectFeed(folder, hits, owners) {
  if (hits.length > 1) throw Error("AMBIGUOUS_FEED_SOURCE");
  if (!hits.length) throw Error("FEED_SOURCE_MISSING");
  if (hits[0].legacy !== owners.has(folder)) throw Error("FEED_OWNERSHIP_MISMATCH");
  return hits[0];
}
