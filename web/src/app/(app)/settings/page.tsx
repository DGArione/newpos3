"use client";

import { useEffect, useState } from "react";
import { Save, Star, Gift, Tag, CalendarCheck } from "lucide-react";
import { apiGet, apiPut, apiPost } from "@/lib/api";
import { PageHeader, PageLoader, useToast } from "@/components/ui";

interface Settings {
  businessName: string; businessTagline: string; businessAddress: string; businessPhone: string; businessEmail: string;
  currencySymbol: string; serviceChargeRate: number; vatRate: number; cardFeePercent: number;
  receiptFooterText: string; enabledAddons: string[];
}

const ADDONS = [
  { key: "loyalty", label: "Loyalty points", icon: Star },
  { key: "giftcards", label: "Gift cards", icon: Gift },
  { key: "promotions", label: "Promotions", icon: Tag },
  { key: "reservations", label: "Reservations", icon: CalendarCheck },
];

export default function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { apiGet<Settings>("/settings").then(setS).catch(() => toast.push("bad", "Admin access required")); /* eslint-disable-next-line */ }, []);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) { setS((p) => (p ? { ...p, [k]: v } : p)); }

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      await apiPut("/settings", {
        businessName: s.businessName, businessTagline: s.businessTagline, businessAddress: s.businessAddress,
        businessPhone: s.businessPhone, businessEmail: s.businessEmail, currencySymbol: s.currencySymbol,
        serviceChargeRate: Number(s.serviceChargeRate) || 0, vatRate: Number(s.vatRate) || 0,
        cardFeePercent: Number(s.cardFeePercent) || 0, receiptFooterText: s.receiptFooterText,
      });
      toast.push("ok", "Settings saved");
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Save failed"); } finally { setSaving(false); }
  }

  async function toggleAddon(key: string, enabled: boolean) {
    try { const r = await apiPost<{ enabledAddons: string[] }>("/admin/addons", { addon: key, enabled }); set("enabledAddons", r.enabledAddons); toast.push("ok", `${key} ${enabled ? "enabled" : "disabled"}`); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  if (!s) return <PageLoader label="Loading settings" />;

  const pct = (v: number) => (v <= 1 ? Math.round(v * 1000) / 10 : v); // show fraction as %
  const toFrac = (v: string) => { const n = Number(v) || 0; return n > 1 ? n / 100 : n; };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Business identity, taxes and modules.">
        <button onClick={save} disabled={saving} className="btn btn-primary btn-sm"><Save size={15} /> Save changes</button>
      </PageHeader>

      <div className="gb-card p-5 mb-4">
        <div className="eyebrow mb-4">Business</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name" value={s.businessName} onChange={(v) => set("businessName", v)} />
          <Field label="Tagline" value={s.businessTagline} onChange={(v) => set("businessTagline", v)} />
          <Field label="Address" value={s.businessAddress} onChange={(v) => set("businessAddress", v)} />
          <Field label="Phone" value={s.businessPhone} onChange={(v) => set("businessPhone", v)} />
          <Field label="Email" value={s.businessEmail} onChange={(v) => set("businessEmail", v)} />
          <Field label="Currency symbol" value={s.currencySymbol} onChange={(v) => set("currencySymbol", v)} />
        </div>
      </div>

      <div className="gb-card p-5 mb-4">
        <div className="eyebrow mb-4">Charges &amp; tax</div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Service charge %" mono value={String(pct(s.serviceChargeRate))} onChange={(v) => set("serviceChargeRate", toFrac(v) as unknown as number)} />
          <Field label="VAT %" mono value={String(pct(s.vatRate))} onChange={(v) => set("vatRate", toFrac(v) as unknown as number)} />
          <Field label="Card fee %" mono value={String(pct(s.cardFeePercent))} onChange={(v) => set("cardFeePercent", toFrac(v) as unknown as number)} />
        </div>
        <div className="mt-3"><Field label="Receipt footer" value={s.receiptFooterText} onChange={(v) => set("receiptFooterText", v)} /></div>
      </div>

      <div className="gb-card p-5">
        <div className="eyebrow mb-4">Modules</div>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {ADDONS.map((a) => {
            const on = (s.enabledAddons || []).includes(a.key);
            const Icon = a.icon;
            return (
              <button key={a.key} onClick={() => toggleAddon(a.key, !on)}
                className="flex items-center justify-between rounded-md px-4 py-3 border transition-colors"
                style={on ? { background: "var(--olive-wash)", borderColor: "var(--olive)" } : { background: "var(--panel)", borderColor: "var(--line)" }}>
                <span className="flex items-center gap-2.5 text-sm font-medium"><Icon size={17} /> {a.label}</span>
                <span className="w-10 h-6 rounded-full relative transition-colors" style={{ background: on ? "var(--olive)" : "var(--line)" }}>
                  <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: on ? 18 : 2 }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div>
      <label className="lbl">{label}</label>
      <input className={`inp ${mono ? "mono" : ""}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
