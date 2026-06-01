import { useState, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  LayoutDashboard, Radar, Snowflake, ClipboardList, Settings, Search,
  Bell, AlertOctagon, AlertTriangle, CheckCircle2, Layers, Truck,
  TrendingUp, TrendingDown, Package, IndianRupee, Plus, Check, X, RefreshCw,
} from "lucide-react";

/* ============================ DESIGN TOKENS ============================ */
const C = {
  navy: "#0E1726", navy700: "#16223A", navy600: "#1F2E4D",
  optic: "#C6F042", opticBright: "#D7F25B", opticInk: "#1A2E00",
  clay: "#E1622B", blue: "#2E86DE",
  danger: "#E5484D", warning: "#F5A524", success: "#30A46C",
  info: "#2E86DE", dead: "#8E7CC3", overstock: "#C28E0E",
  bg: "#F7F8FA", surface: "#FFFFFF", border: "#E6E8EC",
  text: "#0E1726", muted: "#5B6472", subtle: "#8A92A0",
};
const mono = '"IBM Plex Mono", ui-monospace, monospace';
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

/* The Risk Scale — single source of truth (mirrors the engine) */
const RISK = {
  0: { key: "stockout", label: "Stockout risk", color: C.danger, Icon: AlertOctagon },
  1: { key: "reorder", label: "Reorder now", color: C.warning, Icon: AlertTriangle },
  2: { key: "healthy", label: "Healthy", color: C.success, Icon: CheckCircle2 },
  3: { key: "overstock", label: "Overstock", color: C.overstock, Icon: Layers },
  4: { key: "dead", label: "Dead stock", color: C.dead, Icon: Snowflake },
};

/* ============================ MOCK DATA (Tennis Outlet) ============================ */
const RAW = [
  ["BAB-PD-G3", "Babolat Pure Drive G3", "Rackets", "Babolat", 3, 0, 0.9, 10, 7200, 13999, 1, 40],
  ["WIL-PROST-97", "Wilson Pro Staff 97 v14", "Rackets", "Wilson", 6, 0, 0.7, 14, 8100, 15499, 2, 55],
  ["YON-EZONE-98", "Yonex EZONE 98", "Rackets", "Yonex", 12, 6, 0.5, 21, 8400, 16299, 3, 60],
  ["HEAD-SPEED-MP", "Head Speed MP 2024", "Rackets", "Head", 9, 0, 0.6, 18, 7800, 14999, 2, 48],
  ["BAB-RPM-200", "Babolat RPM Blast 200m Reel", "Strings", "Babolat", 4, 0, 1.8, 10, 9500, 17999, 0, 30],
  ["LUX-ALU-200", "Luxilon ALU Power 200m Reel", "Strings", "Wilson", 2, 0, 1.4, 14, 11200, 21999, 1, 35],
  ["SOLINCO-HYP", "Solinco Hyper-G Set", "Strings", "Solinco", 38, 0, 2.6, 7, 320, 749, 0, 25],
  ["WIL-US-OPEN-CAN", "Wilson US Open Balls (can)", "Balls", "Wilson", 120, 0, 6.2, 5, 240, 499, 0, 20],
  ["HEAD-TOUR-CAN", "Head Tour Balls (can)", "Balls", "Head", 18, 0, 3.1, 7, 230, 469, 1, 18],
  ["NIKE-VAPOR-9", "NikeCourt Air Zoom Vapor (UK9)", "Shoes", "Nike", 5, 0, 0.8, 16, 5400, 10999, 2, 44],
  ["ASICS-SOL-10", "Asics Solution Speed (UK10)", "Shoes", "Asics", 14, 0, 0.4, 20, 5100, 9999, 6, 72],
  ["ADI-BARRI-8", "Adidas Barricade (UK8)", "Shoes", "Adidas", 22, 0, 0.15, 25, 4800, 9499, 41, 150],
  ["BAB-RH-BAG12", "Babolat RH x12 Bag", "Bags", "Babolat", 7, 0, 0.5, 14, 4200, 7999, 3, 50],
  ["HEAD-TOUR-BAG", "Head Tour Team Bag", "Bags", "Head", 19, 0, 0.12, 18, 3600, 6999, 55, 160],
  ["WIL-OVRGRIP-30", "Wilson Pro Overgrip x30", "Grips", "Wilson", 9, 0, 4.5, 7, 950, 1899, 0, 22],
  ["YON-AC102-3", "Yonex Super Grap x3", "Grips", "Yonex", 60, 0, 3.2, 10, 210, 449, 1, 28],
  ["NIKE-DRIFIT-TEE", "Nike Dri-FIT Tee (M)", "Apparel", "Nike", 31, 0, 0.6, 20, 980, 2199, 8, 90],
  ["ADI-CLUB-SKIRT", "Adidas Club Skirt (S)", "Apparel", "Adidas", 26, 0, 0.05, 22, 1100, 2499, 73, 175],
];
const SUPPLIER_META = {
  Babolat: { lead: 10, moq: 25000 }, Wilson: { lead: 14, moq: 30000 },
  Yonex: { lead: 21, moq: 20000 }, Head: { lead: 18, moq: 22000 },
  Nike: { lead: 16, moq: 18000 }, Adidas: { lead: 22, moq: 18000 },
  Asics: { lead: 20, moq: 15000 }, Solinco: { lead: 7, moq: 8000 },
};

/* ============================ ENGINE ============================ */
function buildSkus() {
  return RAW.map(([sku, name, category, supplier, onHand, inTransit, avgDaily, leadTime, unitCost, price, daysSinceSale, age]) => {
    const reviewPeriod = 15;
    const safetyDays = Math.max(5, Math.round(leadTime * 0.4));
    const reorderWindow = leadTime + safetyDays;
    const targetMaxDays = 60;
    const deadAfterDays = 90;
    const cover = avgDaily > 0 ? (onHand + inTransit) / avgDaily : Infinity;

    let risk;
    if (avgDaily === 0 || daysSinceSale >= deadAfterDays) risk = 4;
    else if (cover > targetMaxDays) risk = 3;
    else if (cover <= leadTime) risk = 0;
    else if (cover <= reorderWindow) risk = 1;
    else risk = 2;

    const safetyStock = Math.round(avgDaily * leadTime * 0.5);
    let suggested = Math.max(Math.ceil(avgDaily * (leadTime + reviewPeriod) + safetyStock - (onHand + inTransit)), 0);
    if (risk === 3 || risk === 4) suggested = 0; // never reorder overstock/dead

    return {
      sku, name, category, supplier, onHand, inTransit, avgDaily, leadTime,
      unitCost, price, daysSinceSale, age, reorderWindow, targetMaxDays,
      cover, risk, suggestedQty: suggested,
      stockValue: onHand * unitCost,
    };
  });
}
const SKUS = buildSkus();

/* revenue trend (last 12 weeks, ₹) */
const REVENUE = [
  { w: "W1", rev: 182000 }, { w: "W2", rev: 196500 }, { w: "W3", rev: 175000 },
  { w: "W4", rev: 210400 }, { w: "W5", rev: 224800 }, { w: "W6", rev: 241200 },
  { w: "W7", rev: 233900 }, { w: "W8", rev: 268700 }, { w: "W9", rev: 281300 },
  { w: "W10", rev: 259600 }, { w: "W11", rev: 297400 }, { w: "W12", rev: 312800 },
];

/* ============================ SMALL UI PRIMITIVES ============================ */
function RiskBadge({ level, size = "sm" }) {
  const r = RISK[level];
  const pad = size === "sm" ? "2px 8px" : "4px 10px";
  const fs = size === "sm" ? 11 : 12;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: pad,
      borderRadius: 999, background: r.color + "1F", color: r.color,
      fontSize: fs, fontWeight: 600, whiteSpace: "nowrap",
    }}>
      <r.Icon size={fs + 2} /> {r.label}
    </span>
  );
}

function CoverMeter({ s }) {
  if (!isFinite(s.cover)) {
    return <div style={{ fontSize: 12, color: C.subtle, fontStyle: "italic" }}>no recent sales</div>;
  }
  const scaleMax = Math.max(s.targetMaxDays, s.cover, s.reorderWindow) * 1.1;
  const pct = (v) => Math.min(100, (v / scaleMax) * 100);
  const r = RISK[s.risk];
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: C.text }}>
          {s.cover.toFixed(0)}d cover
        </span>
        <span style={{ fontSize: 11, color: C.subtle }}>lead {s.leadTime}d</span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 999, background: C.border }}>
        <div style={{ position: "absolute", inset: 0, width: pct(s.cover) + "%", borderRadius: 999, background: r.color, transition: "width .3s" }} />
        {/* lead time marker */}
        <div style={{ position: "absolute", top: -2, left: pct(s.leadTime) + "%", width: 2, height: 12, background: C.danger }} />
        {/* reorder marker */}
        <div style={{ position: "absolute", top: -2, left: pct(s.reorderWindow) + "%", width: 2, height: 12, background: C.warning }} />
      </div>
    </div>
  );
}

function KpiCard({ label, value, delta, intent = "neutral", tone, Icon, sub }) {
  const goodWhenUp = intent !== "negative";
  const up = delta >= 0;
  const positive = up === goodWhenUp;
  const deltaColor = delta == null ? C.subtle : positive ? C.success : C.danger;
  return (
    <div style={{
      background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`,
      padding: 18, position: "relative", overflow: "hidden", boxShadow: "0 1px 3px rgba(14,23,38,.06)",
    }}>
      {tone && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: tone }} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: C.muted }}>{label}</span>
        {Icon && <Icon size={16} color={C.subtle} />}
      </div>
      <div style={{ fontFamily: mono, fontSize: 26, fontWeight: 700, color: C.text, lineHeight: 1.1 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
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

function Card({ title, action, children, pad = 18 }) {
  return (
    <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(14,23,38,.06)" }}>
      {title && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{title}</span>
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
    <div style={{ background: C.navy, color: "#fff", padding: "8px 12px", borderRadius: 8, fontSize: 12, boxShadow: "0 8px 24px rgba(14,23,38,.16)" }}>
      <div style={{ color: C.subtle, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontFamily: mono, fontWeight: 600 }}>{p.name}: {fmt(p.value)}</div>
      ))}
    </div>
  );
}

/* ============================ MODULES ============================ */
function Overview() {
  const invValue = SKUS.reduce((a, s) => a + s.stockValue, 0);
  const deadValue = SKUS.filter((s) => s.risk === 4).reduce((a, s) => a + s.stockValue, 0);
  const overValue = SKUS.filter((s) => s.risk === 3).reduce((a, s) => a + s.stockValue, 0);
  const healthyValue = invValue - deadValue - overValue;
  const stockoutCount = SKUS.filter((s) => s.risk <= 1).length;
  const rev30 = REVENUE.slice(-4).reduce((a, r) => a + r.rev, 0);

  const catMix = useMemo(() => {
    const m = {};
    SKUS.forEach((s) => { m[s.category] = (m[s.category] || 0) + s.stockValue; });
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, []);
  const catColors = [C.optic, C.clay, C.blue, C.dead, C.overstock, C.success, C.warning];

  const valueSplit = [
    { name: "Healthy", value: healthyValue, color: C.success },
    { name: "Overstock", value: overValue, color: C.overstock },
    { name: "Dead", value: deadValue, color: C.dead },
  ];

  const topMovers = [...SKUS].sort((a, b) => b.avgDaily * b.price - a.avgDaily * a.price).slice(0, 6);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
        <KpiCard label="Revenue (30d)" value={inr(rev30)} delta={12} Icon={IndianRupee} sub="vs prev 30d" />
        <KpiCard label="Sell-through" value="63%" delta={4} Icon={TrendingUp} sub="of avg stock" />
        <KpiCard label="Inventory value" value={inr(invValue)} delta={-3} intent="neutral" Icon={Package} />
        <KpiCard label="Stockout-risk SKUs" value={stockoutCount} delta={9} intent="negative" tone={C.danger} Icon={AlertOctagon} sub="need action" />
        <KpiCard label="Cash in dead stock" value={inr(deadValue)} delta={6} intent="negative" tone={C.dead} Icon={Snowflake} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18 }}>
        <Card title="Revenue — last 12 weeks">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={REVENUE} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.blue} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.blue} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="w" tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => "₹" + v / 1000 + "k"} />
                <Tooltip content={<ChartTip fmt={inr} />} />
                <Area type="monotone" dataKey="rev" name="Revenue" stroke={C.blue} strokeWidth={2.5} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Inventory value health">
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={valueSplit} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
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
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={catMix} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: C.subtle }} axisLine={false} tickLine={false} tickFormatter={(v) => "₹" + v / 1000 + "k"} />
                <Tooltip content={<ChartTip fmt={inr} />} cursor={{ fill: C.bg }} />
                <Bar dataKey="value" name="Stock value" radius={[6, 6, 0, 0]}>
                  {catMix.map((e, i) => <Cell key={i} fill={catColors[i % catColors.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Top movers (by daily revenue)">
          <div style={{ display: "flex", flexDirection: "column" }}>
            {topMovers.map((s, i) => (
              <div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: i < topMovers.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <span style={{ fontFamily: mono, fontSize: 12, color: C.subtle, width: 18 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: C.subtle }}>{s.category} · {s.supplier}</div>
                </div>
                <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: C.text }}>{inr(s.avgDaily * s.price)}/d</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StockoutRadar({ onAddPo }) {
  const rows = useMemo(() => SKUS.filter((s) => s.risk <= 1).sort((a, b) => a.cover - b.cover), []);
  return (
    <Card title={`Stockout Radar — ${rows.length} SKUs need attention`} pad={0}
      action={<span style={{ fontSize: 12, color: C.subtle }}>ranked by days of cover</span>}>
      <Table rows={rows} onAddPo={onAddPo} cols={["product", "risk", "cover", "onhand", "suggest", "action"]} />
    </Card>
  );
}

function DeadStock({ onAddPo }) {
  const rows = useMemo(() => SKUS.filter((s) => s.risk === 4 || s.risk === 3).sort((a, b) => b.stockValue - a.stockValue), []);
  const trapped = rows.reduce((a, s) => a + s.stockValue, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        <KpiCard label="Cash locked in slow stock" value={inr(trapped)} tone={C.dead} Icon={Snowflake} sub={`${rows.length} SKUs`} />
        <KpiCard label="Dead SKUs (no sale 90d+)" value={SKUS.filter((s) => s.risk === 4).length} tone={C.dead} Icon={Snowflake} />
        <KpiCard label="Overstocked SKUs" value={SKUS.filter((s) => s.risk === 3).length} tone={C.overstock} Icon={Layers} />
      </div>
      <Card title="Markdown & clearance candidates" pad={0}
        action={<span style={{ fontSize: 12, color: C.subtle }}>highest trapped cash first</span>}>
        <Table rows={rows} onAddPo={onAddPo} cols={["product", "risk", "age", "onhand", "value", "markdown"]} />
      </Card>
    </div>
  );
}

function Table({ rows, onAddPo, cols }) {
  const H = ({ children, right }) => (
    <th style={{ textAlign: right ? "right" : "left", fontSize: 11, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: C.muted, padding: "10px 14px", position: "sticky", top: 0, background: C.bg }}>{children}</th>
  );
  const td = { padding: "11px 14px", fontSize: 13, color: C.text, borderTop: `1px solid ${C.border}` };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {cols.includes("product") && <H>Product</H>}
            {cols.includes("risk") && <H>Status</H>}
            {cols.includes("cover") && <H>Days of cover</H>}
            {cols.includes("age") && <H right>Age</H>}
            {cols.includes("onhand") && <H right>On hand</H>}
            {cols.includes("suggest") && <H right>Suggested qty</H>}
            {cols.includes("value") && <H right>Stock value</H>}
            {cols.includes("action") && <H right>Action</H>}
            {cols.includes("markdown") && <H right>Action</H>}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.sku} style={{ transition: "background .15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.bg)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              {cols.includes("product") && (
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>{s.sku} · {s.supplier}</div>
                </td>
              )}
              {cols.includes("risk") && <td style={td}><RiskBadge level={s.risk} /></td>}
              {cols.includes("cover") && <td style={td}><CoverMeter s={s} /></td>}
              {cols.includes("age") && <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{s.age}d · last sold {s.daysSinceSale}d</td>}
              {cols.includes("onhand") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{s.onHand}{s.inTransit > 0 ? <span style={{ color: C.info, fontWeight: 500 }}> +{s.inTransit}</span> : ""}</td>}
              {cols.includes("suggest") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 700, color: s.suggestedQty > 0 ? C.text : C.subtle }}>{s.suggestedQty || "—"}</td>}
              {cols.includes("value") && <td style={{ ...td, textAlign: "right", fontFamily: mono, fontWeight: 600 }}>{inr(s.stockValue)}</td>}
              {cols.includes("action") && (
                <td style={{ ...td, textAlign: "right" }}>
                  <AddBtn disabled={!s.suggestedQty} onClick={() => onAddPo(s)} label={`Add ${s.suggestedQty}`} />
                </td>
              )}
              {cols.includes("markdown") && (
                <td style={{ ...td, textAlign: "right" }}>
                  <button style={{ ...btnGhost, color: C.clay, borderColor: C.clay + "55" }}>Mark down</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const btnGhost = {
  fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8,
  border: `1px solid ${C.border}`, background: "transparent", cursor: "pointer", color: C.text,
};
function AddBtn({ onClick, label, disabled }) {
  return (
    <button disabled={disabled} onClick={onClick} style={{
      fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "none",
      cursor: disabled ? "not-allowed" : "pointer",
      background: disabled ? C.border : C.optic, color: disabled ? C.subtle : C.opticInk,
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      <Plus size={13} /> {label}
    </button>
  );
}

function AutoPO({ poItems, setPoItems, approved, setApproved }) {
  // group suggested + manually-added items by supplier
  const drafts = useMemo(() => {
    const base = SKUS.filter((s) => s.suggestedQty > 0);
    const merged = {};
    base.forEach((s) => (merged[s.sku] = { ...s, qty: s.suggestedQty }));
    poItems.forEach((s) => (merged[s.sku] = { ...s, qty: s.suggestedQty }));
    const bySup = {};
    Object.values(merged).forEach((s) => {
      (bySup[s.supplier] = bySup[s.supplier] || []).push(s);
    });
    return Object.entries(bySup).map(([supplier, items]) => {
      const total = items.reduce((a, s) => a + s.qty * s.unitCost, 0);
      const moq = SUPPLIER_META[supplier]?.moq || 0;
      return { supplier, items, total, moq, lead: SUPPLIER_META[supplier]?.lead };
    }).sort((a, b) => b.total - a.total);
  }, [poItems]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 18, alignItems: "start" }}>
      {drafts.map((d) => {
        const isApproved = approved.includes(d.supplier);
        const belowMoq = d.total < d.moq;
        return (
          <div key={d.supplier} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${isApproved ? C.success : C.border}`, boxShadow: "0 1px 3px rgba(14,23,38,.06)", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", background: isApproved ? C.success + "12" : C.bg, borderBottom: `1px solid ${C.border}` }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
                  {d.supplier}
                  {isApproved
                    ? <span style={{ fontSize: 11, color: C.success, display: "inline-flex", alignItems: "center", gap: 3 }}><Check size={13} /> Approved</span>
                    : <span style={{ fontSize: 10, fontWeight: 700, color: C.opticInk, background: C.optic, padding: "2px 7px", borderRadius: 999 }}>SUGGESTED</span>}
                </div>
                <div style={{ fontSize: 11, color: C.subtle }}>Lead time {d.lead}d · {d.items.length} line items</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: C.text }}>{inr(d.total)}</div>
                <div style={{ fontSize: 11, color: belowMoq ? C.warning : C.success }}>{belowMoq ? `${inr(d.moq - d.total)} below min` : "meets minimum"}</div>
              </div>
            </div>
            <div style={{ padding: "6px 18px" }}>
              {d.items.map((s, i) => (
                <div key={s.sku} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < d.items.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: C.subtle, fontFamily: mono }}>on hand {s.onHand} · {inr(s.unitCost)}/unit</div>
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: C.text, textAlign: "right" }}>
                    ×{s.qty}
                    <div style={{ fontSize: 11, fontWeight: 500, color: C.muted }}>{inr(s.qty * s.unitCost)}</div>
                  </div>
                </div>
              ))}
            </div>
            {belowMoq && !isApproved && (
              <div style={{ margin: "0 18px 12px", padding: "8px 12px", background: C.warning + "14", borderRadius: 8, fontSize: 12, color: C.overstock }}>
                Tip: add a fast-moving SKU from this supplier to clear the free-freight minimum.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, padding: "0 18px 16px" }}>
              {isApproved ? (
                <button onClick={() => setApproved(approved.filter((x) => x !== d.supplier))} style={{ ...btnGhost, flex: 1 }}>
                  <RefreshCw size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} /> Undo
                </button>
              ) : (
                <>
                  <button onClick={() => setApproved([...approved, d.supplier])} style={{
                    flex: 1, fontSize: 13, fontWeight: 700, padding: "9px 12px", borderRadius: 8, border: "none",
                    background: C.optic, color: C.opticInk, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
                  }}>
                    <Truck size={14} /> Approve &amp; Send
                  </button>
                  <button style={btnGhost}>Edit</button>
                  <button style={{ ...btnGhost, color: C.muted }}><X size={14} /></button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================ SHELL ============================ */
const NAV = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "radar", label: "Stockout Radar", Icon: Radar },
  { id: "dead", label: "Dead Stock", Icon: Snowflake },
  { id: "po", label: "Reorder / Auto-PO", Icon: ClipboardList },
];

export default function BaselineDashboard() {
  const [tab, setTab] = useState("overview");
  const [poItems, setPoItems] = useState([]);
  const [approved, setApproved] = useState([]);
  const [toast, setToast] = useState(null);

  const addPo = (s) => {
    setPoItems((p) => (p.find((x) => x.sku === s.sku) ? p : [...p, s]));
    setToast(`Added ${s.suggestedQty} × ${s.name} to ${s.supplier} PO`);
    setTimeout(() => setToast(null), 3000);
  };
  const poCount = new Set([...SKUS.filter((s) => s.suggestedQty > 0).map((s) => s.sku), ...poItems.map((s) => s.sku)]).size;

  return (
    <div style={{ display: "flex", minHeight: 720, fontFamily: "Inter, system-ui, sans-serif", background: C.bg, color: C.text, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.border}` }}>
      {/* Sidebar */}
      <aside style={{ width: 230, background: C.navy, color: "#fff", padding: "20px 14px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 22px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: C.optic, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 12, height: 12, borderRadius: 999, border: `2px solid ${C.opticInk}` }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-.02em" }}>Baseline</div>
            <div style={{ fontSize: 10, color: C.subtle, marginTop: -2 }}>Tennis Outlet</div>
          </div>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {NAV.map((n) => {
            const active = tab === n.id;
            return (
              <button key={n.id} onClick={() => setTab(n.id)} style={{
                display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10,
                border: "none", cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: active ? 600 : 500,
                background: active ? C.navy600 : "transparent", color: active ? "#fff" : "#A7B0C0",
                borderLeft: active ? `3px solid ${C.optic}` : "3px solid transparent",
              }}>
                <n.Icon size={18} color={active ? C.optic : "#7C8696"} /> {n.label}
                {n.id === "po" && poCount > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, background: C.optic, color: C.opticInk, borderRadius: 999, padding: "1px 7px" }}>{poCount}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: "transparent", color: "#A7B0C0", fontSize: 14 }}>
            <Settings size={18} color="#7C8696" /> Settings
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 12px", fontSize: 11, color: C.success }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: C.success }} /> Synced 4m ago · Magento
          </div>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 24px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>{NAV.find((n) => n.id === tab).label}</h1>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.bg, borderRadius: 10, padding: "8px 12px", width: 240, border: `1px solid ${C.border}` }}>
              <Search size={15} color={C.subtle} />
              <input placeholder="Search SKU or supplier" style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, width: "100%", color: C.text }} />
            </div>
            <button style={{ position: "relative", width: 38, height: 38, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bell size={17} color={C.muted} />
              <span style={{ position: "absolute", top: 8, right: 9, width: 7, height: 7, borderRadius: 999, background: C.danger }} />
            </button>
            <div style={{ width: 38, height: 38, borderRadius: 999, background: C.navy600, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>TO</div>
          </div>
        </header>

        <main style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {tab === "overview" && <Overview />}
          {tab === "radar" && <StockoutRadar onAddPo={addPo} />}
          {tab === "dead" && <DeadStock onAddPo={addPo} />}
          {tab === "po" && <AutoPO poItems={poItems} setPoItems={setPoItems} approved={approved} setApproved={setApproved} />}
        </main>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: 24, background: C.navy, color: "#fff", padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: "0 8px 24px rgba(14,23,38,.28)", display: "flex", alignItems: "center", gap: 8, zIndex: 50 }}>
          <CheckCircle2 size={16} color={C.optic} /> {toast}
        </div>
      )}
    </div>
  );
}
