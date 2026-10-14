"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Plus, Clock, Users as UsersIcon, Phone, Check, X, Trash2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { apiPatch, apiDelete } from "@/lib/api";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";
import type { TableRow } from "@/lib/types";

interface Reservation {
  id: number;
  customerName: string;
  customerPhone: string;
  partySize: number;
  reserveDate: string;
  reserveTime: string;
  tableId: number | null;
  tableName: string;
  status: "booked" | "seated" | "completed" | "no_show" | "cancelled";
  note?: string;
  createdByName?: string;
  createdAt?: string;
}

const STATUS_PILL: Record<string, string> = {
  booked:    "pill-olive",
  seated:    "pill-ok",
  completed: "pill-info",
  no_show:   "pill-warn",
  cancelled: "pill-bad",
};
const STATUS_LABEL: Record<string, string> = {
  booked:    "Booked",
  seated:    "Seated",
  completed: "Completed",
  no_show:   "No show",
  cancelled: "Cancelled",
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReservationsPage() {
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [list, setList] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<Reservation[]>(`/reservations?date=${date}`),
      apiGet<TableRow[]>("/tables"),
    ])
      .then(([r, t]) => { setList(Array.isArray(r) ? r : []); setTables(Array.isArray(t) ? t : []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(r: Reservation, status: Reservation["status"]) {
    try {
      const u = await apiPatch<Reservation>(`/reservations/${r.id}`, { status });
      setList((prev) => prev.map((x) => (x.id === u.id ? u : x)));
      toast.push("ok", `Marked ${STATUS_LABEL[status].toLowerCase()}`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function remove(r: Reservation) {
    if (!confirm(`Delete reservation for ${r.customerName || r.customerPhone}?`)) return;
    try { await apiDelete(`/reservations/${r.id}`); setList((p) => p.filter((x) => x.id !== r.id)); toast.push("ok", "Deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Reservations" subtitle="Table bookings" icon={CalendarCheck}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="inp !py-1.5 !px-3 text-[13px]"
            style={{ width: 160 }}
          />
          <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
            <Plus size={14} /> New booking
          </button>
        </PageHeader>

        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState
            title="No bookings for this date"
            hint="Create one with the button above."
            icon={<CalendarCheck size={30} />}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3"
                style={{ background: "var(--panel-2)" }}
              >
                <div className="flex items-center gap-2 min-w-[80px]">
                  <Clock size={14} className="text-muted" />
                  <span className="mono font-semibold text-[14px]">{r.reserveTime}</span>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-ink font-semibold text-[14px]">
                    {r.customerName || <span className="text-muted italic">(no name)</span>}
                  </div>
                  <div className="text-[11.5px] text-muted flex items-center gap-3">
                    {r.customerPhone && <span className="flex items-center gap-1"><Phone size={11} /> {r.customerPhone}</span>}
                    <span className="flex items-center gap-1"><UsersIcon size={11} /> {r.partySize}</span>
                    {r.tableName && <span>· {r.tableName}</span>}
                  </div>
                </div>
                <span className={`pill ${STATUS_PILL[r.status] || "pill-olive"}`}>{STATUS_LABEL[r.status]}</span>
                {r.status === "booked" && (
                  <>
                    <button onClick={() => setStatus(r, "seated")} className="btn btn-soft btn-sm" title="Mark seated">
                      <Check size={13} /> Seat
                    </button>
                    <button onClick={() => setStatus(r, "no_show")} className="btn btn-ghost btn-sm" title="Mark no-show">
                      <X size={13} /> No-show
                    </button>
                  </>
                )}
                {r.status === "seated" && (
                  <button onClick={() => setStatus(r, "completed")} className="btn btn-soft btn-sm" title="Mark completed">
                    <Check size={13} /> Done
                  </button>
                )}
                <button onClick={() => remove(r)} className="btn btn-ghost btn-sm !px-2" title="Delete">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Screen>

      {open && (
        <BookingModal
          tables={tables}
          defaultDate={date}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); load(); toast.push("ok", "Booking created"); }}
        />
      )}
    </div>
  );
}

function BookingModal({
  tables, defaultDate, onClose, onDone,
}: {
  tables: TableRow[];
  defaultDate: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    customerName: "", customerPhone: "", partySize: "2",
    reserveDate: defaultDate, reserveTime: "19:00",
    tableId: "", note: "",
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.customerName && !f.customerPhone) { toast.push("bad", "Enter a name or phone"); return; }
    if (!f.reserveDate || !f.reserveTime) { toast.push("bad", "Date and time are required"); return; }
    setBusy(true);
    try {
      await apiPost("/reservations", {
        customerName: f.customerName,
        customerPhone: f.customerPhone,
        partySize: Number(f.partySize) || 1,
        reserveDate: f.reserveDate,
        reserveTime: f.reserveTime,
        tableId: f.tableId ? Number(f.tableId) : null,
        note: f.note,
      });
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }

  return (
    <Modal open title="New booking" onClose={onClose} width={480}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Name</label>
            <input className="inp" value={f.customerName} autoFocus onChange={(e) => setF({ ...f, customerName: e.target.value })} /></div>
          <div><label className="lbl">Phone</label>
            <input className="inp" value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} /></div>
          <div><label className="lbl">Party size</label>
            <input className="inp mono" type="number" min={1} value={f.partySize} onChange={(e) => setF({ ...f, partySize: e.target.value })} /></div>
          <div><label className="lbl">Table (optional)</label>
            <select className="inp" value={f.tableId} onChange={(e) => setF({ ...f, tableId: e.target.value })}>
              <option value="">— Any —</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.seats} seats</option>)}
            </select></div>
          <div><label className="lbl">Date</label>
            <input className="inp" type="date" value={f.reserveDate} onChange={(e) => setF({ ...f, reserveDate: e.target.value })} /></div>
          <div><label className="lbl">Time</label>
            <input className="inp" type="time" value={f.reserveTime} onChange={(e) => setF({ ...f, reserveTime: e.target.value })} /></div>
        </div>
        <div><label className="lbl">Note (optional)</label>
          <input className="inp" placeholder="Window seat, birthday, high chair…" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full btn-lg">
          {busy ? "Saving…" : "Create booking"}
        </button>
      </div>
    </Modal>
  );
}
