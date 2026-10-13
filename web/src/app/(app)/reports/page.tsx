"use client";

import { useEffect, useState } from "react";
import { TrendingUp, ShoppingBag, Ban, RotateCcw } from "lucide-react";
import { apiGet } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState } from "@/components/ui";

interface Report { revenue: number; orderCount: number; trend: number[]; voidedCount: number; voidedTotal: number; refunds: number; refundCount: number; }
interface ItemRow { name?: string; itemName?: string; qty?: number; quantity?: number; revenue?: number; total?: number; }
interface Analytics { items: ItemRow[]; from: string; to: string; totalOrders: number; }

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

  return (
    <div>
      <PageHeader title="Reports" subtitle="Sales performance and best sellers.">
        <div className="flex gap-1.5">
          {RANGES.map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)} className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold border transition-colors"
              style={range === k ? { background: "var(--olive)", color: "#ffffff", borderColor: "var(--olive)" } : { background: "var(--panel)", color: "var(--muted)", borderColor: "var(--line)" }}>{label}</button>
          ))}
        </div>
      </PageHeader>

      {loading || !rep ? <PageLoader /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Tile icon={<TrendingUp size={18} />} label="Revenue" value={money(rep.revenue, currency)} accent />
            <Tile icon={<ShoppingBag size={18} />} label="Orders" value={String(rep.orderCount)} />
            <Tile icon={<Ban size={18} />} label="Voided" value={`${rep.voidedCount} · ${money(rep.voidedTotal, currency)}`} />
            <Tile icon={<RotateCcw size={18} />} label="Refunds" value={`${rep.refundCount} · ${money(rep.refunds, currency)}`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <div className="gb-card p-5">
              <div className="eyebrow mb-4">Revenue trend (7 days)</div>
              <div className="flex items-end gap-2 h-44">
                {rep.trend.map((v, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5 justify-end h-full">
                    <div className="text-[10px] text-muted mono">{v > 0 ? Math.round(v) : ""}</div>
                    <div className="w-full rounded-t-md" style={{ height: `${Math.max(3, (v / maxTrend) * 100)}%`, background: i === rep.trend.length - 1 ? "var(--clay)" : "var(--olive-300)" }} />
                    <span className="text-[10px] text-muted">{["6d", "5d", "4d", "3d", "2d", "1d", "Now"][i]}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="gb-card p-5">
              <div className="eyebrow mb-4">Top sellers</div>
              {!topItems.length ? <EmptyState title="No sales in range" /> : (
                <div className="space-y-2.5">
                  {topItems.map((it, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-head font-semibold shrink-0" style={{ background: "var(--olive-wash)", color: "var(--olive-700)" }}>{i + 1}</span>
                      <span className="text-sm text-ink flex-1 truncate">{it.name}</span>
                      <span className="text-[12px] text-muted mono">×{it.qty}</span>
                      <span className="text-[13px] font-semibold mono text-clay w-24 text-right">{money(it.revenue, currency)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="gb-card p-4" style={accent ? { background: "linear-gradient(135deg, var(--olive-700), var(--olive))", borderColor: "transparent" } : {}}>
      <div className="flex items-center gap-2 mb-2" style={{ color: accent ? "rgba(255,255,255,0.85)" : "var(--olive)" }}>{icon}<span className="text-[11px] uppercase tracking-wider font-semibold">{label}</span></div>
      <div className="font-head text-xl mono" style={{ color: accent ? "#ffffff" : "var(--ink)" }}>{value}</div>
    </div>
  );
}
