#!/usr/bin/env python3
"""
Baseline Analytics Engine — REAL metrics from live Magento (OAuth 1.0a / HMAC-SHA256).

Computes, 100% from Magento data (no modeling):
  - Sales totals (today / 7d / month-to-date)  [invoiced revenue, IST calendar]
  - Top sellers (by revenue & units)           [order line items]
  - Sales by brand / by category               [order items joined to product brand/category]
  - Sales by store                             [order store_id]
  - Per-SKU velocity & days-of-cover           [units sold ÷ days, on-hand ÷ daily velocity]
  - Stockout radar / Reorder / Dead stock      [risk from days-of-cover vs lead time]
  - Inventory value at RETAIL                  [Σ on_hand × price]   (cost not exposed → no GMROI)

Run on a schedule (cron / Render Cron Job) to auto-update:
  */15 * * * *  python3 analytics_engine.py > /var/data/baseline.json
The output JSON is what a dashboard/API reads.

Credentials via env (NEVER hardcode in production):
  MAGENTO_BASE_URL, MG_CONSUMER_KEY, MG_CONSUMER_SECRET, MG_ACCESS_TOKEN, MG_ACCESS_TOKEN_SECRET
"""
import os, hmac, hashlib, base64, time, random, string, urllib.parse, subprocess, json, datetime

BASE = os.environ.get("MAGENTO_BASE_URL", "https://console.tennisoutlet.in") + "/rest/V1"
CK  = os.environ["MG_CONSUMER_KEY"]
CS  = os.environ["MG_CONSUMER_SECRET"]
AT  = os.environ["MG_ACCESS_TOKEN"]
ATS = os.environ["MG_ACCESS_TOKEN_SECRET"]

# ---- OAuth 1.0a signed GET (Magento requires HMAC-SHA256) ----
def _enc(s): return urllib.parse.quote(str(s), safe="~")
def mg(path, q=None):
    q = q or {}
    url = BASE + path
    o = {"oauth_consumer_key": CK, "oauth_token": AT, "oauth_signature_method": "HMAC-SHA256",
         "oauth_timestamp": str(int(time.time())), "oauth_nonce": "".join(random.choices(string.ascii_letters, k=24)),
         "oauth_version": "1.0"}
    allp = {**q, **o}
    base = "&".join(["GET", _enc(url), _enc("&".join(f"{_enc(k)}={_enc(allp[k])}" for k in sorted(allp)))])
    o["oauth_signature"] = base64.b64encode(hmac.new(f"{_enc(CS)}&{_enc(ATS)}".encode(), base.encode(), hashlib.sha256).digest()).decode()
    auth = "OAuth " + ", ".join(f'{_enc(k)}="{_enc(v)}"' for k, v in o.items())
    full = url + ("?" + "&".join(f"{_enc(k)}={_enc(v)}" for k, v in q.items()) if q else "")
    out = subprocess.run(["curl", "-s", "-m", "30", "-H", f"Authorization: {auth}", full], capture_output=True, text=True)
    return json.loads(out.stdout)

# ---- IST calendar helpers (Magento store tz = Asia/Kolkata, stored UTC) ----
def ist_day_start_utc(days_ago=0):
    t = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30) - datetime.timedelta(days=days_ago)
    midnight_ist = datetime.datetime(t.year, t.month, t.day)
    return (midnight_ist - datetime.timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d %H:%M:%S")
def ist_month_start_utc():
    t = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
    return (datetime.datetime(t.year, t.month, 1) - datetime.timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d %H:%M:%S")

CAT_IDS = {25:"Racquets",29:"Strings",31:"Balls",24:"Shoes",115:"Bags",128:"Grips",36:"Apparel",37:"Accessories"}
WMAP = {"1":"tennisoutlet","2":"pickleballoutlet","3":"padeloutlet","4":"syxxsports","5":"badmintonoutlet","6":"squashoutlet"}
LEAD = {"Babolat":10,"Wilson":14,"YONEX":21,"Head":18,"ASICS":20,"Adidas":22,"Solinco":7,"Dunlop":15}

def load_brand_map():
    return {str(o["value"]): o["label"] for o in mg("/products/attributes/brands/options") if o.get("value")}

# ---- 1. CATALOG: real sku -> {name, brand, category, price, mrp} (full catalog, by category) ----
def fetch_catalog(brands):
    cat = {}
    for cid, bucket in CAT_IDS.items():
        page = 1
        while page <= 60:
            d = mg("/products", {
                "searchCriteria[filterGroups][0][filters][0][field]": "category_id",
                "searchCriteria[filterGroups][0][filters][0][value]": cid,
                "searchCriteria[filterGroups][0][filters][0][conditionType]": "eq",
                "searchCriteria[pageSize]": "100", "searchCriteria[currentPage]": page,
                "fields": "total_count,items[sku,name,price,status,type_id,custom_attributes]"})
            items = d.get("items", [])
            for p in items:
                if p.get("type_id") != "simple" or p.get("status") != 1: continue
                ca = {a["attribute_code"]: a["value"] for a in p.get("custom_attributes", [])}
                price = float(p.get("price") or 0)
                if price <= 0: continue
                sp = float(ca.get("special_price") or 0)
                cat[p["sku"]] = {"name": p["name"], "brand": brands.get(str(ca.get("brands")), "Other"),
                                 "category": bucket, "mrp": price, "price": sp if 0 < sp < price else price}
            if page * 100 >= d.get("total_count", 0) or not items: break
            page += 1
    return cat

# ---- 2. STOCK: real on-hand per sku ----
def fetch_stock():
    stock, page = {}, 1
    while page <= 40:
        d = mg("/inventory/source-items", {"searchCriteria[pageSize]": "200", "searchCriteria[currentPage]": page})
        for it in d.get("items", []): stock[it["sku"]] = stock.get(it["sku"], 0) + float(it.get("quantity") or 0)
        if page * 200 >= d.get("total_count", 0) or not d.get("items"): break
        page += 1
    return stock

# ---- 3. ORDERS: real velocity, top sellers, brand/category/store sales, sales totals ----
def fetch_orders(days=30):
    since = ist_day_start_utc(days); t0 = ist_day_start_utc(0); w0 = ist_day_start_utc(7); m0 = ist_month_start_utc()
    by_sku = {}; by_store = {}; totals = {"today": 0.0, "week": 0.0, "month": 0.0}
    page = 1
    while page <= 60:
        d = mg("/orders", {
            "searchCriteria[filterGroups][0][filters][0][field]": "created_at",
            "searchCriteria[filterGroups][0][filters][0][value]": since,
            "searchCriteria[filterGroups][0][filters][0][conditionType]": "gteq",
            "searchCriteria[pageSize]": "100", "searchCriteria[currentPage]": page,
            "fields": "total_count,items[created_at,status,store_id,total_invoiced,items[sku,name,qty_ordered,qty_invoiced,row_total]]"})
        items = d.get("items", [])
        for o in items:
            if o.get("status") == "canceled": continue
            ct = o.get("created_at", ""); inv = float(o.get("total_invoiced") or 0)
            if ct >= t0: totals["today"] += inv; by_store[o.get("store_id")] = by_store.get(o.get("store_id"), 0) + inv
            if ct >= w0: totals["week"] += inv
            if ct >= m0: totals["month"] += inv
            for it in o.get("items", []):
                if not it.get("sku"): continue
                q = float(it.get("qty_invoiced") or it.get("qty_ordered") or 0); rev = float(it.get("row_total") or 0)
                e = by_sku.setdefault(it["sku"], {"name": it.get("name", ""), "units": 0.0, "rev": 0.0, "last": ct})
                e["units"] += q; e["rev"] += rev
                if ct > e["last"]: e["last"] = ct
        if page * 100 >= d.get("total_count", 0) or not items: break
        page += 1
    return by_sku, by_store, totals, days

# ---- 4. RISK ENGINE (the maths) ----
def compute(catalog, stock, by_sku, days):
    now = datetime.datetime.utcnow()
    rows = []
    for sku, c in catalog.items():
        sold = by_sku.get(sku, {})
        units = sold.get("units", 0.0)
        avg_daily = units / days                                  # real velocity
        on_hand = stock.get(sku, 0)
        cover = (on_hand / avg_daily) if avg_daily > 0 else float("inf")   # days of cover
        last = sold.get("last")
        idle = (now - datetime.datetime.strptime(last, "%Y-%m-%d %H:%M:%S")).days if last else 999
        lead = LEAD.get(c["brand"], 14); reorder_pt = lead + max(5, round(lead * 0.4))
        if avg_daily == 0 and idle >= 60: risk = "DEAD"
        elif cover > 60: risk = "OVERSTOCK"
        elif cover <= lead: risk = "STOCKOUT"
        elif cover <= reorder_pt: risk = "REORDER"
        else: risk = "HEALTHY"
        rows.append({**c, "sku": sku, "onHand": round(on_hand), "avgDaily": round(avg_daily, 2),
                     "daysCover": None if cover == float("inf") else round(cover, 1), "risk": risk,
                     "stockValueRetail": round(on_hand * c["price"])})
    return rows

def main():
    brands = load_brand_map()
    catalog = fetch_catalog(brands)
    stock = fetch_stock()
    by_sku, by_store, totals, days = fetch_orders(30)
    rows = compute(catalog, stock, by_sku, days)

    # aggregates
    top = sorted(({"name": v["name"], "sku": k, "units": round(v["units"]), "revenue": round(v["rev"])}
                  for k, v in by_sku.items()), key=lambda x: -x["revenue"])[:15]
    brand_sales = {}; cat_sales = {}
    for k, v in by_sku.items():
        c = catalog.get(k)
        if not c: continue
        brand_sales[c["brand"]] = brand_sales.get(c["brand"], 0) + v["rev"]
        cat_sales[c["category"]] = cat_sales.get(c["category"], 0) + v["rev"]
    out = {
        "generatedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "salesInvoiced": {k: round(v) for k, v in totals.items()},
        "salesByStore": {WMAP.get(str(s), str(s)): round(v) for s, v in by_store.items()},
        "topSellers30d": top,
        "salesByBrand30d": dict(sorted(((k, round(v)) for k, v in brand_sales.items()), key=lambda x: -x[1])),
        "salesByCategory30d": dict(sorted(((k, round(v)) for k, v in cat_sales.items()), key=lambda x: -x[1])),
        "inventoryValueRetail": round(sum(r["stockValueRetail"] for r in rows)),
        "stockoutRadar": [r for r in rows if r["risk"] in ("STOCKOUT", "REORDER")][:50],
        "deadStock": [r for r in rows if r["risk"] == "DEAD"][:50],
        "skuCount": len(rows),
    }
    print(json.dumps(out, indent=2, default=str))

if __name__ == "__main__":
    main()
