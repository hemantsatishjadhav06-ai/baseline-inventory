/**
 * Baseline API — live Magento sync (OAuth 1.0a) + AI proxy.
 * Real catalog, stock and sales when OAuth creds are set; AI via OpenRouter.
 * All secrets live server-side only.
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
const MG_PREFIX = "/rest/V1";
const SYNC_MS = Number(process.env.SYNC_INTERVAL_MS || 10 * 60 * 1000);

// OAuth 1.0a
const CK = process.env.MAGENTO_CONSUMER_KEY;
const CS = process.env.MAGENTO_CONSUMER_SECRET;
const AT = process.env.MAGENTO_ACCESS_TOKEN;          // OAuth access token
const ATS = process.env.MAGENTO_ACCESS_TOKEN_SECRET;
const OAUTH = !!(CK && CS && AT && ATS);

const enc = (s) => encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function mg(path, params = {}) {
  const url = MG_BASE + MG_PREFIX + path;
  const o = {
    oauth_consumer_key: CK, oauth_token: AT, oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_version: "1.0",
  };
  const all = { ...params, ...o };
  const paramStr = Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join("&");
  const base = ["GET", enc(url), enc(paramStr)].join("&");
  const sig = crypto.createHmac("sha256", `${enc(CS)}&${enc(ATS)}`).update(base).digest("base64");
  o.oauth_signature = sig;
  const auth = "OAuth " + Object.keys(o).map((k) => `${enc(k)}="${enc(o[k])}"`).join(", ");
  const qs = Object.keys(params).map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  return fetch(url + (qs ? "?" + qs : ""), { headers: { Authorization: auth, Accept: "application/json" } })
    .then(async (r) => { if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; e.body = await r.text(); throw e; } return r.json(); });
}
const hmod = (s, salt, m) => parseInt(crypto.createHash("md5").update(s + salt).digest("hex").slice(0, 8), 16) % m;

const CAT_IDS = { 25: "Racquets", 29: "Strings", 31: "Balls", 24: "Shoes", 115: "Bags", 128: "Grips", 36: "Apparel", 37: "Accessories" };
const WMAP = { 1: "tennisoutlet", 2: "pickleballoutlet", 3: "padeloutlet", 4: "syxxsports", 5: "badmintonoutlet", 6: "squashoutlet" };
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

const state = { lastSync: null, catalogLive: false, salesLive: false, stockLive: false, totalProducts: 0, skus: [], sales: null, errors: {}, auth: OAUTH ? "oauth" : "none" };

async function syncCatalog() {
  if (!OAUTH) { state.errors.catalog = "Magento OAuth creds not set"; return; }
  await loadBrands();
  const out = []; const seen = new Set();
  for (const [cid, bucket] of Object.entries(CAT_IDS)) {
    try {
      const data = await mg("/products", {
        "searchCriteria[filterGroups][0][filters][0][field]": "category_id",
        "searchCriteria[filterGroups][0][filters][0][value]": cid,
        "searchCriteria[filterGroups][0][filters][0][conditionType]": "eq",
        "searchCriteria[pageSize]": "60",
        fields: "items[sku,name,price,status,type_id,extension_attributes[website_ids],custom_attributes]",
      });
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
    } catch (e) { state.errors.catalog = `cat ${cid}: ${e.status || e.message}`; }
  }
  if (out.length) { state.skus = out; state.catalogLive = true; delete state.errors.catalog; }
  try { const t = await mg("/products", { "searchCriteria[pageSize]": "1", fields: "total_count" }); state.totalProducts = t.total_count || out.length; } catch { }
}

async function syncStock() {
  try {
    const map = {}; let page = 1;
    while (page <= 40) {
      const d = await mg("/inventory/source-items", { "searchCriteria[pageSize]": "200", "searchCriteria[currentPage]": String(page) });
      for (const it of d.items || []) map[it.sku] = (map[it.sku] || 0) + Number(it.quantity || 0);
      const tc = d.total_count || 0; if (page * 200 >= tc || !(d.items || []).length) break; page++;
    }
    let applied = 0;
    for (const s of state.skus) { if (map[s.sku] != null) { s.onHand = Math.round(map[s.sku]); applied++; } }
    state.stockLive = applied > 0; delete state.errors.stock;
  } catch (e) { state.stockLive = false; state.errors.stock = `${e.status || e.message}`; }
}

function sinceDays(n) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 19).replace("T", " "); }
function monthStart() { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 19).replace("T", " "); }
async function sumOrders(since, cap = 30) {
  let total = 0, orders = 0, page = 1, seen = 0;
  while (page <= cap) {
    const d = await mg("/orders", { "searchCriteria[filterGroups][0][filters][0][field]": "created_at", "searchCriteria[filterGroups][0][filters][0][value]": since, "searchCriteria[filterGroups][0][filters][0][conditionType]": "gteq", "searchCriteria[pageSize]": "100", "searchCriteria[currentPage]": String(page), fields: "total_count,items[grand_total,status]" });
    const tc = d.total_count || 0;
    for (const o of d.items || []) { if (o.status === "canceled") continue; total += Number(o.grand_total || 0); orders++; }
    seen += (d.items || []).length; if (seen >= tc || !(d.items || []).length) break; page++;
  }
  return { revenue: Math.round(total), orders };
}
async function syncSales() {
  try {
    const today = await sumOrders(sinceDays(0), 5);
    const week = await sumOrders(sinceDays(7), 10);
    const month = await sumOrders(monthStart(), 30);
    state.sales = { today: today.revenue, todayOrders: today.orders, week: week.revenue, month: month.revenue, currency: "INR" };
    state.salesLive = true; delete state.errors.sales;
  } catch (e) { state.salesLive = false; state.errors.sales = `${e.status || e.message}`; }
}

let syncing = false;
async function runSync() {
  if (syncing) return; syncing = true;
  try { await syncCatalog(); await syncStock(); await syncSales(); state.lastSync = new Date().toISOString(); }
  finally { syncing = false; }
}
const stale = () => !state.lastSync || Date.now() - new Date(state.lastSync).getTime() > SYNC_MS;

app.get("/", (_q, res) => res.json({ ok: true, service: "baseline-api", auth: state.auth, lastSync: state.lastSync, catalogLive: state.catalogLive, salesLive: state.salesLive, stockLive: state.stockLive }));
app.get("/api/health", (_q, res) => res.json({ ok: true, model: MODEL, auth: state.auth, lastSync: state.lastSync, catalogLive: state.catalogLive, salesLive: state.salesLive, stockLive: state.stockLive, totalProducts: state.totalProducts, count: state.skus.length, sales: state.sales, errors: state.errors }));
app.get("/api/catalog", async (_q, res) => { if (stale()) await runSync().catch(() => { }); res.json({ source: { catalog: state.catalogLive ? "live" : "unavailable", stock: state.stockLive ? "live" : "modeled", sales: state.salesLive ? "live" : "modeled" }, lastSync: state.lastSync, totalProducts: state.totalProducts, count: state.skus.length, skus: state.skus }); });
app.get("/api/sales", async (_q, res) => { if (stale()) await runSync().catch(() => { }); state.salesLive ? res.json({ available: true, ...state.sales, lastSync: state.lastSync }) : res.json({ available: false, reason: state.errors.sales || "not synced" }); });
app.post("/api/sync", async (_q, res) => { await runSync(); res.json({ ok: true, lastSync: state.lastSync, count: state.skus.length, salesLive: state.salesLive, stockLive: state.stockLive, sales: state.sales }); });

app.post("/api/chat", async (req, res) => {
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
  runSync().then(() => console.log(`sync: ${state.skus.length} SKUs, catalog ${state.catalogLive}, stock ${state.stockLive}, sales ${state.salesLive}`)).catch((e) => console.error("sync err", e.message));
  setInterval(() => runSync().catch(() => { }), SYNC_MS);
});
