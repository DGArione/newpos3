"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Phone, MapPin, Contact } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

interface Customer { id: number; phone: string; name: string; address: string; loyaltyPoints?: number; }

export default function CustomersPage() {
  const toast = useToast();
  const [list, setList] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const load = () => apiGet<Customer[]>("/customers").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter((c) => (c.name || "").toLowerCase().includes(s) || (c.phone || "").includes(s));
  }, [list, q]);

  return (
    <div>
      <PageHeader title="Customers" subtitle={`${list.length} saved`}>
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><Plus size={15} /> Add customer</button>
      </PageHeader>

      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="inp pl-9" placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? <PageLoader /> : !shown.length ? <EmptyState title="No customers yet" hint="Add one, or they'll be saved automatically from delivery orders." icon={<Contact size={30} />} /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {shown.map((c) => (
            <div key={c.id} className="gb-card p-4">
              <div className="font-head text-lg text-ink">{c.name || "Guest"}</div>
              <div className="text-sm text-muted flex items-center gap-1.5 mt-1"><Phone size={13} />{c.phone}</div>
              {c.address && <div className="text-sm text-muted flex items-start gap-1.5 mt-1"><MapPin size={13} className="mt-0.5" />{c.address}</div>}
              {typeof c.loyaltyPoints === "number" && c.loyaltyPoints > 0 && <span className="pill pill-clay mt-2">{c.loyaltyPoints} pts</span>}
            </div>
          ))}
        </div>
      )}

      {open && <AddCustomer onClose={() => setOpen(false)} onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "Customer saved"); }} />}
    </div>
  );
}

function AddCustomer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ phone: "", name: "", address: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (!f.phone.trim()) { setErr("Phone is required"); return; }
    setBusy(true); setErr("");
    try { await apiPost("/customers", f); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Add customer" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="lbl">Phone</label><input className="inp" value={f.phone} autoFocus onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div><label className="lbl">Name</label><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="lbl">Address</label><input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">Save customer</button>
      </div>
    </Modal>
  );
}
