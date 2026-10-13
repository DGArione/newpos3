"use client";

import { useEffect, useState } from "react";
import { Plus, Store, Phone, MapPin, Check } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

interface Branch { id: number; name: string; address: string; phone: string; status: string; }

export default function BranchesPage() {
  const toast = useToast();
  const { user, branchId, selectBranch } = useAuth();
  const [list, setList] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => apiGet<Branch[]>("/branches").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Branches" subtitle={user?.role === "superManager" ? "Pick the branch you're working in." : `${list.length} locations`}>
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><Plus size={15} /> Add branch</button>
      </PageHeader>

      {loading ? <PageLoader /> : !list.length ? <EmptyState title="No branches" icon={<Store size={30} />} /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((b) => {
            const active = branchId === b.id;
            return (
              <div key={b.id} className="gb-card p-5" style={active ? { borderColor: "var(--olive)", boxShadow: "var(--shadow-md)" } : {}}>
                <div className="flex items-start justify-between">
                  <div className="font-head text-lg text-ink">{b.name}</div>
                  {active && <span className="pill pill-ok"><Check size={12} /> Active</span>}
                </div>
                {b.address && <div className="text-sm text-muted flex items-start gap-1.5 mt-1.5"><MapPin size={13} className="mt-0.5" />{b.address}</div>}
                {b.phone && <div className="text-sm text-muted flex items-center gap-1.5 mt-1"><Phone size={13} />{b.phone}</div>}
                {user?.role === "superManager" && !active && (
                  <button onClick={() => { selectBranch(b.id); toast.push("ok", `Switched to ${b.name}`); }} className="btn btn-soft btn-sm mt-3 w-full">Work in this branch</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {open && <AddBranch onClose={() => setOpen(false)} onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "Branch added"); }} />}
    </div>
  );
}

function AddBranch({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", address: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (!f.name.trim()) { setErr("Name required"); return; }
    setBusy(true); setErr("");
    try { await apiPost("/branches", f); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Add branch" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label><input className="inp" value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="lbl">Address</label><input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div><label className="lbl">Phone</label><input className="inp" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">Add branch</button>
      </div>
    </Modal>
  );
}
