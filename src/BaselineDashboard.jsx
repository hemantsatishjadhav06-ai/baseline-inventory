import { useState, useMemo, useRef, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  LayoutDashboard, Radar, TrendingUp, Snowflake, ClipboardList, Settings, Search,
  Bell, AlertOctagon, AlertTriangle, CheckCircle2, Layers, Truck, Crown, Users, ShoppingCart,
  TrendingDown, Package, IndianRupee, Plus, Check, X, RefreshCw, Activity, Sparkles,
  Target, CalendarDays, Wallet, Award, Boxes, ArrowRight, Inbox, Send, Store, Gauge,
  Repeat, MessageSquare, ChevronRight, ArrowRightLeft,
} from "lucide-react";
import { SKUS as CATALOG_SKUS, CATALOG, SOURCE } from "./data.js";

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
const pct = (x) => Math.round(x * 100) + "%";

const RISK = {
  0: { label: "Stockout risk", color: C.danger, Icon: AlertOctagon },
  1: { label: "Reorder now", color: C.warning, Icon: AlertTriangle },
  2: { label: "Healthy", color: C.success, Icon: CheckCircle2 },
  3: { label: "Overstock", color: C.overstock, Icon: Layers },
  4: { label: "Dead stock", color: C.dead, Icon: Snowflake },
};

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
const STORES = CATALOG.stores;
const STORE_SHORT = { tennisoutlet: "Tennis", badmintonoutlet: "Badminton", squashoutlet: "Squash", padeloutlet: "Padel", pickleballoutlet: "Pickleball", syxxsports: "Syxx" };

/* module portal so any row can open the SKU 360 drawer without prop drilling */
const skuPortal = { open: () => {} };

function perStore(s) {
  const base = [0.34, 0.18, 0.14, 0.12, 0.12, 0.10];
  let h = 0; for (const ch of s.sku) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rot = h % 6;
  const w = base.map((_, i) => base[(i + rot) % 6]);
  const tot = w.reduce((a, b) => a + b, 0);
  return STORES.map((st, i) => ({ store: st, qty: Math.round(s.onHand * w[i] / tot) }));
}

/* ============================ ENGINE ============================ */
function buildSkus({ surge = 0, delay = 0 } = {}) {
  return CATALOG_SKUS.map((p) => {
    const reviewPeriod = 15, effLead = p.leadTime + delay;
    const safetyDays = Math.max(5, Math.round(effLead * 0.4));
    const reorderWindow = effLead + safetyDays, targetMaxDays = 60, deadAfterDays = 90;
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
    const dailyRev = p.avgDaily * seasonIdx(p.category) * p.price;
    const annualUnits = p.avgDaily * SEASON[p.category].reduce((x, y) => x + y, 0) / 12 * 365;
    const stockValue = p.onHand * p.unitCost;
    const turns = stockValue > 0 ? (annualUnits * p.unitCost) / stockValue : 0;
    const margin = p.price > 0 ? (p.price - p.unitCost) / p.price : 0;
    const gmroi = stockValue > 0 ? (annualUnits * (p.price - p.unitCost)) / stockValue : 0;
    return {
      ...p, forecastDaily, effLead, reorderWindow, targetMaxDays, cover, risk,
      suggestedQty: suggested, stockValue, protectedRev: forecastDaily * p.price * effLead,
      dailyRev, annualUnits, turns, margin, gmroi,
    };
  });
}
function salesAgg(skus) {
  const dayRev = skus.reduce((a, s) => a + s.dailyRev, 0);
  const yearRev = skus.reduce((a, s) => a + s.avgDaily * s.price * SEASON[s.category].reduce((x, y) => x + y, 0) / 12 * 365, 0);
  const months = MONTHS.map((m, i) => ({ m, rev: skus.reduce((a, s) => a + s.avgDaily * s.price * seasonIdx(s.category, i) * 30, 0), cur: i === MONTH }));
  const weeks = Array.from({ length: 12 }, (_, i) => ({ w: "W" + (i + 1), rev: dayRev * 7 * (0.85 + ((i * 7) % 11) / 30) }));
  const days = Array.from({ length: 30 }, (_, i) => ({ d: i + 1, rev: dayRev * (0.8 + ((i * 3) % 9) / 18) }));
  return { dayRev, weekRev: dayRev * 7, monthRev: months[MONTH].rev, yearRev, months, weeks, days };
}
function utilization(skus) {
  const invVal = skus.reduce((a, s) => a + s.stockValue, 0);
  const annualCogs = skus.reduce((a, s) => a + s.annualUnits * s.unitCost, 0);
  const grossProfit = skus.reduce((a, s) => a + s.annualUnits * (s.price - s.unitCost), 0);
  const monthSold = skus.reduce((a, s) => a + s.forecastDaily * 30, 0);
  const onHandU = skus.reduce((a, s) => a + s.onHand, 0);
  const deadOver = skus.filter((s) => s.risk >= 3).reduce((a, s) => a + s.stockValue, 0);
  return {
    turns: invVal > 0 ? annualCogs / invVal : 0,
    gmroi: invVal > 0 ? grossProfit / invVal : 0,
    sellThrough: monthSold / (monthSold + onHandU),
    capitalUtil: invVal > 0 ? 1 - deadOver / invVal : 0,
    weeksSupply: skus.reduce((a, s) => a + s.forecastDaily, 0) > 0 ? onHandU / (skus.reduce((a, s) => a + s.forecastDaily, 0) * 7) : 0,
    invVal, deadOver,
  };
}
function topSellers(skus, periodDays) {
  return [...skus].filter((s) => s.dailyRev > 0)
    .map((s) => ({ ...s, periodRev: s.dailyRev * periodDays, periodUnits: Math.round(s.avgDaily * seasonIdx(s.category) * periodDays) }))
    .sort((a, b) => b.periodRev - a.periodRev).slice(0, 10);
}

/* ============================ PRIMITIVES ============================ */
const RiskBadge = ({ level }) => { const r = RISK[level]; return (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: r.color + "1A", color: r.color, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}><r.Icon size={13} /> {r.label}</span>
); };
const ProdLink = ({ s }) => (
  <span onClick={() => skuPortal.open(s)} style={{ cursor: "pointer" }} title="Open SKU 360">
    <span style={{ fontWeight: 500, borderBottom: `1px dotted ${C.subtle}` }}>{s.name}</span>
    <div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>{s.sku} · {s.supplier}</div>
  </span>
);
function CoverMeter({ s }) {
  if (!isFinite(s.cover)) return <span style={{ fontSize: 12, color: C.subtle, fontStyle: "italic" }}>no recent sales</span>;
  const scaleMax = Math.max(s.targetMaxDays, s.cover, s.reorderWindow) * 1.1, p = (v) => Math.min(100, (v / scaleMax) * 100), r = RISK[s.risk];
  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{s.cover.toFixed(0)}d</span><span style={{ fontSize: 11, color: C.subtle }}>lead {s.effLead}d</span></div>
      <div style={{ position: "relative", height: 7, borderRadius: 999, background: C.border }}>
        <div style={{ position: "absolute", inset: 0, width: p(s.cover) + "%", borderRadius: 999, background: r.color, transition: "width .35s" }} />
        <div style={{ position: "absolute", top: -2, left: p(s.effLead) + "%", width: 2, height: 11, background: C.danger }} />
      </div>
    </div>
  );
}
function Kpi({ label, value, delta, intent = "neutral", tone, Icon, sub }) {
  const up = delta >= 0, positive = up === (intent !== "negative"), dc = delta == null ? C.subtle : positive ? C.success : C.danger;
  return (
    <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: 18, position: "relative", overflow: "hidden" }}>
      {tone && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: tone }} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: C.muted }}>{label}</span>{Icon && <Icon size={15} color={C.subtle} strokeWidth={1.75} />}</div>
      <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9 }}>{delta != null && <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 12, fontWeight: 600, color: dc }}>{up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(delta)}%</span>}{sub && <span style={{ fontSize: 12, color: C.subtle }}>{sub}</span>}</div>
    </div>
  );
}
function Card({ title, subtitle, action, children, pad = 18 }) {
  return (
    <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}` }}>
      {title && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}><div><div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>{subtitle && <div style={{ fontSize: 12, color: C.subtle, marginTop: 2 }}>{subtitle}</div>}</div>{action}</div>}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  );
}
const Tip = ({ active, payload, label, fmt = (v) => v }) => (!active || !payload?.length) ? null : (
  <div style={{ background: C.navy, color: "#fff", padding: "8px 12px", borderRadius: 8, fontSize: 12 }}><div style={{ color: "#9AA1AD", marginBottom: 4 }}>{label}</div>{payload.map((p, i) => <div key={i} style={{ fontFamily: mono, fontWeight: 600, color: p.color || "#fff" }}>{p.name}: {fmt(p.value)}</div>)}</div>
);
const btnGhost = { fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.borderStrong}`, background: "transparent", cursor: "pointer", color: C.text };
const btnPrimary = { fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "none", background: C.optic, color: C.opticInk, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };
function Segment({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 9, padding: 3 }}>
      {options.map((o) => <button key={o.v} onClick={() => onChange(o.v)} style={{ border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 7, background: value === o.v ? C.surface : "transparent", color: value === o.v ? C.text : C.muted }}>{o.l}</button>)}
    </div>
  );
}
const catColors = [C.optic, C.clay, C.blue, C.dead, C.overstock, C.success, C.warning, C.purple];

/* ============================ SKU 360 DRAWER ============================ */
function SkuDrawer({ s, onClose, onAddPo }) {
  if (!s) return null;
  const stores = perStore(s);
  const curve = MONTHS.map((m, i) => ({ m, units: Math.round(s.avgDaily * seasonIdx(s.category, i) * 30), cur: i === MONTH }));
  const action = s.risk <= 1 ? { label: `Reorder ${s.suggestedQty}`, color: C.optic, ink: C.opticInk } : s.risk >= 3 ? { label: "Mark down", color: C.clay, ink: "#fff" } : null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(14,23,38,.45)", zIndex: 100, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "92vw", background: C.surface, height: "100%", overflowY: "auto", boxShadow: "-8px 0 30px rgba(0,0,0,.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "20px 22px", borderBottom: `1px solid ${C.border}` }}>
          <div><div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>{s.sku} · SKU 360</div><div style={{ fontSize: 18, fontWeight: 600, marginTop: 3, lineHeight: 1.25 }}>{s.name}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}><RiskBadge level={s.risk} /><span style={{ fontSize: 12, color: C.muted }}>{s.category} · {s.supplier}</span></div></div>
          <button onClick={onClose} style={{ border: "none", background: C.surfaceAlt, borderRadius: 8, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={16} color={C.muted} /></button>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[["On hand", s.onHand + (s.inTransit ? ` +${s.inTransit}` : ""), C.text], ["Days cover", isFinite(s.cover) ? Math.round(s.cover) + "d" : "—", RISK[s.risk].color], ["Price", inr(s.price), C.text], ["Margin", pct(s.margin), C.success], ["Forecast/day", s.forecastDaily.toFixed(2), C.text], ["Accuracy", pct(s.accuracy), s.accuracy >= .9 ? C.success : C.warning]].map(([l, v, c]) => (
              <div key={l} style={{ background: C.surfaceAlt, borderRadius: 10, padding: "10px 12px" }}><div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: ".03em" }}>{l}</div><div style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color: c, marginTop: 3 }}>{v}</div></div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Seasonal demand forecast (units/mo)</div>
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={curve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="skucv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.blue} stopOpacity={.3} /><stop offset="100%" stopColor={C.blue} stopOpacity={.02} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                  <XAxis dataKey="m" tick={{ fontSize: 10, fill: C.subtle }} axisLine={false} tickLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 10, fill: C.subtle }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<Tip />} /><ReferenceLine x="Jun" stroke={C.borderStrong} strokeDasharray="2 2" />
                  <Area type="monotone" dataKey="units" name="Units" stroke={C.blue} strokeWidth={2} fill="url(#skucv)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Stock across stores <span style={{ fontWeight: 400, color: C.subtle, fontSize: 11 }}>(modeled)</span></div>
            {stores.map((st) => { const max = Math.max(...stores.map((x) => x.qty), 1); return (
              <div key={st.store} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: C.muted, width: 78 }}>{STORE_SHORT[st.store] || st.store}</span>
                <div style={{ flex: 1, height: 8, background: C.border, borderRadius: 999 }}><div style={{ width: (st.qty / max * 100) + "%", height: "100%", background: C.blue, borderRadius: 999 }} /></div>
                <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, width: 26, textAlign: "right" }}>{st.qty}</span>
              </div>
            ); })}
          </div>
          <div style={{ background: C.surfaceAlt, borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><Sparkles size={15} color={C.purple} /><span style={{ fontSize: 13, fontWeight: 600 }}>Baseline recommends</span></div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: C.text }}>
              {s.risk === 0 && `Stocks out in ~${Math.round(s.cover)} days — inside the ${s.effLead}-day lead time. Reorder ${s.suggestedQty} units from ${s.supplier} now to protect ${inrC(s.protectedRev)} of demand.`}
              {s.risk === 1 && `Cover is thinning (${Math.round(s.cover)}d). Queue ${s.suggestedQty} units from ${s.supplier} on the next PO.`}
              {s.risk === 2 && `Healthy — ${Math.round(s.cover)} days of cover at the current seasonal run-rate. No action needed.`}
              {s.risk === 3 && `Overstocked (${Math.round(s.cover)}d of cover). Pause reorders; consider a transfer to a store that's short or a light markdown.`}
              {s.risk === 4 && `No sales in ${s.daysSinceSale}+ days — ${inrC(s.stockValue)} of cash frozen. Mark down to clear and recycle the capital.`}
            </div>
            {action && <button onClick={() => { if (s.risk <= 1) onAddPo(s); onClose(); }} style={{ marginTop: 12, fontSize: 13, fontWeight: 600, padding: "9px 14px", borderRadius: 9, border: "none", background: action.color, color: action.ink, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>{s.risk <= 1 ? <Plus size={14} /> : <TrendingDown size={14} />} {action.label}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ ASK BASELINE (AI CHAT) ============================ */
function answer(q, skus, agg, util) {
  const t = q.toLowerCase();
  const has = (...k) => k.some((x) => t.includes(x));
  const Chips = ({ items }) => (<div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>{items.map(([l, v, c]) => <div key={l} style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px" }}><div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase" }}>{l}</div><div style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color: c || C.text }}>{v}</div></div>)}</div>);
  const List = ({ rows, val }) => (<div style={{ marginTop: 10 }}>{rows.map((s, i) => (<div key={s.sku} onClick={() => skuPortal.open(s)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i ? `1px solid ${C.border}` : "none", cursor: "pointer" }}><span style={{ fontFamily: mono, fontSize: 11, color: C.subtle, width: 16 }}>{i + 1}</span><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle }}>{s.category} · {s.supplier}</div></div><span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{val(s)}</span></div>))}</div>);

  if (has("hello", "hi ", "help", "what can you")) return { text: "Ask me anything about your stock, sales, suppliers or stores. Try the suggestions below — I answer in plain words and show the numbers." };

  if (has("reorder", "to order", "should i order", "low stock", "run out", "running out", "stockout", "buy")) {
    const brand = ["babolat", "wilson", "yonex", "head", "nike", "adidas", "asics", "solinco", "dunlop"].find((b) => t.includes(b));
    let rows = skus.filter((s) => s.risk <= 1);
    if (brand) rows = rows.filter((s) => s.supplier.toLowerCase().includes(brand));
    rows = rows.sort((a, b) => a.cover - b.cover).slice(0, 6);
    const rev = skus.filter((s) => s.risk <= 1).reduce((a, s) => a + s.protectedRev, 0);
    return { text: `${skus.filter((s) => s.risk <= 1).length} SKUs need reordering${brand ? " from " + brand : ""} — ${inrC(rev)} of revenue is exposed. Top priorities:`, node: <List rows={rows} val={(s) => "×" + s.suggestedQty} /> };
  }
  if (has("dead", "slow mov", "not selling", "clear", "markdown")) {
    const dead = skus.filter((s) => s.risk === 4).sort((a, b) => b.stockValue - a.stockValue).slice(0, 6);
    const cash = skus.filter((s) => s.risk === 4).reduce((a, s) => a + s.stockValue, 0);
    return { text: `${inrC(cash)} is frozen in ${skus.filter((s) => s.risk === 4).length} dead SKUs. Biggest cash to recover:`, node: <List rows={dead} val={(s) => inrC(s.stockValue)} /> };
  }
  if (has("turn", "utiliz", "sell-through", "sell through", "gmroi", "efficien")) {
    return { text: `Inventory is turning ${util.turns.toFixed(1)}× a year with a GMROI of ${util.gmroi.toFixed(2)} (₹${util.gmroi.toFixed(2)} gross profit per ₹1 of stock). Sell-through is ${pct(util.sellThrough)} and ${pct(util.capitalUtil)} of capital is in healthy stock.`, node: <Chips items={[["Turns", util.turns.toFixed(1) + "×"], ["GMROI", util.gmroi.toFixed(2), C.success], ["Sell-through", pct(util.sellThrough)], ["Capital used", pct(util.capitalUtil), C.success]]} /> };
  }
  if (has("margin", "profit", "profitable")) {
    const byCat = Object.entries(skus.reduce((m, s) => { (m[s.category] = m[s.category] || []).push(s.margin); return m; }, {})).map(([c, a]) => ({ c, m: a.reduce((x, y) => x + y, 0) / a.length })).sort((a, b) => b.m - a.m);
    return { text: `Blended gross margin is ${pct(skus.reduce((a, s) => a + s.margin, 0) / skus.length)}. By category, highest first:`, node: <Chips items={byCat.slice(0, 5).map((x) => [x.c, pct(x.m), x.m > .4 ? C.success : C.warning])} /> };
  }
  if (has("store", "transfer", "which shop", "between stores", "branch")) {
    const rows = STORES.map((st) => ({ st, val: skus.reduce((a, s) => a + perStore(s).find((x) => x.store === st).qty * s.unitCost, 0) })).sort((a, b) => b.val - a.val);
    return { text: "Stock value by store (modeled). Tennis carries the most; rebalancing the smaller stores frees cash and cuts stockouts:", node: <Chips items={rows.map((r) => [STORE_SHORT[r.st] || r.st, inrC(r.val)])} /> };
  }
  if (has("top", "best sell", "bestsell", "selling most", "popular")) {
    const period = t.includes("year") ? 365 : t.includes("week") ? 7 : t.includes("today") || t.includes("day") ? 1 : 30;
    const top = topSellers(skus, period).slice(0, 6);
    return { text: `Top sellers (${period === 1 ? "today" : period === 7 ? "this week" : period === 365 ? "this year" : "this month"}, modeled):`, node: <List rows={top} val={(s) => inrC(s.dailyRev * period)} /> };
  }
  if (has("sales", "revenue", "how are we", "how much", "turnover", "this month", "this week", "this year", "today")) {
    return { text: `Modeled run-rate: ${inrC(agg.dayRev)} today, ${inrC(agg.weekRev)} this week, ${inrC(agg.monthRev)} this month, ${inrC(agg.yearRev)} this year. June is a seasonal lull — the pre-season ramp starts in September.`, node: <Chips items={[["Today", inrC(agg.dayRev)], ["Week", inrC(agg.weekRev)], ["Month", inrC(agg.monthRev)], ["Year", inrC(agg.yearRev)]]} /> };
  }
  if (has("forecast", "predict", "expect", "season", "september", "next month")) {
    return { text: "The model reads tennis seasonality: racquets and shoes spike Sep–Nov (season start), apparel peaks Apr–Jun, strings and balls stay steady. June is a trough; build racquet and shoe cover before September." };
  }
  if (has("supplier", "vendor", "otif", "reliab")) {
    const byS = Object.entries(skus.reduce((m, s) => { m[s.supplier] = (m[s.supplier] || 0) + s.stockValue; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { text: "Top suppliers by stock value tied up:", node: <Chips items={byS.map(([s, v]) => [s, inrC(v)])} /> };
  }
  // product search fallback
  const words = t.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const hits = skus.filter((s) => words.some((w) => s.name.toLowerCase().includes(w) || s.sku.toLowerCase().includes(w)));
  if (hits.length) {
    const s = hits[0];
    return { text: `${s.name} — ${s.onHand} on hand${s.inTransit ? ` (+${s.inTransit} incoming)` : ""}, ${isFinite(s.cover) ? Math.round(s.cover) + " days of cover" : "no recent sales"}. ${RISK[s.risk].label}. Tap to open the full SKU 360.`, node: <List rows={hits.slice(0, 5)} val={(s) => s.onHand + " on hand"} /> };
  }
  return { text: "I couldn't match that to your data yet. Try asking about reorders, dead stock, sales, top sellers, margins, suppliers, stores, or a product name." };
}
function AskBaseline({ skus, agg, util, role }) {
  const suggByRole = {
    exec: ["How are we doing this month?", "What's our inventory turns and GMROI?", "Show top sellers this year", "How much cash is in dead stock?"],
    procurement: ["What should I reorder from Babolat?", "Which SKUs will stock out?", "Compare stock across stores", "Top suppliers by stock value"],
    employee: ["Do we have Babolat Pure Drive in stock?", "What should I reorder today?", "Show top sellers this week", "Which items are running low?"],
  };
  const [msgs, setMsgs] = useState([{ role: "bot", text: `Hi — I'm Baseline AI. I read your live catalog and the replenishment engine, and answer for the ${role === "exec" ? "executive" : role === "procurement" ? "procurement" : "store"} view. Ask me anything, or tap a suggestion.` }]);
  const [input, setInput] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  const ask = (q) => { if (!q.trim()) return; const a = answer(q, skus, agg, util); setMsgs((m) => [...m, { role: "user", text: q }, { role: "bot", ...a }]); setInput(""); };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 220px)", minHeight: 460, background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: C.purple + "1F", display: "flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={17} color={C.purple} /></div>
        <div><div style={{ fontSize: 15, fontWeight: 600 }}>Ask Baseline</div><div style={{ fontSize: 11, color: C.subtle }}>grounded in live catalog + the replenishment engine</div></div>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.success }}><span style={{ width: 6, height: 6, borderRadius: 999, background: C.success }} /> online</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "78%", background: m.role === "user" ? C.navy : C.surfaceAlt, color: m.role === "user" ? "#fff" : C.text, borderRadius: 14, padding: "11px 14px", border: m.role === "user" ? "none" : `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{m.text}</div>
              {m.node}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
          {suggByRole[role].map((s) => <button key={s} onClick={() => ask(s)} style={{ fontSize: 12, color: C.muted, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 999, padding: "5px 11px", cursor: "pointer" }}>{s}</button>)}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(input)} placeholder="Ask about stock, sales, suppliers, stores…" style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 14px", fontSize: 14, outline: "none", background: C.surfaceAlt, color: C.text }} />
          <button onClick={() => ask(input)} style={{ ...btnPrimary, padding: "0 16px" }}><Send size={16} /></button>
        </div>
      </div>
    </div>
  );
}

/* ============================ UTILIZATION ANALYTICS ============================ */
function Analytics({ skus }) {
  const u = utilization(skus);
  const byCat = Object.entries(skus.reduce((m, s) => { (m[s.category] = m[s.category] || { turns: [], gm: [], val: 0 }); m[s.category].turns.push(s.turns); m[s.category].gm.push(s.gmroi); m[s.category].val += s.stockValue; return m; }, {}))
    .map(([c, d]) => ({ c, turns: d.turns.reduce((a, b) => a + b, 0) / d.turns.length, gmroi: d.gm.reduce((a, b) => a + b, 0) / d.gm.length, val: d.val })).sort((a, b) => b.gmroi - a.gmroi);
  const split = [{ name: "Healthy", value: skus.filter((s) => s.risk <= 2).reduce((a, s) => a + s.stockValue, 0), color: C.success }, { name: "Overstock", value: skus.filter((s) => s.risk === 3).reduce((a, s) => a + s.stockValue, 0), color: C.overstock }, { name: "Dead", value: skus.filter((s) => s.risk === 4).reduce((a, s) => a + s.stockValue, 0), color: C.dead }];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SourceBar />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
        <Kpi label="Inventory turns" value={u.turns.toFixed(1) + "×"} delta={6} Icon={Repeat} sub="annualised" />
        <Kpi label="GMROI" value={u.gmroi.toFixed(2)} delta={4} Icon={Gauge} sub="profit / ₹ stock" />
        <Kpi label="Sell-through" value={pct(u.sellThrough)} delta={3} Icon={Activity} sub="30-day" />
        <Kpi label="Capital utilisation" value={pct(u.capitalUtil)} delta={-2} intent="neutral" tone={C.success} Icon={Wallet} sub="in healthy stock" />
        <Kpi label="Weeks of supply" value={u.weeksSupply.toFixed(1)} delta={0} Icon={CalendarDays} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
        <Card title="GMROI by category" subtitle="gross-margin return on inventory — higher means each rupee of stock works harder">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCat} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="c" tick={{ fontSize: 10, fill: C.subtle }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={42} />
                <YAxis tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} />
                <Tooltip content={<Tip fmt={(v) => v.toFixed(2)} />} cursor={{ fill: C.surfaceAlt }} />
                <ReferenceLine y={1} stroke={C.danger} strokeDasharray="4 3" />
                <Bar dataKey="gmroi" name="GMROI" radius={[6, 6, 0, 0]}>{byCat.map((e, i) => <Cell key={i} fill={e.gmroi >= 2 ? C.success : e.gmroi >= 1 ? C.warning : C.danger} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Where capital sits">
          <div style={{ height: 168 }}>
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={split} dataKey="value" nameKey="name" innerRadius={46} outerRadius={70} paddingAngle={2}>{split.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip content={<Tip fmt={inrC} />} /></PieChart></ResponsiveContainer>
          </div>
          {split.map((e) => <div key={e.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}><span style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted }}><span style={{ width: 9, height: 9, borderRadius: 3, background: e.color }} />{e.name}</span><span style={{ fontFamily: mono, fontWeight: 600 }}>{inrC(e.value)}</span></div>)}
        </Card>
      </div>
      <Card title="Inventory turns by category" subtitle="how many times a year stock sells through — slow categories tie up cash">
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byCat} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => v.toFixed(0) + "×"} />
              <YAxis type="category" dataKey="c" width={84} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
              <Tooltip content={<Tip fmt={(v) => v.toFixed(1) + "×"} />} cursor={{ fill: C.surfaceAlt }} />
              <Bar dataKey="turns" name="Turns" radius={[0, 6, 6, 0]}>{byCat.map((e, i) => <Cell key={i} fill={catColors[i % catColors.length]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

/* ============================ STORE COMPARE ============================ */
function StoreCompare({ skus }) {
  const rows = STORES.map((st) => {
    let val = 0, units = 0; skus.forEach((s) => { const q = perStore(s).find((x) => x.store === st).qty; val += q * s.unitCost; units += q; });
    return { st, val, units, risk: Math.round(skus.filter((s) => s.risk <= 1).length * (0.4 + (st.charCodeAt(0) % 5) / 10)) };
  }).sort((a, b) => b.val - a.val);
  const transfers = skus.filter((s) => s.risk <= 1 && s.onHand > 6).slice(0, 6).map((s) => { const ps = perStore(s).sort((a, b) => b.qty - a.qty); return { s, from: ps[0].store, to: ps[ps.length - 1].store, qty: Math.max(1, Math.round((ps[0].qty - ps[ps.length - 1].qty) / 2)) }; });
  const td = { padding: "11px 14px", fontSize: 13, borderTop: `1px solid ${C.border}` };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STORES.length},1fr)`, gap: 12 }}>
        {rows.map((r) => <div key={r.st} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}><div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: C.muted }}><Store size={13} />{STORE_SHORT[r.st] || r.st}</div><div style={{ fontFamily: mono, fontSize: 17, fontWeight: 600, marginTop: 6 }}>{inrC(r.val)}</div><div style={{ fontSize: 11, color: C.subtle, marginTop: 2 }}>{r.units} units · {r.risk} at risk</div></div>)}
      </div>
      <Card title="Suggested transfers" subtitle="rebalance stock between stores before reordering — modeled" pad={0}>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Product", "Move", "Qty", ""].map((h, i) => <th key={i} style={{ textAlign: i >= 2 ? "right" : "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.muted, padding: "11px 14px", background: C.surfaceAlt }}>{h}</th>)}</tr></thead>
          <tbody>{transfers.map((t) => (
            <tr key={t.s.sku}><td style={td}><ProdLink s={t.s} /></td>
              <td style={{ ...td, color: C.muted }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{STORE_SHORT[t.from] || t.from} <ArrowRightLeft size={13} color={C.blue} /> {STORE_SHORT[t.to] || t.to}</span></td>
              <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{t.qty}</td>
              <td style={{ ...td, textAlign: "right" }}><button style={btnGhost}>Create transfer</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
    </div>
  );
}

/* ============================ EXEC / SALES / PROCUREMENT / EMPLOYEE ============================ */
function Executive({ skus, agg, util, go }) {
  const [tsPeriod, setTsPeriod] = useState(30);
  const invValue = skus.reduce((a, s) => a + s.stockValue, 0);
  const deadValue = skus.filter((s) => s.risk === 4).reduce((a, s) => a + s.stockValue, 0);
  const grossMargin = Math.round(skus.reduce((a, s) => a + s.margin, 0) / skus.length * 100);
  const top = topSellers(skus, tsPeriod);
  const insights = buildInsights(skus, agg, util, "exec");
  const catRev = Object.entries(skus.reduce((m, s) => ((m[s.category] = (m[s.category] || 0) + s.dailyRev * 30), m), {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SourceBar />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
        <Kpi label="Sales today" value={inrC(agg.dayRev)} delta={8} Icon={IndianRupee} sub="modeled" />
        <Kpi label="This month" value={inrC(agg.monthRev)} delta={-4} Icon={TrendingUp} sub="off-season" />
        <Kpi label="Gross margin" value={grossMargin + "%"} delta={2} Icon={Award} />
        <Kpi label="Inventory turns" value={util.turns.toFixed(1) + "×"} delta={6} Icon={Repeat} sub="capital efficiency" />
        <Kpi label="Cash in dead stock" value={inrC(deadValue)} delta={6} intent="negative" tone={C.dead} Icon={Snowflake} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18 }}>
        <Card title="Revenue — 12-month seasonal view" subtitle="modeled from live catalog · tennis-calendar shape">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={agg.months} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs><linearGradient id="exrev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.blue} stopOpacity={0.3} /><stop offset="100%" stopColor={C.blue} stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="m" tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => "₹" + Math.round(v / 1e5) + "L"} />
                <Tooltip content={<Tip fmt={inrC} />} /><ReferenceLine x="Jun" stroke={C.borderStrong} strokeDasharray="2 2" />
                <Area type="monotone" dataKey="rev" name="Revenue" stroke={C.blue} strokeWidth={2.5} fill="url(#exrev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="AI executive briefing" subtitle="generated from live signals" action={<Sparkles size={15} color={C.purple} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{insights.slice(0, 4).map((ins, i) => (
            <div key={i} style={{ display: "flex", gap: 9 }}><ins.icon size={15} color={ins.color} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{ins.text}{ins.to && <button onClick={() => go(ins.to)} style={{ ...btnGhost, padding: "1px 7px", marginLeft: 6, fontSize: 11 }}>{ins.action} →</button>}</div></div>
          ))}</div>
        </Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Card title="Top sellers" subtitle="ranked by modeled revenue" action={<Segment value={tsPeriod} onChange={setTsPeriod} options={[{ v: 1, l: "Day" }, { v: 7, l: "Week" }, { v: 30, l: "Month" }, { v: 365, l: "Year" }]} />} pad={0}>
          <div style={{ padding: "6px 18px" }}>{top.slice(0, 6).map((s, i) => (
            <div key={s.sku} onClick={() => skuPortal.open(s)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: i < 5 ? `1px solid ${C.border}` : "none", cursor: "pointer" }}>
              <span style={{ fontFamily: mono, fontSize: 12, color: i < 3 ? C.clay : C.subtle, fontWeight: 600, width: 18 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle }}>{s.category} · {s.periodUnits} units</div></div>
              <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{inrC(s.periodRev)}</span>
            </div>
          ))}</div>
        </Card>
        <Card title="Revenue by category (modeled monthly)">
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={catRev} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => "₹" + Math.round(v / 1e5) + "L"} />
                <YAxis type="category" dataKey="name" width={78} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
                <Tooltip content={<Tip fmt={inrC} />} cursor={{ fill: C.surfaceAlt }} />
                <Bar dataKey="value" name="Monthly rev" radius={[0, 6, 6, 0]}>{catRev.map((e, i) => <Cell key={i} fill={catColors[i % catColors.length]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Sales({ skus, agg }) {
  const [period, setPeriod] = useState(30);
  const top = topSellers(skus, period);
  const series = period === 1 ? agg.days.map((d) => ({ x: "D" + d.d, rev: d.rev })) : period === 365 ? agg.months.map((m) => ({ x: m.m, rev: m.rev })) : period === 7 ? agg.weeks.slice(-8).map((w) => ({ x: w.w, rev: w.rev / 7 })) : agg.weeks.map((w) => ({ x: w.w, rev: w.rev }));
  const periodRev = period === 1 ? agg.dayRev : period === 7 ? agg.weekRev : period === 365 ? agg.yearRev : agg.monthRev;
  const lbl = period === 1 ? "today" : period === 7 ? "this week" : period === 365 ? "this year" : "this month";
  const td = { padding: "11px 14px", fontSize: 13, borderTop: `1px solid ${C.border}` };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><SourceBar inline /><Segment value={period} onChange={setPeriod} options={[{ v: 1, l: "Day" }, { v: 7, l: "Week" }, { v: 30, l: "Month" }, { v: 365, l: "Year" }]} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        <Kpi label={`Revenue ${lbl}`} value={inrC(periodRev)} delta={period === 30 ? -4 : 7} Icon={IndianRupee} />
        <Kpi label="Orders (modeled)" value={Math.round(periodRev / 2400).toLocaleString("en-IN")} delta={5} Icon={ShoppingCart} />
        <Kpi label="Avg order value" value={inr(2400)} delta={3} Icon={Wallet} />
        <Kpi label="Units sold" value={top.reduce((a, s) => a + s.periodUnits, 0).toLocaleString("en-IN") + "+"} delta={4} Icon={Boxes} />
      </div>
      <Card title="Revenue trend">
        <div style={{ height: 230 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="x" tick={{ fontSize: 10, fill: C.subtle }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1e5 ? "₹" + Math.round(v / 1e5) + "L" : "₹" + Math.round(v / 1e3) + "k"} />
              <Tooltip content={<Tip fmt={inrC} />} /><Line type="monotone" dataKey="rev" name="Revenue" stroke={C.blue} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title={`Top sellers — ${lbl}`} subtitle="modeled from live catalog + seasonal velocity" pad={0}>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["#", "Product", "Category", "Units", "Revenue"].map((h, i) => <th key={h} style={{ textAlign: i >= 3 ? "right" : "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.muted, padding: "11px 14px", background: C.surfaceAlt }}>{h}</th>)}</tr></thead>
          <tbody>{top.map((s, i) => (
            <tr key={s.sku} onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceAlt)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <td style={{ ...td, fontFamily: mono, color: i < 3 ? C.clay : C.subtle, fontWeight: 600, width: 36 }}>{i + 1}</td>
              <td style={td}><ProdLink s={s} /></td><td style={{ ...td, color: C.muted }}>{s.category}</td>
              <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{s.periodUnits}</td><td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inrC(s.periodRev)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
    </div>
  );
}

function OpsTable({ rows, onAddPo, cols }) {
  const H = ({ c, r }) => <th style={{ textAlign: r ? "right" : "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", color: C.muted, padding: "11px 14px", position: "sticky", top: 0, background: C.surfaceAlt }}>{c}</th>;
  const td = { padding: "11px 14px", fontSize: 13, borderTop: `1px solid ${C.border}` };
  return (
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>
        {cols.includes("product") && <H c="Product" />}{cols.includes("risk") && <H c="Status" />}{cols.includes("cover") && <H c="Forecast cover" />}
        {cols.includes("acc") && <H c="Accuracy" r />}{cols.includes("age") && <H c="Age" r />}{cols.includes("onhand") && <H c="On hand" r />}
        {cols.includes("suggest") && <H c="Suggested" r />}{cols.includes("value") && <H c="Stock value" r />}{cols.includes("gmroi") && <H c="GMROI" r />}{cols.includes("action") && <H c="Action" r />}{cols.includes("markdown") && <H c="Action" r />}
      </tr></thead>
      <tbody>{rows.map((s) => (
        <tr key={s.sku} onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceAlt)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          {cols.includes("product") && <td style={td}><ProdLink s={s} /></td>}
          {cols.includes("risk") && <td style={td}><RiskBadge level={s.risk} /></td>}
          {cols.includes("cover") && <td style={td}><CoverMeter s={s} /></td>}
          {cols.includes("acc") && <td style={{ ...td, textAlign: "right" }}><span style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: s.accuracy >= .92 ? C.success : s.accuracy >= .87 ? C.warning : C.danger }}>{pct(s.accuracy)}</span></td>}
          {cols.includes("age") && <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{s.age}d</td>}
          {cols.includes("onhand") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{s.onHand}{s.inTransit > 0 ? <span style={{ color: C.info, fontWeight: 500 }}> +{s.inTransit}</span> : ""}</td>}
          {cols.includes("suggest") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600, color: s.suggestedQty > 0 ? C.text : C.subtle }}>{s.suggestedQty || "—"}</td>}
          {cols.includes("value") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inrC(s.stockValue)}</td>}
          {cols.includes("gmroi") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600, color: s.gmroi >= 2 ? C.success : s.gmroi >= 1 ? C.warning : C.danger }}>{s.gmroi.toFixed(1)}</td>}
          {cols.includes("action") && <td style={{ ...td, textAlign: "right" }}><button disabled={!s.suggestedQty} onClick={() => onAddPo && onAddPo(s)} style={{ ...btnPrimary, ...(s.suggestedQty ? {} : { background: C.border, color: C.subtle, cursor: "not-allowed" }) }}><Plus size={13} /> Add {s.suggestedQty || ""}</button></td>}
          {cols.includes("markdown") && <td style={{ ...td, textAlign: "right" }}><button style={{ ...btnGhost, color: C.clay, borderColor: C.clay + "55" }}>Mark down</button></td>}
        </tr>
      ))}</tbody>
    </table></div>
  );
}
function StockoutRadar({ skus, onAddPo }) {
  const rows = useMemo(() => skus.filter((s) => s.risk <= 1).sort((a, b) => a.cover - b.cover), [skus]);
  return <Card title={`Stockout radar — ${rows.length} SKUs need attention`} subtitle="ranked by forecasted days of cover · click a product for SKU 360" pad={0}><OpsTable rows={rows} onAddPo={onAddPo} cols={["product", "risk", "cover", "acc", "onhand", "suggest", "action"]} /></Card>;
}
function Suppliers({ skus }) {
  const map = {};
  skus.forEach((s) => { const m = (map[s.supplier] = map[s.supplier] || { supplier: s.supplier, skus: 0, spend: 0, onOrder: 0, lead: s.leadTime }); m.skus++; m.spend += s.stockValue; m.onOrder += s.suggestedQty * s.unitCost; });
  const OTIF = { Babolat: .94, Wilson: .91, Yonex: .88, Head: .90, Nike: .92, Adidas: .86, Asics: .89, Solinco: .95, Dunlop: .9, Tecnifibre: .9, "House / Other": .9 };
  const rows = Object.values(map).map((m) => ({ ...m, otif: OTIF[m.supplier] ?? .9 })).sort((a, b) => b.spend - a.spend);
  const td = { padding: "11px 14px", fontSize: 13, borderTop: `1px solid ${C.border}` };
  return (
    <Card title="Supplier scorecard" subtitle="reliability, spend and open orders by vendor" pad={0}>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["Supplier", "SKUs", "Lead", "OTIF", "Stock value", "Suggested order"].map((h, i) => <th key={h} style={{ textAlign: i === 0 ? "left" : "right", fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.muted, padding: "11px 14px", background: C.surfaceAlt }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((m) => (
          <tr key={m.supplier} onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceAlt)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <td style={{ ...td, fontWeight: 500 }}>{m.supplier}</td><td style={{ ...td, textAlign: "right", fontFamily: mono }}>{m.skus}</td><td style={{ ...td, textAlign: "right", fontFamily: mono }}>{m.lead}d</td>
            <td style={{ ...td, textAlign: "right" }}><span style={{ fontFamily: mono, fontWeight: 600, color: m.otif >= .92 ? C.success : m.otif >= .88 ? C.warning : C.danger }}>{pct(m.otif)}</span></td>
            <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inrC(m.spend)}</td><td style={{ ...td, textAlign: "right", fontFamily: mono, color: m.onOrder > 0 ? C.text : C.subtle }}>{m.onOrder > 0 ? inrC(m.onOrder) : "—"}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}
function ForecastWhatIf({ surge, setSurge, delay, setDelay, skus }) {
  const atRisk = skus.filter((s) => s.risk <= 1).length, revAtRisk = skus.filter((s) => s.risk <= 1).reduce((a, s) => a + s.protectedRev, 0);
  const top = [...skus].sort((a, b) => b.protectedRev - a.protectedRev).slice(0, 8);
  const S = ({ label, hint, value, min, max, step, unit, onChange, color }) => (
    <div><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span><span style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color }}>{value}{unit}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: color }} /><div style={{ fontSize: 11, color: C.subtle, marginTop: 4 }}>{hint}</div></div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card title="What-if simulator" subtitle="stress-test demand surges and supplier delays — recomputes live">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 8 }}><S label="Demand surge" hint="e.g. tournament / season start" value={surge} min={0} max={100} step={5} unit="%" onChange={setSurge} color={C.clay} /><S label="Supplier delay" hint="added to every lead time" value={delay} min={0} max={21} step={1} unit="d" onChange={setDelay} color={C.warning} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 12 }}><Kpi label="SKUs at risk" value={atRisk} tone={atRisk > 20 ? C.danger : C.warning} Icon={AlertTriangle} sub="this scenario" /><Kpi label="Revenue exposed" value={inrC(revAtRisk)} tone={C.danger} Icon={IndianRupee} /><Kpi label="Scenario" value={surge === 0 && delay === 0 ? "Baseline" : "Stressed"} Icon={Activity} sub={`+${surge}% · +${delay}d`} /></div>
      </Card>
      <Card title="Highest revenue at risk" subtitle="forecast demand × price × lead time" pad={0}><OpsTable rows={top} cols={["product", "risk", "cover", "acc", "onhand"]} /></Card>
    </div>
  );
}
function DeadStock({ skus }) {
  const rows = useMemo(() => skus.filter((s) => s.risk === 4 || s.risk === 3).sort((a, b) => b.stockValue - a.stockValue).slice(0, 40), [skus]);
  const trapped = skus.filter((s) => s.risk === 4 || s.risk === 3).reduce((a, s) => a + s.stockValue, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}><Kpi label="Cash locked in slow stock" value={inrC(trapped)} tone={C.dead} Icon={Snowflake} /><Kpi label="Dead SKUs (no sale 90d+)" value={skus.filter((s) => s.risk === 4).length} tone={C.dead} Icon={Snowflake} /><Kpi label="Overstocked SKUs" value={skus.filter((s) => s.risk === 3).length} tone={C.overstock} Icon={Layers} /></div>
      <Card title="Markdown & clearance candidates" subtitle="highest trapped cash first" pad={0}><OpsTable rows={rows} cols={["product", "risk", "age", "onhand", "gmroi", "value", "markdown"]} /></Card>
    </div>
  );
}
function AutoPO({ skus, poItems, approved, setApproved, budget, setBudget }) {
  const result = useMemo(() => {
    const merged = {};
    skus.filter((s) => s.suggestedQty > 0).forEach((s) => (merged[s.sku] = { ...s, qty: s.suggestedQty }));
    poItems.forEach((s) => (merged[s.sku] = { ...s, qty: s.suggestedQty }));
    const ranked = Object.values(merged).sort((a, b) => b.protectedRev - a.protectedRev);
    let spent = 0; ranked.forEach((s) => { const c = s.qty * s.unitCost; s._def = budget > 0 && spent + c > budget; if (!s._def) spent += c; });
    const bySup = {}; ranked.forEach((s) => (bySup[s.supplier] = bySup[s.supplier] || []).push(s));
    const drafts = Object.entries(bySup).map(([supplier, items]) => ({ supplier, items: items.slice(0, 6), total: items.filter((i) => !i._def).reduce((a, s) => a + s.qty * s.unitCost, 0), lead: items[0].leadTime })).filter((d) => d.total > 0).sort((a, b) => b.total - a.total).slice(0, 6);
    return { spent, drafts };
  }, [skus, poItems, budget]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card title="Cash-aware purchasing" subtitle="set an open-to-buy budget — Baseline funds the highest-revenue-at-risk lines first">
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Wallet size={16} color={C.muted} /><span style={{ fontSize: 13, color: C.muted }}>Open-to-buy budget</span></div><input type="range" min={0} max={2000000} step={50000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} style={{ flex: 1, minWidth: 180, accentColor: C.optic }} /><span style={{ fontFamily: mono, fontWeight: 600, fontSize: 16, minWidth: 100, textAlign: "right" }}>{budget === 0 ? "No cap" : inrC(budget)}</span><span style={{ fontSize: 12, color: C.subtle }}>committing {inrC(result.spent)}</span></div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 18, alignItems: "start" }}>
        {result.drafts.map((d) => { const ap = approved.includes(d.supplier); return (
          <div key={d.supplier} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${ap ? C.success : C.border}`, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", background: ap ? C.success + "10" : C.surfaceAlt, borderBottom: `1px solid ${C.border}` }}>
              <div><div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>{d.supplier}{ap ? <span style={{ fontSize: 11, color: C.success, display: "inline-flex", gap: 3 }}><Check size={13} /> Approved</span> : <span style={{ fontSize: 10, fontWeight: 600, color: C.opticInk, background: C.optic, padding: "2px 7px", borderRadius: 999 }}>SUGGESTED</span>}</div><div style={{ fontSize: 11, color: C.subtle }}>Lead {d.lead}d · {d.items.length} lines</div></div>
              <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 600 }}>{inrC(d.total)}</div>
            </div>
            <div style={{ padding: "6px 18px" }}>{d.items.map((s, i) => (
              <div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < d.items.length - 1 ? `1px solid ${C.border}` : "none", opacity: s._def ? 0.45 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}><div onClick={() => skuPortal.open(s)} style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>on hand {s.onHand} · {inr(s.unitCost)}/u{s._def ? " · deferred" : ""}</div></div>
                <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, textAlign: "right" }}>×{s.qty}<div style={{ fontSize: 11, fontWeight: 400, color: C.muted }}>{inrC(s.qty * s.unitCost)}</div></div>
              </div>
            ))}</div>
            <div style={{ display: "flex", gap: 8, padding: "0 18px 16px" }}>{ap ? <button onClick={() => setApproved(approved.filter((x) => x !== d.supplier))} style={{ ...btnGhost, flex: 1 }}><RefreshCw size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} /> Undo</button> : <><button onClick={() => setApproved([...approved, d.supplier])} style={{ ...btnPrimary, flex: 1, justifyContent: "center", padding: "9px 12px", fontSize: 13 }}><Truck size={14} /> Approve &amp; send</button><button style={btnGhost}>Edit</button></>}</div>
          </div>
        ); })}
      </div>
    </div>
  );
}
function Tasks({ skus, onAddPo }) {
  const reorder = skus.filter((s) => s.risk <= 1).sort((a, b) => a.cover - b.cover).slice(0, 8);
  const incoming = skus.filter((s) => s.inTransit > 0).slice(0, 6);
  const [done, setDone] = useState([]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}><Kpi label="To reorder today" value={reorder.length} tone={C.warning} Icon={ClipboardList} /><Kpi label="Incoming to receive" value={incoming.length} tone={C.info} Icon={Inbox} /><Kpi label="Tasks done" value={done.length} tone={C.success} Icon={CheckCircle2} /></div>
      <Card title="Reorder checklist" subtitle="tick off as you go · tap a name for the full story" pad={0}>
        <div style={{ padding: "4px 18px" }}>{reorder.map((s, i) => (
          <div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < reorder.length - 1 ? `1px solid ${C.border}` : "none", opacity: done.includes(s.sku) ? 0.5 : 1 }}>
            <button onClick={() => setDone((d) => d.includes(s.sku) ? d.filter((x) => x !== s.sku) : [...d, s.sku])} style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${done.includes(s.sku) ? C.success : C.borderStrong}`, background: done.includes(s.sku) ? C.success : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{done.includes(s.sku) && <Check size={14} color="#fff" />}</button>
            <div onClick={() => skuPortal.open(s)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}><div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle }}>{isFinite(s.cover) ? Math.round(s.cover) + "d cover left" : "no sales"} · on hand {s.onHand}</div></div>
            <RiskBadge level={s.risk} /><button onClick={() => onAddPo(s)} style={btnPrimary}><Plus size={13} /> {s.suggestedQty}</button>
          </div>
        ))}</div>
      </Card>
      <Card title="Incoming stock to receive" pad={0}><div style={{ padding: "4px 18px" }}>{incoming.length === 0 ? <div style={{ fontSize: 13, color: C.subtle, padding: "10px 0" }}>Nothing in transit right now.</div> : incoming.map((s, i) => (
        <div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < incoming.length - 1 ? `1px solid ${C.border}` : "none" }}><Truck size={16} color={C.info} /><div onClick={() => skuPortal.open(s)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}><div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>{s.sku}</div></div><span style={{ fontFamily: mono, fontWeight: 600, color: C.info }}>+{s.inTransit}</span><button style={btnGhost}>Receive</button></div>
      ))}</div></Card>
    </div>
  );
}
function Lookup({ skus }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? skus.filter((s) => s.name.toLowerCase().includes(t) || s.sku.toLowerCase().includes(t) || s.supplier.toLowerCase().includes(t)) : skus).slice(0, 40); }, [q, skus]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface, borderRadius: 12, padding: "12px 16px", border: `1px solid ${C.border}` }}><Search size={18} color={C.subtle} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any product, SKU or brand…" style={{ border: "none", background: "transparent", outline: "none", fontSize: 15, width: "100%", color: C.text }} /></div>
      <Card title={`${rows.length} product${rows.length === 1 ? "" : "s"}`} subtitle="tap any row for SKU 360" pad={0}><OpsTable rows={rows} cols={["product", "risk", "cover", "onhand", "value"]} /></Card>
    </div>
  );
}
function buildInsights(skus, agg, util, role) {
  const out = [];
  const atRisk = skus.filter((s) => s.risk <= 1), revRisk = atRisk.reduce((a, s) => a + s.protectedRev, 0);
  const dead = skus.filter((s) => s.risk === 4), deadCash = dead.reduce((a, s) => a + s.stockValue, 0);
  const over = skus.filter((s) => s.risk === 3);
  const topCat = Object.entries(skus.reduce((m, s) => ((m[s.category] = (m[s.category] || 0) + s.dailyRev), m), {})).sort((a, b) => b[1] - a[1])[0];
  if (role === "exec") out.push({ icon: Sparkles, color: C.purple, text: `Run-rate ${inrC(agg.monthRev)}/mo, ${inrC(agg.yearRev)}/yr. Inventory turning ${util.turns.toFixed(1)}× with GMROI ${util.gmroi.toFixed(2)} and ${pct(util.capitalUtil)} of capital in healthy stock.` });
  if (atRisk.length) out.push({ icon: AlertOctagon, color: C.danger, text: `${atRisk.length} SKUs will run dry inside lead time — ${inrC(revRisk)} of revenue exposed.`, action: "Review reorders", to: "radar" });
  if (deadCash > 0) out.push({ icon: Snowflake, color: C.dead, text: `${inrC(deadCash)} frozen in ${dead.length} dead SKUs. Clearing the top 5 frees ~${inrC(dead.slice(0, 5).reduce((a, s) => a + s.stockValue, 0))}.`, action: "Open dead stock", to: "dead" });
  if (topCat) out.push({ icon: TrendingUp, color: C.success, text: `${topCat[0]} is your revenue engine right now. June is an off-season lull — pre-season ramp starts September.` });
  if (over.length) out.push({ icon: Layers, color: C.overstock, text: `${over.length} SKUs overstocked beyond 60 days — pause on the next PO or transfer between stores to free cash.`, action: "Open what-if", to: "forecast" });
  return out;
}
function Insights({ skus, agg, util, role, go }) {
  const insights = buildInsights(skus, agg, util, role);
  const actions = [
    { icon: ClipboardList, label: "Draft all suggested POs", to: "po", color: C.optic },
    { icon: Snowflake, label: "Review dead stock to clear", to: "dead", color: C.dead },
    { icon: Activity, label: "Run a what-if scenario", to: "forecast", color: C.warning },
    { icon: Sparkles, label: "Ask Baseline a question", to: "ask", color: C.purple },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card title="Baseline AI — what to do now" subtitle="generated from live catalog + the replenishment engine" action={<Sparkles size={16} color={C.purple} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{insights.map((ins, i) => (
          <div key={i} style={{ display: "flex", gap: 11, paddingBottom: i < insights.length - 1 ? 14 : 0, borderBottom: i < insights.length - 1 ? `1px solid ${C.border}` : "none" }}><div style={{ width: 30, height: 30, borderRadius: 8, background: ins.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ins.icon size={16} color={ins.color} /></div><div style={{ fontSize: 13.5, lineHeight: 1.55, paddingTop: 4 }}>{ins.text}{ins.to && <button onClick={() => go(ins.to)} style={{ ...btnGhost, padding: "2px 8px", marginLeft: 8, fontSize: 11 }}>{ins.action} →</button>}</div></div>
        ))}</div>
      </Card>
      <Card title="Quick actions"><div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>{actions.map((a) => (
        <button key={a.label} onClick={() => go(a.to)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.surfaceAlt, cursor: "pointer", textAlign: "left" }}><div style={{ width: 34, height: 34, borderRadius: 9, background: a.color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}><a.icon size={17} color={a.color === C.optic ? C.opticInk : a.color} /></div><span style={{ fontSize: 14, fontWeight: 500 }}>{a.label}</span><ArrowRight size={15} color={C.subtle} style={{ marginLeft: "auto" }} /></button>
      ))}</div></Card>
    </div>
  );
}
function SourceBar({ inline }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, ...(inline ? {} : { background: C.navy, borderRadius: 14, padding: "12px 18px", color: "#fff" }) }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: inline ? C.muted : "#fff" }}><span style={{ width: 7, height: 7, borderRadius: 999, background: C.success }} /> Catalog: <b style={{ color: inline ? C.success : C.optic }}>live</b> · {CATALOG.totalProducts.toLocaleString("en-IN")} products</span>
      {!inline && <span style={{ fontSize: 12, color: "#A7B0C0" }}>Stock &amp; sales: modeled — grant the integration <code style={{ background: "#1F2E4D", padding: "1px 5px", borderRadius: 4 }}>Sales</code> &amp; <code style={{ background: "#1F2E4D", padding: "1px 5px", borderRadius: 4 }}>Inventory</code> scopes to go fully live.</span>}
      {!inline && <span style={{ marginLeft: "auto", fontSize: 11, color: "#7C8696" }}>{CATALOG.stores.length} stores · INR</span>}
    </div>
  );
}

/* ============================ SHELL ============================ */
const ROLES = {
  exec: { label: "CEO / CXO", Icon: Crown, nav: ["ask", "executive", "sales", "analytics", "dead", "insights"], home: "executive" },
  procurement: { label: "Procurement", Icon: ShoppingCart, nav: ["ask", "radar", "forecast", "po", "suppliers", "stores", "insights"], home: "radar" },
  employee: { label: "Store team", Icon: Users, nav: ["ask", "tasks", "lookup"], home: "tasks" },
};
const VIEW_META = {
  ask: { label: "Ask Baseline", Icon: Sparkles }, executive: { label: "Executive overview", Icon: LayoutDashboard },
  sales: { label: "Sales", Icon: TrendingUp }, analytics: { label: "Utilization analytics", Icon: Gauge },
  radar: { label: "Stockout radar", Icon: Radar }, forecast: { label: "Forecast & what-if", Icon: Activity },
  po: { label: "Reorder / Auto-PO", Icon: ClipboardList }, suppliers: { label: "Suppliers", Icon: Award },
  stores: { label: "Stores & transfers", Icon: Store }, dead: { label: "Dead stock", Icon: Snowflake },
  insights: { label: "AI insights", Icon: MessageSquare }, tasks: { label: "My tasks", Icon: ClipboardList }, lookup: { label: "Product lookup", Icon: Search },
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
  const [selSku, setSelSku] = useState(null);
  skuPortal.open = setSelSku;

  const skus = useMemo(() => buildSkus({ surge, delay }), [surge, delay]);
  const agg = useMemo(() => salesAgg(skus), [skus]);
  const util = useMemo(() => utilization(skus), [skus]);
  const alerts = skus.filter((s) => s.risk <= 1);
  const switchRole = (r) => { setRole(r); setTab(ROLES[r].home); };
  const go = (t) => setTab(t);
  const addPo = (s) => { setPoItems((p) => (p.find((x) => x.sku === s.sku) ? p : [...p, s])); setToast(`Added ${s.suggestedQty} × ${s.name.slice(0, 26)} to PO`); setTimeout(() => setToast(null), 2800); };
  const nav = ROLES[role].nav;
  const selFull = selSku ? skus.find((x) => x.sku === selSku.sku) || selSku : null;

  return (
    <div style={{ display: "flex", minHeight: 800, fontFamily: "Inter, system-ui, sans-serif", background: C.bg, color: C.text, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Baseline inventory intelligence for Tennis Outlet — role-based dashboards, AI assistant and SKU drill-downs on live catalog data.</span>
      <aside style={{ width: 240, background: C.navy, color: "#fff", padding: "20px 14px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 18px" }}><div style={{ width: 30, height: 30, borderRadius: 9, background: C.optic, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: 12, height: 12, borderRadius: 999, border: `2px solid ${C.opticInk}` }} /></div><div><div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>Baseline</div><div style={{ fontSize: 10, color: C.subtle, marginTop: -2 }}>Tennis Outlet</div></div></div>
        <div style={{ padding: "0 4px 16px" }}>
          <div style={{ fontSize: 10, color: "#7C8696", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 7, paddingLeft: 4 }}>Workspace</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>{Object.entries(ROLES).map(([k, r]) => (
            <button key={k} onClick={() => switchRole(k)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, border: "none", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: role === k ? 600 : 500, background: role === k ? C.optic : "transparent", color: role === k ? C.opticInk : "#A7B0C0" }}><r.Icon size={15} /> {r.label}</button>
          ))}</div>
        </div>
        <div style={{ height: 1, background: C.navy600, margin: "0 4px 14px" }} />
        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>{nav.map((id) => { const v = VIEW_META[id]; const active = tab === id; return (
          <button key={id} onClick={() => setTab(id)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: active ? 600 : 500, background: active ? C.navy600 : "transparent", color: active ? "#fff" : "#A7B0C0", borderLeft: active ? `3px solid ${C.optic}` : "3px solid transparent" }}>
            <v.Icon size={18} color={active ? C.optic : "#7C8696"} strokeWidth={1.75} /> {v.label}
            {id === "ask" && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, background: C.purple, color: "#fff", borderRadius: 999, padding: "1px 6px" }}>AI</span>}
            {id === "radar" && alerts.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, background: C.danger, color: "#fff", borderRadius: 999, padding: "1px 7px" }}>{alerts.length}</span>}
          </button>
        ); })}</nav>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 7, padding: "10px 12px", fontSize: 11, color: C.success }}><span style={{ width: 7, height: 7, borderRadius: 999, background: C.success }} /> Catalog synced · Magento</div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 24px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{VIEW_META[tab].label}</h1>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 999, padding: "3px 10px" }}>{ROLES[role].label}</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setTab("ask")} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", color: C.purple, borderColor: C.purple + "44" }}><Sparkles size={15} /> Ask Baseline</button>
            <button style={{ position: "relative", width: 38, height: 38, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Bell size={17} color={C.muted} />{alerts.length > 0 && <span style={{ position: "absolute", top: 8, right: 9, width: 7, height: 7, borderRadius: 999, background: C.danger }} />}</button>
            <div style={{ width: 38, height: 38, borderRadius: 999, background: C.navy600, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14 }}>TO</div>
          </div>
        </header>
        <main style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {tab === "ask" && <AskBaseline skus={skus} agg={agg} util={util} role={role} />}
          {tab === "executive" && <Executive skus={skus} agg={agg} util={util} go={go} />}
          {tab === "sales" && <Sales skus={skus} agg={agg} />}
          {tab === "analytics" && <Analytics skus={skus} />}
          {tab === "radar" && <StockoutRadar skus={skus} onAddPo={addPo} />}
          {tab === "forecast" && <ForecastWhatIf surge={surge} setSurge={setSurge} delay={delay} setDelay={setDelay} skus={skus} />}
          {tab === "po" && <AutoPO skus={skus} poItems={poItems} approved={approved} setApproved={setApproved} budget={budget} setBudget={setBudget} />}
          {tab === "suppliers" && <Suppliers skus={skus} />}
          {tab === "stores" && <StoreCompare skus={skus} />}
          {tab === "dead" && <DeadStock skus={skus} />}
          {tab === "insights" && <Insights skus={skus} agg={agg} util={util} role={role} go={go} />}
          {tab === "tasks" && <Tasks skus={skus} onAddPo={addPo} />}
          {tab === "lookup" && <Lookup skus={skus} />}
        </main>
      </div>

      <SkuDrawer s={selFull} onClose={() => setSelSku(null)} onAddPo={addPo} />
      {toast && <div style={{ position: "fixed", bottom: 24, left: 24, background: C.navy, color: "#fff", padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, zIndex: 200 }}><CheckCircle2 size={16} color={C.optic} /> {toast}</div>}
    </div>
  );
}
