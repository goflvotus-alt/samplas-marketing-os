import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir as fsReaddir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";

const root = resolve(".");
const outputDir = join(root, "outputs");
const env = await loadEnv();
const workDir = resolve(env.WORK_DIR || join(root, "work"));
const port = Number(env.PORT || 8787);
const host = env.HOST || "127.0.0.1";
const graphVersion = env.GRAPH_VERSION || "v25.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/") {
      return serveFile(res, join(outputDir, "samplas-marketing-os.html"));
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/api/status") {
      const integrations = integrationStatus();
      return json(res, {
        instagram: integrations.instagram.ok,
        metaAds: integrations.metaAds.ok,
        cafe24: integrations.cafe24.ok,
        environment: integrations,
        pageId: env.FACEBOOK_PAGE_ID || null,
        instagramBusinessAccountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID || null,
        metaAdAccountId: cleanAdAccountId() || null,
        cafe24MallId: env.CAFE24_MALL_ID || null,
        cafe24Mode: env.CAFE24_PROXY_BASE_URL ? "proxy" : "local_oauth",
        cafe24ProxyBaseUrl: env.CAFE24_PROXY_BASE_URL || null,
        username: env.SAMPLAS_INSTAGRAM_USERNAME || "samplaskr",
        graphVersion
      });
    }
    if (url.pathname === "/api/instagram/monthly") {
      const month = url.searchParams.get("month") || currentMonth();
      const refresh = url.searchParams.get("refresh") === "1";
      const data = await buildInstagramMonthlyDataWithCache(month, { refresh });
      return json(res, data);
    }
    if (url.pathname === "/api/instagram/stories") {
      const refresh = url.searchParams.get("refresh") === "1";
      const data = await buildInstagramStoriesDataWithCache({ refresh });
      return json(res, data);
    }
    if (url.pathname === "/api/meta-ads/summary") {
      const data = await buildMetaAdsSummaryWithCache(
        url.searchParams.get("since") || `${currentMonth()}-01`,
        url.searchParams.get("until") || todayKey(),
        { refresh: url.searchParams.get("refresh") === "1" }
      );
      return json(res, data);
    }
    if (url.pathname === "/api/cafe24/health") {
      const data = await checkCafe24Health();
      return json(res, data);
    }
    if (url.pathname === "/api/cafe24/orders") {
      const data = await fetchCafe24Orders(
        url.searchParams.get("start_date") || `${currentMonth()}-01`,
        url.searchParams.get("end_date") || todayKey(),
        { limit: url.searchParams.get("limit") || undefined }
      );
      return json(res, data);
    }
    if (url.pathname === "/api/cafe24/csv/import") {
      if (req.method !== "POST") return json(res, { error: "POST만 지원합니다." }, 405);
      if (!isAuthorizedInternalRequest(req)) return json(res, { error: "Unauthorized" }, 401);
      const payload = await readJsonBody(req);
      const data = await importCafe24Csv(payload.csvText || "", payload.csvFile || "cafe24-upload.csv");
      return json(res, data);
    }
    if (url.pathname === "/api/cafe24/refresh-token") {
      const data = await refreshCafe24Token();
      return json(res, data);
    }
    if (url.pathname === "/api/cafe24/oauth/start") {
      return redirect(res, buildCafe24AuthorizeUrl());
    }
    if (url.pathname === "/api/cafe24/oauth/callback") {
      await handleCafe24OAuthCallback(url);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>Cafe24 Connected</title><body style="font-family:system-ui;padding:32px"><h1>Cafe24 연결 완료</h1><p>새 Cafe24 토큰을 .env에 저장했습니다.</p><p><a href="/">대시보드로 돌아가기</a></p></body>`);
      return;
    }
    if (url.pathname === "/api/diagnostics/logs") {
      const data = await readApiErrorLog(Number(url.searchParams.get("limit") || 50));
      return json(res, data);
    }
    if (url.pathname.startsWith("/outputs/")) {
      return serveFile(res, join(root, url.pathname));
    }
    return serveFile(res, join(outputDir, url.pathname.replace(/^\//, "")));
  } catch (error) {
    await logApiError("http_request", error, { path: req.url });
    return json(res, apiErrorPayload(error), error.status && Number(error.status) >= 400 ? Number(error.status) : 500);
  }
}).listen(port, host, () => {
  console.log(`SAMPLAS Marketing OS running at http://${host}:${port}`);
});

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

function safeErrorMessage(error) {
  return String(error?.message || "Unknown error")
    .replaceAll(env.META_ACCESS_TOKEN || "__NO_META_TOKEN__", "[META_ACCESS_TOKEN]")
    .replaceAll(env.CAFE24_ACCESS_TOKEN || "__NO_CAFE24_ACCESS__", "[CAFE24_ACCESS_TOKEN]")
    .replaceAll(env.CAFE24_REFRESH_TOKEN || "__NO_CAFE24_REFRESH__", "[CAFE24_REFRESH_TOKEN]")
    .replaceAll(env.CAFE24_CLIENT_SECRET || "__NO_CAFE24_SECRET__", "[CAFE24_CLIENT_SECRET]")
    .replaceAll(env.CAFE24_PROXY_BASIC_AUTH || "__NO_PROXY_AUTH__", "[CAFE24_PROXY_BASIC_AUTH]")
    .replaceAll(env.CAFE24_PROXY_SECRET || "__NO_PROXY_SECRET__", "[CAFE24_PROXY_SECRET]");
}

function apiErrorPayload(error) {
  const category = classifyApiError(error);
  return {
    error: safeErrorMessage(error),
    category,
    status: error?.status || null,
    code: error?.code || error?.body?.error?.code || error?.body?.error_code || null,
    type: error?.type || error?.body?.error?.type || null,
    loggedAt: new Date().toISOString()
  };
}

async function logApiError(source, error, context = {}) {
  const entry = {
    time: new Date().toISOString(),
    source,
    message: safeErrorMessage(error),
    category: classifyApiError(error),
    status: error?.status || null,
    code: error?.code || error?.body?.error?.code || error?.body?.error_code || null,
    type: error?.type || error?.body?.error?.type || null,
    context
  };
  console.error(`[SAMPLAS_API_ERROR] ${JSON.stringify(entry)}`);
  try {
    await mkdir(workDir, { recursive: true });
    const file = join(workDir, "samplas-api-errors.ndjson");
    const existing = existsSync(file) ? await readFile(file, "utf8") : "";
    const lines = existing.split(/\r?\n/).filter(Boolean).slice(-199);
    lines.push(JSON.stringify(entry));
    await writeFile(file, `${lines.join("\n")}\n`);
  } catch (logError) {
    console.error(`[SAMPLAS_API_LOG_WRITE_FAILED] ${safeErrorMessage(logError)}`);
  }
}

function classifyApiError(error) {
  const message = safeErrorMessage(error).toLowerCase();
  const code = String(error?.code || error?.body?.error?.code || error?.body?.error_code || "").toLowerCase();
  if (message.includes("api access blocked") || code === "200") return "permission_blocked";
  if (message.includes("invalid refresh_token") || message.includes("refresh token")) return "expired_refresh_token";
  if (message.includes("invalid_token") || message.includes("access_token")) return "invalid_access_token";
  return "api_error";
}

async function readApiErrorLog(limit = 50) {
  const file = join(workDir, "samplas-api-errors.ndjson");
  if (!existsSync(file)) return { source: "samplas_api_errors", logs: [] };
  const text = await readFile(file, "utf8");
  const logs = text.split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.min(Math.max(limit, 1), 200))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  return { source: "samplas_api_errors", logs };
}

async function buildMetaAdsSummary(since, until) {
  const adAccountId = cleanAdAccountId();
  if (!adAccountId) throw new Error(".env에 META_AD_ACCOUNT_ID가 없습니다.");
  const body = await graphGet(`${adAccountId}/insights`, {
    fields: "campaign_id,campaign_name,spend,reach,impressions,clicks,actions,action_values",
    level: "campaign",
    time_range: JSON.stringify({ since, until }),
    limit: 100
  });
  const campaigns = (body.data || []).map((row) => {
    const spend = Number(row.spend || 0);
    const purchaseValue = actionValue(row.action_values, "purchase");
    return {
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      spend,
      reach: Number(row.reach || 0),
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      purchases: actionValue(row.actions, "purchase"),
      purchaseValue,
      roas: spend ? purchaseValue / spend : null
    };
  });
  const result = {
    source: "meta_marketing_api",
    since,
    until,
    campaigns,
    totals: {
      spend: sum(campaigns, "spend"),
      reach: sum(campaigns, "reach"),
      impressions: sum(campaigns, "impressions"),
      clicks: sum(campaigns, "clicks"),
      purchaseValue: sum(campaigns, "purchaseValue")
    }
  };
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, `meta-ads-${since}_${until}.json`), JSON.stringify(result, null, 2));
  return result;
}

async function buildMetaAdsSummaryWithCache(since, until, options = {}) {
  if (!isCurrentMonth(monthFromDate(since))) {
    const cached = await readCachedMetaAdsSummary(since, until);
    if (cached) return decorateCachedSource(cached, "meta_marketing_api", "past_month_cache_only");
    return pastMonthCsvRequired("meta_ads", monthFromDate(since), {
      since,
      until,
      campaigns: [],
      totals: { spend: 0, reach: 0, impressions: 0, clicks: 0, purchaseValue: 0 }
    });
  }

  if (!options.refresh) {
    const cached = await readCachedMetaAdsSummary(since, until);
    if (cached) {
      return decorateCachedSource(cached, "meta_marketing_api", "cached_first");
    }
  }

  try {
    return await buildMetaAdsSummary(since, until);
  } catch (error) {
    await logApiError("meta_ads", error, { since, until });
    const cached = await readCachedMetaAdsSummary(since, until);
    if (cached) {
      return {
        ...cached,
        source: cached.source?.endsWith("_cached") ? cached.source : `${cached.source || "meta_marketing_api"}_cached`,
        cacheMode: "fallback_after_error",
        cacheWarning: error.message
      };
    }
    throw error;
  }
}

async function readCachedMetaAdsSummary(since, until) {
  const exactFile = join(workDir, `meta-ads-${since}_${until}.json`);
  if (existsSync(exactFile)) return JSON.parse(await readFile(exactFile, "utf8"));

  const monthPrefix = `meta-ads-${since}_`;
  const candidates = await readdirSafe(workDir);
  const latest = candidates
    .filter((name) => name.startsWith(monthPrefix) && name.endsWith(".json"))
    .sort()
    .at(-1);
  if (!latest) return null;
  const cached = JSON.parse(await readFile(join(workDir, latest), "utf8"));
  return {
    ...cached,
    requestedSince: since,
    requestedUntil: until,
    cacheFile: latest
  };
}

async function readdirSafe(dir) {
  try {
    return await fsReaddir(dir);
  } catch {
    return [];
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function isAuthorizedInternalRequest(req) {
  if (!env.CAFE24_PROXY_SECRET && !env.CAFE24_PROXY_BASIC_AUTH) return host === "127.0.0.1" || host === "localhost";
  if (env.CAFE24_PROXY_SECRET && req.headers["x-samplas-internal-token"] === env.CAFE24_PROXY_SECRET) return true;
  const auth = req.headers.authorization || "";
  if (env.CAFE24_PROXY_BASIC_AUTH && auth.startsWith("Basic ")) {
    return auth.slice("Basic ".length) === Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64");
  }
  return false;
}

async function fetchCafe24Orders(startDate, endDate, options = {}) {
  if (!isCurrentMonth(monthFromDate(startDate))) {
    const cached = await readCachedCafe24Orders(startDate, endDate);
    if (cached) return decorateCachedSource(cached, "cafe24_orders", "past_month_cache_only");
    return pastMonthCsvRequired("cafe24_orders", monthFromDate(startDate), {
      startDate,
      endDate,
      orders: [],
      totals: { orderCount: 0, orderAmount: 0 }
    });
  }

  if (env.CAFE24_PROXY_BASE_URL) {
    return await fetchCafe24OrdersFromProxy(startDate, endDate, options);
  }
  if (!env.CAFE24_MALL_ID || !env.CAFE24_ACCESS_TOKEN) {
    throw new Error(".env에 CAFE24_MALL_ID와 CAFE24_ACCESS_TOKEN이 필요합니다.");
  }
  let body;
  try {
    body = await cafe24GetOrders(startDate, endDate, options);
  } catch (error) {
    await logApiError("cafe24_orders", error, { startDate, endDate, stage: "orders" });
    if (!isCafe24InvalidToken(error)) throw error;
    try {
      await refreshCafe24Token();
    } catch (refreshError) {
      await logApiError("cafe24_refresh", refreshError, { startDate, endDate, stage: "refresh" });
      throw refreshError;
    }
    body = await cafe24GetOrders(startDate, endDate, options);
  }
  const orders = body.orders || [];
  const summary = summarizeCafe24Orders(orders);
  const result = {
    source: "cafe24_admin_api",
    startDate,
    endDate,
    orders,
    ...summary
  };
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, `cafe24-orders-${startDate}_${endDate}.json`), JSON.stringify(result, null, 2));
  return result;
}

async function fetchCafe24OrdersFromProxy(startDate, endDate, options = {}) {
  const base = env.CAFE24_PROXY_BASE_URL.replace(/\/$/, "");
  const path = env.CAFE24_PROXY_ORDERS_PATH || "/api/cafe24/orders";
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  if (!url.searchParams.has("limit")) url.searchParams.set("limit", options.limit || env.CAFE24_PROXY_ORDER_LIMIT || "10");
  const headers = {};
  if (env.CAFE24_PROXY_SECRET) headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
  if (env.CAFE24_PROXY_BASIC_AUTH) {
    headers.Authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
  }
  const response = await fetch(url, { headers });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Cafe24 proxy가 JSON이 아닌 응답을 보냈습니다: ${response.status} ${text.slice(0, 80)}`);
  }
  if (!response.ok || body.error) {
    throw new Error(body.error || body.message || `Cafe24 proxy error ${response.status}`);
  }
  const orders = body.orders || body.data || [];
  const result = {
    source: "cafe24_proxy",
    proxyBaseUrl: base,
    startDate,
    endDate,
    orders,
    totals: body.totals || {
      orderCount: orders.length,
      orderAmount: orders.reduce((total, order) => total + Number(order.order_price_amount || order.actual_payment_amount || 0), 0)
    }
  };
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, `cafe24-proxy-orders-${startDate}_${endDate}.json`), JSON.stringify(result, null, 2));
  return result;
}

async function readCachedCafe24Orders(startDate, endDate) {
  const exactFiles = [
    join(workDir, `cafe24-csv-orders-${startDate}_${endDate}.json`),
    join(workDir, `cafe24-proxy-orders-${startDate}_${endDate}.json`),
    join(workDir, `cafe24-orders-${startDate}_${endDate}.json`)
  ];
  for (const file of exactFiles) {
    if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  }

  const candidates = await readdirSafe(workDir);
  const prefixes = [`cafe24-csv-orders-${startDate}_`, `cafe24-proxy-orders-${startDate}_`, `cafe24-orders-${startDate}_`];
  let latest = null;
  for (const prefix of prefixes) {
    latest = candidates
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .sort()
      .at(-1);
    if (latest) break;
  }
  if (!latest) return null;
  const cached = JSON.parse(await readFile(join(workDir, latest), "utf8"));
  return {
    ...cached,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    cacheFile: latest
  };
}

function summarizeCafe24Orders(orders = []) {
  const productMap = new Map();
  const paymentMap = new Map();
  let itemCount = 0;
  let quantity = 0;
  let itemAmount = 0;

  for (const order of orders) {
    const paymentMethod = order.payment_method || order.payment_methods?.[0]?.payment_method || order.payment_method_name || "미확인";
    const orderAmount = cafe24OrderAmount(order);
    const payment = paymentMap.get(paymentMethod) || { paymentMethod, orderCount: 0, orderAmount: 0 };
    payment.orderCount += 1;
    payment.orderAmount += orderAmount;
    paymentMap.set(paymentMethod, payment);

    const items = order.items || order.order_items || order.products || [];
    for (const item of items) {
      const productName = item.product_name || item.productName || item.product_name_default || item.name || "상품명 없음";
      const productNo = item.product_no || item.productNo || item.product_code || "";
      const qty = Number(item.quantity || item.qty || 1);
      const amount = Number(item.product_price || item.price || item.order_price_amount || item.actual_payment_amount || 0) * qty;
      itemCount += 1;
      quantity += qty;
      itemAmount += amount;
      const key = productName || productNo || "상품명 없음";
      const product = productMap.get(key) || { productName: key, productNo, quantity: 0, itemAmount: 0, itemCount: 0 };
      product.quantity += qty;
      product.itemAmount += amount;
      product.itemCount += 1;
      productMap.set(key, product);
    }
  }

  const orderAmount = orders.reduce((total, order) => total + cafe24OrderAmount(order), 0);
  return {
    totals: {
      orderCount: orders.length,
      itemCount,
      quantity,
      orderAmount,
      itemAmount,
      averageOrderAmount: orders.length ? Math.round(orderAmount / orders.length) : 0
    },
    topProducts: [...productMap.values()].sort((left, right) => right.itemAmount - left.itemAmount).slice(0, 50),
    paymentMethods: [...paymentMap.values()].sort((left, right) => right.orderAmount - left.orderAmount)
  };
}

function cafe24OrderAmount(order = {}) {
  return Number(
    order.actual_payment_amount
    || order.order_price_amount
    || order.payment_amount
    || order.order_amount
    || order.total_price
    || 0
  );
}

async function importCafe24Csv(csvText, csvFile = "cafe24-upload.csv") {
  if (!csvText.trim()) throw new Error("CSV 내용이 비어 있습니다.");
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("CSV 행을 읽지 못했습니다.");
  const headers = rows[0].map(cleanCsvHeader);
  const data = rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  const grouped = new Map();

  for (const row of data) {
    const date = cafe24CsvOrderDate(row);
    if (!date) continue;
    const month = date.slice(0, 7);
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month).push({ ...row, _orderDate: date });
  }

  await mkdir(workDir, { recursive: true });
  const imported = [];
  for (const [month, rows] of [...grouped.entries()].sort()) {
    const result = buildCafe24CsvMonth(month, rows, csvFile);
    const file = join(workDir, `cafe24-csv-orders-${result.startDate}_${result.endDate}.json`);
    await writeFile(file, JSON.stringify(result, null, 2));
    imported.push({
      month,
      file: file.split("/").at(-1),
      totals: result.totals
    });
  }

  return {
    ok: true,
    source: "cafe24_csv_import",
    csvFile,
    imported,
    message: `${imported.length}개월 Cafe24 CSV 데이터를 저장했습니다.`
  };
}

function buildCafe24CsvMonth(month, rows, csvFile) {
  const ordersById = new Map();
  const productMap = new Map();
  const paymentMap = new Map();

  for (const row of rows) {
    const orderId = row["주문번호"];
    const quantity = Number(row["수량"] || 0);
    const salePrice = parseMoney(row["판매가"]);
    const itemAmount = salePrice * quantity;
    const item = {
      itemOrderId: row["품목별 주문번호"],
      productNo: row["상품번호"],
      productName: row["주문상품명"],
      productNameWithOption: row["주문상품명(옵션포함)"],
      quantity,
      salePrice,
      itemAmount
    };

    if (!ordersById.has(orderId)) {
      ordersById.set(orderId, {
        order_id: orderId,
        order_date: row._orderDate,
        order_price_amount: parseMoney(row["총 주문금액"]),
        actual_payment_amount: parseMoney(row["총 결제금액"]),
        payment_method: row["결제수단"],
        payment_type: row["결제구분"],
        mall: row["쇼핑몰"],
        items: []
      });
    }
    ordersById.get(orderId).items.push(item);

    const productKey = row["주문상품명"] || row["상품번호"] || "상품명 없음";
    const product = productMap.get(productKey) || { productName: productKey, productNo: row["상품번호"], quantity: 0, itemAmount: 0, itemCount: 0 };
    product.quantity += quantity;
    product.itemAmount += itemAmount;
    product.itemCount += 1;
    productMap.set(productKey, product);
  }

  const orders = [...ordersById.values()].sort((a, b) => String(a.order_date).localeCompare(String(b.order_date)) || String(a.order_id).localeCompare(String(b.order_id)));
  for (const order of orders) {
    const paymentMethod = order.payment_method || "미확인";
    const payment = paymentMap.get(paymentMethod) || { paymentMethod, orderCount: 0, orderAmount: 0 };
    payment.orderCount += 1;
    payment.orderAmount += Number(order.actual_payment_amount || 0);
    paymentMap.set(paymentMethod, payment);
  }

  const startDate = `${month}-01`;
  const endDate = csvMonthEnd(month, rows);
  const orderAmount = orders.reduce((total, order) => total + Number(order.actual_payment_amount || 0), 0);
  const itemAmount = rows.reduce((total, row) => total + parseMoney(row["판매가"]) * Number(row["수량"] || 0), 0);

  return {
    source: "cafe24_csv_import",
    csvFile,
    syncedAt: new Date().toISOString(),
    startDate,
    endDate,
    orders,
    totals: {
      orderCount: orders.length,
      itemCount: rows.length,
      quantity: rows.reduce((total, row) => total + Number(row["수량"] || 0), 0),
      orderAmount,
      grossOrderAmount: orders.reduce((total, order) => total + Number(order.order_price_amount || 0), 0),
      itemAmount,
      averageOrderAmount: orders.length ? Math.round(orderAmount / orders.length) : 0
    },
    topProducts: [...productMap.values()].sort((left, right) => right.itemAmount - left.itemAmount).slice(0, 50),
    paymentMethods: [...paymentMap.values()].sort((left, right) => right.orderAmount - left.orderAmount)
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((csvRow) => csvRow.some((value) => String(value).trim() !== ""));
}

function cleanCsvHeader(header) {
  return String(header || "").replace(/^\uFEFF/, "").trim();
}

function parseMoney(value) {
  return Math.round(Number(String(value || "0").replace(/,/g, "")) || 0);
}

function cafe24CsvOrderDate(row) {
  const placedAt = String(row["발주일"] || "").trim();
  if (placedAt) return placedAt.slice(0, 10);
  const orderId = String(row["주문번호"] || "");
  if (/^\d{8}/.test(orderId)) return `${orderId.slice(0, 4)}-${orderId.slice(4, 6)}-${orderId.slice(6, 8)}`;
  return "";
}

function csvMonthEnd(month, rows) {
  const dates = rows.map((row) => row._orderDate).filter(Boolean).sort();
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return dates.at(-1) || `${month}-${String(lastDay).padStart(2, "0")}`;
}

async function checkCafe24Health() {
  if (env.CAFE24_PROXY_BASE_URL) {
    const base = env.CAFE24_PROXY_BASE_URL.replace(/\/$/, "");
    const url = new URL(`${base}/api/status`);
    const headers = cafe24ProxyHeaders();
    const response = await fetch(url, { headers });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return {
        ok: false,
        source: "cafe24_proxy_status",
        message: `Render 상태 응답을 읽지 못했습니다: ${response.status}`
      };
    }
    if (!response.ok || body.error) {
      return {
        ok: false,
        source: "cafe24_proxy_status",
        message: body.error || body.message || `Render 상태 확인 실패: ${response.status}`
      };
    }
    const token = body.cafe24Token || {};
    return {
      ok: Boolean(token.hasAccessToken && token.hasRefreshToken),
      source: "cafe24_proxy_status",
      message: token.hasAccessToken && token.hasRefreshToken ? "Render Cafe24 토큰 확인" : "Render Cafe24 토큰 정보 부족",
      detail: {
        tokenSource: token.source || null,
        updatedAt: token.updatedAt || null,
        needsRefresh: Boolean(token.needsRefresh)
      }
    };
  }

  return {
    ok: Boolean(env.CAFE24_MALL_ID && env.CAFE24_ACCESS_TOKEN),
    source: "local_env",
    message: env.CAFE24_MALL_ID && env.CAFE24_ACCESS_TOKEN ? "로컬 Cafe24 토큰 확인" : "Cafe24 토큰 정보 부족"
  };
}

function cafe24ProxyHeaders() {
  const headers = {};
  if (env.CAFE24_PROXY_SECRET) headers["x-samplas-internal-token"] = env.CAFE24_PROXY_SECRET;
  if (env.CAFE24_PROXY_BASIC_AUTH) {
    headers.Authorization = `Basic ${Buffer.from(env.CAFE24_PROXY_BASIC_AUTH).toString("base64")}`;
  }
  return headers;
}

async function cafe24GetOrders(startDate, endDate, options = {}) {
  const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/orders`);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  const requestedLimit = Math.min(Number(options.limit || 500) || 500, 1000);
  const pageSize = Math.min(100, requestedLimit);
  const orders = [];
  for (let offset = 0; offset < requestedLimit; offset += pageSize) {
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.CAFE24_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
    const body = await response.json();
    if (!response.ok || body.error) {
      const message = body.error?.message || body.error_description || body.message || `Cafe24 API error ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    const pageOrders = body.orders || [];
    orders.push(...pageOrders);
    if (pageOrders.length < pageSize) break;
  }
  return { orders };
}

async function refreshCafe24Token() {
  const required = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET", "CAFE24_REFRESH_TOKEN"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Cafe24 token refresh에 필요한 값이 없습니다: ${missing.join(", ")}`);
  }

  const url = `https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/oauth/token`;
  const credentials = Buffer.from(`${env.CAFE24_CLIENT_ID}:${env.CAFE24_CLIENT_SECRET}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.CAFE24_REFRESH_TOKEN
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const message = body.error_description || body.error?.message || body.message || `Cafe24 token refresh failed ${response.status}`;
    throw new Error(`${message} refresh token도 만료됐으면 Cafe24 OAuth 재인증이 필요합니다.`);
  }

  if (!body.access_token) {
    throw new Error("Cafe24 refresh 응답에 access_token이 없습니다.");
  }

  env.CAFE24_ACCESS_TOKEN = body.access_token;
  if (body.refresh_token) env.CAFE24_REFRESH_TOKEN = body.refresh_token;
  if (body.expires_at) env.CAFE24_ACCESS_TOKEN_EXPIRES_AT = body.expires_at;
  await updateEnvFile({
    CAFE24_ACCESS_TOKEN: env.CAFE24_ACCESS_TOKEN,
    CAFE24_REFRESH_TOKEN: env.CAFE24_REFRESH_TOKEN,
    CAFE24_ACCESS_TOKEN_EXPIRES_AT: env.CAFE24_ACCESS_TOKEN_EXPIRES_AT || ""
  });

  return {
    ok: true,
    updated: ["CAFE24_ACCESS_TOKEN", body.refresh_token ? "CAFE24_REFRESH_TOKEN" : null, body.expires_at ? "CAFE24_ACCESS_TOKEN_EXPIRES_AT" : null].filter(Boolean),
    accessTokenLength: env.CAFE24_ACCESS_TOKEN.length,
    refreshTokenLength: env.CAFE24_REFRESH_TOKEN.length,
    expiresAt: env.CAFE24_ACCESS_TOKEN_EXPIRES_AT || null
  };
}

function buildCafe24AuthorizeUrl() {
  const required = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Cafe24 OAuth 시작에 필요한 값이 없습니다: ${missing.join(", ")}`);
  }
  const state = randomUUID();
  env.CAFE24_OAUTH_STATE = state;
  const url = new URL(`https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.CAFE24_CLIENT_ID);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", cafe24RedirectUri());
  if (env.CAFE24_SCOPES) url.searchParams.set("scope", env.CAFE24_SCOPES);
  return url.toString();
}

async function handleCafe24OAuthCallback(callbackUrl) {
  const code = callbackUrl.searchParams.get("code");
  const error = callbackUrl.searchParams.get("error");
  if (error) throw new Error(`Cafe24 OAuth error: ${error}`);
  if (!code) throw new Error("Cafe24 OAuth callback에 code가 없습니다.");

  const required = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Cafe24 OAuth token 교환에 필요한 값이 없습니다: ${missing.join(", ")}`);
  }

  const tokenUrl = `https://${env.CAFE24_MALL_ID}.cafe24api.com/api/v2/oauth/token`;
  const credentials = Buffer.from(`${env.CAFE24_CLIENT_ID}:${env.CAFE24_CLIENT_SECRET}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cafe24RedirectUri()
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const message = body.error_description || body.error?.message || body.message || `Cafe24 OAuth token exchange failed ${response.status}`;
    throw new Error(message);
  }
  if (!body.access_token || !body.refresh_token) {
    throw new Error("Cafe24 OAuth 응답에 access_token 또는 refresh_token이 없습니다.");
  }

  env.CAFE24_ACCESS_TOKEN = body.access_token;
  env.CAFE24_REFRESH_TOKEN = body.refresh_token;
  if (body.expires_at) env.CAFE24_ACCESS_TOKEN_EXPIRES_AT = body.expires_at;
  await updateEnvFile({
    CAFE24_ACCESS_TOKEN: env.CAFE24_ACCESS_TOKEN,
    CAFE24_REFRESH_TOKEN: env.CAFE24_REFRESH_TOKEN,
    CAFE24_ACCESS_TOKEN_EXPIRES_AT: env.CAFE24_ACCESS_TOKEN_EXPIRES_AT || ""
  });

  return {
    ok: true,
    accessTokenLength: env.CAFE24_ACCESS_TOKEN.length,
    refreshTokenLength: env.CAFE24_REFRESH_TOKEN.length,
    expiresAt: env.CAFE24_ACCESS_TOKEN_EXPIRES_AT || null
  };
}

function cafe24RedirectUri() {
  return env.CAFE24_REDIRECT_URI || `http://${host}:${port}/api/cafe24/oauth/callback`;
}

async function updateEnvFile(values) {
  const envPath = join(root, ".env");
  const current = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  const lines = current.split(/\r?\n/);
  const seen = new Set();
  const next = lines.map((line) => {
    const index = line.indexOf("=");
    if (index === -1 || line.trim().startsWith("#")) return line;
    const key = line.slice(0, index);
    if (!Object.prototype.hasOwnProperty.call(values, key)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  await writeFile(envPath, next.join("\n"));
}

function isCafe24InvalidToken(error) {
  const message = String(error.message || "").toLowerCase();
  const code = String(error.body?.error || error.body?.error_code || "").toLowerCase();
  return message.includes("invalid_token") || message.includes("access_token") || code.includes("invalid_token");
}

function cleanAdAccountId() {
  const id = env.META_AD_ACCOUNT_ID || "";
  return id && id !== "act_" ? id : "";
}

function missingEnv(keys) {
  return keys.filter((key) => !env[key] || (key === "META_AD_ACCOUNT_ID" && !cleanAdAccountId()));
}

function integrationStatus() {
  const instagramRequired = ["META_ACCESS_TOKEN", "FACEBOOK_PAGE_ID", "INSTAGRAM_BUSINESS_ACCOUNT_ID"];
  const metaAdsRequired = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"];
  const cafe24Required = ["CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET", "CAFE24_ACCESS_TOKEN", "CAFE24_REFRESH_TOKEN"];
  const cafe24ProxyRequired = ["CAFE24_PROXY_BASE_URL", "CAFE24_PROXY_ORDERS_PATH"];
  const cafe24DirectMissing = missingEnv(cafe24Required);
  const cafe24ProxyMissing = missingEnv(cafe24ProxyRequired);
  const cafe24Mode = cafe24DirectMissing.length === 0 ? "local_oauth" : cafe24ProxyMissing.length === 0 ? "proxy" : "not_configured";

  return {
    instagram: {
      ok: missingEnv(instagramRequired).length === 0,
      required: instagramRequired,
      missing: missingEnv(instagramRequired)
    },
    metaAds: {
      ok: missingEnv(metaAdsRequired).length === 0,
      required: metaAdsRequired,
      missing: missingEnv(metaAdsRequired)
    },
    cafe24: {
      ok: cafe24Mode !== "not_configured",
      mode: cafe24Mode,
      required: cafe24Mode === "proxy" ? cafe24ProxyRequired : cafe24Required,
      missing: cafe24Mode === "proxy" ? [] : cafe24DirectMissing
    }
  };
}

function actionValue(items = [], type) {
  const found = items.find((item) => item.action_type === type || item.action_type === `offsite_conversion.fb_pixel_${type}`);
  return Number(found?.value || 0);
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SAMPLAS Dashboard</title>
  <style>
    :root { color-scheme: dark; --bg:#111; --panel:#1b1b1b; --line:#333; --text:#f4f2ee; --muted:#aaa39b; --green:#5bd39b; --yellow:#ffc84a; --red:#ff6363; }
    * { box-sizing: border-box; }
    body { margin:0; background:#111; color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif; }
    .app { min-height:100vh; display:grid; grid-template-columns:320px 1fr; }
    aside { border-right:1px solid var(--line); padding:26px 22px; background:#151515; }
    main { padding:30px; }
    h1,h2,h3,p { margin:0; }
    .eyebrow { color:var(--muted); font-size:12px; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }
    h1 { margin-top:8px; font-size:28px; line-height:1.05; }
    .sync { margin-top:28px; display:grid; gap:15px; }
    .sync-row { display:grid; grid-template-columns:14px 1fr auto; gap:12px; align-items:center; }
    .dot { width:14px; height:14px; border-radius:50%; background:var(--yellow); }
    .sync-row.good .dot { background:var(--green); }
    .sync-row.bad .dot { background:var(--red); }
    .sync-row strong { display:block; font-size:22px; }
    .sync-row small { display:block; color:var(--muted); margin-top:4px; font-size:14px; line-height:1.35; }
    .pill { border:1px solid var(--line); border-radius:999px; padding:8px 12px; color:var(--muted); font-weight:900; }
    .sync-row.good .pill { color:var(--green); border-color:rgba(91,211,155,.55); }
    .sync-row.bad .pill { color:var(--red); border-color:rgba(255,99,99,.55); }
    .top { display:flex; justify-content:space-between; align-items:flex-start; gap:18px; margin-bottom:24px; }
    .top h2 { margin-top:8px; font-size:34px; letter-spacing:-.02em; }
    select,button { border:1px solid var(--line); border-radius:12px; background:#181818; color:var(--text); font:inherit; font-weight:800; padding:12px 14px; }
    button { cursor:pointer; }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; }
    .card { border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:18px; min-height:116px; }
    .card span { color:var(--muted); font-size:13px; font-weight:800; }
    .card strong { display:block; margin-top:12px; font-size:30px; letter-spacing:-.02em; }
    .card p { margin-top:8px; color:var(--muted); font-size:13px; line-height:1.45; }
    .panel { margin-top:14px; border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:18px; }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    th,td { border-bottom:1px solid var(--line); padding:12px 8px; text-align:left; vertical-align:top; }
    th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .notice { margin-top:14px; color:var(--muted); line-height:1.55; }
    @media (max-width:900px) { .app { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid var(--line); } .grid { grid-template-columns:1fr 1fr; } }
    @media (max-width:560px) { .grid { grid-template-columns:1fr; } .top { display:grid; } }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <p class="eyebrow">SAMPLAS</p>
      <h1>Instagram Marketing OS</h1>
      <div class="sync">
        <div id="instagramStatus" class="sync-row"><span class="dot"></span><div><strong>Instagram</strong><small>확인 중</small></div><em class="pill">...</em></div>
        <div id="metaStatus" class="sync-row"><span class="dot"></span><div><strong>Meta Ads</strong><small>확인 중</small></div><em class="pill">...</em></div>
        <div id="cafeStatus" class="sync-row"><span class="dot"></span><div><strong>Cafe24</strong><small>확인 중</small></div><em class="pill">...</em></div>
      </div>
    </aside>
    <main>
      <section class="top">
        <div>
          <p class="eyebrow">Monthly intelligence for @samplaskr</p>
          <h2>Instagram Dashboard</h2>
          <p class="notice">과거 월은 CSV 고정 데이터, 현재 월은 API/캐시 기준으로 표시합니다.</p>
        </div>
        <div>
          <select id="month"></select>
          <button id="reload" type="button">새로고침</button>
        </div>
      </section>
      <section id="kpis" class="grid"></section>
      <section class="panel">
        <p class="eyebrow">Meta Ads</p>
        <h3>광고 요약</h3>
        <div id="metaPanel" class="notice">확인 중</div>
      </section>
      <section class="panel">
        <p class="eyebrow">Monthly Posts</p>
        <h3>게시물 데이터</h3>
        <div id="posts"></div>
      </section>
    </main>
  </div>
  <script>
    const months = ["2026-07","2026-06","2026-05","2026-04","2026-03","2026-02","2026-01"];
    const monthSelect = document.querySelector("#month");
    monthSelect.innerHTML = months.map((month) => '<option value="' + month + '">' + month + '</option>').join("");
    document.querySelector("#reload").addEventListener("click", load);
    monthSelect.addEventListener("change", load);
    const num = (value) => Number(value || 0).toLocaleString("ko-KR");
    const krw = (value) => Math.round(Number(value || 0) / 10000).toLocaleString("ko-KR") + "만원";
    const pct = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(1) + "%" : "-";

    function setStatus(id, ok, label, detail, badge) {
      const row = document.querySelector(id);
      row.classList.toggle("good", ok);
      row.classList.toggle("bad", ok === false);
      row.querySelector("small").textContent = detail;
      row.querySelector(".pill").textContent = badge || label;
    }

    async function readJson(url) {
      const response = await fetch(url, { cache: "no-store" });
      const text = await response.text();
      try { return JSON.parse(text); }
      catch { return { error: text.slice(0, 120) }; }
    }

    function renderKpis(data) {
      const account = data.account || {};
      const cards = [
        ["팔로워", num(account.followers), "순증 +" + num(account.followerDelta)],
        ["도달", num(account.reach), "전월 대비 " + pct(account.reachDelta)],
        ["조회수", num(account.views), "전월 대비 " + pct(account.viewsDelta)],
        ["프로필 방문", num(account.profileVisits), "전월 대비 " + pct(account.profileVisitDelta)],
        ["링크 클릭", num(account.websiteClicks), "전월 대비 " + pct(account.websiteClickDelta)],
        ["상호작용", num(account.accountEngagement), data.source === "csv_import" ? "CSV 반영" : "API/캐시"],
        ["게시물", num((data.posts || []).length) + "개", "게시물별 캐시 유지"],
        ["데이터 출처", data.source || "-", data.cacheWarning ? data.cacheWarning.slice(0, 80) : "정상 표시"]
      ];
      document.querySelector("#kpis").innerHTML = cards.map(([label, value, note]) =>
        '<article class="card"><span>' + label + '</span><strong>' + value + '</strong><p>' + note + '</p></article>'
      ).join("");
    }

    function renderPosts(data) {
      const posts = (data.posts || []).slice(0, 12);
      if (!posts.length) {
        document.querySelector("#posts").innerHTML = '<p class="notice">이 월에는 게시물별 데이터가 없습니다.</p>';
        return;
      }
      document.querySelector("#posts").innerHTML = '<table><thead><tr><th>날짜</th><th>콘텐츠</th><th>도달</th><th>조회</th><th>상호작용</th></tr></thead><tbody>' +
        posts.map((post) => '<tr><td>' + (post.date || '-') + '</td><td>' + (post.title || '-') + '</td><td>' + num(post.reach) + '</td><td>' + num(post.views) + '</td><td>' + num(post.totalInteractions || post.likes + post.comments + post.saves + post.shares) + '</td></tr>').join("") +
        '</tbody></table>';
    }

    async function load() {
      const month = monthSelect.value;
      const data = await readJson('/api/instagram/monthly?month=' + month);
      setStatus("#instagramStatus", !data.error, "캐시", data.error ? data.error : (data.source === "csv_import" ? "CSV 고정 데이터 기준" : "API/캐시 기준"), data.source === "csv_import" ? "CSV" : "캐시");
      renderKpis(data.error ? { account: {}, posts: [], source: "오류" } : data);
      renderPosts(data.error ? { posts: [] } : data);

      const meta = await readJson('/api/meta-ads/summary?since=' + month + '-01&until=' + monthEnd(month));
      setStatus("#metaStatus", !meta.error, "캐시", meta.error ? meta.error : (meta.source && meta.source.includes("_cached") ? "저장된 광고 데이터 기준" : "연결 확인"), meta.source && meta.source.includes("_cached") ? "캐시" : "100%");
      document.querySelector("#metaPanel").textContent = meta.error ? meta.error : "광고비 " + krw(meta.totals && meta.totals.spend) + " / 캠페인 " + num((meta.campaigns || []).length) + "개 / 출처 " + (meta.source || "-");

      const cafe = await readJson('/api/cafe24/health');
      setStatus("#cafeStatus", cafe.ok === true || !cafe.error, "100%", cafe.message || cafe.error || "Cafe24 확인", cafe.ok === true || !cafe.error ? "100%" : "오류");
    }

    function monthEnd(month) {
      const [year, m] = month.split("-").map(Number);
      return new Date(year, m, 0).toISOString().slice(0, 10);
    }

    load();
  </script>
</body>
</html>`;
}

function html(res, text, status = 200) {
  const encoded = Buffer.from(text);
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": encoded.length
  });
  res.end(encoded);
}

async function serveFile(res, filePath) {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(outputDir) && !resolved.startsWith(root)) {
    return json(res, { error: "Forbidden" }, 403);
  }
  if (!existsSync(resolved)) {
    return json(res, { error: "Not found" }, 404);
  }
  const content = await readFile(resolved);
  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(resolved)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  res.end(content);
}

function json(res, value, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(value, null, 2));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function graphGet(path, params = {}) {
  if (!env.META_ACCESS_TOKEN) {
    throw new Error(".env에 META_ACCESS_TOKEN이 없습니다.");
  }
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", env.META_ACCESS_TOKEN);
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message || `Graph API error ${response.status}`);
    error.status = response.status;
    error.body = body;
    error.code = body.error?.code;
    error.type = body.error?.type;
    throw error;
  }
  return body;
}

async function buildInstagramMonthlyData(month) {
  const igId = env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!igId) throw new Error(".env에 INSTAGRAM_BUSINESS_ACCOUNT_ID가 없습니다.");

  const account = await graphGet(igId, {
    fields: "id,username,name,followers_count,media_count"
  });
  const accountInsights = await fetchInstagramAccountInsights(igId, month);
  const media = await fetchMedia(igId);
  const monthMedia = media.filter((item) => String(item.timestamp || "").startsWith(month));
  const posts = [];
  for (const item of monthMedia) {
    const insights = await fetchMediaInsights(item.id);
    posts.push(normalizePost(item, insights));
  }

  const result = {
    month,
    source: "instagram_graph_api",
    syncedAt: new Date().toISOString(),
    account: {
      followers: account.followers_count || 0,
      followerDelta: 0,
      reach: Number(accountInsights.reach || 0) || sum(posts, "reach"),
      reachDelta: 0,
      views: Number(accountInsights.views || 0) || sum(posts, "views"),
      viewsDelta: 0,
      profileVisits: Number(accountInsights.profile_views || 0),
      profileVisitDelta: 0,
      websiteClicks: Number(accountInsights.website_clicks || 0),
      websiteClickDelta: 0,
      accountEngagement: posts.reduce((total, post) => total + (post.totalInteractions || post.likes + post.comments + post.saves + post.shares), 0),
      growthRate: 0
    },
    previous: {},
    posts
  };

  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, `instagram-${month}.json`), JSON.stringify(result, null, 2));
  return result;
}

async function buildInstagramMonthlyDataWithCache(month, options = {}) {
  if (!isCurrentMonth(month)) {
    const cached = await readCachedInstagramMonth(month);
    if (cached) return decorateCachedSource(cached, "instagram_csv", "past_month_cache_only");
    return pastMonthCsvRequired("instagram", month, {
      month,
      account: emptyInstagramAccount(),
      previous: {},
      posts: []
    });
  }

  if (!options.refresh) {
    const cached = await readCachedInstagramMonth(month);
    if (cached && !isEmptyInstagramMonth(cached)) {
      return decorateCachedSource(cached, "instagram_graph_api", "cached_first");
    }
  }
  try {
    return await buildInstagramMonthlyData(month);
  } catch (error) {
    await logApiError("instagram_monthly", error, { month });
    const cached = await readCachedInstagramMonth(month);
    if (cached) {
      cached.source = `${cached.source || "instagram_graph_api"}_cached`;
      cached.cacheWarning = error.message;
      return cached;
    }
    throw error;
  }
}

async function readCachedInstagramMonth(month) {
  const file = join(workDir, `instagram-${month}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

function emptyInstagramAccount() {
  return {
    followers: 0,
    followerDelta: 0,
    reach: 0,
    reachDelta: 0,
    views: 0,
    viewsDelta: 0,
    profileVisits: 0,
    profileVisitDelta: 0,
    websiteClicks: 0,
    websiteClickDelta: 0,
    accountEngagement: 0,
    growthRate: 0
  };
}

function isEmptyInstagramMonth(data) {
  return !(data?.posts || []).length
    && !Number(data?.account?.reach || 0)
    && !Number(data?.account?.views || 0)
    && !Number(data?.account?.profileVisits || 0)
    && !Number(data?.account?.websiteClicks || 0);
}

async function buildInstagramStoriesDataWithCache(options = {}) {
  if (!options.refresh) {
    const cached = await readCachedStories();
    if (cached) {
      return { ...cached, source: `${cached.source || "instagram_graph_api"}_cached`, cacheMode: "cached_first" };
    }
  }
  try {
    return await buildInstagramStoriesData();
  } catch (error) {
    const cached = await readCachedStories();
    if (cached) {
      return { ...cached, source: `${cached.source || "instagram_graph_api"}_cached`, cacheWarning: error.message };
    }
    return {
      source: "disconnected",
      syncedAt: new Date().toISOString(),
      cacheWarning: error.message,
      stories: [],
      totals: emptyStoryTotals()
    };
  }
}

async function readCachedStories() {
  const file = join(workDir, "instagram-stories.json");
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

async function buildInstagramStoriesData() {
  const igId = env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!igId) throw new Error(".env에 INSTAGRAM_BUSINESS_ACCOUNT_ID가 없습니다.");
  const fields = ["id", "media_type", "media_url", "thumbnail_url", "permalink", "timestamp"].join(",");
  const body = await graphGet(`${igId}/stories`, { fields, limit: 100 });
  const activeStories = [];
  for (const item of body.data || []) {
    const insights = await fetchStoryInsights(item.id);
    activeStories.push(normalizeStory(item, insights));
  }

  const previous = await readCachedStories();
  const byId = new Map((previous?.stories || []).map((story) => [story.id, story]));
  for (const story of activeStories) byId.set(story.id, story);
  const stories = [...byId.values()].sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const result = {
    source: "instagram_graph_api",
    syncedAt: new Date().toISOString(),
    activeCount: activeStories.length,
    stories,
    totals: summarizeStories(stories)
  };
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, "instagram-stories.json"), JSON.stringify(result, null, 2));
  return result;
}

async function fetchStoryInsights(storyId) {
  const normal = await fetchInsightGroup(`${storyId}/insights`, "instagram_story_insights", { storyId }, [
    { metric: "reach,replies,taps_forward,taps_back,exits" },
    { metric: "reach,replies,exits" },
    { metric: "reach,replies" }
  ], { emptyOnNotEnoughViewers: true });
  return normal;
}

function normalizeStory(item, insights) {
  return {
    id: item.id,
    timestamp: item.timestamp || "",
    date: String(item.timestamp || "").slice(0, 10),
    time: String(item.timestamp || "").slice(11, 16),
    mediaType: item.media_type || "",
    mediaUrl: item.media_url || "",
    thumbnailUrl: item.thumbnail_url || item.media_url || "",
    permalink: item.permalink || "",
    reach: insights.reach || 0,
    replies: insights.replies || 0,
    tapsForward: insights.taps_forward || 0,
    tapsBack: insights.taps_back || 0,
    exits: insights.exits || 0,
    unavailableReason: insights.unavailableReason || ""
  };
}

function emptyStoryTotals() {
  return { count: 0, reach: 0, replies: 0, tapsForward: 0, tapsBack: 0, exits: 0, exitRate: 0, replyRate: 0 };
}

function summarizeStories(stories) {
  const totals = {
    count: stories.length,
    reach: sum(stories, "reach"),
    replies: sum(stories, "replies"),
    tapsForward: sum(stories, "tapsForward"),
    tapsBack: sum(stories, "tapsBack"),
    exits: sum(stories, "exits")
  };
  return {
    ...totals,
    exitRate: totals.reach ? (totals.exits / totals.reach) * 100 : 0,
    replyRate: totals.reach ? (totals.replies / totals.reach) * 100 : 0
  };
}

async function fetchMedia(igId) {
  const fields = [
    "id",
    "caption",
    "media_type",
    "media_product_type",
    "media_url",
    "thumbnail_url",
    "timestamp",
    "permalink",
    "like_count",
    "comments_count"
  ].join(",");
  const items = [];
  let after = "";
  for (let page = 0; page < 10; page += 1) {
    const body = await graphGet(`${igId}/media`, { fields, limit: 100, after });
    items.push(...(body.data || []));
    after = body.paging?.cursors?.after || "";
    if (!body.paging?.next || !after) break;
  }
  return items;
}

async function fetchMediaInsights(mediaId) {
  const normal = await fetchInsightGroup(`${mediaId}/insights`, "instagram_media_insights", { mediaId }, [
    { metric: "reach,saved,shares,total_interactions" },
    { metric: "reach,saved,total_interactions" },
    { metric: "reach,total_interactions" }
  ]);
  const totalValue = await fetchInsightGroup(`${mediaId}/insights`, "instagram_media_insights_total_value", { mediaId }, [
    { metric: "views", metric_type: "total_value" }
  ]);
  return { ...normal, ...totalValue };
}

async function fetchInstagramAccountInsights(igId, month) {
  const since = `${month}-01`;
  const until = monthEndKey(month);
  const reach = await fetchInsightGroup(`${igId}/insights`, "instagram_account_insights", { month }, [
    { metric: "reach", period: "day", since, until }
  ], { sumSeries: true });
  const totals = await fetchInsightGroup(`${igId}/insights`, "instagram_account_insights_total_value", { month }, [
    { metric: "profile_views,website_clicks,views", metric_type: "total_value", period: "day", since, until },
    { metric: "profile_views,website_clicks", metric_type: "total_value", period: "day", since, until },
    { metric: "views", metric_type: "total_value", period: "day", since, until }
  ], { sumSeries: true });
  return { ...reach, ...totals };
}

async function fetchInsightGroup(path, source, context, attempts, options = {}) {
  for (const params of attempts) {
    try {
      const body = await graphGet(path, params);
      return options.sumSeries ? sumInsightSeries(body.data || []) : parseInsights(body.data || []);
    } catch (error) {
      if (options.emptyOnNotEnoughViewers && isNotEnoughViewersError(error)) {
        return { unavailableReason: safeErrorMessage(error) };
      }
      await logApiError(source, error, { ...context, params });
      if (params === attempts.at(-1)) return { unavailableReason: safeErrorMessage(error) };
    }
  }
  return {};
}

function isNotEnoughViewersError(error) {
  return safeErrorMessage(error).toLowerCase().includes("not enough viewers");
}

function parseInsights(items) {
  const result = {};
  for (const item of items) {
    const value = item.total_value?.value ?? item.values?.[0]?.value;
    result[item.name] = typeof value === "number" ? value : Number(value || 0);
  }
  return result;
}

function sumInsightSeries(items) {
  const result = {};
  for (const item of items) {
    if (item.total_value && Object.prototype.hasOwnProperty.call(item.total_value, "value")) {
      result[item.name] = Number(item.total_value.value || 0);
    } else {
      result[item.name] = (item.values || []).reduce((total, value) => total + Number(value.value || 0), 0);
    }
  }
  return result;
}

function normalizePost(item, insights) {
  const caption = item.caption || "";
  const title = caption.split(/\r?\n/).find(Boolean)?.slice(0, 64) || "Untitled content";
  const type = contentType(item);
  const tag = classifyTag(item, caption);
  return {
    id: item.id,
    date: String(item.timestamp || "").slice(0, 10),
    title,
    type,
    tag,
    objective: objectiveFor(tag, type),
    caption,
    permalink: item.permalink,
    mediaUrl: item.media_url || "",
    thumbnailUrl: item.thumbnail_url || item.media_url || "",
    reach: insights.reach || 0,
    views: insights.views || 0,
    likes: item.like_count || 0,
    comments: item.comments_count || 0,
    saves: insights.saved || 0,
    shares: insights.shares || 0,
    totalInteractions: insights.total_interactions || 0,
    plays: item.media_product_type === "REELS" ? insights.views || 0 : 0,
    profileVisits: 0,
    follows: 0,
    websiteClicks: 0,
    adSpend: 0,
    cafe24Sales1d: 0,
    cafe24Sales3d: 0,
    cafe24Sales7d: 0,
    salesLift7d: 0,
    unavailableReason: insights.unavailableReason
  };
}

function contentType(item) {
  if (item.media_product_type === "REELS") return "릴스";
  if (item.media_type === "CAROUSEL_ALBUM") return "카드뉴스";
  if (item.media_type === "VIDEO") return "릴스";
  return "피드";
}

function classifyTag(item, caption) {
  const text = caption.toLowerCase();
  if (item.media_product_type === "REELS") return "Reels";
  if (text.includes("sale") || text.includes("세일")) return "Event / Sale";
  if (text.includes("lookbook") || text.includes("룩북")) return "Lookbook";
  if (text.includes("new brand") || text.includes("새로운 브랜드")) return "Brand Discovery";
  if (text.includes("release") || text.includes("released") || text.includes("입고")) return "Product Focus";
  if (item.media_type === "CAROUSEL_ALBUM") return "Editorial Cardnews";
  return "Archive / Culture";
}

function objectiveFor(tag, type) {
  if (tag === "Product Focus") return "제품 발견/사이트 유입";
  if (tag === "Event / Sale") return "단기 도달/구매 전환";
  if (tag === "Reels" || type === "릴스") return "도달/신규 유입";
  if (tag === "Lookbook") return "브랜드 무드/저장";
  return "저장/공유/팔로우 증가";
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function monthEndKey(month) {
  const [year, m] = String(month).split("-").map(Number);
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.REPORT_TIMEZONE || "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function monthFromDate(dateText) {
  return String(dateText || "").slice(0, 7);
}

function isCurrentMonth(month) {
  return month === currentMonth();
}

function decorateCachedSource(cached, fallbackSource, cacheMode) {
  return {
    ...cached,
    source: cached.source?.endsWith("_cached") ? cached.source : `${cached.source || fallbackSource}_cached`,
    cacheMode
  };
}

function pastMonthCsvRequired(kind, month, extra = {}) {
  return {
    ...extra,
    source: "csv_required",
    cacheMode: "past_month_cache_only",
    month,
    message: `${month}은 지난 달 데이터라 API를 호출하지 않습니다. CSV를 업로드하면 이 위치에 고정됩니다.`,
    apiPolicy: {
      kind,
      currentMonth: currentMonth(),
      pastMonths: "csv_or_saved_cache_only",
      currentMonthApi: true
    }
  };
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.REPORT_TIMEZONE || "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
