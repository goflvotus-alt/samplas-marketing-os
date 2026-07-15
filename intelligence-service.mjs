import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { URL } from "node:url";

const root = resolve(".");
const env = await loadEnv();
const host = env.INTELLIGENCE_HOST || env.HOST || "127.0.0.1";
const port = Number(env.INTELLIGENCE_PORT || 8797);
const workRoot = resolve(env.WORK_DIR || join(root, "work"));
const intelligenceWorkDir = join(workRoot, "intelligence");
const marketingBrandMasterFile = join(workRoot, "brand-master.json");
const brandMasterListFile = join(intelligenceWorkDir, "brand-master-list.json");
const brandAliasesFile = join(intelligenceWorkDir, "brand-aliases.json");
const naverAdsBaseUrl = env.NAVER_ADS_BASE_URL || "https://api.searchad.naver.com";
const naverAdsTimeoutMs = 10000;

await mkdir(intelligenceWorkDir, { recursive: true });
await ensureBrandRegistryFiles();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname === "/api/intelligence/health") {
      return json(res, {
        ok: true,
        service: "samplas-intelligence-service",
        timestamp: new Date().toISOString(),
        workDir: intelligenceWorkDir
      });
    }
    if (url.pathname === "/api/intelligence/brands") {
      const registry = await readBrandRegistry();
      return json(res, {
        ok: true,
        count: registry.brands.length,
        aliasCount: registry.aliases.length,
        brands: registry.brands
      });
    }
    if (url.pathname === "/api/intelligence/brands/resolve") {
      const registry = await readBrandRegistry();
      return json(res, {
        ok: true,
        query: url.searchParams.get("name") || "",
        brand: resolveBrand(url.searchParams.get("name") || "", registry)
      });
    }
    if (url.pathname === "/api/intelligence/naver/search") {
      return handleNaverSearchRoute(url, res);
    }
    return json(res, {
      ok: false,
      error: "Not Found"
    }, 404);
  } catch (error) {
    return json(res, {
      ok: false,
      error: "Internal Server Error",
      message: safeErrorMessage(error)
    }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`SAMPLAS Intelligence Service running at http://${host}:${port}`);
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`SAMPLAS Intelligence Service cannot start: http://${host}:${port} is already in use.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

function json(res, payload, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function handleNaverSearchRoute(url, res) {
  const keyword = normalizeBrandName(url.searchParams.get("keyword") || url.searchParams.get("query") || "");
  if (!keyword) {
    return json(res, {
      ok: false,
      error: "Bad Request",
      message: "keyword query is required"
    }, 400);
  }
  const credentials = naverAdsCredentials();
  if (!credentials.ok) {
    return json(res, {
      ok: false,
      error: "Naver Search Ads credentials are not configured",
      missing: credentials.missing
    }, 503);
  }
  const result = await fetchNaverKeywordSearch(keyword, credentials);
  if (!result.ok) {
    return json(res, {
      ok: false,
      error: result.error,
      status: result.status,
      message: result.message
    }, result.httpStatus);
  }
  return json(res, {
    ok: true,
    source: "naver-searchad-keywordstool",
    query: keyword,
    count: result.rows.length,
    rows: result.rows
  });
}

function naverAdsCredentials() {
  const values = {
    apiKey: env.NAVER_ADS_API_KEY,
    secretKey: env.NAVER_ADS_SECRET_KEY,
    customerId: env.NAVER_ADS_CUSTOMER_ID
  };
  const missing = [];
  if (!values.apiKey) missing.push("NAVER_ADS_API_KEY");
  if (!values.secretKey) missing.push("NAVER_ADS_SECRET_KEY");
  if (!values.customerId) missing.push("NAVER_ADS_CUSTOMER_ID");
  return missing.length ? { ok: false, missing } : { ok: true, ...values };
}

async function fetchNaverKeywordSearch(keyword, credentials) {
  const method = "GET";
  const uri = "/keywordstool";
  const endpoint = new URL(uri, naverAdsBaseUrl);
  endpoint.searchParams.set("hintKeywords", keyword);
  endpoint.searchParams.set("showDetail", "1");
  const timestamp = String(Date.now());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), naverAdsTimeoutMs);
  try {
    const response = await fetch(endpoint, {
      method,
      headers: naverSearchAdsHeaders({ method, uri, timestamp, credentials }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        httpStatus: 502,
        status: response.status,
        error: "Naver Search Ads request failed",
        message: safeNaverErrorMessage(text) || `Naver Search Ads returned HTTP ${response.status}`
      };
    }
    try {
      const parsed = text ? JSON.parse(text) : {};
      return {
        ok: true,
        rows: normalizeNaverKeywordRows(parsed)
      };
    } catch {
      return {
        ok: false,
        httpStatus: 502,
        status: response.status,
        error: "Naver Search Ads response was not valid JSON",
        message: "Naver Search Ads returned an unreadable response"
      };
    }
  } catch (error) {
    return {
      ok: false,
      httpStatus: 502,
      status: null,
      error: error?.name === "AbortError" ? "Naver Search Ads request timed out" : "Naver Search Ads network error",
      message: error?.name === "AbortError" ? "Naver Search Ads did not respond in time" : "Unable to reach Naver Search Ads"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function naverSearchAdsHeaders({ method, uri, timestamp, credentials }) {
  return {
    "X-Timestamp": timestamp,
    "X-API-KEY": credentials.apiKey,
    "X-Customer": credentials.customerId,
    "X-Signature": createNaverSearchAdsSignature({ method, uri, timestamp, secretKey: credentials.secretKey })
  };
}

function createNaverSearchAdsSignature({ method, uri, timestamp, secretKey }) {
  return createHmac("sha256", secretKey)
    .update(`${timestamp}.${method}.${uri}`)
    .digest("base64");
}

function normalizeNaverKeywordRows(payload) {
  const rows = Array.isArray(payload?.keywordList) ? payload.keywordList : [];
  return rows.map((row) => ({
    keyword: normalizeBrandName(row.relKeyword),
    monthlyPcQueryCount: parseNaverNumber(row.monthlyPcQcCnt),
    monthlyMobileQueryCount: parseNaverNumber(row.monthlyMobileQcCnt),
    monthlyPcClickCount: parseNaverNumber(row.monthlyAvePcClkCnt),
    monthlyMobileClickCount: parseNaverNumber(row.monthlyAveMobileClkCnt),
    monthlyPcClickRate: parseNaverNumber(row.monthlyAvePcCtr),
    monthlyMobileClickRate: parseNaverNumber(row.monthlyAveMobileCtr),
    competitionIndex: row.compIdx == null ? null : String(row.compIdx),
    averageExposureRank: parseNaverNumber(row.plAvgDepth)
  }));
}

function parseNaverNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text || text.includes("<")) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function safeNaverErrorMessage(text) {
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    return String(parsed.title || parsed.message || parsed.error || "").slice(0, 200);
  } catch {
    return String(text).slice(0, 200);
  }
}

async function ensureBrandRegistryFiles() {
  await mkdir(intelligenceWorkDir, { recursive: true });
  if (!existsSync(brandMasterListFile) || !existsSync(brandAliasesFile)) {
    const source = await readMarketingBrandMaster();
    const { brands, aliases } = buildIntelligenceBrandRegistry(source.brands);
    if (!existsSync(brandMasterListFile)) await writeJson(brandMasterListFile, brands);
    if (!existsSync(brandAliasesFile)) await writeJson(brandAliasesFile, aliases);
  }
  await readBrandRegistry();
}

async function readMarketingBrandMaster() {
  if (!existsSync(marketingBrandMasterFile)) return { brands: [] };
  const parsed = JSON.parse(await readFile(marketingBrandMasterFile, "utf8"));
  return {
    brands: Array.isArray(parsed) ? parsed : Array.isArray(parsed.brands) ? parsed.brands : []
  };
}

function buildIntelligenceBrandRegistry(sourceBrands = []) {
  const brands = [];
  const aliases = [];
  const seenIds = new Set();
  const seenNames = new Map();
  for (const source of sourceBrands) {
    const id = normalizeBrandCode(source.brand_code);
    const name = normalizeBrandName(source.brand_name);
    if (!id || !name || seenIds.has(id)) continue;
    seenIds.add(id);
    const nameKey = normalizeBrandKey(name);
    const existingBrandId = seenNames.get(nameKey);
    if (existingBrandId) {
      aliases.push({ alias: id, brandId: existingBrandId, source: "duplicate_cafe24_brand_code" });
      continue;
    }
    seenNames.set(nameKey, id);
    brands.push({
      id,
      name,
      active: source.active === undefined ? true : Boolean(source.active)
    });
    aliases.push({ alias: id, brandId: id, source: "cafe24_brand_code" });
    for (const alias of parseBrandAliases(source.name_aliases)) {
      if (normalizeBrandKey(alias) !== normalizeBrandKey(name)) aliases.push({ alias, brandId: id, source: "name_alias" });
    }
    const instagramTag = normalizeBrandName(source.instagram_tag);
    if (instagramTag && normalizeBrandKey(instagramTag) !== normalizeBrandKey(name)) aliases.push({ alias: instagramTag, brandId: id, source: "instagram_tag" });
  }
  return {
    brands: brands.sort((left, right) => left.name.localeCompare(right.name, "ko")),
    aliases: dedupeAliases(aliases)
  };
}

async function readBrandRegistry() {
  const brands = JSON.parse(await readFile(brandMasterListFile, "utf8"));
  const aliases = JSON.parse(await readFile(brandAliasesFile, "utf8"));
  validateBrandRegistry(brands, aliases);
  return {
    brands: [...brands].sort((left, right) => left.name.localeCompare(right.name, "ko")),
    aliases
  };
}

function validateBrandRegistry(brands, aliases) {
  if (!Array.isArray(brands)) throw new Error("brand-master-list.json must be an array");
  if (!Array.isArray(aliases)) throw new Error("brand-aliases.json must be an array");
  const ids = new Set();
  const names = new Set();
  for (const brand of brands) {
    if (!brand?.id || !brand?.name) throw new Error("Brand id and name are required");
    if (typeof brand.active !== "boolean") throw new Error(`Brand active must be boolean: ${brand.id}`);
    if (ids.has(brand.id)) throw new Error(`Duplicate brand id: ${brand.id}`);
    ids.add(brand.id);
    const nameKey = normalizeBrandKey(brand.name);
    if (names.has(nameKey)) throw new Error(`Duplicate brand name: ${brand.name}`);
    names.add(nameKey);
  }
  const aliasKeys = new Set();
  for (const entry of aliases) {
    if (!entry?.alias || !entry?.brandId) throw new Error("Alias and brandId are required");
    if (!ids.has(entry.brandId)) throw new Error(`Alias references missing brandId: ${entry.brandId}`);
    const aliasKey = normalizeBrandKey(entry.alias);
    if (aliasKeys.has(aliasKey)) throw new Error(`Duplicate alias: ${entry.alias}`);
    aliasKeys.add(aliasKey);
  }
}

function resolveBrand(input, registry) {
  const key = normalizeBrandKey(input);
  if (!key) return null;
  const byName = new Map(registry.brands.map((brand) => [normalizeBrandKey(brand.name), brand]));
  const direct = byName.get(key);
  if (direct) return { brandId: direct.id, name: direct.name };
  const byId = new Map(registry.brands.map((brand) => [normalizeBrandKey(brand.id), brand]));
  const idMatch = byId.get(key);
  if (idMatch) return { brandId: idMatch.id, name: idMatch.name };
  const alias = registry.aliases.find((entry) => normalizeBrandKey(entry.alias) === key);
  if (!alias) return null;
  const brand = registry.brands.find((item) => item.id === alias.brandId);
  return brand ? { brandId: brand.id, name: brand.name } : null;
}

function normalizeBrandCode(value) {
  return String(value ?? "").trim();
}

function normalizeBrandName(value) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    Ccedil: "Ç",
    ccedil: "ç",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return String(value ?? "")
    .replace(/&(#(\d+)|#x([0-9a-fA-F]+)|[A-Za-z][A-Za-z0-9]+);/g, (entity, name, decimal, hex) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return namedEntities[name] || entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function parseBrandAliases(value) {
  if (Array.isArray(value)) return value.map(normalizeBrandName).filter(Boolean);
  return String(value ?? "")
    .split(/[\n,]/)
    .map(normalizeBrandName)
    .filter(Boolean);
}

function normalizeBrandKey(value) {
  return normalizeBrandName(value)
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function dedupeAliases(aliases) {
  const seen = new Set();
  const result = [];
  for (const alias of aliases) {
    const key = normalizeBrandKey(alias.alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  return result.sort((left, right) => left.alias.localeCompare(right.alias, "ko"));
}

async function writeJson(file, data) {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

function safeErrorMessage(error) {
  return error?.message ? String(error.message) : "Unknown error";
}

async function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return { ...process.env };
  const text = await readFile(envPath, "utf8");
  const parsed = { ...process.env };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key]) continue;
    parsed[key] = value;
  }
  return parsed;
}
