"use client";

import { useEffect, useState } from "react";
import { Store, Plus, Trash2, Pencil, MapPin, Phone } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface Branch {
  id: number;
  name: string;
  address: string;
  phone: string;
  status: "active" | "disabled";
}

export default function BranchesPage() {
  const toast = useToast();
  const { user, selectBranch, branchId } = useAuth();
  const [list, setList] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Branch | null>(null);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    apiGet<Branch[]>("/branches").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  async function remove(b: Branch) {
    if (!confirm(`Delete branch "${b.name}"? This cannot be undone.`)) return;
    try { await apiDelete(`/branches/${b.id}`); setList((p) => p.filter((x) => x.id !== b.id)); toast.push("ok", "Deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const canManage = user?.role === "superManager";

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Branches" subtitle={`${list.length} branches`} icon={Store}>
          {canManage && (
            <button onClick={() => { setEdit(null); setOpen(true); }} className="btn btn-primary btn-sm">
              <Plus size={14} /> New branch
            </button>
          )}
        </PageHeader>

        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState title="No branches" hint={canManage ? "Add one above to get started." : "Ask your super manager."} icon={<Store size={30} />} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((b) => {
              const active = b.id === branchId;
              return (
                <div
                  key={b.id}
                  className="rounded-xl p-4"
                  style={{
                    background: active ? "var(--olive-wash)" : "var(--panel-2)",
                    border: active ? "1.5px solid var(--olive)" : "1px solid var(--line)",
                  }}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-[15px] text-ink truncate">{b.name}</h3>
                        {active && <span className="pill pill-olive">Current</span>}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => { setEdit(b); setOpen(true); }} className="btn btn-ghost btn-sm !px-2" title="Edit">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => remove(b)} className="btn btn-ghost btn-sm !px-2" title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  {b.address && (
                    <div className="text-[12px] text-muted flex items-start gap-1 mb-1">
                      <MapPin size={12} className="mt-0.5 shrink-0" /> <span>{b.address}</span>
                    </div>
                  )}
                  {b.phone && (
                    <div className="text-[12px] text-muted flex items-center gap-1 mb-3">
                      <Phone size={12} /> {b.phone}
                    </div>
                  )}
                  {canManage && !active && (
                    <button onClick={() => selectBranch(b.id)} className="btn btn-soft btn-sm w-full">
                      Switch to this branch
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Screen>

      {open && (
        <BranchEditor
          existing={edit}
          onClose={() => { setOpen(false); setEdit(null); }}
          onDone={() => { setOpen(false); setEdit(null); load(); toast.push("ok", "Saved"); }}
        />
      )}
    </div>
  );
}

function BranchEditor({ existing, onClose, onDone }: { existing: Branch | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: existing?.name || "",
    address: existing?.address || "",
    phone: existing?.phone || "",
    status: (existing?.status || "active") as "active" | "disabled",
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name.trim()) { toast.push("bad", "Name required"); return; }
    setBusy(true);
    try {
      if (existing) await apiPatch(`/branches/${existing.id}`, f);
      else await apiPost("/branches", f);
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={existing ? "Edit branch" : "New branch"} onClose={onClose} width={440}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="lbl">Address</label>
          <input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div><label className="lbl">Phone</label>
          <input className="inp" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : existing ? "Save changes" : "Create branch"}
        </button>
      </div>
    </Modal>
  );
}
