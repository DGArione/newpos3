"use client";

import { useEffect, useState } from "react";
import { Plus, ArrowDownLeft, ArrowUpRight, Coins } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

interface Entry { id: number; type: string; amount: number; description: string; staffName: string; createdAt: string; }

export default function PettyCashPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => apiGet<Entry[] | { entries: Entry[] }>("/petty-cash")
    .then((d) => setList(Array.isArray(d) ? d : (d?.entries || [])))
    .catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const balance = list.reduce((s, e) => s + (e.type === "in" ? e.amount : -e.amount), 0);

  return (
    <div>
      <PageHeader title="Petty cash" subtitle="Float movements in and out of the drawer.">
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><Plus size={15} /> New entry</button>
      </PageHeader>

      <div className="gb-card p-5 mb-5 inline-block">
        <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Current balance</div>
        <div className="font-head text-3xl mono" style={{ color: balance >= 0 ? "var(--olive-700)" : "var(--bad)" }}>{money(balance, currency)}</div>
      </div>

      {loading ? <PageLoader /> : !list.length ? <EmptyState title="No entries" hint="Record cash in or out to start the log." icon={<Coins size={30} />} /> : (
        <div className="gb-card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted text-[11px] uppercase tracking-wide" style={{ background: "var(--panel-2)" }}>
              <th className="py-2.5 px-4">Type</th><th>Description</th><th>By</th><th>When</th><th className="text-right pr-4">Amount</th>
            </tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-t border-line-soft">
                  <td className="py-2.5 px-4">{e.type === "in" ? <span className="pill pill-ok"><ArrowDownLeft size={12} /> In</span> : <span className="pill pill-bad"><ArrowUpRight size={12} /> Out</span>}</td>
                  <td>{e.description || "—"}</td>
                  <td className="text-muted">{e.staffName}</td>
                  <td className="text-muted text-[12px]">{(e.createdAt || "").replace("T", " ").slice(0, 16)}</td>
                  <td className="text-right pr-4 mono font-semibold" style={{ color: e.type === "in" ? "var(--ok)" : "var(--bad)" }}>{e.type === "in" ? "+" : "–"}{money(e.amount, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <AddEntry currency={currency} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "Entry recorded"); }} />}
    </div>
  );
}

function AddEntry({ currency, onClose, onDone }: { currency: string; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!Number(amount)) return;
    setBusy(true);
    try { await apiPost("/petty-cash", { type, amount: Number(amount), description }); onDone(); } catch { setBusy(false); }
  }
  return (
    <Modal open title="Petty cash entry" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
          {(["out", "in"] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className="flex-1 py-1.5 rounded-full text-[13px] font-semibold capitalize"
              style={type === t ? { background: "var(--panel)", color: "var(--olive-700)" } : { color: "var(--muted)" }}>Cash {t}</button>
          ))}
        </div>
        <div><label className="lbl">Amount ({currency.trim()})</label><input className="inp mono" inputMode="decimal" value={amount} autoFocus onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} /></div>
        <div><label className="lbl">Description</label><input className="inp" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">Record entry</button>
      </div>
    </Modal>
  );
}
