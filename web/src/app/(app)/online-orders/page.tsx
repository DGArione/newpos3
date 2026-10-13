"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe, ChefHat, Check, Bike, RefreshCw } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { Order } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, useToast } from "@/components/ui";

export default function OnlineOrdersPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<Order[]>("/orders?all=1");
      setOrders((Array.isArray(d) ? d : []).filter((o) => (o.source === "online" || o.source === "qr") && o.status !== "completed" && o.status !== "voided"));
    } catch { /* keep */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);

  async function advance(o: Order, status: string) {
    try { await apiPatch(`/orders/${o.id}/status`, { status }); toast.push("ok", `${o.displayNum} → ${status}`); load(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div>
      <PageHeader title="Online orders" subtitle="Web & QR orders coming into the kitchen.">
        <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      {loading ? <PageLoader /> : !orders.length ? <EmptyState title="No online orders" hint="Orders placed from the web or a table QR will land here." icon={<Globe size={30} />} /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {orders.map((o) => (
            <div key={o.id} className="gb-card overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--olive-wash)" }}>
                <span className="font-head font-semibold">{o.displayNum}</span>
                <span className="pill pill-olive capitalize">{o.status}</span>
              </div>
              <div className="p-4">
                <div className="text-sm font-medium">{o.customerName || o.tableName || "Online guest"}</div>
                {o.customerPhone && <div className="text-[12px] text-muted">{o.customerPhone}</div>}
                {o.customerAddress && <div className="text-[12px] text-muted mt-0.5">{o.customerAddress}</div>}
                <div className="my-3 space-y-1">
                  {o.items.map((it, i) => <div key={i} className="flex justify-between text-[13px]"><span>{it.qty}× {it.name}</span><span className="mono text-muted">{money(it.lineTotal, currency)}</span></div>)}
                </div>
                <div className="flex justify-between font-head border-t border-line-soft pt-2"><span>Total</span><span className="mono text-clay">{money(o.total, currency)}</span></div>
                <div className="flex gap-2 mt-3">
                  {o.status === "pending" && <button onClick={() => advance(o, "preparing")} className="btn btn-olive btn-sm flex-1"><ChefHat size={14} /> Accept</button>}
                  {o.status === "preparing" && <button onClick={() => advance(o, "ready")} className="btn btn-primary btn-sm flex-1"><Check size={14} /> Ready</button>}
                  {o.status === "ready" && <button onClick={() => advance(o, "dispatched")} className="btn btn-soft btn-sm flex-1"><Bike size={14} /> Dispatch</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
