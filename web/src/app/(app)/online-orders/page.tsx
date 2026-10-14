"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe, ChefHat, Check, Bike, RefreshCw, X, Printer } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { Order } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, Screen, useToast } from "@/components/ui";

export default function OnlineOrdersPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<Order[]>("/orders?all=1");
      setOrders((Array.isArray(d) ? d : [])
        .filter((o) => (o.source === "online" || o.source === "qr") && o.status !== "completed" && o.status !== "voided"));
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);

  async function advance(o: Order, status: string) {
    try { await apiPatch(`/orders/${o.id}/status`, { status }); toast.push("ok", `${o.displayNum} → ${status}`); load(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function accept(o: Order) {
    try {
      await apiPost(`/orders/${o.id}/accept`);
      toast.push("ok", `Accepted ${o.displayNum} — sent to kitchen`);
      load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function reject(o: Order) {
    const reason = prompt("Reason for rejection:");
    if (!reason) return;
    try {
      await apiPost(`/orders/${o.id}/reject`, { reason });
      toast.push("ok", `Rejected ${o.displayNum}`);
      load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Online orders" subtitle="Web & QR orders waiting for acceptance" icon={Globe}>
          <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
        </PageHeader>

        {loading ? <PageLoader /> : !orders.length ? (
          <EmptyState title="No online orders" hint="Orders placed from the web or a table QR will land here." icon={<Globe size={30} />} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {orders.map((o) => (
              <div key={o.id} className="rounded-xl overflow-hidden" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--olive-wash)" }}>
                  <span className="font-semibold text-ink">{o.displayNum}</span>
                  <span className="pill pill-olive capitalize">{o.status}</span>
                </div>
                <div className="p-4">
                  <div className="text-sm font-medium text-ink">{o.customerName || o.tableName || "Online guest"}</div>
                  {o.customerPhone && <div className="text-[12px] text-muted">{o.customerPhone}</div>}
                  {o.customerAddress && <div className="text-[12px] text-muted mt-0.5">{o.customerAddress}</div>}

                  <div className="my-3 space-y-1">
                    {o.items.map((it, i) => (
                      <div key={i} className="flex justify-between text-[13px]">
                        <span>{it.qty}× {it.name}</span>
                        <span className="mono text-muted">{money(it.lineTotal, currency)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between font-semibold border-t border-line-soft pt-2">
                    <span>Total</span>
                    <span className="mono" style={{ color: "var(--olive-700)" }}>{money(o.total, currency)}</span>
                  </div>

                  <div className="flex gap-2 mt-3 flex-wrap">
                    {o.status === "pending" || o.status === "new" ? (
                      <>
                        <button onClick={() => reject(o)} className="btn btn-danger btn-sm">
                          <X size={13} /> Reject
                        </button>
                        <button onClick={() => accept(o)} className="btn btn-kot btn-sm flex-1">
                          <ChefHat size={13} /> Accept & send
                        </button>
                      </>
                    ) : o.status === "preparing" ? (
                      <button onClick={() => advance(o, "ready")} className="btn btn-primary btn-sm flex-1">
                        <Check size={13} /> Ready
                      </button>
                    ) : o.status === "ready" ? (
                      <button onClick={() => advance(o, "dispatched")} className="btn btn-soft btn-sm flex-1">
                        <Bike size={13} /> Dispatch
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Screen>
    </div>
  );
}
