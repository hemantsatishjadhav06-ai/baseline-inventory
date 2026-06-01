import { useState, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  LayoutDashboard, Radar, TrendingUp, Snowflake, ClipboardList, Settings, Search,
  Bell, AlertOctagon, AlertTriangle, CheckCircle2, Layers, Truck,
  TrendingDown, Package, IndianRupee, Plus, Check, X, RefreshCw, Activity,
  Target, CalendarDays, Wallet,
} from "lucide-react";

/* ============================ DESIGN TOKENS ============================ */
const C = {
  navy: "#0E1726", navy700: "#16223A", navy600: "#1F2E4D",
  optic: "#C6F042", opticBright: "#D7F25B", opticInk: "#1A2E00",
  clay: "#E1622B", blue: "#2E86DE",
  danger: "#E5484D", warning: "#F5A524", success: "#30A46C",
  info: "#2E86DE", dead: "#8E7CC3", overstock: "#C28E0E",
  bg: "#F6F7F9", surface: "#FFFFFF", surfaceAlt: "#FBFCFD",
  border: "#ECEEF1", borderStrong: "#DFE2E7",
  text: "#0E1726", muted: "#5B6472", subtle: "#9AA1AD",
};
const mono = '"IBM Plex Mono", ui-monospace, monospace';
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

const RISK = {
  0: { key: "stockout", label: "Stockout risk", color: C.danger, Icon: AlertOctagon },
  1: { key: "reorder", label: "Reorder now", color: C.warning, Icon: AlertTriangle },
  2: { key: "healthy", label: "Healthy", color: C.success, Icon: CheckCircle2 },
  3: { key: "overstock", label: "Overstock", color: C.overstock, Icon: Layers },
  4: { key: "dead", label: "Dead stock", color: C.dead, Icon: Snowflake },
};

/* ============================ SEASONAL MODEL (tennis calendar) ============================ */
const SEASON = {
  Rackets:  [1.05, 0.95, 1.10, 1.15, 1.00, 0.80, 0.75, 0.95, 1.35, 1.45, 1.30, 1.15],
  Strings:  [1.00, 0.98, 1.05, 1.08, 1.02, 0.92, 0.90, 1.00, 1.12, 1.15, 1.08, 1.05],
  Shoes:    [1.02, 0.96, 1.08, 1.12, 1.00, 0.85, 0.82, 0.98, 1.25, 1.30, 1.18, 1.10],
  Balls:    [1.00, 1.00, 1.05, 1.10, 1.05, 0.95, 0.92, 1.00, 1.10, 1.12, 1.05, 1.02],
  Bags:     [1.00, 0.95, 1.05, 1.05, 0.98, 0.88, 0.85, 0.95, 1.20, 1.22, 1.10, 1.05],
  Grips:    [1.00, 1.00, 1.04, 1.06, 1.02, 0.96, 0.94, 1.00, 1.08, 1.10, 1.04, 1.02],
  Apparel:  [0.95, 0.92, 1.05, 1.20, 1.30, 1.15, 1.05, 1.00, 1.10, 1.05, 0.95, 1.00],
};
const MONTH = 5; // June 2026
const SEASON_PHASE = "Off-season lull · pre-season build begins Sep";
const seasonIdx = (cat) => (SEASON[cat] ? SEASON[cat][MONTH] : 1);

/* ============================ MOCK DATA ============================ */
const RAW = [
  ["BAB-PD-G3", "Babolat Pure Drive G3", "Rackets", "Babolat", 3, 0, 0.9, 10, 7200, 13999, 1, 40, 0.93],
  ["WIL-PROST-97", "Wilson Pro Staff 97 v14", "Rackets", "Wilson", 6, 0, 0.7, 14, 8100, 15499, 2, 55, 0.90],
  ["YON-EZONE-98", "Yonex EZONE 98", "Rackets", "Yonex", 12, 6, 0.5, 21, 8400, 16299, 3, 60, 0.88],
  ["HEAD-SPEED-MP", "Head Speed MP 2024", "Rackets", "Head", 9, 0, 0.6, 18, 7800, 14999, 2, 48, 0.91],
  ["BAB-RPM-200", "Babolat RPM Blast 200m Reel", "Strings", "Babolat", 4, 0, 1.8, 10, 9500, 17999, 0, 30, 0.95],
  ["LUX-ALU-200", "Luxilon ALU Power 200m Reel", "Strings", "Wilson", 2, 0, 1.4, 14, 11200, 21999, 1, 35, 0.94],
  ["SOLINCO-HYP", "Solinco Hyper-G Set", "Strings", "Solinco", 38, 0, 2.6, 7, 320, 749, 0, 25, 0.96],
  ["WIL-US-OPEN-CAN", "Wilson US Open Balls (can)", "Balls", "Wilson", 120, 0, 6.2, 5, 240, 499, 0, 20, 0.97],
  ["HEAD-TOUR-CAN", "Head Tour Balls (can)", "Balls", "Head", 18, 0, 3.1, 7, 230, 469, 1, 18, 0.95],
  ["NIKE-VAPOR-9", "NikeCourt Air Zoom Vapor (UK9)", "Shoes", "Nike", 5, 0, 0.8, 16, 5400, 10999, 2, 44, 0.89],
  ["ASICS-SOL-10", "Asics Solution Speed (UK10)", "Shoes", "Asics", 14, 0, 0.4, 20, 5100, 9999, 6, 72, 0.87],
  ["ADI-BARRI-8", "Adidas Barricade (UK8)", "Shoes", "Adidas", 22, 0, 0.15, 25, 4800, 9499, 41, 150, 0.84],
  ["BAB-RH-BAG12", "Babolat RH x12 Bag", "Bags", "Babolat", 7, 0, 0.5, 14, 4200, 7999, 3, 50, 0.90],
  ["HEAD-TOUR-BAG", "Head Tour Team Bag", "Bags", "Head", 19, 0, 0.12, 18, 3600, 6999, 55, 160, 0.83],
  ["WIL-OVRGRIP-30", "Wilson Pro Overgrip x30", "Grips", "Wilson", 9, 0, 4.5, 7, 950, 1899, 0, 22, 0.96],
  ["YON-AC102-3", "Yonex Super Grap x3", "Grips", "Yonex", 60, 0, 3.2, 10, 210, 449, 1, 28, 0.95],
  ["NIKE-DRIFIT-TEE", "Nike Dri-FIT Tee (M)", "Apparel", "Nike", 31, 0, 0.6, 20, 980, 2199, 8, 90, 0.86],
  ["ADI-CLUB-SKIRT", "Adidas Club Skirt (S)", "Apparel", "Adidas", 26, 0, 0.05, 22, 1100, 2499, 73, 175, 0.82],
];
const SUPPLIER_META = {
  Babolat: { lead: 10, moq: 25000, otif: 0.94 }, Wilson: { lead: 14, moq: 30000, otif: 0.91 },
  Yonex: { lead: 21, moq: 20000, otif: 0.88 }, Head: { lead: 18, moq: 22000, otif: 0.90 },
  Nike: { lead: 16, moq: 18000, otif: 0.92 }, Adidas: { lead: 22, moq: 18000, otif: 0.86 },
  Asics: { lead: 20, moq: 15000, otif: 0.89 }, Solinco: { lead: 7, moq: 8000, otif: 0.95 },
};

/* ============================ ENGINE (seasonal forecast + what-if) ============================ */
function buildSkus({ surge = 0, delay = 0 } = {}) {
  return RAW.map(([sku, name, category, supplier, onHand, inTransit, avgDaily, leadTime, unitCost, price, daysSinceSale, age, accuracy]) => {
    const reviewPeriod = 15;
    const effLead = leadTime + delay;
    const safetyDays = Math.max(5, Math.round(effLead * 0.4));
    const reorderWindow = effLead + safetyDays;
    const targetMaxDays = 60, deadAfterDays = 90;

    const forecastDaily = avgDaily * seasonIdx(category) * (1 + surge / 100);
    const cover = forecastDaily > 0 ? (onHand + inTransit) / forecastDaily : Infinity;

    let risk;
    if (avgDaily === 0 || daysSinceSale >= deadAfterDays) risk = 4;
    else if (cover > targetMaxDays) risk = 3;
    else if (cover <= effLead) risk = 0;
    else if (cover <= reorderWindow) risk = 1;
    else risk = 2;

    const safetyStock = Math.round(forecastDaily * effLead * 0.5);
    let suggested = Math.max(Math.ceil(forecastDaily * (effLead + reviewPeriod) + safetyStock - (onHand + inTransit)), 0);
    if (risk === 3 || risk === 4) suggested = 0;

    return {
      sku, name, category, supplier, onHand, inTransit, avgDaily, forecastDaily,
      leadTime, effLead, unitCost, price, daysSinceSale, age, accuracy,
      reorderWindow, targetMaxDays, cover, risk, suggestedQty: suggested,
      stockValue: onHand * unitCost,
      protectedRev: forecastDaily * price * effLead,
    };
  });
}

/* ============================ PRIMITIVES ============================ */
function RiskBadge({ level, size = "sm" }) {
  const r = RISK[level];
  const fs = size === "sm" ? 11 : 12;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: size === "sm" ? "2px 8px" : "4px 10px",
      borderRadius: 999, background: r.color + "1A", color: r.color, fontSize: fs, fontWeight: 600, whiteSpace: "nowrap" }}>
      <r.Icon size={fs + 2} /> {r.label}
    </span>
  );
}

function AccuracyChip({ value }) {
  const pct = Math.round(value * 100);
  const col = pct >= 92 ? C.success : pct >= 87 ? C.warning : C.danger;
  return (
    <span title="Forecast accuracy (12-week MAPE)" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: mono, fontSize: 11, fontWeight: 600, color: col }}>
      <Target size={11} /> {pct}%
    </span>
  );
}

function CoverMeter({ s }) {
  if (!isFinite(s.cover)) return <div style={{ fontSize: 12, color: C.subtle, fontStyle: "italic" }}>no recent sales</div>;
  const scaleMax = Math.max(s.targetMaxDays, s.cover, s.reorderWindow) * 1.1;
  const pct = (v) => Math.min(100, (v / scaleMax) * 100);
  const r = RISK[s.risk];
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: C.text }}>{s.cover.toFixed(0)}d cover</span>
        <span style={{ fontSize: 11, color: C.subtle }}>lead {s.effLead}d</span>
      </div>
      <div style={{ position: "relative", height: 7, borderRadius: 999, background: C.border }}>
        <div style={{ position: "absolute", inset: 0, width: pct(s.cover) + "%", borderRadius: 999, background: r.color, transition: "width .35s cubic-bezier(.2,.8,.2,1)" }} />
        <div style={{ position: "absolute", top: -2, left: pct(s.effLead) + "%", width: 2, height: 11, background: C.danger }} />
        <div style={{ position: "absolute", top: -2, left: pct(s.reorderWindow) + "%", width: 2, height: 11, background: C.warning }} />
      </div>
    </div>
  );
}

function KpiCard({ label, value, delta, intent = "neutral", tone, Icon, sub }) {
  const goodWhenUp = intent !== "negative";
  const up = delta >= 0, positive = up === goodWhenUp;
  const deltaColor = delta == null ? C.subtle : positive ? C.success : C.danger;
  return (
    <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: 18, position: "relative", overflow: "hidden" }}>
      {tone && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: tone }} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: C.muted }}>{label}</span>
        {Icon && <Icon size={15} color={C.subtle} strokeWidth={1.75} />}
      </div>
      <div style={{ fontFamily: mono, fontSize: 25, fontWeight: 600, color: C.text, lineHeight: 1.1 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9 }}>
        {delta != null && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 12, fontWeight: 600, color: deltaColor }}>
            {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(delta)}%
          </span>
        )}
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
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: C.subtle, marginTop: 2 }}>{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  );
}

function ChartTip({ active, payload, label, fmt = (v) => v }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.navy, color: "#fff", padding: "8px 12px", borderRadius: 8, fontSize: 12 }}>
      <div style={{ color: "#9AA1AD", marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ fontFamily: mono, fontWeight: 600, color: p.color || "#fff" }}>{p.name}: {fmt(p.value)}</div>)}
    </div>
  );
}

const btnGhost = { fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.borderStrong}`, background: "transparent", cursor: "pointer", color: C.text };
function AddBtn({ onClick, label, disabled }) {
  return (
    <button disabled={disabled} onClick={onClick} style={{ fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "none",
      cursor: disabled ? "not-allowed" : "pointer", background: disabled ? C.border : C.optic, color: disabled ? C.subtle : C.opticInk, display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Plus size={13} /> {label}
    </button>
  );
}

/* ============================ DATA SERIES ============================ */
const REVENUE = [
  ["W1", 182000], ["W2", 196500], ["W3", 175000], ["W4", 210400], ["W5", 224800], ["W6", 241200],
  ["W7", 233900], ["W8", 268700], ["W9", 281300], ["W10", 259600], ["W11", 297400], ["W12", 312800],
].map(([w, rev]) => ({ w, rev }));
const FORECAST = [
  ...REVENUE.map((r) => ({ w: r.w, actual: r.rev, forecast: r.rev })),
  { w: "W13", forecast: 288000 }, { w: "W14", forecast: 274000 }, { w: "W15", forecast: 301000 }, { w: "W16", forecast: 339000 },
];

/* ============================ MODULES ============================ */
function Overview({ skus, alerts }) {
  const invValue = skus.reduce((a, s) => a + s.stockValue, 0);
  const deadValue = skus.filter((s) => s.risk === 4).reduce((a, s) => a + s.stockValue, 0);
  const overValue = skus.filter((s) => s.risk === 3).reduce((a, s) => a + s.stockValue, 0);
  const healthyValue = invValue - deadValue - overValue;
  const stockoutCount = skus.filter((s) => s.risk <= 1).length;
  const rev30 = REVENUE.slice(-4).reduce((a, r) => a + r.rev, 0);
  const avgAcc = Math.round((skus.reduce((a, s) => a + s.accuracy, 0) / skus.length) * 100);

  const catMix = useMemo(() => {
    const m = {}; skus.forEach((s) => (m[s.category] = (m[s.category] || 0) + s.stockValue));
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [skus]);
  const catColors = [C.optic, C.clay, C.blue, C.dead, C.overstock, C.success, C.warning];
  const valueSplit = [
    { name: "Healthy", value: healthyValue, color: C.success },
    { name: "Overstock", value: overValue, color: C.overstock },
    { name: "Dead", value: deadValue, color: C.dead },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SeasonBanner />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
        <KpiCard label="Revenue (30d)" value={inr(rev30)} delta={12} Icon={IndianRupee} sub="vs prev 30d" />
        <KpiCard label="Forecast accuracy" value={avgAcc + "%"} delta={3} Icon={Target} sub="12-wk avg" />
        <KpiCard label="Inventory value" value={inr(invValue)} delta={-3} Icon={Package} />
        <KpiCard label="Stockout-risk SKUs" value={stockoutCount} delta={9} intent="negative" tone={C.danger} Icon={AlertOctagon} sub="need action" />
        <KpiCard label="Cash in dead stock" value={inr(deadValue)} delta={6} intent="negative" tone={C.dead} Icon={Snowflake} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18 }}>
        <Card title="Revenue — actual vs seasonal forecast" subtitle="dashed line is the model's forward look">
          <div style={{ height: 244 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={FORECAST} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="w" tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => "₹" + v / 1000 + "k"} />
                <Tooltip content={<ChartTip fmt={inr} />} />
                <ReferenceLine x="W12" stroke={C.borderStrong} strokeDasharray="2 2" />
                <Line type="monotone" dataKey="actual" name="Actual" stroke={C.blue} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke={C.clay} strokeWidth={2} strokeDasharray="5 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Inventory value health">
          <div style={{ height: 168 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={valueSplit} dataKey="value" nameKey="name" innerRadius={46} outerRadius={70} paddingAngle={2}>
                  {valueSplit.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip content={<ChartTip fmt={inr} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            {valueSplit.map((e) => (
              <div key={e.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: e.color }} /> {e.name}
                </span>
                <span style={{ fontFamily: mono, fontWeight: 600, color: C.text }}>{inr(e.value)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Card title="Inventory value by category">
          <div style={{ height: 216 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={catMix} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => "₹" + v / 1000 + "k"} />
                <Tooltip content={<ChartTip fmt={inr} />} cursor={{ fill: C.surfaceAlt }} />
                <Bar dataKey="value" name="Stock value" radius={[6, 6, 0, 0]}>
                  {catMix.map((e, i) => <Cell key={i} fill={catColors[i % catColors.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Alerts" subtitle={`${alerts.length} need attention`} action={<Bell size={15} color={C.subtle} />}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {alerts.slice(0, 6).map((a, i) => (
              <div key={a.sku} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: i < Math.min(alerts.length, 6) - 1 ? `1px solid ${C.border}` : "none" }}>
                <a.Icon size={16} color={a.color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: C.subtle }}>{a.msg}</div>
                </div>
              </div>
            ))}
            {alerts.length === 0 && <div style={{ fontSize: 13, color: C.subtle, padding: "8px 0" }}>All clear — nothing at risk.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SeasonBanner() {
  const labels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const curve = SEASON.Rackets.map((m, i) => ({ m: labels[i], v: m, cur: i === MONTH }));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, background: C.navy, borderRadius: 14, padding: "14px 18px", color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <CalendarDays size={18} color={C.optic} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Season signal · June</div>
          <div style={{ fontSize: 12, color: "#A7B0C0" }}>{SEASON_PHASE}</div>
        </div>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "flex-end", gap: 4, height: 38 }}>
        {curve.map((c, i) => (
          <div key={i} title={`${c.m}: ${Math.round(c.v * 100)}%`} style={{ width: 14, textAlign: "center" }}>
            <div style={{ height: c.v * 24, background: c.cur ? C.optic : "#33415C", borderRadius: 2 }} />
            <div style={{ fontSize: 9, color: c.cur ? C.optic : "#5B6472", marginTop: 3 }}>{c.m}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StockoutRadar({ skus, onAddPo }) {
  const rows = useMemo(() => skus.filter((s) => s.risk <= 1).sort((a, b) => a.cover - b.cover), [skus]);
  return (
    <Card title={`Stockout radar — ${rows.length} SKUs need attention`} subtitle="ranked by forecasted days of cover" pad={0}>
      <Table rows={rows} onAddPo={onAddPo} cols={["product", "risk", "cover", "acc", "onhand", "suggest", "action"]} />
    </Card>
  );
}

function ForecastWhatIf({ surge, setSurge, delay, setDelay, skus }) {
  const atRisk = skus.filter((s) => s.risk <= 1).length;
  const revAtRisk = skus.filter((s) => s.risk <= 1).reduce((a, s) => a + s.protectedRev, 0);
  const top = [...skus].sort((a, b) => b.protectedRev - a.protectedRev).slice(0, 8);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card title="What-if simulator" subtitle="stress-test demand surges and supplier delays — recomputes live">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 8 }}>
          <Slider label="Demand surge" hint="e.g. tournament / season start" value={surge} min={0} max={100} step={5} unit="%" onChange={setSurge} color={C.clay} />
          <Slider label="Supplier delay" hint="added to every lead time" value={delay} min={0} max={21} step={1} unit="d" onChange={setDelay} color={C.warning} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 12 }}>
          <KpiCard label="SKUs at risk" value={atRisk} tone={atRisk > 6 ? C.danger : C.warning} Icon={AlertTriangle} sub="under this scenario" />
          <KpiCard label="Revenue exposed" value={inr(revAtRisk)} tone={C.danger} Icon={IndianRupee} sub="if they stock out" />
          <KpiCard label="Scenario" value={surge === 0 && delay === 0 ? "Baseline" : "Stressed"} Icon={Activity} sub={`+${surge}% demand · +${delay}d lead`} />
        </div>
      </Card>
      <Card title="Highest revenue at risk" subtitle="forecasted demand × price × lead time" pad={0}>
        <Table rows={top} cols={["product", "risk", "forecast", "acc", "protect"]} />
      </Card>
    </div>
  );
}

function Slider({ label, hint, value, min, max, step, unit, onChange, color }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{label}</span>
        <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: color }} />
      <div style={{ fontSize: 11, color: C.subtle, marginTop: 4 }}>{hint}</div>
    </div>
  );
}

function DeadStock({ skus }) {
  const rows = useMemo(() => skus.filter((s) => s.risk === 4 || s.risk === 3).sort((a, b) => b.stockValue - a.stockValue), [skus]);
  const trapped = rows.reduce((a, s) => a + s.stockValue, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        <KpiCard label="Cash locked in slow stock" value={inr(trapped)} tone={C.dead} Icon={Snowflake} sub={`${rows.length} SKUs`} />
        <KpiCard label="Dead SKUs (no sale 90d+)" value={skus.filter((s) => s.risk === 4).length} tone={C.dead} Icon={Snowflake} />
        <KpiCard label="Overstocked SKUs" value={skus.filter((s) => s.risk === 3).length} tone={C.overstock} Icon={Layers} />
      </div>
      <Card title="Markdown & clearance candidates" subtitle="highest trapped cash first" pad={0}>
        <Table rows={rows} cols={["product", "risk", "age", "onhand", "value", "markdown"]} />
      </Card>
    </div>
  );
}

function Table({ rows, onAddPo, cols }) {
  const H = ({ children, right }) => (
    <th style={{ textAlign: right ? "right" : "left", fontSize: 11, fontWeight: 600, letterSpacing: ".02em", textTransform: "uppercase", color: C.muted, padding: "11px 14px", position: "sticky", top: 0, background: C.surfaceAlt }}>{children}</th>
  );
  const td = { padding: "11px 14px", fontSize: 13, color: C.text, borderTop: `1px solid ${C.border}` };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          {cols.includes("product") && <H>Product</H>}
          {cols.includes("risk") && <H>Status</H>}
          {cols.includes("cover") && <H>Forecast cover</H>}
          {cols.includes("forecast") && <H right>Forecast / day</H>}
          {cols.includes("acc") && <H right>Accuracy</H>}
          {cols.includes("age") && <H right>Age</H>}
          {cols.includes("onhand") && <H right>On hand</H>}
          {cols.includes("suggest") && <H right>Suggested qty</H>}
          {cols.includes("protect") && <H right>Revenue at risk</H>}
          {cols.includes("value") && <H right>Stock value</H>}
          {cols.includes("action") && <H right>Action</H>}
          {cols.includes("markdown") && <H right>Action</H>}
        </tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.sku} onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceAlt)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              {cols.includes("product") && (
                <td style={td}><div style={{ fontWeight: 500 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>{s.sku} · {s.supplier}</div></td>
              )}
              {cols.includes("risk") && <td style={td}><RiskBadge level={s.risk} /></td>}
              {cols.includes("cover") && <td style={td}><CoverMeter s={s} /></td>}
              {cols.includes("forecast") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{s.forecastDaily.toFixed(2)}<span style={{ color: C.subtle, fontWeight: 400 }}> /d</span></td>}
              {cols.includes("acc") && <td style={{ ...td, textAlign: "right" }}><AccuracyChip value={s.accuracy} /></td>}
              {cols.includes("age") && <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{s.age}d · sold {s.daysSinceSale}d ago</td>}
              {cols.includes("onhand") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{s.onHand}{s.inTransit > 0 ? <span style={{ color: C.info, fontWeight: 500 }}> +{s.inTransit}</span> : ""}</td>}
              {cols.includes("suggest") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600, color: s.suggestedQty > 0 ? C.text : C.subtle }}>{s.suggestedQty || "—"}</td>}
              {cols.includes("protect") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600, color: C.danger }}>{inr(s.protectedRev)}</td>}
              {cols.includes("value") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inr(s.stockValue)}</td>}
              {cols.includes("action") && <td style={{ ...td, textAlign: "right" }}><AddBtn disabled={!s.suggestedQty} onClick={() => onAddPo && onAddPo(s)} label={`Add ${s.suggestedQty}`} /></td>}
              {cols.includes("markdown") && <td style={{ ...td, textAlign: "right" }}><button style={{ ...btnGhost, color: C.clay, borderColor: C.clay + "55" }}>Mark down</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutoPO({ skus, poItems, approved, setApproved, budget, setBudget }) {
  const result = useMemo(() => {
    const base = skus.filter((s) => s.suggestedQty > 0);
    const merged = {};
    base.forEach((s) => (merged[s.sku] = { ...s, qty: s.suggestedQty }));
    poItems.forEach((s) => (merged[s.sku] = { ...s, qty: s.suggestedQty }));
    const ranked = Object.values(merged).sort((a, b) => b.protectedRev - a.protectedRev);
    let spent = 0;
    ranked.forEach((s) => { const cost = s.qty * s.unitCost; s._deferred = budget > 0 && spent + cost > budget; if (!s._deferred) spent += cost; });
    const bySup = {};
    ranked.forEach((s) => (bySup[s.supplier] = bySup[s.supplier] || []).push(s));
    const drafts = Object.entries(bySup).map(([supplier, items]) => {
      const active = items.filter((i) => !i._deferred);
      const total = active.reduce((a, s) => a + s.qty * s.unitCost, 0);
      const moq = SUPPLIER_META[supplier]?.moq || 0;
      return { supplier, items, total, moq, lead: SUPPLIER_META[supplier]?.lead, otif: SUPPLIER_META[supplier]?.otif };
    }).filter((d) => d.items.length).sort((a, b) => b.total - a.total);
    return { spent, drafts };
  }, [skus, poItems, budget]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card title="Cash-aware purchasing" subtitle="set an open-to-buy budget — Baseline funds the highest-revenue-at-risk lines first">
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Wallet size={16} color={C.muted} />
            <span style={{ fontSize: 13, color: C.muted }}>Open-to-buy budget</span>
          </div>
          <input type="range" min={0} max={400000} step={10000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} style={{ flex: 1, minWidth: 180, accentColor: C.optic }} />
          <span style={{ fontFamily: mono, fontWeight: 600, fontSize: 16, color: C.text, minWidth: 90, textAlign: "right" }}>{budget === 0 ? "No cap" : inr(budget)}</span>
          <span style={{ fontSize: 12, color: C.subtle }}>committing {inr(result.spent)}</span>
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 18, alignItems: "start" }}>
        {result.drafts.map((d) => {
          const isApproved = approved.includes(d.supplier);
          const belowMoq = d.total < d.moq && d.total > 0;
          return (
            <div key={d.supplier} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${isApproved ? C.success : C.border}`, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", background: isApproved ? C.success + "10" : C.surfaceAlt, borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
                    {d.supplier}
                    {isApproved
                      ? <span style={{ fontSize: 11, color: C.success, display: "inline-flex", alignItems: "center", gap: 3 }}><Check size={13} /> Approved</span>
                      : <span style={{ fontSize: 10, fontWeight: 600, color: C.opticInk, background: C.optic, padding: "2px 7px", borderRadius: 999 }}>SUGGESTED</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.subtle }}>Lead {d.lead}d · OTIF {Math.round(d.otif * 100)}% · {d.items.length} lines</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 600, color: C.text }}>{inr(d.total)}</div>
                  <div style={{ fontSize: 11, color: belowMoq ? C.warning : C.success }}>{belowMoq ? `${inr(d.moq - d.total)} below min` : "meets minimum"}</div>
                </div>
              </div>
              <div style={{ padding: "6px 18px" }}>
                {d.items.map((s, i) => (
                  <div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < d.items.length - 1 ? `1px solid ${C.border}` : "none", opacity: s._deferred ? 0.45 : 1 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>on hand {s.onHand} · {inr(s.unitCost)}/u{s._deferred ? " · deferred (budget)" : ""}</div>
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: C.text, textAlign: "right" }}>×{s.qty}<div style={{ fontSize: 11, fontWeight: 400, color: C.muted }}>{inr(s.qty * s.unitCost)}</div></div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, padding: "0 18px 16px" }}>
                {isApproved ? (
                  <button onClick={() => setApproved(approved.filter((x) => x !== d.supplier))} style={{ ...btnGhost, flex: 1 }}><RefreshCw size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} /> Undo</button>
                ) : (
                  <>
                    <button onClick={() => setApproved([...approved, d.supplier])} style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: 8, border: "none", background: C.optic, color: C.opticInk, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}><Truck size={14} /> Approve &amp; send</button>
                    <button style={btnGhost}>Edit</button>
                    <button style={{ ...btnGhost, color: C.muted }}><X size={14} /></button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================ SHELL ============================ */
const NAV = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "radar", label: "Stockout radar", Icon: Radar },
  { id: "forecast", label: "Forecast & what-if", Icon: TrendingUp },
  { id: "dead", label: "Dead stock", Icon: Snowflake },
  { id: "po", label: "Reorder / Auto-PO", Icon: ClipboardList },
];

export default function BaselineDashboard() {
  const [tab, setTab] = useState("overview");
  const [poItems, setPoItems] = useState([]);
  const [approved, setApproved] = useState([]);
  const [toast, setToast] = useState(null);
  const [surge, setSurge] = useState(0);
  const [delay, setDelay] = useState(0);
  const [budget, setBudget] = useState(0);

  const skus = useMemo(() => buildSkus({ surge, delay }), [surge, delay]);
  const alerts = useMemo(() => skus.filter((s) => s.risk <= 1).sort((a, b) => a.cover - b.cover).map((s) => ({
    sku: s.sku, name: s.name, color: RISK[s.risk].color, Icon: RISK[s.risk].Icon,
    msg: s.risk === 0 ? `Stocks out in ~${Math.round(s.cover)}d · lead ${s.effLead}d` : `${Math.round(s.cover)}d cover left · reorder ${s.suggestedQty}`,
  })), [skus]);

  const addPo = (s) => {
    setPoItems((p) => (p.find((x) => x.sku === s.sku) ? p : [...p, s]));
    setToast(`Added ${s.suggestedQty} × ${s.name} to ${s.supplier} PO`);
    setTimeout(() => setToast(null), 3000);
  };
  const poCount = new Set([...skus.filter((s) => s.suggestedQty > 0).map((s) => s.sku), ...poItems.map((s) => s.sku)]).size;

  return (
    <div style={{ display: "flex", minHeight: 760, fontFamily: "Inter, system-ui, sans-serif", background: C.bg, color: C.text, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Baseline inventory intelligence dashboard for Tennis Outlet</span>
      <aside style={{ width: 234, background: C.navy, color: "#fff", padding: "20px 14px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 24px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: C.optic, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 12, height: 12, borderRadius: 999, border: `2px solid ${C.opticInk}` }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>Baseline</div>
            <div style={{ fontSize: 10, color: C.subtle, marginTop: -2 }}>Tennis Outlet</div>
          </div>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {NAV.map((n) => {
            const active = tab === n.id;
            return (
              <button key={n.id} onClick={() => setTab(n.id)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: active ? 600 : 500, background: active ? C.navy600 : "transparent", color: active ? "#fff" : "#A7B0C0", borderLeft: active ? `3px solid ${C.optic}` : "3px solid transparent" }}>
                <n.Icon size={18} color={active ? C.optic : "#7C8696"} strokeWidth={1.75} /> {n.label}
                {n.id === "po" && poCount > 0 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, background: C.optic, color: C.opticInk, borderRadius: 999, padding: "1px 7px" }}>{poCount}</span>}
                {n.id === "radar" && alerts.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, background: C.danger, color: "#fff", borderRadius: 999, padding: "1px 7px" }}>{alerts.length}</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: "transparent", color: "#A7B0C0", fontSize: 14 }}>
            <Settings size={18} color="#7C8696" strokeWidth={1.75} /> Settings
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 12px", fontSize: 11, color: C.success }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: C.success }} /> Synced 4m ago · Magento
          </div>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 24px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{NAV.find((n) => n.id === tab).label}</h1>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.surfaceAlt, borderRadius: 10, padding: "8px 12px", width: 232, border: `1px solid ${C.border}` }}>
              <Search size={15} color={C.subtle} />
              <input placeholder="Search SKU or supplier" style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, width: "100%", color: C.text }} />
            </div>
            <button style={{ position: "relative", width: 38, height: 38, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bell size={17} color={C.muted} />
              {alerts.length > 0 && <span style={{ position: "absolute", top: 8, right: 9, width: 7, height: 7, borderRadius: 999, background: C.danger }} />}
            </button>
            <div style={{ width: 38, height: 38, borderRadius: 999, background: C.navy600, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14 }}>TO</div>
          </div>
        </header>

        <main style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {tab === "overview" && <Overview skus={skus} alerts={alerts} />}
          {tab === "radar" && <StockoutRadar skus={skus} onAddPo={addPo} />}
          {tab === "forecast" && <ForecastWhatIf surge={surge} setSurge={setSurge} delay={delay} setDelay={setDelay} skus={skus} />}
          {tab === "dead" && <DeadStock skus={skus} />}
          {tab === "po" && <AutoPO skus={skus} poItems={poItems} approved={approved} setApproved={setApproved} budget={budget} setBudget={setBudget} />}
        </main>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: 24, background: C.navy, color: "#fff", padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, zIndex: 50 }}>
          <CheckCircle2 size={16} color={C.optic} /> {toast}
        </div>
      )}
    </div>
  );
}
