/**
 * replenishmentEngine.js — Baseline's core decision logic.
 *
 * Pure, deterministic, unit-testable. No I/O. Given normalized SKU data
 * it returns days-of-cover, a risk level (0..4 = the Design System Risk
 * Scale), a suggested order quantity, and groups suggestions into
 * supplier PO drafts.
 *
 * Risk Scale:
 *   0 STOCKOUT   cover <= leadTime
 *   1 REORDER    leadTime < cover <= reorderWindow
 *   2 HEALTHY    reorderWindow < cover <= targetMaxDays
 *   3 OVERSTOCK  cover > targetMaxDays
 *   4 DEAD       no sales and idle >= deadAfterDays
 */

const DEFAULTS = {
  safetyFactor: Number(process.env.ENGINE_SAFETY_FACTOR || 0.5),
  reviewPeriodDays: Number(process.env.ENGINE_REVIEW_PERIOD_DAYS || 15),
  targetMaxDays: Number(process.env.ENGINE_TARGET_MAX_DAYS || 60),
  deadAfterDays: Number(process.env.ENGINE_DEAD_AFTER_DAYS || 90),
};

const RISK = { STOCKOUT: 0, REORDER: 1, HEALTHY: 2, OVERSTOCK: 3, DEAD: 4 };

/** Weighted trailing demand: recent windows weighted heavier (handles spiky seasonal demand). */
function avgDailySales(salesDaily = []) {
  // salesDaily: [{ date:'YYYY-MM-DD', units:Number }, ...] most-recent-inclusive
  const byWindow = (days) => {
    const cutoff = Date.now() - days * 86400000;
    const rows = salesDaily.filter((r) => new Date(r.date).getTime() >= cutoff);
    const units = rows.reduce((a, r) => a + r.units, 0);
    return units / days;
  };
  const w7 = byWindow(7), w30 = byWindow(30), w90 = byWindow(90);
  return 0.5 * w7 + 0.3 * w30 + 0.2 * w90;
}

function stddev(nums) {
  if (nums.length < 2) return 0;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / (nums.length - 1));
}

function roundUpToMOQ(qty, moqUnits) {
  if (!moqUnits || moqUnits <= 1) return qty;
  return Math.ceil(qty / moqUnits) * moqUnits;
}

/**
 * Classify a single SKU.
 * @param {object} s {onHand, inTransit, leadTimeDays, salesDaily, daysSinceLastSale, moqUnits}
 * @param {object} cfg overrides for DEFAULTS
 */
function classifySku(s, cfg = {}) {
  const o = { ...DEFAULTS, ...cfg };
  const onHand = s.onHand || 0;
  const inTransit = s.inTransit || 0;
  const leadTime = s.leadTimeDays || 7;
  const avgDaily = avgDailySales(s.salesDaily);
  const dailySeries = (s.salesDaily || []).map((r) => r.units);

  const cover = avgDaily > 0 ? (onHand + inTransit) / avgDaily : Infinity;
  const safetyDays = Math.max(5, Math.round(leadTime * o.safetyFactor));
  const reorderWindow = leadTime + safetyDays;

  let risk;
  if (avgDaily === 0 || (s.daysSinceLastSale || 0) >= o.deadAfterDays) risk = RISK.DEAD;
  else if (cover > o.targetMaxDays) risk = RISK.OVERSTOCK;
  else if (cover <= leadTime) risk = RISK.STOCKOUT;
  else if (cover <= reorderWindow) risk = RISK.REORDER;
  else risk = RISK.HEALTHY;

  // safety stock in units, scaled by demand variability over lead time
  const z = 1.65; // ~95% service level
  const safetyStock = Math.round(z * stddev(dailySeries) * Math.sqrt(leadTime));
  const reorderPoint = Math.round(avgDaily * leadTime + safetyStock);

  let suggestedQty = Math.max(
    Math.ceil(avgDaily * (leadTime + o.reviewPeriodDays) + safetyStock - (onHand + inTransit)),
    0
  );
  if (risk === RISK.OVERSTOCK || risk === RISK.DEAD) suggestedQty = 0;
  suggestedQty = roundUpToMOQ(suggestedQty, s.moqUnits);

  return {
    sku: s.sku,
    avgDaily: Number(avgDaily.toFixed(3)),
    daysCover: isFinite(cover) ? Number(cover.toFixed(2)) : null,
    reorderPoint,
    suggestedQty,
    riskLevel: risk,
  };
}

/** Run the engine over a catalog. */
function classifyCatalog(skus, cfgBySupplier = {}) {
  return skus.map((s) => classifySku(s, cfgBySupplier[s.supplier] || {}));
}

/**
 * Build supplier-grouped PO drafts from engine output + product/supplier meta.
 * De-dupes against quantities already in transit.
 */
function buildPoDrafts(classified, productBySku, supplierMeta) {
  const bySupplier = {};
  for (const c of classified) {
    if (c.suggestedQty <= 0) continue;
    const p = productBySku[c.sku];
    if (!p) continue;
    const sup = p.supplier || "Unassigned";
    (bySupplier[sup] = bySupplier[sup] || []).push({
      sku: c.sku, name: p.name, qty: c.suggestedQty,
      unitCost: p.unitCost, lineTotal: c.suggestedQty * p.unitCost,
    });
  }
  return Object.entries(bySupplier).map(([supplier, lines]) => {
    const total = lines.reduce((a, l) => a + l.lineTotal, 0);
    const moq = supplierMeta[supplier]?.moqValue || 0;
    return {
      supplier,
      leadTimeDays: supplierMeta[supplier]?.leadTimeDays,
      lines,
      totalValue: total,
      belowMinimum: total < moq,
      shortfall: Math.max(0, moq - total),
      status: "draft",
    };
  }).sort((a, b) => b.totalValue - a.totalValue);
}

module.exports = {
  RISK, DEFAULTS,
  avgDailySales, classifySku, classifyCatalog, buildPoDrafts, roundUpToMOQ,
};
