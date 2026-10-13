"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus, CreditCard, RefreshCw, Armchair } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { Order, TableRow } from "@/lib/types";
import { PageHeader, PageLoader, useToast, Modal } from "@/components/ui";

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  open:     { bg: "var(--ok-wash)",    fg: "var(--ok)",    label: "Open" },
  ordered:  { bg: "var(--clay-wash)",  fg: "var(--clay-700)", label: "Ordered" },
  occupied: { bg: "var(--clay-wash)",  fg: "var(--clay-700)", label: "Occupied" },
  reserved: { bg: "var(--warn-wash)",  fg: "var(--warn)",  label: "Reserved" },
  dirty:    { bg: "var(--panel-2)",    fg: "var(--muted)", label: "Needs bussing" },
};

export default function FloorPage() {
  const router = useRouter();
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [tables, setTables] = useState<TableRow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<TableRow | null>(null);

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
    try { await apiPatch(`/tables/${t.id}/status`, { status }); setSel(null); load(); toast.push("ok", `${t.name} marked ${status}`); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  if (loading) return <PageLoader label="Loading floor" />;

  return (
    <div>
      <PageHeader title="Floor" subtitle="Tap a table to open a ticket or settle up.">
        <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      <div className="flex flex-wrap gap-3 mb-5 text-[12px]">
        {Object.entries(STATUS_STYLE).filter(([k]) => k !== "occupied").map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: v.fg }} />{v.label}</div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {tables.map((t) => {
          const ord = orderFor(t.id);
          const st = STATUS_STYLE[t.status] || STATUS_STYLE.open;
          const effectiveFg = ord ? STATUS_STYLE.ordered.fg : st.fg;
          return (
            <button key={t.id} onClick={() => setSel(t)}
              className="gb-card p-4 text-left hover:shadow-md hover:-translate-y-0.5 transition-all aspect-[4/3] flex flex-col justify-between relative overflow-hidden">
              <span className="absolute top-0 left-0 right-0 h-1" style={{ background: effectiveFg }} />
              <div className="flex items-start justify-between">
                <span className="font-head text-lg text-ink">{t.name}</span>
                <span className="flex items-center gap-1 text-[12px] text-muted"><Users size={13} />{t.seats}</span>
              </div>
              <div>
                <span className="pill" style={{ background: ord ? STATUS_STYLE.ordered.bg : st.bg, color: effectiveFg }}>
                  {ord ? "Ordered" : st.label}
                </span>
                {ord && <div className="mono font-semibold text-clay mt-1.5">{money(ord.total, currency)}</div>}
              </div>
            </button>
          );
        })}
      </div>

      {sel && (
        <Modal open title={sel.name} onClose={() => setSel(null)}>
          {(() => {
            const ord = orderFor(sel.id);
            return (
              <div className="space-y-4">
                <div className="text-sm text-muted">{sel.seats} seats · currently <span className="font-semibold text-ink">{(STATUS_STYLE[sel.status] || STATUS_STYLE.open).label.toLowerCase()}</span></div>
                {ord && (
                  <div className="rounded-md p-3" style={{ background: "var(--panel-2)" }}>
                    <div className="flex justify-between font-head"><span>{ord.displayNum}</span><span className="mono text-clay">{money(ord.total, currency)}</span></div>
                    <div className="text-[12px] text-muted mt-1">{ord.items.length} items · {ord.items.reduce((s, i) => s + i.qty, 0)} covers</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => router.push(`/order?tableId=${sel.id}`)} className="btn btn-olive"><Plus size={15} /> {ord ? "Add items" : "New order"}</button>
                  {ord
                    ? <button onClick={() => router.push(`/payment?orderId=${ord.id}`)} className="btn btn-primary"><CreditCard size={15} /> Pay</button>
                    : <button onClick={() => setStatus(sel, sel.status === "reserved" ? "open" : "reserved")} className="btn btn-ghost"><Armchair size={15} /> {sel.status === "reserved" ? "Clear reserve" : "Reserve"}</button>}
                </div>
                {sel.status === "dirty" && <button onClick={() => setStatus(sel, "open")} className="btn btn-soft w-full">Mark cleaned</button>}
              </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}
