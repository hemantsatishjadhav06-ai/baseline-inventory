/**
 * magentoClient.js — read-only Magento REST client for Baseline.
 *
 * Pulls products, stock, and orders from the Tennis Outlet store.
 * Auth: Bearer integration token, supplied ONLY via env (never hardcoded).
 * Safe by design: this module performs GETs only.
 *
 * Node 18+ (global fetch). No external deps.
 */

const BASE = process.env.MAGENTO_BASE_URL;            // https://console.tennisoutlet.in
const PREFIX = process.env.MAGENTO_API_PREFIX || "/rest/V1";
const TOKEN = process.env.MAGENTO_ACCESS_TOKEN;       // secret
const STOCK_ID = process.env.MAGENTO_STOCK_ID || "1";
const RPS = Number(process.env.MAGENTO_RATE_LIMIT_RPS || 4);
const PAGE_SIZE = Number(process.env.MAGENTO_PAGE_SIZE || 100);

if (!BASE) throw new Error("MAGENTO_BASE_URL is not set");
if (!TOKEN) throw new Error("MAGENTO_ACCESS_TOKEN is not set (load from secret store)");

/* ---- simple token-bucket rate limiter ---- */
let lastCall = 0;
const minGap = 1000 / RPS;
async function throttle() {
  const wait = Math.max(0, lastCall + minGap - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/* ---- core GET with retry/backoff ---- */
async function get(path, { retries = 4 } = {}) {
  const url = `${BASE}${PREFIX}${path}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
      });
    } catch (err) {
      if (attempt === retries) throw err;
      await backoff(attempt);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      // Do not retry auth failures — token likely rotated/expired.
      const e = new Error(`Magento auth error ${res.status}: token rejected`);
      e.code = "AUTH";
      throw e;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === retries) throw new Error(`Magento ${res.status} after ${retries} retries`);
      await backoff(attempt, res.headers.get("retry-after"));
      continue;
    }
    if (!res.ok) throw new Error(`Magento ${res.status}: ${await res.text()}`);
    return res.json();
  }
}
function backoff(attempt, retryAfter) {
  const base = retryAfter ? Number(retryAfter) * 1000 : Math.min(30000, 2 ** attempt * 500);
  const jitter = Math.random() * 300;
  return new Promise((r) => setTimeout(r, base + jitter));
}

/* ---- searchCriteria helper ---- */
function sc(params = {}) {
  const q = new URLSearchParams();
  q.set("searchCriteria[pageSize]", String(params.pageSize || PAGE_SIZE));
  q.set("searchCriteria[currentPage]", String(params.currentPage || 1));
  (params.filters || []).forEach((f, gi) => {
    q.set(`searchCriteria[filterGroups][${gi}][filters][0][field]`, f.field);
    q.set(`searchCriteria[filterGroups][${gi}][filters][0][value]`, f.value);
    q.set(`searchCriteria[filterGroups][${gi}][filters][0][conditionType]`, f.condition || "eq");
  });
  return q.toString();
}

/* ============================ PUBLIC API ============================ */

/** Paginate any searchCriteria endpoint, yielding all items. */
async function* paginate(basePath, { filters } = {}) {
  let page = 1, total = Infinity, seen = 0;
  while (seen < total) {
    const data = await get(`${basePath}?${sc({ currentPage: page, filters })}`);
    total = data.total_count ?? (data.items?.length || 0);
    for (const item of data.items || []) yield item;
    seen += data.items?.length || 0;
    if (!data.items?.length) break;
    page++;
  }
}

/** All catalog products (normalized to Baseline shape). */
async function fetchProducts() {
  const out = [];
  for await (const p of paginate("/products")) {
    const attr = Object.fromEntries((p.custom_attributes || []).map((a) => [a.attribute_code, a.value]));
    out.push({
      sku: p.sku,
      name: p.name,
      price: Number(p.price || 0),
      magentoId: p.id,
      category: attr.category_name || attr.tennis_category || null,
      supplier: attr.supplier || attr.manufacturer || null,   // map via attribute or Baseline supplier table
      unitCost: Number(attr.cost || 0),
    });
  }
  return out;
}

/** On-hand stock for a SKU. */
async function fetchStockItem(sku) {
  const s = await get(`/stockItems/${encodeURIComponent(sku)}`);
  return { sku, onHand: Number(s.qty || 0), isInStock: !!s.is_in_stock, minQty: Number(s.min_qty || 0) };
}

/** MSI salable quantity (use when Multi-Source Inventory is on). */
async function fetchSalableQty(sku) {
  const qty = await get(`/inventory/get-product-salable-quantity/${encodeURIComponent(sku)}/${STOCK_ID}`);
  return { sku, salable: Number(qty) };
}

/** Orders created on/after `sinceIso` — drives sell-through. */
async function fetchOrdersSince(sinceIso) {
  const lines = [];
  for await (const o of paginate("/orders", {
    filters: [{ field: "created_at", value: sinceIso, condition: "gteq" }],
  })) {
    for (const it of o.items || []) {
      lines.push({
        sku: it.sku,
        qty: Number(it.qty_ordered || 0),
        revenue: Number(it.row_total_incl_tax || it.row_total || 0),
        date: (o.created_at || "").slice(0, 10),
      });
    }
  }
  return lines;
}

/** Categories for the BI layer. */
async function fetchCategories() {
  const root = await get("/categories");
  const flat = [];
  (function walk(node) {
    if (!node) return;
    if (node.id) flat.push({ id: node.id, name: node.name });
    (node.children_data || []).forEach(walk);
  })(root);
  return flat;
}

/** Connectivity / auth probe — call on startup and from /sync/status. */
async function ping() {
  try {
    await get(`/products?${sc({ pageSize: 1 })}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code || "ERR", message: e.message };
  }
}

module.exports = {
  fetchProducts, fetchStockItem, fetchSalableQty,
  fetchOrdersSince, fetchCategories, ping, paginate,
};
