"use client";

import { useCallback, useEffect, useState } from "react";
import { Tag, Plus, Trash2, Percent, DollarSign, Pencil } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";
import type { MenuItem } from "@/lib/types";

interface Condition { menuItemId: number; qty: number }
interface Promotion {
  id: number;
  name: string;
  type: "buy_n" | "bundle" | "daily";
  conditions: Condition[];
  rewardKind: "percent" | "amount";
  rewardValue: number;
  scope: "items" | "order";
  days: number[];
  active: boolean | number;
  priority: number;
}

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PromotionsPage() {
  const toast = useToast();
  const [list, setList] = useState<Promotion[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Promotion | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<Promotion[]>("/promotions"),
      apiGet<MenuItem[] | { items: MenuItem[] }>("/menu"),
    ])
      .then(([p, m]) => {
        setList(Array.isArray(p) ? p : []);
        setMenu(Array.isArray(m) ? m : m.items || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function toggle(p: Promotion) {
    try {
      const u = await apiPatch<Promotion>(`/promotions/${p.id}`, { active: !p.active });
      setList((prev) => prev.map((x) => (x.id === u.id ? u : x)));
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function remove(p: Promotion) {
    if (!confirm(`Delete promotion "${p.name}"?`)) return;
    try { await apiDelete(`/promotions/${p.id}`); setList((prev) => prev.filter((x) => x.id !== p.id)); toast.push("ok", "Deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const nameFor = (id: number) => menu.find((m) => m.id === id)?.name || `#${id}`;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Promotions" subtitle="Buy-N-get, bundles, daily deals" icon={Tag}>
          <button onClick={() => { setEdit(null); setOpen(true); }} className="btn btn-primary btn-sm">
            <Plus size={14} /> New promotion
          </button>
        </PageHeader>

        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState title="No promotions yet" hint="Create your first one above." icon={<Tag size={30} />} />
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {list.map((p) => (
              <div
                key={p.id}
                className="rounded-xl p-4"
                style={{
                  background: "var(--panel-2)",
                  border: p.active ? "1px solid var(--olive)" : "1px solid var(--line)",
                  opacity: p.active ? 1 : 0.65,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-ink font-semibold text-[14.5px] truncate">{p.name}</div>
                    <div className="text-[11.5px] text-muted capitalize">{p.type.replace("_", " ")}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggle(p)}
                      title={p.active ? "Active — click to disable" : "Disabled — click to enable"}
                      className="w-10 h-6 rounded-full relative transition-colors"
                      style={{ background: p.active ? "var(--olive)" : "var(--line)" }}
                    >
                      <span
                        className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                        style={{ left: p.active ? 18 : 2 }}
                      />
                    </button>
                    <button onClick={() => { setEdit(p); setOpen(true); }} className="btn btn-ghost btn-sm !px-2" title="Edit">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => remove(p)} className="btn btn-ghost btn-sm !px-2" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <span
                    className="flex items-center gap-1 text-[13px] font-semibold"
                    style={{ color: "var(--olive-700)" }}
                  >
                    {p.rewardKind === "percent" ? <Percent size={13} /> : <DollarSign size={13} />}
                    {p.rewardValue}{p.rewardKind === "percent" ? "%" : ""} off {p.scope === "order" ? "order" : "items"}
                  </span>
                </div>

                <div className="mt-2 text-[11.5px] text-muted">
                  <strong>If:</strong> {p.conditions.map((c) => `${c.qty}× ${nameFor(c.menuItemId)}`).join(" + ")}
                </div>
                {p.days && p.days.length > 0 && p.days.length < 7 && (
                  <div className="mt-1 text-[11.5px] text-muted">
                    <strong>On:</strong> {p.days.map((d) => DAY_LABEL[d]).join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Screen>

      {open && (
        <PromotionEditor
          menu={menu}
          existing={edit}
          onClose={() => { setOpen(false); setEdit(null); }}
          onDone={() => { setOpen(false); setEdit(null); load(); toast.push("ok", "Saved"); }}
        />
      )}
    </div>
  );
}

function PromotionEditor({
  menu, existing, onClose, onDone,
}: {
  menu: MenuItem[];
  existing: Promotion | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    name: existing?.name || "",
    type: existing?.type || "buy_n" as const,
    conditions: existing?.conditions || [{ menuItemId: menu[0]?.id || 0, qty: 1 }],
    rewardKind: existing?.rewardKind || "percent" as const,
    rewardValue: String(existing?.rewardValue || 10),
    scope: existing?.scope || "items" as const,
    days: existing?.days || [] as number[],
    active: existing ? !!existing.active : true,
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.name.trim()) { toast.push("bad", "Give it a name"); return; }
    setBusy(true);
    try {
      const payload = {
        ...f,
        rewardValue: Number(f.rewardValue) || 0,
        conditions: f.conditions.filter((c) => c.menuItemId && c.qty > 0),
      };
      if (existing) await apiPatch(`/promotions/${existing.id}`, payload);
      else await apiPost("/promotions", payload);
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }

  function toggleDay(d: number) {
    setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() });
  }

  return (
    <Modal open title={existing ? "Edit promotion" : "New promotion"} onClose={onClose} width={520}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" placeholder='e.g. "Pizza Tuesday" or "Buy 2 Burgers, 10% off"' value={f.name} autoFocus
            onChange={(e) => setF({ ...f, name: e.target.value })} /></div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Type</label>
            <select className="inp" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as "buy_n" | "bundle" | "daily" })}>
              <option value="buy_n">Buy N get discount</option>
              <option value="bundle">Bundle</option>
              <option value="daily">Daily deal</option>
            </select></div>
          <div><label className="lbl">Discount</label>
            <div className="flex gap-2">
              <input className="inp mono" type="number" value={f.rewardValue}
                onChange={(e) => setF({ ...f, rewardValue: e.target.value })} />
              <select className="inp" style={{ width: 100 }} value={f.rewardKind}
                onChange={(e) => setF({ ...f, rewardKind: e.target.value as "percent" | "amount" })}>
                <option value="percent">%</option>
                <option value="amount">flat</option>
              </select>
            </div></div>
        </div>

        <div>
          <label className="lbl">Applies to</label>
          <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
            {(["items", "order"] as const).map((s) => (
              <button key={s} onClick={() => setF({ ...f, scope: s })}
                className="flex-1 py-1.5 rounded-full text-[12.5px] font-semibold capitalize transition-colors"
                style={f.scope === s
                  ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                  : { color: "var(--muted)" }}>
                {s === "order" ? "Whole order" : "Qualifying items"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="lbl">If order contains</label>
          <div className="flex flex-col gap-1.5">
            {f.conditions.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input className="inp mono" type="number" min={1} style={{ width: 80 }} value={c.qty}
                  onChange={(e) => { const n = [...f.conditions]; n[i].qty = Number(e.target.value) || 1; setF({ ...f, conditions: n }); }} />
                <span className="self-center text-muted text-[13px]">×</span>
                <select className="inp flex-1" value={c.menuItemId}
                  onChange={(e) => { const n = [...f.conditions]; n[i].menuItemId = Number(e.target.value); setF({ ...f, conditions: n }); }}>
                  {menu.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <button className="btn btn-ghost btn-sm !px-2" onClick={() => setF({ ...f, conditions: f.conditions.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm self-start"
              onClick={() => setF({ ...f, conditions: [...f.conditions, { menuItemId: menu[0]?.id || 0, qty: 1 }] })}>
              <Plus size={13} /> Add item
            </button>
          </div>
        </div>

        <div>
          <label className="lbl">Days of week (leave empty for every day)</label>
          <div className="flex gap-1.5 flex-wrap">
            {DAY_LABEL.map((d, i) => {
              const on = f.days.includes(i);
              return (
                <button key={i} onClick={() => toggleDay(i)}
                  className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors border"
                  style={on
                    ? { background: "var(--olive)", color: "#fff", borderColor: "var(--olive)" }
                    : { background: "var(--panel)", borderColor: "var(--line)", color: "var(--muted)" }}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <button onClick={save} disabled={busy} className="btn btn-primary w-full btn-lg">
          {busy ? "Saving…" : existing ? "Save changes" : "Create promotion"}
        </button>
      </div>
    </Modal>
  );
}
