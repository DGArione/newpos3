"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TrendingUp, ShoppingBag, Ban, RotateCcw, Download, BarChart3, Clock,
  Receipt, Flame, Utensils, CalendarDays, Layers, Trash2, ArrowUpDown, Printer,
  DollarSign, Package,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen } from "@/components/ui";

interface Advanced {
  period: { from: string; to: string };
  summary: {
    totalRevenue: number; totalOrders: number; totalTips: number; totalDiscounts: number;
    byPaymentMethod: Record<string, number>; totalCardFees: number; netRevenue: number;
    grossSales: number; netSales: number; avgOrderValue: number;
  };
  paymentMethods: { method: string; gross: number; fee: number; net: number; count: number }[];
  itemBreakdown: { name: string; qty: number; revenue: number }[];
  categoryStats: { category: string; qty: number; revenue: number }[];
  hourly: { hour: number; orders: number; revenue: number }[];
  peakHour: { hour: number; orders: number; revenue: number } | null;
  dayOfWeek: { day: string; dayIndex: number; orders: number; revenue: number }[];
  weekdayVsWeekend: { weekday: number; weekend: number };
  deadStock: { name: string; category: string; price: number }[];
  modifierStats: { name: string; count: number }[];
  inventoryCost: { purchases: number; consumed: number };
  voids: { orderId: number; tableName: string; staffName: string; amount: number; reason: string; at: string }[];
}
interface Movement { id: number; ingredientName: string; type: string; qty: number; note?: string; createdAt?: string }

function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function today() { return new Date().toISOString().slice(0, 10); }

const RANGE_PRESETS: Array<[string, string, string]> = [
  ["today", today(), today()],
  ["7 days", daysAgo(6), today()],
  ["30 days", daysAgo(29), today()],
  ["90 days", daysAgo(89), today()],
];

type ItemSort = "qty" | "revenue" | "name";

export default function ReportsPage() {
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [adv, setAdv] = useState<Advanced | null>(null);
  const [waste, setWaste] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemSort, setItemSort] = useState<ItemSort>("revenue");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiGet<Advanced>(`/reports/advanced?from=${from}&to=${to}`),
      apiGet<Movement[]>("/inventory/movements").catch(() => []),
    ]).then(([a, m]) => {
      setAdv(a);
      setWaste((Array.isArray(m) ? m : []).filter((x) => x.type === "waste"));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [from, to]);

  const sortedItems = useMemo(() => {
    if (!adv) return [];
    const list = [...adv.itemBreakdown];
    if (itemSort === "qty") list.sort((a, b) => b.qty - a.qty);
    else if (itemSort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => b.revenue - a.revenue);
    return list;
  }, [adv, itemSort]);

  function exportCsv() {
    if (!adv) return;
    const sec = (title: string, rows: string[][]) =>
      `\n${title}\n` + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
    let csv = `Golden Beach POS — Report ${from} to ${to}\n`;
    csv += sec("Summary", [
      ["Metric", "Value"],
      ["Revenue", String(adv.summary.totalRevenue)],
      ["Orders", String(adv.summary.totalOrders)],
      ["Avg order value", String(adv.summary.avgOrderValue)],
      ["Gross sales", String(adv.summary.grossSales)],
      ["Discounts", String(adv.summary.totalDiscounts)],
      ["Card fees", String(adv.summary.totalCardFees)],
      ["Net revenue", String(adv.summary.netRevenue)],
      ["Tips", String(adv.summary.totalTips)],
    ]);
    csv += sec("By payment method", [["Method", "Gross", "Fee", "Net", "Count"],
      ...adv.paymentMethods.map((m) => [m.method, String(m.gross), String(m.fee), String(m.net), String(m.count)])]);
    csv += sec("Top items", [["Item", "Qty", "Revenue"],
      ...sortedItems.map((i) => [i.name, String(i.qty), String(i.revenue)])]);
    csv += sec("By category", [["Category", "Qty", "Revenue"],
      ...adv.categoryStats.map((c) => [c.category, String(c.qty), String(c.revenue)])]);
    csv += sec("Hourly", [["Hour", "Orders", "Revenue"],
      ...adv.hourly.map((h) => [`${h.hour}:00`, String(h.orders), String(h.revenue)])]);
    csv += sec("Day of week", [["Day", "Orders", "Revenue"],
      ...adv.dayOfWeek.map((d) => [d.day, String(d.orders), String(d.revenue)])]);
    csv += sec("Waste", [["Ingredient", "Qty", "When", "Note"],
      ...waste.map((w) => [w.ingredientName, String(w.qty), w.createdAt || "", w.note || ""])]);
    csv += sec("Voids", [["Order", "Table", "Staff", "Amount", "Reason", "When"],
      ...adv.voids.map((v) => [String(v.orderId), v.tableName, v.staffName, String(v.amount), v.reason, v.at])]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `report-${from}_to_${to}.csv`; a.click();
  }

  function exportPdf() {
    // Build a clean print document and let the browser save as PDF.
    if (!adv) return;
    const w = window.open("", "_blank", "width=820,height=1000");
    if (!w) { alert("Allow pop-ups to export PDF"); return; }
    const row = (cells: (string | number)[], head = false) =>
      `<tr>${cells.map((c) => `<${head ? "th" : "td"}>${c}</${head ? "th" : "td"}>`).join("")}</tr>`;
    const s = adv.summary;
    w.document.write(`<!doctype html><html><head><title>Report ${from}–${to}</title>
      <style>
        body{font-family:system-ui,Segoe UI,sans-serif;margin:28px;color:#1e1e1e}
        h1{font-size:20px;margin:0 0 2px} .sub{color:#777;font-size:12px;margin-bottom:18px}
        h2{font-size:14px;margin:22px 0 8px;color:#a85e00;text-transform:uppercase;letter-spacing:.05em}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}
        th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #eee}
        th{background:#faf4e8;color:#555}
        .kpis{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px}
        .kpi{border:1px solid #eee;border-radius:10px;padding:10px 14px;min-width:120px}
        .kpi .l{font-size:10px;text-transform:uppercase;color:#999} .kpi .v{font-size:18px;font-weight:700;color:#a85e00}
        @media print{@page{margin:14mm}}
      </style></head><body>
      <h1>${esc(settings?.businessName || "Golden Beach Restaurant")} — Sales Report</h1>
      <div class="sub">${from} to ${to} · generated ${new Date().toLocaleString()}</div>
      <div class="kpis">
        ${kpi("Revenue", money(s.totalRevenue, currency))}
        ${kpi("Orders", String(s.totalOrders))}
        ${kpi("Avg order", money(s.avgOrderValue, currency))}
        ${kpi("Discounts", money(s.totalDiscounts, currency))}
        ${kpi("Card fees", money(s.totalCardFees, currency))}
        ${kpi("Net", money(s.netRevenue, currency))}
      </div>
      <h2>By payment method</h2><table>${row(["Method", "Gross", "Fee", "Net", "Count"], true)}
        ${adv.paymentMethods.map((m) => row([m.method, money(m.gross, currency), money(m.fee, currency), money(m.net, currency), m.count])).join("")}</table>
      <h2>Top items</h2><table>${row(["Item", "Qty", "Revenue"], true)}
        ${sortedItems.slice(0, 25).map((i) => row([esc(i.name), i.qty, money(i.revenue, currency)])).join("")}</table>
      <h2>By category</h2><table>${row(["Category", "Qty", "Revenue"], true)}
        ${adv.categoryStats.map((c) => row([esc(c.category), c.qty, money(c.revenue, currency)])).join("")}</table>
      <h2>Day of week</h2><table>${row(["Day", "Orders", "Revenue"], true)}
        ${adv.dayOfWeek.map((d) => row([d.day, d.orders, money(d.revenue, currency)])).join("")}</table>
      ${waste.length ? `<h2>Waste</h2><table>${row(["Ingredient", "Qty", "When", "Note"], true)}
        ${waste.map((x) => row([esc(x.ingredientName), x.qty, (x.createdAt || "").slice(0, 16), esc(x.note || "")])).join("")}</table>` : ""}
      ${adv.voids.length ? `<h2>Voids / cancellations</h2><table>${row(["Order", "Table", "Staff", "Amount", "Reason"], true)}
        ${adv.voids.map((v) => row([v.orderId, esc(v.tableName), esc(v.staffName), money(v.amount, currency), esc(v.reason)])).join("")}</table>` : ""}
      <script>window.onload=()=>setTimeout(()=>window.print(),250)</script>
      </body></html>`);
    w.document.close();
    function esc(t: string) { return String(t || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string)); }
    function kpi(l: string, v: string) { return `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`; }
  }

  if (loading || !adv) return <Screen><PageLoader label="Crunching numbers" /></Screen>;

  const s = adv.summary;
  const maxHourRev = Math.max(1, ...adv.hourly.map((h) => h.revenue));
  const maxDowRev = Math.max(1, ...adv.dayOfWeek.map((d) => d.revenue));
  const maxCatRev = Math.max(1, ...adv.categoryStats.map((c) => c.revenue));
  const totalPay = Object.values(s.byPaymentMethod).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Reports" subtitle={`${from} → ${to}`} icon={BarChart3}>
          <button onClick={exportCsv} className="btn btn-ghost btn-sm"><Download size={14} /> CSV</button>
          <button onClick={exportPdf} className="btn btn-ghost btn-sm"><Printer size={14} /> PDF</button>
        </PageHeader>

        <div className="flex items-center gap-2 flex-wrap mb-5">
          <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
            {RANGE_PRESETS.map(([label, f, t]) => {
              const active = from === f && to === t;
              return (
                <button key={label} onClick={() => { setFrom(f); setTo(t); }}
                  className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
                  style={active ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" } : { color: "var(--muted)" }}>
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="inp !py-1.5 !px-3 text-[12.5px]" style={{ width: 150 }} />
            <span className="text-muted text-[12px]">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="inp !py-1.5 !px-3 text-[12.5px]" style={{ width: 150 }} />
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Kpi icon={<TrendingUp size={15} />}  label="Revenue"     value={money(s.totalRevenue, currency)} accent />
          <Kpi icon={<ShoppingBag size={15} />} label="Orders"      value={String(s.totalOrders)} />
          <Kpi icon={<DollarSign size={15} />}  label="Avg order"   value={money(s.avgOrderValue, currency)} />
          <Kpi icon={<Ban size={15} />}         label="Discounts"   value={money(s.totalDiscounts, currency)} />
          <Kpi icon={<RotateCcw size={15} />}   label="Card fees"   value={money(s.totalCardFees, currency)} />
          <Kpi icon={<TrendingUp size={15} />}  label="Net"         value={money(s.netRevenue, currency)} />
        </div>
      </Screen>

      {/* Payment + hourly */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Screen>
          <div className="eyebrow mb-4 flex items-center gap-2"><Receipt size={13} /> Payment methods</div>
          <div className="space-y-3">
            {adv.paymentMethods.filter((m) => m.gross > 0 || m.count > 0).map((m) => {
              const pct = Math.round((m.gross / totalPay) * 100);
              return (
                <div key={m.method}>
                  <div className="flex justify-between items-center text-sm mb-1">
                    <span className="capitalize font-medium text-ink">{m.method} <span className="text-[11px] text-muted">· {m.count} orders · {pct}%</span></span>
                    <span className="mono font-semibold">{money(m.gross, currency)}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--panel-2)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--olive)" }} />
                  </div>
                </div>
              );
            })}
            {!adv.paymentMethods.some((m) => m.gross > 0) && <div className="text-sm text-muted">No sales in range.</div>}
          </div>
        </Screen>

        <Screen>
          <div className="eyebrow mb-4 flex items-center gap-2">
            <Clock size={13} /> Hourly sales
            {adv.peakHour && adv.peakHour.orders > 0 && (
              <span className="pill pill-olive ml-auto">Peak {adv.peakHour.hour}:00</span>
            )}
          </div>
          <div className="flex items-end gap-0.5 h-40">
            {adv.hourly.map((h) => (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <div className="w-full rounded-t-sm transition-all"
                  style={{ height: `${Math.max(2, (h.revenue / maxHourRev) * 100)}%`, background: h.orders > 0 ? "var(--olive)" : "var(--line)" }}
                  title={`${h.hour}:00 — ${h.orders} orders · ${money(h.revenue, currency)}`} />
                {h.hour % 6 === 0 && <span className="text-[9px] text-muted mt-1">{h.hour}</span>}
              </div>
            ))}
          </div>
        </Screen>
      </div>

      {/* Top items + category */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Screen>
          <div className="flex items-center justify-between mb-4">
            <div className="eyebrow flex items-center gap-2"><Flame size={13} /> Top items</div>
            <button onClick={() => setItemSort((s) => s === "revenue" ? "qty" : s === "qty" ? "name" : "revenue")}
              className="btn btn-ghost btn-sm">
              <ArrowUpDown size={12} /> {itemSort === "revenue" ? "By revenue" : itemSort === "qty" ? "By qty" : "By name"}
            </button>
          </div>
          {!sortedItems.length ? <EmptyState title="No sales in range" /> : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {sortedItems.slice(0, 20).map((it, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{ background: "var(--olive-wash)", color: "var(--olive-700)" }}>{i + 1}</span>
                  <span className="text-[13px] text-ink flex-1 truncate">{it.name}</span>
                  <span className="text-[12px] text-muted mono">×{it.qty}</span>
                  <span className="text-[13px] font-semibold mono w-24 text-right" style={{ color: "var(--olive-700)" }}>{money(it.revenue, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </Screen>

        <Screen>
          <div className="eyebrow mb-4 flex items-center gap-2"><Layers size={13} /> By category</div>
          {!adv.categoryStats.length ? <EmptyState title="No sales in range" /> : (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {adv.categoryStats.map((c) => {
                const pct = Math.round((c.revenue / maxCatRev) * 100);
                return (
                  <div key={c.category}>
                    <div className="flex justify-between text-[13px] mb-1">
                      <span className="text-ink font-medium">{c.category} <span className="text-[11px] text-muted">· {c.qty}</span></span>
                      <span className="mono font-semibold">{money(c.revenue, currency)}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--panel-2)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--kot)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Screen>
      </div>

      {/* Day of week */}
      <Screen>
        <div className="eyebrow mb-4 flex items-center gap-2"><CalendarDays size={13} /> Day of week</div>
        <div className="flex items-end gap-2 h-40">
          {adv.dayOfWeek.map((d) => (
            <div key={d.dayIndex} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
              <div className="text-[10px] text-muted mono">{d.revenue > 0 ? Math.round(d.revenue) : ""}</div>
              <div className="w-full rounded-t-md transition-all"
                style={{ height: `${Math.max(2, (d.revenue / maxDowRev) * 100)}%`, background: "var(--olive)" }}
                title={`${d.day} — ${d.orders} orders`} />
              <span className="text-[11px] text-muted font-medium">{d.day}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-6 mt-4 text-[12.5px]">
          <span className="text-muted">Weekday: <span className="mono font-semibold text-ink">{money(adv.weekdayVsWeekend.weekday, currency)}</span></span>
          <span className="text-muted">Weekend: <span className="mono font-semibold text-ink">{money(adv.weekdayVsWeekend.weekend, currency)}</span></span>
        </div>
      </Screen>

      {/* Waste + Voids + dead stock */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Screen>
          <div className="eyebrow mb-4 flex items-center gap-2"><Trash2 size={13} /> Waste log</div>
          {!waste.length ? <div className="text-sm text-muted py-4">No waste recorded.</div> : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {waste.slice(0, 40).map((w) => (
                <div key={w.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--panel-2)" }}>
                  <span className="pill pill-bad">waste</span>
                  <span className="font-medium text-ink flex-1 truncate">{w.ingredientName}</span>
                  <span className="mono" style={{ color: "var(--bad)" }}>{w.qty}</span>
                  <span className="text-muted text-[11px]">{(w.createdAt || "").slice(0, 16)}</span>
                </div>
              ))}
            </div>
          )}
        </Screen>

        <Screen>
          <div className="eyebrow mb-4 flex items-center gap-2"><Ban size={13} /> Voids / cancellations</div>
          {!adv.voids.length ? <div className="text-sm text-muted py-4">No voids in range.</div> : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {adv.voids.map((v) => (
                <div key={v.orderId} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--panel-2)" }}>
                  <span className="font-semibold mono text-ink">#{v.orderId}</span>
                  <span className="text-muted flex-1 truncate">{v.reason || v.tableName} · {v.staffName}</span>
                  <span className="mono font-semibold" style={{ color: "var(--bad)" }}>{money(v.amount, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </Screen>
      </div>

      {/* Modifiers + dead stock + inventory cost */}
      <div className="grid lg:grid-cols-3 gap-3">
        <Screen>
          <div className="eyebrow mb-4 flex items-center gap-2"><Utensils size={13} /> Popular modifiers</div>
          {!adv.modifierStats.length ? <div className="text-sm text-muted py-2">None used.</div> : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {adv.modifierStats.slice(0, 12).map((m) => (
                <div key={m.name} className="flex justify-between text-[12.5px]">
                  <span className="text-ink">{m.name}</span>
                  <span className="mono text-muted">×{m.count}</span>
                </div>
              ))}
            </div>
          )}
        </Screen>

        <Screen>
          <div className="eyebrow mb-4 flex items-center gap-2"><Package size={13} /> Dead stock (not sold)</div>
          {!adv.deadStock.length ? <div className="text-sm text-muted py-2">Everything sold 🎉</div> : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {adv.deadStock.slice(0, 15).map((d, i) => (
                <div key={i} className="flex justify-between text-[12.5px]">
                  <span className="text-ink truncate">{d.name}</span>
                  <span className="mono text-muted">{money(d.price, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </Screen>

        <Screen>
          <div className="eyebrow mb-4 flex items-center gap-2"><DollarSign size={13} /> Inventory cost</div>
          <div className="space-y-3">
            <div className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
              <div className="text-[11px] uppercase tracking-wider text-muted">Purchases</div>
              <div className="mono text-[18px] font-semibold">{money(adv.inventoryCost.purchases, currency)}</div>
            </div>
            <div className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
              <div className="text-[11px] uppercase tracking-wider text-muted">Consumed (from stock periods)</div>
              <div className="mono text-[18px] font-semibold">{money(adv.inventoryCost.consumed, currency)}</div>
            </div>
          </div>
        </Screen>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  const bg = accent ? "var(--olive)" : "var(--panel-2)";
  const fg = accent ? "#fff" : "var(--ink)";
  const iconColor = accent ? "rgba(255,255,255,.85)" : "var(--olive)";
  return (
    <div className="rounded-xl p-3.5" style={{ background: bg, border: accent ? "none" : "1px solid var(--line)" }}>
      <div className="flex items-center gap-2 mb-1.5" style={{ color: iconColor }}>
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="mono text-[17px] font-semibold leading-none" style={{ color: fg }}>{value}</div>
    </div>
  );
}
