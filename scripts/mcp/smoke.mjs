// Local MCP smoke test: calls every read tool once and prints a compact table.
// Usage: MCP_SMOKE_URL=http://127.0.0.1:8790/mcp [MCP_SMOKE_TOKEN=...] node scripts/mcp/smoke.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_SMOKE_URL || "http://127.0.0.1:8790/mcp");
const token = process.env.MCP_SMOKE_TOKEN;
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

const CALLS = [
  ["get_sales_summary", { since: monthStart, until: today }],
  ["get_sales_summary", { since: "2026-09-01", until: "2026-09-30" }],
  ["get_monthly_report", { month: "2026-09" }],
  ["get_clients_summary", { since: "2026-09-01", until: "2026-09-30" }],
  ["get_foreign_sales", { since: "2026-01-01", until: "2026-09-30", compareSince: "2025-01-01", compareUntil: "2025-09-30" }],
  ["get_inventory", { view: "brands", status: "negative_review", limit: 5 }],
  ["get_inventory", { view: "items", status: "negative_review", limit: 3, offset: 3 }],
  ["get_brand", { brand: "RECORDS INC" }],
  ["get_new_brands", { operationStatus: "NAVER_MISSING" }],
  ["get_pending_brands", {}],
  ["get_advertising_summary", { since: monthStart, until: today }],
  ["get_commercial_policy", { brand: "AE SYNCTX" }],
  ["get_brand", { brand: "zzzz-not-a-brand" }],
  ["get_inventory", { limit: 14746 }]
];

function headline(name, out) {
  if (!out.ok) return `${out.error.code}: ${out.error.message}`;
  const d = out.data;
  switch (name) {
    case "get_sales_summary": return `online ${d.online?.paidAmount} offline ${d.offline?.offlineSalesAmount} total ${d.total?.amount}`;
    case "get_monthly_report": return `${d.month} ${d.status} total ${d.sales?.totalSales?.amount}`;
    case "get_clients_summary": return `types ${d.typeBreakdown?.map((t) => `${t.type}:${t.salesAmount}`).join(" ")}`;
    case "get_foreign_sales": return `2026 ${d.current.foreign.salesAmount} (${d.current.completeness}) vs 2025 ${d.comparison?.foreign.salesAmount} (${d.comparison?.completeness}) growth ${d.growth?.growthRate}`;
    case "get_inventory": return d.brands ? `negative brands ${d.brandsTotal}, top ${d.brands.map((b) => `${b.brandName}:${b.negativeUnits}`).join(", ")}` : d.items ? `items ${d.items.length}/${d.itemsTotal} first ${d.items[0]?.prodCd}` : `summary`;
    case "get_brand": return `${d.brandCode} ${d.canonicalName} ${d.sourcingType} ${d.commercialPolicy.policyStatus} ${d.newBrand?.operationStatusLabel ?? "-"} cafe24 ${d.cafe24 ? `${d.cafe24.productCount}/${d.cafe24.displayedProductCount}/${d.cafe24.sellableProductCount}` : "-"}`;
    case "get_new_brands": return d.brands.map((b) => `${b.brandName}:${b.operationStatusLabel}`).join(", ");
    case "get_pending_brands": return `${d.total} pending: ${d.candidates.map((c) => `${c.rawBrandName}(${c.reviewReason})`).join(", ").slice(0, 160)}`;
    case "get_advertising_summary": return d.channels.map((c) => `${c.channel}:${c.status} spend ${c.spend} roas ${c.platformRoas?.toFixed?.(2)}`).join(" | ");
    case "get_commercial_policy": return `${d.brand?.name} ${d.policyStatus} ${d.stylistDiscountPercent}%`;
    default: return "ok";
  }
}

const client = new Client({ name: "samplas-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} } }));
const { tools } = await client.listTools();
console.log(`tools ${tools.length}: ${tools.map((t) => t.name).join(", ")}`);
for (const [name, args] of CALLS) {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const out = result.structuredContent;
  const bytes = JSON.stringify(out).length;
  console.log(`${name.padEnd(24)} ${String(Date.now() - started).padStart(6)}ms ${String(bytes).padStart(7)}B ${out.ok ? (out.meta.completeness || "").padEnd(11) : "ERROR      "} ${headline(name, out)}`);
}
await client.close();
