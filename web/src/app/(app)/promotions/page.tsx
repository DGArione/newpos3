"use client";

import { useEffect, useState } from "react";
import { Tag, Plus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { MenuItem } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

interface Promo { id: number; name: string; type: string; rewardKind: string; rewardValue: number; scope: string; active: boolean | number; }

export default function PromotionsPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<Promo[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => apiGet<Promo[]>("/promotions").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); apiGet<MenuItem[]>("/menu").then((d) => setMenu(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  const reward = (p: Promo) => p.rewardKind === "percent" ? `${p.rewardValue}% off` : `${currency}${p.rewardValue} off`;

  return (
    <div>
      <PageHeader title="Promotions" subtitle={`${list.length} offers`}>
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><Plus size={15} /> New promotion</button>
      </PageHeader>

      {loading ? <PageLoader /> : !list.length ? <EmptyState title="No promotions" hint="Create a “buy N, get a discount” offer." icon={<Tag size={30} />} /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((p) => (
            <div key={p.id} className="gb-card p-4">
              <div className="flex justify-between items-start">
                <div className="font-head text-lg">{p.name}</div>
                <span className={`pill ${p.active ? "pill-ok" : "pill-bad"}`}>{p.active ? "Active" : "Off"}</span>
              </div>
              <div className="text-sm text-muted mt-1 capitalize">{p.type.replace("_", " ")} · {p.scope}</div>
              <div className="mt-2"><span className="pill pill-clay">{reward(p)}</span></div>
            </div>
          ))}
        </div>
      )}

      {open && <PromoModal menu={menu} currency={currency} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "Promotion created"); }} />}
    </div>
  );
}

function PromoModal({ menu, currency, onClose, onDone }: { menu: MenuItem[]; currency: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [menuItemId, setItem] = useState<string>(menu[0]?.id ? String(menu[0].id) : "");
  const [qty, setQty] = useState("1");
  const [rewardKind, setKind] = useState<"percent" | "amount">("percent");
  const [rewardValue, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (!name.trim() || !menuItemId || !Number(rewardValue)) { setErr("Fill name, item and reward"); return; }
    setBusy(true); setErr("");
    try {
      await apiPost("/promotions", {
        name, type: "buy_n", conditions: [{ menuItemId: Number(menuItemId), qty: Number(qty) || 1 }],
        rewardKind, rewardValue: Number(rewardValue), scope: "items", active: true,
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <Modal open title="New promotion" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label><input className="inp" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Pizza Tuesday" /></div>
        <div className="grid grid-cols-[1fr_80px] gap-3">
          <div><label className="lbl">When buying</label>
            <select className="inp" value={menuItemId} onChange={(e) => setItem(e.target.value)}>
              {menu.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div><label className="lbl">Qty</label><input className="inp mono" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Reward</label>
            <select className="inp" value={rewardKind} onChange={(e) => setKind(e.target.value as "percent" | "amount")}>
              <option value="percent">Percent %</option><option value="amount">Amount ({currency.trim()})</option>
            </select>
          </div>
          <div><label className="lbl">Value</label><input className="inp mono" inputMode="decimal" value={rewardValue} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} /></div>
        </div>
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">Create promotion</button>
      </div>
    </Modal>
  );
}
