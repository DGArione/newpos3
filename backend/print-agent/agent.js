#!/usr/bin/env node
// ============================================================
// RapidPOS thermal print agent (zero dependencies)
// ------------------------------------------------------------
// A tiny local service that receives print jobs from the POS running in the
// browser and sends them to an ESC/POS thermal printer. Run it on the till
// computer; point Settings → Printing → Agent URL at http://localhost:9110/print
//
//   PRINTER=/dev/usb/lp0 node agent.js            # USB / character device
//   PRINTER=tcp://192.168.1.50:9100 node agent.js # network printer
//   PRINTER=stdout node agent.js                  # dry-run: print to console
//
// Env: PORT (default 9110), PRINTER (target), CORS (default *).
// A job is JSON: { type, title, text, copies }. `text` is plain lines; the
// agent adds ESC/POS init + a paper cut.
// ============================================================
'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '9110', 10);
const PRINTER = process.env.PRINTER || 'stdout';
const CORS = process.env.CORS || '*';

// ESC/POS control codes
const ESC = '\x1B', GS = '\x1D';
const INIT = ESC + '@';                 // initialize
const CUT = GS + 'V' + '\x42' + '\x00'; // partial cut
const FEED = '\n\n\n';

function escpos(text) {
  return INIT + String(text || '').replace(/\r?\n/g, '\n') + FEED + CUT;
}

function sendToPrinter(buf) {
  return new Promise((resolve, reject) => {
    if (PRINTER === 'stdout') {
      process.stdout.write('\n----- PRINT JOB -----\n' + buf.toString('utf8').replace(/[\x00-\x08\x1B\x1D]/g, '') + '\n---------------------\n');
      return resolve();
    }
    if (PRINTER.startsWith('tcp://')) {
      const m = PRINTER.slice(6).split(':');
      const sock = net.createConnection({ host: m[0], port: parseInt(m[1] || '9100', 10) }, () => {
        sock.write(buf, () => sock.end());
      });
      sock.on('close', resolve);
      sock.on('error', reject);
      return;
    }
    // Otherwise treat PRINTER as a device/file path (e.g. /dev/usb/lp0).
    fs.writeFile(PRINTER, buf, (err) => (err ? reject(err) : resolve()));
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', CORS);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('RapidPOS print agent OK → ' + PRINTER); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    let job; try { job = JSON.parse(body || '{}'); } catch (_) { res.writeHead(400); return res.end('bad json'); }
    const copies = Math.max(1, Math.min(5, parseInt(job.copies, 10) || 1));
    try {
      for (let i = 0; i < copies; i++) await sendToPrinter(Buffer.from(escpos(job.text), 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, type: job.type || 'print', copies }));
      console.log(`[print] ${job.type || 'job'} "${job.title || ''}" ×${copies} → ${PRINTER}`);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      console.error('[print] failed:', e && e.message);
    }
  });
});

server.listen(PORT, () => {
  console.log(`RapidPOS print agent listening on http://localhost:${PORT}  →  printer: ${PRINTER}`);
  console.log('Set Settings → Printing → Agent URL to  http://localhost:' + PORT + '/print');
});
