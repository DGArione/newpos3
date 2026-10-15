"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Banknote, CreditCard, Percent, Ban, Printer, RefreshCw, CheckCircle2,
  Delete, Star, Gift,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { Order } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

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
  const [giftCardOpen, setGiftCardOpen] = useState(false);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ method: "cash" | "card"; amount: number } | null>(null);

  const load = useCallback(async (selectId?: number) => {
    try {
      const data = await apiGet<Order[]>("/orders");
      const list = (Array.isArray(data) ? data : []).filter(
        (o) => o.paymentStatus !== "paid" && o.status !== "voided",
      );
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

  // Step 1: ask to confirm. Cash requires a tendered amount to be entered.
  function requestPay(method: "cash" | "card") {
    if (!selected) return;
    if (method === "cash") {
      if (!tendered || tenderedNum <= 0) {
        toast.push("bad", "Enter how much cash the customer gave first");
        return;
      }
      if (tenderedNum < due) {
        toast.push("bad", `Cash given (${money(tenderedNum, currency)}) is less than the amount due`);
        return;
      }
    }
    const amount = method === "cash" ? due : due;
    setConfirm({ method, amount });
  }

  // Step 2: actually take payment after confirmation.
  async function doPay() {
    if (!selected || !confirm) return;
    setBusy(true);
    try {
      const updated = await apiPost<Order>(`/orders/${selected.id}/pay`, { method: confirm.method, amount: confirm.amount });
      setSelected(updated);
      const changeGiven = confirm.method === "cash" ? Math.max(0, tenderedNum - confirm.amount) : 0;
      setTendered("");
      setConfirm(null);
      if (updated.paymentStatus === "paid") {
        toast.push("ok", `${updated.displayNum} paid${changeGiven > 0 ? ` · change ${money(changeGiven, currency)}` : ""}`);
        load();
      } else {
        toast.push("info", `Recorded ${money(confirm.amount, currency)} — balance remains`);
      }
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Payment failed");
    } finally { setBusy(false); }
  }

  function printBill() {
    if (!selected) return;
    printReceipt(selected, currency, settings?.businessName || "Golden Beach");
  }

  const quick = selected ? [due, 1000, 2000, 5000] : [];
  const hasLoyalty = settings?.enabledAddons?.includes("loyalty");
  const hasGiftcards = settings?.enabledAddons?.includes("giftcards");

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Payment" subtitle={`${orders.length} open ticket${orders.length === 1 ? "" : "s"}`} icon={CreditCard}>
          <button onClick={() => load()} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
        </PageHeader>

        {loading ? <PageLoader /> : (
          <div className="grid lg:grid-cols-[320px_1fr] gap-4">
            {/* ===== Open ticket list ===== */}
            <div className="flex flex-col gap-2 max-h-[72vh] overflow-y-auto pr-1">
              {!orders.length ? (
                <EmptyState
                  title="All settled"
                  hint="No open tickets waiting for payment."
                  icon={<CheckCircle2 size={32} />}
                />
              ) : (
                orders.map((o) => (
                  <button key={o.id} onClick={() => { setSelected(o); setTendered(""); }}
                    className="rounded-xl p-3 text-left transition-all hover:shadow-md"
                    style={{
                      background: selected?.id === o.id ? "var(--olive-wash)" : "var(--panel)",
                      border: selected?.id === o.id ? "1.5px solid var(--olive)" : "1px solid var(--line)",
                    }}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-ink text-[13.5px] truncate">
                          {o.displayNum}
                          {o.tableName && <span className="text-muted ml-1">· {o.tableName}</span>}
                        </div>
                        <div className="text-[11.5px] text-muted capitalize">
                          {o.orderType} · {o.items.length} items
                          {o.priority === "high" ? " · 🔥" : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="mono font-semibold" style={{ color: "var(--olive-700)" }}>
                          {money(o.total, currency)}
                        </div>
                        {o.paymentStatus === "partial" && <span className="pill pill-warn mt-1">partial</span>}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* ===== Detail + tender ===== */}
            {!selected ? (
              <div className="rounded-xl flex items-center justify-center min-h-[400px]"
                style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
                <EmptyState title="Pick a ticket" hint="Select an order on the left to take payment." />
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {/* ---- The real printable bill ---- */}
                <div className="rounded-xl p-5" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
                  {/* Receipt header */}
                  <div className="text-center pb-3 mb-3 border-b border-line-soft">
                    <div className="font-semibold text-[14px] text-ink">
                      {settings?.businessName || "Golden Beach Restaurant"}
                    </div>
                    {settings?.businessAddress && <div className="text-[11px] text-muted">{settings.businessAddress}</div>}
                    {settings?.businessPhone && <div className="text-[11px] text-muted">{settings.businessPhone}</div>}
                  </div>

                  <div className="flex justify-between items-baseline mb-2 text-[12.5px]">
                    <span className="font-semibold text-ink">{selected.displayNum}</span>
                    <span className="text-muted">{selected.tableName || selected.orderType}</span>
                  </div>
                  <div className="text-[11.5px] text-muted mb-3">
                    {(selected.createdAt || "").replace("T", " ").slice(0, 16)}
                    {selected.customerName && <> · {selected.customerName}</>}
                  </div>

                  {/* Items */}
                  <div className="space-y-1.5 mb-4 max-h-56 overflow-y-auto">
                    {selected.items.map((it, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-[13px]">
                          <span className="text-ink">{it.qty}× {it.name}</span>
                          <span className="mono text-ink font-medium">{money(it.lineTotal, currency)}</span>
                        </div>
                        {it.modifiers?.map((m, j) => (
                          <div key={j} className="pl-5 text-[11px] text-muted">+ {m.option}</div>
                        ))}
                        {it.notes && <div className="pl-5 text-[11px] italic" style={{ color: "var(--olive-700)" }}>“{it.notes}”</div>}
                      </div>
                    ))}
                  </div>

                  {/* Totals */}
                  <div className="border-t border-dashed border-line pt-3 space-y-1 text-[13px]">
                    <Row label="Subtotal" value={money(selected.subtotal, currency)} />
                    {selected.discount > 0 && <Row label="Discount" value={`– ${money(selected.discount, currency)}`} warn />}
                    {selected.serviceCharge > 0 && <Row label="Service" value={money(selected.serviceCharge, currency)} />}
                    {selected.vat > 0 && <Row label="VAT" value={money(selected.vat, currency)} />}
                    <div className="flex justify-between pt-1.5 text-[16px] font-semibold border-t border-line mt-2 pt-2">
                      <span>Total</span>
                      <span className="mono" style={{ color: "var(--olive-700)" }}>{money(selected.total, currency)}</span>
                    </div>
                    {(selected.amountPaid || 0) > 0 && (
                      <Row label="Paid" value={money(selected.amountPaid || 0, currency)} ok />
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1.5 mt-4 flex-wrap">
                    <button onClick={printBill} className="btn btn-ghost btn-sm">
                      <Printer size={14} /> Print bill
                    </button>
                    <button onClick={() => setDiscountOpen(true)} className="btn btn-ghost btn-sm">
                      <Percent size={14} /> Discount
                    </button>
                    {hasLoyalty && (
                      <button onClick={() => setLoyaltyOpen(true)} className="btn btn-ghost btn-sm">
                        <Star size={14} /> Loyalty
                      </button>
                    )}
                    {hasGiftcards && (
                      <button onClick={() => setGiftCardOpen(true)} className="btn btn-ghost btn-sm">
                        <Gift size={14} /> Gift card
                      </button>
                    )}
                    <button onClick={() => setVoidOpen(true)} className="btn btn-danger btn-sm ml-auto">
                      <Ban size={14} /> Void
                    </button>
                  </div>
                </div>

                {/* ---- Tender panel ---- */}
                <div className="rounded-xl p-5 flex flex-col" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
                  {selected.paymentStatus === "paid" ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-6">
                      <CheckCircle2 size={44} style={{ color: "var(--ok)" }} />
                      <div className="text-[20px] font-semibold">Paid in full</div>
                      <div className="text-sm text-muted">Order {selected.displayNum} is settled.</div>
                      <button onClick={printBill} className="btn btn-primary">
                        <Printer size={15} /> Print receipt
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-center mb-3">
                        <div className="text-[11px] uppercase tracking-wider text-muted">Amount due</div>
                        <div className="text-[32px] font-semibold text-ink mono mt-1 leading-none">{money(due, currency)}</div>
                      </div>

                      <input className="inp text-center text-xl mono !py-2.5 mb-2" inputMode="numeric" placeholder="0"
                        value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))} />

                      <div className="grid grid-cols-4 gap-1.5 mb-2">
                        {quick.map((amt, i) => (
                          <button key={i} onClick={() => setTendered(String(Math.round(amt)))} className="btn btn-soft btn-sm !px-1">
                            {i === 0 ? "Exact" : money(amt, "")}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 mb-3">
                        {["1","2","3","4","5","6","7","8","9",".","0","⌫"].map((k) => (
                          <button key={k} onClick={() => setTendered((t) => k === "⌫" ? t.slice(0, -1) : t + k)}
                            className="py-2.5 font-semibold rounded-lg transition active:scale-95"
                            style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
                            {k === "⌫" ? <Delete size={16} className="mx-auto" /> : k}
                          </button>
                        ))}
                      </div>

                      {change > 0 && (
                        <div className="text-center text-sm mb-2" style={{ color: "var(--ok)" }}>
                          Change: <span className="mono font-semibold">{money(change, currency)}</span>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 mt-auto">
                        <button onClick={() => requestPay("cash")} disabled={busy} className="btn btn-soft btn-lg">
                          <Banknote size={17} /> Cash
                        </button>
                        <button onClick={() => requestPay("card")} disabled={busy} className="btn btn-primary btn-lg">
                          <CreditCard size={17} /> Card
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Screen>

      {selected && discountOpen && (
        <DiscountModal order={selected} currency={currency} onClose={() => setDiscountOpen(false)}
          onDone={(o) => { setSelected(o); setDiscountOpen(false); toast.push("ok", "Discount applied"); }} />
      )}
      {selected && voidOpen && (
        <VoidModal order={selected} onClose={() => setVoidOpen(false)}
          onDone={() => { setVoidOpen(false); setSelected(null); toast.push("ok", "Order voided"); load(); }} />
      )}
      {selected && giftCardOpen && (
        <GiftCardModal order={selected} currency={currency} onClose={() => setGiftCardOpen(false)}
          onDone={(o) => { setSelected(o); setGiftCardOpen(false); toast.push("ok", "Gift card applied"); load(); }} />
      )}
      {selected && loyaltyOpen && (
        <LoyaltyModal order={selected} currency={currency} onClose={() => setLoyaltyOpen(false)}
          onDone={(o) => { setSelected(o); setLoyaltyOpen(false); toast.push("ok", "Points redeemed"); load(); }} />
      )}

      {/* Payment confirmation */}
      {selected && confirm && (
        <Modal open title="Confirm payment" onClose={() => setConfirm(null)} width={400}>
          <div className="text-center py-2">
            <div className="text-[11px] uppercase tracking-wider text-muted">
              {confirm.method === "cash" ? "Cash payment" : "Card payment"}
            </div>
            <div className="text-[34px] font-semibold mono mt-1" style={{ color: "var(--olive-700)" }}>
              {money(confirm.amount, currency)}
            </div>
            <div className="text-[13px] text-muted mt-1">{selected.displayNum} · {selected.tableName || selected.orderType}</div>
            {confirm.method === "cash" && tenderedNum > 0 && (
              <div className="mt-3 rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
                <div className="flex justify-between text-[13px]"><span className="text-muted">Cash given</span><span className="mono font-semibold">{money(tenderedNum, currency)}</span></div>
                <div className="flex justify-between text-[14px] mt-1"><span className="font-semibold">Change</span>
                  <span className="mono font-bold" style={{ color: "var(--ok)" }}>{money(Math.max(0, tenderedNum - confirm.amount), currency)}</span></div>
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setConfirm(null)} className="btn btn-ghost flex-1">Cancel</button>
            <button onClick={doPay} disabled={busy} className="btn btn-primary flex-1">
              {busy ? "Processing…" : "Confirm & pay"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value, warn, ok }: { label: string; value: string; warn?: boolean; ok?: boolean }) {
  return (
    <div className="flex justify-between" style={{ color: warn ? "var(--bad)" : ok ? "var(--ok)" : "var(--muted)" }}>
      <span>{label}</span>
      <span className="mono font-medium">{value}</span>
    </div>
  );
}

/* ------------------------- Discount modal ------------------------- */
function DiscountModal({ order, currency, onClose, onDone }: { order: Order; currency: string; onClose: () => void; onDone: (o: Order) => void }) {
  const [type, setType] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function apply() {
    setBusy(true); setErr("");
    try { const o = await apiPost<Order>(`/orders/${order.id}/discount`, { type, value, reason, pin }); onDone(o); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not apply"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title="Apply discount" onClose={onClose} width={420}>
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

/* ------------------------- Void modal ------------------------- */
function VoidModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function doVoid() {
    setBusy(true); setErr("");
    try { await apiPost(`/orders/${order.id}/void`, { reason, pin }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not void"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title={`Void ${order.displayNum}`} onClose={onClose} width={420}>
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

/* ------------------------- Gift card redeem ------------------------- */
function GiftCardModal({ order, currency, onClose, onDone }: { order: Order; currency: string; onClose: () => void; onDone: (o: Order) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function apply() {
    setBusy(true); setErr("");
    try {
      const o = await apiPost<Order>(`/orders/${order.id}/giftcard-pay`, { code: code.toUpperCase().trim() });
      onDone(o);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not apply"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title="Pay with gift card" onClose={onClose} width={400}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Enter the gift card code to use its balance towards this order.</p>
        <input className="inp mono uppercase tracking-widest" placeholder="GCXXXXXXXXXX" value={code} autoFocus
          onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={apply} disabled={busy || !code.trim()} className="btn btn-primary w-full">Apply gift card</button>
      </div>
    </Modal>
  );
}

/* ------------------------- Loyalty redeem ------------------------- */
function LoyaltyModal({ order, currency, onClose, onDone }: { order: Order; currency: string; onClose: () => void; onDone: (o: Order) => void }) {
  const [phone, setPhone] = useState(order.customerPhone || "");
  const [points, setPoints] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function apply() {
    setBusy(true); setErr("");
    try {
      const o = await apiPost<Order>(`/orders/${order.id}/loyalty-redeem`, { phone, points: Number(points) || 0 });
      onDone(o);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not redeem"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title="Redeem loyalty points" onClose={onClose} width={400}>
      <div className="space-y-3">
        <div><label className="lbl">Customer phone</label>
          <input className="inp" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><label className="lbl">Points to redeem</label>
          <input className="inp mono" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} /></div>
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={apply} disabled={busy} className="btn btn-primary w-full">Redeem</button>
      </div>
    </Modal>
  );
}

/* ------------------------- Receipt print helper ------------------------- */
function printReceipt(o: Order, currency: string, biz: string) {
  const win = window.open("", "_blank", "width=380,height=720");
  if (!win) { alert("Pop-up blocked. Allow pop-ups to print."); return; }
  const esc = (s: string) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const lines = o.items.map((it) =>
    `<tr><td>${it.qty}×</td><td>${esc(it.name)}</td><td style="text-align:right">${currency}${it.lineTotal.toFixed(2)}</td></tr>` +
    (it.modifiers?.map((m) => `<tr><td></td><td colspan="2" style="padding-left:14px;color:#777;font-size:11px">+ ${esc(m.option)}</td></tr>`).join("") || "")
  ).join("");
  win.document.write(`<!doctype html><html><head><title>${esc(o.displayNum)} — ${esc(biz)}</title>
    <style>
      body { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; margin: 10px; }
      h2 { text-align: center; margin: 4px 0; font-size: 16px; }
      .m { text-align: center; font-size: 11px; color: #555; margin: 2px 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      td { padding: 2px 0; vertical-align: top; }
      .totals td { border-top: 1px dashed #999; padding-top: 4px; }
      .big { font-size: 16px; font-weight: 700; border-top: 2px solid #000; padding-top: 4px; }
      .foot { text-align: center; margin-top: 18px; font-size: 11px; color: #666; }
    </style></head><body>
    <h2>${esc(biz)}</h2>
    <div class="m">${esc(o.displayNum)}</div>
    <div class="m">${esc(o.tableName || o.orderType)}${o.customerName ? " · " + esc(o.customerName) : ""}</div>
    <div class="m">${(o.createdAt || "").replace("T", " ")}</div>
    <table>${lines}</table>
    <table class="totals">
      <tr><td>Subtotal</td><td></td><td style="text-align:right">${currency}${o.subtotal.toFixed(2)}</td></tr>
      ${o.discount > 0 ? `<tr><td>Discount</td><td></td><td style="text-align:right">−${currency}${o.discount.toFixed(2)}</td></tr>` : ""}
      ${o.serviceCharge > 0 ? `<tr><td>Service</td><td></td><td style="text-align:right">${currency}${o.serviceCharge.toFixed(2)}</td></tr>` : ""}
      ${o.vat > 0 ? `<tr><td>VAT</td><td></td><td style="text-align:right">${currency}${o.vat.toFixed(2)}</td></tr>` : ""}
      <tr class="big"><td>Total</td><td></td><td style="text-align:right">${currency}${(o.grandTotal || o.total).toFixed(2)}</td></tr>
      ${o.amountPaid ? `<tr><td>Paid</td><td></td><td style="text-align:right">${currency}${o.amountPaid.toFixed(2)}</td></tr>` : ""}
    </table>
    <p class="foot">Thank you!</p>
    <script>window.onload=()=>{setTimeout(()=>window.print(),200);}</script>
    </body></html>`);
  win.document.close();
}

export default function PaymentPage() {
  return <Suspense fallback={<PageLoader />}><PaymentInner /></Suspense>;
}
