"use client";

import { useEffect, useState } from "react";
import { Gift, Plus, Search, Ban, CheckCircle2, Copy, Printer } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface GiftCard {
  id: number;
  code: string;
  initialBalance: number;
  balance: number;
  status: "active" | "disabled";
  recipientName?: string;
  note?: string;
  issuedByName?: string;
  createdAt?: string;
}
interface Report { count: number; issued: number; outstanding: number; redeemed: number }

export default function GiftCardsPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<GiftCard[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [lookup, setLookup] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([apiGet<GiftCard[]>("/giftcards"), apiGet<Report>("/giftcards/report")])
      .then(([l, r]) => { setList(Array.isArray(l) ? l : []); setReport(r); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  async function toggle(c: GiftCard) {
    try {
      const u = await apiPost<GiftCard>(`/giftcards/${c.id}/toggle`);
      setList((p) => p.map((x) => (x.id === u.id ? u : x)));
      toast.push("ok", `${c.code} ${u.status === "active" ? "re-enabled" : "disabled"}`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  function copyCode(code: string) {
    try { navigator.clipboard.writeText(code); toast.push("ok", `${code} copied`); }
    catch { toast.push("bad", "Could not copy"); }
  }

  function printCard(c: GiftCard) {
    const biz = settings?.businessName || "Gift Card";
    const bal = money(c.balance, currency);
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m] as string));
    const barcode = `https://barcodeapi.org/api/128/${encodeURIComponent(c.code)}`;
    const win = window.open("", "_blank", "width=520,height=360");
    if (!win) { toast.push("bad", "Pop-up blocked — allow pop-ups to print"); return; }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Gift card ${esc(c.code)}</title>
      <style>
        @page { size: 90mm 55mm; margin: 0; }
        * { box-sizing: border-box; }
        body { margin:0; font-family: "Poppins", Arial, sans-serif; }
        .card { width:90mm; height:55mm; padding:6mm 7mm; color:#fff;
          background: linear-gradient(135deg,#f6990d 0%,#b4690a 100%);
          display:flex; flex-direction:column; justify-content:space-between; }
        .top { display:flex; justify-content:space-between; align-items:flex-start; }
        .biz { font-size:13px; font-weight:800; letter-spacing:.5px; }
        .tag { font-size:9px; text-transform:uppercase; letter-spacing:2px; opacity:.85; }
        .bal { font-size:30px; font-weight:800; letter-spacing:.5px; }
        .bal small { font-size:11px; font-weight:600; opacity:.85; }
        .bc { background:#fff; border-radius:4px; padding:3px 6px; }
        .bc img { height:34px; width:100%; object-fit:contain; display:block; }
        .code { text-align:center; font-family:monospace; font-size:11px; letter-spacing:2px; color:#333; }
        .foot { font-size:8.5px; opacity:.8; }
      </style></head><body>
      <div class="card">
        <div class="top"><div class="biz">${esc(biz)}</div><div class="tag">Gift Card</div></div>
        <div class="bal">${esc(bal)} <small>balance</small></div>
        <div class="bc"><img src="${barcode}" alt="${esc(c.code)}"><div class="code">${esc(c.code)}</div></div>
        <div class="foot">${c.recipientName ? "For " + esc(c.recipientName) + " · " : ""}Present this card or scan the barcode to redeem.</div>
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print();},300);};window.onafterprint=function(){window.close();};</script>
      </body></html>`);
    win.document.close();
  }

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Gift Cards" subtitle={`${list.length} cards on file`} icon={Gift}>
          <button onClick={() => setLookup(true)} className="btn btn-ghost btn-sm"><Search size={14} /> Look up</button>
          <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><Plus size={14} /> New card</button>
        </PageHeader>

        {report && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Active cards"  value={String(report.count)} />
            <Tile label="Issued"       value={money(report.issued, currency)} accent />
            <Tile label="Outstanding"  value={money(report.outstanding, currency)} />
            <Tile label="Redeemed"     value={money(report.redeemed, currency)} />
          </div>
        )}
      </Screen>

      <Screen>
        <h2 className="text-[15px] font-semibold text-ink mb-4">Recent cards</h2>
        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState title="No gift cards yet" hint="Create your first card above." icon={<Gift size={30} />} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((c) => (
              <div
                key={c.id}
                className="rounded-xl p-4 relative overflow-hidden"
                style={{
                  background: c.status === "active"
                    ? "linear-gradient(135deg, var(--olive) 0%, var(--olive-700) 100%)"
                    : "var(--panel-2)",
                  color: c.status === "active" ? "#ffffff" : "var(--muted)",
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="pill"
                      style={{
                        background: c.status === "active" ? "rgba(255,255,255,.2)" : "var(--bad-wash)",
                        color: c.status === "active" ? "#ffffff" : "var(--bad)",
                      }}
                    >
                      {c.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => printCard(c)}
                      className="opacity-80 hover:opacity-100"
                      title="Print gift card with barcode"
                    >
                      <Printer size={14} />
                    </button>
                    <button
                      onClick={() => toggle(c)}
                      className="opacity-80 hover:opacity-100"
                      title={c.status === "active" ? "Disable card" : "Re-enable card"}
                    >
                      {c.status === "active" ? <Ban size={14} /> : <CheckCircle2 size={14} />}
                    </button>
                  </div>
                </div>
                <div className="mono text-[20px] font-semibold my-3">{money(c.balance, currency)}</div>
                {/* Scannable barcode (CODE128) */}
                <div className="rounded-md bg-white p-1.5 mb-2">
                  <img
                    src={`https://barcodeapi.org/api/128/${encodeURIComponent(c.code)}`}
                    alt={c.code}
                    className="w-full h-10 object-contain"
                    onError={(e) => { (e.currentTarget.style.display = "none"); }}
                  />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <code className="font-mono text-[13px] tracking-wider">{c.code}</code>
                  <button
                    onClick={() => copyCode(c.code)}
                    className="opacity-70 hover:opacity-100"
                    title="Copy code"
                  >
                    <Copy size={13} />
                  </button>
                </div>
                <div className="text-[11px] opacity-85">
                  of {money(c.initialBalance, currency)}
                  {c.recipientName && <> · for {c.recipientName}</>}
                </div>
                {c.note && <div className="text-[11px] opacity-70 italic mt-1">{c.note}</div>}
              </div>
            ))}
          </div>
        )}
      </Screen>

      {open && <IssueModal currency={currency} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); toast.push("ok", "Gift card issued"); }} />}
      {lookup && <LookupModal currency={currency} onClose={() => setLookup(false)} />}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  const bg = accent ? "var(--olive)" : "var(--panel-2)";
  const fg = accent ? "#fff" : "var(--ink)";
  return (
    <div className="rounded-xl p-4" style={{ background: bg, border: accent ? "none" : "1px solid var(--line)" }}>
      <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: accent ? "rgba(255,255,255,.8)" : "var(--muted)" }}>{label}</div>
      <div className="mono text-[19px] font-semibold mt-1 leading-none" style={{ color: fg }}>{value}</div>
    </div>
  );
}

function IssueModal({ currency, onClose, onDone }: { currency: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    const n = Number(amount);
    if (!n || n <= 0) { toast.push("bad", "Amount is required"); return; }
    setBusy(true);
    try { await apiPost("/giftcards", { amount: n, recipientName, note }); onDone(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title="Issue gift card" onClose={onClose} width={420}>
      <div className="space-y-3">
        <div><label className="lbl">Amount ({currency.trim()})</label>
          <input className="inp mono text-[18px] text-right" inputMode="decimal" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label className="lbl">Recipient name (optional)</label>
          <input className="inp" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} /></div>
        <div><label className="lbl">Note (optional)</label>
          <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">{busy ? "Issuing…" : "Issue card"}</button>
      </div>
    </Modal>
  );
}

function LookupModal({ currency, onClose }: { currency: string; onClose: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [card, setCard] = useState<GiftCard | null>(null);
  const [busy, setBusy] = useState(false);
  async function check() {
    if (!code.trim()) return;
    setBusy(true); setCard(null);
    try { const g = await apiGet<GiftCard>(`/giftcards/lookup?code=${encodeURIComponent(code.toUpperCase().trim())}`); setCard(g); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Not found"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title="Look up card" onClose={onClose} width={420}>
      <div className="space-y-3">
        <div><label className="lbl">Card code</label>
          <input className="inp mono uppercase tracking-widest" placeholder="GCXXXXXXXXXX" value={code} autoFocus
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && check()} /></div>
        <button onClick={check} disabled={busy} className="btn btn-primary w-full">{busy ? "Checking…" : "Check balance"}</button>
        {card && (
          <div className="rounded-xl p-4 mt-3" style={{ background: "var(--olive)", color: "#fff" }}>
            <div className="text-[11px] uppercase tracking-wider opacity-80">Available balance</div>
            <div className="mono text-2xl font-semibold mt-1">{money(card.balance, currency)}</div>
            <div className="text-[11.5px] opacity-85 mt-1">
              of {money(card.initialBalance, currency)} · {card.status}
              {card.recipientName && <> · for {card.recipientName}</>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
