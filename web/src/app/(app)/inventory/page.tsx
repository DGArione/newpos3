"use client";

import { useEffect, useState } from "react";
import { Plus, Minus, Boxes, AlertTriangle, PackagePlus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

interface Ingredient { id: number; name: string; unit: string; qty: number; unitCost: number; lowStockThreshold: number; }

export default function InventoryPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => apiGet<Ingredient[]>("/inventory").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  async function adjust(it: Ingredient, delta: number) {
    try { const u = await apiPost<Ingredient>(`/inventory/${it.id}/adjust`, { delta }); setList((p) => p.map((x) => (x.id === u.id ? u : x))); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const lowCount = list.filter((i) => i.lowStockThreshold > 0 && i.qty <= i.lowStockThreshold).length;

  return (
    <div>
      <PageHeader title="Inventory" subtitle={`${list.length} ingredients${lowCount ? ` · ${lowCount} low` : ""}`}>
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><PackagePlus size={15} /> Add item</button>
      </PageHeader>

      {loading ? <PageLoader /> : !list.length ? <EmptyState title="No ingredients" hint="Add stock items to track levels." icon={<Boxes size={30} />} /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((it) => {
            const low = it.lowStockThreshold > 0 && it.qty <= it.lowStockThreshold;
            return (
              <div key={it.id} className="gb-card p-4" style={low ? { borderColor: "var(--warn)" } : {}}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-head text-[15px] text-ink">{it.name}</div>
                    <div className="text-[12px] text-muted">{it.unitCost > 0 ? money(it.unitCost, currency) + " / " + it.unit : it.unit}</div>
                  </div>
                  {low && <span className="pill pill-warn"><AlertTriangle size={12} /> Low</span>}
                </div>
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => adjust(it, -1)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--panel-2)" }}><Minus size={15} /></button>
                    <span className="mono font-head text-lg w-16 text-center">{it.qty} <span className="text-[11px] text-muted">{it.unit}</span></span>
                    <button onClick={() => adjust(it, 1)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--panel-2)" }}><Plus size={15} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && <AddItem currency={currency} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "Item added"); }} />}
    </div>
  );
}

function AddItem({ currency, onClose, onDone }: { currency: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", unit: "pcs", qty: "", unitCost: "", lowStockThreshold: "" });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name.trim()) return;
    setBusy(true);
    try { await apiPost("/inventory", { name: f.name, unit: f.unit, qty: Number(f.qty) || 0, unitCost: Number(f.unitCost) || 0, lowStockThreshold: Number(f.lowStockThreshold) || 0 }); onDone(); }
    catch { setBusy(false); }
  }
  return (
    <Modal open title="Add ingredient" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label><input className="inp" value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Unit</label><input className="inp" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
          <div><label className="lbl">Quantity</label><input className="inp mono" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></div>
          <div><label className="lbl">Cost / unit ({currency.trim()})</label><input className="inp mono" inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></div>
          <div><label className="lbl">Low-stock at</label><input className="inp mono" inputMode="decimal" value={f.lowStockThreshold} onChange={(e) => setF({ ...f, lowStockThreshold: e.target.value })} /></div>
        </div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">Add ingredient</button>
      </div>
    </Modal>
  );
}
