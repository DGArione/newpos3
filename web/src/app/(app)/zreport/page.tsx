"use client";

import { useEffect, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

interface Z { id: number; fromDate: string; toDate: string; orderCount: number; grossSales: number; netSales: number; totalVat: number; totalServiceCharge: number; voidedCount: number; voidedTotal: number; generatedBy: string; createdAt: string; }

export default function ZReportPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<Z[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => apiGet<Z[]>("/zreports").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Z-Reports" subtitle="End-of-day sales close-outs.">
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><Plus size={15} /> Generate</button>
      </PageHeader>

      {loading ? <PageLoader /> : !list.length ? <EmptyState title="No Z-reports yet" hint="Generate one at the end of a trading day." icon={<FileText size={30} />} /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((z) => (
            <div key={z.id} className="gb-card p-5">
              <div className="flex justify-between items-start mb-3">
                <div className="font-head text-lg">{z.fromDate}{z.toDate && z.toDate !== z.fromDate ? ` → ${z.toDate}` : ""}</div>
                <span className="pill pill-olive">{z.orderCount} orders</span>
              </div>
              <div className="space-y-1 text-sm">
                <Row l="Gross" v={money(z.grossSales, currency)} />
                <Row l="Service" v={money(z.totalServiceCharge, currency)} />
                <Row l="VAT" v={money(z.totalVat, currency)} />
                <Row l="Voided" v={`${z.voidedCount} · ${money(z.voidedTotal, currency)}`} />
                <div className="flex justify-between font-head text-base pt-1.5 border-t border-line-soft mt-1.5"><span>Net</span><span className="mono text-clay">{money(z.netSales, currency)}</span></div>
              </div>
              <div className="text-[11px] text-muted mt-3">by {z.generatedBy} · {(z.createdAt || "").slice(0, 10)}</div>
            </div>
          ))}
        </div>
      )}

      {open && <GenerateModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "Z-report generated"); }} />}
    </div>
  );
}

function Row({ l, v }: { l: string; v: string }) { return <div className="flex justify-between text-muted"><span>{l}</span><span className="mono">{v}</span></div>; }

function GenerateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFrom] = useState(today);
  const [toDate, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function gen() {
    setBusy(true); setErr("");
    try {
      // backend treats toDate as exclusive upper bound — add a day
      const to = new Date(new Date(toDate).getTime() + 86400000).toISOString().slice(0, 10);
      await apiPost("/zreports", { fromDate, toDate: to });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Generate Z-Report" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">From</label><input type="date" className="inp" value={fromDate} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="lbl">To</label><input type="date" className="inp" value={toDate} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={gen} disabled={busy} className="btn btn-primary w-full">Generate report</button>
      </div>
    </Modal>
  );
}
