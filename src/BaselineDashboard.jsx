import { useState, useMemo, useRef, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  LayoutDashboard, Radar, TrendingUp, Snowflake, ClipboardList, Search, Send, Bot,
  Bell, AlertOctagon, AlertTriangle, CheckCircle2, Layers, Truck, Crown, Users, ShoppingCart,
  TrendingDown, Package, IndianRupee, Plus, Check, X, RefreshCw, Activity, Sparkles,
  Target, CalendarDays, Wallet, Award, Boxes, ArrowRight, Inbox, Store, ChevronRight,
  Gauge, Percent, Repeat, Scale, MessageSquare, Zap,
} from "lucide-react";
import { SKUS as CATALOG_SKUS, CATALOG } from "./data.js";

/* ============================ TOKENS ============================ */
const C = {
  navy: "#0E1726", navy700: "#16223A", navy600: "#1F2E4D",
  optic: "#C6F042", opticInk: "#1A2E00", clay: "#E1622B", blue: "#2E86DE",
  danger: "#E5484D", warning: "#F5A524", success: "#30A46C", info: "#2E86DE",
  dead: "#8E7CC3", overstock: "#C28E0E", purple: "#7C6FE0",
  bg: "#F6F7F9", surface: "#FFFFFF", surfaceAlt: "#FBFCFD",
  border: "#ECEEF1", borderStrong: "#DFE2E7",
  text: "#0E1726", muted: "#5B6472", subtle: "#9AA1AD",
};
const mono = '"IBM Plex Mono", ui-monospace, monospace';
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const inrC = (n) => n >= 1e7 ? "₹" + (n / 1e7).toFixed(2) + " Cr" : n >= 1e5 ? "₹" + (n / 1e5).toFixed(2) + " L" : inr(n);
const RISK = {
  0: { label: "Stockout risk", color: C.danger, Icon: AlertOctagon },
  1: { label: "Reorder now", color: C.warning, Icon: AlertTriangle },
  2: { label: "Healthy", color: C.success, Icon: CheckCircle2 },
  3: { label: "Overstock", color: C.overstock, Icon: Layers },
  4: { label: "Dead stock", color: C.dead, Icon: Snowflake },
};
const skuPortal = { open: () => {} }; // module-level bridge to open SKU 360 from anywhere

/* ============================ SEASONAL MODEL ============================ */
const SEASON = {
  Racquets: [1.05, 0.95, 1.10, 1.15, 1.00, 0.80, 0.75, 0.95, 1.35, 1.45, 1.30, 1.15],
  Strings: [1.00, 0.98, 1.05, 1.08, 1.02, 0.92, 0.90, 1.00, 1.12, 1.15, 1.08, 1.05],
  Shoes: [1.02, 0.96, 1.08, 1.12, 1.00, 0.85, 0.82, 0.98, 1.25, 1.30, 1.18, 1.10],
  Balls: [1.00, 1.00, 1.05, 1.10, 1.05, 0.95, 0.92, 1.00, 1.10, 1.12, 1.05, 1.02],
  Bags: [1.00, 0.95, 1.05, 1.05, 0.98, 0.88, 0.85, 0.95, 1.20, 1.22, 1.10, 1.05],
  Grips: [1.00, 1.00, 1.04, 1.06, 1.02, 0.96, 0.94, 1.00, 1.08, 1.10, 1.04, 1.02],
  Apparel: [0.95, 0.92, 1.05, 1.20, 1.30, 1.15, 1.05, 1.00, 1.10, 1.05, 0.95, 1.00],
  Accessories: [1.00, 1.00, 1.02, 1.05, 1.04, 0.96, 0.94, 1.00, 1.06, 1.08, 1.04, 1.02],
};
const MONTH = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const seasonIdx = (cat, m = MONTH) => (SEASON[cat] ? SEASON[cat][m] : 1);
const seasonAvg = (cat) => (SEASON[cat] ? SEASON[cat].reduce((a, b) => a + b, 0) / 12 : 1);
const STORES = CATALOG.stores;

/* ============================ ENGINE ============================ */
function buildSkus({ surge = 0, delay = 0 } = {}) {
  return CATALOG_SKUS.map((p) => {
    const reviewPeriod = 15, effLead = p.leadTime + delay;
    const reorderWindow = effLead + Math.max(5, Math.round(effLead * 0.4)), targetMaxDays = 60, deadAfterDays = 90;
    const forecastDaily = p.avgDaily * seasonIdx(p.category) * (1 + surge / 100);
    const cover = forecastDaily > 0 ? (p.onHand + p.inTransit) / forecastDaily : Infinity;
    let risk;
    if (p.avgDaily === 0 || p.daysSinceSale >= deadAfterDays) risk = 4;
    else if (cover > targetMaxDays) risk = 3;
    else if (cover <= effLead) risk = 0;
    else if (cover <= reorderWindow) risk = 1;
    else risk = 2;
    const safetyStock = Math.round(forecastDaily * effLead * 0.5);
    let suggested = Math.max(Math.ceil(forecastDaily * (effLead + reviewPeriod) + safetyStock - (p.onHand + p.inTransit)), 0);
    if (risk === 3 || risk === 4) suggested = 0;
    return {
      ...p, forecastDaily, effLead, reorderWindow, targetMaxDays, cover, risk, suggestedQty: suggested,
      stockValue: p.onHand * p.unitCost, retailValue: p.onHand * p.price,
      protectedRev: forecastDaily * p.price * effLead, dailyRev: p.avgDaily * seasonIdx(p.category) * p.price,
      margin: p.price > 0 ? (p.price - p.unitCost) / p.price : 0,
      annualRev: p.avgDaily * seasonAvg(p.category) * p.price * 365,
      annualGM: p.avgDaily * seasonAvg(p.category) * (p.price - p.unitCost) * 365,
    };
  });
}
function salesAgg(skus) {
  const dayRev = skus.reduce((a, s) => a + s.dailyRev, 0);
  const yearRev = skus.reduce((a, s) => a + s.annualRev, 0);
  const months = MONTHS.map((m, i) => ({ m, rev: skus.reduce((a, s) => a + s.avgDaily * s.price * seasonIdx(s.category, i) * 30, 0), cur: i === MONTH }));
  const weeks = Array.from({ length: 12 }, (_, i) => ({ w: "W" + (i + 1), rev: dayRev * 7 * (0.85 + ((i * 7) % 11) / 30) }));
  const days = Array.from({ length: 30 }, (_, i) => ({ d: i + 1, rev: dayRev * (0.8 + ((i * 3) % 9) / 18) }));
  return { dayRev, weekRev: dayRev * 7, monthRev: months[MONTH].rev, yearRev, months, weeks, days };
}
function topSellers(skus, periodDays) {
  return [...skus].filter((s) => s.dailyRev > 0)
    .map((s) => ({ ...s, periodRev: s.dailyRev * periodDays, periodUnits: Math.round(s.avgDaily * seasonIdx(s.category) * periodDays) }))
    .sort((a, b) => b.periodRev - a.periodRev).slice(0, 10);
}
function perStore(s) {
  const base = [0.34, 0.18, 0.14, 0.12, 0.12, 0.10];
  let h = 0; for (const ch of s.sku) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rot = h % 6, w = base.map((_, i) => base[(i + rot) % 6]), tot = w.reduce((a, b) => a + b, 0);
  let left = s.onHand;
  return STORES.map((st, i) => { const q = i === 5 ? left : Math.round(s.onHand * w[i] / tot); left -= q; return { store: st, qty: Math.max(0, q) }; });
}
function utilization(skus) {
  const invCost = skus.reduce((a, s) => a + s.stockValue, 0);
  const annualCOGS = skus.reduce((a, s) => a + s.avgDaily * seasonAvg(s.category) * s.unitCost * 365, 0);
  const turnover = invCost > 0 ? annualCOGS / invCost : 0;
  const annualGM = skus.reduce((a, s) => a + s.annualGM, 0);
  const gmroi = invCost > 0 ? annualGM / invCost : 0;
  const sold30 = skus.reduce((a, s) => a + s.forecastDaily * 30, 0);
  const onHandUnits = skus.reduce((a, s) => a + s.onHand, 0);
  const sellThrough = sold30 / (sold30 + onHandUnits || 1);
  const deadValue = skus.filter((s) => s.risk === 4).reduce((a, s) => a + s.stockValue, 0);
  const annualRev = skus.reduce((a, s) => a + s.annualRev, 0);
  return { invCost, turnover, dsi: turnover > 0 ? 365 / turnover : 0, gmroi, sellThrough, deadRatio: deadValue / (invCost || 1), capitalEff: annualRev / (invCost || 1), annualRev, annualGM };
}
function abcClasses(skus) {
  const sorted = [...skus].sort((a, b) => b.annualRev - a.annualRev);
  const total = sorted.reduce((a, s) => a + s.annualRev, 0) || 1;
  let cum = 0; const out = { A: { n: 0, v: 0 }, B: { n: 0, v: 0 }, C: { n: 0, v: 0 } };
  sorted.forEach((s) => { cum += s.annualRev; const cls = cum / total <= 0.8 ? "A" : cum / total <= 0.95 ? "B" : "C"; out[cls].n++; out[cls].v += s.annualRev; s._abc = cls; });
  return out;
}
function anomalies(skus) {
  const out = [];
  const catNow = {}, catPrev = {};
  skus.forEach((s) => { catNow[s.category] = (catNow[s.category] || 0) + s.avgDaily * seasonIdx(s.category) * s.price; catPrev[s.category] = (catPrev[s.category] || 0) + s.avgDaily * seasonIdx(s.category, (MONTH + 11) % 12) * s.price; });
  Object.keys(catNow).forEach((c) => { const d = catPrev[c] > 0 ? (catNow[c] - catPrev[c]) / catPrev[c] : 0; if (Math.abs(d) >= 0.12) out.push({ sev: d < 0 ? "down" : "up", text: `${c} demand is ${d < 0 ? "down" : "up"} ${Math.abs(Math.round(d * 100))}% month-on-month (seasonal).` }); });
  const bigDead = [...skus].filter((s) => s.risk === 4).sort((a, b) => b.stockValue - a.stockValue)[0];
  if (bigDead) out.push({ sev: "down", text: `${bigDead.name.slice(0, 40)} has had no sale in ${bigDead.daysSinceSale} days — ${inrC(bigDead.stockValue)} frozen.` });
  const oos = skus.filter((s) => s.onHand === 0 && s.avgDaily > 0).length;
  if (oos) out.push({ sev: "down", text: `${oos} selling SKUs are completely out of stock right now.` });
  return out.slice(0, 5);
}

/* ============================ PRIMITIVES ============================ */
const RiskBadge = ({ level }) => { const r = RISK[level]; return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: r.color + "1A", color: r.color, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}><r.Icon size={13} /> {r.label}</span>; };
const ProductCell = ({ s }) => (
  <button onClick={() => skuPortal.open(s)} style={{ border: "none", background: "transparent", cursor: "pointer", textAlign: "left", padding: 0, display: "flex", alignItems: "center", gap: 6, color: C.text, width: "100%" }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span><ChevronRight size={13} color={C.subtle} style={{ flexShrink: 0 }} /></div>
      <div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>{s.sku} · {s.supplier}</div>
    </div>
  </button>
);
function CoverMeter({ s }) {
  if (!isFinite(s.cover)) return <span style={{ fontSize: 12, color: C.subtle, fontStyle: "italic" }}>no recent sales</span>;
  const sm = Math.max(s.targetMaxDays, s.cover, s.reorderWindow) * 1.1, pct = (v) => Math.min(100, (v / sm) * 100), r = RISK[s.risk];
  return (<div style={{ minWidth: 130 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{s.cover.toFixed(0)}d</span><span style={{ fontSize: 11, color: C.subtle }}>lead {s.effLead}d</span></div>
    <div style={{ position: "relative", height: 7, borderRadius: 999, background: C.border }}><div style={{ position: "absolute", inset: 0, width: pct(s.cover) + "%", borderRadius: 999, background: r.color, transition: "width .35s" }} /><div style={{ position: "absolute", top: -2, left: pct(s.effLead) + "%", width: 2, height: 11, background: C.danger }} /></div></div>);
}
function Kpi({ label, value, delta, intent = "neutral", tone, Icon, sub }) {
  const up = delta >= 0, dc = delta == null ? C.subtle : (up === (intent !== "negative")) ? C.success : C.danger;
  return (<div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: 18, position: "relative", overflow: "hidden" }}>
    {tone && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: tone }} />}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: C.muted }}>{label}</span>{Icon && <Icon size={15} color={C.subtle} strokeWidth={1.75} />}</div>
    <div style={{ fontFamily: mono, fontSize: 23, fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9 }}>{delta != null && <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 12, fontWeight: 600, color: dc }}>{up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(delta)}%</span>}{sub && <span style={{ fontSize: 12, color: C.subtle }}>{sub}</span>}</div>
  </div>);
}
function Card({ title, subtitle, action, children, pad = 18 }) {
  return (<div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}` }}>
    {title && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}><div><div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>{subtitle && <div style={{ fontSize: 12, color: C.subtle, marginTop: 2 }}>{subtitle}</div>}</div>{action}</div>}
    <div style={{ padding: pad }}>{children}</div></div>);
}
const Tip = ({ active, payload, label, fmt = (v) => v }) => (!active || !payload?.length) ? null : (<div style={{ background: C.navy, color: "#fff", padding: "8px 12px", borderRadius: 8, fontSize: 12 }}><div style={{ color: "#9AA1AD", marginBottom: 4 }}>{label}</div>{payload.map((p, i) => <div key={i} style={{ fontFamily: mono, fontWeight: 600, color: p.color || "#fff" }}>{p.name}: {fmt(p.value)}</div>)}</div>);
const btnGhost = { fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.borderStrong}`, background: "transparent", cursor: "pointer", color: C.text };
const btnPrimary = { fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "none", background: C.optic, color: C.opticInk, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };
function Segment({ options, value, onChange }) {
  return (<div style={{ display: "inline-flex", background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 9, padding: 3 }}>{options.map((o) => <button key={o.v} onClick={() => onChange(o.v)} style={{ border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 7, background: value === o.v ? C.surface : "transparent", color: value === o.v ? C.text : C.muted }}>{o.l}</button>)}</div>);
}

/* ============================ AI INSIGHTS ENGINE ============================ */
function buildInsights(skus, agg, role) {
  const out = [], atRisk = skus.filter((s) => s.risk <= 1), revRisk = atRisk.reduce((a, s) => a + s.protectedRev, 0);
  const dead = skus.filter((s) => s.risk === 4), deadCash = dead.reduce((a, s) => a + s.stockValue, 0), over = skus.filter((s) => s.risk === 3);
  const topCat = Object.entries(skus.reduce((m, s) => ((m[s.category] = (m[s.category] || 0) + s.dailyRev), m), {})).sort((a, b) => b[1] - a[1])[0];
  const u = utilization(skus);
  if (role === "exec") out.push({ icon: Sparkles, color: C.purple, text: `Modeled run-rate: ${inrC(agg.monthRev)}/month, ${inrC(agg.yearRev)}/year across the group. Inventory turns ${u.turnover.toFixed(1)}× a year — every ₹1 of stock returns ${u.capitalEff.toFixed(1)}× in sales.` });
  if (atRisk.length) out.push({ icon: AlertOctagon, color: C.danger, text: `${atRisk.length} SKUs will run dry inside their lead time — ${inrC(revRisk)} of forward revenue exposed.`, action: "Review reorders", to: "radar" });
  if (deadCash > 0) out.push({ icon: Snowflake, color: C.dead, text: `${inrC(deadCash)} frozen in ${dead.length} dead SKUs (${Math.round(u.deadRatio * 100)}% of inventory value). Clearing the top 5 frees ${inrC(dead.slice(0, 5).reduce((a, s) => a + s.stockValue, 0))}.`, action: "Open dead stock", to: "dead" });
  if (topCat) out.push({ icon: TrendingUp, color: C.success, text: `${topCat[0]} is the revenue engine right now. June is an off-season lull — pre-season ramp starts September; pre-buy before lead times bite.` });
  if (over.length) out.push({ icon: Layers, color: C.overstock, text: `${over.length} SKUs are overstocked beyond 60 days — pause them on the next PO to free working capital.`, action: "Run what-if", to: "forecast" });
  return out;
}

/* ============================ ASK BASELINE (CHAT) ============================ */
function ChatKpis({ items }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 8, marginTop: 10 }}>{items.map((it, i) => <div key={i} style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px" }}><div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: ".03em", fontWeight: 600 }}>{it.l}</div><div style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, marginTop: 3, color: it.c || C.text }}>{it.v}</div></div>)}</div>;
}
function ChatList({ rows }) {
  return <div style={{ marginTop: 10, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>{rows.map((r, i) => (
    <button key={i} onClick={() => r.sku && skuPortal.open(r.sku)} style={{ width: "100%", border: "none", borderTop: i ? `1px solid ${C.border}` : "none", background: C.surface, cursor: r.sku ? "pointer" : "default", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", textAlign: "left" }}>
      {r.rank != null && <span style={{ fontFamily: mono, fontSize: 12, color: r.rank < 3 ? C.clay : C.subtle, fontWeight: 600, width: 16 }}>{r.rank + 1}</span>}
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>{r.sub && <div style={{ fontSize: 11, color: C.subtle }}>{r.sub}</div>}</div>
      {r.right && <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: r.rightColor || C.text }}>{r.right}</span>}
      {r.sku && <ChevronRight size={14} color={C.subtle} />}
    </button>))}</div>;
}
function ChatChart({ data, fmt }) {
  return <div style={{ height: 150, marginTop: 12 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}><defs><linearGradient id="cc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.blue} stopOpacity={0.3} /><stop offset="100%" stopColor={C.blue} stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} /><XAxis dataKey="x" tick={{ fontSize: 10, fill: C.subtle }} axisLine={false} tickLine={false} /><YAxis hide /><Tooltip content={<Tip fmt={fmt} />} /><Area type="monotone" dataKey="v" name="Value" stroke={C.blue} strokeWidth={2} fill="url(#cc)" /></AreaChart></ResponsiveContainer></div>;
}

function answerQuestion(q, skus, agg) {
  const t = q.toLowerCase().trim();
  const has = (...k) => k.some((x) => t.includes(x));
  const u = utilization(skus);
  const period = has("year", "annual") ? 365 : has("week") ? 7 : has("today", "day") ? 1 : 30;
  const periodLabel = period === 365 ? "this year" : period === 7 ? "this week" : period === 1 ? "today" : "this month";

  if (!t) return { text: "Ask me anything about your stock, sales, suppliers or what to order." };
  if (has("help", "what can you")) return { text: "I can answer things like: ‘sales this month’, ‘top sellers this week’, ‘what should I reorder’, ‘show dead stock’, ‘inventory turnover’, ‘compare stores’, ‘margin by category’, or ‘do we have the Pure Aero?’. Tap any product to open its full 360° view." };

  if (has("turnover", "utilization", "gmroi", "efficiency", "turns", "dsi", "sell-through", "sell through")) {
    return { text: `Inventory is turning ${u.turnover.toFixed(1)}× per year (≈ ${Math.round(u.dsi)} days of stock on hand). GMROI is ${u.gmroi.toFixed(2)} — every ₹1 of inventory cost returns ${u.gmroi.toFixed(2)} in gross margin. 30-day sell-through is ${Math.round(u.sellThrough * 100)}% and ${Math.round(u.deadRatio * 100)}% of value is dead.`,
      node: <ChatKpis items={[{ l: "Turnover", v: u.turnover.toFixed(1) + "×" }, { l: "GMROI", v: u.gmroi.toFixed(2) }, { l: "Sell-through", v: Math.round(u.sellThrough * 100) + "%" }, { l: "Dead %", v: Math.round(u.deadRatio * 100) + "%", c: C.dead }]} /> };
  }
  if (has("reorder", "order", "buy", "low stock", "stock out", "stockout", "running out", "restock")) {
    let rows = skus.filter((s) => s.risk <= 1);
    const brand = ["babolat", "wilson", "yonex", "head", "nike", "adidas", "asics", "solinco", "dunlop"].find((b) => t.includes(b));
    if (brand) rows = rows.filter((s) => s.supplier.toLowerCase().includes(brand));
    rows = rows.sort((a, b) => a.cover - b.cover).slice(0, 6);
    const rev = skus.filter((s) => s.risk <= 1).reduce((a, s) => a + s.protectedRev, 0);
    return { text: `${rows.length ? rows.length : "No"} ${brand ? brand + " " : ""}SKUs need reordering${brand ? "" : ` — ${inrC(rev)} of revenue is exposed across all at-risk items`}. Top priorities:`,
      node: rows.length ? <ChatList rows={rows.map((s) => ({ name: s.name, sub: `${isFinite(s.cover) ? Math.round(s.cover) + "d cover" : "no sales"} · suggest ${s.suggestedQty}`, right: "×" + s.suggestedQty, rightColor: RISK[s.risk].color, sku: s }))} /> : null };
  }
  if (has("dead", "slow", "clear", "markdown", "obsolete", "stuck")) {
    const dead = skus.filter((s) => s.risk === 4).sort((a, b) => b.stockValue - a.stockValue);
    const cash = dead.reduce((a, s) => a + s.stockValue, 0);
    return { text: `${inrC(cash)} is locked in ${dead.length} dead SKUs (no sale in 90+ days). Biggest offenders to mark down:`, node: <ChatList rows={dead.slice(0, 6).map((s) => ({ name: s.name, sub: `idle ${s.daysSinceSale}d · ${s.onHand} units`, right: inrC(s.stockValue), rightColor: C.dead, sku: s }))} /> };
  }
  if (has("top", "best sell", "bestsell", "best-sell", "selling")) {
    const top = topSellers(skus, period);
    return { text: `Top sellers ${periodLabel} (modeled from live catalog + seasonal velocity):`, node: <ChatList rows={top.slice(0, 6).map((s, i) => ({ rank: i, name: s.name, sub: `${s.category} · ${s.periodUnits} units`, right: inrC(s.periodRev), sku: s }))} /> };
  }
  if (has("margin", "profit", "gross")) {
    const m = {}; skus.forEach((s) => { (m[s.category] = m[s.category] || { gm: 0, rev: 0 }); m[s.category].gm += s.annualGM; m[s.category].rev += s.annualRev; });
    const rows = Object.entries(m).map(([c, v]) => ({ name: c, sub: `${Math.round(v.gm / (v.rev || 1) * 100)}% margin`, right: inrC(v.gm) })).sort((a, b) => parseFloat(b.right.replace(/[^\d.]/g, "")) - parseFloat(a.right.replace(/[^\d.]/g, ""))).slice(0, 7);
    const avg = Math.round(skus.reduce((a, s) => a + s.margin, 0) / skus.length * 100);
    return { text: `Blended gross margin is about ${avg}%. Annual gross profit by category (modeled):`, node: <ChatList rows={rows} /> };
  }
  if (has("store", "compare", "transfer", "branch", "location")) {
    const tot = {}; STORES.forEach((s) => (tot[s] = 0)); skus.forEach((s) => perStore(s).forEach((p) => (tot[p.store] += p.qty)));
    const rows = Object.entries(tot).map(([name, q]) => ({ name, sub: "units on hand", right: q.toLocaleString("en-IN") })).sort((a, b) => b.right - a.right);
    return { text: `Stock spread across your ${STORES.length} stores. tennisoutlet carries the most; consider transfers from overstocked branches before reordering:`, node: <ChatList rows={rows} /> };
  }
  if (has("sales", "revenue", "how are we", "performance", "doing")) {
    const rev = period === 1 ? agg.dayRev : period === 7 ? agg.weekRev : period === 365 ? agg.yearRev : agg.monthRev;
    return { text: `Revenue ${periodLabel} is ${inrC(rev)} (modeled). ${MONTHS[MONTH]} sits in the off-season dip — the 12-month shape:`, node: <ChatChart data={agg.months.map((m) => ({ x: m.m, v: m.rev }))} fmt={inrC} /> };
  }
  if (has("forecast", "predict", "demand", "season")) {
    return { text: `The model shapes demand by the tennis calendar. Right now (June) is a lull; demand climbs from September into the pre-season peak (Oct). 12-month group revenue forecast:`, node: <ChatChart data={agg.months.map((m) => ({ x: m.m, v: m.rev }))} fmt={inrC} /> };
  }
  // product lookup / fallback
  const terms = t.replace(/[^a-z0-9 ]/g, "").split(" ").filter((w) => w.length > 2 && !["the", "do", "we", "have", "any", "stock", "show", "find", "much", "many", "for", "with", "and"].includes(w));
  let matches = skus.filter((s) => terms.some((w) => s.name.toLowerCase().includes(w) || s.sku.toLowerCase().includes(w) || s.supplier.toLowerCase().includes(w)));
  if (matches.length) {
    matches = matches.slice(0, 6);
    return { text: `Found ${matches.length} matching product${matches.length === 1 ? "" : "s"}. Tap any for the full 360° view:`, node: <ChatList rows={matches.map((s) => ({ name: s.name, sub: `${s.onHand} on hand · ${isFinite(s.cover) ? Math.round(s.cover) + "d cover" : "no sales"}`, right: RISK[s.risk].label, rightColor: RISK[s.risk].color, sku: s }))} /> };
  }
  return { text: "I couldn't match that to a product or metric. Try ‘what should I reorder’, ‘top sellers this month’, ‘inventory turnover’, ‘dead stock’, or a product/brand name." };
}

function AskBaseline({ skus, agg, role }) {
  const starters = {
    exec: ["How are we doing this month?", "Show inventory turnover", "What's our dead stock?", "Top sellers this year"],
    procurement: ["What should I reorder?", "Reorder from Babolat", "Compare store stock", "Margin by category"],
    employee: ["Do we have the Pure Aero?", "What's low on stock?", "Find Solinco strings", "Top sellers today"],
  }[role];
  const [msgs, setMsgs] = useState([{ who: "bot", text: `Hi — I'm Baseline, your inventory copilot. I'm reading ${CATALOG.totalProducts.toLocaleString("en-IN")} live products. Ask me anything, or tap a suggestion below.` }]);
  const [val, setVal] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  const send = (q) => { const text = (q ?? val).trim(); if (!text) return; const a = answerQuestion(text, skus, agg); setMsgs((m) => [...m, { who: "me", text }, { who: "bot", ...a }]); setVal(""); };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 230px)", minHeight: 460, background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: C.purple + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}><Bot size={19} color={C.purple} /></div>
        <div><div style={{ fontSize: 15, fontWeight: 600 }}>Ask Baseline</div><div style={{ fontSize: 11, color: C.success, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: C.success }} /> grounded in live catalog + the replenishment engine</div></div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14, background: C.bg }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.who === "me" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: m.who === "me" ? "78%" : "88%", background: m.who === "me" ? C.navy : C.surface, color: m.who === "me" ? "#fff" : C.text, border: m.who === "me" ? "none" : `1px solid ${C.border}`, borderRadius: 14, padding: "11px 14px" }}>
              {m.who === "bot" && <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><Sparkles size={13} color={C.purple} /><span style={{ fontSize: 11, fontWeight: 600, color: C.purple }}>Baseline</span></div>}
              <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{m.text}</div>
              {m.node}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>{starters.map((s) => <button key={s} onClick={() => send(s)} style={{ ...btnGhost, fontWeight: 500, color: C.muted }}>{s}</button>)}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask about stock, sales, suppliers, what to order…" style={{ flex: 1, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: "10px 14px", fontSize: 14, outline: "none", color: C.text, background: C.surface }} />
          <button onClick={() => send()} style={{ ...btnPrimary, padding: "0 16px" }}><Send size={16} /></button>
        </div>
      </div>
    </div>
  );
}

/* ============================ SKU 360 DRAWER ============================ */
function SkuDrawer({ s, onClose, onAddPo }) {
  if (!s) return null;
  const stores = perStore(s);
  const fc = MONTHS.map((m, i) => ({ m, units: Math.round(s.avgDaily * seasonIdx(s.category, i) * 30), cur: i === MONTH }));
  const r = RISK[s.risk];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(14,23,38,.4)" }} />
      <div style={{ position: "relative", width: 460, maxWidth: "92vw", height: "100%", background: C.surface, boxShadow: "-8px 0 40px rgba(14,23,38,.2)", overflowY: "auto" }}>
        <div style={{ position: "sticky", top: 0, background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div><div style={{ fontSize: 10, fontWeight: 600, color: C.subtle, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>SKU 360</div><div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{s.name}</div><div style={{ fontSize: 12, color: C.subtle, fontFamily: mono, marginTop: 3 }}>{s.sku} · {s.category} · {s.supplier}</div></div>
          <button onClick={onClose} style={{ border: "none", background: C.surfaceAlt, borderRadius: 8, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={16} color={C.muted} /></button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><RiskBadge level={s.risk} /><span style={{ fontSize: 12, color: C.subtle }}>forecast accuracy <b style={{ color: s.accuracy >= .92 ? C.success : s.accuracy >= .87 ? C.warning : C.danger }}>{Math.round(s.accuracy * 100)}%</b></span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[{ l: "On hand", v: s.onHand + (s.inTransit ? ` +${s.inTransit}` : "") }, { l: "Days cover", v: isFinite(s.cover) ? Math.round(s.cover) + "d" : "—" }, { l: "Forecast/day", v: s.forecastDaily.toFixed(2) }, { l: "Price", v: inr(s.price) }, { l: "Unit cost", v: inr(s.unitCost) }, { l: "Margin", v: Math.round(s.margin * 100) + "%" }].map((k, i) => (
              <div key={i} style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px" }}><div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", fontWeight: 600 }}>{k.l}</div><div style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, marginTop: 3 }}>{k.v}</div></div>
            ))}
          </div>
          <div><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>12-month demand forecast (seasonal)</div>
            <div style={{ height: 150 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={fc} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} /><XAxis dataKey="m" tick={{ fontSize: 9, fill: C.subtle }} axisLine={false} tickLine={false} interval={0} /><YAxis hide /><Tooltip content={<Tip fmt={(v) => v + " units"} />} cursor={{ fill: C.surfaceAlt }} /><Bar dataKey="units" radius={[4, 4, 0, 0]}>{fc.map((e, i) => <Cell key={i} fill={e.cur ? C.optic : C.blue} />)}</Bar></BarChart></ResponsiveContainer></div></div>
          <div><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Stock across {STORES.length} stores</div>
            {stores.map((st) => (<div key={st.store} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
              <Store size={14} color={C.subtle} /><span style={{ fontSize: 12, width: 120, color: C.muted }}>{st.store}</span>
              <div style={{ flex: 1, height: 8, background: C.border, borderRadius: 999 }}><div style={{ height: 8, width: (s.onHand ? (st.qty / s.onHand) * 100 : 0) + "%", background: st.store === "tennisoutlet" ? C.optic : C.blue, borderRadius: 999 }} /></div>
              <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, width: 28, textAlign: "right" }}>{st.qty}</span></div>))}
          </div>
          <div style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}><Zap size={14} color={C.purple} /><span style={{ fontSize: 13, fontWeight: 600 }}>Recommended action</span></div>
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
              {s.risk <= 1 ? `Reorder ${s.suggestedQty} units from ${s.supplier} (${s.effLead}d lead). At ${s.forecastDaily.toFixed(1)}/day it covers the next ${Math.round(s.effLead + 15)} days plus safety.`
                : s.risk === 4 ? `No sales in ${s.daysSinceSale} days. ${inrC(s.stockValue)} is tied up — mark down to clear and recover cash.`
                : s.risk === 3 ? `Overstocked (~${Math.round(s.cover)}d cover). Pause reordering; redistribute to a store that's short.`
                : `Healthy — ${Math.round(s.cover)} days of cover. No action needed.`}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {s.suggestedQty > 0 && <button onClick={() => { onAddPo(s); onClose(); }} style={{ ...btnPrimary, padding: "8px 14px" }}><Plus size={14} /> Add {s.suggestedQty} to PO</button>}
              {s.risk >= 3 && <button style={{ ...btnGhost, color: C.clay, borderColor: C.clay + "55" }}>Mark down</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ VIEWS ============================ */
function SourceBar({ inline }) {
  return (<div style={{ display: "flex", alignItems: "center", gap: 12, ...(inline ? {} : { background: C.navy, borderRadius: 14, padding: "12px 18px", color: "#fff" }) }}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: inline ? C.muted : "#fff" }}><span style={{ width: 7, height: 7, borderRadius: 999, background: C.success }} /> Catalog: <b style={{ color: inline ? C.success : C.optic }}>live</b> · {CATALOG.totalProducts.toLocaleString("en-IN")} products</span>
    {!inline && <span style={{ fontSize: 12, color: "#A7B0C0" }}>Stock &amp; sales: modeled — grant the integration <code style={{ background: "#1F2E4D", padding: "1px 5px", borderRadius: 4 }}>Sales</code> &amp; <code style={{ background: "#1F2E4D", padding: "1px 5px", borderRadius: 4 }}>Inventory</code> scopes to go fully live.</span>}
    {!inline && <span style={{ marginLeft: "auto", fontSize: 11, color: "#7C8696" }}>{STORES.length} stores · INR</span>}
  </div>);
}

function Executive({ skus, agg, go }) {
  const [tsP, setTsP] = useState(30);
  const deadValue = skus.filter((s) => s.risk === 4).reduce((a, s) => a + s.stockValue, 0);
  const gm = Math.round(skus.reduce((a, s) => a + s.margin, 0) / skus.length * 100);
  const u = utilization(skus);
  const top = topSellers(skus, tsP);
  const insights = buildInsights(skus, agg, "exec");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SourceBar />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
        <Kpi label="Sales today" value={inrC(agg.dayRev)} delta={8} Icon={IndianRupee} sub="modeled" />
        <Kpi label="This month" value={inrC(agg.monthRev)} delta={-4} Icon={TrendingUp} sub="off-season" />
        <Kpi label="Gross margin" value={gm + "%"} delta={2} Icon={Award} />
        <Kpi label="Inventory turns" value={u.turnover.toFixed(1) + "×"} delta={5} Icon={Repeat} sub="per year" />
        <Kpi label="Cash in dead stock" value={inrC(deadValue)} delta={6} intent="negative" tone={C.dead} Icon={Snowflake} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18 }}>
        <Card title="Revenue — 12-month seasonal view" subtitle="modeled from live catalog · tennis-calendar shape">
          <div style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={agg.months} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}><defs><linearGradient id="exrev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.blue} stopOpacity={0.3} /><stop offset="100%" stopColor={C.blue} stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} /><XAxis dataKey="m" tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => "₹" + Math.round(v / 1e5) + "L"} /><Tooltip content={<Tip fmt={inrC} />} /><ReferenceLine x="Jun" stroke={C.borderStrong} strokeDasharray="2 2" /><Area type="monotone" dataKey="rev" name="Revenue" stroke={C.blue} strokeWidth={2.5} fill="url(#exrev)" /></AreaChart></ResponsiveContainer></div>
        </Card>
        <Card title="AI executive briefing" subtitle="generated from live signals" action={<Sparkles size={15} color={C.purple} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{insights.slice(0, 4).map((ins, i) => (<div key={i} style={{ display: "flex", gap: 9 }}><ins.icon size={15} color={ins.color} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{ins.text}{ins.to && <button onClick={() => go(ins.to)} style={{ ...btnGhost, padding: "1px 7px", marginLeft: 6, fontSize: 11 }}>{ins.action} →</button>}</div></div>))}</div>
        </Card>
      </div>
      <Card title="Top sellers" subtitle="ranked by modeled revenue · tap a product for its 360° view" action={<Segment value={tsP} onChange={setTsP} options={[{ v: 1, l: "Day" }, { v: 7, l: "Week" }, { v: 30, l: "Month" }, { v: 365, l: "Year" }]} />} pad={0}>
        <OpsTable rows={top} cols={["product", "cat", "units", "rev"]} />
      </Card>
    </div>
  );
}

function Sales({ skus, agg }) {
  const [period, setPeriod] = useState(30);
  const top = topSellers(skus, period);
  const series = period === 1 ? agg.days.map((d) => ({ x: "D" + d.d, rev: d.rev })) : period === 365 ? agg.months.map((m) => ({ x: m.m, rev: m.rev })) : period === 7 ? agg.weeks.slice(-8).map((w) => ({ x: w.w, rev: w.rev / 7 })) : agg.weeks.map((w) => ({ x: w.w, rev: w.rev }));
  const periodRev = period === 1 ? agg.dayRev : period === 7 ? agg.weekRev : period === 365 ? agg.yearRev : agg.monthRev;
  const lbl = period === 1 ? "today" : period === 7 ? "this week" : period === 365 ? "this year" : "this month";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><SourceBar inline /><Segment value={period} onChange={setPeriod} options={[{ v: 1, l: "Day" }, { v: 7, l: "Week" }, { v: 30, l: "Month" }, { v: 365, l: "Year" }]} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        <Kpi label={`Revenue ${lbl}`} value={inrC(periodRev)} delta={period === 30 ? -4 : 7} Icon={IndianRupee} />
        <Kpi label="Orders (modeled)" value={Math.round(periodRev / 2400).toLocaleString("en-IN")} delta={5} Icon={ShoppingCart} />
        <Kpi label="Avg order value" value={inr(2400)} delta={3} Icon={Wallet} />
        <Kpi label="Units sold" value={top.reduce((a, s) => a + s.periodUnits, 0).toLocaleString("en-IN") + "+"} delta={4} Icon={Boxes} />
      </div>
      <Card title="Revenue trend"><div style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} /><XAxis dataKey="x" tick={{ fontSize: 10, fill: C.subtle }} axisLine={false} tickLine={false} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1e5 ? "₹" + Math.round(v / 1e5) + "L" : "₹" + Math.round(v / 1e3) + "k"} /><Tooltip content={<Tip fmt={inrC} />} /><Line type="monotone" dataKey="rev" name="Revenue" stroke={C.blue} strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer></div></Card>
      <Card title={`Top sellers — ${lbl}`} subtitle="tap a product for its 360° view" pad={0}><OpsTable rows={top} cols={["rank", "product", "cat", "units", "rev"]} /></Card>
    </div>
  );
}

function Analytics({ skus, agg }) {
  const u = utilization(skus);
  const abc = useMemo(() => abcClasses(skus), [skus]);
  const anoms = anomalies(skus);
  const stores = useMemo(() => { const t = {}; STORES.forEach((s) => (t[s] = { units: 0, value: 0 })); skus.forEach((s) => perStore(s).forEach((p) => { t[p.store].units += p.qty; t[p.store].value += p.qty * s.unitCost; })); return Object.entries(t).map(([name, v]) => ({ name, ...v })); }, [skus]);
  const turnByCat = useMemo(() => { const m = {}; skus.forEach((s) => { (m[s.category] = m[s.category] || { cogs: 0, inv: 0 }); m[s.category].cogs += s.avgDaily * seasonAvg(s.category) * s.unitCost * 365; m[s.category].inv += s.stockValue; }); return Object.entries(m).map(([name, v]) => ({ name, turns: v.inv > 0 ? +(v.cogs / v.inv).toFixed(1) : 0 })).sort((a, b) => b.turns - a.turns); }, [skus]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
        <Kpi label="Inventory turnover" value={u.turnover.toFixed(1) + "×"} delta={5} Icon={Repeat} sub="per year" />
        <Kpi label="Days of inventory" value={Math.round(u.dsi) + "d"} delta={-6} Icon={CalendarDays} />
        <Kpi label="GMROI" value={u.gmroi.toFixed(2)} delta={4} Icon={Scale} sub="₹ GM / ₹ cost" />
        <Kpi label="30-day sell-through" value={Math.round(u.sellThrough * 100) + "%"} delta={3} Icon={Percent} />
        <Kpi label="Capital efficiency" value={u.capitalEff.toFixed(1) + "×"} delta={2} Icon={Gauge} sub="sales / inv ₹" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Card title="ABC analysis (Pareto)" subtitle="where your revenue actually concentrates">
          {["A", "B", "C"].map((cls) => { const meta = { A: { c: C.success, d: "top ~80% of revenue" }, B: { c: C.warning, d: "next ~15%" }, C: { c: C.subtle, d: "long tail ~5%" } }[cls]; const tot = abc.A.v + abc.B.v + abc.C.v || 1; return (
            <div key={cls} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}><span style={{ fontSize: 13, fontWeight: 600 }}><span style={{ color: meta.c }}>Class {cls}</span> · {abc[cls].n} SKUs</span><span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{inrC(abc[cls].v)}</span></div>
              <div style={{ height: 8, background: C.border, borderRadius: 999 }}><div style={{ height: 8, width: (abc[cls].v / tot) * 100 + "%", background: meta.c, borderRadius: 999 }} /></div>
              <div style={{ fontSize: 11, color: C.subtle, marginTop: 4 }}>{meta.d}</div>
            </div>); })}
        </Card>
        <Card title="Inventory turns by category" subtitle="higher = capital working harder">
          <div style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={turnByCat} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} /><XAxis type="number" tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => v + "×"} /><YAxis type="category" dataKey="name" width={78} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} /><Tooltip content={<Tip fmt={(v) => v + "× / yr"} />} cursor={{ fill: C.surfaceAlt }} /><Bar dataKey="turns" radius={[0, 6, 6, 0]}>{turnByCat.map((e, i) => <Cell key={i} fill={e.turns >= 4 ? C.success : e.turns >= 2 ? C.warning : C.danger} />)}</Bar></BarChart></ResponsiveContainer></div>
        </Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Card title="Store comparison" subtitle="stock distribution across the 6-store group">
          {stores.sort((a, b) => b.value - a.value).map((st) => { const mx = Math.max(...stores.map((x) => x.value)) || 1; return (
            <div key={st.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}><Store size={14} color={C.subtle} /><span style={{ fontSize: 12, width: 116, color: C.muted }}>{st.name}</span><div style={{ flex: 1, height: 8, background: C.border, borderRadius: 999 }}><div style={{ height: 8, width: (st.value / mx) * 100 + "%", background: st.name === "tennisoutlet" ? C.optic : C.blue, borderRadius: 999 }} /></div><span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, width: 64, textAlign: "right" }}>{inrC(st.value)}</span></div>); })}
          <div style={{ fontSize: 11, color: C.subtle, marginTop: 8 }}>Transfer suggestions appear in Auto-PO when one store is short and another is overstocked.</div>
        </Card>
        <Card title="Anomaly detection" subtitle="unusual movements the AI flagged" action={<Activity size={15} color={C.purple} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>{anoms.map((a, i) => (<div key={i} style={{ display: "flex", gap: 9 }}>{a.sev === "down" ? <TrendingDown size={15} color={C.danger} style={{ flexShrink: 0, marginTop: 2 }} /> : <TrendingUp size={15} color={C.success} style={{ flexShrink: 0, marginTop: 2 }} />}<div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{a.text}</div></div>))}{anoms.length === 0 && <div style={{ fontSize: 13, color: C.subtle }}>No anomalies detected.</div>}</div>
        </Card>
      </div>
    </div>
  );
}

function StockoutRadar({ skus, onAddPo }) {
  const rows = useMemo(() => skus.filter((s) => s.risk <= 1).sort((a, b) => a.cover - b.cover), [skus]);
  return <Card title={`Stockout radar — ${rows.length} SKUs need attention`} subtitle="ranked by forecasted days of cover · tap a product for its 360° view" pad={0}><OpsTable rows={rows} onAddPo={onAddPo} cols={["product", "risk", "cover", "acc", "onhand", "suggest", "action"]} /></Card>;
}
function Suppliers({ skus }) {
  const map = {}; skus.forEach((s) => { const m = (map[s.supplier] = map[s.supplier] || { supplier: s.supplier, skus: 0, spend: 0, onOrder: 0, lead: s.leadTime }); m.skus++; m.spend += s.stockValue; m.onOrder += s.suggestedQty * s.unitCost; });
  const OTIF = { Babolat: .94, Wilson: .91, Yonex: .88, Head: .90, Adidas: .86, Asics: .89, Solinco: .95, Dunlop: .9, Tecnifibre: .9, "House / Other": .9 };
  const rows = Object.values(map).map((m) => ({ ...m, otif: OTIF[m.supplier] ?? .9 })).sort((a, b) => b.spend - a.spend);
  const td = { padding: "11px 14px", fontSize: 13, borderTop: `1px solid ${C.border}` };
  return (<Card title="Supplier scorecard" subtitle="reliability, spend and open orders by vendor" pad={0}><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Supplier", "SKUs", "Lead", "OTIF", "Stock value", "Suggested order"].map((h, i) => <th key={h} style={{ textAlign: i === 0 ? "left" : "right", fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.muted, padding: "11px 14px", background: C.surfaceAlt }}>{h}</th>)}</tr></thead><tbody>{rows.map((m) => (<tr key={m.supplier} onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceAlt)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}><td style={{ ...td, fontWeight: 500 }}>{m.supplier}</td><td style={{ ...td, textAlign: "right", fontFamily: mono }}>{m.skus}</td><td style={{ ...td, textAlign: "right", fontFamily: mono }}>{m.lead}d</td><td style={{ ...td, textAlign: "right" }}><span style={{ fontFamily: mono, fontWeight: 600, color: m.otif >= .92 ? C.success : m.otif >= .88 ? C.warning : C.danger }}>{Math.round(m.otif * 100)}%</span></td><td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inrC(m.spend)}</td><td style={{ ...td, textAlign: "right", fontFamily: mono, color: m.onOrder > 0 ? C.text : C.subtle }}>{m.onOrder > 0 ? inrC(m.onOrder) : "—"}</td></tr>))}</tbody></table></div></Card>);
}
function OpsTable({ rows, onAddPo, cols }) {
  const H = ({ c, r }) => <th style={{ textAlign: r ? "right" : "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", color: C.muted, padding: "11px 14px", position: "sticky", top: 0, background: C.surfaceAlt }}>{c}</th>;
  const td = { padding: "11px 14px", fontSize: 13, borderTop: `1px solid ${C.border}` };
  return (<div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>
    {cols.includes("rank") && <H c="#" />}{cols.includes("product") && <H c="Product" />}{cols.includes("risk") && <H c="Status" />}{cols.includes("cover") && <H c="Forecast cover" />}
    {cols.includes("cat") && <H c="Category" />}{cols.includes("acc") && <H c="Accuracy" r />}{cols.includes("age") && <H c="Age" r />}{cols.includes("onhand") && <H c="On hand" r />}
    {cols.includes("units") && <H c="Units" r />}{cols.includes("rev") && <H c="Revenue" r />}{cols.includes("suggest") && <H c="Suggested" r />}{cols.includes("value") && <H c="Stock value" r />}{cols.includes("action") && <H c="Action" r />}{cols.includes("markdown") && <H c="Action" r />}
  </tr></thead><tbody>{rows.map((s, i) => (<tr key={s.sku} onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceAlt)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
    {cols.includes("rank") && <td style={{ ...td, fontFamily: mono, color: i < 3 ? C.clay : C.subtle, fontWeight: 600, width: 36 }}>{i + 1}</td>}
    {cols.includes("product") && <td style={td}><ProductCell s={s} /></td>}
    {cols.includes("risk") && <td style={td}><RiskBadge level={s.risk} /></td>}
    {cols.includes("cover") && <td style={td}><CoverMeter s={s} /></td>}
    {cols.includes("cat") && <td style={{ ...td, color: C.muted }}>{s.category}</td>}
    {cols.includes("acc") && <td style={{ ...td, textAlign: "right" }}><span style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: s.accuracy >= .92 ? C.success : s.accuracy >= .87 ? C.warning : C.danger }}>{Math.round(s.accuracy * 100)}%</span></td>}
    {cols.includes("age") && <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{s.age}d</td>}
    {cols.includes("onhand") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{s.onHand}{s.inTransit > 0 ? <span style={{ color: C.info, fontWeight: 500 }}> +{s.inTransit}</span> : ""}</td>}
    {cols.includes("units") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{s.periodUnits}</td>}
    {cols.includes("rev") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inrC(s.periodRev)}</td>}
    {cols.includes("suggest") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600, color: s.suggestedQty > 0 ? C.text : C.subtle }}>{s.suggestedQty || "—"}</td>}
    {cols.includes("value") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inrC(s.stockValue)}</td>}
    {cols.includes("action") && <td style={{ ...td, textAlign: "right" }}><button disabled={!s.suggestedQty} onClick={() => onAddPo && onAddPo(s)} style={{ ...btnPrimary, ...(s.suggestedQty ? {} : { background: C.border, color: C.subtle, cursor: "not-allowed" }) }}><Plus size={13} /> Add {s.suggestedQty || ""}</button></td>}
    {cols.includes("markdown") && <td style={{ ...td, textAlign: "right" }}><button style={{ ...btnGhost, color: C.clay, borderColor: C.clay + "55" }}>Mark down</button></td>}
  </tr>))}</tbody></table></div>);
}
function ForecastWhatIf({ surge, setSurge, delay, setDelay, skus }) {
  const atRisk = skus.filter((s) => s.risk <= 1).length, revAtRisk = skus.filter((s) => s.risk <= 1).reduce((a, s) => a + s.protectedRev, 0);
  const top = [...skus].sort((a, b) => b.protectedRev - a.protectedRev).slice(0, 8);
  const S = ({ label, hint, value, min, max, step, unit, onChange, color }) => (<div><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span><span style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color }}>{value}{unit}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: color }} /><div style={{ fontSize: 11, color: C.subtle, marginTop: 4 }}>{hint}</div></div>);
  return (<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
    <Card title="What-if simulator" subtitle="stress-test demand surges and supplier delays — recomputes live"><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 8 }}><S label="Demand surge" hint="e.g. tournament / season start" value={surge} min={0} max={100} step={5} unit="%" onChange={setSurge} color={C.clay} /><S label="Supplier delay" hint="added to every lead time" value={delay} min={0} max={21} step={1} unit="d" onChange={setDelay} color={C.warning} /></div><div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 12 }}><Kpi label="SKUs at risk" value={atRisk} tone={atRisk > 40 ? C.danger : C.warning} Icon={AlertTriangle} sub="this scenario" /><Kpi label="Revenue exposed" value={inrC(revAtRisk)} tone={C.danger} Icon={IndianRupee} /><Kpi label="Scenario" value={surge === 0 && delay === 0 ? "Baseline" : "Stressed"} Icon={Activity} sub={`+${surge}% · +${delay}d`} /></div></Card>
    <Card title="Highest revenue at risk" subtitle="tap a product for its 360° view" pad={0}><OpsTable rows={top} cols={["product", "risk", "cover", "acc", "onhand"]} /></Card>
  </div>);
}
function DeadStock({ skus }) {
  const rows = useMemo(() => skus.filter((s) => s.risk === 4 || s.risk === 3).sort((a, b) => b.stockValue - a.stockValue).slice(0, 40), [skus]);
  const trapped = skus.filter((s) => s.risk === 4 || s.risk === 3).reduce((a, s) => a + s.stockValue, 0);
  return (<div style={{ display: "flex", flexDirection: "column", gap: 18 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}><Kpi label="Cash locked in slow stock" value={inrC(trapped)} tone={C.dead} Icon={Snowflake} /><Kpi label="Dead SKUs (no sale 90d+)" value={skus.filter((s) => s.risk === 4).length} tone={C.dead} Icon={Snowflake} /><Kpi label="Overstocked SKUs" value={skus.filter((s) => s.risk === 3).length} tone={C.overstock} Icon={Layers} /></div><Card title="Markdown & clearance candidates" subtitle="highest trapped cash first · tap for 360° view" pad={0}><OpsTable rows={rows} cols={["product", "risk", "age", "onhand", "value", "markdown"]} /></Card></div>);
}
function AutoPO({ skus, poItems, approved, setApproved, budget, setBudget }) {
  const result = useMemo(() => {
    const merged = {}; skus.filter((s) => s.suggestedQty > 0).forEach((s) => (merged[s.sku] = { ...s, qty: s.suggestedQty })); poItems.forEach((s) => (merged[s.sku] = { ...s, qty: s.suggestedQty }));
    const ranked = Object.values(merged).sort((a, b) => b.protectedRev - a.protectedRev); let spent = 0; ranked.forEach((s) => { const c = s.qty * s.unitCost; s._def = budget > 0 && spent + c > budget; if (!s._def) spent += c; });
    const bySup = {}; ranked.forEach((s) => (bySup[s.supplier] = bySup[s.supplier] || []).push(s));
    const drafts = Object.entries(bySup).map(([supplier, items]) => ({ supplier, items: items.slice(0, 6), total: items.filter((i) => !i._def).reduce((a, s) => a + s.qty * s.unitCost, 0), lead: items[0].leadTime })).filter((d) => d.total > 0).sort((a, b) => b.total - a.total).slice(0, 6);
    return { spent, drafts };
  }, [skus, poItems, budget]);
  return (<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
    <Card title="Cash-aware purchasing" subtitle="set an open-to-buy budget — Baseline funds the highest-revenue-at-risk lines first"><div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Wallet size={16} color={C.muted} /><span style={{ fontSize: 13, color: C.muted }}>Open-to-buy budget</span></div><input type="range" min={0} max={4000000} step={100000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} style={{ flex: 1, minWidth: 180, accentColor: C.optic }} /><span style={{ fontFamily: mono, fontWeight: 600, fontSize: 16, minWidth: 100, textAlign: "right" }}>{budget === 0 ? "No cap" : inrC(budget)}</span><span style={{ fontSize: 12, color: C.subtle }}>committing {inrC(result.spent)}</span></div></Card>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 18, alignItems: "start" }}>{result.drafts.map((d) => { const ap = approved.includes(d.supplier); return (
      <div key={d.supplier} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${ap ? C.success : C.border}`, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", background: ap ? C.success + "10" : C.surfaceAlt, borderBottom: `1px solid ${C.border}` }}><div><div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>{d.supplier}{ap ? <span style={{ fontSize: 11, color: C.success, display: "inline-flex", gap: 3 }}><Check size={13} /> Approved</span> : <span style={{ fontSize: 10, fontWeight: 600, color: C.opticInk, background: C.optic, padding: "2px 7px", borderRadius: 999 }}>SUGGESTED</span>}</div><div style={{ fontSize: 11, color: C.subtle }}>Lead {d.lead}d · {d.items.length} lines</div></div><div style={{ fontFamily: mono, fontSize: 18, fontWeight: 600 }}>{inrC(d.total)}</div></div>
        <div style={{ padding: "6px 18px" }}>{d.items.map((s, i) => (<div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < d.items.length - 1 ? `1px solid ${C.border}` : "none", opacity: s._def ? 0.45 : 1 }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>on hand {s.onHand} · {inr(s.unitCost)}/u{s._def ? " · deferred" : ""}</div></div><div style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, textAlign: "right" }}>×{s.qty}<div style={{ fontSize: 11, fontWeight: 400, color: C.muted }}>{inrC(s.qty * s.unitCost)}</div></div></div>))}</div>
        <div style={{ display: "flex", gap: 8, padding: "0 18px 16px" }}>{ap ? <button onClick={() => setApproved(approved.filter((x) => x !== d.supplier))} style={{ ...btnGhost, flex: 1 }}><RefreshCw size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} /> Undo</button> : <><button onClick={() => setApproved([...approved, d.supplier])} style={{ ...btnPrimary, flex: 1, justifyContent: "center", padding: "9px 12px", fontSize: 13 }}><Truck size={14} /> Approve &amp; send</button><button style={btnGhost}>Edit</button></>}</div>
      </div>); })}</div>
  </div>);
}
function Tasks({ skus, onAddPo }) {
  const reorder = skus.filter((s) => s.risk <= 1).sort((a, b) => a.cover - b.cover).slice(0, 8);
  const incoming = skus.filter((s) => s.inTransit > 0).slice(0, 6);
  const [done, setDone] = useState([]);
  return (<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}><Kpi label="To reorder today" value={reorder.length} tone={C.warning} Icon={ClipboardList} /><Kpi label="Incoming to receive" value={incoming.length} tone={C.info} Icon={Inbox} /><Kpi label="Tasks done" value={done.length} tone={C.success} Icon={CheckCircle2} /></div>
    <Card title="Reorder checklist" subtitle="tick off as you go · tap a name for the 360° view" pad={0}><div style={{ padding: "4px 18px" }}>{reorder.map((s, i) => (<div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < reorder.length - 1 ? `1px solid ${C.border}` : "none", opacity: done.includes(s.sku) ? 0.5 : 1 }}><button onClick={() => setDone((d) => d.includes(s.sku) ? d.filter((x) => x !== s.sku) : [...d, s.sku])} style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${done.includes(s.sku) ? C.success : C.borderStrong}`, background: done.includes(s.sku) ? C.success : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{done.includes(s.sku) && <Check size={14} color="#fff" />}</button><div style={{ flex: 1, minWidth: 0 }}><ProductCell s={s} /></div><RiskBadge level={s.risk} /><button onClick={() => onAddPo(s)} style={btnPrimary}><Plus size={13} /> {s.suggestedQty}</button></div>))}</div></Card>
    <Card title="Incoming stock to receive" subtitle="mark received when it arrives" pad={0}><div style={{ padding: "4px 18px" }}>{incoming.length === 0 ? <div style={{ fontSize: 13, color: C.subtle, padding: "10px 0" }}>Nothing in transit right now.</div> : incoming.map((s, i) => (<div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < incoming.length - 1 ? `1px solid ${C.border}` : "none" }}><Truck size={16} color={C.info} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>{s.sku}</div></div><span style={{ fontFamily: mono, fontWeight: 600, color: C.info }}>+{s.inTransit}</span><button style={btnGhost}>Receive</button></div>))}</div></Card>
  </div>);
}
function Lookup({ skus }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? skus.filter((s) => s.name.toLowerCase().includes(t) || s.sku.toLowerCase().includes(t) || s.supplier.toLowerCase().includes(t)) : skus).slice(0, 40); }, [q, skus]);
  return (<div style={{ display: "flex", flexDirection: "column", gap: 14 }}><div style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface, borderRadius: 12, padding: "12px 16px", border: `1px solid ${C.border}` }}><Search size={18} color={C.subtle} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any product, SKU or brand…" style={{ border: "none", background: "transparent", outline: "none", fontSize: 15, width: "100%", color: C.text }} /></div><Card title={`${rows.length} product${rows.length === 1 ? "" : "s"}`} pad={0}><OpsTable rows={rows} cols={["product", "risk", "cover", "onhand", "value"]} /></Card></div>);
}
function Insights({ skus, agg, role, go }) {
  const insights = buildInsights(skus, agg, role);
  const actions = [{ icon: ClipboardList, label: "Draft all suggested POs", to: "po", color: C.optic }, { icon: Snowflake, label: "Review dead stock to clear", to: "dead", color: C.dead }, { icon: Activity, label: "Run a what-if scenario", to: "forecast", color: C.warning }, { icon: MessageSquare, label: "Ask Baseline a question", to: "ask", color: C.purple }];
  return (<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
    <Card title="Baseline AI — what to do now" subtitle="generated from live catalog + the replenishment engine" action={<Sparkles size={16} color={C.purple} />}><div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{insights.map((ins, i) => (<div key={i} style={{ display: "flex", gap: 11, paddingBottom: i < insights.length - 1 ? 14 : 0, borderBottom: i < insights.length - 1 ? `1px solid ${C.border}` : "none" }}><div style={{ width: 30, height: 30, borderRadius: 8, background: ins.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ins.icon size={16} color={ins.color} /></div><div style={{ fontSize: 13.5, lineHeight: 1.55, paddingTop: 4 }}>{ins.text}{ins.to && <button onClick={() => go(ins.to)} style={{ ...btnGhost, padding: "2px 8px", marginLeft: 8, fontSize: 11 }}>{ins.action} →</button>}</div></div>))}</div></Card>
    <Card title="Quick actions"><div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>{actions.map((a) => (<button key={a.label} onClick={() => go(a.to)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.surfaceAlt, cursor: "pointer", textAlign: "left" }}><div style={{ width: 34, height: 34, borderRadius: 9, background: a.color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}><a.icon size={17} color={a.color === C.optic ? C.opticInk : a.color} /></div><span style={{ fontSize: 14, fontWeight: 500 }}>{a.label}</span><ArrowRight size={15} color={C.subtle} style={{ marginLeft: "auto" }} /></button>))}</div></Card>
  </div>);
}

/* ============================ SHELL ============================ */
const ROLES = {
  exec: { label: "CEO / CXO", Icon: Crown, nav: ["executive", "sales", "analytics", "dead", "ask", "insights"], home: "executive" },
  procurement: { label: "Procurement", Icon: ShoppingCart, nav: ["radar", "forecast", "po", "suppliers", "analytics", "ask", "insights"], home: "radar" },
  employee: { label: "Store team", Icon: Users, nav: ["tasks", "lookup", "ask"], home: "tasks" },
};
const VIEW_META = {
  executive: { label: "Executive overview", Icon: LayoutDashboard }, sales: { label: "Sales", Icon: TrendingUp },
  analytics: { label: "Analytics & utilization", Icon: Gauge }, radar: { label: "Stockout radar", Icon: Radar },
  forecast: { label: "Forecast & what-if", Icon: Activity }, po: { label: "Reorder / Auto-PO", Icon: ClipboardList },
  suppliers: { label: "Suppliers", Icon: Award }, dead: { label: "Dead stock", Icon: Snowflake },
  ask: { label: "Ask Baseline", Icon: Bot }, insights: { label: "AI insights", Icon: Sparkles },
  tasks: { label: "My tasks", Icon: ClipboardList }, lookup: { label: "Product lookup", Icon: Search },
};

export default function BaselineDashboard() {
  const [role, setRole] = useState("exec");
  const [tab, setTab] = useState(ROLES.exec.home);
  const [poItems, setPoItems] = useState([]);
  const [approved, setApproved] = useState([]);
  const [toast, setToast] = useState(null);
  const [surge, setSurge] = useState(0);
  const [delay, setDelay] = useState(0);
  const [budget, setBudget] = useState(0);
  const [sel, setSel] = useState(null);
  skuPortal.open = setSel;

  const skus = useMemo(() => buildSkus({ surge, delay }), [surge, delay]);
  const agg = useMemo(() => salesAgg(skus), [skus]);
  const alerts = skus.filter((s) => s.risk <= 1);
  const switchRole = (r) => { setRole(r); setTab(ROLES[r].home); };
  const go = (t) => setTab(t);
  const addPo = (s) => { setPoItems((p) => (p.find((x) => x.sku === s.sku) ? p : [...p, s])); setToast(`Added ${s.suggestedQty} × ${s.name.slice(0, 26)} to PO`); setTimeout(() => setToast(null), 2800); };
  const nav = ROLES[role].nav;

  return (
    <div style={{ display: "flex", minHeight: 800, fontFamily: "Inter, system-ui, sans-serif", background: C.bg, color: C.text, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Baseline inventory intelligence for Tennis Outlet — role-based dashboards, AI copilot and SKU drill-downs on live catalog data.</span>
      <aside style={{ width: 238, background: C.navy, color: "#fff", padding: "20px 14px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 16px" }}><div style={{ width: 30, height: 30, borderRadius: 9, background: C.optic, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: 12, height: 12, borderRadius: 999, border: `2px solid ${C.opticInk}` }} /></div><div><div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>Baseline</div><div style={{ fontSize: 10, color: C.subtle, marginTop: -2 }}>Tennis Outlet</div></div></div>
        <div style={{ padding: "0 4px 14px" }}><div style={{ fontSize: 10, color: "#7C8696", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 7, paddingLeft: 4 }}>Workspace</div><div style={{ display: "flex", flexDirection: "column", gap: 3 }}>{Object.entries(ROLES).map(([k, r]) => (<button key={k} onClick={() => switchRole(k)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, border: "none", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: role === k ? 600 : 500, background: role === k ? C.optic : "transparent", color: role === k ? C.opticInk : "#A7B0C0" }}><r.Icon size={15} /> {r.label}</button>))}</div></div>
        <div style={{ height: 1, background: C.navy600, margin: "0 4px 14px" }} />
        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>{nav.map((id) => { const v = VIEW_META[id]; const active = tab === id; return (<button key={id} onClick={() => setTab(id)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: active ? 600 : 500, background: active ? C.navy600 : "transparent", color: active ? "#fff" : "#A7B0C0", borderLeft: active ? `3px solid ${C.optic}` : "3px solid transparent" }}><v.Icon size={18} color={active ? C.optic : "#7C8696"} strokeWidth={1.75} /> {v.label}{id === "radar" && alerts.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, background: C.danger, color: "#fff", borderRadius: 999, padding: "1px 7px" }}>{alerts.length}</span>}{id === "ask" && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, background: C.purple, color: "#fff", borderRadius: 999, padding: "1px 6px" }}>AI</span>}</button>); })}</nav>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 7, padding: "10px 12px", fontSize: 11, color: C.success }}><span style={{ width: 7, height: 7, borderRadius: 999, background: C.success }} /> Catalog synced · Magento</div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 24px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{VIEW_META[tab].label}</h1>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 999, padding: "3px 10px" }}>{ROLES[role].label}</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setTab("ask")} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6, color: C.purple, borderColor: C.purple + "44" }}><Bot size={15} /> Ask Baseline</button>
            <button style={{ position: "relative", width: 38, height: 38, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Bell size={17} color={C.muted} />{alerts.length > 0 && <span style={{ position: "absolute", top: 8, right: 9, width: 7, height: 7, borderRadius: 999, background: C.danger }} />}</button>
            <div style={{ width: 38, height: 38, borderRadius: 999, background: C.navy600, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14 }}>TO</div>
          </div>
        </header>
        <main style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {tab === "executive" && <Executive skus={skus} agg={agg} go={go} />}
          {tab === "sales" && <Sales skus={skus} agg={agg} />}
          {tab === "analytics" && <Analytics skus={skus} agg={agg} />}
          {tab === "radar" && <StockoutRadar skus={skus} onAddPo={addPo} />}
          {tab === "forecast" && <ForecastWhatIf surge={surge} setSurge={setSurge} delay={delay} setDelay={setDelay} skus={skus} />}
          {tab === "po" && <AutoPO skus={skus} poItems={poItems} approved={approved} setApproved={setApproved} budget={budget} setBudget={setBudget} />}
          {tab === "suppliers" && <Suppliers skus={skus} />}
          {tab === "dead" && <DeadStock skus={skus} />}
          {tab === "ask" && <AskBaseline skus={skus} agg={agg} role={role} />}
          {tab === "insights" && <Insights skus={skus} agg={agg} role={role} go={go} />}
          {tab === "tasks" && <Tasks skus={skus} onAddPo={addPo} />}
          {tab === "lookup" && <Lookup skus={skus} />}
        </main>
      </div>

      <SkuDrawer s={sel} onClose={() => setSel(null)} onAddPo={addPo} />
      {toast && <div style={{ position: "fixed", bottom: 24, left: 24, background: C.navy, color: "#fff", padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, zIndex: 120 }}><CheckCircle2 size={16} color={C.optic} /> {toast}</div>}
    </div>
  );
}
