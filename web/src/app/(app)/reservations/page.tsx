"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Plus, Users, Clock, Phone } from "lucide-react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { TableRow } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

interface Resv { id: number; customerName: string; customerPhone: string; partySize: number; reserveDate: string; reserveTime: string; tableName: string; status: string; note: string; }

const STATUS_PILL: Record<string, string> = { booked: "pill-olive", seated: "pill-ok", cancelled: "pill-bad", "no-show": "pill-warn", completed: "pill-clay" };

export default function ReservationsPage() {
  const toast = useToast();
  const [list, setList] = useState<Resv[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => apiGet<Resv[]>("/reservations").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); apiGet<TableRow[]>("/tables").then((d) => setTables(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  async function setStatus(r: Resv, status: string) {
    try { await apiPatch(`/reservations/${r.id}`, { status }); load(); toast.push("ok", `Marked ${status}`); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div>
      <PageHeader title="Reservations" subtitle={`${list.length} on the book`}>
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><Plus size={15} /> New booking</button>
      </PageHeader>

      {loading ? <PageLoader /> : !list.length ? <EmptyState title="No reservations" hint="Take a booking to fill the book." icon={<CalendarCheck size={30} />} /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((r) => (
            <div key={r.id} className="gb-card p-4">
              <div className="flex justify-between items-start">
                <div className="font-head text-lg">{r.customerName || "Guest"}</div>
                <span className={`pill ${STATUS_PILL[r.status] || "pill-olive"} capitalize`}>{r.status}</span>
              </div>
              <div className="text-sm text-muted flex items-center gap-1.5 mt-1.5"><Clock size={13} />{r.reserveDate} · {r.reserveTime}</div>
              <div className="text-sm text-muted flex items-center gap-1.5 mt-1"><Users size={13} />{r.partySize} guests{r.tableName ? ` · ${r.tableName}` : ""}</div>
              {r.customerPhone && <div className="text-sm text-muted flex items-center gap-1.5 mt-1"><Phone size={13} />{r.customerPhone}</div>}
              {r.status === "booked" && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setStatus(r, "seated")} className="btn btn-olive btn-sm flex-1">Seat</button>
                  <button onClick={() => setStatus(r, "cancelled")} className="btn btn-ghost btn-sm flex-1">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {open && <BookModal tables={tables} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "Reservation booked"); }} />}
    </div>
  );
}

function BookModal({ tables, onClose, onDone }: { tables: TableRow[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ customerName: "", customerPhone: "", partySize: "2", reserveDate: new Date().toISOString().slice(0, 10), reserveTime: "19:00", tableId: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (!f.customerName && !f.customerPhone) { setErr("Name or phone required"); return; }
    setBusy(true); setErr("");
    try { await apiPost("/reservations", { ...f, partySize: Number(f.partySize), tableId: f.tableId || null }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <Modal open title="New reservation" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Name</label><input className="inp" value={f.customerName} autoFocus onChange={(e) => setF({ ...f, customerName: e.target.value })} /></div>
          <div><label className="lbl">Phone</label><input className="inp" value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} /></div>
          <div><label className="lbl">Date</label><input type="date" className="inp" value={f.reserveDate} onChange={(e) => setF({ ...f, reserveDate: e.target.value })} /></div>
          <div><label className="lbl">Time</label><input type="time" className="inp" value={f.reserveTime} onChange={(e) => setF({ ...f, reserveTime: e.target.value })} /></div>
          <div><label className="lbl">Party size</label><input className="inp mono" inputMode="numeric" value={f.partySize} onChange={(e) => setF({ ...f, partySize: e.target.value.replace(/\D/g, "") })} /></div>
          <div><label className="lbl">Table</label>
            <select className="inp" value={f.tableId} onChange={(e) => setF({ ...f, tableId: e.target.value })}>
              <option value="">Any table</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div><label className="lbl">Note</label><input className="inp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">Book table</button>
      </div>
    </Modal>
  );
}
