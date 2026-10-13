"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Receipt, RefreshCw } from "lucide-react";
import { apiGet } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { Order } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, Modal } from "@/components/ui";

const FILTERS = ["all", "paid", "unpaid", "voided"] as const;

export default function HistoryPage() {
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [sel, setSel] = useState<Order | null>(null);

  const load = () => { setLoading(true); apiGet<Order[]>("/orders?all=1").then((d) => setOrders(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(load, []);

  const shown = useMemo(() => {
    let list = orders;
    if (filter === "voided") list = list.filter((o) => o.status === "voided");
    else if (filter === "paid") list = list.filter((o) => o.paymentStatus === "paid");
    else if (filter === "unpaid") list = list.filter((o) => o.paymentStatus !== "paid" && o.status !== "voided");
    if (q.trim()) { const s = q.toLowerCase(); list = list.filter((o) => (o.displayNum || "").toLowerCase().includes(s) || (o.tableName || "").toLowerCase().includes(s) || (o.customerName || "").toLowerCase().includes(s)); }
    return [...list].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [orders, q, filter]);

  return (
    <div>
      <PageHeader title="Order history" subtitle={`${orders.length} orders on record`}>
        <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="inp pl-9" placeholder="Search order, table, customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold capitalize border transition-colors"
              style={filter === f ? { background: "var(--olive)", color: "#ffffff", borderColor: "var(--olive)" } : { background: "var(--panel)", color: "var(--muted)", borderColor: "var(--line)" }}>{f}</button>
          ))}
        </div>
      </div>

      {loading ? <PageLoader /> : !shown.length ? <EmptyState title="No orders" hint="Nothing matches that filter yet." icon={<Receipt size={30} />} /> : (
        <div className="gb-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted text-[11px] uppercase tracking-wide" style={{ background: "var(--panel-2)" }}>
                <th className="py-2.5 px-4">Order</th><th>Table / Type</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>When</th>
              </tr></thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id} onClick={() => setSel(o)} className="border-t border-line-soft cursor-pointer hover:bg-panel-2 transition-colors">
                    <td className="py-2.5 px-4 font-semibold font-head">{o.displayNum}</td>
                    <td>{o.tableName} <span className="text-muted capitalize">· {o.orderType}</span></td>
                    <td className="mono">{o.items.length}</td>
                    <td className="mono font-semibold text-clay">{money(o.total, currency)}</td>
                    <td><PayPill s={o.paymentStatus} /></td>
                    <td className="capitalize text-muted">{o.status}</td>
                    <td className="text-muted text-[12px]">{(o.createdAt || "").replace("T", " ").slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sel && (
        <Modal open title={`${sel.displayNum} · ${sel.tableName}`} onClose={() => setSel(null)}>
          <div className="space-y-1.5 mb-4">
            {sel.items.map((it, i) => (
              <div key={i} className="flex justify-between text-sm"><span>{it.qty}× {it.name}</span><span className="mono text-muted">{money(it.lineTotal, currency)}</span></div>
            ))}
          </div>
          <div className="border-t border-line-soft pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-muted"><span>Subtotal</span><span className="mono">{money(sel.subtotal, currency)}</span></div>
            {sel.discount > 0 && <div className="flex justify-between text-muted"><span>Discount</span><span className="mono">– {money(sel.discount, currency)}</span></div>}
            {sel.serviceCharge > 0 && <div className="flex justify-between text-muted"><span>Service</span><span className="mono">{money(sel.serviceCharge, currency)}</span></div>}
            {sel.vat > 0 && <div className="flex justify-between text-muted"><span>VAT</span><span className="mono">{money(sel.vat, currency)}</span></div>}
            <div className="flex justify-between font-head text-lg pt-1"><span>Total</span><span className="mono text-clay">{money(sel.total, currency)}</span></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PayPill({ s }: { s: string }) {
  const map: Record<string, string> = { paid: "pill-ok", partial: "pill-warn", unpaid: "pill-clay" };
  return <span className={`pill ${map[s] || "pill-clay"} capitalize`}>{s}</span>;
}
