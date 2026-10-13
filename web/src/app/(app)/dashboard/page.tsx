"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp, ShoppingBag, ChefHat, Grid3x3, AlertTriangle, RotateCcw,
  Banknote, CreditCard, Globe, LayoutDashboard,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, Screen } from "@/components/ui";

interface Method { gross: number; fee: number; net: number }
interface Branch { id: number; name: string; revenueToday: number; openTables: number; inKitchen: number; lowStockCount: number }
interface Totals {
  totalRevenue: number; totalOrders: number; totalKitchen: number; totalOpenTables: number;
  totalLowStock: number; totalRefunds: number; byMethod: Record<string, Method>;
}
interface Summary { branches: Branch[]; totals: Totals }
interface Report { trend: number[]; orderCount: number; voidedCount: number; refundCount: number }

export default function DashboardPage() {
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [sum, setSum] = useState<Summary | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    apiGet<Summary>("/dashboard/summary").then(setSum).catch(() => {});
    apiGet<Report>("/reports/summary").then(setReport).catch(() => {});
  }, []);

  if (!sum) return <Screen><PageLoader label="Loading dashboard" /></Screen>;

  const t = sum.totals;
  const maxTrend = report ? Math.max(1, ...report.trend) : 1;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Dashboard" subtitle="Today across the house" icon={LayoutDashboard} />

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile icon={<TrendingUp size={16} />}    label="Revenue"      value={money(t.totalRevenue, currency)} accent />
          <Tile icon={<ShoppingBag size={16} />}   label="Orders"       value={String(t.totalOrders)} />
          <Tile icon={<ChefHat size={16} />}       label="In kitchen"   value={String(t.totalKitchen)} />
          <Tile icon={<Grid3x3 size={16} />}       label="Open tables"  value={String(t.totalOpenTables)} />
          <Tile icon={<AlertTriangle size={16} />} label="Low stock"    value={String(t.totalLowStock)} warn={t.totalLowStock > 0} />
          <Tile icon={<RotateCcw size={16} />}     label="Refunds"      value={money(t.totalRefunds, currency)} />
        </div>
      </Screen>

      <div className="grid lg:grid-cols-2 gap-3">
        {/* Payment method breakdown */}
        <Screen>
          <div className="eyebrow mb-4">Today by payment method</div>
          <div className="space-y-4">
            {([
              ["cash",   <Banknote key="c" size={15} />],
              ["card",   <CreditCard key="k" size={15} />],
              ["online", <Globe key="o" size={15} />],
            ] as const).map(([m, icon]) => {
              const d = t.byMethod[m] || { gross: 0, net: 0, fee: 0 };
              const pct = t.totalRevenue > 0 ? Math.round((d.gross / t.totalRevenue) * 100) : 0;
              return (
                <div key={m}>
                  <div className="flex justify-between items-center text-sm mb-1.5">
                    <span className="flex items-center gap-2 capitalize text-ink font-medium">
                      <span style={{ color: "var(--olive)" }}>{icon}</span> {m}
                    </span>
                    <span className="mono font-semibold text-ink">{money(d.gross, currency)}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--panel-2)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: "var(--olive)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Screen>

        {/* 7-day trend */}
        <Screen>
          <div className="eyebrow mb-4">Revenue — last 7 days</div>
          {report ? (
            <div className="flex items-end gap-2 h-40">
              {report.trend.map((v, i) => {
                const isToday = i === report.trend.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5 justify-end h-full">
                    <div
                      className="w-full rounded-t-md transition-all"
                      style={{
                        height: `${Math.max(3, (v / maxTrend) * 100)}%`,
                        background: isToday ? "var(--olive)" : "color-mix(in srgb, var(--olive) 35%, transparent)",
                      }}
                    />
                    <span className="text-[10px] text-muted font-medium">
                      {["6d", "5d", "4d", "3d", "2d", "1d", "Today"][i]}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted">No data yet.</div>
          )}
        </Screen>
      </div>

      {sum.branches.length > 1 && (
        <Screen>
          <div className="eyebrow mb-4">Branches</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-2.5">Branch</th>
                  <th>Revenue</th>
                  <th>In kitchen</th>
                  <th>Open tables</th>
                  <th>Low stock</th>
                </tr>
              </thead>
              <tbody>
                {sum.branches.map((b) => (
                  <tr key={b.id} className="border-t border-line-soft">
                    <td className="py-3 font-medium text-ink">{b.name}</td>
                    <td className="mono">{money(b.revenueToday, currency)}</td>
                    <td className="mono">{b.inKitchen}</td>
                    <td className="mono">{b.openTables}</td>
                    <td className="mono">
                      {b.lowStockCount > 0 ? (
                        <span className="pill pill-warn">{b.lowStockCount}</span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Screen>
      )}
    </div>
  );
}

function Tile({
  icon, label, value, accent, warn,
}: {
  icon: React.ReactNode; label: string; value: string; accent?: boolean; warn?: boolean;
}) {
  const bg = accent ? "var(--olive)" : warn ? "var(--warn-wash)" : "var(--panel-2)";
  const fg = accent ? "#fff" : warn ? "var(--warn)" : "var(--ink)";
  const iconColor = accent ? "rgba(255,255,255,.85)" : warn ? "var(--warn)" : "var(--olive)";
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: bg, border: accent ? "none" : "1px solid var(--line)" }}
    >
      <div className="flex items-center gap-2 mb-2" style={{ color: iconColor }}>
        {icon}
        <span className="text-[11px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="mono text-[20px] font-semibold leading-none" style={{ color: fg }}>{value}</div>
    </div>
  );
}
