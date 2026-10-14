"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Plus, CreditCard, RefreshCw, Armchair, QrCode, Pencil, Trash2,
  LayoutGrid, Settings as SettingsIcon,
} from "lucide-react";
import { apiGet, apiPatch, apiPost, apiDelete } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { useAuth } from "@/lib/auth";
import { Order, TableRow } from "@/lib/types";
import { PageHeader, PageLoader, Screen, useToast, Modal, EmptyState } from "@/components/ui";

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  open:     { bg: "var(--ok-wash)",    fg: "var(--ok)",    label: "Open" },
  ordered:  { bg: "var(--olive-wash)", fg: "var(--olive-700)", label: "Ordered" },
  occupied: { bg: "var(--olive-wash)", fg: "var(--olive-700)", label: "Occupied" },
  reserved: { bg: "var(--warn-wash)",  fg: "var(--warn)",  label: "Reserved" },
  dirty:    { bg: "var(--panel-2)",    fg: "var(--muted)", label: "Needs bussing" },
};

export default function FloorPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [tables, setTables] = useState<TableRow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<TableRow | null>(null);
  const [edit, setEdit] = useState<TableRow | "new" | null>(null);
  const [floor, setFloor] = useState<string>("all");
  const [qrOf, setQrOf] = useState<TableRow | null>(null);

  const canEdit = user?.role === "manager" || user?.role === "superManager";

  const load = useCallback(async () => {
    try {
      const [t, o] = await Promise.all([apiGet<TableRow[]>("/tables"), apiGet<Order[]>("/orders")]);
      setTables(Array.isArray(t) ? t : []);
      setOrders((Array.isArray(o) ? o : []).filter((x) => x.status !== "voided" && x.status !== "completed"));
    } catch { toast.push("bad", "Could not load floor"); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);

  const orderFor = (tid: number) => orders.find((o) => o.tableId === tid && o.paymentStatus !== "paid");

  async function setStatus(t: TableRow, status: string) {
    try { await apiPatch(`/tables/${t.id}`, { status }); setSel(null); load(); toast.push("ok", `${t.name} marked ${status}`); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function remove(t: TableRow) {
    if (!confirm(`Delete table "${t.name}"?`)) return;
    try { await apiDelete(`/tables/${t.id}`); setSel(null); load(); toast.push("ok", "Deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function regenerateQr(t: TableRow) {
    try {
      const u = await apiPost<TableRow>(`/tables/${t.id}/qr-regenerate`);
      setTables((p) => p.map((x) => (x.id === u.id ? u : x)));
      if (qrOf?.id === t.id) setQrOf(u);
      toast.push("ok", `QR regenerated for ${t.name}`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function resetFloor() {
    if (!confirm("Reset the whole floor? All tables marked open.")) return;
    try { await apiPost("/tables/reset-floor"); load(); toast.push("ok", "Floor reset"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const floors = useMemo(() => {
    const set = new Set<string>();
    for (const t of tables) set.add(t.floor || "Main");
    return Array.from(set);
  }, [tables]);

  const shown = useMemo(() => {
    return tables.filter((t) => floor === "all" || (t.floor || "Main") === floor);
  }, [tables, floor]);

  if (loading) return <PageLoader label="Loading floor" />;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Floor" subtitle="Tap a table to open a ticket or settle up" icon={LayoutGrid}>
          {canEdit && (
            <>
              <button onClick={() => setEdit("new")} className="btn btn-primary btn-sm">
                <Plus size={14} /> New table
              </button>
              <button onClick={resetFloor} className="btn btn-ghost btn-sm" title="Mark all tables open">
                <RefreshCw size={14} /> Reset floor
              </button>
            </>
          )}
          <button onClick={load} className="btn btn-ghost btn-sm" title="Refresh"><RefreshCw size={14} /></button>
        </PageHeader>

        {/* Floor tabs (multi-floor support) */}
        {floors.length > 1 && (
          <div className="flex gap-1.5 p-1 rounded-full self-start mb-4" style={{ background: "var(--panel-2)" }}>
            <button onClick={() => setFloor("all")}
              className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
              style={floor === "all"
                ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                : { color: "var(--muted)" }}>All floors</button>
            {floors.map((f) => (
              <button key={f} onClick={() => setFloor(f)}
                className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
                style={floor === f
                  ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                  : { color: "var(--muted)" }}>{f}</button>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mb-4 text-[11.5px]">
          {Object.entries(STATUS_STYLE).filter(([k]) => k !== "occupied").map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full" style={{ background: v.fg }} />{v.label}
            </div>
          ))}
        </div>

        {!shown.length ? (
          <EmptyState title="No tables" hint={canEdit ? "Add one with the button above." : "Ask a manager to add tables."} icon={<Armchair size={30} />} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {shown.map((t) => {
              const o = orderFor(t.id);
              const style = STATUS_STYLE[t.status] || STATUS_STYLE.open;
              return (
                <button
                  key={t.id}
                  onClick={() => setSel(t)}
                  className="rounded-xl p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                  style={{
                    background: style.bg,
                    border: `1.5px solid ${style.fg}`,
                    minHeight: 110,
                  }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-bold text-[16px] text-ink">{t.name}</div>
                      <div className="text-[11px] text-muted flex items-center gap-1">
                        <Users size={11} /> {t.seats}
                      </div>
                    </div>
                    <span className="pill" style={{ background: "rgba(255,255,255,.5)", color: style.fg, fontSize: 10 }}>
                      {style.label}
                    </span>
                  </div>
                  {o && (
                    <div className="text-[11.5px] mt-2">
                      <div className="font-semibold mono" style={{ color: style.fg }}>{o.displayNum}</div>
                      <div className="mono font-bold text-ink">{money(o.total, currency)}</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Screen>

      {/* Table action modal */}
      {sel && (
        <Modal open title={sel.name} onClose={() => setSel(null)} width={440}>
          {(() => {
            const o = orderFor(sel.id);
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                  <span className="pill pill-olive"><Users size={11} /> {sel.seats} seats</span>
                  <span className="pill" style={{ background: STATUS_STYLE[sel.status]?.bg, color: STATUS_STYLE[sel.status]?.fg }}>
                    {STATUS_STYLE[sel.status]?.label}
                  </span>
                  {sel.floor && <span className="pill pill-info">Floor: {sel.floor}</span>}
                </div>

                {o ? (
                  <>
                    <div className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
                      <div className="font-semibold text-ink">{o.displayNum}</div>
                      <div className="text-[12px] text-muted">{o.items.length} items</div>
                      <div className="mono font-bold text-[16px] mt-1" style={{ color: "var(--olive-700)" }}>
                        {money(o.total, currency)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => router.push(`/order?tableId=${sel.id}`)} className="btn btn-ghost flex-1">
                        <Plus size={14} /> Add items
                      </button>
                      <button onClick={() => router.push(`/payment?orderId=${o.id}`)} className="btn btn-primary flex-1">
                        <CreditCard size={14} /> Pay
                      </button>
                    </div>
                  </>
                ) : (
                  <button onClick={() => router.push(`/order?tableId=${sel.id}`)} className="btn btn-primary w-full btn-lg">
                    <Plus size={15} /> Start new order
                  </button>
                )}

                <div className="flex gap-2 pt-2 border-t border-line-soft flex-wrap">
                  <button onClick={() => setStatus(sel, "open")}      className="btn btn-ghost btn-sm">Open</button>
                  <button onClick={() => setStatus(sel, "reserved")}  className="btn btn-ghost btn-sm">Reserve</button>
                  <button onClick={() => setStatus(sel, "dirty")}     className="btn btn-ghost btn-sm">Needs bussing</button>
                </div>

                {canEdit && (
                  <div className="flex gap-2 pt-2 border-t border-line-soft">
                    <button onClick={() => { setEdit(sel); setSel(null); }} className="btn btn-ghost btn-sm flex-1">
                      <Pencil size={13} /> Edit
                    </button>
                    <button onClick={() => { setQrOf(sel); setSel(null); }} className="btn btn-ghost btn-sm flex-1">
                      <QrCode size={13} /> QR code
                    </button>
                    <button onClick={() => remove(sel)} className="btn btn-danger btn-sm">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Create/edit table */}
      {edit && (
        <TableEditor
          existing={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onDone={() => { setEdit(null); load(); toast.push("ok", "Saved"); }}
        />
      )}

      {/* QR dialog */}
      {qrOf && (
        <QrModal
          table={qrOf}
          onClose={() => setQrOf(null)}
          onRegenerate={() => regenerateQr(qrOf)}
        />
      )}
    </div>
  );
}

function TableEditor({
  existing, onClose, onDone,
}: {
  existing: TableRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    name: existing?.name || "",
    seats: String(existing?.seats || 4),
    floor: existing?.floor || "Main",
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name.trim()) { toast.push("bad", "Name required"); return; }
    setBusy(true);
    try {
      const payload = { name: f.name, seats: Number(f.seats) || 1, floor: f.floor };
      if (existing) await apiPatch(`/tables/${existing.id}`, payload);
      else await apiPost("/tables", payload);
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={existing ? `Edit ${existing.name}` : "New table"} onClose={onClose} width={400}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus placeholder="e.g. T1 or Beach 2" value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Seats</label>
            <input className="inp mono" type="number" min={1} value={f.seats}
              onChange={(e) => setF({ ...f, seats: e.target.value })} /></div>
          <div><label className="lbl">Floor / area</label>
            <input className="inp" placeholder="Main, Beach, Rooftop…" value={f.floor}
              onChange={(e) => setF({ ...f, floor: e.target.value })} /></div>
        </div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : existing ? "Save changes" : "Create table"}
        </button>
      </div>
    </Modal>
  );
}

function QrModal({ table, onClose, onRegenerate }: { table: TableRow; onClose: () => void; onRegenerate: () => void }) {
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/t/${table.qrToken || table.id}`
    : "";
  // use QR server generator — simple + works offline for the PNG from any device
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;
  return (
    <Modal open title={`QR for ${table.name}`} onClose={onClose} width={360}>
      <div className="flex flex-col items-center gap-3">
        <img src={qrUrl} alt={`QR for ${table.name}`} width={240} height={240}
          className="rounded-xl" style={{ background: "#fff", padding: 6 }} />
        <div className="text-[11.5px] text-muted font-mono break-all text-center">
          {url}
        </div>
        <div className="flex gap-2 w-full">
          <button onClick={() => navigator.clipboard.writeText(url).then(() => alert("Link copied"))} className="btn btn-ghost flex-1">
            Copy link
          </button>
          <button onClick={onRegenerate} className="btn btn-primary flex-1">
            <RefreshCw size={13} /> Regenerate
          </button>
        </div>
      </div>
    </Modal>
  );
}
