"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Plus, Minus, Trash2, Flame, Send, CreditCard, ShoppingBag } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { MenuItem, CartLine, TableRow, Order, ModifierGroup } from "@/lib/types";
import { PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

type OrderType = "dine-in" | "takeaway" | "delivery";

function OrderInner() {
  const router = useRouter();
  const params = useSearchParams();
  const settings = useSettings();
  const toast = useToast();
  const currency = settings?.currencySymbol || "Rs. ";

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string>("All");
  const [q, setQ] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("dine-in");
  const [tableId, setTableId] = useState<number | null>(null);
  const [priority, setPriority] = useState(false);
  const [note, setNote] = useState("");
  const [cust, setCust] = useState({ name: "", phone: "", address: "" });
  const [sending, setSending] = useState(false);
  const [modItem, setModItem] = useState<MenuItem | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<{ items?: MenuItem[] } | MenuItem[]>("/menu"),
      apiGet<string[] | { name: string }[]>("/categories"),
      apiGet<TableRow[]>("/tables"),
    ]).then(([m, c, t]) => {
      const items = Array.isArray(m) ? m : m.items || [];
      setMenu(items.filter((i) => !i.soldOut));
      const catNames = Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : x.name)) : [];
      setCats(catNames.length ? catNames : Array.from(new Set(items.map((i) => i.category))));
      setTables(Array.isArray(t) ? t : []);
    }).catch(() => toast.push("bad", "Could not load the menu"))
      .finally(() => setLoading(false));
    const presetTable = params.get("tableId");
    if (presetTable) setTableId(Number(presetTable));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let list = menu;
    if (activeCat !== "All") list = list.filter((i) => i.category === activeCat);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = menu.filter((i) => i.name.toLowerCase().includes(s) || (i.plu || "").includes(s));
    }
    return list;
  }, [menu, activeCat, q]);

  function addLine(item: MenuItem, modifiers: CartLine["modifiers"] = [], qty = 1, notes = "") {
    const modTotal = modifiers.reduce((s, m) => s + m.priceDelta, 0);
    setCart((prev) => {
      // merge identical plain lines
      if (!modifiers.length && !notes) {
        const idx = prev.findIndex((c) => c.menuItemId === item.id && !c.modifiers.length && !c.notes);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], qty: copy[idx].qty + qty, lineTotal: +(copy[idx].basePrice * (copy[idx].qty + qty)).toFixed(2) };
          return copy;
        }
      }
      return [...prev, {
        menuItemId: item.id, name: item.name, basePrice: item.price, qty,
        modifiers, notes, stationId: item.stationId ?? null,
        lineTotal: +((item.price + modTotal) * qty).toFixed(2),
      }];
    });
  }

  function onItemClick(item: MenuItem) {
    if (item.modifiers && item.modifiers.length) setModItem(item);
    else addLine(item);
  }

  function changeQty(i: number, delta: number) {
    setCart((prev) => {
      const copy = [...prev];
      const line = copy[i];
      const nextQty = line.qty + delta;
      if (nextQty <= 0) return copy.filter((_, idx) => idx !== i);
      const modTotal = line.modifiers.reduce((s, m) => s + m.priceDelta, 0);
      copy[i] = { ...line, qty: nextQty, lineTotal: +((line.basePrice + modTotal) * nextQty).toFixed(2) };
      return copy;
    });
  }

  const subtotal = cart.reduce((s, c) => s + c.lineTotal, 0);

  async function send(thenPay: boolean) {
    if (!cart.length || sending) return;
    setSending(true);
    const walkInLabel = { takeaway: "Takeaway", delivery: "Delivery", "dine-in": "Walk-in" }[orderType];
    try {
      const order = await apiPost<Order>("/orders", {
        tableId: orderType === "dine-in" ? tableId : null,
        items: cart,
        orderType,
        note,
        tableNameOverride: orderType === "dine-in" && tableId ? (tables.find((t) => t.id === tableId)?.name || "Table") : walkInLabel,
        priority: priority ? "high" : "normal",
        customerName: cust.name, customerPhone: cust.phone, customerAddress: cust.address,
      });
      if (thenPay) {
        router.push(`/payment?orderId=${order.id}`);
      } else {
        toast.push("ok", `${order.displayNum} sent to kitchen · ${money(order.total, currency)}`);
        setCart([]); setNote(""); setPriority(false); setCust({ name: "", phone: "", address: "" });
      }
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Failed to send order");
    } finally { setSending(false); }
  }

  if (loading) return <PageLoader label="Loading menu" />;

  const typeTabs: OrderType[] = ["dine-in", "takeaway", "delivery"];

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-5 -mt-1">
      {/* Menu side */}
      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="inp pl-9" placeholder="Search dish or PLU…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {!q && (
          <div className="flex gap-2 overflow-x-auto pb-3 mb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
            {["All", ...cats].map((c) => (
              <button key={c} onClick={() => setActiveCat(c)}
                className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors border"
                style={activeCat === c
                  ? { background: "var(--olive)", color: "#ffffff", borderColor: "var(--olive)" }
                  : { background: "var(--panel)", color: "var(--muted)", borderColor: "var(--line)" }}>
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {filtered.map((item) => (
            <button key={item.id} onClick={() => onItemClick(item)}
              className="gb-card p-3.5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col gap-2 min-h-[92px] justify-between">
              <div className="font-medium text-[13.5px] leading-snug text-ink line-clamp-2">{item.name}</div>
              <div className="flex items-center justify-between">
                <span className="mono font-head font-semibold text-clay text-[15px]">{money(item.price, currency)}</span>
                {item.modifiers && item.modifiers.length > 0 && (
                  <span className="pill pill-olive !py-0.5 !px-2 !text-[10px]">options</span>
                )}
              </div>
            </button>
          ))}
          {!filtered.length && <div className="col-span-full"><EmptyState title="No dishes found" hint="Try another category or search term." /></div>}
        </div>
      </div>

      {/* Cart side */}
      <aside className="lg:sticky lg:top-[72px] lg:h-[calc(100vh-92px)] flex flex-col gb-card overflow-hidden">
        {/* order type */}
        <div className="p-3 border-b border-line-soft">
          <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
            {typeTabs.map((t) => (
              <button key={t} onClick={() => setOrderType(t)}
                className="flex-1 py-1.5 rounded-full text-[12.5px] font-semibold capitalize transition-colors"
                style={orderType === t ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" } : { color: "var(--muted)" }}>
                {t}
              </button>
            ))}
          </div>
          {orderType === "dine-in" && (
            <select className="inp mt-2.5 !py-2 text-[13px]" value={tableId ?? ""} onChange={(e) => setTableId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Select table (optional)</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.seats} seats{t.status !== "open" ? ` · ${t.status}` : ""}</option>)}
            </select>
          )}
          {orderType !== "dine-in" && (
            <div className="grid grid-cols-2 gap-2 mt-2.5">
              <input className="inp !py-2 text-[13px]" placeholder="Customer name" value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} />
              <input className="inp !py-2 text-[13px]" placeholder="Phone" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} />
              {orderType === "delivery" && <input className="inp !py-2 text-[13px] col-span-2" placeholder="Delivery address" value={cust.address} onChange={(e) => setCust({ ...cust, address: e.target.value })} />}
            </div>
          )}
        </div>

        {/* cart lines */}
        <div className="flex-1 overflow-y-auto p-3">
          {!cart.length ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-muted py-10">
              <ShoppingBag size={30} className="opacity-40" />
              <div className="text-sm">The ticket is empty.<br />Tap a dish to start.</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {cart.map((line, i) => (
                <div key={i} className="rounded-md p-2.5" style={{ background: "var(--panel-2)" }}>
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-ink leading-tight">{line.name}</div>
                      {line.modifiers.map((m, j) => <div key={j} className="text-[11px] text-muted">+ {m.option}{m.priceDelta ? ` (${money(m.priceDelta, currency)})` : ""}</div>)}
                      {line.notes && <div className="text-[11px] text-clay italic">“{line.notes}”</div>}
                    </div>
                    <div className="mono text-[13px] font-semibold text-ink whitespace-nowrap">{money(line.lineTotal, currency)}</div>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => changeQty(i, -1)} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}><Minus size={13} /></button>
                      <span className="mono text-[13px] font-semibold w-5 text-center">{line.qty}</span>
                      <button onClick={() => changeQty(i, 1)} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}><Plus size={13} /></button>
                    </div>
                    <button onClick={() => setCart(cart.filter((_, idx) => idx !== i))} className="text-muted hover:text-bad transition-colors"><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="border-t border-line-soft p-3 space-y-2.5">
          <input className="inp !py-2 text-[13px]" placeholder="Ticket note (e.g. no onion)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex items-center justify-between">
            <button onClick={() => setPriority((p) => !p)}
              className={`btn btn-sm ${priority ? "btn-danger" : "btn-ghost"}`}>
              <Flame size={14} /> {priority ? "Priority" : "Normal"}
            </button>
            <div className="text-right">
              <div className="text-[11px] text-muted uppercase tracking-wide">Subtotal</div>
              <div className="font-head text-xl text-ink mono">{money(subtotal, currency)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => send(false)} disabled={!cart.length || sending} className="btn btn-olive"><Send size={15} /> Kitchen</button>
            <button onClick={() => send(true)} disabled={!cart.length || sending} className="btn btn-primary"><CreditCard size={15} /> Send & Pay</button>
          </div>
        </div>
      </aside>

      {modItem && <ModifierModal item={modItem} currency={currency} onClose={() => setModItem(null)} onAdd={(mods, qty, notes) => { addLine(modItem, mods, qty, notes); setModItem(null); }} />}
    </div>
  );
}

export default function OrderPage() {
  return <Suspense fallback={<PageLoader label="Loading menu" />}><OrderInner /></Suspense>;
}

function ModifierModal({ item, currency, onClose, onAdd }: {
  item: MenuItem; currency: string; onClose: () => void;
  onAdd: (mods: CartLine["modifiers"], qty: number, notes: string) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const groups = item.modifiers as ModifierGroup[];

  const mods = Object.entries(picked).map(([groupName, optName]) => {
    const g = groups.find((x) => x.name === groupName);
    const o = g?.options.find((x) => x.option === optName);
    return { group: groupName, option: optName, priceDelta: o?.priceDelta || 0 };
  });
  const unit = item.price + mods.reduce((s, m) => s + m.priceDelta, 0);

  return (
    <Modal open title={item.name} onClose={onClose} width={420}>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.id}>
            <div className="lbl">{g.name}</div>
            <div className="flex flex-wrap gap-2">
              {g.options.map((o) => {
                const active = picked[g.name] === o.option;
                return (
                  <button key={o.option}
                    onClick={() => setPicked((p) => ({ ...p, [g.name]: active ? "" : o.option }))}
                    className="px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors"
                    style={active ? { background: "var(--olive)", color: "#ffffff", borderColor: "var(--olive)" } : { background: "var(--panel)", borderColor: "var(--line)", color: "var(--ink)" }}>
                    {o.option}{o.priceDelta ? ` +${money(o.priceDelta, currency)}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div>
          <div className="lbl">Note</div>
          <input className="inp" placeholder="Anything for the kitchen?" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--panel-2)" }}><Minus size={15} /></button>
            <span className="mono font-semibold w-6 text-center">{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--panel-2)" }}><Plus size={15} /></button>
          </div>
          <button onClick={() => onAdd(mods, qty, notes)} className="btn btn-primary">Add · {money(unit * qty, currency)}</button>
        </div>
      </div>
    </Modal>
  );
}
