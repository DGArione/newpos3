"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp, ShoppingBag, ChefHat, Grid3x3, AlertTriangle, RotateCcw,
  Banknote, CreditCard, Globe, LayoutDashboard, Clock, Users as UsersIcon,
  Star, Gift, Tag, CalendarCheck, Flame, Store,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, Screen } from "@/components/ui";
import { Banners } from "@/components/Banners";

interface Method { gross: number; fee: number; net: number }
interface Branch { id: number; name: string; revenueToday: number; openTables: number; inKitchen: number; lowStockCount: number }
interface Totals {
  totalRevenue: number; totalOrders: number; totalKitchen: number; totalOpenTables: number;
  totalLowStock: number; totalRefunds: number; byMethod: Record<string, Method>;
}
interface Summary { branches: Branch[]; totals: Totals }
interface Report { trend: number[]; orderCount: number; voidedCount: number; voidedTotal: number; refundCount: number; refunds: number; revenue: number }
interface TopItem { name?: string; itemName?: string; qty?: number; quantity?: number; revenue?: number; total?: number }
interface Analytics { items: TopItem[] }

export default function DashboardPage() {
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [sum, setSum] = useState<Summary | null>(null);
  const [week, setWeek] = useState<Report | null>(null);
  const [month, setMonth] = useState<Report | null>(null);
  const [top, setTop] = useState<Analytics | null>(null);

  useEffect(() => {
    apiGet<Summary>("/dashboard/summary").then(setSum).catch(() => {});
    apiGet<Report>("/reports/summary?range=week").then(setWeek).catch(() => {});
    apiGet<Report>("/reports/summary?range=month").then(setMonth).catch(() => {});
    apiGet<Analytics>("/analytics/items?range=week").then(setTop).catch(() => {});
  }, []);

  if (!sum) return <Screen><PageLoader label="Loading dashboard" /></Screen>;

  const t = sum.totals;
  const maxTrend = week ? Math.max(1, ...week.trend) : 1;
  const topItems = (top?.items || []).map((i) => ({
    name: i.name || i.itemName || "—",
    qty: i.qty ?? i.quantity ?? 0,
    revenue: i.revenue ?? i.total ?? 0,
  })).sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  const payMethods: Array<[keyof Method extends string ? "cash" | "card" | "online" : string, React.ReactNode]> =
    [["cash", <Banknote key="c" size={14} />], ["card", <CreditCard key="k" size={14} />], ["online", <Globe key="o" size={14} />]];

  return (
    <div className="flex flex-col gap-3">
      {/* Promo banners (same as home) */}
      <Banners banners={settings?.homeBanners} />

      <Screen>
        <PageHeader title="Dashboard" subtitle="Today, this week and this month at a glance" icon={LayoutDashboard} />

        {/* Today tiles */}
        <div className="eyebrow mb-3">Today</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          <Tile icon={<TrendingUp size={16} />}    label="Revenue"      value={money(t.totalRevenue, currency)} accent />
          <Tile icon={<ShoppingBag size={16} />}   label="Orders"       value={String(t.totalOrders)} />
          <Tile icon={<ChefHat size={16} />}       label="In kitchen"   value={String(t.totalKitchen)} />
          <Tile icon={<Grid3x3 size={16} />}       label="Open tables"  value={String(t.totalOpenTables)} />
          <Tile icon={<AlertTriangle size={16} />} label="Low stock"    value={String(t.totalLowStock)} warn={t.totalLowStock > 0} />
          <Tile icon={<RotateCcw size={16} />}     label="Refunds"      value={money(t.totalRefunds, currency)} />
        </div>

        {/* Week + Month tiles */}
        {week && month && (
          <>
            <div className="eyebrow mb-3">This week vs. this month</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Tile icon={<TrendingUp size={16} />}  label="Week revenue"  value={money(week.revenue, currency)} />
              <Tile icon={<ShoppingBag size={16} />} label="Week orders"   value={String(week.orderCount)} />
              <Tile icon={<TrendingUp size={16} />}  label="Month revenue" value={money(month.revenue, currency)} accent />
              <Tile icon={<ShoppingBag size={16} />} label="Month orders"  value={String(month.orderCount)} />
            </div>
          </>
        )}
      </Screen>

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Screen>
          <div className="eyebrow mb-4">Today by payment method</div>
          <div className="space-y-4">
            {payMethods.map(([m, icon]) => {
              const d = t.byMethod[m as string] || { gross: 0, net: 0, fee: 0 };
              const pct = t.totalRevenue > 0 ? Math.round((d.gross / t.totalRevenue) * 100) : 0;
              return (
                <div key={m as string}>
                  <div className="flex justify-between items-center text-sm mb-1.5">
                    <span className="flex items-center gap-2 capitalize text-ink font-medium">
                      <span style={{ color: "var(--olive)" }}>{icon}</span> {m as string}
                      <span className="text-[11px] text-muted">{pct}%</span>
                    </span>
                    <span className="mono font-semibold text-ink">{money(d.gross, currency)}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--panel-2)" }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: "var(--olive)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Screen>

        <Screen>
          <div className="eyebrow mb-4">Revenue trend (last 7 days)</div>
          {week ? (
            <div className="flex items-end gap-2 h-40">
              {week.trend.map((v, i) => {
                const isToday = i === week.trend.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5 justify-end h-full">
                    <div className="text-[10px] text-muted mono">{v > 0 ? Math.round(v) : ""}</div>
                    <div className="w-full rounded-t-md transition-all"
                      style={{
                        height: `${Math.max(3, (v / maxTrend) * 100)}%`,
                        background: isToday ? "var(--olive)" : "color-mix(in srgb, var(--olive) 35%, transparent)",
                      }} />
                    <span className="text-[10px] text-muted font-medium">
                      {["6d", "5d", "4d", "3d", "2d", "1d", "Today"][i]}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : <div className="text-sm text-muted">No data yet.</div>}
        </Screen>
      </div>

      {/* Top sellers + branches */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Screen>
          <div className="eyebrow mb-4 flex items-center gap-2">
            <Flame size={13} /> Top sellers (7 days)
          </div>
          {!topItems.length ? (
            <div className="text-sm text-muted py-6">Nothing sold yet in this range.</div>
          ) : (
            <div className="space-y-2.5">
              {topItems.map((it, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{ background: "var(--olive-wash)", color: "var(--olive-700)" }}>{i + 1}</span>
                  <span className="text-sm text-ink flex-1 truncate">{it.name}</span>
                  <span className="text-[12px] text-muted mono">×{it.qty}</span>
                  <span className="text-[13px] font-semibold mono w-24 text-right"
                    style={{ color: "var(--olive-700)" }}>{money(it.revenue, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </Screen>

        <Screen>
          <div className="eyebrow mb-4 flex items-center gap-2">
            <Store size={13} /> Branch snapshot
          </div>
          {sum.branches.length <= 1 ? (
            <div className="text-sm text-muted py-6">Add more branches under Branches to compare them here.</div>
          ) : (
            <div className="space-y-2">
              {sum.branches.map((b) => (
                <div key={b.id} className="flex items-center gap-3 rounded-xl px-3 py-2"
                  style={{ background: "var(--panel-2)" }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-ink font-semibold text-[13.5px] truncate">{b.name}</div>
                    <div className="text-[11.5px] text-muted">
                      {b.openTables} tables · {b.inKitchen} in kitchen
                      {b.lowStockCount > 0 && <> · <span style={{ color: "var(--warn)" }}>{b.lowStockCount} low</span></>}
                    </div>
                  </div>
                  <div className="mono font-semibold text-[13.5px]" style={{ color: "var(--olive-700)" }}>
                    {money(b.revenueToday, currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Screen>
      </div>

      {/* Add-ons quick row */}
      {(settings?.enabledAddons || []).length > 0 && (
        <Screen>
          <div className="eyebrow mb-3">Add-ons</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {settings!.enabledAddons.includes("loyalty")      && <AddonLink icon={<Star size={16} />}      label="Loyalty"      href="/loyalty" />}
            {settings!.enabledAddons.includes("giftcards")    && <AddonLink icon={<Gift size={16} />}      label="Gift Cards"   href="/giftcards" />}
            {settings!.enabledAddons.includes("promotions")   && <AddonLink icon={<Tag size={16} />}       label="Promotions"   href="/promotions" />}
            {settings!.enabledAddons.includes("reservations") && <AddonLink icon={<CalendarCheck size={16} />} label="Reservations" href="/reservations" />}
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
    <div className="rounded-xl p-4" style={{ background: bg, border: accent ? "none" : "1px solid var(--line)" }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: iconColor }}>
        {icon}
        <span className="text-[10.5px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="mono text-[18px] font-semibold leading-none" style={{ color: fg }}>{value}</div>
    </div>
  );
}

function AddonLink({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <a href={href}
      className="flex items-center gap-2.5 rounded-xl px-4 py-3 transition-all hover:shadow-md"
      style={{ background: "var(--olive-wash)", border: "1px solid color-mix(in srgb, var(--olive) 25%, transparent)" }}>
      <span style={{ color: "var(--olive-700)" }}>{icon}</span>
      <span className="font-semibold text-[13px]" style={{ color: "var(--olive-700)" }}>{label}</span>
    </a>
  );
}
