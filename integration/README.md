# Baseline — Magento Integration

Read-only integration that powers Baseline's replenishment intelligence from the Tennis Outlet Magento store (`https://console.tennisoutlet.in`).

This folder is the runnable core: a Magento REST client and the replenishment engine. They have **no external dependencies** (Node 18+ global `fetch`) so you can run and test them before wiring up Postgres/Redis from the [Engineering Documentation](../Baseline_Engineering_Documentation.md).

## Files

| File | Purpose |
|------|---------|
| `magentoClient.js` | Read-only REST client: products, stock, orders, categories. Rate-limited, retry/backoff, auth-fail aware. GETs only. |
| `replenishmentEngine.js` | Pure decision logic: days-of-cover, risk classification (0–4), suggested qty, supplier PO drafts. |
| `.env.example` | Configuration template. Copy to `.env`; keep the token in a secret store. |

## Quick start

```bash
cp .env.example .env
# Put MAGENTO_ACCESS_TOKEN in your secret store (do NOT commit it)

node -e "require('dotenv').config(); require('./magentoClient').ping().then(console.log)"
# → { ok: true }   if the token + URL are valid
```

## Minimal end-to-end (no DB)

```js
require("dotenv").config();
const m = require("./magentoClient");
const { classifyCatalog, buildPoDrafts } = require("./replenishmentEngine");

(async () => {
  const products = await m.fetchProducts();
  const productBySku = Object.fromEntries(products.map(p => [p.sku, p]));

  // pull 90 days of orders → build sales history per SKU
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 19).replace("T", " ");
  const orders = await m.fetchOrdersSince(since);
  const salesBySku = {};
  for (const o of orders) {
    (salesBySku[o.sku] = salesBySku[o.sku] || []).push({ date: o.date, units: o.qty });
  }

  // attach stock + sales to each SKU
  const skus = [];
  for (const p of products) {
    const stock = await m.fetchStockItem(p.sku).catch(() => ({ onHand: 0 }));
    skus.push({
      sku: p.sku, supplier: p.supplier,
      onHand: stock.onHand, inTransit: 0,
      leadTimeDays: 10,                 // from supplier table in production
      salesDaily: salesBySku[p.sku] || [],
      daysSinceLastSale: 0,
    });
  }

  const classified = classifyCatalog(skus);
  const supplierMeta = { /* { Babolat: { leadTimeDays:10, moqValue:25000 } } */ };
  const drafts = buildPoDrafts(classified, productBySku, supplierMeta);
  console.log(drafts);
})();
```

## Going from mock to live

The UI (`../Baseline_Dashboard.jsx`) currently renders a realistic seeded dataset so the product is fully demoable today. To go live:

1. Stand up Postgres + Redis (schema in the Engineering Doc §6).
2. Schedule the sync worker (`SYNC_CRON`) to call `fetchProducts` / `fetchStockItem` / `fetchOrdersSince` and upsert into Postgres.
3. Run `classifyCatalog` after each sync; persist to the `replenishment` table.
4. Point the frontend's data layer at `/api/v1/*` instead of the in-file `RAW` array.

## Security checklist

- [ ] `MAGENTO_ACCESS_TOKEN` loaded from secret store, never committed or logged.
- [ ] **Rotate the token** that was shared during design (Admin → System → Integrations → Reset Access Token).
- [ ] Magento integration scoped **read-only** (Catalog, Inventory, Sales view).
- [ ] TLS-only `MAGENTO_BASE_URL` (https).
- [ ] Request logging redacts the `Authorization` header.

## Notes on supplier mapping

Magento has no native supplier entity. Baseline derives `supplier` from a product attribute (`supplier`/`manufacturer`) or a Baseline-side `supplier` table that maps SKUs → supplier, lead time, and MOQ. Lead time and MOQ drive both the risk math and PO grouping, so seed that table early.
