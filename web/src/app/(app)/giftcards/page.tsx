"use client";

import { useEffect, useState } from "react";
import { Gift, Plus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

interface Card { id: number; code: string; initialBalance: number; balance: number; status: string; recipientName: string; createdAt: string; }

export default function GiftCardsPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => apiGet<Card[]>("/giftcards").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Gift cards" subtitle={`${list.length} issued`}>
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><Plus size={15} /> Issue card</button>
      </PageHeader>

      {loading ? <PageLoader /> : !list.length ? <EmptyState title="No gift cards" hint="Issue one to get started." icon={<Gift size={30} />} /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((c) => (
            <div key={c.id} className="gb-card p-5 relative overflow-hidden"
              style={{ background: "linear-gradient(135deg, var(--olive-700), var(--olive))", borderColor: "transparent", color: "#ffffff" }}>
              <Gift size={60} className="absolute -right-2 -bottom-2 opacity-10" />
              <div className="flex justify-between items-start">
                <span className="text-xs tracking-[0.2em] uppercase opacity-80">Gift card</span>
                <span className="pill" style={{ background: c.status === "active" ? "rgba(255,255,255,.2)" : "var(--bad-wash)", color: c.status === "active" ? "#ffffff" : "var(--bad)" }}>{c.status}</span>
              </div>
              <div className="font-head text-2xl mono my-3" style={{ color: "#ffffff" }}>{money(c.balance, currency)}</div>
              <div className="mono text-sm tracking-wider opacity-90">{c.code}</div>
              {c.recipientName && <div className="text-[12px] opacity-75 mt-1">For {c.recipientName}</div>}
            </div>
          ))}
        </div>
      )}

      {open && <IssueModal currency={currency} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "Gift card issued"); }} />}
    </div>
  );
}

function IssueModal({ currency, onClose, onDone }: { currency: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: "", recipientName: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function issue() {
    if (!Number(f.amount)) { setErr("Enter an amount"); return; }
    setBusy(true); setErr("");
    try { await apiPost("/giftcards", { amount: Number(f.amount), recipientName: f.recipientName, note: f.note }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Issue gift card" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="lbl">Amount ({currency.trim()})</label><input className="inp mono" inputMode="decimal" value={f.amount} autoFocus onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} /></div>
        <div><label className="lbl">Recipient (optional)</label><input className="inp" value={f.recipientName} onChange={(e) => setF({ ...f, recipientName: e.target.value })} /></div>
        <div><label className="lbl">Note</label><input className="inp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={issue} disabled={busy} className="btn btn-primary w-full">Issue card</button>
      </div>
    </Modal>
  );
}
