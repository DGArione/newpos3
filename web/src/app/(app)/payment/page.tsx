"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Banknote, CreditCard, Percent, Ban, Printer, RefreshCw, CheckCircle2, Delete } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { Order } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

function PaymentInner() {
  const params = useSearchParams();
  const settings = useSettings();
  const toast = useToast();
  const currency = settings?.currencySymbol || "Rs. ";

  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const load = useCallback(async (selectId?: number) => {
    try {
      const data = await apiGet<Order[]>("/orders");
      const list = (Array.isArray(data) ? data : []).filter((o) => o.paymentStatus !== "paid" && o.status !== "voided");
      setOrders(list);
      if (selectId) {
        const found = list.find((o) => o.id === selectId);
        if (found) setSelected(found);
      }
    } catch {
      toast.push("bad", "Could not load orders");
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => {
    load(params.get("orderId") ? Number(params.get("orderId")) : undefined);
    const t = setInterval(() => load(), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const due = selected ? (selected.total - (selected.amountPaid || 0)) : 0;
  const tenderedNum = Number(tendered) || 0;
  const change = tenderedNum > due ? tenderedNum - due : 0;

  async function pay(method: "cash" | "card") {
    if (!selected) return;
    const amount = method === "cash" ? Math.min(tenderedNum || due, due) : due;
    if (amount <= 0) { toast.push("bad", "Enter an amount"); return; }
    setBusy(true);
    try {
      const updated = await apiPost<Order>(`/orders/${selected.id}/pay`, { method, amount });
      setSelected(updated);
      setTendered("");
      if (updated.paymentStatus === "paid") {
        toast.push("ok", `${updated.displayNum} fully paid${change > 0 ? ` · change ${money(change, currency)}` : ""}`);
        load();
      } else {
        toast.push("info", `Recorded ${money(amount, currency)} — balance remains`);
      }
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Payment failed");
    } finally { setBusy(false); }
  }

  const quick = [due, 1000, 2000, 5000];

  return (
    <div>
      <PageHeader title="Payment" subtitle="Settle open tickets — cash, card, or split.">
        <button onClick={() => load()} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      {loading ? <PageLoader /> : (
        <div className="grid lg:grid-cols-[340px_1fr] gap-5">
          {/* order list */}
          <div className="flex flex-col gap-2">
            {!orders.length && <EmptyState title="All settled" hint="No open tickets waiting for payment." icon={<CheckCircle2 size={32} />} />}
            {orders.map((o) => (
              <button key={o.id} onClick={() => { setSelected(o); setTendered(""); }}
                className="gb-card p-3.5 text-left transition-all hover:shadow-md"
                style={selected?.id === o.id ? { borderColor: "var(--olive)", boxShadow: "var(--shadow-md)" } : {}}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-head font-semibold text-ink">{o.displayNum} · {o.tableName}</div>
                    <div className="text-[12px] text-muted capitalize">{o.orderType} · {o.items.length} items{o.priority === "high" ? " · 🔥" : ""}</div>
                  </div>
                  <div className="text-right">
                    <div className="mono font-semibold text-clay">{money(o.total, currency)}</div>
                    {o.paymentStatus === "partial" && <span className="pill pill-warn mt-1">partial</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* detail + tender */}
          {!selected ? (
            <div className="gb-card"><EmptyState title="Pick a ticket" hint="Select an order on the left to take payment." /></div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="gb-card p-5">
                <div className="flex justify-between items-baseline mb-3">
                  <h3 className="font-head text-lg">{selected.displayNum}</h3>
                  <span className="text-sm text-muted">{selected.tableName}</span>
                </div>
                <div className="space-y-1.5 mb-4 max-h-64 overflow-y-auto">
                  {selected.items.map((it, i) => (
                    <div key={i} className="flex justify-between text-[13px]">
                      <span className="text-ink">{it.qty}× {it.name}</span>
                      <span className="mono text-muted">{money(it.lineTotal, currency)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-line-soft pt-3 space-y-1 text-[13px]">
                  <Row label="Subtotal" value={money(selected.subtotal, currency)} />
                  {selected.discount > 0 && <Row label="Discount" value={`– ${money(selected.discount, currency)}`} />}
                  {selected.serviceCharge > 0 && <Row label="Service" value={money(selected.serviceCharge, currency)} />}
                  {selected.vat > 0 && <Row label="VAT" value={money(selected.vat, currency)} />}
                  <div className="flex justify-between pt-1.5 font-head text-lg">
                    <span>Total</span><span className="mono text-clay">{money(selected.total, currency)}</span>
                  </div>
                  {(selected.amountPaid || 0) > 0 && <Row label="Paid" value={money(selected.amountPaid || 0, currency)} />}
                </div>

                <div className="flex gap-2 mt-4">
                  <button onClick={() => setDiscountOpen(true)} className="btn btn-ghost btn-sm flex-1"><Percent size={14} /> Discount</button>
                  <button onClick={() => setVoidOpen(true)} className="btn btn-danger btn-sm flex-1"><Ban size={14} /> Void</button>
                </div>
              </div>

              {/* tender */}
              <div className="gb-card p-5 flex flex-col">
                {selected.paymentStatus === "paid" ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-6">
                    <CheckCircle2 size={44} className="text-ok" />
                    <div className="font-head text-xl">Paid in full</div>
                    <a href={`/api/orders/${selected.id}`} onClick={(e) => { e.preventDefault(); window.print(); }} className="btn btn-olive"><Printer size={15} /> Print receipt</a>
                  </div>
                ) : (
                  <>
                    <div className="text-center mb-3">
                      <div className="text-[11px] uppercase tracking-wider text-muted">Amount due</div>
                      <div className="font-head text-3xl text-ink mono">{money(due, currency)}</div>
                    </div>
                    <input className="inp text-center text-xl mono !py-2.5 mb-2" inputMode="numeric" placeholder="0"
                      value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))} />
                    <div className="grid grid-cols-4 gap-1.5 mb-2">
                      {quick.map((amt, i) => (
                        <button key={i} onClick={() => setTendered(String(Math.round(amt)))} className="btn btn-soft btn-sm !px-1">{i === 0 ? "Exact" : money(amt, "")}</button>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 mb-3">
                      {["1","2","3","4","5","6","7","8","9",".","0","⌫"].map((k) => (
                        <button key={k} onClick={() => setTendered((t) => k === "⌫" ? t.slice(0, -1) : t + k)}
                          className="gb-card py-2.5 font-head text-lg hover:bg-panel-2 transition">{k === "⌫" ? <Delete size={17} className="mx-auto" /> : k}</button>
                      ))}
                    </div>
                    {change > 0 && <div className="text-center text-sm text-ok mb-2">Change: <span className="mono font-semibold">{money(change, currency)}</span></div>}
                    <div className="grid grid-cols-2 gap-2 mt-auto">
                      <button onClick={() => pay("cash")} disabled={busy} className="btn btn-olive btn-lg"><Banknote size={17} /> Cash</button>
                      <button onClick={() => pay("card")} disabled={busy} className="btn btn-primary btn-lg"><CreditCard size={17} /> Card</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {selected && discountOpen && (
        <DiscountModal order={selected} currency={currency} onClose={() => setDiscountOpen(false)}
          onDone={(o) => { setSelected(o); setDiscountOpen(false); toast.push("ok", "Discount applied"); }} />
      )}
      {selected && voidOpen && (
        <VoidModal order={selected} onClose={() => setVoidOpen(false)}
          onDone={() => { setVoidOpen(false); setSelected(null); toast.push("ok", "Order voided"); load(); }} />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-muted"><span>{label}</span><span className="mono">{value}</span></div>;
}

function DiscountModal({ order, currency, onClose, onDone }: { order: Order; currency: string; onClose: () => void; onDone: (o: Order) => void; }) {
  const [type, setType] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function apply() {
    setBusy(true); setErr("");
    try {
      const o = await apiPost<Order>(`/orders/${order.id}/discount`, { type, value, reason, pin });
      onDone(o);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not apply"); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Apply discount" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
          {(["percent", "amount"] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className="flex-1 py-1.5 rounded-full text-[13px] font-semibold capitalize"
              style={type === t ? { background: "var(--panel)", color: "var(--olive-700)" } : { color: "var(--muted)" }}>
              {t === "percent" ? "Percent %" : `Amount (${currency.trim()})`}
            </button>
          ))}
        </div>
        <input className="inp" inputMode="numeric" placeholder={type === "percent" ? "e.g. 10" : "e.g. 500"} value={value} onChange={(e) => setValue(e.target.value)} />
        <input className="inp" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input className="inp" type="password" placeholder="Manager PIN (if required)" value={pin} onChange={(e) => setPin(e.target.value)} />
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={apply} disabled={busy} className="btn btn-primary w-full">Apply discount</button>
      </div>
    </Modal>
  );
}

function VoidModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void; }) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function doVoid() {
    setBusy(true); setErr("");
    try { await apiPost(`/orders/${order.id}/void`, { reason, pin }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not void"); } finally { setBusy(false); }
  }
  return (
    <Modal open title={`Void ${order.displayNum}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Voiding reverses the ticket and returns stock. This needs a manager PIN.</p>
        <input className="inp" placeholder="Reason for void" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input className="inp" type="password" placeholder="Manager PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={doVoid} disabled={busy} className="btn btn-danger w-full">Void order</button>
      </div>
    </Modal>
  );
}

export default function PaymentPage() {
  return <Suspense fallback={<PageLoader />}><PaymentInner /></Suspense>;
}
