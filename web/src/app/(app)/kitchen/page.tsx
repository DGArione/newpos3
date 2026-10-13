"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, Check, CookingPot, Timer, RefreshCw, ChefHat } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { Order, Station } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, useToast } from "@/components/ui";

const ACTIVE = ["pending", "preparing", "ready"];

export default function KitchenPage() {
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [station, setStation] = useState<number | "all">("all");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([apiGet<Order[]>("/orders"), apiGet<Station[]>("/stations")]);
      setOrders((Array.isArray(o) ? o : []).filter((x) => ACTIVE.includes(x.status)));
      setStations(Array.isArray(s) ? s : []);
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    const c = setInterval(() => setNow(Date.now()), 15000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [load]);

  async function setItem(order: Order, idx: number, status: string) {
    try { const u = await apiPatch<Order>(`/orders/${order.id}/items/${idx}/status`, { status }); mergeOrder(u); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }
  async function bump(order: Order) {
    try { await apiPatch<Order>(`/orders/${order.id}/status`, { status: "ready" }); toast.push("ok", `${order.displayNum} ready`); load(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }
  function mergeOrder(u: Order) {
    setOrders((prev) => prev.map((o) => (o.id === u.id ? u : o)).filter((o) => ACTIVE.includes(o.status)));
  }

  const shown = useMemo(() => {
    let list = [...orders];
    if (station !== "all") {
      list = list.filter((o) => o.items.some((it) => it.stationId === station));
    }
    return list.sort((a, b) => {
      if ((a.priority === "high") !== (b.priority === "high")) return a.priority === "high" ? -1 : 1;
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
  }, [orders, station]);

  if (loading) return <PageLoader label="Loading tickets" />;

  return (
    <div>
      <PageHeader title="Kitchen" subtitle="Live tickets — bump items as they leave the pass.">
        <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      <div className="flex gap-2 overflow-x-auto pb-3 mb-3">
        {(["all", ...stations.map((s) => s.id)] as (number | "all")[]).map((s) => {
          const name = s === "all" ? "All stations" : stations.find((x) => x.id === s)?.name || "";
          return (
            <button key={String(s)} onClick={() => setStation(s)}
              className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap border transition-colors"
              style={station === s ? { background: "var(--olive)", color: "#ffffff", borderColor: "var(--olive)" } : { background: "var(--panel)", color: "var(--muted)", borderColor: "var(--line)" }}>
              {name}
            </button>
          );
        })}
      </div>

      {!shown.length ? (
        <EmptyState title="No tickets" hint="New orders will appear here the moment they're sent." icon={<ChefHat size={34} />} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-start">
          {shown.map((o) => {
            const mins = o.createdAt ? Math.max(0, Math.floor((now - new Date(o.createdAt.replace(" ", "T")).getTime()) / 60000)) : 0;
            const late = mins >= 15;
            const relevant = station === "all" ? o.items : o.items.filter((it) => it.stationId === station);
            return (
              <div key={o.id} className="gb-card overflow-hidden flex flex-col"
                style={o.priority === "high" ? { borderColor: "var(--bad)", borderWidth: 2 } : {}}>
                <div className="px-3.5 py-2.5 flex items-center justify-between"
                  style={{ background: o.priority === "high" ? "var(--bad-wash)" : "var(--olive-wash)" }}>
                  <div className="flex items-center gap-2">
                    {o.priority === "high" && <Flame size={15} className="text-bad" />}
                    <span className="font-head font-semibold text-ink">{o.displayNum}</span>
                  </div>
                  <span className={`pill ${late ? "pill-bad" : "pill-olive"} !gap-1`}><Timer size={12} />{mins}m</span>
                </div>
                <div className="px-3.5 py-1.5 text-[12px] text-muted border-b border-line-soft">
                  {o.tableName} · <span className="capitalize">{o.orderType}</span>
                </div>
                <div className="p-3 flex flex-col gap-1.5 flex-1">
                  {relevant.map((it) => {
                    const idx = o.items.indexOf(it);
                    return (
                      <div key={idx} className="rounded-md px-2.5 py-2" style={{ background: "var(--panel-2)" }}>
                        <div className="flex justify-between items-start gap-2">
                          <div className="text-[13px] font-medium text-ink">{it.qty}× {it.name}</div>
                          <StatusDot status={it.status} />
                        </div>
                        {it.modifiers?.map((m, j) => <div key={j} className="text-[11px] text-muted">+ {m.option}</div>)}
                        {it.notes && <div className="text-[11px] text-clay italic">“{it.notes}”</div>}
                        <div className="flex gap-1.5 mt-1.5">
                          {it.status === "pending" && <button onClick={() => setItem(o, idx, "preparing")} className="btn btn-soft btn-sm flex-1 !py-1"><CookingPot size={13} /> Start</button>}
                          {it.status !== "ready" && <button onClick={() => setItem(o, idx, "ready")} className="btn btn-olive btn-sm flex-1 !py-1"><Check size={13} /> Ready</button>}
                          {it.status === "ready" && <span className="text-[12px] text-ok font-semibold flex items-center gap-1 px-1"><Check size={14} /> Ready</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {o.note && <div className="px-3.5 py-2 text-[12px] text-clay border-t border-line-soft">Note: {o.note}</div>}
                <button onClick={() => bump(o)} className="btn btn-primary rounded-none w-full"><Check size={15} /> All ready</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = { pending: "pill-warn", preparing: "pill-clay", ready: "pill-ok" };
  return <span className={`pill ${map[status] || "pill-olive"} !py-0.5 !px-2 !text-[10px] capitalize`}>{status}</span>;
}
