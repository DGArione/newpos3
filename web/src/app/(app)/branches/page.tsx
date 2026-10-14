"use client";

import { useEffect, useState } from "react";
import {
  Store, Plus, Trash2, Pencil, MapPin, Phone, Image as ImageIcon, X, Wrench,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface Branch {
  id: number;
  name: string;
  address: string;
  phone: string;
  status: "active" | "maintenance" | "disabled";
  imageUrl?: string;
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

  async function setStatus(b: Branch, status: Branch["status"]) {
    try {
      const u = await apiPatch<Branch>(`/branches/${b.id}`, { status });
      setList((p) => p.map((x) => (x.id === u.id ? u : x)));
      toast.push("ok", `${b.name} → ${status}`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
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
          <EmptyState title="No branches" hint={canManage ? "Add one above." : "Ask your super manager."} icon={<Store size={30} />} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((b) => {
              const active = b.id === branchId;
              const inMaintenance = b.status === "maintenance";
              return (
                <div key={b.id} className="rounded-xl overflow-hidden"
                  style={{
                    background: "var(--panel-2)",
                    border: active ? "1.5px solid var(--olive)" : "1px solid var(--line)",
                    opacity: inMaintenance ? 0.75 : 1,
                  }}>
                  {b.imageUrl ? (
                    <div className="h-32 bg-cover bg-center" style={{ backgroundImage: `url(${b.imageUrl})` }} />
                  ) : (
                    <div className="h-32 flex items-center justify-center" style={{ background: "var(--panel)" }}>
                      <Store size={32} style={{ color: "var(--muted)" }} />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-[15px] text-ink truncate">{b.name}</h3>
                          {active && <span className="pill pill-olive">Current</span>}
                          {inMaintenance && <span className="pill pill-warn"><Wrench size={10} /> Maintenance</span>}
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
                    {b.address && <div className="text-[12px] text-muted flex items-start gap-1 mb-1"><MapPin size={12} className="mt-0.5 shrink-0" /><span>{b.address}</span></div>}
                    {b.phone && <div className="text-[12px] text-muted flex items-center gap-1 mb-3"><Phone size={12} /> {b.phone}</div>}

                    <div className="flex gap-2 mt-2">
                      {canManage && b.status !== "maintenance" && (
                        <button onClick={() => setStatus(b, "maintenance")} className="btn btn-ghost btn-sm">
                          <Wrench size={13} /> Maintenance
                        </button>
                      )}
                      {canManage && b.status === "maintenance" && (
                        <button onClick={() => setStatus(b, "active")} className="btn btn-soft btn-sm">
                          Reopen
                        </button>
                      )}
                      {canManage && !active && (
                        <button onClick={() => selectBranch(b.id)} className="btn btn-primary btn-sm ml-auto">
                          Switch
                        </button>
                      )}
                    </div>
                  </div>
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
    status: (existing?.status || "active") as "active" | "maintenance" | "disabled",
    imageUrl: existing?.imageUrl || "",
  });
  const [busy, setBusy] = useState(false);
  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 3_000_000) { toast.push("bad", "Image too large (max 3 MB)"); return; }
    const r = new FileReader();
    r.onload = () => setF((p) => ({ ...p, imageUrl: String(r.result) }));
    r.readAsDataURL(file);
  }
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
    <Modal open title={existing ? "Edit branch" : "New branch"} onClose={onClose} width={460}>
      <div className="space-y-3">
        <div className="flex gap-3 items-start">
          <div className="size-24 rounded-xl overflow-hidden flex items-center justify-center shrink-0"
            style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
            {f.imageUrl ? <img src={f.imageUrl} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={28} className="text-muted" />}
          </div>
          <div className="flex-1 space-y-2">
            <label className="btn btn-ghost btn-sm cursor-pointer">
              <ImageIcon size={13} /> Upload photo
              <input type="file" accept="image/*" className="hidden" onChange={pickImage} />
            </label>
            {f.imageUrl && (
              <button onClick={() => setF({ ...f, imageUrl: "" })} className="btn btn-ghost btn-sm">
                <X size={13} /> Remove
              </button>
            )}
            <div className="text-[11px] text-muted">Up to 3 MB</div>
          </div>
        </div>
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="lbl">Address</label>
          <input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Phone</label>
            <input className="inp" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div><label className="lbl">Status</label>
            <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "active" | "maintenance" | "disabled" })}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="disabled">Disabled</option>
            </select></div>
        </div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : existing ? "Save changes" : "Create branch"}
        </button>
      </div>
    </Modal>
  );
}
