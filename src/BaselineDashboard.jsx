import { useState, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  LayoutDashboard, Radar, TrendingUp, Snowflake, ClipboardList, Settings, Search,
  Bell, AlertOctagon, AlertTriangle, CheckCircle2, Layers, Truck, Crown, Users, ShoppingCart,
  TrendingDown, Package, IndianRupee, Plus, Check, X, RefreshCw, Activity, Sparkles,
  Target, CalendarDays, Wallet, Award, Boxes, ArrowRight, Inbox,
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

const RISK = {
  0: { label: "Stockout risk", color: C.danger, Icon: AlertOctagon },
  1: { label: "Reorder now", color: C.warning, Icon: AlertTriangle },
  2: { label: "Healthy", color: C.success, Icon: CheckCircle2 },
  3: { label: "Overstock", color: C.overstock, Icon: Layers },
  4: { label: "Dead stock", color: C.dead, Icon: Snowflake },
};

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
const MONTH = 5; // June 2026
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const seasonIdx = (cat, m = MONTH) => (SEASON[cat] ? SEASON[cat][m] : 1);

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
    return {
      ...p, forecastDaily, effLead, reorderWindow, targetMaxDays, cover, risk,
      suggestedQty: suggested, stockValue: p.onHand * p.unitCost,
      protectedRev: forecastDaily * p.price * effLead, dailyRev,
      margin: p.price > 0 ? (p.price - p.unitCost) / p.price : 0,
    };
  });
}

/* sales aggregates from the modeled book */
function salesAgg(skus) {
  const dayRev = skus.reduce((a, s) => a + s.dailyRev, 0);
  const yearRev = skus.reduce((a, s) => a + s.avgDaily * s.price * SEASON[s.category].reduce((x, y) => x + y, 0) / 12 * 365, 0);
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

/* ============================ PRIMITIVES ============================ */
const RiskBadge = ({ level }) => { const r = RISK[level]; return (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: r.color + "1A", color: r.color, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}><r.Icon size={13} /> {r.label}</span>
); };

function CoverMeter({ s }) {
  if (!isFinite(s.cover)) return <span style={{ fontSize: 12, color: C.subtle, fontStyle: "italic" }}>no recent sales</span>;
  const scaleMax = Math.max(s.targetMaxDays, s.cover, s.reorderWindow) * 1.1, pct = (v) => Math.min(100, (v / scaleMax) * 100), r = RISK[s.risk];
  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{s.cover.toFixed(0)}d</span>
        <span style={{ fontSize: 11, color: C.subtle }}>lead {s.effLead}d</span>
      </div>
      <div style={{ position: "relative", height: 7, borderRadius: 999, background: C.border }}>
        <div style={{ position: "absolute", inset: 0, width: pct(s.cover) + "%", borderRadius: 999, background: r.color, transition: "width .35s" }} />
        <div style={{ position: "absolute", top: -2, left: pct(s.effLead) + "%", width: 2, height: 11, background: C.danger }} />
      </div>
    </div>
  );
}

function Kpi({ label, value, delta, intent = "neutral", tone, Icon, sub }) {
  const up = delta >= 0, positive = up === (intent !== "negative");
  const dc = delta == null ? C.subtle : positive ? C.success : C.danger;
  return (
    <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: 18, position: "relative", overflow: "hidden" }}>
      {tone && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: tone }} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: C.muted }}>{label}</span>
        {Icon && <Icon size={15} color={C.subtle} strokeWidth={1.75} />}
      </div>
      <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9 }}>
        {delta != null && <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 12, fontWeight: 600, color: dc }}>{up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(delta)}%</span>}
        {sub && <span style={{ fontSize: 12, color: C.subtle }}>{sub}</span>}
      </div>
    </div>
  );
}

function Card({ title, subtitle, action, children, pad = 18 }) {
  return (
    <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}` }}>
      {title && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
          <div><div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>{subtitle && <div style={{ fontSize: 12, color: C.subtle, marginTop: 2 }}>{subtitle}</div>}</div>
          {action}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  );
}

const Tip = ({ active, payload, label, fmt = (v) => v }) => (!active || !payload?.length) ? null : (
  <div style={{ background: C.navy, color: "#fff", padding: "8px 12px", borderRadius: 8, fontSize: 12 }}>
    <div style={{ color: "#9AA1AD", marginBottom: 4 }}>{label}</div>
    {payload.map((p, i) => <div key={i} style={{ fontFamily: mono, fontWeight: 600, color: p.color || "#fff" }}>{p.name}: {fmt(p.value)}</div>)}
  </div>
);

const btnGhost = { fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.borderStrong}`, background: "transparent", cursor: "pointer", color: C.text };
const btnPrimary = { fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "none", background: C.optic, color: C.opticInk, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 };

function Segment({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 9, padding: 3 }}>
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{ border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 7, background: value === o.v ? C.surface : "transparent", color: value === o.v ? C.text : C.muted, boxShadow: value === o.v ? "0 1px 2px rgba(0,0,0,.06)" : "none" }}>{o.l}</button>
      ))}
    </div>
  );
}

/* ============================ AI INSIGHTS ENGINE ============================ */
function buildInsights(skus, agg, role) {
  const out = [];
  const atRisk = skus.filter((s) => s.risk <= 1);
  const revRisk = atRisk.reduce((a, s) => a + s.protectedRev, 0);
  const dead = skus.filter((s) => s.risk === 4);
  const deadCash = dead.reduce((a, s) => a + s.stockValue, 0);
  const over = skus.filter((s) => s.risk === 3);
  const topCat = Object.entries(skus.reduce((m, s) => ((m[s.category] = (m[s.category] || 0) + s.dailyRev), m), {})).sort((a, b) => b[1] - a[1])[0];
  const worstAcc = [...skus].sort((a, b) => a.accuracy - b.accuracy)[0];

  if (atRisk.length) out.push({ icon: AlertOctagon, color: C.danger, text: `${atRisk.length} SKUs will run dry inside their lead time — ${inrC(revRisk)} of forward revenue is exposed.`, action: "Review reorders", to: "radar" });
  if (deadCash > 0) out.push({ icon: Snowflake, color: C.dead, text: `${inrC(deadCash)} is frozen in ${dead.length} dead SKUs. Clearing the top 5 would free ~${inrC(dead.slice(0, 5).reduce((a, s) => a + s.stockValue, 0))}.`, action: "Open dead stock", to: "dead" });
  if (topCat) out.push({ icon: TrendingUp, color: C.success, text: `${topCat[0]} is your revenue engine right now (${inrC(topCat[1] * 30)}/mo modeled). June is an off-season lull — pre-season ramp starts September.` });
  if (over.length) out.push({ icon: Layers, color: C.overstock, text: `${over.length} SKUs are overstocked beyond 60 days of cover — candidates to pause on the next PO and free working capital.`, action: "Open what-if", to: "forecast" });
  if (worstAcc) out.push({ icon: Target, color: C.warning, text: `Forecast accuracy is weakest on ${worstAcc.name} (${Math.round(worstAcc.accuracy * 100)}%). More sales history will sharpen it — connect the Sales scope to feed real velocity.` });
  if (role === "exec") out.unshift({ icon: Sparkles, color: C.purple, text: `Modeled run-rate: ${inrC(agg.monthRev)}/month, ${inrC(agg.yearRev)}/year across the group. Gross margin holding near ${Math.round(skus.reduce((a, s) => a + s.margin, 0) / skus.length * 100)}%.` });
  return out;
}

/* ============================ EXECUTIVE (CEO/CXO) ============================ */
function Executive({ skus, agg, go }) {
  const [tsPeriod, setTsPeriod] = useState(30);
  const invValue = skus.reduce((a, s) => a + s.stockValue, 0);
  const deadValue = skus.filter((s) => s.risk === 4).reduce((a, s) => a + s.stockValue, 0);
  const grossMargin = Math.round(skus.reduce((a, s) => a + s.margin, 0) / skus.length * 100);
  const top = topSellers(skus, tsPeriod);
  const insights = buildInsights(skus, agg, "exec");
  const catRev = Object.entries(skus.reduce((m, s) => ((m[s.category] = (m[s.category] || 0) + s.dailyRev * 30), m), {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const catColors = [C.optic, C.clay, C.blue, C.dead, C.overstock, C.success, C.warning, C.purple];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SourceBar />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
        <Kpi label="Sales today" value={inrC(agg.dayRev)} delta={8} Icon={IndianRupee} sub="modeled" />
        <Kpi label="This week" value={inrC(agg.weekRev)} delta={6} Icon={CalendarDays} />
        <Kpi label="This month" value={inrC(agg.monthRev)} delta={-4} Icon={TrendingUp} sub="off-season" />
        <Kpi label="Gross margin" value={grossMargin + "%"} delta={2} Icon={Award} />
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
                <Tooltip content={<Tip fmt={inrC} />} />
                <ReferenceLine x="Jun" stroke={C.borderStrong} strokeDasharray="2 2" />
                <Area type="monotone" dataKey="rev" name="Revenue" stroke={C.blue} strokeWidth={2.5} fill="url(#exrev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="AI executive briefing" subtitle="generated from live signals" action={<Sparkles size={15} color={C.purple} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {insights.slice(0, 4).map((ins, i) => (
              <div key={i} style={{ display: "flex", gap: 9 }}>
                <ins.icon size={15} color={ins.color} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.text }}>{ins.text}{ins.to && <button onClick={() => go(ins.to)} style={{ ...btnGhost, padding: "1px 7px", marginLeft: 6, fontSize: 11 }}>{ins.action} →</button>}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Card title="Top sellers" subtitle="ranked by modeled revenue" action={<Segment value={tsPeriod} onChange={setTsPeriod} options={[{ v: 1, l: "Day" }, { v: 7, l: "Week" }, { v: 30, l: "Month" }, { v: 365, l: "Year" }]} />} pad={0}>
          <div style={{ padding: "6px 18px" }}>
            {top.slice(0, 6).map((s, i) => (
              <div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: i < 5 ? `1px solid ${C.border}` : "none" }}>
                <span style={{ fontFamily: mono, fontSize: 12, color: i < 3 ? C.clay : C.subtle, fontWeight: 600, width: 18 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: C.subtle }}>{s.category} · {s.periodUnits} units</div>
                </div>
                <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{inrC(s.periodRev)}</span>
              </div>
            ))}
          </div>
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

/* ============================ SALES ============================ */
function Sales({ skus, agg }) {
  const [period, setPeriod] = useState(30);
  const top = topSellers(skus, period);
  const series = period === 1 ? agg.days.map((d) => ({ x: "D" + d.d, rev: d.rev })) : period === 365 ? agg.months.map((m) => ({ x: m.m, rev: m.rev })) : period === 7 ? agg.weeks.slice(-8).map((w) => ({ x: w.w, rev: w.rev / 7 })) : agg.weeks.map((w) => ({ x: w.w, rev: w.rev }));
  const periodRev = period === 1 ? agg.dayRev : period === 7 ? agg.weekRev : period === 365 ? agg.yearRev : agg.monthRev;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SourceBar inline />
        <Segment value={period} onChange={setPeriod} options={[{ v: 1, l: "Day" }, { v: 7, l: "Week" }, { v: 30, l: "Month" }, { v: 365, l: "Year" }]} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        <Kpi label={`Revenue (${period === 1 ? "today" : period === 7 ? "this week" : period === 365 ? "this year" : "this month"})`} value={inrC(periodRev)} delta={period === 30 ? -4 : 7} Icon={IndianRupee} />
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
              <Tooltip content={<Tip fmt={inrC} />} />
              <Line type="monotone" dataKey="rev" name="Revenue" stroke={C.blue} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title={`Top sellers — ${period === 1 ? "today" : period === 7 ? "this week" : period === 365 ? "this year" : "this month"}`} subtitle="modeled from live catalog + seasonal velocity" pad={0}>
        <SimpleTable rows={top} cols={["rank", "product", "cat", "units", "rev"]} />
      </Card>
    </div>
  );
}

function SimpleTable({ rows, cols }) {
  const H = ({ c, r }) => <th style={{ textAlign: r ? "right" : "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", color: C.muted, padding: "11px 14px", position: "sticky", top: 0, background: C.surfaceAlt }}>{c}</th>;
  const td = { padding: "11px 14px", fontSize: 13, borderTop: `1px solid ${C.border}` };
  return (
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>
        {cols.includes("rank") && <H c="#" />}{cols.includes("product") && <H c="Product" />}{cols.includes("cat") && <H c="Category" />}
        {cols.includes("units") && <H c="Units" r />}{cols.includes("rev") && <H c="Revenue" r />}
      </tr></thead>
      <tbody>{rows.map((s, i) => (
        <tr key={s.sku} onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceAlt)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          {cols.includes("rank") && <td style={{ ...td, fontFamily: mono, color: i < 3 ? C.clay : C.subtle, fontWeight: 600, width: 36 }}>{i + 1}</td>}
          {cols.includes("product") && <td style={td}><div style={{ fontWeight: 500 }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>{s.sku} · {s.supplier}</div></td>}
          {cols.includes("cat") && <td style={{ ...td, color: C.muted }}>{s.category}</td>}
          {cols.includes("units") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{s.periodUnits}</td>}
          {cols.includes("rev") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inrC(s.periodRev)}</td>}
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/* ============================ PROCUREMENT: radar / forecast / suppliers / PO ============================ */
function StockoutRadar({ skus, onAddPo }) {
  const rows = useMemo(() => skus.filter((s) => s.risk <= 1).sort((a, b) => a.cover - b.cover), [skus]);
  return <Card title={`Stockout radar — ${rows.length} SKUs need attention`} subtitle="ranked by forecasted days of cover" pad={0}><OpsTable rows={rows} onAddPo={onAddPo} cols={["product", "risk", "cover", "acc", "onhand", "suggest", "action"]} /></Card>;
}

function Suppliers({ skus }) {
  const map = {};
  skus.forEach((s) => { const m = (map[s.supplier] = map[s.supplier] || { supplier: s.supplier, skus: 0, spend: 0, onOrder: 0, lead: s.leadTime }); m.skus++; m.spend += s.stockValue; m.onOrder += s.suggestedQty * s.unitCost; });
  const SUP_OTIF = { Babolat: .94, Wilson: .91, Yonex: .88, Head: .90, Nike: .92, Adidas: .86, Asics: .89, Solinco: .95, Dunlop: .9, Tecnifibre: .9, "House / Other": .9 };
  const rows = Object.values(map).map((m) => ({ ...m, otif: SUP_OTIF[m.supplier] ?? .9 })).sort((a, b) => b.spend - a.spend);
  const td = { padding: "11px 14px", fontSize: 13, borderTop: `1px solid ${C.border}` };
  return (
    <Card title="Supplier scorecard" subtitle="reliability, spend and open orders by vendor" pad={0}>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["Supplier", "SKUs", "Lead time", "OTIF", "Stock value", "Suggested order"].map((h, i) => <th key={h} style={{ textAlign: i === 0 ? "left" : "right", fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.muted, padding: "11px 14px", background: C.surfaceAlt }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((m) => (
          <tr key={m.supplier} onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceAlt)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <td style={{ ...td, fontWeight: 500 }}>{m.supplier}</td>
            <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{m.skus}</td>
            <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{m.lead}d</td>
            <td style={{ ...td, textAlign: "right" }}><span style={{ fontFamily: mono, fontWeight: 600, color: m.otif >= .92 ? C.success : m.otif >= .88 ? C.warning : C.danger }}>{Math.round(m.otif * 100)}%</span></td>
            <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inrC(m.spend)}</td>
            <td style={{ ...td, textAlign: "right", fontFamily: mono, color: m.onOrder > 0 ? C.text : C.subtle }}>{m.onOrder > 0 ? inrC(m.onOrder) : "—"}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
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
        {cols.includes("suggest") && <H c="Suggested" r />}{cols.includes("value") && <H c="Stock value" r />}{cols.includes("action") && <H c="Action" r />}{cols.includes("markdown") && <H c="Action" r />}
      </tr></thead>
      <tbody>{rows.map((s) => (
        <tr key={s.sku} onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceAlt)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          {cols.includes("product") && <td style={td}><div style={{ fontWeight: 500 }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>{s.sku} · {s.supplier}</div></td>}
          {cols.includes("risk") && <td style={td}><RiskBadge level={s.risk} /></td>}
          {cols.includes("cover") && <td style={td}><CoverMeter s={s} /></td>}
          {cols.includes("acc") && <td style={{ ...td, textAlign: "right" }}><span style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: s.accuracy >= .92 ? C.success : s.accuracy >= .87 ? C.warning : C.danger }}>{Math.round(s.accuracy * 100)}%</span></td>}
          {cols.includes("age") && <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{s.age}d</td>}
          {cols.includes("onhand") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{s.onHand}{s.inTransit > 0 ? <span style={{ color: C.info, fontWeight: 500 }}> +{s.inTransit}</span> : ""}</td>}
          {cols.includes("suggest") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600, color: s.suggestedQty > 0 ? C.text : C.subtle }}>{s.suggestedQty || "—"}</td>}
          {cols.includes("value") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inrC(s.stockValue)}</td>}
          {cols.includes("action") && <td style={{ ...td, textAlign: "right" }}><button disabled={!s.suggestedQty} onClick={() => onAddPo && onAddPo(s)} style={{ ...btnPrimary, ...(s.suggestedQty ? {} : { background: C.border, color: C.subtle, cursor: "not-allowed" }) }}><Plus size={13} /> Add {s.suggestedQty || ""}</button></td>}
          {cols.includes("markdown") && <td style={{ ...td, textAlign: "right" }}><button style={{ ...btnGhost, color: C.clay, borderColor: C.clay + "55" }}>Mark down</button></td>}
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function ForecastWhatIf({ surge, setSurge, delay, setDelay, skus }) {
  const atRisk = skus.filter((s) => s.risk <= 1).length;
  const revAtRisk = skus.filter((s) => s.risk <= 1).reduce((a, s) => a + s.protectedRev, 0);
  const top = [...skus].sort((a, b) => b.protectedRev - a.protectedRev).slice(0, 8);
  const S = ({ label, hint, value, min, max, step, unit, onChange, color }) => (
    <div><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span><span style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color }}>{value}{unit}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: color }} /><div style={{ fontSize: 11, color: C.subtle, marginTop: 4 }}>{hint}</div></div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card title="What-if simulator" subtitle="stress-test demand surges and supplier delays — recomputes live">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 8 }}>
          <S label="Demand surge" hint="e.g. tournament / season start" value={surge} min={0} max={100} step={5} unit="%" onChange={setSurge} color={C.clay} />
          <S label="Supplier delay" hint="added to every lead time" value={delay} min={0} max={21} step={1} unit="d" onChange={setDelay} color={C.warning} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 12 }}>
          <Kpi label="SKUs at risk" value={atRisk} tone={atRisk > 20 ? C.danger : C.warning} Icon={AlertTriangle} sub="this scenario" />
          <Kpi label="Revenue exposed" value={inrC(revAtRisk)} tone={C.danger} Icon={IndianRupee} />
          <Kpi label="Scenario" value={surge === 0 && delay === 0 ? "Baseline" : "Stressed"} Icon={Activity} sub={`+${surge}% · +${delay}d`} />
        </div>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        <Kpi label="Cash locked in slow stock" value={inrC(trapped)} tone={C.dead} Icon={Snowflake} />
        <Kpi label="Dead SKUs (no sale 90d+)" value={skus.filter((s) => s.risk === 4).length} tone={C.dead} Icon={Snowflake} />
        <Kpi label="Overstocked SKUs" value={skus.filter((s) => s.risk === 3).length} tone={C.overstock} Icon={Layers} />
      </div>
      <Card title="Markdown & clearance candidates" subtitle="highest trapped cash first" pad={0}><OpsTable rows={rows} cols={["product", "risk", "age", "onhand", "value", "markdown"]} /></Card>
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
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Wallet size={16} color={C.muted} /><span style={{ fontSize: 13, color: C.muted }}>Open-to-buy budget</span></div>
          <input type="range" min={0} max={2000000} step={50000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} style={{ flex: 1, minWidth: 180, accentColor: C.optic }} />
          <span style={{ fontFamily: mono, fontWeight: 600, fontSize: 16, minWidth: 100, textAlign: "right" }}>{budget === 0 ? "No cap" : inrC(budget)}</span>
          <span style={{ fontSize: 12, color: C.subtle }}>committing {inrC(result.spent)}</span>
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 18, alignItems: "start" }}>
        {result.drafts.map((d) => {
          const ap = approved.includes(d.supplier);
          return (
            <div key={d.supplier} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${ap ? C.success : C.border}`, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", background: ap ? C.success + "10" : C.surfaceAlt, borderBottom: `1px solid ${C.border}` }}>
                <div><div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>{d.supplier}{ap ? <span style={{ fontSize: 11, color: C.success, display: "inline-flex", gap: 3 }}><Check size={13} /> Approved</span> : <span style={{ fontSize: 10, fontWeight: 600, color: C.opticInk, background: C.optic, padding: "2px 7px", borderRadius: 999 }}>SUGGESTED</span>}</div><div style={{ fontSize: 11, color: C.subtle }}>Lead {d.lead}d · {d.items.length} lines</div></div>
                <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 600 }}>{inrC(d.total)}</div>
              </div>
              <div style={{ padding: "6px 18px" }}>{d.items.map((s, i) => (
                <div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < d.items.length - 1 ? `1px solid ${C.border}` : "none", opacity: s._def ? 0.45 : 1 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>on hand {s.onHand} · {inr(s.unitCost)}/u{s._def ? " · deferred" : ""}</div></div>
                  <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, textAlign: "right" }}>×{s.qty}<div style={{ fontSize: 11, fontWeight: 400, color: C.muted }}>{inrC(s.qty * s.unitCost)}</div></div>
                </div>
              ))}</div>
              <div style={{ display: "flex", gap: 8, padding: "0 18px 16px" }}>
                {ap ? <button onClick={() => setApproved(approved.filter((x) => x !== d.supplier))} style={{ ...btnGhost, flex: 1 }}><RefreshCw size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} /> Undo</button>
                  : <><button onClick={() => setApproved([...approved, d.supplier])} style={{ ...btnPrimary, flex: 1, justifyContent: "center", padding: "9px 12px", fontSize: 13 }}><Truck size={14} /> Approve &amp; send</button><button style={btnGhost}>Edit</button></>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================ EMPLOYEE: tasks + lookup ============================ */
function Tasks({ skus, onAddPo }) {
  const reorder = skus.filter((s) => s.risk <= 1).sort((a, b) => a.cover - b.cover).slice(0, 8);
  const incoming = skus.filter((s) => s.inTransit > 0).slice(0, 6);
  const [done, setDone] = useState([]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        <Kpi label="To reorder today" value={reorder.length} tone={C.warning} Icon={ClipboardList} />
        <Kpi label="Incoming to receive" value={incoming.length} tone={C.info} Icon={Inbox} />
        <Kpi label="Tasks done" value={done.length} tone={C.success} Icon={CheckCircle2} />
      </div>
      <Card title="Reorder checklist" subtitle="tap add to drop into the purchase order" pad={0}>
        <div style={{ padding: "4px 18px" }}>{reorder.map((s, i) => (
          <div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < reorder.length - 1 ? `1px solid ${C.border}` : "none", opacity: done.includes(s.sku) ? 0.5 : 1 }}>
            <button onClick={() => setDone((d) => d.includes(s.sku) ? d.filter((x) => x !== s.sku) : [...d, s.sku])} style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${done.includes(s.sku) ? C.success : C.borderStrong}`, background: done.includes(s.sku) ? C.success : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{done.includes(s.sku) && <Check size={14} color="#fff" />}</button>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle }}>{isFinite(s.cover) ? Math.round(s.cover) + "d cover left" : "no sales"} · on hand {s.onHand}</div></div>
            <RiskBadge level={s.risk} />
            <button onClick={() => onAddPo(s)} style={btnPrimary}><Plus size={13} /> {s.suggestedQty}</button>
          </div>
        ))}</div>
      </Card>
      <Card title="Incoming stock to receive" subtitle="mark received when it arrives" pad={0}>
        <div style={{ padding: "4px 18px" }}>{incoming.length === 0 ? <div style={{ fontSize: 13, color: C.subtle, padding: "10px 0" }}>Nothing in transit right now.</div> : incoming.map((s, i) => (
          <div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < incoming.length - 1 ? `1px solid ${C.border}` : "none" }}>
            <Truck size={16} color={C.info} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div><div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>{s.sku}</div></div>
            <span style={{ fontFamily: mono, fontWeight: 600, color: C.info }}>+{s.inTransit}</span>
            <button style={btnGhost}>Receive</button>
          </div>
        ))}</div>
      </Card>
    </div>
  );
}

function Lookup({ skus }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? skus.filter((s) => s.name.toLowerCase().includes(t) || s.sku.toLowerCase().includes(t) || s.supplier.toLowerCase().includes(t)) : skus).slice(0, 40); }, [q, skus]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface, borderRadius: 12, padding: "12px 16px", border: `1px solid ${C.border}` }}>
        <Search size={18} color={C.subtle} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any product, SKU or brand…" style={{ border: "none", background: "transparent", outline: "none", fontSize: 15, width: "100%", color: C.text }} />
      </div>
      <Card title={`${rows.length} product${rows.length === 1 ? "" : "s"}`} pad={0}><OpsTable rows={rows} cols={["product", "risk", "cover", "onhand", "value"]} /></Card>
    </div>
  );
}

/* ============================ AI INSIGHTS VIEW ============================ */
function Insights({ skus, agg, role, go }) {
  const insights = buildInsights(skus, agg, role);
  const actions = [
    { icon: ClipboardList, label: "Draft all suggested POs", to: "po", color: C.optic },
    { icon: Snowflake, label: "Review dead stock to clear", to: "dead", color: C.dead },
    { icon: Activity, label: "Run a what-if scenario", to: "forecast", color: C.warning },
    { icon: Radar, label: "Open the stockout radar", to: "radar", color: C.danger },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card title="Baseline AI — what to do now" subtitle="generated from live catalog + the replenishment engine" action={<Sparkles size={16} color={C.purple} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {insights.map((ins, i) => (
            <div key={i} style={{ display: "flex", gap: 11, paddingBottom: i < insights.length - 1 ? 14 : 0, borderBottom: i < insights.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: ins.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ins.icon size={16} color={ins.color} /></div>
              <div style={{ fontSize: 13.5, lineHeight: 1.55, paddingTop: 4 }}>{ins.text}{ins.to && <button onClick={() => go(ins.to)} style={{ ...btnGhost, padding: "2px 8px", marginLeft: 8, fontSize: 11 }}>{ins.action} →</button>}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Quick actions">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
          {actions.map((a) => (
            <button key={a.label} onClick={() => go(a.to)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.surfaceAlt, cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: a.color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}><a.icon size={17} color={a.color === C.optic ? C.opticInk : a.color} /></div>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{a.label}</span><ArrowRight size={15} color={C.subtle} style={{ marginLeft: "auto" }} />
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SourceBar({ inline }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, ...(inline ? {} : { background: C.navy, borderRadius: 14, padding: "12px 18px", color: "#fff" }) }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: inline ? C.muted : "#fff" }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: C.success }} /> Catalog: <b style={{ color: inline ? C.success : C.optic }}>live</b> · {CATALOG.totalProducts.toLocaleString("en-IN")} products
      </span>
      {!inline && <span style={{ fontSize: 12, color: "#A7B0C0" }}>Stock &amp; sales: modeled — grant the integration <code style={{ background: "#1F2E4D", padding: "1px 5px", borderRadius: 4 }}>Sales</code> &amp; <code style={{ background: "#1F2E4D", padding: "1px 5px", borderRadius: 4 }}>Inventory</code> scopes to go fully live.</span>}
      {!inline && <span style={{ marginLeft: "auto", fontSize: 11, color: "#7C8696" }}>{CATALOG.stores.length} stores · INR</span>}
    </div>
  );
}

/* ============================ SHELL ============================ */
const ROLES = {
  exec: { label: "CEO / CXO", Icon: Crown, nav: ["executive", "sales", "dead", "insights"], home: "executive" },
  procurement: { label: "Procurement", Icon: ShoppingCart, nav: ["radar", "forecast", "po", "suppliers", "insights"], home: "radar" },
  employee: { label: "Store team", Icon: Users, nav: ["tasks", "lookup"], home: "tasks" },
};
const VIEW_META = {
  executive: { label: "Executive overview", Icon: LayoutDashboard },
  sales: { label: "Sales", Icon: TrendingUp },
  radar: { label: "Stockout radar", Icon: Radar },
  forecast: { label: "Forecast & what-if", Icon: Activity },
  po: { label: "Reorder / Auto-PO", Icon: ClipboardList },
  suppliers: { label: "Suppliers", Icon: Award },
  dead: { label: "Dead stock", Icon: Snowflake },
  insights: { label: "AI insights", Icon: Sparkles },
  tasks: { label: "My tasks", Icon: ClipboardList },
  lookup: { label: "Product lookup", Icon: Search },
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

  const skus = useMemo(() => buildSkus({ surge, delay }), [surge, delay]);
  const agg = useMemo(() => salesAgg(skus), [skus]);
  const alerts = skus.filter((s) => s.risk <= 1);

  const switchRole = (r) => { setRole(r); setTab(ROLES[r].home); };
  const go = (t) => setTab(t);
  const addPo = (s) => { setPoItems((p) => (p.find((x) => x.sku === s.sku) ? p : [...p, s])); setToast(`Added ${s.suggestedQty} × ${s.name.slice(0, 28)} to PO`); setTimeout(() => setToast(null), 2800); };

  const nav = ROLES[role].nav;
  return (
    <div style={{ display: "flex", minHeight: 780, fontFamily: "Inter, system-ui, sans-serif", background: C.bg, color: C.text, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Baseline inventory intelligence for Tennis Outlet — role-based dashboards with live catalog data.</span>
      <aside style={{ width: 236, background: C.navy, color: "#fff", padding: "20px 14px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 18px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: C.optic, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: 12, height: 12, borderRadius: 999, border: `2px solid ${C.opticInk}` }} /></div>
          <div><div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>Baseline</div><div style={{ fontSize: 10, color: C.subtle, marginTop: -2 }}>Tennis Outlet</div></div>
        </div>
        <div style={{ padding: "0 4px 16px" }}>
          <div style={{ fontSize: 10, color: "#7C8696", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 7, paddingLeft: 4 }}>Workspace</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {Object.entries(ROLES).map(([k, r]) => (
              <button key={k} onClick={() => switchRole(k)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, border: "none", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: role === k ? 600 : 500, background: role === k ? C.optic : "transparent", color: role === k ? C.opticInk : "#A7B0C0" }}>
                <r.Icon size={15} /> {r.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ height: 1, background: C.navy600, margin: "0 4px 14px" }} />
        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {nav.map((id) => { const v = VIEW_META[id]; const active = tab === id; return (
            <button key={id} onClick={() => setTab(id)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: active ? 600 : 500, background: active ? C.navy600 : "transparent", color: active ? "#fff" : "#A7B0C0", borderLeft: active ? `3px solid ${C.optic}` : "3px solid transparent" }}>
              <v.Icon size={18} color={active ? C.optic : "#7C8696"} strokeWidth={1.75} /> {v.label}
              {id === "radar" && alerts.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, background: C.danger, color: "#fff", borderRadius: 999, padding: "1px 7px" }}>{alerts.length}</span>}
            </button>
          ); })}
        </nav>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 7, padding: "10px 12px", fontSize: 11, color: C.success }}><span style={{ width: 7, height: 7, borderRadius: 999, background: C.success }} /> Catalog synced · Magento</div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 24px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{VIEW_META[tab].label}</h1>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 999, padding: "3px 10px" }}>{ROLES[role].label}</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <button style={{ position: "relative", width: 38, height: 38, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Bell size={17} color={C.muted} />{alerts.length > 0 && <span style={{ position: "absolute", top: 8, right: 9, width: 7, height: 7, borderRadius: 999, background: C.danger }} />}</button>
            <div style={{ width: 38, height: 38, borderRadius: 999, background: C.navy600, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14 }}>TO</div>
          </div>
        </header>
        <main style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {tab === "executive" && <Executive skus={skus} agg={agg} go={go} />}
          {tab === "sales" && <Sales skus={skus} agg={agg} />}
          {tab === "radar" && <StockoutRadar skus={skus} onAddPo={addPo} />}
          {tab === "forecast" && <ForecastWhatIf surge={surge} setSurge={setSurge} delay={delay} setDelay={setDelay} skus={skus} />}
          {tab === "po" && <AutoPO skus={skus} poItems={poItems} approved={approved} setApproved={setApproved} budget={budget} setBudget={setBudget} />}
          {tab === "suppliers" && <Suppliers skus={skus} />}
          {tab === "dead" && <DeadStock skus={skus} />}
          {tab === "insights" && <Insights skus={skus} agg={agg} role={role} go={go} />}
          {tab === "tasks" && <Tasks skus={skus} onAddPo={addPo} />}
          {tab === "lookup" && <Lookup skus={skus} />}
        </main>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 24, left: 24, background: C.navy, color: "#fff", padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, zIndex: 50 }}><CheckCircle2 size={16} color={C.optic} /> {toast}</div>}
    </div>
  );
}
