"use client";

import { useEffect, useState } from "react";
import { Save, Star, Gift, Tag, CalendarCheck, Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { apiGet, apiPut, apiPost } from "@/lib/api";
import { PageHeader, PageLoader, Screen, useToast } from "@/components/ui";
import { fetchSettings, type HomeBanner } from "@/lib/settings";

interface Settings {
  businessName: string;
  businessTagline: string;
  businessAddress: string;
  businessPhone: string;
  businessEmail: string;
  currencySymbol: string;
  serviceChargeRate: number;
  vatRate: number;
  cardFeePercent: number;
  receiptFooterText: string;
  enabledAddons: string[];
  homeBanners?: HomeBanner[];
}

const ADDONS = [
  { key: "loyalty",      label: "Loyalty points", icon: Star },
  { key: "giftcards",    label: "Gift cards",     icon: Gift },
  { key: "promotions",   label: "Promotions",     icon: Tag },
  { key: "reservations", label: "Reservations",   icon: CalendarCheck },
];

export default function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<Settings>("/settings")
      .then((data) => setS({ ...data, homeBanners: data.homeBanners || [] }))
      .catch(() => toast.push("bad", "Admin access required"));
    // eslint-disable-next-line
  }, []);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((p) => (p ? { ...p, [k]: v } : p));
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      await apiPut("/settings", {
        businessName: s.businessName,
        businessTagline: s.businessTagline,
        businessAddress: s.businessAddress,
        businessPhone: s.businessPhone,
        businessEmail: s.businessEmail,
        currencySymbol: s.currencySymbol,
        serviceChargeRate: Number(s.serviceChargeRate) || 0,
        vatRate: Number(s.vatRate) || 0,
        cardFeePercent: Number(s.cardFeePercent) || 0,
        receiptFooterText: s.receiptFooterText,
        homeBanners: s.homeBanners || [],
      });
      await savedAndRefresh();
      toast.push("ok", "Settings saved");
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAddon(key: string, enabled: boolean) {
    try {
      const r = await apiPost<{ enabledAddons: string[] }>("/admin/addons", { addon: key, enabled });
      set("enabledAddons", r.enabledAddons);
      // Refresh the global settings cache so the Sidebar reacts instantly.
      await fetchSettings(true);
      toast.push("ok", `${key} ${enabled ? "enabled" : "disabled"}`);
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Failed");
    }
  }

  async function savedAndRefresh() {
    await fetchSettings(true);
  }

  function addBanner() {
    const next: HomeBanner = { title: "New promo", body: "", color: "" };
    set("homeBanners", [...(s?.homeBanners || []), next]);
  }
  function updateBanner(idx: number, patch: Partial<HomeBanner>) {
    const list = [...(s?.homeBanners || [])];
    list[idx] = { ...list[idx], ...patch };
    set("homeBanners", list);
  }
  function removeBanner(idx: number) {
    set("homeBanners", (s?.homeBanners || []).filter((_, i) => i !== idx));
  }

  const pct = (v: number) => (v <= 1 ? Math.round(v * 1000) / 10 : v);
  const toFrac = (v: string) => { const n = Number(v) || 0; return n > 1 ? n / 100 : n; };

  if (!s) return <PageLoader label="Loading settings" />;

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <Screen>
        <PageHeader title="Settings" subtitle="Business identity, taxes and modules">
          <button onClick={save} disabled={saving} className="btn btn-primary btn-sm">
            <Save size={14} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </PageHeader>

        <div className="eyebrow mb-4">Business</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name"            value={s.businessName}      onChange={(v) => set("businessName", v)} />
          <Field label="Tagline"         value={s.businessTagline}   onChange={(v) => set("businessTagline", v)} />
          <Field label="Address"         value={s.businessAddress}   onChange={(v) => set("businessAddress", v)} />
          <Field label="Phone"           value={s.businessPhone}     onChange={(v) => set("businessPhone", v)} />
          <Field label="Email"           value={s.businessEmail}     onChange={(v) => set("businessEmail", v)} />
          <Field label="Currency symbol" value={s.currencySymbol}    onChange={(v) => set("currencySymbol", v)} />
        </div>
      </Screen>

      <Screen>
        <div className="eyebrow mb-4">Charges &amp; tax</div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Service charge %" mono value={String(pct(s.serviceChargeRate))}
            onChange={(v) => set("serviceChargeRate", toFrac(v) as unknown as number)} />
          <Field label="VAT %" mono value={String(pct(s.vatRate))}
            onChange={(v) => set("vatRate", toFrac(v) as unknown as number)} />
          <Field label="Card fee %" mono value={String(pct(s.cardFeePercent))}
            onChange={(v) => set("cardFeePercent", toFrac(v) as unknown as number)} />
        </div>
        <div className="mt-3">
          <Field label="Receipt footer" value={s.receiptFooterText} onChange={(v) => set("receiptFooterText", v)} />
        </div>
      </Screen>

      <Screen>
        <div className="flex items-center justify-between mb-4">
          <div className="eyebrow flex items-center gap-2">
            <ImageIcon size={14} /> Home banners
          </div>
          <button onClick={addBanner} className="btn btn-ghost btn-sm">
            <Plus size={13} /> Add banner
          </button>
        </div>

        {!(s.homeBanners || []).length ? (
          <p className="text-sm text-muted">No banners yet. Add one to show a rotating promo at the top of the home page.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {(s.homeBanners || []).map((b, i) => (
              <div key={i} className="rounded-xl p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
                <div className="flex items-start gap-3">
                  {/* preview swatch */}
                  <div
                    className="size-10 shrink-0 rounded-lg"
                    style={{
                      background: `linear-gradient(135deg, ${b.color || "var(--olive)"}, color-mix(in srgb, ${b.color || "var(--olive)"} 60%, black))`,
                    }}
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      className="inp"
                      placeholder="Title (e.g. “Fresh Lobster Day”)"
                      value={b.title}
                      onChange={(e) => updateBanner(i, { title: e.target.value })}
                    />
                    <input
                      className="inp"
                      placeholder="Body text"
                      value={b.body}
                      onChange={(e) => updateBanner(i, { body: e.target.value })}
                    />
                    <div className="grid sm:grid-cols-3 gap-2">
                      <div className="relative">
                        <input
                          type="color"
                          className="inp !p-1 h-10 w-full cursor-pointer"
                          value={b.color || "#f6990d"}
                          onChange={(e) => updateBanner(i, { color: e.target.value })}
                          title="Accent colour"
                        />
                      </div>
                      <input
                        className="inp"
                        placeholder="Button text (optional)"
                        value={b.ctaLabel || ""}
                        onChange={(e) => updateBanner(i, { ctaLabel: e.target.value })}
                      />
                      <input
                        className="inp"
                        placeholder="Button link (e.g. /order)"
                        value={b.ctaHref || ""}
                        onChange={(e) => updateBanner(i, { ctaHref: e.target.value })}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => removeBanner(i)}
                    className="btn btn-ghost btn-sm !px-2"
                    title="Remove banner"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Screen>

      <Screen>
        <div className="eyebrow mb-4">Add-on modules</div>
        <p className="text-sm text-muted mb-3">
          Switch these on to show them in the sidebar.
        </p>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {ADDONS.map((a) => {
            const on = (s.enabledAddons || []).includes(a.key);
            const Icon = a.icon;
            return (
              <button
                key={a.key}
                onClick={() => toggleAddon(a.key, !on)}
                className="flex items-center justify-between rounded-xl px-4 py-3 border transition-colors"
                style={on
                  ? { background: "var(--olive-wash)", borderColor: "var(--olive)" }
                  : { background: "var(--panel)", borderColor: "var(--line)" }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium">
                  <Icon size={16} style={{ color: on ? "var(--olive)" : "var(--muted)" }} />
                  {a.label}
                </span>
                <span
                  className="w-10 h-6 rounded-full relative transition-colors"
                  style={{ background: on ? "var(--olive)" : "var(--line)" }}
                >
                  <span
                    className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                    style={{ left: on ? 18 : 2 }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </Screen>
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
