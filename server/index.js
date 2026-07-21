/**
 * Baseline API — live Magento sync (OAuth 1.0a) + AI proxy.
 * Real catalog, stock and sales when OAuth creds are set; AI via OpenRouter.
 * All secrets live server-side only.
 */
import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();

// CORS: allow the dashboard (any *.onrender.com incl. PR previews), localhost dev,
// and non-browser callers (no Origin header → GitHub Actions snapshot, keepalive,
// curl). Other browser origins get no CORS grant, so a random site can't read our
// responses or drive the AI proxy from a victim's browser.
const ALLOW_ORIGIN = [/^https?:\/\/([a-z0-9-]+\.)?onrender\.com$/i, /^http:\/\/localhost(:\d+)?$/i, /^http:\/\/127\.0\.0\.1(:\d+)?$/i];
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOW_ORIGIN.some((re) => re.test(origin))) }));
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", true); // Render runs behind a proxy; trust X-Forwarded-For for the client IP

// Lightweight in-memory per-IP rate limiter for the expensive endpoints: the AI
// proxy spends OpenRouter credits, and sync/refreshdead are heavy Magento pulls.
const _rl = new Map();
function rateLimit(windowMs, max) {
  return (req, res, next) => {
    const ip = String(req.headers["x-forwarded-for"] || req.ip || req.socket.remoteAddress || "?").split(",")[0].trim();
    const now = Date.now();
    const hits = (_rl.get(ip) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) return res.status(429).json({ error: "rate limited", retryAfterMs: windowMs - (now - hits[0]) });
    hits.push(now); _rl.set(ip, hits);
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [ip, ts] of _rl) { const keep = ts.filter((t) => now - t < 3600000); keep.length ? _rl.set(ip, keep) : _rl.delete(ip); } }, 3600000).unref?.();

// Full Magento synchronizations are administrative operations. Fail closed unless
// Render has a SYNC_SECRET and the caller presents it in x-sync-secret (or ?key=).
const SYNC_SECRET = process.env.SYNC_SECRET || "";
const safeEq = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
function requireSecret(req, res, next) {
  if (!SYNC_SECRET) return res.status(503).json({ error: "sync endpoint disabled" });
  const k = req.headers["x-sync-secret"] || req.query.key;
  if (k && safeEq(k, SYNC_SECRET)) return next();
  return res.status(401).json({ error: "unauthorized" });
}

const PORT = process.env.PORT || 4000;
const OR_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const MG_BASE = process.env.MAGENTO_BASE_URL || "https://console.tennisoutlet.in";
const MG_PREFIX = "/rest/V1";
const requestedSyncMs = Number(process.env.SYNC_INTERVAL_MS || 6 * 3600 * 1000);
const SYNC_MS = Number.isFinite(requestedSyncMs)
  ? Math.max(6 * 3600 * 1000, requestedSyncMs)
  : 6 * 3600 * 1000;

// OAuth 1.0a
const CK = process.env.MAGENTO_CONSUMER_KEY;
const CS = process.env.MAGENTO_CONSUMER_SECRET;
const AT = process.env.MAGENTO_ACCESS_TOKEN;          // OAuth access token
const ATS = process.env.MAGENTO_ACCESS_TOKEN_SECRET;
const OAUTH = !!(CK && CS && AT && ATS);

const enc = (s) => encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
// Serialize every Magento request through one bounded queue. The previous 150ms
// delay allowed ~6 requests/second and concurrent callers could bypass it; Magento
// product/EAV queries are too expensive for that cadence on the shared origin.
const configuredMagentoIntervalMs = Number(process.env.MAGENTO_MIN_INTERVAL_MS || 3000);
const MAGENTO_MIN_INTERVAL_MS = Number.isFinite(configuredMagentoIntervalMs)
  ? Math.max(1000, configuredMagentoIntervalMs)
  : 3000;
const configuredMagentoTimeoutMs = Number(process.env.MAGENTO_TIMEOUT_MS || 60000);
const MAGENTO_TIMEOUT_MS = Number.isFinite(configuredMagentoTimeoutMs)
  ? Math.max(10000, configuredMagentoTimeoutMs)
  : 60000;
let _mgLast = 0;
let _mgQueue = Promise.resolve();

async function mg(path, params = {}) {
  const task = _mgQueue.then(async () => {
    const waitMs = Math.max(0, _mgLast + MAGENTO_MIN_INTERVAL_MS - Date.now());
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    _mgLast = Date.now();

    const url = MG_BASE + MG_PREFIX + path;
    const oauth = {
      oauth_consumer_key: CK, oauth_token: AT, oauth_signature_method: "HMAC-SHA256",
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_version: "1.0",
    };
    const all = { ...params, ...oauth };
    const paramStr = Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join("&");
    const base = ["GET", enc(url), enc(paramStr)].join("&");
    oauth.oauth_signature = crypto.createHmac("sha256", `${enc(CS)}&${enc(ATS)}`).update(base).digest("base64");
    const auth = "OAuth " + Object.keys(oauth).map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(", ");
    const qs = Object.keys(params).map((k) => `${enc(k)}=${enc(params[k])}`).join("&");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAGENTO_TIMEOUT_MS);
    try {
      const response = await fetch(url + (qs ? "?" + qs : ""), {
        headers: {
          Authorization: auth,
          Accept: "application/json",
          "User-Agent": "baseline-inventory/1.1",
          "X-Client-ID": "baseline-inventory",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.body = await response.text();
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  });

  _mgQueue = task.catch(() => {});
  return task;
}
const hmod = (s, salt, m) => parseInt(crypto.createHash("md5").update(s + salt).digest("hex").slice(0, 8), 16) % m;

const CAT_IDS = { 25: "Racquets", 29: "Strings", 31: "Balls", 24: "Shoes", 115: "Bags", 128: "Grips", 36: "Apparel", 37: "Accessories" };
const WMAP = { 1: "tennisoutlet", 2: "pickleballoutlet", 3: "padeloutlet", 4: "syxxsports", 5: "badmintonoutlet", 6: "squashoutlet" };
const STORE_BY_ID = { 1: "tennisoutlet", 3: "pickleballoutlet", 4: "padeloutlet", 5: "syxxsports", 6: "badmintonoutlet", 7: "squashoutlet" }; // order store_id -> sport site (real)
const LEAD = { Babolat: 10, Wilson: 14, YONEX: 21, Head: 18, Nike: 16, Adidas: 22, ASICS: 20, Solinco: 7, Luxilon: 14, Dunlop: 15, Tecnifibre: 16, Prince: 18, Slazenger: 15, Tourna: 10 };
const CAT_BASE = { Balls: 3.0, Strings: 1.3, Grips: 2.4, Accessories: 1.1, Apparel: 0.8, Bags: 0.45, Shoes: 0.6, Racquets: 0.7 };

let brandMap = {};
async function loadBrands() { try { const o = await mg("/products/attributes/brands/options"); brandMap = Object.fromEntries(o.filter((x) => x.value).map((x) => [String(x.value), x.label])); } catch { } }

function modelOps(sku, category, price) {
  const cost = Math.round(price * (0.55 + hmod(sku, "c", 16) / 100));
  const base = CAT_BASE[category] || 1;
  let avgDaily = +(base * (0.35 + hmod(sku, "v", 150) / 100)).toFixed(2);
  let daysSinceSale = hmod(sku, "dead", 100) < 12 ? 95 + hmod(sku, "dd", 120) : hmod(sku, "r", 7);
  if (daysSinceSale >= 90) avgDaily = 0;
  return { unitCost: cost, avgDaily, daysSinceSale, age: 20 + hmod(sku, "a", 160), onHand: 2 + hmod(sku, "o", 55), inTransit: hmod(sku, "t", 5) ? 0 : hmod(sku, "tq", 10), accuracy: +(0.86 + hmod(sku, "acc", 12) / 100).toFixed(2) };
}

const state = { lastSync: null, catalogLive: false, salesLive: false, stockLive: false, ordersLive: false, totalProducts: 0, skus: [], sales: null, topSellers: {}, soldSet100: {}, soldSet100At: 0, errors: {}, auth: OAUTH ? "oauth" : "none" };

async function syncCatalog() {
  if (!OAUTH) { state.errors.catalog = "Magento OAuth creds not set"; return; }
  await loadBrands();
  const out = []; const seen = new Set();
  for (const [cid, bucket] of Object.entries(CAT_IDS)) {
    try {
      let page = 1, got = 0;
      while (page <= 120) { // pageSize 50 lowers per-query EAV pressure; loop still breaks at total_count
        const data = await mg("/products", {
          "searchCriteria[filterGroups][0][filters][0][field]": "category_id",
          "searchCriteria[filterGroups][0][filters][0][value]": cid,
          "searchCriteria[filterGroups][0][filters][0][conditionType]": "eq",
          "searchCriteria[pageSize]": "50", "searchCriteria[currentPage]": String(page),
          fields: "total_count,items[sku,name,price,status,type_id,extension_attributes[website_ids],custom_attributes[attribute_code,value]]",
        });
        const tc = data.total_count || 0;
        for (const p of data.items || []) {
          if (!p.sku || seen.has(p.sku) || p.type_id !== "simple" || p.status !== 1) continue;
          const price = Number(p.price || 0); if (price <= 0) continue;
          seen.add(p.sku);
          const ca = Object.fromEntries((p.custom_attributes || []).map((a) => [a.attribute_code, a.value]));
          let sp = Number(ca.special_price); sp = sp && sp > 0 && sp < price ? sp : null;
          const sale = sp || price;
          const brand = brandMap[String(ca.brands)] || "House / Other";
          const wsites = (p.extension_attributes?.website_ids || []).map((w) => WMAP[w]).filter(Boolean);
          out.push({ sku: p.sku, name: p.name, category: bucket, brand, mrp: Math.round(price), price: Math.round(sale), discount: sale < price ? Math.round((1 - sale / price) * 100) : 0, wsites: wsites.length ? wsites : ["tennisoutlet"], leadTime: LEAD[brand] || 14, ...modelOps(p.sku, bucket, Math.round(sale)) });
        }
        got += (data.items || []).length;
        if (got >= tc || !(data.items || []).length) break; page++;
      }
    } catch (e) { state.errors.catalog = `cat ${cid}: ${e.status || e.message}`; }
  }
  if (out.length) { state.skus = out; state.catalogLive = true; delete state.errors.catalog; }
  try { const t = await mg("/products", { "searchCriteria[pageSize]": "1", fields: "total_count" }); state.totalProducts = t.total_count || out.length; } catch { }
}

async function syncStock() {
  try {
    const map = {}; let page = 1;
    while (page <= 200) { // page through ALL source-items (loop breaks at total_count); old cap of 18 truncated stock
      const d = await mg("/inventory/source-items", { "searchCriteria[pageSize]": "200", "searchCriteria[currentPage]": String(page) });
      for (const it of d.items || []) map[it.sku] = (map[it.sku] || 0) + Number(it.quantity || 0);
      const tc = d.total_count || 0; if (page * 200 >= tc || !(d.items || []).length) break; page++;
    }
    let applied = 0;
    for (const s of state.skus) { if (map[s.sku] != null) { s.onHand = Math.round(map[s.sku]); applied++; } }
    state.stockLive = applied > 0; delete state.errors.stock;
    // (3) only keep products that are actually in stock (on-hand >= 1)
    state.skus = state.skus.filter((s) => s.onHand >= 1);
    // (2) flag dead = no movement in 100+ days, from the cached 100-day sold set
    const set = state.soldSet100, ready = set && Object.keys(set).length > 0;
    for (const s of state.skus) s.soldWithin100 = ready ? !!set[s.sku] : true;
  } catch (e) { state.stockLive = false; state.errors.stock = `${e.status || e.message}`; }
}
// 100-day "has it sold?" set — real dead-stock signal. This is a heavy historical
// crawl and is intentionally manual-only; run it during a maintenance window.
async function refreshDeadSet(force = false) {
  if (!force && state.soldSet100At && Date.now() - state.soldSet100At < 24 * 3600 * 1000) return;
  try {
    const since = istDayStartUTC(100); const set = {}; let page = 1, seen = 0;
    while (page <= 200) { // newest-first + server-side 100d filter → page through ALL in-window orders (breaks at total_count). The old cap+no-sort dropped the most RECENT orders, falsely flagging live SKUs as dead.
      const d = await mg("/orders", { "searchCriteria[filterGroups][0][filters][0][field]": "created_at", "searchCriteria[filterGroups][0][filters][0][value]": since, "searchCriteria[filterGroups][0][filters][0][conditionType]": "gteq", "sortOrders[0][field]": "created_at", "sortOrders[0][direction]": "DESC", "searchCriteria[pageSize]": "100", "searchCriteria[currentPage]": String(page), fields: "total_count,items[status,items[sku]]" });
      for (const o of d.items || []) { if (o.status === "canceled") continue; for (const it of o.items || []) if (it.sku) set[it.sku] = 1; }
      seen += (d.items || []).length; const tc = d.total_count || 0; if (seen >= tc || !(d.items || []).length) break; page++;
    }
    if (Object.keys(set).length) { state.soldSet100 = set; state.soldSet100At = Date.now(); for (const s of state.skus) s.soldWithin100 = !!set[s.sku]; delete state.errors.dead; }
  } catch (e) { state.errors.dead = String(e.status || e.message); }
}

// Magento store timezone is Asia/Kolkata (UTC+5:30); "today" must use the IST calendar day.
const IST = 5.5 * 3600 * 1000;
function istDayStartUTC(daysAgo = 0) { const t = new Date(Date.now() + IST); t.setUTCDate(t.getUTCDate() - daysAgo); t.setUTCHours(0, 0, 0, 0); return new Date(t.getTime() - IST).toISOString().slice(0, 19).replace("T", " "); }
// (calendar month-to-date helper removed — "month" is now a trailing 30-day window; see syncSales)
// Sales = realized (invoiced) revenue, matching Magento's "today's sale" figure.
async function sumOrders(since, cap = 30) {
  let invoiced = 0, gross = 0, orders = 0, page = 1, seen = 0; const byStore = {};
  while (page <= cap) {
    const d = await mg("/orders", { "searchCriteria[filterGroups][0][filters][0][field]": "created_at", "searchCriteria[filterGroups][0][filters][0][value]": since, "searchCriteria[filterGroups][0][filters][0][conditionType]": "gteq", "sortOrders[0][field]": "created_at", "sortOrders[0][direction]": "DESC", "searchCriteria[pageSize]": "100", "searchCriteria[currentPage]": String(page), fields: "total_count,items[grand_total,total_invoiced,status,store_id]" });
    const tc = d.total_count || 0;
    for (const o of d.items || []) { if (o.status === "canceled") continue; const v = Number(o.total_invoiced || 0); invoiced += v; gross += Number(o.grand_total || 0); orders++; const code = STORE_BY_ID[o.store_id]; if (code) byStore[code] = (byStore[code] || 0) + v; }
    seen += (d.items || []).length; if (seen >= tc || !(d.items || []).length) break; page++;
  }
  return { revenue: Math.round(invoiced), gross: Math.round(gross), orders, byStore };
}
async function syncSales() {
  try {
    const today = await sumOrders(istDayStartUTC(0), 30);
    const week = await sumOrders(istDayStartUTC(7), 30);
    // "month" = trailing 30 days. Matches the 30-day window used everywhere else in
    // the app (top-sellers, forecasts) and guarantees month >= week, instead of
    // comparing a few days of month-to-date against a full trailing 7-day span.
    const month = await sumOrders(istDayStartUTC(30), 60);
    const roundStores = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    state.sales = { today: today.revenue, todayOrders: today.orders, todayGross: today.gross, week: week.revenue, month: month.revenue, currency: "INR",
      byStoreToday: roundStores(today.byStore), byStoreMonth: roundStores(month.byStore) };
    state.salesLive = true; delete state.errors.sales;
  } catch (e) { state.salesLive = false; state.errors.sales = `${e.status || e.message}`; }
}

// Real per-SKU sales aggregated per period via the server-side created_at filter
// (avoids the Magento quirk where order-level created_at is dropped when nested items are requested).
async function aggPeriod(since, cap) {
  const bySku = {}; let page = 1, seen = 0;
  while (page <= cap) {
    const d = await mg("/orders", { "searchCriteria[filterGroups][0][filters][0][field]": "created_at", "searchCriteria[filterGroups][0][filters][0][value]": since, "searchCriteria[filterGroups][0][filters][0][conditionType]": "gteq", "sortOrders[0][field]": "created_at", "sortOrders[0][direction]": "DESC", "searchCriteria[pageSize]": "100", "searchCriteria[currentPage]": String(page), fields: "total_count,items[status,items[sku,name,qty_invoiced,qty_ordered,row_total]]" });
    const tc = d.total_count || 0;
    for (const o of d.items || []) {
      if (o.status === "canceled") continue;
      for (const it of o.items || []) {
        if (!it.sku) continue;
        const q = Number(it.qty_invoiced || it.qty_ordered || 0), rev = Number(it.row_total || 0);
        const e = bySku[it.sku] || (bySku[it.sku] = { sku: it.sku, name: it.name, u: 0, r: 0 });
        e.u += q; e.r += rev;
      }
    }
    seen += (d.items || []).length; if (seen >= tc || !(d.items || []).length) break; page++;
  }
  return bySku;
}
const topOf = (agg) => Object.values(agg).filter((x) => x.r > 0).sort((a, b) => b.r - a.r).slice(0, 12).map((x) => ({ sku: x.sku, name: x.name, units: Math.round(x.u), revenue: Math.round(x.r) }));
async function syncOrders() {
  try {
    const l30 = await aggPeriod(istDayStartUTC(30), 60);
    const wk = await aggPeriod(istDayStartUTC(7), 30);
    const td = await aggPeriod(istDayStartUTC(0), 30);
    for (const s of state.skus) { const a = l30[s.sku]; if (a) { s.avgDaily = +(a.u / 30).toFixed(2); s.daysSinceSale = wk[s.sku] ? 2 : 20; } else { s.avgDaily = 0; s.daysSinceSale = 999; } }
    state.topSellers = { today: topOf(td), week: topOf(wk), month: topOf(l30), all: topOf(l30) };
    state.ordersLive = true; delete state.errors.orders;
  } catch (e) { state.ordersLive = false; state.errors.orders = String(e.status || e.message); }
}
let syncing = false;
async function runSync() {
  if (syncing) return; syncing = true;
  try { await syncCatalog(); await syncSales(); await syncOrders(); await syncStock(); state.lastSync = new Date().toISOString(); }
  finally { syncing = false; }
}
const stale = () => !state.lastSync || Date.now() - new Date(state.lastSync).getTime() > SYNC_MS;

app.get("/", (_q, res) => res.json({ ok: true, service: "baseline-api", auth: state.auth, lastSync: state.lastSync, catalogLive: state.catalogLive, salesLive: state.salesLive, stockLive: state.stockLive }));
// All GET routes are cache-only. A dashboard read or health probe must never start
// a full Magento crawl.
app.get("/api/health", (_q, res) => res.json({ ok: true, model: MODEL, auth: state.auth, syncing, syncIntervalMs: SYNC_MS, magentoMinIntervalMs: MAGENTO_MIN_INTERVAL_MS, lastSync: state.lastSync, catalogLive: state.catalogLive, salesLive: state.salesLive, stockLive: state.stockLive, ordersLive: state.ordersLive, totalProducts: state.totalProducts, count: state.skus.length, deadSet: Object.keys(state.soldSet100).length, sales: state.sales, topSellers: { today: (state.topSellers.today || []).slice(0, 3) }, errors: state.errors }));
app.get("/api/catalog", (_q, res) => res.json({ source: { catalog: state.catalogLive ? "live" : "unavailable", stock: state.stockLive ? "live" : "modeled", sales: state.salesLive ? "live" : "modeled", velocity: state.ordersLive ? "live" : "modeled" }, lastSync: state.lastSync, totalProducts: state.totalProducts, count: state.skus.length, skus: state.skus }));
app.get("/api/topsellers", (_q, res) => res.json({ available: state.ordersLive, lastSync: state.lastSync, ...state.topSellers }));
app.get("/api/sales", (_q, res) => { state.salesLive ? res.json({ available: true, ...state.sales, lastSync: state.lastSync }) : res.json({ available: false, reason: state.errors.sales || "not synced" }); });
app.post("/api/sync", rateLimit(3600000, 2), requireSecret, async (_q, res) => { await runSync(); res.json({ ok: true, lastSync: state.lastSync, count: state.skus.length, salesLive: state.salesLive, stockLive: state.stockLive, sales: state.sales }); });
app.post("/api/refreshdead", rateLimit(3600000, 10), requireSecret, async (_q, res) => { await refreshDeadSet(true); const n = Object.keys(state.soldSet100).length; for (const s of state.skus) s.soldWithin100 = n ? !!state.soldSet100[s.sku] : true; res.json({ deadSet: n, dead: state.skus.filter((s) => s.soldWithin100 === false).length }); });

app.post("/api/chat", rateLimit(600000, 30), async (req, res) => {
  if (!OR_KEY) return res.status(500).json({ error: "OPENROUTER_API_KEY not set" });
  const { question, context = {}, role = "exec", history = [] } = req.body || {};
  if (!question) return res.status(400).json({ error: "question required" });
  const live = state.salesLive ? `LIVE sales from Magento: today ₹${state.sales?.today}, this week ₹${state.sales?.week}, this month ₹${state.sales?.month}.` : "Sales are modeled.";
  const sys = ["You are Baseline AI for Tennis Outlet (6 stores, INR ₹).", `Answer for the ${role} view. Ground ONLY in DATA. Concise (2-5 sentences), ₹, round numbers.`, live, "DATA:\n" + JSON.stringify(context).slice(0, 12000)].join("\n");
  const messages = [{ role: "system", content: sys }, ...history.slice(-6).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.text || "").slice(0, 1500) })), { role: "user", content: String(question).slice(0, 2000) }];
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${OR_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "https://baseline-dashboard.onrender.com", "X-Title": "Baseline - Tennis Outlet" }, body: JSON.stringify({ model: MODEL, messages, max_tokens: 600, temperature: 0.3 }) });
    if (!r.ok) return res.status(502).json({ error: "LLM upstream", status: r.status });
    const d = await r.json();
    res.json({ answer: d?.choices?.[0]?.message?.content?.trim() || "(no answer)", model: d?.model || MODEL });
  } catch (e) { res.status(500).json({ error: "proxy failure", detail: String(e).slice(0, 200) }); }
});

app.listen(PORT, () => {
  console.log(`baseline-api on :${PORT} · auth ${state.auth} · model ${MODEL}`);

  // Keep startup healthy first, then begin one slow background synchronization.
  // Jitter prevents deploys/restarts from lining up with the chatbot refresh jobs.
  const configuredStartupDelayMs = Number(process.env.STARTUP_SYNC_DELAY_MS);
  const startupDelayMs = Number.isFinite(configuredStartupDelayMs) && configuredStartupDelayMs >= 0
    ? configuredStartupDelayMs
    : 60_000 + Math.floor(Math.random() * 120_000);
  const startupTimer = setTimeout(() => {
    runSync()
      .then(() => console.log(`sync: ${state.skus.length} SKUs in stock`))
      .catch((error) => console.error("sync err", error.message));
  }, startupDelayMs);
  startupTimer.unref?.();

  const syncJitterMs = Math.floor(Math.random() * 15 * 60 * 1000);
  const scheduledSyncTimer = setTimeout(() => {
    runSync().catch(() => {});
    const recurringSyncTimer = setInterval(() => runSync().catch(() => {}), SYNC_MS);
    recurringSyncTimer.unref?.();
  }, SYNC_MS + syncJitterMs);
  scheduledSyncTimer.unref?.();

});
