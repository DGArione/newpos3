"use client";

import { useEffect, useState } from "react";
import { FileText, Printer, FileCheck, Banknote, CreditCard, Wallet } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen, useToast } from "@/components/ui";

interface Breakdown { cash?: number; card?: number; wallet?: number }
interface ZReport {
  id: number;
  generatedBy: string;
  fromDate: string;
  toDate: string;
  orderCount: number;
  grossSales: number;
  totalDiscounts: number;
  totalServiceCharge: number;
  totalVat: number;
  netSales: number;
  paymentBreakdown: Breakdown;
  voidedCount: number;
  voidedTotal: number;
  generatedAt: string;
}

function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

export default function ZReportPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<ZReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<ZReport | null>(null);

  const load = () => {
    setLoading(true);
    apiGet<ZReport[]>("/zreports")
      .then((d) => { setList(Array.isArray(d) ? d : []); if (Array.isArray(d) && d.length) setLatest(d[0]); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  async function runEOD() {
    setRunning(true);
    const t = todayStr();
    try {
      const z = await apiPost<ZReport>("/zreports", {
        fromDate: `${t} 00:00:00`,
        toDate: `${t} 23:59:59`,
      });
      setLatest(z);
      load();
      toast.push("ok", "Z-Report generated");
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
    finally { setRunning(false); }
  }

  function printReport() {
    window.print();
  }

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Z-Report" subtitle="End-of-day sales close" icon={FileText}>
          <button onClick={runEOD} disabled={running} className="btn btn-primary btn-sm">
            <FileCheck size={14} /> {running ? "Running…" : "Run today's Z-Report"}
          </button>
          {latest && (
            <button onClick={printReport} className="btn btn-ghost btn-sm">
              <Printer size={14} /> Print
            </button>
          )}
        </PageHeader>

        {latest && (
          <div
            className="rounded-xl p-5 mb-4"
            style={{ background: "linear-gradient(135deg, var(--olive) 0%, var(--olive-700) 100%)", color: "#fff" }}
          >
            <div className="text-[11px] uppercase tracking-wider opacity-80">Latest Z-Report</div>
            <div className="text-[12.5px] opacity-85 mt-1">
              {latest.fromDate.replace("T", " ").slice(0, 16)} → {latest.toDate.replace("T", " ").slice(0, 16)}
            </div>
            <div className="mono text-[32px] font-semibold mt-3">{money(latest.netSales, currency)}</div>
            <div className="text-[12.5px] opacity-80">
              {latest.orderCount} orders · {latest.voidedCount} cancelled ({money(latest.voidedTotal, currency)})
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4">
              <PBTile icon={<Banknote size={14} />}   label="Cash"   value={money(latest.paymentBreakdown?.cash || 0, currency)} />
              <PBTile icon={<CreditCard size={14} />} label="Card"   value={money(latest.paymentBreakdown?.card || 0, currency)} />
              <PBTile icon={<Wallet size={14} />}     label="Wallet" value={money(latest.paymentBreakdown?.wallet || 0, currency)} />
            </div>

            <div className="grid grid-cols-4 gap-3 mt-4 text-[12px]">
              <ZLine label="Gross"    value={money(latest.grossSales, currency)} />
              <ZLine label="Discount" value={`−${money(latest.totalDiscounts, currency)}`} />
              <ZLine label="Service"  value={money(latest.totalServiceCharge, currency)} />
              <ZLine label="VAT"      value={money(latest.totalVat, currency)} />
            </div>
          </div>
        )}
      </Screen>

      <Screen>
        <h2 className="text-[15px] font-semibold text-ink mb-4">Past reports</h2>
        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState title="No reports yet" hint="Run the first Z-Report with the button above." icon={<FileText size={30} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-2.5">When</th>
                  <th>By</th>
                  <th>Orders</th>
                  <th className="text-right pr-4">Net</th>
                </tr>
              </thead>
              <tbody>
                {list.map((z) => (
                  <tr key={z.id} className="border-t border-line-soft cursor-pointer hover:bg-panel-2" onClick={() => setLatest(z)}>
                    <td className="py-3">{(z.generatedAt || "").replace("T", " ").slice(0, 16)}</td>
                    <td>{z.generatedBy}</td>
                    <td className="mono">{z.orderCount}</td>
                    <td className="text-right pr-4 mono font-semibold" style={{ color: "var(--olive-700)" }}>
                      {money(z.netSales, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Screen>
    </div>
  );
}

function PBTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,.12)" }}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-85">
        {icon} {label}
      </div>
      <div className="mono text-[16px] font-semibold mt-1">{value}</div>
    </div>
  );
}

function ZLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="opacity-70 text-[10px] uppercase tracking-wider">{label}</div>
      <div className="mono font-semibold mt-0.5">{value}</div>
    </div>
  );
}
