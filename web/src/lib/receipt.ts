// Classic 80mm thermal receipt / retail bill printer.
// Produces a real-looking printed bill (not a fancy A4 invoice): business
// header, invoice meta, itemised table, totals, cash/change, tax line, footer.

import type { Order } from "./types";
import type { PublicSettings } from "./settings";

interface ReceiptOptions {
  /** cash the customer handed over (optional — shows Tendered + Balance) */
  tendered?: number;
  /** "REPRINT" badge when it's not the original */
  reprint?: boolean;
  /** 58 for narrow printers, 80 for standard (mm) */
  paper?: 58 | 80;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function printReceipt(o: Order, settings: Partial<PublicSettings> & { receiptFooterText?: string; taxRegNo?: string } | null, opts: ReceiptOptions = {}) {
  const win = window.open("", "_blank", "width=380,height=760");
  if (!win) { alert("Pop-up blocked. Please allow pop-ups to print the bill."); return; }

  const cur = settings?.currencySymbol || "Rs. ";
  const biz = settings?.businessName || "Restaurant";
  const widthMm = opts.paper === 58 ? 58 : 80;

  const money = (n: number) => `${cur}${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const itemRows = o.items.map((it) => {
    const mods = (it.modifiers || []).map((m) =>
      `<tr><td></td><td class="mod" colspan="3">+ ${esc(m.option)}${m.priceDelta ? ` (${money(m.priceDelta)})` : ""}</td></tr>`
    ).join("");
    const note = it.notes ? `<tr><td></td><td class="note" colspan="3">» ${esc(it.notes)}</td></tr>` : "";
    const unit = it.qty ? it.lineTotal / it.qty : it.lineTotal;
    return (
      `<tr class="ln">
        <td class="q">${it.qty}</td>
        <td class="n">${esc(it.name)}</td>
        <td class="u">${money(unit)}</td>
        <td class="a">${money(it.lineTotal)}</td>
      </tr>${mods}${note}`
    );
  }).join("");

  const tendered = opts.tendered;
  const balance = tendered != null ? Math.max(0, tendered - (o.grandTotal || o.total)) : null;
  // discount may be a number or a {amount} object depending on the source
  const discVal = typeof o.discount === "number" ? o.discount : Number((o.discount as { amount?: number } | null)?.amount) || 0;

  // Scannable bill identifier (CODE128). Uses the order id so a scan maps back
  // to exactly one bill; falls back to the display number.
  const billCode = String((o as { id?: number | string }).id ?? o.displayNum ?? "").replace(/[^A-Za-z0-9]/g, "") || "0";
  const barcodeUrl = `https://barcodeapi.org/api/128/${encodeURIComponent(billCode)}`;

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Bill ${esc(o.displayNum)}</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    body { font-family: "Cascadia Mono","Consolas",ui-monospace,monospace; font-size: 12px; color:#000; width:${widthMm}mm; margin:0 auto; padding:4px 2px; }
    .c { text-align:center; }
    .biz { font-size:16px; font-weight:800; letter-spacing:.5px; }
    .sub { font-size:10.5px; color:#333; line-height:1.35; }
    .rule { border:none; border-top:1px dashed #000; margin:6px 0; }
    .ruled { border:none; border-top:2px solid #000; margin:5px 0; }
    .inv { font-size:12px; font-weight:700; text-align:center; letter-spacing:2px; margin:4px 0; }
    table { width:100%; border-collapse:collapse; }
    .meta td { font-size:10.5px; padding:1px 0; }
    .meta td:last-child { text-align:right; }
    thead th { font-size:10px; text-transform:uppercase; border-bottom:1px solid #000; padding:3px 0; text-align:left; }
    thead th.u,thead th.a { text-align:right; }
    .ln td { padding:2px 0; vertical-align:top; font-size:11.5px; }
    td.q { width:9%; } td.n { width:49%; } td.u { width:19%; text-align:right; } td.a { width:23%; text-align:right; font-weight:700; }
    td.mod,td.note { font-size:10px; color:#444; padding-left:4px; }
    td.note { font-style:italic; }
    .tot td { font-size:11.5px; padding:1.5px 0; }
    .tot td:last-child { text-align:right; }
    .grand td { font-size:15px; font-weight:800; padding-top:4px; }
    .pay td { font-size:11.5px; padding:1px 0; }
    .pay td:last-child { text-align:right; }
    .foot { text-align:center; font-size:10.5px; color:#333; margin-top:8px; line-height:1.4; }
    .badge { text-align:center; font-weight:800; letter-spacing:3px; font-size:11px; border:1px dashed #000; padding:2px; margin-bottom:5px; }
    .bc { text-align:center; margin-top:6px; }
    .bc img { max-width:80%; height:42px; object-fit:contain; }
    .bcnum { font-size:10px; letter-spacing:2px; margin-top:2px; }
  </style></head><body>
    ${opts.reprint ? `<div class="badge">R E P R I N T</div>` : ``}
    ${settings?.logoUrl ? `<div class="c"><img src="${esc(settings.logoUrl)}" style="max-height:48px;max-width:70%;object-fit:contain"></div>` : ``}
    <div class="c biz">${esc(biz)}</div>
    <div class="c sub">
      ${settings?.businessAddress ? esc(settings.businessAddress) + "<br>" : ""}
      ${settings?.businessPhone ? "Tel: " + esc(settings.businessPhone) : ""}
      ${(settings as { taxRegNo?: string })?.taxRegNo ? "<br>Tax Reg: " + esc((settings as { taxRegNo?: string }).taxRegNo) : ""}
    </div>
    <div class="inv">TAX INVOICE</div>
    <table class="meta">
      <tr><td>Bill No</td><td>${esc(o.displayNum)}</td></tr>
      <tr><td>Date</td><td>${esc((o.createdAt || new Date().toISOString()).replace("T", " ").slice(0, 16))}</td></tr>
      <tr><td>Type</td><td>${esc(o.orderType)}${o.tableName ? " · " + esc(o.tableName) : ""}</td></tr>
      ${o.staffName ? `<tr><td>Served by</td><td>${esc(o.staffName)}</td></tr>` : ""}
      ${o.customerName ? `<tr><td>Customer</td><td>${esc(o.customerName)}</td></tr>` : ""}
    </table>
    <hr class="rule">
    <table>
      <thead><tr><th class="q">Qty</th><th class="n">Item</th><th class="u">Price</th><th class="a">Amount</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <hr class="rule">
    <table class="tot">
      <tr><td>Subtotal</td><td>${money(o.subtotal)}</td></tr>
      ${discVal > 0 ? `<tr><td>Discount</td><td>- ${money(discVal)}</td></tr>` : ""}
      ${o.serviceCharge > 0 ? `<tr><td>Service charge</td><td>${money(o.serviceCharge)}</td></tr>` : ""}
      ${o.vat > 0 ? `<tr><td>VAT / Tax</td><td>${money(o.vat)}</td></tr>` : ""}
    </table>
    <hr class="ruled">
    <table class="tot"><tr class="grand"><td>TOTAL</td><td>${money(o.grandTotal || o.total)}</td></tr></table>
    ${(tendered != null || o.amountPaid) ? `
    <hr class="rule">
    <table class="pay">
      ${tendered != null ? `<tr><td>Cash tendered</td><td>${money(tendered)}</td></tr>` : ""}
      ${balance != null ? `<tr><td>Change</td><td>${money(balance)}</td></tr>` : ""}
      ${(o.amountPaid && tendered == null) ? `<tr><td>Paid</td><td>${money(o.amountPaid)}</td></tr>` : ""}
    </table>` : ""}
    <hr class="rule">
    <div class="bc">
      <img src="${barcodeUrl}" alt="Bill ${esc(billCode)}" onerror="this.style.display='none'">
      <div class="bcnum">${esc(o.displayNum || billCode)}</div>
    </div>
    <div class="foot">
      ${esc((settings as { receiptFooterText?: string })?.receiptFooterText || "Thank you — please come again!")}
      <br>Powered by Golden POS
    </div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};window.onafterprint=function(){window.close();};</script>
  </body></html>`);
  win.document.close();
}
