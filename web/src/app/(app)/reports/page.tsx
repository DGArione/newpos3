"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp, ShoppingBag, Ban, RotateCcw, Download, BarChart3, Clock,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen } from "@/components/ui";

interface Report {
  revenue: number;
  orderCount: number;
  trend: number[];
  voidedCount: number;
  voidedTotal: number;
  refunds: number;
  refundCount: number;
}
interface ItemRow { name?: string; itemName?: string; qty?: number; quantity?: number; revenue?: number; total?: number }
interface Analytics { items: ItemRow[]; from?: string; to?: string; totalOrders?: number }

const RANGES = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["all", "All time"]] as const;

export default function ReportsPage() {
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [range, setRange] = useState<string>("today");
  const [rep, setRep] = useState<Report | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiGet<Report>(`/reports/summary?range=${range}`),
      apiGet<Analytics>(`/analytics/items?range=${range}`).catch(() => null),
    ]).then(([r, a]) => { setRep(r); setAnalytics(a); }).catch(() => {}).finally(() => setLoading(false));
  }, [range]);

  const maxTrend = rep ? Math.max(1, ...rep.trend) : 1;
  const topItems = (analytics?.items || []).map((i) => ({
    name: i.name || i.itemName || "—",
    qty: i.qty ?? i.quantity ?? 0,
    revenue: i.revenue ?? i.total ?? 0,
  })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  function exportCsv() {
    const rows = [["Item", "Quantity", "Revenue"]];
    topItems.forEach((i) => rows.push([i.name, String(i.qty), String(i.revenue)]));
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `report-${range}-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Reports" subtitle="Sales performance and best sellers" icon={BarChart3}>
          <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
            {RANGES.map(([k, label]) => (
              <button key={k} onClick={() => setRange(k)}
                className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
                style={range === k
                  ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                  : { color: "var(--muted)" }}>{label}</button>
            ))}
          </div>
          <button onClick={exportCsv} className="btn btn-ghost btn-sm" title="Export top-sellers to CSV">
            <Download size={14} /> Export
          </button>
        </PageHeader>

        {loading || !rep ? <PageLoader /> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              <Tile icon={<TrendingUp size={16} />} label="Revenue" value={money(rep.revenue, currency)} accent />
              <Tile icon={<ShoppingBag size={16} />} label="Orders"  value={String(rep.orderCount)} />
              <Tile icon={<Ban size={16} />}         label="Voided"  value={`${rep.voidedCount} · ${money(rep.voidedTotal, currency)}`} />
              <Tile icon={<RotateCcw size={16} />}   label="Refunds" value={`${rep.refundCount} · ${money(rep.refunds, currency)}`} />
            </div>
          </>
        )}
      </Screen>

      {rep && (
        <div className="grid lg:grid-cols-2 gap-3">
          <Screen>
            <div className="eyebrow mb-4">Revenue trend (last 7 days)</div>
            <div className="flex items-end gap-2 h-44">
              {rep.trend.map((v, i) => {
                const isToday = i === rep.trend.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5 justify-end h-full">
                    <div className="text-[10px] text-muted mono">{v > 0 ? Math.round(v) : ""}</div>
                    <div className="w-full rounded-t-md transition-all"
                      style={{
                        height: `${Math.max(3, (v / maxTrend) * 100)}%`,
                        background: isToday ? "var(--olive)" : "color-mix(in srgb, var(--olive) 35%, transparent)",
                      }} />
                    <span className="text-[10px] text-muted">{["6d", "5d", "4d", "3d", "2d", "1d", "Now"][i]}</span>
                  </div>
                );
              })}
            </div>
          </Screen>

          <Screen>
            <div className="eyebrow mb-4">Top sellers</div>
            {!topItems.length ? <EmptyState title="No sales in range" /> : (
              <div className="space-y-2.5">
                {topItems.map((it, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                      style={{ background: "var(--olive-wash)", color: "var(--olive-700)" }}>{i + 1}</span>
                    <span className="text-sm text-ink flex-1 truncate">{it.name}</span>
                    <span className="text-[12px] text-muted mono">×{it.qty}</span>
                    <span className="text-[13px] font-semibold mono w-24 text-right" style={{ color: "var(--olive-700)" }}>
                      {money(it.revenue, currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Screen>
        </div>
      )}

      {/* Advanced link */}
      <Screen>
        <div className="flex items-center gap-3">
          <Clock size={16} style={{ color: "var(--olive)" }} />
          <div className="flex-1">
            <h3 className="text-[14px] font-semibold text-ink">Advanced reports</h3>
            <p className="text-[12px] text-muted">Hourly sales, labour cost, payment mix, discounts and more.</p>
          </div>
          <a href="/api/reports/advanced" target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            <Download size={14} /> Download JSON
          </a>
        </div>
      </Screen>
    </div>
  );
}

function Tile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  const bg = accent ? "var(--olive)" : "var(--panel-2)";
  const fg = accent ? "#fff" : "var(--ink)";
  const iconColor = accent ? "rgba(255,255,255,.85)" : "var(--olive)";
  return (
    <div className="rounded-xl p-4" style={{ background: bg, border: accent ? "none" : "1px solid var(--line)" }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: iconColor }}>
        {icon}
        <span className="text-[11px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="mono text-[18px] font-semibold leading-none" style={{ color: fg }}>{value}</div>
    </div>
  );
}
