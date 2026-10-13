"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, EyeOff, Eye, Tag, FolderPlus, X, Search } from "lucide-react";
import { apiGet, apiPost, apiPut, apiDelete, apiPatch } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { MenuItem, Category, Station } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

export default function MenuAdminPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";

  const [items, setItems] = useState<MenuItem[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [editItem, setEditItem] = useState<MenuItem | "new" | null>(null);
  const [catModal, setCatModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, c, s] = await Promise.all([
        apiGet<MenuItem[]>("/menu"), apiGet<Category[]>("/categories"), apiGet<Station[]>("/stations"),
      ]);
      setItems(Array.isArray(m) ? m : []);
      setCats(Array.isArray(c) ? c : []);
      setStations(Array.isArray(s) ? s : []);
      setActiveCat((prev) => prev || (c[0]?.name ?? ""));
    } catch { toast.push("bad", "Could not load menu"); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    if (q.trim()) { const s = q.toLowerCase(); return items.filter((i) => i.name.toLowerCase().includes(s)); }
    return items.filter((i) => i.category === activeCat);
  }, [items, activeCat, q]);

  async function toggleSoldOut(it: MenuItem) {
    try { const u = await apiPatch<MenuItem>(`/menu/${it.id}/sold-out`, { soldOut: !it.soldOut }); setItems((p) => p.map((x) => (x.id === u.id ? u : x))); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }
  async function removeItem(it: MenuItem) {
    if (!confirm(`Delete “${it.name}”?`)) return;
    try { await apiDelete(`/menu/${it.id}`); setItems((p) => p.filter((x) => x.id !== it.id)); toast.push("ok", "Item deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  if (loading) return <PageLoader label="Loading menu" />;

  const count = (name: string) => items.filter((i) => i.category === name).length;

  return (
    <div>
      <PageHeader title="Menu" subtitle={`${items.length} dishes · ${cats.length} categories`}>
        <button onClick={() => setCatModal(true)} className="btn btn-ghost btn-sm"><FolderPlus size={15} /> Categories</button>
        <button onClick={() => setEditItem("new")} className="btn btn-primary btn-sm"><Plus size={15} /> New dish</button>
      </PageHeader>

      <div className="grid md:grid-cols-[220px_1fr] gap-5">
        {/* category rail */}
        <div className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible">
          {cats.map((c) => (
            <button key={c.id} onClick={() => { setActiveCat(c.name); setQ(""); }}
              className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors"
              style={activeCat === c.name && !q ? { background: "var(--olive-wash)", color: "var(--olive-700)" } : { color: "var(--muted)" }}>
              <span>{c.name}</span>
              <span className="mono text-[11px] opacity-70">{count(c.name)}</span>
            </button>
          ))}
        </div>

        {/* items */}
        <div>
          <div className="relative mb-4 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="inp pl-9" placeholder="Search all dishes…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {!shown.length ? <EmptyState title="No dishes here" hint="Add one with “New dish”." icon={<Tag size={30} />} /> : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {shown.map((it) => (
                <div key={it.id} className="gb-card p-3.5 flex flex-col gap-2" style={it.soldOut ? { opacity: 0.6 } : {}}>
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-[14px] text-ink leading-snug">{it.name}</div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {q ? it.category + " · " : ""}{stations.find((s) => s.id === it.stationId)?.name || "No station"}{it.plu ? ` · #${it.plu}` : ""}
                      </div>
                    </div>
                    <div className="mono font-head font-semibold text-clay whitespace-nowrap">{money(it.price, currency)}</div>
                  </div>
                  <div className="flex gap-1.5 mt-auto pt-1">
                    <button onClick={() => toggleSoldOut(it)} className="btn btn-ghost btn-sm flex-1 !py-1">
                      {it.soldOut ? <><Eye size={13} /> Available</> : <><EyeOff size={13} /> 86 it</>}
                    </button>
                    <button onClick={() => setEditItem(it)} className="btn btn-soft btn-sm !px-2.5 !py-1"><Pencil size={13} /></button>
                    <button onClick={() => removeItem(it)} className="btn btn-danger btn-sm !px-2.5 !py-1"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editItem && (
        <ItemModal item={editItem} cats={cats} stations={stations} defaultCat={activeCat} currency={currency}
          onClose={() => setEditItem(null)}
          onSaved={(saved, isNew) => {
            setItems((p) => isNew ? [...p, saved] : p.map((x) => (x.id === saved.id ? saved : x)));
            setEditItem(null);
            toast.push("ok", isNew ? "Dish added" : "Dish updated");
          }} />
      )}
      {catModal && (
        <CategoryModal cats={cats} onClose={() => setCatModal(false)} onChange={(next) => setCats(next)} toast={toast} />
      )}
    </div>
  );
}

function ItemModal({ item, cats, stations, defaultCat, currency, onClose, onSaved }: {
  item: MenuItem | "new"; cats: Category[]; stations: Station[]; defaultCat: string; currency: string;
  onClose: () => void; onSaved: (it: MenuItem, isNew: boolean) => void;
}) {
  const isNew = item === "new";
  const base = isNew ? null : (item as MenuItem);
  const [name, setName] = useState(base?.name || "");
  const [price, setPrice] = useState(base ? String(base.price) : "");
  const [category, setCategory] = useState(base?.category || defaultCat || cats[0]?.name || "");
  const [stationId, setStationId] = useState<number | "">(base?.stationId ?? (stations[0]?.id ?? ""));
  const [plu, setPlu] = useState(base?.plu || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!name.trim()) { setErr("Name is required"); return; }
    setBusy(true); setErr("");
    const payload = { name: name.trim(), price: Number(price) || 0, category, stationId: stationId || null, plu: plu || null };
    try {
      const saved = isNew
        ? await apiPost<MenuItem>("/menu", payload)
        : await apiPut<MenuItem>(`/menu/${base!.id}`, payload);
      onSaved(saved, isNew);
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); } finally { setBusy(false); }
  }

  return (
    <Modal open title={isNew ? "New dish" : "Edit dish"} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label><input className="inp" value={name} autoFocus onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Price ({currency.trim()})</label><input className="inp mono" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} /></div>
          <div><label className="lbl">PLU</label><input className="inp mono" value={plu} onChange={(e) => setPlu(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Category</label>
            <select className="inp" value={category} onChange={(e) => setCategory(e.target.value)}>
              {cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="lbl">Station</label>
            <select className="inp" value={stationId} onChange={(e) => setStationId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">None</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">{isNew ? "Add dish" : "Save changes"}</button>
      </div>
    </Modal>
  );
}

function CategoryModal({ cats, onClose, onChange, toast }: {
  cats: Category[]; onClose: () => void; onChange: (next: Category[]) => void;
  toast: { push: (k: "ok" | "bad" | "info", m: string) => void };
}) {
  const [list, setList] = useState(cats);
  const [name, setName] = useState("");
  async function add() {
    if (!name.trim()) return;
    try { const c = await apiPost<Category>("/categories", { name: name.trim(), sortOrder: list.length + 1 }); const next = [...list, c]; setList(next); onChange(next); setName(""); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }
  async function rename(c: Category) {
    const n = prompt("Rename category", c.name); if (!n || n === c.name) return;
    try { await apiPut(`/categories/${c.id}`, { name: n }); const next = list.map((x) => x.id === c.id ? { ...x, name: n } : x); setList(next); onChange(next); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }
  async function del(c: Category) {
    if (!confirm(`Delete category “${c.name}”? Dishes keep their label.`)) return;
    try { await apiDelete(`/categories/${c.id}`); const next = list.filter((x) => x.id !== c.id); setList(next); onChange(next); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }
  return (
    <Modal open title="Categories" onClose={onClose}>
      <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
        {list.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-md px-3 py-2" style={{ background: "var(--panel-2)" }}>
            <span className="text-sm font-medium">{c.name}</span>
            <div className="flex gap-1">
              <button onClick={() => rename(c)} className="text-muted hover:text-olive p-1"><Pencil size={14} /></button>
              <button onClick={() => del(c)} className="text-muted hover:text-bad p-1"><X size={15} /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="inp" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button onClick={add} className="btn btn-primary"><Plus size={15} /></button>
      </div>
    </Modal>
  );
}
