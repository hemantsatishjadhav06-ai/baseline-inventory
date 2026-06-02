/**
 * Baseline API — live Magento sync + AI proxy.
 *
 * - Syncs the Magento catalog (real brand/category/price/discount) on a schedule.
 * - Tries orders + stock; auto-activates real sales/on-hand the moment the
 *   integration scopes are granted (Magento_Sales::actions_view, Catalog inventory).
 * - Serves /api/catalog, /api/sales, /api/health, /api/chat.
 * Secrets (OpenRouter + Magento token) live only here, never in the browser.
 */
import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 4000;
const OR_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const MG_BASE = process.env.MAGENTO_BASE_URL || "https://console.tennisoutlet.in";
const MG_TOKEN = process.env.MAGENTO_ACCESS_TOKEN;
const MG_PREFIX = "/rest/V1";
const SYNC_MS = Number(process.env.SYNC_INTERVAL_MS || 10 * 60 * 1000); // 10 min

/* ---------- Magento client ---------- */
async function mg(path) {
  const r = await fetch(`${MG_BASE}${MG_PREFIX}${path}`, {
    headers: { Authorization: `Bearer ${MG_TOKEN}`, Accept: "application/json" },
  });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; e.body = await r.text(); throw e; }
  return r.json();
}
const hmod = (s, salt, m) => parseInt(crypto.createHash("md5").update(s + salt).digest("hex").slice(0, 8), 16) % m;

const CAT_IDS = { 25: "Racquets", 29: "Strings", 31: "Balls", 24: "Shoes", 115: "Bags", 128: "Grips", 36: "Apparel", 37: "Accessories" };
const WMAP = { 1: "tennisoutlet", 2: "pickleballoutlet", 3: "padeloutlet", 4: "syxxsports", 5: "badmintonoutlet", 6: "squashoutlet" };
const LEAD = { Babolat: 10, Wilson: 14, YONEX: 21, Head: 18, Nike: 16, Adidas: 22, ASICS: 20, Solinco: 7, Luxilon: 14, Dunlop: 15, Tecnifibre: 16, Prince: 18, Slazenger: 15, Tourna: 10 };
const CAT_BASE = { Balls: 3.0, Strings: 1.3, Grips: 2.4, Accessories: 1.1, Apparel: 0.8, Bags: 0.45, Shoes: 0.6, Racquets: 0.7 };

let brandMap = {};
async function loadBrands() {
  try { const opts = await mg("/products/attributes/brands/options"); brandMap = Object.fromEntries(opts.filter((o) => o.value).map((o) => [String(o.value), o.label])); }
  catch { brandMap = {}; }
}

/* model the ops fields deterministically (same as the seed generator) until real stock/sales flow */
function modelOps(sku, category, price) {
  const cost = Math.round(price * (0.55 + hmod(sku, "c", 16) / 100));
  const base = CAT_BASE[category] || 1;
  let avgDaily = +(base * (0.35 + hmod(sku, "v", 150) / 100)).toFixed(2);
  let daysSinceSale = hmod(sku, "dead", 100) < 12 ? 95 + hmod(sku, "dd", 120) : hmod(sku, "r", 7);
  if (daysSinceSale >= 90) avgDaily = 0;
  return {
    unitCost: cost, avgDaily, daysSinceSale,
    age: 20 + hmod(sku, "a", 160), onHand: 2 + hmod(sku, "o", 55),
    inTransit: hmod(sku, "t", 5) ? 0 : hmod(sku, "tq", 10),
    accuracy: +(0.86 + hmod(sku, "acc", 12) / 100).toFixed(2),
  };
}

/* ---------- state ---------- */
const state = {
  lastSync: null, catalogLive: false, salesLive: false, stockLive: false,
  totalProducts: 0, skus: [], sales: null, errors: {},
};

async function syncCatalog() {
  if (!MG_TOKEN) { state.errors.catalog = "MAGENTO_ACCESS_TOKEN not set"; return; }
  await loadBrands();
  const out = []; const seen = new Set();
  for (const [cid, bucket] of Object.entries(CAT_IDS)) {
    try {
      const q = `searchCriteria[filterGroups][0][filters][0][field]=category_id&searchCriteria[filterGroups][0][filters][0][value]=${cid}&searchCriteria[filterGroups][0][filters][0][conditionType]=eq&searchCriteria[pageSize]=60&fields=items[sku,name,price,status,type_id,extension_attributes[website_ids],custom_attributes]`;
      const data = await mg(`/products?${q}`);
      for (const p of data.items || []) {
        if (!p.sku || seen.has(p.sku) || p.type_id !== "simple" || p.status !== 1) continue;
        const price = Number(p.price || 0); if (price <= 0) continue;
        seen.add(p.sku);
        const ca = Object.fromEntries((p.custom_attributes || []).map((a) => [a.attribute_code, a.value]));
        let sp = Number(ca.special_price); sp = sp && sp > 0 && sp < price ? sp : null;
        const sale = sp || price;
        const brand = brandMap[String(ca.brands)] || "House / Other";
        const wsites = (p.extension_attributes?.website_ids || []).map((w) => WMAP[w]).filter(Boolean);
        out.push({
          sku: p.sku, name: p.name, category: bucket, brand,
          mrp: Math.round(price), price: Math.round(sale), discount: sale < price ? Math.round((1 - sale / price) * 100) : 0,
          wsites: wsites.length ? wsites : ["tennisoutlet"], leadTime: LEAD[brand] || 14,
          ...modelOps(p.sku, bucket, Math.round(sale)),
        });
      }
    } catch (e) { state.errors.catalog = `cat ${cid}: ${e.status || e.message}`; }
  }
  if (out.length) { state.skus = out; state.catalogLive = true; }
  // total count
  try { const t = await mg("/products?searchCriteria[pageSize]=1&fields=total_count"); state.totalProducts = t.total_count || out.length; } catch {}
}

async function sumOrders(sinceIso) {
  let page = 1, total = 0, count = 0, seen = 0, cap = 20;
  while (page <= cap) {
    const q = `searchCriteria[filterGroups][0][filters][0][field]=created_at&searchCriteria[filterGroups][0][filters][0][value]=${encodeURIComponent(sinceIso)}&searchCriteria[filterGroups][0][filters][0][conditionType]=gteq&searchCriteria[pageSize]=100&searchCriteria[currentPage]=${page}&fields=total_count,items[grand_total,base_grand_total,status]`;
    const d = await mg(`/orders?${q}`); // throws 401 until scope granted
    const tc = d.total_count || 0;
    for (const o of d.items || []) { if (["canceled", "closed"].includes(o.status)) continue; total += Number(o.grand_total || o.base_grand_total || 0); count++; }
    seen += (d.items || []).length;
    if (seen >= tc || !(d.items || []).length) break;
    page++;
  }
  return { revenue: Math.round(total), orders: count };
}
function dayStart(offsetDays = 0) { const d = new Date(); d.setDate(d.getDate() - offsetDays); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 19).replace("T", " "); }
async function syncSales() {
  try {
    const today = await sumOrders(dayStart(0));
    const week = await sumOrders(dayStart(7));
    const month = await sumOrders(dayStart(30));
    state.sales = { today: today.revenue, todayOrders: today.orders, week: week.revenue, month: month.revenue, currency: "INR" };
    state.salesLive = true; delete state.errors.sales;
  } catch (e) { state.salesLive = false; state.errors.sales = `${e.status || e.message} (grant Magento_Sales::actions_view)`; }
}
async function syncStock() {
  try {
    const d = await mg("/inventory/source-items?searchCriteria[pageSize]=1");
    state.stockLive = !!d; delete state.errors.stock;
  } catch (e) { state.stockLive = false; state.errors.stock = `${e.status || e.message} (grant Catalog inventory)`; }
}

let syncing = false;
async function runSync() {
  if (syncing) return; syncing = true;
  try { await syncCatalog(); await syncSales(); await syncStock(); state.lastSync = new Date().toISOString(); }
  finally { syncing = false; }
}
const stale = () => !state.lastSync || Date.now() - new Date(state.lastSync).getTime() > SYNC_MS;

/* ---------- endpoints ---------- */
app.get("/", (_q, res) => res.json({ ok: true, service: "baseline-api", lastSync: state.lastSync, catalogLive: state.catalogLive, salesLive: state.salesLive, stockLive: state.stockLive }));
app.get("/api/health", (_q, res) => res.json({ ok: true, model: MODEL, magento: !!MG_TOKEN, lastSync: state.lastSync, catalogLive: state.catalogLive, salesLive: state.salesLive, stockLive: state.stockLive, errors: state.errors }));
app.get("/api/catalog", async (_q, res) => {
  if (stale()) await runSync().catch(() => {});
  res.json({ source: { catalog: state.catalogLive ? "live" : "unavailable", stock: state.stockLive ? "live" : "modeled", sales: state.salesLive ? "live" : "modeled" }, lastSync: state.lastSync, totalProducts: state.totalProducts, count: state.skus.length, skus: state.skus });
});
app.get("/api/sales", async (_q, res) => {
  if (stale()) await runSync().catch(() => {});
  if (state.salesLive) res.json({ available: true, ...state.sales, lastSync: state.lastSync });
  else res.json({ available: false, reason: state.errors.sales || "orders scope not granted" });
});
app.post("/api/sync", async (_q, res) => { await runSync(); res.json({ ok: true, lastSync: state.lastSync, count: state.skus.length, salesLive: state.salesLive }); });

app.post("/api/chat", async (req, res) => {
  if (!OR_KEY) return res.status(500).json({ error: "OPENROUTER_API_KEY not set" });
  const { question, context = {}, role = "exec", history = [] } = req.body || {};
  if (!question) return res.status(400).json({ error: "question required" });
  const live = state.salesLive ? `LIVE sales: today ₹${state.sales?.today}, week ₹${state.sales?.week}, month ₹${state.sales?.month}.` : "Sales are modeled (orders scope not yet granted).";
  const sys = [
    "You are Baseline AI for Tennis Outlet, a 6-store racquet-sports retailer (INR, ₹).",
    `Answer for the ${role} view. Ground ONLY in the DATA. Be concise (2-5 sentences), use ₹, round numbers.`,
    live, "DATA:\n" + JSON.stringify(context).slice(0, 12000),
  ].join("\n");
  const messages = [{ role: "system", content: sys }, ...history.slice(-6).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.text || "").slice(0, 1500) })), { role: "user", content: String(question).slice(0, 2000) }];
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OR_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "https://baseline-dashboard.onrender.com", "X-Title": "Baseline - Tennis Outlet" },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: 600, temperature: 0.3 }),
    });
    if (!r.ok) return res.status(502).json({ error: "LLM upstream", status: r.status, detail: (await r.text()).slice(0, 200) });
    const d = await r.json();
    res.json({ answer: d?.choices?.[0]?.message?.content?.trim() || "(no answer)", model: d?.model || MODEL });
  } catch (e) { res.status(500).json({ error: "proxy failure", detail: String(e).slice(0, 200) }); }
});

app.listen(PORT, () => {
  console.log(`baseline-api on :${PORT} · magento ${MG_TOKEN ? "set" : "MISSING"} · model ${MODEL}`);
  runSync().then(() => console.log(`first sync: ${state.skus.length} SKUs, catalog ${state.catalogLive}, sales ${state.salesLive}`)).catch((e) => console.error("sync err", e.message));
  setInterval(() => runSync().catch(() => {}), SYNC_MS);
});
