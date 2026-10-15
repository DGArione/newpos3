"use client";

/*
 * Customer-facing menu for a scanned table QR. Vintage olive / kraft theme,
 * self-contained styling (independent of the POS orange theme).
 * Browse → add to cart → place order (flows straight into the POS kitchen).
 * Also lets guests request a table reservation.
 */

import { use, useEffect, useMemo, useState } from "react";

interface TableInfo { ok: boolean; branchId: number; branchName: string; branchActive: boolean; tableId: number; tableName: string; businessName: string }
interface MenuItem { id: number; name: string; price: number; category: string; imageUrl?: string; soldOut?: boolean }
interface MenuResp { items: MenuItem[]; categories: string[]; currency: string }
interface Line { id: number; name: string; price: number; qty: number }

const API = "/api";

export default function TableMenuPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<TableInfo | null>(null);
  const [menu, setMenu] = useState<MenuResp | null>(null);
  const [err, setErr] = useState("");
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);
  const [tab, setTab] = useState<"menu" | "reserve">("menu");

  useEffect(() => {
    fetch(`${API}/public/table?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d || d.error) { setErr(d?.error || "This QR code is not recognised."); return; }
        setInfo(d);
        return fetch(`${API}/public/menu?branchId=${d.branchId}`).then((r) => r.json()).then((m) => setMenu(m));
      })
      .catch(() => setErr("Could not load the menu. Please check your connection."));
  }, [token]);

  const cur = menu?.currency || "Rs. ";
  const money = (n: number) => `${cur}${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const cats = useMemo(() => menu?.categories?.length ? menu.categories : Array.from(new Set((menu?.items || []).map((i) => i.category))), [menu]);
  const shown = useMemo(() => {
    let list = (menu?.items || []).filter((i) => !i.soldOut);
    if (q.trim()) { const s = q.toLowerCase(); return list.filter((i) => i.name.toLowerCase().includes(s)); }
    if (cat !== "All") list = list.filter((i) => i.category === cat);
    return list;
  }, [menu, cat, q]);

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const count = cart.reduce((s, l) => s + l.qty, 0);

  function add(it: MenuItem) {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.id === it.id);
      if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], qty: c[i].qty + 1 }; return c; }
      return [...prev, { id: it.id, name: it.name, price: it.price, qty: 1 }];
    });
  }
  function changeQty(id: number, d: number) {
    setCart((prev) => prev.map((l) => l.id === id ? { ...l, qty: Math.max(0, l.qty + d) } : l).filter((l) => l.qty > 0));
  }

  async function placeOrder(customerName: string, customerPhone: string) {
    if (!cart.length) return;
    setPlacing(true);
    try {
      const r = await fetch(`${API}/public/table-order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, items: cart.map((l) => ({ menuItemId: l.id, qty: l.qty })), note, customerName, customerPhone }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setPlaced(r.displayNum || "sent");
      setCart([]); setNote(""); setCartOpen(false);
    } catch (e) { alert(e instanceof Error ? e.message : "Could not place order"); }
    finally { setPlacing(false); }
  }

  // ---- styling tokens (vintage olive / kraft) ----
  const C = {
    bg: "#efe7d4", paper: "#f7f1e2", ink: "#2b2a20", muted: "#7c745c",
    olive: "#4c5738", oliveD: "#3a4229", line: "#ddd1b4", clay: "#a7683b",
  };

  if (err) return (
    <Shell C={C}>
      <div style={{ textAlign: "center", padding: "80px 20px", color: C.muted }}>
        <div style={{ fontSize: 42, marginBottom: 10 }}>🍽️</div>
        <p style={{ fontSize: 16 }}>{err}</p>
      </div>
    </Shell>
  );
  if (!info || !menu) return <Shell C={C}><div style={{ textAlign: "center", padding: 80, color: C.muted }}>Loading menu…</div></Shell>;

  return (
    <Shell C={C}>
      {/* header */}
      <header style={{ textAlign: "center", padding: "30px 20px 18px" }}>
        <div style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: C.clay, fontWeight: 700 }}>Welcome to</div>
        <h1 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 34, color: C.olive, margin: "6px 0 2px", fontWeight: 600 }}>
          {info.businessName}
        </h1>
        <div style={{ fontSize: 12.5, color: C.muted }}>You're at <b style={{ color: C.ink }}>{info.tableName}</b> · {info.branchName}</div>
      </header>

      {/* tabs */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 14 }}>
        {(["menu", "reserve"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: "8px 20px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer",
              border: `1.5px solid ${tab === t ? C.olive : C.line}`,
              background: tab === t ? C.olive : "transparent", color: tab === t ? "#fff" : C.muted,
            }}>
            {t === "menu" ? "Menu" : "Reserve a table"}
          </button>
        ))}
      </div>

      {placed ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 46 }}>✅</div>
          <h2 style={{ fontFamily: "'Fraunces',serif", color: C.olive, fontSize: 24, margin: "10px 0 4px" }}>Order sent!</h2>
          <p style={{ color: C.muted, fontSize: 14 }}>Your order <b>{placed}</b> is on its way to the kitchen.</p>
          <button onClick={() => setPlaced(null)} style={btnStyle(C, true)} >Order more</button>
        </div>
      ) : tab === "reserve" ? (
        <ReserveForm C={C} branchId={info.branchId} money={money} />
      ) : (
        <>
          {/* search */}
          <div style={{ padding: "0 16px 10px" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes…"
              style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: `1.5px solid ${C.line}`, background: C.paper, color: C.ink, fontSize: 14, outline: "none" }} />
          </div>
          {/* categories */}
          {!q && (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 16px 14px" }}>
              {["All", ...cats].map((c) => (
                <button key={c} onClick={() => setCat(c)}
                  style={{
                    whiteSpace: "nowrap", padding: "7px 15px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer",
                    border: `1.5px solid ${cat === c ? C.olive : C.line}`, background: cat === c ? C.olive : C.paper,
                    color: cat === c ? "#fff" : C.muted,
                  }}>{c}</button>
              ))}
            </div>
          )}
          {/* items */}
          <div style={{ padding: "0 16px 120px", display: "flex", flexDirection: "column", gap: 10 }}>
            {shown.map((it) => (
              <div key={it.id} style={{ display: "flex", gap: 12, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 16, padding: 12, alignItems: "center" }}>
                {it.imageUrl && <img src={it.imageUrl} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover", flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Fraunces',serif", fontSize: 16, color: C.ink, fontWeight: 600, lineHeight: 1.2 }}>{it.name}</div>
                  <div style={{ fontSize: 15, color: C.clay, fontWeight: 700, marginTop: 4 }}>{money(it.price)}</div>
                </div>
                <button onClick={() => add(it)} aria-label="Add"
                  style={{ width: 38, height: 38, borderRadius: 11, border: "none", background: C.olive, color: "#fff", fontSize: 22, cursor: "pointer", flexShrink: 0, lineHeight: 1 }}>+</button>
              </div>
            ))}
            {!shown.length && <div style={{ textAlign: "center", color: C.muted, padding: 40 }}>No dishes found.</div>}
          </div>
        </>
      )}

      {/* floating cart bar */}
      {tab === "menu" && count > 0 && !placed && (
        <button onClick={() => setCartOpen(true)}
          style={{
            position: "fixed", left: 16, right: 16, bottom: 16, maxWidth: 560, margin: "0 auto",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 20px", borderRadius: 16, border: "none", background: C.olive, color: "#fff",
            fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 30px -10px rgba(0,0,0,.4)",
          }}>
          <span>{count} item{count > 1 ? "s" : ""}</span>
          <span>View cart · {money(total)}</span>
        </button>
      )}

      {/* cart sheet */}
      {cartOpen && (
        <CartSheet C={C} cart={cart} money={money} note={note} setNote={setNote}
          changeQty={changeQty} total={total} placing={placing}
          onClose={() => setCartOpen(false)} onPlace={placeOrder} />
      )}
    </Shell>
  );
}

function Shell({ C, children }: { C: Record<string, string>; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "'Hanken Grotesk',system-ui,sans-serif" }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 600, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

function btnStyle(C: Record<string, string>, primary = false): React.CSSProperties {
  return {
    marginTop: 16, padding: "12px 24px", borderRadius: 12, border: "none",
    background: primary ? C.olive : C.paper, color: primary ? "#fff" : C.ink,
    fontSize: 14, fontWeight: 700, cursor: "pointer",
  };
}

function CartSheet({ C, cart, money, note, setNote, changeQty, total, placing, onClose, onPlace }: {
  C: Record<string, string>; cart: Line[]; money: (n: number) => string;
  note: string; setNote: (v: string) => void; changeQty: (id: number, d: number) => void;
  total: number; placing: boolean; onClose: () => void; onPlace: (name: string, phone: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 600, background: C.bg, borderRadius: "22px 22px 0 0", padding: 18, maxHeight: "86vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontFamily: "'Fraunces',serif", fontSize: 20, color: C.olive, margin: 0 }}>Your order</h3>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 22, color: C.muted, cursor: "pointer" }}>✕</button>
        </div>
        {cart.map((l) => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{l.name}</div>
              <div style={{ fontSize: 12.5, color: C.clay, fontWeight: 700 }}>{money(l.price * l.qty)}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => changeQty(l.id, -1)} style={qtyBtn(C)}>−</button>
              <span style={{ width: 20, textAlign: "center", fontWeight: 700 }}>{l.qty}</span>
              <button onClick={() => changeQty(l.id, 1)} style={qtyBtn(C)}>+</button>
            </div>
          </div>
        ))}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the kitchen (optional)"
          style={{ width: "100%", marginTop: 12, padding: "10px 13px", borderRadius: 11, border: `1.5px solid ${C.line}`, background: C.paper, fontSize: 13.5, outline: "none" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)"
            style={{ flex: 1, padding: "10px 13px", borderRadius: 11, border: `1.5px solid ${C.line}`, background: C.paper, fontSize: 13.5, outline: "none" }} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)"
            style={{ flex: 1, padding: "10px 13px", borderRadius: 11, border: `1.5px solid ${C.line}`, background: C.paper, fontSize: 13.5, outline: "none" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 10px" }}>
          <span style={{ fontSize: 14, color: C.muted }}>Total</span>
          <span style={{ fontFamily: "'Fraunces',serif", fontSize: 22, color: C.olive, fontWeight: 600 }}>{money(total)}</span>
        </div>
        <button onClick={() => onPlace(name, phone)} disabled={placing}
          style={{ width: "100%", padding: 15, borderRadius: 14, border: "none", background: C.olive, color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
          {placing ? "Sending…" : "Send order to kitchen"}
        </button>
      </div>
    </div>
  );
}

function ReserveForm({ C, branchId, money }: { C: Record<string, string>; branchId: number; money: (n: number) => string }) {
  const [f, setF] = useState({ customerName: "", customerPhone: "", partySize: "2", reserveDate: "", reserveTime: "19:00", note: "" });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!f.customerName && !f.customerPhone) { alert("Please add your name or phone"); return; }
    if (!f.reserveDate || !f.reserveTime) { alert("Pick a date and time"); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API}/public/reservation`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, partySize: Number(f.partySize) || 1, branchId }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setDone(true);
    } catch (e) { alert(e instanceof Error ? e.message : "Could not book"); }
    finally { setBusy(false); }
  }
  if (done) return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      <div style={{ fontSize: 46 }}>📅</div>
      <h2 style={{ fontFamily: "'Fraunces',serif", color: C.olive, fontSize: 24, margin: "10px 0 4px" }}>Booking requested!</h2>
      <p style={{ color: C.muted, fontSize: 14 }}>We'll confirm your table shortly. Thank you!</p>
    </div>
  );
  const inp = { width: "100%", padding: "11px 13px", borderRadius: 11, border: `1.5px solid ${C.line}`, background: C.paper, color: C.ink, fontSize: 14, outline: "none" } as React.CSSProperties;
  const lbl = { fontSize: 11.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".04em", display: "block", margin: "0 0 5px" } as React.CSSProperties;
  return (
    <div style={{ padding: "0 18px 40px" }}>
      <p style={{ textAlign: "center", color: C.muted, fontSize: 13.5, marginBottom: 18 }}>Reserve a table and we'll have it ready for you.</p>
      <div style={{ display: "grid", gap: 12 }}>
        <div><label style={lbl}>Name</label><input style={inp} value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></div>
        <div><label style={lbl}>Phone</label><input style={inp} value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div><label style={lbl}>Party</label><input style={inp} type="number" min={1} value={f.partySize} onChange={(e) => setF({ ...f, partySize: e.target.value })} /></div>
          <div><label style={lbl}>Date</label><input style={inp} type="date" value={f.reserveDate} onChange={(e) => setF({ ...f, reserveDate: e.target.value })} /></div>
          <div><label style={lbl}>Time</label><input style={inp} type="time" value={f.reserveTime} onChange={(e) => setF({ ...f, reserveTime: e.target.value })} /></div>
        </div>
        <div><label style={lbl}>Note</label><input style={inp} placeholder="Window seat, birthday…" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <button onClick={submit} disabled={busy} style={{ padding: 14, borderRadius: 13, border: "none", background: C.olive, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          {busy ? "Booking…" : "Request reservation"}
        </button>
      </div>
    </div>
  );
}

function qtyBtn(C: Record<string, string>): React.CSSProperties {
  return { width: 30, height: 30, borderRadius: 9, border: `1.5px solid ${C.line}`, background: C.paper, color: C.ink, fontSize: 18, cursor: "pointer", lineHeight: 1 };
}
