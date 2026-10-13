"use client";

import { useEffect, useState } from "react";
import { Star, TrendingUp, Gift } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState } from "@/components/ui";

interface TopCust { name?: string; customerName?: string; phone?: string; loyaltyPoints?: number; points?: number; }
interface LoyaltyReport { top: TopCust[]; issued: number; redeemed: number; recent: unknown[]; settings: { loyaltyEarnPoints: number; loyaltyEarnPer: number; loyaltyRedeemValue: number; loyaltyMinRedeem: number }; }

export default function LoyaltyPage() {
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [r, setR] = useState<LoyaltyReport | null>(null);
  useEffect(() => { apiGet<LoyaltyReport>("/loyalty/report").then(setR).catch(() => {}); }, []);
  if (!r) return <PageLoader label="Loading loyalty" />;

  return (
    <div>
      <PageHeader title="Loyalty" subtitle={`Earn ${r.settings.loyaltyEarnPoints} pt per ${currency}${r.settings.loyaltyEarnPer} · ${currency}${r.settings.loyaltyRedeemValue} per point redeemed`} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <Tile icon={<Star size={18} />} label="Points issued" value={String(r.issued)} accent />
        <Tile icon={<Gift size={18} />} label="Points redeemed" value={String(r.redeemed)} />
        <Tile icon={<TrendingUp size={18} />} label="Members" value={String(r.top.length)} />
      </div>

      <div className="gb-card p-5">
        <div className="eyebrow mb-4">Top members</div>
        {!r.top.length ? <EmptyState title="No members yet" hint="Points accrue as customers are attached to paid orders." /> : (
          <div className="space-y-2">
            {r.top.map((c, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-head font-semibold" style={{ background: "var(--olive-wash)", color: "var(--olive-700)" }}>{i + 1}</span>
                <span className="flex-1 text-sm">{c.name || c.customerName || c.phone || "Guest"}</span>
                <span className="pill pill-clay">{c.loyaltyPoints ?? c.points ?? 0} pts</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="gb-card p-4" style={accent ? { background: "linear-gradient(135deg, var(--olive-700), var(--olive))", borderColor: "transparent" } : {}}>
      <div className="flex items-center gap-2 mb-2" style={{ color: accent ? "rgba(255,255,255,0.85)" : "var(--olive)" }}>{icon}<span className="text-[11px] uppercase tracking-wider font-semibold">{label}</span></div>
      <div className="font-head text-2xl mono" style={{ color: accent ? "#ffffff" : "var(--ink)" }}>{value}</div>
    </div>
  );
}
