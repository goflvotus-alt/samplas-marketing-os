// Render persistent WORK_DIR에 업로드 가능한 work/ 스냅샷 경로의 단일 source of truth.
//
// 과거에는 server.mjs(workDataUploadPaths, 서버 측 검증)와
// scripts/upload-work-snapshots-to-render.mjs(explicitPaths, 클라이언트 측 필터)가
// 동일한 목록을 각자 따로 하드코딩했다 — 둘 중 한쪽만 갱신하면 조용히 drift한다
// (실제로 product-registry.json이 두 곳 모두에서 누락된 채 방치된 적이 있었다,
// docs/reports/render-product-registry-alignment-2026-08-26.md 참고). 이 파일을
// 양쪽이 공통으로 import해서 그 gap을 구조적으로 없앤다.
export const RENDER_SNAPSHOT_EXPLICIT_PATHS = [
  "brand-master.json",
  "price-audit.json",
  "today-product-sync-issues.json",
  "store-master.json",
  "product-registry.json",
  "color-master.json",
  "intelligence/brand-master-list.json",
  "intelligence/brand-aliases.json",
  "ecount-inventory/latest.json",
  "ecount-inventory/diagnostic.json"
];

export const RENDER_SNAPSHOT_MONTHLY_PATTERN = /^(?:ecount-sales|monthly)\/(\d{4}-(?:0[1-9]|1[0-2]))(?:\.(?:APGUJEONG|VAIL))?\.json$/;

export function isAllowedRenderSnapshotPath(relativePath) {
  return RENDER_SNAPSHOT_EXPLICIT_PATHS.includes(relativePath) || RENDER_SNAPSHOT_MONTHLY_PATTERN.test(relativePath);
}
