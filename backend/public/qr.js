// qr.js — thin wrapper over the vendored qrcode-generator (window.qrcode).
// window.posQrSvg(text) → a crisp, printable SVG string for any text/URL.
(function () {
  window.posQrSvg = function (text, opts) {
    opts = opts || {};
    try {
      const qr = qrcode(0, opts.ec || "M");   // type 0 = auto-size for the data
      qr.addData(String(text || ""));
      qr.make();
      const svg = qr.createSvgTag({ cellSize: opts.cell || 5, margin: opts.margin == null ? 12 : opts.margin, scalable: true });
      // Force the SVG to fill its container — a viewBox-only SVG sizes
      // inconsistently across browsers, which can render blank.
      return svg.replace("<svg ", '<svg style="width:100%;height:100%;display:block" ');
    } catch (e) {
      return `<div style="color:var(--danger);font-size:12px;">Could not render QR: ${e.message}</div>`;
    }
  };
})();
