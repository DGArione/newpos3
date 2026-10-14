"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History as HistoryIcon, Search, Receipt, RefreshCw, X, Printer } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";
import type { Order } from "@/lib/types";

type Filter = "all" | "paid" | "unpaid" | "voided";

export default function HistoryPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [detail, setDetail] = useState<Order | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<Order[]>("/orders")
      .then((d) => setOrders(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    let list = [...orders];
    if (filter === "paid") list = list.filter((o) => o.paymentStatus === "paid");
    else if (filter === "unpaid") list = list.filter((o) => o.paymentStatus !== "paid" && o.status !== "voided");
    else if (filter === "voided") list = list.filter((o) => o.status === "voided");
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((o) =>
        (o.displayNum || "").toLowerCase().includes(s) ||
        (o.tableName || "").toLowerCase().includes(s) ||
        (o.customerName || "").toLowerCase().includes(s) ||
        (o.customerPhone || "").includes(s),
      );
    }
    return list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [orders, filter, q]);

  async function refund(o: Order) {
    if (!confirm(`Refund ${o.displayNum} (${money(o.grandTotal, currency)})?`)) return;
    try {
      await apiPost(`/orders/${o.id}/refund`, { reason: "Manager refund" });
      toast.push("ok", `${o.displayNum} refunded`);
      load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="History" subtitle="Every order ever rung in" icon={HistoryIcon}>
          <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
        </PageHeader>

        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="relative flex-1 max-w-md min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="inp pl-9" placeholder="Search by #, table, name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
            {(["all", "paid", "unpaid", "voided"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold capitalize transition-colors"
                style={filter === f
                  ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                  : { color: "var(--muted)" }}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {loading ? <PageLoader /> : !shown.length ? (
          <EmptyState title="No orders found" hint="Try another filter or search." icon={<Receipt size={30} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-2.5">#</th>
                  <th>When</th>
                  <th>Table / Customer</th>
                  <th>Items</th>
                  <th>Status</th>
                  <th className="text-right pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 300).map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-line-soft cursor-pointer hover:bg-panel-2"
                    onClick={() => setDetail(o)}
                  >
                    <td className="py-2.5 font-semibold mono">{o.displayNum}</td>
                    <td className="text-muted text-[12px] whitespace-nowrap">
                      {(o.createdAt || "").replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="text-[12.5px]">
                      {o.tableName || "—"}
                      {o.customerName && <span className="text-muted"> · {o.customerName}</span>}
                    </td>
                    <td className="text-muted text-[12px]">{o.items.length} items</td>
                    <td>
                      <span className={`pill ${o.status === "voided" ? "pill-bad" : o.paymentStatus === "paid" ? "pill-ok" : "pill-warn"}`}>
                        {o.status === "voided" ? "cancelled" : o.paymentStatus}
                      </span>
                    </td>
                    <td className="text-right pr-4 mono font-semibold">{money(o.grandTotal || o.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Screen>

      {detail && (
        <OrderDetail order={detail} currency={currency} onClose={() => setDetail(null)} onRefund={() => refund(detail)} />
      )}
    </div>
  );
}

function OrderDetail({ order, currency, onClose, onRefund }: { order: Order; currency: string; onClose: () => void; onRefund: () => void }) {
  return (
    <Modal open title={`Order ${order.displayNum}`} onClose={onClose} width={520}>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="pill pill-olive">{order.orderType}</span>
        <span className={`pill ${order.status === "voided" ? "pill-bad" : order.paymentStatus === "paid" ? "pill-ok" : "pill-warn"}`}>
          {order.status === "voided" ? "cancelled" : order.paymentStatus}
        </span>
        <span className="text-[12.5px] text-muted ml-auto">
          {(order.createdAt || "").replace("T", " ").slice(0, 16)}
        </span>
      </div>

      {(order.tableName || order.customerName) && (
        <div className="text-[13px] text-muted mb-3">
          {order.tableName && <>Table: <span className="text-ink font-medium">{order.tableName}</span></>}
          {order.customerName && <> {order.tableName ? "·" : ""} {order.customerName} ({order.customerPhone})</>}
        </div>
      )}

      <div className="flex flex-col gap-1 mb-4 max-h-[280px] overflow-y-auto">
        {order.items.map((it, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2" style={{ background: "var(--panel-2)" }}>
            <span className="mono text-[13px] font-semibold text-muted min-w-[26px]">{it.qty}×</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-ink">{it.name}</div>
              {it.modifiers?.map((m, j) => <div key={j} className="text-[11px] text-muted">+ {m.option}</div>)}
              {it.notes && <div className="text-[11px] italic" style={{ color: "var(--olive-700)" }}>“{it.notes}”</div>}
            </div>
            <div className="mono text-[13px] font-semibold whitespace-nowrap">{money(it.lineTotal, currency)}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-4" style={{ background: "var(--panel-2)" }}>
        <TotalLine label="Subtotal" value={money(order.subtotal, currency)} />
        {order.discount > 0 && <TotalLine label="Discount" value={`−${money(order.discount, currency)}`} warn />}
        {order.serviceCharge > 0 && <TotalLine label="Service" value={money(order.serviceCharge, currency)} />}
        {order.vat > 0 && <TotalLine label="VAT" value={money(order.vat, currency)} />}
        <div className="divider my-2" />
        <TotalLine label="Total" value={money(order.grandTotal || order.total, currency)} big />
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={() => printReceipt(order, currency)} className="btn btn-ghost flex-1">
          <Printer size={14} /> Reprint receipt
        </button>
        {order.status !== "voided" && order.paymentStatus === "paid" && (
          <button onClick={onRefund} className="btn btn-danger flex-1">
            <X size={15} /> Refund
          </button>
        )}
      </div>
      {order.status === "voided" && order.voidData && (
        <div className="mt-4 rounded-lg p-3 text-[12.5px]" style={{ background: "var(--bad-wash)", color: "var(--bad)" }}>
          Cancelled by {order.voidData.byStaffName || "staff"}
          {order.voidData.reason ? ` — "${order.voidData.reason}"` : ""}
        </div>
      )}
    </Modal>
  );
}

function TotalLine({ label, value, big, warn }: { label: string; value: string; big?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between items-center" style={{ fontSize: big ? 15 : 12.5, marginBottom: big ? 0 : 4 }}>
      <span className="text-muted" style={{ fontWeight: big ? 600 : 400 }}>{label}</span>
      <span
        className="mono"
        style={{ fontWeight: big ? 700 : 600, color: warn ? "var(--bad)" : big ? "var(--olive-700)" : "var(--ink)" }}
      >
        {value}
      </span>
    </div>
  );
}

/** Open a print-friendly receipt window and send to printer. */
function printReceipt(o: Order, currency: string) {
  const win = window.open("", "_blank", "width=380,height=640");
  if (!win) { alert("Pop-up blocked. Allow pop-ups to print."); return; }
  const lines = o.items.map((it) =>
    `<tr><td>${it.qty}×</td><td>${escapeHtml(it.name)}</td><td style="text-align:right">${currency}${(it.lineTotal).toFixed(2)}</td></tr>` +
    (it.modifiers?.map((m) => `<tr><td></td><td colspan="2" style="padding-left:16px;color:#777;font-size:11px">+ ${escapeHtml(m.option)}</td></tr>`).join("") || "")
  ).join("");
  const html = `<!doctype html><html><head><title>${o.displayNum}</title>
    <style>
      body { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; margin: 10px; }
      h2 { text-align: center; margin: 4px 0; font-size: 16px; }
      .m { text-align: center; font-size: 11px; color: #555; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      td { padding: 2px 0; vertical-align: top; }
      .totals td { border-top: 1px dashed #999; padding-top: 4px; }
      .big { font-size: 16px; font-weight: 700; border-top: 2px solid #000; padding-top: 4px; }
    </style></head><body>
    <h2>${escapeHtml(o.displayNum)}</h2>
    <div class="m">${escapeHtml(o.tableName || "")}${o.customerName ? " · " + escapeHtml(o.customerName) : ""}</div>
    <div class="m">${(o.createdAt || "").replace("T", " ")}</div>
    <table>${lines}</table>
    <table class="totals">
      <tr><td>Subtotal</td><td style="text-align:right">${currency}${o.subtotal.toFixed(2)}</td></tr>
      ${o.discount > 0 ? `<tr><td>Discount</td><td style="text-align:right">−${currency}${o.discount.toFixed(2)}</td></tr>` : ""}
      ${o.serviceCharge > 0 ? `<tr><td>Service</td><td style="text-align:right">${currency}${o.serviceCharge.toFixed(2)}</td></tr>` : ""}
      ${o.vat > 0 ? `<tr><td>VAT</td><td style="text-align:right">${currency}${o.vat.toFixed(2)}</td></tr>` : ""}
      <tr class="big"><td>Total</td><td style="text-align:right">${currency}${(o.grandTotal || o.total).toFixed(2)}</td></tr>
    </table>
    <p class="m" style="margin-top:20px">Thank you!</p>
    <script>window.onload=()=>{window.print();}</script>
    </body></html>`;
  win.document.write(html);
  win.document.close();
}

function escapeHtml(s: string) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
