// ============================================================
// src/api.js — port of api/index.php (the REST router)
// ------------------------------------------------------------
// handle(ctx) mirrors the original PHP router top-to-bottom. ctx carries
// { method, uri, query, body, headers, remoteAddr, userAgent }. jsonOut()/
// err() throw a Resp that server.js turns into the HTTP response, so a
// matched-and-answered route stops the chain exactly like PHP's exit().
// ============================================================
'use strict';

const { db } = require('./db');
const H = require('./helpers');
const {
  Resp, jsonOut, err, routeMatch, buildSet, jsonDecode, jsonEncode,
  requireUser, requireRole, branchId, currentUser, checkRateLimit,
  makeToken, verifyPin, hashPin, sha256hex, passwordHash, passwordVerify,
  assertPinAvailable, findManagerByPin, findApproverByPin, assertApprovalPinAvailable, canManage, truncate, safeDate,
  userRow, orderRow, menuRow, ingredientRow, settingsRow, notifRow, shiftRow,
  getSettings, computeTotals, deductInventoryLine, restoreInventory,
  checkLowStock, nextOrderSeqNum, orderNum, addNotification,
  nowStr, isoNow, todayStr, dateAddDays, monthStart, mondayThisWeek, tsSeconds,
  numberFormat, ucfirst, round2, arrColumn, arrSum,
} = H;

const int = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
const flt = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const has = (v) => v !== undefined && v !== null;

// Award loyalty points for a fully-paid order, exactly once. Auto-creates the
// customer by phone if needed so points are never lost, and logs a ledger row.
function awardLoyaltyPoints(dbc, o, oid, s, staffName) {
  const row = dbc.prepare('SELECT loyaltyAwarded FROM orders WHERE id=?'); row.execute([oid]);
  if (int((row.fetch() || {}).loyaltyAwarded || 0)) return;   // already awarded
  const per = flt(s.loyaltyEarnPer) || 100;
  const pts = Math.floor((flt(o.grandTotal) || 0) / per) * (flt(s.loyaltyEarnPoints) || 0);
  if (pts > 0) {
    const cSt = dbc.prepare('SELECT * FROM customers WHERE branchId=? AND phone=?');
    cSt.execute([o.branchId, o.customerPhone]);
    let cust = cSt.fetch();
    if (!cust) {
      dbc.prepare('INSERT INTO customers (branchId,phone,name,address) VALUES (?,?,?,?) ON CONFLICT(branchId,phone) DO NOTHING')
        .execute([o.branchId, o.customerPhone, o.customerName || '', o.customerAddress || '']);
      cSt.execute([o.branchId, o.customerPhone]); cust = cSt.fetch();
    }
    if (cust) {
      dbc.prepare('UPDATE customers SET loyaltyPoints = COALESCE(loyaltyPoints,0) + ? WHERE id=?').execute([pts, int(cust.id)]);
      dbc.prepare('INSERT INTO loyalty_ledger (branchId,customerId,phone,orderId,type,points,note,byStaffName) VALUES (?,?,?,?,?,?,?,?)')
        .execute([o.branchId, int(cust.id), o.customerPhone, oid, 'earn', pts, 'Order ' + (o.displayNum || ('#' + oid)), staffName || '']);
    }
  }
  dbc.prepare('UPDATE orders SET loyaltyAwarded=1 WHERE id=?').execute([oid]);
}

// Price and validate one order line against the SERVER's menu + modifier rules.
// Prices and option deltas come from the database, never the client, and the
// group's required/min/max rules are enforced. Throws err() on any violation.
function priceAndValidateLine(dbc, branchId, i) {
  const mid = int(i.menuItemId);
  const miSt = dbc.prepare('SELECT * FROM menu_items WHERE id=? AND branchId=?');
  miSt.execute([mid, branchId]);
  const miRow = miSt.fetch();
  if (!miRow) err('Invalid menu item: ' + mid, 400);
  const price = flt(miRow.price);
  const name = miRow.name;
  if (miRow.soldOut) err('Sorry — ' + name + ' is sold out', 400);
  const groups = jsonDecode(miRow.modifiers, []) || [];
  const qty = Math.max(1, int(i.qty) || 1);

  // Group the client's selections by group name.
  const byGroup = {};
  for (const m of (Array.isArray(i.modifiers) ? i.modifiers : [])) {
    const gname = String(m.group || '');
    (byGroup[gname] = byGroup[gname] || []).push(m);
  }
  const safeMods = []; let modTotal = 0;
  for (const g of groups) {
    const gmax = Math.max(1, int(g.max) || 1);
    const gmin = g.required ? Math.max(1, int(g.min) || 1) : Math.max(0, int(g.min) || 0);
    const picks = byGroup[g.name] || [];
    if (picks.length < gmin) err(`"${name}": choose at least ${gmin} from "${g.name}"`, 400);
    if (picks.length > gmax) err(`"${name}": choose at most ${gmax} from "${g.name}"`, 400);
    for (const pick of picks) {
      const optName = String(pick.option || pick.name || '');
      const opt = (g.options || []).find((o) => (o.name || o.option) === optName);
      if (!opt) err(`"${name}": invalid option "${optName}" in "${g.name}"`, 400);
      const delta = flt(opt.priceDelta || 0);
      modTotal += delta;
      safeMods.push({ group: g.name, option: (opt.name || opt.option), priceDelta: delta, qtyMultiplier: opt.qtyMultiplier, recipe: opt.recipe || [] });
    }
  }
  // A selection pointing at a group the item doesn't define is rejected.
  for (const gname of Object.keys(byGroup)) {
    if (!groups.find((g) => g.name === gname)) err(`"${name}": unknown modifier group "${gname}"`, 400);
  }
  let stId = miRow.stationId ? int(miRow.stationId) : null, stName = 'Unassigned';
  if (stId) { const st = dbc.prepare('SELECT name FROM stations WHERE id=?'); st.execute([stId]); const sr = st.fetch(); stName = sr ? sr.name : 'Unassigned'; }
  return Object.assign({}, i, {
    menuItemId: mid, qty, name, basePrice: price, modifiers: safeMods,
    lineTotal: round2((price + modTotal) * qty), stationId: stId, stationName: stName,
    status: 'pending', inventoryDeducted: false,
  });
}

// Write a change-audit row for a successful mutating request. Called by the
// host (server.js) after handle() resolves, so it sees the final status code.
// Sensitive fields are redacted; audit never throws into the request path.
function auditLog(ctx, statusCode) {
  try {
    const u = ctx._user; if (!u) return;
    const m = ctx.method;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return;
    if (statusCode >= 400) return;
    const path = ctx.uri || '';
    if (/^\/notifications(\/|$)/.test(path)) return;   // too noisy, not a change
    const body = ctx.body || {};
    const redacted = {};
    for (const k of Object.keys(body)) {
      if (/pin|password|token|secret|auth|logo|image|bg|data/i.test(k)) { redacted[k] = '***'; continue; }
      let v = body[k];
      if (typeof v === 'string') v = v.length > 80 ? v.slice(0, 80) + '…' : v;
      else if (Array.isArray(v)) v = `[${v.length} item(s)]`;
      else if (v && typeof v === 'object') v = '{…}';
      redacted[k] = v;
    }
    let summary = ''; try { summary = JSON.stringify(redacted); } catch (_) {}
    if (summary.length > 500) summary = summary.slice(0, 500) + '…';
    db.prepare('INSERT INTO audit_log (branchId,userId,userName,role,method,path,summary,statusCode,ip) VALUES (?,?,?,?,?,?,?,?,?)')
      .execute([ctx._bid || null, int(u.id), u.name || '', u.role || '', m, path, summary, int(statusCode), String(ctx.remoteAddr || '').slice(0, 64)]);
  } catch (e) { /* audit is best-effort */ }
}

// Assign a sequential fiscal invoice number to a paid order, once, when fiscal
// mode is on. Returns nothing; safe to call on every full-payment path.
function assignFiscalIfDue(dbc, oid) {
  try {
    const s = getSettings();
    if (!s.fiscalEnabled) return;
    const o = dbc.prepare('SELECT fiscalNumber, paymentStatus FROM orders WHERE id=?'); o.execute([oid]);
    const row = o.fetch();
    if (!row || row.fiscalNumber || row.paymentStatus !== 'paid') return;
    const seqSt = dbc.prepare('SELECT fiscalSeq FROM settings WHERE id=1'); seqSt.execute([]);
    const next = int((seqSt.fetch() || {}).fiscalSeq || 0) + 1;
    dbc.prepare('UPDATE settings SET fiscalSeq=? WHERE id=1').execute([next]);
    getSettings(true);
    const num = (s.fiscalPrefix || 'INV-') + String(next).padStart(6, '0');
    dbc.prepare('UPDATE orders SET fiscalNumber=? WHERE id=?').execute([num, oid]);
  } catch (e) { /* fiscal numbering must not block payment */ }
}

// A random, unguessable token for a table's QR link (ambiguous chars dropped).
function genTableToken() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let t = '';
  for (let i = 0; i < 16; i++) t += A[Math.floor(Math.random() * A.length)];
  return t;
}

// Evaluate active promotions for a branch against a cart and return the single
// best one as { promotionId, name, amount }, or null. Promotions never stack —
// the highest-value applicable promo wins (keeps discounts predictable).
function computeBestPromotion(dbc, branchId, items, settings) {
  if (!branchId || !Array.isArray(items) || !items.length) return null;
  let rows;
  try {
    const st = dbc.prepare('SELECT * FROM promotions WHERE branchId=? AND active=1');
    st.execute([branchId]); rows = st.fetchAll();
  } catch (e) { return null; }
  if (!rows || !rows.length) return null;

  // Aggregate cart quantities and line totals per menu item.
  const qtyById = {}, totalById = {};
  for (const it of items) {
    const mid = int(it.menuItemId);
    qtyById[mid] = (qtyById[mid] || 0) + int(it.qty);
    totalById[mid] = round2((totalById[mid] || 0) + flt(it.lineTotal || 0));
  }
  const subtotal = round2(arrSum(arrColumn(items, 'lineTotal')));
  const today = new Date().getDay();

  let best = null;
  for (const p of rows) {
    const days = jsonDecode(p.days, []) || [];
    if (days.length && !days.includes(today)) continue;   // not scheduled today
    const conds = jsonDecode(p.conditions, []) || [];
    if (!conds.length) continue;

    let qualifies = true, qualifyingTotal = 0;
    if (p.type === 'daily') {
      // Percent off the listed items present in the cart (any of them).
      let any = false;
      for (const c of conds) {
        const mid = int(c.menuItemId);
        if (qtyById[mid]) { any = true; qualifyingTotal += totalById[mid] || 0; }
      }
      qualifies = any;
    } else {
      // buy_n / bundle: every condition's quantity must be met.
      for (const c of conds) {
        const mid = int(c.menuItemId), need = int(c.qty) || 1;
        if ((qtyById[mid] || 0) < need) { qualifies = false; break; }
        qualifyingTotal += totalById[mid] || 0;
      }
    }
    if (!qualifies) continue;

    const kind = p.rewardKind || 'percent';
    const value = flt(p.rewardValue || 0);
    let amount = 0;
    if (kind === 'amount') amount = value;
    else { // percent
      const base = (p.scope === 'order') ? subtotal : qualifyingTotal;
      amount = round2(base * value / 100);
    }
    amount = round2(Math.min(amount, subtotal));
    if (amount > 0 && (!best || amount > best.amount)) {
      best = { promotionId: int(p.id), name: p.name, amount };
    }
  }
  return best;
}

function handle(ctx) {
  const method = ctx.method;
  const uri = ctx.uri;
  const query = ctx.query || {};
  const body = ctx.body || {};
  const params = {};

  // ═══════════════════════════════════════════════════════════
  // PUBLIC ROUTES (no auth required)
  // ═══════════════════════════════════════════════════════════

  if (method === 'GET' && uri === '/public/has-admin') {
    const count = int(db.query("SELECT COUNT(*) AS c FROM users WHERE role='admin'").fetch().c);
    jsonOut({ hasAdmin: count > 0 });
  }

  if (method === 'POST' && uri === '/public/create-admin') {
    const count = int(db.query("SELECT COUNT(*) AS c FROM users WHERE role='admin'").fetch().c);
    if (count > 0) jsonOut({ error: 'Admin already exists.' }, 403);
    const name = String(body.name || '').trim();
    const username = String(body.username || '').trim();
    const password = String(body.password || '').trim();
    if (!name) jsonOut({ error: 'Name is required.' }, 400);
    if (!username) jsonOut({ error: 'Username is required.' }, 400);
    if (username.length < 3) jsonOut({ error: 'Username must be at least 3 characters.' }, 400);
    if (password.length < 6) jsonOut({ error: 'Password must be at least 6 characters.' }, 400);
    const takenSt = db.prepare('SELECT COUNT(*) AS c FROM users WHERE username=?');
    takenSt.execute([username]);
    if (int(takenSt.fetch().c) > 0) jsonOut({ error: 'Username already taken.' }, 400);
    const ph = passwordHash(password);
    db.prepare(
      `INSERT INTO users (branchId, name, username, passwordHash, mustChangePassword, role, payRate, payType, authMethod)
       VALUES (NULL, ?, ?, ?, 0, 'admin', 0.00, 'hourly', 'password')`
    ).execute([name, username, ph]);
    jsonOut({ ok: true });
  }

  if (method === 'GET' && uri === '/public/settings') {
    let s;
    try { s = getSettings(); } catch (e) {
      jsonOut({
        businessName: 'Restaurant POS', logoUrl: '', businessTagline: '',
        businessPhone: '', businessAddress: '', businessEmail: '',
        theme: 'light', allowUserThemeOverride: true,
        lightThemeId: '', darkThemeId: '', activeThemeId: '',
        accentColor: '', accentDark: '', accentSoft: '', font: '',
        currencySymbol: '$', serviceChargeRate: 0, vatRate: 0, cardFeePercent: 0,
        receiptFooterText: '', receiptShowVatBreakdown: false,
        loginLayout: 'classic', loginBgUrl: '', autoStockClose: true, enabledAddons: [],
        loyaltyEarnPoints: 1, loyaltyEarnPer: 100, loyaltyRedeemValue: 1, loyaltyMinRedeem: 0,
        taxRegNo: '', fiscalEnabled: false, fiscalPrefix: 'INV-',
        printAgentUrl: '', printAgentEnabled: false, printPaperWidth: 48,
        publicBaseUrl: '', qrOrderAutoKitchen: true, defaultOrderType: 'dine-in', loginThemeId: '',
      });
    }
    jsonOut({
      businessName: s.businessName, logoUrl: s.logoUrl, businessTagline: s.businessTagline,
      businessPhone: s.businessPhone, businessAddress: s.businessAddress, businessEmail: s.businessEmail,
      theme: s.theme, allowUserThemeOverride: s.allowUserThemeOverride,
      lightThemeId: s.lightThemeId, darkThemeId: s.darkThemeId, activeThemeId: s.activeThemeId,
      accentColor: s.accentColor, accentDark: s.accentDark, accentSoft: s.accentSoft, font: s.font,
      currencySymbol: s.currencySymbol, serviceChargeRate: s.serviceChargeRate, vatRate: s.vatRate,
      cardFeePercent: s.cardFeePercent || 0, receiptFooterText: s.receiptFooterText,
      receiptShowVatBreakdown: s.receiptShowVatBreakdown, loginLayout: s.loginLayout, loginBgUrl: s.loginBgUrl,
      autoStockClose: s.autoStockClose !== false,
      enabledAddons: s.enabledAddons || [],
      loyaltyEarnPoints: s.loyaltyEarnPoints, loyaltyEarnPer: s.loyaltyEarnPer,
      loyaltyRedeemValue: s.loyaltyRedeemValue, loyaltyMinRedeem: s.loyaltyMinRedeem,
      taxRegNo: s.taxRegNo || '', fiscalEnabled: !!s.fiscalEnabled, fiscalPrefix: s.fiscalPrefix || 'INV-',
      printAgentUrl: s.printAgentUrl || '', printAgentEnabled: !!s.printAgentEnabled, printPaperWidth: s.printPaperWidth || 48,
      publicBaseUrl: s.publicBaseUrl || '', qrOrderAutoKitchen: s.qrOrderAutoKitchen !== false,
      defaultOrderType: s.defaultOrderType || 'dine-in',
      loginThemeId: s.loginThemeId || '',
    });
  }

  if (method === 'GET' && uri === '/public/menu') {
    const mbid = int(query.branchId);
    if (!mbid) err('branchId required', 400);
    const bChk = db.prepare("SELECT id FROM branches WHERE id=? AND status='active'");
    bChk.execute([mbid]);
    if (!bChk.fetch()) err('Invalid branch', 400);
    const st = db.prepare('SELECT * FROM menu_items WHERE branchId=? ORDER BY category, name');
    st.execute([mbid]);
    const items = st.fetchAll().map((r) => {
      const m = menuRow(r);
      return {
        id: m.id, name: m.name, price: m.price, category: m.category,
        imageUrl: m.imageUrl || '', soldOut: !!m.soldOut, modifiers: m.modifiers || [],
      };
    });
    const cSt = db.prepare('SELECT name FROM categories WHERE branchId=? ORDER BY sortOrder, name');
    cSt.execute([mbid]);
    const cats = cSt.fetchAll().map((r) => r.name);
    const s = getSettings();
    jsonOut({
      items, categories: cats, currency: s.currencySymbol || 'Rs. ',
      rates: { serviceCharge: flt(s.serviceChargeRate || 0), vat: flt(s.vatRate || 0) },
    });
  }

  if (method === 'GET' && uri === '/public/branches') {
    let rows = db.query(
      `SELECT b.id, b.name FROM branches b
        WHERE b.status='active' AND EXISTS (SELECT 1 FROM menu_items m WHERE m.branchId = b.id)
        ORDER BY b.id`
    ).fetchAll();
    if (!rows.length) rows = db.query("SELECT id, name FROM branches WHERE status='active' ORDER BY id").fetchAll();
    jsonOut(rows.map((r) => ({ id: int(r.id), name: r.name })));
  }

  // ── PUBLIC QR TABLE ORDERING (no login) ──────────────────
  // Resolve a table's QR token → the branch + table the guest scanned.
  if (method === 'GET' && uri === '/public/table') {
    const token = truncate(query.token || '', 40).trim();
    if (!token) err('token required', 400);
    const st = db.prepare('SELECT * FROM tables_list WHERE qrToken=?'); st.execute([token]);
    const t = st.fetch(); if (!t) err('This QR code is not recognised.', 404);
    const bSt = db.prepare('SELECT id,name,status FROM branches WHERE id=?'); bSt.execute([int(t.branchId)]);
    const b = bSt.fetch(); if (!b) err('Branch not found', 404);
    const s = getSettings();
    jsonOut({
      ok: true, branchId: int(t.branchId), branchName: b.name, branchActive: b.status === 'active',
      tableId: int(t.id), tableName: t.name, businessName: s.businessName || 'Restaurant',
    });
  }
  // Place an order for a scanned table. Creates a dine-in order tied to the
  // table; routed straight to the kitchen or to the staff accept-queue per the
  // qrOrderAutoKitchen setting. Prices/validates on the server.
  if (method === 'POST' && uri === '/public/table-order') {
    const token = truncate(body.token || '', 40).trim();
    if (!token) err('token required', 400);
    const tSt = db.prepare('SELECT * FROM tables_list WHERE qrToken=?'); tSt.execute([token]);
    const t = tSt.fetch(); if (!t) err('This QR code is not recognised.', 404);
    const tbid = int(t.branchId);
    const bSt = db.prepare('SELECT status FROM branches WHERE id=?'); bSt.execute([tbid]);
    const brow = bSt.fetch();
    if (!brow || brow.status !== 'active') err('Sorry — the restaurant is not taking orders right now.', 403);
    const items = body.items || [];
    if (!items.length) err('Your order is empty.', 400);
    const lineItems = items.map((i) => priceAndValidateLine(db, tbid, i));
    const s = getSettings();
    const promo = computeBestPromotion(db, tbid, lineItems, s);
    const totals = computeTotals(lineItems, null, promo ? promo.amount : 0);
    const autoKitchen = s.qrOrderAutoKitchen !== false;
    const status = autoKitchen ? 'pending' : 'new';
    const seqNum = nextOrderSeqNum(db, tbid);
    db.prepare(
      `INSERT INTO orders (branchId,orderType,tableId,tableName,staffId,staffName,customerName,customerPhone,customerAddress,note,items,subtotal,serviceCharge,vat,total,status,paymentStatus,priority,payments,amountPaid,inventoryDeducted,orderSeqNum,promo_data,source,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).execute([
      tbid, 'dine-in', int(t.id), t.name, null, 'QR · ' + t.name,
      truncate(body.customerName || '', 200), truncate(body.customerPhone || '', 50), '',
      truncate(body.note || '', 1000), jsonEncode(lineItems),
      totals.subtotal, totals.serviceCharge, totals.vat, totals.total,
      status, 'unpaid', 'normal', '[]', 0, 0, seqNum, promo ? jsonEncode(promo) : null, 'qr', nowStr(),
    ]);
    const oid = db.lastInsertId();
    db.prepare("UPDATE tables_list SET status='ordered' WHERE id=?").execute([int(t.id)]);
    addNotification({
      branchId: tbid, type: 'qr-order',
      message: `QR order ${autoKitchen ? 'sent to kitchen' : 'waiting to accept'} — ${t.name} (${s.currencySymbol || ''}${numberFormat(totals.total, 2)})`,
      targetRole: autoKitchen ? 'all' : 'manager',
    });
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    const o = orderRow(f.fetch());
    jsonOut({ ok: true, orderId: oid, displayNum: o.displayNum, total: o.total, status, autoKitchen }, 201);
  }

  // POST /api/auth/login (PIN-based)
  if (method === 'POST' && uri === '/auth/login') {
    checkRateLimit('login:' + (ctx.remoteAddr || 'unknown'));
    const pin = String(body.pin || '').trim();
    if (!pin) err('PIN required');
    const pinIndex = sha256hex(pin);
    const st = db.prepare(
      "SELECT * FROM users WHERE (authMethod IS NULL OR authMethod = '' OR authMethod = 'pin') AND pin_index = ?"
    );
    st.execute([pinIndex]);
    const candidates = st.fetchAll();
    let u = null;
    for (const c of candidates) {
      if (verifyPin(pin, c.pin)) {
        u = c;
        const needsUpgrade = String(c.pin).length < 20 || String(c.pin)[0] !== '$';
        const needsIndex = (c.pin_index || null) !== pinIndex;
        if (needsUpgrade || needsIndex) {
          const newHash = needsUpgrade ? hashPin(pin) : c.pin;
          db.prepare('UPDATE users SET pin=?, pin_index=? WHERE id=?').execute([newHash, pinIndex, int(c.id)]);
        }
        break;
      }
    }
    if (!u) err('Incorrect PIN', 401);
    if (int(u.isHeld || 0)) err('Account suspended. Contact your administrator.', 403);
    const user = userRow(u);
    const token = makeToken(user.id);
    let branch = null;
    if (user.branchId) {
      const bs = db.prepare('SELECT * FROM branches WHERE id=?'); bs.execute([user.branchId]);
      branch = bs.fetch() || null;
    }
    db.prepare('INSERT INTO login_logs (userId,userName,role,branchId,branchName,userAgent) VALUES (?,?,?,?,?,?)')
      .execute([user.id, user.name, user.role, user.branchId, (branch && branch.name) || '', truncate(ctx.userAgent || '', 500)]);
    jsonOut(Object.assign({}, user, { branch, token }));
  }

  if (method === 'POST' && uri === '/auth/verify-manager') {
    checkRateLimit('login:' + (ctx.remoteAddr || 'unknown'));
    const pin = String(body.pin || '').trim();
    // Manager approvals use the separate APPROVAL pin, never the login PIN.
    const u = findApproverByPin(db, pin);
    if (!u) jsonOut({ ok: false, error: 'Manager approval PIN required' }, 403);
    jsonOut({ ok: true, user: userRow(u) });
  }

  if (method === 'POST' && uri === '/auth/login-password') {
    checkRateLimit('login:' + (ctx.remoteAddr || 'unknown'));
    const username = truncate(String(body.username || '').trim(), 100);
    const password = body.password || '';
    if (!username || !password) err('Username and password required');
    const st = db.prepare("SELECT * FROM users WHERE username=? AND authMethod='password'");
    st.execute([username]);
    const u = st.fetch();
    const hash = (u && u.passwordHash) || '$scrypt$0$0';
    const verified = passwordVerify(password, hash);
    if (!u || !verified) err('Incorrect username or password', 401);
    if (int(u.isHeld || 0)) err('Account suspended. Contact your administrator.', 403);
    const user2 = userRow(u);
    const token = makeToken(user2.id);
    let branch = null;
    if (user2.branchId) {
      const bs = db.prepare('SELECT * FROM branches WHERE id=?'); bs.execute([user2.branchId]);
      branch = bs.fetch() || null;
    }
    db.prepare('INSERT INTO login_logs (userId,userName,role,branchId,branchName,userAgent) VALUES (?,?,?,?,?,?)')
      .execute([user2.id, user2.name, user2.role, user2.branchId || null, (branch && branch.name) || '', truncate(ctx.userAgent || '', 500)]);
    jsonOut(Object.assign({}, user2, { branch, token, mustChangePassword: !!(u.mustChangePassword || 0) }));
  }

  if (method === 'POST' && uri === '/auth/change-password') {
    const u = currentUser(ctx);
    if (!u) err('Not authenticated', 401);
    const uid = int(body.userId);
    const newPassword = body.newPassword || '';
    if (uid !== u.id) err('Not authorized', 403);
    if (newPassword.length < 6) err('Password must be at least 6 characters');
    db.prepare('UPDATE users SET passwordHash=?, mustChangePassword=0 WHERE id=?').execute([passwordHash(newPassword), uid]);
    jsonOut({ ok: true });
  }

  if (method === 'GET' && routeMatch('/public/orders/:id', uri, params)) {
    const oid = int(params.id);
    const st = db.prepare('SELECT id,status,paymentStatus,tableName,items,total,createdAt,readyAt FROM orders WHERE id=?');
    st.execute([oid]);
    const r = st.fetch();
    if (!r) err('Order not found', 404);
    jsonOut({
      id: int(r.id), status: r.status, paymentStatus: r.paymentStatus, tableName: r.tableName,
      total: flt(r.total), items: jsonDecode(r.items, []), createdAt: r.createdAt, readyAt: r.readyAt,
    });
  }

  // POST /api/orders/online — public online order
  if (method === 'POST' && uri === '/orders/online') {
    const obid = int(body.branchId);
    if (!obid) err('branchId required');
    const branchCheck = db.prepare("SELECT id FROM branches WHERE id=? AND status='active'");
    branchCheck.execute([obid]);
    if (!branchCheck.fetch()) err('Invalid branch', 400);
    const items = body.items || [];
    if (!items.length) err('Items required');
    // Server-authoritative pricing + modifier validation (same as in-house).
    const lineItems = items.map((i) => priceAndValidateLine(db, obid, i));
    const promo = computeBestPromotion(db, int(obid), lineItems, getSettings());
    const totals = computeTotals(lineItems, null, promo ? promo.amount : 0);
    db.prepare(
      `INSERT INTO orders (branchId,orderType,tableName,staffId,staffName,customerName,customerPhone,customerAddress,note,items,subtotal,serviceCharge,vat,total,status,paymentStatus,priority,payments,amountPaid,inventoryDeducted,promo_data,source,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).execute([
      obid, body.orderType || 'takeaway', body.tableName || 'Online', null, 'Online Order',
      truncate(body.customerName || '', 200), truncate(body.customerPhone || '', 50),
      truncate(body.customerAddress || '', 1000), truncate(body.note || '', 1000),
      jsonEncode(lineItems), totals.subtotal, totals.serviceCharge, totals.vat, totals.total,
      'new', 'unpaid', 'normal', '[]', 0, 0, promo ? jsonEncode(promo) : null, 'online', nowStr(),
    ]);
    const oid = db.lastInsertId();
    addNotification({
      branchId: obid, type: 'online-order',
      message: `New ${body.orderType} order #${oid} from ` + (body.customerName || 'customer'),
      targetRole: 'manager',
    });
    const fetchSt = db.prepare('SELECT * FROM orders WHERE id=?'); fetchSt.execute([oid]);
    jsonOut(orderRow(fetchSt.fetch()), 201);
  }

  // ═══════════════════════════════════════════════════════════
  // AUTHENTICATED ROUTES
  // ═══════════════════════════════════════════════════════════
  const user = requireUser(ctx);
  const bid = branchId(ctx, user);
  // Stash the resolved actor so the host can write a change-audit row after a
  // successful mutating request (see auditLog + server.js).
  ctx._user = user; ctx._bid = bid;

  // Enforce the role hierarchy for account-management actions: you may only act
  // on accounts strictly below your own rank (admin can act on anyone). This is
  // what stops a superManager from resetting/holding an ADMIN account.
  const requireManageTarget = (uid) => {
    const t = db.prepare('SELECT id, role, authMethod, name FROM users WHERE id=?'); t.execute([uid]);
    const row = t.fetch();
    if (!row) err('User not found', 404);
    if (!canManage(user, { id: int(row.id), role: row.role })) err('You do not have permission to modify this account.', 403);
    return row;
  };

  // ── SETTINGS ─────────────────────────────────────────────
  if (method === 'GET' && uri === '/settings') {
    requireRole(['admin'], user);
    jsonOut(getSettings());
  }
  if (method === 'PUT' && uri === '/settings') {
    requireRole(['admin'], user);
    const allowed = [
      'businessName', 'logoUrl', 'businessTagline', 'businessPhone', 'businessAddress', 'businessEmail',
      'theme', 'allowUserThemeOverride', 'lightThemeId', 'darkThemeId', 'activeThemeId', 'accentColor',
      'accentDark', 'accentSoft', 'font', 'currencySymbol', 'serviceChargeRate', 'vatRate', 'cardFeePercent', 'dateFormat',
      'lowStockDefaultThreshold', 'receiptFooterText', 'receiptShowVatBreakdown', 'notifyEmailEnabled',
      'notifySmsEnabled', 'loginLayout', 'loginBgUrl', 'autoStockClose', 'defaultOrderType', 'loginThemeId',
    ];
    const [sets, vals] = buildSet(body, allowed);
    if (sets) db.prepare(`UPDATE settings SET ${sets} WHERE id=1`).execute(vals);
    jsonOut(getSettings(true));
  }

  // ── BRANCHES ─────────────────────────────────────────────
  if (method === 'GET' && uri === '/branches') {
    const rows = db.query('SELECT * FROM branches ORDER BY id').fetchAll();
    jsonOut(rows.map((r) => Object.assign({}, r, { id: int(r.id) })));
  }
  if (method === 'POST' && uri === '/branches') {
    requireRole(['superManager'], user);
    db.prepare('INSERT INTO branches (name,address,phone) VALUES (?,?,?)')
      .execute([truncate(body.name || 'New Branch', 200), truncate(body.address || '', 500), truncate(body.phone || '', 50)]);
    const id = db.lastInsertId();
    db.prepare('INSERT OR IGNORE INTO permissions (branchId) VALUES (?)').execute([id]);
    const f = db.prepare('SELECT * FROM branches WHERE id=?'); f.execute([id]);
    jsonOut(f.fetch());
  }
  if (routeMatch('/branches/:id', uri, params)) {
    const bId = int(params.id);
    if (method === 'PATCH' || method === 'PUT') {
      requireRole(['superManager'], user);
      const [sets, vals] = buildSet(body, ['name', 'address', 'phone', 'status']);
      if (sets) db.prepare(`UPDATE branches SET ${sets} WHERE id=?`).execute([...vals, bId]);
      const f = db.prepare('SELECT * FROM branches WHERE id=?'); f.execute([bId]);
      jsonOut(f.fetch());
    }
    if (method === 'DELETE') {
      requireRole(['superManager'], user);
      db.prepare('DELETE FROM branches WHERE id=?').execute([bId]);
      jsonOut({ ok: true });
    }
  }

  // ── CATEGORIES ───────────────────────────────────────────
  if (method === 'GET' && uri === '/categories') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM categories WHERE branchId=? ORDER BY sortOrder, name');
    st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { id: int(r.id), branchId: int(r.branchId), sortOrder: int(r.sortOrder) })));
  }
  if (method === 'POST' && uri === '/categories') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO categories (branchId,name,sortOrder) VALUES (?,?,?)')
      .execute([bid, truncate(body.name || 'Category', 100), int(body.sortOrder || 0)]);
    jsonOut({ id: db.lastInsertId(), branchId: bid, name: body.name, sortOrder: 0 });
  }
  if (routeMatch('/categories/:id', uri, params)) {
    const cId = int(params.id);
    if (method === 'PUT') {
      requireRole(['superManager', 'manager'], user);
      if (has(body.name)) db.prepare('UPDATE categories SET name=? WHERE id=?').execute([truncate(body.name, 100), cId]);
      const f = db.prepare('SELECT * FROM categories WHERE id=?'); f.execute([cId]);
      jsonOut(f.fetch());
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM categories WHERE id=?').execute([cId]);
      jsonOut({ ok: true });
    }
  }

  // ── STATIONS ─────────────────────────────────────────────
  if (method === 'GET' && uri === '/stations') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM stations WHERE branchId=? ORDER BY id');
    st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { id: int(r.id), branchId: int(r.branchId) })));
  }
  if (method === 'POST' && uri === '/stations') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO stations (branchId,name,color) VALUES (?,?,?)')
      .execute([bid, truncate(body.name || 'Station', 100), truncate(body.color || '#8a5a34', 20)]);
    jsonOut({ id: db.lastInsertId(), branchId: bid, name: body.name, color: body.color || '#8a5a34' });
  }
  if (routeMatch('/stations/:id', uri, params)) {
    const sId = int(params.id);
    if (method === 'PUT' || method === 'PATCH') {
      requireRole(['superManager', 'manager', 'admin'], user);
      const [sets, vals] = buildSet(body, ['name', 'color']);
      if (sets) db.prepare(`UPDATE stations SET ${sets} WHERE id=?`).execute([...vals, sId]);
      const f = db.prepare('SELECT * FROM stations WHERE id=?'); f.execute([sId]);
      jsonOut(f.fetch());
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM stations WHERE id=?').execute([sId]);
      jsonOut({ ok: true });
    }
  }

  // ── MENU ITEMS ───────────────────────────────────────────
  if (method === 'GET' && uri === '/menu') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM menu_items WHERE branchId=? ORDER BY category, name');
    st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => menuRow(r)));
  }
  if (method === 'POST' && uri === '/menu') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO menu_items (branchId,name,price,category,plu,imageUrl,stationId,recipe,modifiers) VALUES (?,?,?,?,?,?,?,?,?)')
      .execute([
        bid, truncate(body.name || '', 300), flt(body.price || 0), truncate(body.category || '', 100),
        body.plu ? truncate(body.plu, 50) : null, truncate(body.imageUrl || '', 2000),
        body.stationId ? int(body.stationId) : null, '[]', '[]',
      ]);
    const id = db.lastInsertId();
    const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([id]);
    jsonOut(menuRow(f.fetch()));
  }
  if (routeMatch('/menu/plu/:code', uri, params)) {
    const st = db.prepare('SELECT * FROM menu_items WHERE branchId=? AND plu=? LIMIT 1');
    st.execute([bid, truncate(params.code, 50)]);
    const r = st.fetch(); if (!r) err('Not found', 404);
    jsonOut(menuRow(r));
  }
  if (routeMatch('/menu/:id/stock-check', uri, params)) {
    const mId = int(params.id);
    const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
    const item = menuRow(f.fetch());
    if (!item) err('Not found', 404);
    const recipe = item.recipe || [];
    let maxPortions = null, limiting = null;
    for (const r of recipe) {
      const ingId = int(r.ingredientId);
      const need = flt(r.qty || 0);
      if (!ingId || need <= 0) continue;
      const st2 = db.prepare('SELECT * FROM ingredients WHERE id=?'); st2.execute([ingId]);
      const ing = ingredientRow(st2.fetch());
      if (!ing) continue;
      const possible = Math.floor(ing.qty / need);
      if (maxPortions === null || possible < maxPortions) { maxPortions = possible; limiting = ing.name; }
    }
    jsonOut({
      tracked: recipe.length > 0, maxPortions, limitingIngredient: limiting,
      price: flt(item.price), soldOut: !!item.soldOut,
    });
  }
  if (method === 'PATCH' && routeMatch('/menu/:id/sold-out', uri, params)) {
    requireRole(['superManager', 'manager', 'kitchen'], user);
    const mId = int(params.id);
    const flag = body.soldOut ? 1 : 0;
    db.prepare('UPDATE menu_items SET soldOut=? WHERE id=?').execute([flag, mId]);
    const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
    jsonOut(menuRow(f.fetch()));
  }
  if (routeMatch('/menu/:id/recipe', uri, params)) {
    const mId = int(params.id);
    if (method === 'PUT') {
      requireRole(['superManager', 'manager'], user);
      let recipe = has(body.recipe) ? body.recipe : body;
      if (!Array.isArray(recipe)) recipe = [];
      db.prepare('UPDATE menu_items SET recipe=? WHERE id=?').execute([jsonEncode(recipe), mId]);
      const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
      jsonOut(menuRow(f.fetch()));
    }
  }
  if (routeMatch('/menu/:id/modifiers', uri, params)) {
    const mId = int(params.id);
    if (method === 'POST') {
      requireRole(['superManager', 'manager'], user);
      const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
      const item = menuRow(f.fetch());
      const mods = item.modifiers;
      const cleanOpts = [];
      for (const o of (body.options || [])) {
        let mult = o.qtyMultiplier !== undefined ? flt(o.qtyMultiplier) : 1.0;
        if (mult < 0 || mult > 100) mult = 1.0;
        const extra = [];
        for (const r of (o.recipe || [])) {
          const iid = int(r.ingredientId); const qv = flt(r.qty || 0);
          if (iid > 0 && qv > 0) extra.push({ ingredientId: iid, qty: qv });
        }
        cleanOpts.push({ name: truncate(o.name || '', 100), priceDelta: flt(o.priceDelta || 0), qtyMultiplier: mult, recipe: extra });
      }
      const gmax = Math.max(1, int(body.max) || 1);
      const gmin = Math.min(gmax, Math.max(0, int(body.min) || 0));
      mods.push({
        id: require('crypto').randomBytes(8).toString('hex'),
        name: truncate(body.name || '', 100),
        required: !!body.required, min: gmin, max: gmax,
        options: cleanOpts,
      });
      db.prepare('UPDATE menu_items SET modifiers=? WHERE id=?').execute([jsonEncode(mods), mId]);
      const f2 = db.prepare('SELECT * FROM menu_items WHERE id=?'); f2.execute([mId]);
      jsonOut(menuRow(f2.fetch()));
    }
  }
  if (routeMatch('/menu/:id/modifiers/:gid', uri, params)) {
    const mId = int(params.id);
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      if (params.gid === 'all') {
        db.prepare("UPDATE menu_items SET modifiers='[]' WHERE id=?").execute([mId]);
      } else {
        const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
        const item = menuRow(f.fetch());
        const mods = item.modifiers.filter((g) => String(g.id || '') !== params.gid);
        db.prepare('UPDATE menu_items SET modifiers=? WHERE id=?').execute([jsonEncode(mods), mId]);
      }
      const f2 = db.prepare('SELECT * FROM menu_items WHERE id=?'); f2.execute([mId]);
      jsonOut(menuRow(f2.fetch()));
    }
  }
  if (routeMatch('/menu/:id', uri, params)) {
    const mId = int(params.id);
    if (method === 'PUT') {
      requireRole(['superManager', 'manager'], user);
      const [sets, vals] = buildSet(body, ['name', 'price', 'category', 'plu', 'imageUrl', 'stationId', 'soldOut', 'tags']);
      if (sets) db.prepare(`UPDATE menu_items SET ${sets} WHERE id=?`).execute([...vals, mId]);
      const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
      jsonOut(menuRow(f.fetch()));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM menu_items WHERE id=?').execute([mId]);
      jsonOut({ ok: true });
    }
  }

  // ── TABLES ───────────────────────────────────────────────
  if (method === 'GET' && uri === '/tables') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM tables_list WHERE branchId=? ORDER BY id');
    st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { id: int(r.id), branchId: int(r.branchId), seats: int(r.seats) })));
  }
  if (method === 'POST' && uri === '/tables') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO tables_list (branchId,name,seats,floor,qrToken) VALUES (?,?,?,?,?)')
      .execute([bid, truncate(body.name || 'Table', 100), int(body.seats || 4), truncate(body.floor || '', 50), genTableToken()]);
    const id = db.lastInsertId();
    const f = db.prepare('SELECT * FROM tables_list WHERE id=?'); f.execute([id]);
    jsonOut(Object.assign({}, f.fetch(), { id, seats: int(body.seats || 4) }));
  }
  // Reset the whole floor — mark every table open again. Handy at end of day or
  // after testing. Does not touch orders (they stay in History/Payment).
  if (method === 'POST' && uri === '/tables/reset-floor') {
    requireRole(['superManager', 'manager', 'admin'], user);
    db.prepare("UPDATE tables_list SET status='open' WHERE branchId=?").execute([bid]);
    jsonOut({ ok: true });
  }
  // Regenerate a table's QR token (invalidates the old printed QR).
  if (method === 'POST' && routeMatch('/tables/:id/qr-regenerate', uri, params)) {
    requireRole(['superManager', 'manager', 'admin'], user);
    const tId = int(params.id);
    const chk = db.prepare('SELECT id FROM tables_list WHERE id=? AND branchId=?'); chk.execute([tId, bid]);
    if (!chk.fetch()) err('Table not found', 404);
    const tok = genTableToken();
    db.prepare('UPDATE tables_list SET qrToken=? WHERE id=?').execute([tok, tId]);
    jsonOut({ ok: true, qrToken: tok });
  }
  if (routeMatch('/tables/:id', uri, params)) {
    const tId = int(params.id);
    if (method === 'PATCH' || method === 'PUT') {
      requireRole(['superManager', 'manager', 'server', 'cashier'], user);
      const allowed = ['superManager', 'manager'].includes(user.role) ? ['name', 'seats', 'status', 'floor'] : ['status'];
      const [sets, vals] = buildSet(body, allowed);
      if (sets) db.prepare(`UPDATE tables_list SET ${sets} WHERE id=?`).execute([...vals, tId]);
      const f = db.prepare('SELECT * FROM tables_list WHERE id=?'); f.execute([tId]);
      jsonOut(f.fetch());
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM tables_list WHERE id=?').execute([tId]);
      jsonOut({ ok: true });
    }
  }

  // ── ORDERS ───────────────────────────────────────────────
  if (method === 'GET' && uri === '/orders') {
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const args = [];
    if (bid) { sql += ' AND branchId=?'; args.push(bid); }
    if (has(query.status)) {
      let statuses = String(query.status).split(',').map((s) => s.trim());
      const allowed = ['new', 'pending', 'preparing', 'ready', 'dispatched', 'voided'];
      statuses = statuses.filter((s) => allowed.includes(s));
      if (statuses.length) {
        sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
        args.push(...statuses);
      }
    }
    sql += ' ORDER BY id DESC';
    const st = db.prepare(sql); st.execute(args);
    jsonOut(st.fetchAll().map((r) => orderRow(r)));
  }

  if (method === 'GET' && uri === '/orders/last-receipt') {
    const st = db.prepare("SELECT * FROM orders WHERE branchId=? AND paymentStatus='paid' ORDER BY paidAt DESC LIMIT 1");
    st.execute([bid]);
    const r = st.fetch(); if (!r) err('No paid orders', 404);
    jsonOut(orderRow(r));
  }

  if (method === 'POST' && uri === '/orders') {
    const items = body.items || [];
    if (!items.length) err('Items required');
    // A branch in maintenance is paused — no new orders (in-house or online).
    if (bid) {
      const bSt = db.prepare('SELECT status FROM branches WHERE id=?'); bSt.execute([bid]);
      const brow = bSt.fetch();
      if (brow && brow.status !== 'active') {
        err('This branch is in maintenance mode — new orders are paused. A manager can re-activate it under Branches.', 403);
      }
    }
    // Price and validate every line against the SERVER's menu + modifier rules
    // (never trust client-sent prices, option deltas, or required/min-max).
    const lineItems = items.map((i) => priceAndValidateLine(db, int(bid), i));
    // Auto-apply the best active promotion (if any) for this branch.
    const promo = computeBestPromotion(db, int(bid), lineItems, getSettings());
    const totals = computeTotals(lineItems, null, promo ? promo.amount : 0);
    let tableId = body.tableId || null;
    let tableName = truncate(body.tableNameOverride || 'Walk-in', 100);
    if (tableId) {
      const tSt = db.prepare('SELECT * FROM tables_list WHERE id=?'); tSt.execute([int(tableId)]);
      const t = tSt.fetch();
      tableName = t ? t.name : tableName;
      db.prepare("UPDATE tables_list SET status='ordered' WHERE id=?").execute([tableId]);
    }
    const seqNum = nextOrderSeqNum(db, int(bid));
    db.prepare(
      `INSERT INTO orders (branchId,orderType,tableId,tableName,staffId,staffName,customerName,customerPhone,customerAddress,note,items,subtotal,serviceCharge,vat,total,status,paymentStatus,priority,payments,amountPaid,inventoryDeducted,orderSeqNum,promo_data,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).execute([
      bid, body.orderType || 'dine-in', tableId || null, tableName, user.id, user.name,
      truncate(body.customerName || '', 200), truncate(body.customerPhone || '', 50),
      truncate(body.customerAddress || '', 1000), truncate(body.note || '', 1000),
      jsonEncode(lineItems), totals.subtotal, totals.serviceCharge, totals.vat, totals.total,
      'pending', 'unpaid', body.priority || 'normal', '[]', 0, 0, seqNum, promo ? jsonEncode(promo) : null, nowStr(),
    ]);
    const oid = db.lastInsertId();
    if (body.customerPhone) {
      db.prepare(
        `INSERT INTO customers (branchId,phone,name,address) VALUES (?,?,?,?)
         ON CONFLICT(branchId,phone) DO UPDATE SET name=excluded.name, address=excluded.address`
      ).execute([bid, truncate(body.customerPhone, 50), truncate(body.customerName || '', 200), truncate(body.customerAddress || '', 1000)]);
    }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()), 201);
  }

  if (routeMatch('/orders/:id', uri, params)) {
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const orderRaw = oSt.fetch();
    if (!orderRaw || (user.role !== 'superManager' && int(orderRaw.branchId) !== int(bid))) err('Order not found', 404);
    if (method === 'GET') jsonOut(orderRow(orderRaw));
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/type', uri, params)) {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const oid = int(params.id);
    const type = body.orderType || '';
    if (!['dine-in', 'takeaway', 'delivery'].includes(type)) err('Invalid order type');
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.paymentStatus === 'paid') err('Cannot change type on a paid order', 400);
    const cName = truncate(has(body.customerName) ? body.customerName : o.customerName, 200);
    const cPhone = truncate(has(body.customerPhone) ? body.customerPhone : o.customerPhone, 50);
    const cAddr = truncate(has(body.customerAddress) ? body.customerAddress : o.customerAddress, 500);
    if (type !== 'dine-in' && o.tableId) {
      db.prepare("UPDATE tables_list SET status='open' WHERE id=?").execute([o.tableId]);
      db.prepare('UPDATE orders SET orderType=?, tableId=NULL, tableName=?, customerName=?, customerPhone=?, customerAddress=? WHERE id=?')
        .execute([type, type === 'takeaway' ? 'Takeaway' : 'Delivery', cName, cPhone, cAddr, oid]);
    } else {
      db.prepare('UPDATE orders SET orderType=?, customerName=?, customerPhone=?, customerAddress=? WHERE id=?')
        .execute([type, cName, cPhone, cAddr, oid]);
    }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/pay', uri, params)) {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    const method2 = body.method || '';
    if (!['cash', 'card', 'online', 'wallet'].includes(method2)) err('Invalid payment method');
    let amount = has(body.amount) ? flt(body.amount) : (o.grandTotal - o.amountPaid);
    amount = round2(amount);
    const s = getSettings();
    const feePercent = method2 === 'card' ? flt(s.cardFeePercent || 0) : 0.0;
    const feeAmount = round2(amount * feePercent);
    const netAmount = round2(amount - feeAmount);
    const payments = o.payments;
    payments.push({ method: method2, amount, feePercent, feeAmount, netAmount, paidAt: isoNow() });
    const amountPaid = round2(arrSum(arrColumn(payments, 'amount')));
    const fullyPaid = amountPaid >= o.grandTotal - 0.01;
    const paidAt = fullyPaid ? nowStr() : null;
    const payStatus = fullyPaid ? 'paid' : 'unpaid';
    db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=?, paidAt=? WHERE id=?')
      .execute([jsonEncode(payments), amountPaid, payStatus, paidAt, oid]);
    if (fullyPaid && o.tableId && ['ready', 'dispatched'].includes(o.status)) {
      db.prepare("UPDATE tables_list SET status='dirty' WHERE id=?").execute([o.tableId]);
    }
    // Loyalty: award points once, when the bill is first settled in full and a
    // customer is attached. Must never block the payment itself.
    try {
      const ls = getSettings();
      if (fullyPaid && Array.isArray(ls.enabledAddons) && ls.enabledAddons.includes('loyalty') && o.customerPhone) {
        awardLoyaltyPoints(db, o, oid, ls, user.name);
      }
    } catch (e) { /* loyalty is best-effort */ }
    if (fullyPaid) assignFiscalIfDue(db, oid);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  // POST /api/orders/:id/refund — reverse part or all of a payment.
  // Managers/superManagers refund directly; anyone else needs a manager
  // APPROVAL pin (not the login PIN).
  if (method === 'POST' && routeMatch('/orders/:id/refund', uri, params)) {
    requireRole(['superManager', 'manager', 'admin', 'cashier', 'server', 'finance'], user);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.amountPaid <= 0) err('This order has no payment to refund.', 400);
    const reason = truncate(body.reason || '', 500);
    if (!reason) err('A reason is required for a refund.', 400);

    let approver = user.name;
    if (!['superManager', 'manager', 'admin'].includes(user.role)) {
      const pin = String(body.pin || '').trim();
      if (!pin) err('A manager approval PIN is required to refund.', 403);
      const mgr = findApproverByPin(db, pin);
      if (!mgr) err('Invalid approval PIN.', 403);
      approver = mgr.name + ' (approved for ' + user.name + ')';
    }

    let amount = has(body.amount) ? flt(body.amount) : o.amountPaid;
    amount = round2(amount);
    if (amount <= 0) err('Refund amount must be greater than zero.', 400);
    if (amount > o.amountPaid + 0.01) err(`Refund cannot exceed the amount paid (${o.amountPaid.toFixed(2)}).`, 400);
    const method2 = ['cash', 'card', 'online'].includes(body.method) ? body.method : 'cash';

    const payments = o.payments;
    payments.push({ method: method2, type: 'refund', amount: -amount, reason, byStaffName: user.name, approvedBy: approver, paidAt: isoNow() });
    const amountPaid = round2(arrSum(arrColumn(payments, 'amount')));
    const payStatus = amountPaid <= 0.01 ? 'refunded' : (amountPaid >= o.grandTotal - 0.01 ? 'paid' : 'unpaid');
    const paidAt = payStatus === 'paid' ? (o.paidAt || nowStr()) : null;
    db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=?, paidAt=? WHERE id=?')
      .execute([jsonEncode(payments), amountPaid, payStatus, paidAt, oid]);
    const s = getSettings();
    addNotification({
      branchId: o.branchId, type: 'refund',
      message: `Refund ${s.currencySymbol}${numberFormat(amount, 2)} on ${o.displayNum} by ${approver} — ${reason}`,
      targetRole: 'manager', relatedId: oid,
    });
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/accept', uri, params)) {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.status !== 'new') err('This order has already been accepted', 400);
    db.prepare("UPDATE orders SET status='pending', staffId=?, staffName=? WHERE id=?").execute([user.id, user.name, oid]);
    try {
      db.prepare('INSERT INTO notifications (branchId,type,message,targetRole,readBy) VALUES (?,?,?,?,?)')
        .execute([o.branchId, 'online-order-accepted', 'Online order #' + oid + ' sent to kitchen by ' + user.name, 'kitchen', '[]']);
    } catch (e) { /* best-effort */ }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/reject', uri, params)) {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.status !== 'new') err('Only pending online orders can be rejected', 400);
    const voidData = { reason: truncate(body.reason || 'Rejected by staff', 500), byStaffName: user.name, at: isoNow() };
    db.prepare("UPDATE orders SET status='voided', void_data=? WHERE id=?").execute([jsonEncode(voidData), oid]);
    jsonOut({ ok: true });
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/status', uri, params)) {
    const oid = int(params.id);
    const status = body.status || '';
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (status === 'ready' && !o.inventoryDeducted) {
      db.beginTransaction();
      try {
        for (const line of o.items) deductInventoryLine(db, line);
        const now = isoNow();
        const items = o.items.map((i) => Object.assign({}, i, { status: 'ready', inventoryDeducted: true, readyAt: i.readyAt || now }));
        db.prepare('UPDATE orders SET status=?, inventoryDeducted=1, readyAt=?, items=? WHERE id=?')
          .execute(['ready', nowStr(), jsonEncode(items), oid]);
        if (o.paymentStatus === 'paid' && o.tableId) db.prepare("UPDATE tables_list SET status='dirty' WHERE id=?").execute([o.tableId]);
        db.commit();
        for (const line of o.items) checkLowStock(db, int(line.menuItemId), int(o.branchId));
      } catch (e) { db.rollBack(); if (e instanceof Resp) throw e; err('Deduction failed: ' + e.message, 500); }
    } else {
      db.prepare('UPDATE orders SET status=? WHERE id=?').execute([status, oid]);
      if (status === 'dispatched') db.prepare('UPDATE orders SET dispatchedAt=? WHERE id=?').execute([nowStr(), oid]);
    }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/items/:idx/status', uri, params)) {
    const oid = int(params.id);
    const idx = int(params.idx);
    const status = body.status || '';
    if (!['pending', 'preparing', 'ready'].includes(status)) err('Invalid status');
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    const items = o.items; if (!items[idx]) err('Item not found', 404);
    db.beginTransaction();
    try {
      const line = items[idx];
      line.status = status;
      if (status === 'ready' && !(line.inventoryDeducted || false)) {
        deductInventoryLine(db, line);
        line.inventoryDeducted = true;
        line.readyAt = isoNow();
      }
      const statuses = arrColumn(items, 'status');
      let newStatus = o.status;
      if (new Set(statuses).size === 1 && statuses[0] === 'ready') {
        newStatus = 'ready';
        if (o.paymentStatus === 'paid' && o.tableId) db.prepare("UPDATE tables_list SET status='dirty' WHERE id=?").execute([o.tableId]);
      } else if (statuses.includes('preparing') || statuses.includes('ready')) {
        newStatus = 'preparing';
      } else { newStatus = 'pending'; }
      const allReady = newStatus === 'ready';
      db.prepare('UPDATE orders SET items=?, status=?, inventoryDeducted=? WHERE id=?')
        .execute([jsonEncode(items), newStatus, allReady ? 1 : (o.inventoryDeducted ? 1 : 0), oid]);
      db.commit();
      if (status === 'ready') checkLowStock(db, int(items[idx].menuItemId), int(o.branchId));
    } catch (e) { db.rollBack(); if (e instanceof Resp) throw e; err('Failed: ' + e.message, 500); }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/priority', uri, params)) {
    const oid = int(params.id);
    const p = (body.priority || '') === 'high' ? 'high' : 'normal';
    db.prepare('UPDATE orders SET priority=? WHERE id=?').execute([p, oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/kitchen-tag', uri, params)) {
    const oid = int(params.id);
    const tag = { type: truncate(body.type || '', 100), note: truncate(body.note || '', 500), setBy: user.name, setAt: isoNow() };
    db.prepare('UPDATE orders SET kitchenTag=? WHERE id=?').execute([jsonEncode(tag), oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    const o = orderRow(f.fetch());
    if (o.staffId) {
      addNotification({
        branchId: o.branchId, type: 'kitchen-delay',
        message: `Kitchen flagged Order #${o.id} (${o.tableName}): ${tag.type}` + (tag.note ? ` — ${tag.note}` : ''),
        targetUserId: o.staffId, relatedId: o.id,
      });
    }
    jsonOut(o);
  }

  if (method === 'DELETE' && routeMatch('/orders/:id/kitchen-tag', uri, params)) {
    const oid = int(params.id);
    db.prepare('UPDATE orders SET kitchenTag=NULL WHERE id=?').execute([oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/discount', uri, params)) {
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.amountPaid > 0) err('Cannot discount an order that already has payments', 400);
    const type = ['percent', 'fixed'].includes(body.type || '') ? body.type : 'percent';
    const value = flt(body.value || 0);
    if (value < 0) err('Discount value cannot be negative', 400);
    const promoAmt = o.promo && o.promo.amount ? o.promo.amount : 0;
    if (value === 0) {
      const totals = computeTotals(o.items, null, promoAmt);
      db.prepare('UPDATE orders SET discount=NULL, serviceCharge=?, vat=?, total=? WHERE id=?')
        .execute([totals.serviceCharge, totals.vat, totals.total, oid]);
      const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
      jsonOut(orderRow(f.fetch()));
    }
    if (type === 'percent' && value > 100) err('Percent discount cannot exceed 100%', 400);
    let approver = user.name;
    if (!['superManager', 'manager', 'admin'].includes(user.role)) {
      const permSt = db.prepare('SELECT serverMaxDiscountPercent FROM permissions WHERE branchId=?');
      permSt.execute([o.branchId]);
      const limit = flt(permSt.fetchColumn() || 0);
      const withinLimit = (type === 'percent' && value <= limit);
      if (!withinLimit) {
        const pin = String(body.pin || '').trim();
        if (pin === '') err(type === 'percent' ? `Discounts over ${limit}% need a manager approval PIN` : 'Fixed-amount discounts need a manager approval PIN', 403);
        const mgr = findApproverByPin(db, pin);
        if (!mgr) err('Invalid approval PIN', 403);
        approver = mgr.name + ' (approved for ' + user.name + ')';
      }
    }
    const discountAmount = type === 'percent' ? round2(o.subtotal * value / 100) : value;
    if (discountAmount > o.subtotal) err('Discount cannot exceed the subtotal', 400);
    const discount = { type, value, amount: discountAmount, reason: truncate(body.reason || '', 500), approvedBy: approver };
    const totals = computeTotals(o.items, discount, promoAmt);
    db.prepare('UPDATE orders SET discount=?, serviceCharge=?, vat=?, total=? WHERE id=?')
      .execute([jsonEncode(discount), totals.serviceCharge, totals.vat, totals.total, oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/void', uri, params)) {
    requireRole(['superManager', 'manager', 'cashier', 'server', 'kitchen'], user);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (['server', 'cashier'].includes(user.role)) {
      const pSt = db.prepare('SELECT allowServerVoid, allowCashierVoid FROM permissions WHERE branchId=?');
      pSt.execute([o.branchId]);
      const perm = pSt.fetch() || { allowServerVoid: 0, allowCashierVoid: 0 };
      const field = user.role === 'server' ? 'allowServerVoid' : 'allowCashierVoid';
      if (!perm[field]) err(ucfirst(user.role) + 's are not allowed to void orders at this branch. Ask a manager.', 403);
    }
    const voidData = { reason: truncate(body.reason || '', 500), byStaffName: user.name, at: isoNow() };
    db.beginTransaction();
    try {
      if (o.inventoryDeducted) restoreInventory(db, o.items);
      db.prepare("UPDATE orders SET status='voided', inventoryDeducted=0, void_data=? WHERE id=?").execute([jsonEncode(voidData), oid]);
      if (o.tableId) db.prepare("UPDATE tables_list SET status='open' WHERE id=?").execute([o.tableId]);
      db.commit();
    } catch (e) { db.rollBack(); if (e instanceof Resp) throw e; err('Void failed: ' + e.message, 500); }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/table', uri, params)) {
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.tableId) db.prepare("UPDATE tables_list SET status='open' WHERE id=?").execute([o.tableId]);
    const newTid = body.tableId ? int(body.tableId) : null;
    const newTname = truncate(body.tableName || '', 100);
    if (newTid) db.prepare("UPDATE tables_list SET status='ordered' WHERE id=?").execute([newTid]);
    db.prepare('UPDATE orders SET tableId=?, tableName=? WHERE id=?').execute([newTid, newTname, oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/tip', uri, params)) {
    const oid = int(params.id);
    const tip = round2(flt(body.amount || 0));
    if (tip < 0) err('Tip cannot be negative');
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Order not found', 404);
    db.prepare('UPDATE orders SET tipAmount=? WHERE id=?').execute([tip, oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    const updated = orderRow(f.fetch());
    if (o.staffId) {
      const s = getSettings();
      addNotification({
        branchId: o.branchId, type: 'tip-added',
        message: `Tip of ${s.currencySymbol}${numberFormat(tip, 2)} added to ${orderNum(oid)} · New total: ${s.currencySymbol}${numberFormat(updated.grandTotal, 2)}`,
        targetUserId: int(o.staffId), relatedId: oid,
      });
    }
    jsonOut(updated);
  }

  // ── HELD ORDERS ──────────────────────────────────────────
  if (method === 'GET' && uri === '/held-orders') {
    const st = db.prepare('SELECT * FROM held_orders WHERE branchId=? ORDER BY heldAt DESC');
    st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { id: int(r.id), items: jsonDecode(r.items, []) })));
  }
  if (method === 'POST' && uri === '/held-orders') {
    db.prepare(
      'INSERT INTO held_orders (branchId,label,staffName,orderType,tableId,tableName,customerName,customerPhone,customerAddress,items,note,priority) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).execute([
      bid, truncate(body.label || '', 200), user.name, body.orderType || 'dine-in', body.tableId || null,
      truncate(body.tableName || '', 100), truncate(body.customerName || '', 200), truncate(body.customerPhone || '', 50),
      truncate(body.customerAddress || '', 1000), jsonEncode(body.items || []), truncate(body.note || '', 1000), body.priority || 'normal',
    ]);
    const id = db.lastInsertId();
    const f = db.prepare('SELECT * FROM held_orders WHERE id=?'); f.execute([id]);
    jsonOut(Object.assign({}, f.fetch(), { id, items: body.items || [] }));
  }
  if (routeMatch('/held-orders/:id', uri, params)) {
    const hId = int(params.id);
    if (method === 'GET') {
      const f = db.prepare('SELECT * FROM held_orders WHERE id=?'); f.execute([hId]);
      const r = f.fetch(); if (!r) err('Not found', 404);
      jsonOut(Object.assign({}, r, { items: jsonDecode(r.items, []) }));
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM held_orders WHERE id=?').execute([hId]);
      jsonOut({ ok: true });
    }
  }

  // ── CUSTOMERS ────────────────────────────────────────────
  if (method === 'GET' && uri === '/customers/lookup') {
    const phone = truncate(query.phone || '', 50);
    if (!phone) err('phone required');
    const st = db.prepare('SELECT * FROM customers WHERE branchId=? AND phone=?'); st.execute([bid, phone]);
    const c = st.fetch();
    const os = db.prepare('SELECT * FROM orders WHERE branchId=? AND customerPhone=? ORDER BY createdAt DESC LIMIT 5');
    os.execute([bid, phone]);
    jsonOut({ customer: c || null, orders: os.fetchAll().map((r) => orderRow(r)) });
  }
  // GET /api/customers?search= — directory (phone = primary key, per branch)
  if (method === 'GET' && uri === '/customers') {
    if (!bid) jsonOut([]);
    const search = truncate(query.search || '', 100).trim();
    let st;
    if (search) {
      st = db.prepare('SELECT * FROM customers WHERE branchId=? AND (phone LIKE ? OR name LIKE ?) ORDER BY name LIMIT 100');
      st.execute([bid, '%' + search + '%', '%' + search + '%']);
    } else {
      st = db.prepare('SELECT * FROM customers WHERE branchId=? ORDER BY createdAt DESC LIMIT 200');
      st.execute([bid]);
    }
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { id: int(r.id), loyaltyPoints: flt(r.loyaltyPoints || 0) })));
  }
  if (method === 'POST' && uri === '/customers') {
    const phone = truncate(body.phone || '', 50).trim();
    if (!phone) err('Phone number is required (it is the customer key).', 400);
    const name = truncate(body.name || '', 200);
    const address = truncate(body.address || '', 1000);
    db.prepare(
      `INSERT INTO customers (branchId,phone,name,address) VALUES (?,?,?,?)
       ON CONFLICT(branchId,phone) DO UPDATE SET name=excluded.name, address=excluded.address`
    ).execute([bid, phone, name, address]);
    const f = db.prepare('SELECT * FROM customers WHERE branchId=? AND phone=?'); f.execute([bid, phone]);
    const r = f.fetch();
    jsonOut(Object.assign({}, r, { id: int(r.id), loyaltyPoints: flt(r.loyaltyPoints || 0) }), 201);
  }
  if (routeMatch('/customers/:id', uri, params)) {
    const cId = int(params.id);
    if (method === 'GET') {
      const f = db.prepare('SELECT * FROM customers WHERE id=? AND branchId=?'); f.execute([cId, bid]);
      const r = f.fetch(); if (!r) err('Customer not found', 404);
      const os = db.prepare('SELECT * FROM orders WHERE branchId=? AND customerPhone=? ORDER BY createdAt DESC LIMIT 20');
      os.execute([bid, r.phone]);
      jsonOut(Object.assign({}, r, { id: int(r.id), loyaltyPoints: flt(r.loyaltyPoints || 0), orders: os.fetchAll().map((o) => orderRow(o)) }));
    }
    if (method === 'PUT' || method === 'PATCH') {
      const [sets, vals] = buildSet(body, ['name', 'address', 'phone']);
      if (sets) db.prepare(`UPDATE customers SET ${sets} WHERE id=? AND branchId=?`).execute([...vals, cId, bid]);
      const f = db.prepare('SELECT * FROM customers WHERE id=?'); f.execute([cId]);
      const r = f.fetch(); if (!r) err('Customer not found', 404);
      jsonOut(Object.assign({}, r, { id: int(r.id), loyaltyPoints: flt(r.loyaltyPoints || 0) }));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager', 'admin'], user);
      db.prepare('DELETE FROM customers WHERE id=? AND branchId=?').execute([cId, bid]);
      jsonOut({ ok: true });
    }
  }

  // ── ADD-ON FRAMEWORK (admin enables feature modules) ─────
  if (method === 'POST' && uri === '/admin/addons') {
    requireRole(['admin'], user);
    const VALID = ['loyalty', 'giftcards', 'promotions', 'reservations'];
    const addon = String(body.addon || '');
    if (!VALID.includes(addon)) err('Unknown add-on', 400);
    const s = getSettings();
    let list = Array.isArray(s.enabledAddons) ? s.enabledAddons.slice() : [];
    if (body.enabled) { if (!list.includes(addon)) list.push(addon); }
    else list = list.filter((a) => a !== addon);
    db.prepare('UPDATE settings SET enabledAddons=? WHERE id=1').execute([jsonEncode(list)]);
    getSettings(true);
    jsonOut({ ok: true, enabledAddons: list });
  }

  // ── LOYALTY ADD-ON ───────────────────────────────────────
  // Redeem a customer's points against the balance due. Recorded as a
  // "loyalty" tender so it reduces the balance and shows on the receipt.
  if (method === 'POST' && routeMatch('/orders/:id/loyalty-redeem', uri, params)) {
    requireRole(['superManager', 'manager', 'admin', 'cashier', 'server'], user);
    const s = getSettings();
    if (!(Array.isArray(s.enabledAddons) && s.enabledAddons.includes('loyalty'))) err('Loyalty is not enabled', 400);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (!o.customerPhone) err('Attach a customer to the order before redeeming points.', 400);
    const cSt = db.prepare('SELECT * FROM customers WHERE branchId=? AND phone=?'); cSt.execute([o.branchId, o.customerPhone]);
    const cust = cSt.fetch(); if (!cust) err('Customer not found', 404);
    const balanceDue = round2(o.grandTotal - o.amountPaid);
    if (balanceDue <= 0) err('This order is already settled.', 400);
    const available = flt(cust.loyaltyPoints || 0);
    let points = Math.floor(flt(body.points || 0));
    if (points <= 0) err('Enter the number of points to redeem.', 400);
    if (points > available) err(`Customer only has ${Math.floor(available)} points.`, 400);
    const minR = flt(s.loyaltyMinRedeem || 0);
    if (minR > 0 && points < minR) err(`At least ${minR} points are needed to redeem.`, 400);
    const redeemValue = flt(s.loyaltyRedeemValue) || 1;
    // Never redeem more than needed to clear the balance.
    const maxPoints = Math.ceil(balanceDue / redeemValue);
    if (points > maxPoints) points = maxPoints;
    let value = round2(points * redeemValue);
    if (value > balanceDue) value = balanceDue;
    db.prepare('UPDATE customers SET loyaltyPoints = COALESCE(loyaltyPoints,0) - ? WHERE id=?').execute([points, int(cust.id)]);
    const payments = o.payments;
    payments.push({ method: 'loyalty', type: 'redeem', amount: value, points, byStaffName: user.name, paidAt: isoNow() });
    const amountPaid = round2(arrSum(arrColumn(payments, 'amount')));
    const fullyPaid = amountPaid >= o.grandTotal - 0.01;
    const payStatus = fullyPaid ? 'paid' : 'unpaid';
    const paidAt = fullyPaid ? nowStr() : null;
    db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=?, paidAt=? WHERE id=?')
      .execute([jsonEncode(payments), amountPaid, payStatus, paidAt, oid]);
    db.prepare('INSERT INTO loyalty_ledger (branchId,customerId,phone,orderId,type,points,note,byStaffName) VALUES (?,?,?,?,?,?,?,?)')
      .execute([o.branchId, int(cust.id), o.customerPhone, oid, 'redeem', -points, 'Redeemed on ' + (o.displayNum || ('#' + oid)), user.name]);
    if (fullyPaid) assignFiscalIfDue(db, oid);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut({ order: orderRow(f.fetch()), redeemedPoints: points, redeemedValue: value, remainingPoints: round2(available - points) });
  }

  // Loyalty report: top customers by balance + points issued/redeemed + recent activity.
  if (method === 'GET' && uri === '/loyalty/report') {
    const s = getSettings();
    const settings = {
      loyaltyEarnPoints: s.loyaltyEarnPoints, loyaltyEarnPer: s.loyaltyEarnPer,
      loyaltyRedeemValue: s.loyaltyRedeemValue, loyaltyMinRedeem: s.loyaltyMinRedeem,
    };
    if (!bid) jsonOut({ top: [], issued: 0, redeemed: 0, recent: [], settings });
    const topSt = db.prepare('SELECT id,name,phone,loyaltyPoints FROM customers WHERE branchId=? AND COALESCE(loyaltyPoints,0)>0 ORDER BY loyaltyPoints DESC LIMIT 25');
    topSt.execute([bid]);
    const iSt = db.prepare("SELECT COALESCE(SUM(points),0) as p FROM loyalty_ledger WHERE branchId=? AND type='earn'"); iSt.execute([bid]);
    const rSt = db.prepare("SELECT COALESCE(SUM(points),0) as p FROM loyalty_ledger WHERE branchId=? AND type='redeem'"); rSt.execute([bid]);
    const recSt = db.prepare('SELECT * FROM loyalty_ledger WHERE branchId=? ORDER BY id DESC LIMIT 40'); recSt.execute([bid]);
    jsonOut({
      top: topSt.fetchAll().map((r) => ({ id: int(r.id), name: r.name, phone: r.phone, loyaltyPoints: round2(flt(r.loyaltyPoints || 0)) })),
      issued: round2(flt(iSt.fetch().p)),
      redeemed: Math.abs(round2(flt(rSt.fetch().p))),
      recent: recSt.fetchAll().map((r) => ({ id: int(r.id), phone: r.phone, type: r.type, points: round2(flt(r.points)), note: r.note, byStaffName: r.byStaffName, createdAt: r.createdAt })),
      settings,
    });
  }

  // Update loyalty earn/redeem rates (managers and up).
  if (method === 'PUT' && uri === '/loyalty/settings') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const fields = ['loyaltyEarnPoints', 'loyaltyEarnPer', 'loyaltyRedeemValue', 'loyaltyMinRedeem'];
    const sets = [], vals = [];
    for (const fld of fields) if (has(body[fld])) { sets.push(`${fld}=?`); vals.push(flt(body[fld])); }
    if (!sets.length) err('No settings to update', 400);
    db.prepare(`UPDATE settings SET ${sets.join(',')} WHERE id=1`).execute(vals);
    getSettings(true);
    const s = getSettings();
    jsonOut({ ok: true, settings: { loyaltyEarnPoints: s.loyaltyEarnPoints, loyaltyEarnPer: s.loyaltyEarnPer, loyaltyRedeemValue: s.loyaltyRedeemValue, loyaltyMinRedeem: s.loyaltyMinRedeem } });
  }

  // ── PROMOTIONS ADD-ON ────────────────────────────────────
  const promoRow = (r) => ({
    id: int(r.id), branchId: int(r.branchId), name: r.name, type: r.type,
    conditions: jsonDecode(r.conditions, []) || [], rewardKind: r.rewardKind,
    rewardValue: flt(r.rewardValue), scope: r.scope, days: jsonDecode(r.days, []) || [],
    active: !!r.active, priority: int(r.priority), createdAt: r.createdAt,
  });
  if (method === 'GET' && uri === '/promotions') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM promotions WHERE branchId=? ORDER BY active DESC, priority DESC, id DESC');
    st.execute([bid]);
    jsonOut(st.fetchAll().map(promoRow));
  }
  if (method === 'POST' && uri === '/promotions') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const name = truncate(body.name || '', 120).trim();
    if (!name) err('A promotion name is required', 400);
    const type = ['buy_n', 'bundle', 'daily'].includes(body.type) ? body.type : 'buy_n';
    const conditions = Array.isArray(body.conditions) ? body.conditions.map((c) => ({ menuItemId: int(c.menuItemId), qty: Math.max(1, int(c.qty) || 1) })).filter((c) => c.menuItemId) : [];
    if (!conditions.length) err('Add at least one item to the promotion', 400);
    const rewardKind = body.rewardKind === 'amount' ? 'amount' : 'percent';
    const rewardValue = flt(body.rewardValue || 0);
    if (rewardValue <= 0) err('Reward value must be greater than zero', 400);
    if (rewardKind === 'percent' && rewardValue > 100) err('Percent reward cannot exceed 100%', 400);
    const scope = body.scope === 'order' ? 'order' : 'items';
    const days = Array.isArray(body.days) ? body.days.map((d) => int(d)).filter((d) => d >= 0 && d <= 6) : [];
    db.prepare('INSERT INTO promotions (branchId,name,type,conditions,rewardKind,rewardValue,scope,days,active,priority) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .execute([bid, name, type, jsonEncode(conditions), rewardKind, rewardValue, scope, jsonEncode(days), body.active === false ? 0 : 1, int(body.priority) || 0]);
    const f = db.prepare('SELECT * FROM promotions WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(promoRow(f.fetch()), 201);
  }
  // Preview the best promotion for a tentative cart (used live in Order Entry).
  // Must be declared BEFORE /promotions/:id or ":id" would swallow "preview".
  if (method === 'POST' && uri === '/promotions/preview') {
    const items = (body.items || []).map((i) => ({ menuItemId: int(i.menuItemId), qty: int(i.qty), lineTotal: flt(i.lineTotal || 0) }));
    jsonOut({ promo: computeBestPromotion(db, int(bid), items, getSettings()) });
  }
  // Promotions usage report: count + total discount per promotion.
  if (method === 'GET' && uri === '/promotions/report') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    if (!bid) jsonOut({ promos: [], totalDiscount: 0, totalOrders: 0 });
    const oSt = db.prepare(`SELECT promo_data FROM orders WHERE branchId=? AND promo_data IS NOT NULL`);
    oSt.execute([bid]);
    const byPromo = {}; let totalDiscount = 0, totalOrders = 0;
    for (const row of oSt.fetchAll()) {
      const pr = jsonDecode(row.promo_data, null); if (!pr || !pr.amount) continue;
      const k = pr.promotionId || pr.name;
      if (!byPromo[k]) byPromo[k] = { promotionId: pr.promotionId || null, name: pr.name, count: 0, discount: 0 };
      byPromo[k].count++; byPromo[k].discount = round2(byPromo[k].discount + flt(pr.amount));
      totalDiscount = round2(totalDiscount + flt(pr.amount)); totalOrders++;
    }
    jsonOut({ promos: Object.values(byPromo).sort((a, b) => b.discount - a.discount), totalDiscount, totalOrders });
  }
  if (routeMatch('/promotions/:id', uri, params)) {
    requireRole(['superManager', 'manager', 'admin'], user);
    const pid = int(params.id);
    const chk = db.prepare('SELECT * FROM promotions WHERE id=? AND branchId=?'); chk.execute([pid, bid]);
    if (!chk.fetch()) err('Promotion not found', 404);
    if (method === 'PUT' || method === 'PATCH') {
      const sets = [], vals = [];
      if (has(body.name)) { sets.push('name=?'); vals.push(truncate(body.name, 120)); }
      if (has(body.type) && ['buy_n', 'bundle', 'daily'].includes(body.type)) { sets.push('type=?'); vals.push(body.type); }
      if (has(body.conditions)) { sets.push('conditions=?'); vals.push(jsonEncode((body.conditions || []).map((c) => ({ menuItemId: int(c.menuItemId), qty: Math.max(1, int(c.qty) || 1) })).filter((c) => c.menuItemId))); }
      if (has(body.rewardKind)) { sets.push('rewardKind=?'); vals.push(body.rewardKind === 'amount' ? 'amount' : 'percent'); }
      if (has(body.rewardValue)) { sets.push('rewardValue=?'); vals.push(flt(body.rewardValue)); }
      if (has(body.scope)) { sets.push('scope=?'); vals.push(body.scope === 'order' ? 'order' : 'items'); }
      if (has(body.days)) { sets.push('days=?'); vals.push(jsonEncode((body.days || []).map((d) => int(d)).filter((d) => d >= 0 && d <= 6))); }
      if (has(body.active)) { sets.push('active=?'); vals.push(body.active ? 1 : 0); }
      if (has(body.priority)) { sets.push('priority=?'); vals.push(int(body.priority)); }
      if (sets.length) db.prepare(`UPDATE promotions SET ${sets.join(',')} WHERE id=? AND branchId=?`).execute([...vals, pid, bid]);
      const f = db.prepare('SELECT * FROM promotions WHERE id=?'); f.execute([pid]);
      jsonOut(promoRow(f.fetch()));
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM promotions WHERE id=? AND branchId=?').execute([pid, bid]);
      jsonOut({ ok: true });
    }
  }

  // ── GIFT CARDS ADD-ON ────────────────────────────────────
  const giftRow = (r) => ({
    id: int(r.id), code: r.code, initialBalance: flt(r.initialBalance), balance: flt(r.balance),
    status: r.status, recipientName: r.recipientName, note: r.note, issuedByName: r.issuedByName, createdAt: r.createdAt,
  });
  if (method === 'GET' && uri === '/giftcards') {
    requireRole(['superManager', 'manager', 'admin', 'cashier'], user);
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM gift_cards WHERE branchId=? ORDER BY id DESC LIMIT 300'); st.execute([bid]);
    jsonOut(st.fetchAll().map(giftRow));
  }
  if (method === 'POST' && uri === '/giftcards') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const amount = round2(flt(body.amount || 0));
    if (amount <= 0) err('Enter a gift-card amount', 400);
    // Generate a unique, scanner-friendly code (no ambiguous characters).
    const ALPHA = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679';
    let code = '';
    for (let tries = 0; tries < 20; tries++) {
      let c = 'GC';
      for (let i = 0; i < 10; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
      const ex = db.prepare('SELECT id FROM gift_cards WHERE branchId=? AND code=?'); ex.execute([bid, c]);
      if (!ex.fetch()) { code = c; break; }
    }
    if (!code) err('Could not allocate a code, try again', 500);
    db.prepare('INSERT INTO gift_cards (branchId,code,initialBalance,balance,status,recipientName,note,issuedByName) VALUES (?,?,?,?,?,?,?,?)')
      .execute([bid, code, amount, amount, 'active', truncate(body.recipientName || '', 200), truncate(body.note || '', 500), user.name]);
    const gid = db.lastInsertId();
    db.prepare('INSERT INTO gift_card_ledger (branchId,cardId,code,type,amount,byStaffName) VALUES (?,?,?,?,?,?)')
      .execute([bid, gid, code, 'issue', amount, user.name]);
    const f = db.prepare('SELECT * FROM gift_cards WHERE id=?'); f.execute([gid]);
    jsonOut(giftRow(f.fetch()), 201);
  }
  if (method === 'GET' && uri === '/giftcards/lookup') {
    requireRole(['superManager', 'manager', 'admin', 'cashier', 'server'], user);
    const code = truncate(query.code || '', 40).trim().toUpperCase();
    if (!code) err('code required', 400);
    const st = db.prepare('SELECT * FROM gift_cards WHERE branchId=? AND code=?'); st.execute([bid, code]);
    const g = st.fetch(); if (!g) err('Gift card not found', 404);
    jsonOut(giftRow(g));
  }
  if (method === 'GET' && uri === '/giftcards/report') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    if (!bid) jsonOut({ issued: 0, redeemed: 0, outstanding: 0, count: 0 });
    const a = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(initialBalance),0) i, COALESCE(SUM(balance),0) b FROM gift_cards WHERE branchId=? AND status='active'"); a.execute([bid]);
    const row = a.fetch();
    const rd = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM gift_card_ledger WHERE branchId=? AND type='redeem'"); rd.execute([bid]);
    jsonOut({ count: int(row.c), issued: round2(flt(row.i)), outstanding: round2(flt(row.b)), redeemed: Math.abs(round2(flt(rd.fetch().s))) });
  }
  if (routeMatch('/giftcards/:id/toggle', uri, params) && method === 'POST') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const gid = int(params.id);
    const st = db.prepare('SELECT * FROM gift_cards WHERE id=? AND branchId=?'); st.execute([gid, bid]);
    const g = st.fetch(); if (!g) err('Gift card not found', 404);
    const next = g.status === 'active' ? 'disabled' : 'active';
    db.prepare('UPDATE gift_cards SET status=? WHERE id=?').execute([next, gid]);
    const f = db.prepare('SELECT * FROM gift_cards WHERE id=?'); f.execute([gid]);
    jsonOut(giftRow(f.fetch()));
  }
  // Redeem a gift card against an order's balance (recorded as a tender).
  if (method === 'POST' && routeMatch('/orders/:id/giftcard-pay', uri, params)) {
    requireRole(['superManager', 'manager', 'admin', 'cashier', 'server'], user);
    const s = getSettings();
    if (!(Array.isArray(s.enabledAddons) && s.enabledAddons.includes('giftcards'))) err('Gift cards are not enabled', 400);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    const code = truncate(body.code || '', 40).trim().toUpperCase();
    const gSt = db.prepare('SELECT * FROM gift_cards WHERE branchId=? AND code=?'); gSt.execute([bid, code]);
    const g = gSt.fetch(); if (!g) err('Gift card not found', 404);
    if (g.status !== 'active') err('This gift card is disabled', 400);
    const cardBal = flt(g.balance);
    if (cardBal <= 0) err('This gift card has no balance left', 400);
    const balanceDue = round2(o.grandTotal - o.amountPaid);
    if (balanceDue <= 0) err('This order is already settled', 400);
    let amount = has(body.amount) ? round2(flt(body.amount)) : Math.min(cardBal, balanceDue);
    amount = round2(Math.min(amount, cardBal, balanceDue));
    if (amount <= 0) err('Enter an amount to redeem', 400);
    db.prepare('UPDATE gift_cards SET balance = balance - ? WHERE id=?').execute([amount, int(g.id)]);
    db.prepare('INSERT INTO gift_card_ledger (branchId,cardId,code,orderId,type,amount,byStaffName) VALUES (?,?,?,?,?,?,?)')
      .execute([bid, int(g.id), code, oid, 'redeem', -amount, user.name]);
    const payments = o.payments;
    payments.push({ method: 'giftcard', code, amount, byStaffName: user.name, paidAt: isoNow() });
    const amountPaid = round2(arrSum(arrColumn(payments, 'amount')));
    const fullyPaid = amountPaid >= o.grandTotal - 0.01;
    db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=?, paidAt=? WHERE id=?')
      .execute([jsonEncode(payments), amountPaid, fullyPaid ? 'paid' : 'unpaid', fullyPaid ? nowStr() : null, oid]);
    if (fullyPaid) assignFiscalIfDue(db, oid);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut({ order: orderRow(f.fetch()), redeemed: amount, remainingCardBalance: round2(cardBal - amount) });
  }

  // ── RESERVATIONS ADD-ON ──────────────────────────────────
  const RESV_STATUS = ['booked', 'seated', 'completed', 'cancelled', 'no_show'];
  const resvRow = (r) => ({
    id: int(r.id), customerName: r.customerName, customerPhone: r.customerPhone,
    partySize: int(r.partySize), reserveDate: r.reserveDate, reserveTime: r.reserveTime,
    tableId: r.tableId ? int(r.tableId) : null, tableName: r.tableName, status: r.status,
    note: r.note, createdByName: r.createdByName, createdAt: r.createdAt,
  });
  if (method === 'GET' && uri === '/reservations') {
    requireRole(['superManager', 'manager', 'admin', 'server', 'cashier'], user);
    if (!bid) jsonOut([]);
    const date = truncate(query.date || '', 10).trim();
    let st;
    if (date) { st = db.prepare('SELECT * FROM reservations WHERE branchId=? AND reserveDate=? ORDER BY reserveTime, id'); st.execute([bid, date]); }
    else { st = db.prepare('SELECT * FROM reservations WHERE branchId=? ORDER BY reserveDate DESC, reserveTime LIMIT 200'); st.execute([bid]); }
    jsonOut(st.fetchAll().map(resvRow));
  }
  if (method === 'POST' && uri === '/reservations') {
    requireRole(['superManager', 'manager', 'admin', 'server', 'cashier'], user);
    const name = truncate(body.customerName || '', 200).trim();
    const phone = truncate(body.customerPhone || '', 50).trim();
    if (!name && !phone) err('A name or phone is required', 400);
    const date = truncate(body.reserveDate || '', 10).trim();
    const time = truncate(body.reserveTime || '', 5).trim();
    if (!date || !time) err('Date and time are required', 400);
    let tableId = body.tableId ? int(body.tableId) : null, tableName = '';
    if (tableId) { const t = db.prepare('SELECT name FROM tables_list WHERE id=? AND branchId=?'); t.execute([tableId, bid]); const tr = t.fetch(); tableName = tr ? tr.name : ''; if (!tr) tableId = null; }
    db.prepare('INSERT INTO reservations (branchId,customerName,customerPhone,partySize,reserveDate,reserveTime,tableId,tableName,status,note,createdByName) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .execute([bid, name, phone, Math.max(1, int(body.partySize) || 1), date, time, tableId, tableName, 'booked', truncate(body.note || '', 500), user.name]);
    const f = db.prepare('SELECT * FROM reservations WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(resvRow(f.fetch()), 201);
  }
  if (routeMatch('/reservations/:id', uri, params)) {
    requireRole(['superManager', 'manager', 'admin', 'server', 'cashier'], user);
    const rid = int(params.id);
    const chk = db.prepare('SELECT * FROM reservations WHERE id=? AND branchId=?'); chk.execute([rid, bid]);
    if (!chk.fetch()) err('Reservation not found', 404);
    if (method === 'PUT' || method === 'PATCH') {
      const sets = [], vals = [];
      if (has(body.status) && RESV_STATUS.includes(body.status)) { sets.push('status=?'); vals.push(body.status); }
      if (has(body.customerName)) { sets.push('customerName=?'); vals.push(truncate(body.customerName, 200)); }
      if (has(body.customerPhone)) { sets.push('customerPhone=?'); vals.push(truncate(body.customerPhone, 50)); }
      if (has(body.partySize)) { sets.push('partySize=?'); vals.push(Math.max(1, int(body.partySize) || 1)); }
      if (has(body.reserveDate)) { sets.push('reserveDate=?'); vals.push(truncate(body.reserveDate, 10)); }
      if (has(body.reserveTime)) { sets.push('reserveTime=?'); vals.push(truncate(body.reserveTime, 5)); }
      if (has(body.note)) { sets.push('note=?'); vals.push(truncate(body.note, 500)); }
      if (has(body.tableId)) {
        let tid = body.tableId ? int(body.tableId) : null, tname = '';
        if (tid) { const t = db.prepare('SELECT name FROM tables_list WHERE id=? AND branchId=?'); t.execute([tid, bid]); const tr = t.fetch(); tname = tr ? tr.name : ''; if (!tr) tid = null; }
        sets.push('tableId=?'); vals.push(tid); sets.push('tableName=?'); vals.push(tname);
      }
      if (sets.length) db.prepare(`UPDATE reservations SET ${sets.join(',')} WHERE id=? AND branchId=?`).execute([...vals, rid, bid]);
      const f = db.prepare('SELECT * FROM reservations WHERE id=?'); f.execute([rid]);
      jsonOut(resvRow(f.fetch()));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager', 'admin'], user);
      db.prepare('DELETE FROM reservations WHERE id=? AND branchId=?').execute([rid, bid]);
      jsonOut({ ok: true });
    }
  }

  // ── CHANGE-AUDIT LOG ─────────────────────────────────────
  if (method === 'GET' && uri === '/audit-log') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const limit = Math.min(500, Math.max(1, int(query.limit) || 200));
    let st;
    if (user.role === 'superManager' || user.role === 'admin') {
      st = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?'); st.execute([limit]);
    } else {
      st = db.prepare('SELECT * FROM audit_log WHERE branchId=? ORDER BY id DESC LIMIT ?'); st.execute([bid, limit]);
    }
    jsonOut(st.fetchAll().map((r) => ({
      id: int(r.id), branchId: r.branchId ? int(r.branchId) : null, userName: r.userName, role: r.role,
      method: r.method, path: r.path, summary: r.summary, statusCode: int(r.statusCode), ip: r.ip, createdAt: r.createdAt,
    })));
  }

  // ── FISCAL / TAX AUTHORITY ───────────────────────────────
  if (method === 'PUT' && uri === '/fiscal/settings') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const sets = [], vals = [];
    if (has(body.taxRegNo)) { sets.push('taxRegNo=?'); vals.push(truncate(body.taxRegNo, 60)); }
    if (has(body.fiscalEnabled)) { sets.push('fiscalEnabled=?'); vals.push(body.fiscalEnabled ? 1 : 0); }
    if (has(body.fiscalPrefix)) { sets.push('fiscalPrefix=?'); vals.push(truncate(body.fiscalPrefix, 12)); }
    if (sets.length) { db.prepare(`UPDATE settings SET ${sets.join(',')} WHERE id=1`).execute(vals); getSettings(true); }
    const s = getSettings();
    jsonOut({ ok: true, taxRegNo: s.taxRegNo, fiscalEnabled: s.fiscalEnabled, fiscalPrefix: s.fiscalPrefix });
  }
  // Fiscal journal export — paid orders with their tax breakdown, ready to file.
  if (method === 'GET' && uri === '/fiscal/export') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    if (!bid) jsonOut({ rows: [], csv: '' });
    const from = truncate(query.from || '2000-01-01', 10);
    const to = truncate(query.to || todayStr(), 10);
    const st = db.prepare("SELECT * FROM orders WHERE branchId=? AND paymentStatus='paid' AND date(paidAt)>=? AND date(paidAt)<=? ORDER BY paidAt");
    st.execute([bid, from, to]);
    const s = getSettings();
    const rows = st.fetchAll().map((r) => {
      const o = orderRow(r);
      const net = round2(o.subtotal - ((o.discount && o.discount.amount) || 0) - ((o.promo && o.promo.amount) || 0) + o.serviceCharge);
      const methods = (o.payments || []).filter((p) => (p.amount || 0) > 0).map((p) => p.method).join('|');
      return { fiscalNumber: o.fiscalNumber || '', orderNumber: o.displayNum, dateTime: o.paidAt || o.createdAt, net: round2(net), vat: round2(o.vat), gross: round2(o.grandTotal), methods };
    });
    const esc = (v) => { const sv = String(v == null ? '' : v); return /[",\n]/.test(sv) ? '"' + sv.replace(/"/g, '""') + '"' : sv; };
    const header = ['Fiscal No', 'Order', 'Date/Time', 'Net', 'VAT', 'Gross', 'Payment'];
    const csv = [`# TRN: ${s.taxRegNo || 'n/a'}  Period: ${from}..${to}`, header.join(',')]
      .concat(rows.map((r) => [r.fiscalNumber, r.orderNumber, r.dateTime, r.net, r.vat, r.gross, r.methods].map(esc).join(','))).join('\n');
    jsonOut({ rows, csv, taxRegNo: s.taxRegNo || '', count: rows.length, totalVat: round2(arrSum(rows.map((r) => r.vat))), totalGross: round2(arrSum(rows.map((r) => r.gross))) });
  }

  // ── PRINT AGENT SETTINGS ─────────────────────────────────
  if (method === 'PUT' && uri === '/print/settings') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const sets = [], vals = [];
    if (has(body.printAgentUrl)) { sets.push('printAgentUrl=?'); vals.push(truncate(body.printAgentUrl, 300)); }
    if (has(body.printAgentEnabled)) { sets.push('printAgentEnabled=?'); vals.push(body.printAgentEnabled ? 1 : 0); }
    if (has(body.printPaperWidth)) { sets.push('printPaperWidth=?'); vals.push(Math.max(24, Math.min(64, int(body.printPaperWidth) || 48))); }
    if (sets.length) { db.prepare(`UPDATE settings SET ${sets.join(',')} WHERE id=1`).execute(vals); getSettings(true); }
    const s = getSettings();
    jsonOut({ ok: true, printAgentUrl: s.printAgentUrl, printAgentEnabled: s.printAgentEnabled, printPaperWidth: s.printPaperWidth });
  }

  // ── QR ORDERING SETTINGS ─────────────────────────────────
  if (method === 'PUT' && uri === '/qr/settings') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const sets = [], vals = [];
    if (has(body.publicBaseUrl)) { sets.push('publicBaseUrl=?'); vals.push(truncate(String(body.publicBaseUrl).replace(/\/+$/, ''), 300)); }
    if (has(body.qrOrderAutoKitchen)) { sets.push('qrOrderAutoKitchen=?'); vals.push(body.qrOrderAutoKitchen ? 1 : 0); }
    if (sets.length) { db.prepare(`UPDATE settings SET ${sets.join(',')} WHERE id=1`).execute(vals); getSettings(true); }
    const s = getSettings();
    jsonOut({ ok: true, publicBaseUrl: s.publicBaseUrl, qrOrderAutoKitchen: s.qrOrderAutoKitchen });
  }

  // ── NOTIFICATIONS ────────────────────────────────────────
  if (method === 'GET' && uri === '/notifications') {
    const uid = user.id, role = user.role;
    let rows;
    if (role === 'superManager') {
      rows = db.query('SELECT * FROM notifications ORDER BY createdAt DESC LIMIT 100').fetchAll();
    } else {
      const st = db.prepare("SELECT * FROM notifications WHERE (targetUserId=? OR (targetUserId IS NULL AND branchId=? AND (targetRole='all' OR targetRole=?))) ORDER BY createdAt DESC LIMIT 100");
      st.execute([uid, bid, role]);
      rows = st.fetchAll();
    }
    let list = rows.map((r) => notifRow(r, uid));
    if ((query.unread || '') === 'true') list = list.filter((n) => !n.read);
    jsonOut(list);
  }
  if (method === 'GET' && uri === '/notifications/unread-count') {
    const uid = user.id, role = user.role;
    const st = db.prepare("SELECT * FROM notifications WHERE (targetUserId=? OR (targetUserId IS NULL AND branchId=? AND (targetRole='all' OR targetRole=?))) ORDER BY createdAt DESC LIMIT 100");
    st.execute([uid, bid, role]);
    const rows = st.fetchAll();
    const count = rows.filter((r) => !jsonDecode(r.readBy, []).includes(uid)).length;
    jsonOut({ count });
  }
  if (method === 'POST' && routeMatch('/notifications/:id/read', uri, params)) {
    const nId = int(params.id);
    const f = db.prepare('SELECT * FROM notifications WHERE id=?'); f.execute([nId]);
    const n = f.fetch();
    if (n) {
      const readBy = jsonDecode(n.readBy, []);
      if (!readBy.includes(user.id)) { readBy.push(user.id); db.prepare('UPDATE notifications SET readBy=? WHERE id=?').execute([jsonEncode(readBy), nId]); }
    }
    jsonOut({ ok: true });
  }
  if (method === 'POST' && uri === '/notifications/read-all') {
    const uid = user.id, role = user.role;
    let rows;
    if (role === 'superManager') {
      rows = db.query('SELECT id,readBy FROM notifications').fetchAll();
    } else {
      const st = db.prepare("SELECT id,readBy FROM notifications WHERE (targetUserId=? OR (targetUserId IS NULL AND branchId=? AND (targetRole='all' OR targetRole=?)))");
      st.execute([uid, bid, role]);
      rows = st.fetchAll();
    }
    for (const r of rows) {
      const rb = jsonDecode(r.readBy, []);
      if (!rb.includes(uid)) { rb.push(uid); db.prepare('UPDATE notifications SET readBy=? WHERE id=?').execute([jsonEncode(rb), int(r.id)]); }
    }
    jsonOut({ ok: true });
  }

  // ── USERS ────────────────────────────────────────────────
  if (method === 'GET' && uri === '/users') {
    const cols = 'id,branchId,name,role,payRate,payType,authMethod,username,isHeld,mustChangePassword';
    let rows;
    if (user.role === 'superManager' || user.role === 'admin') {
      const bFilter = has(query.branchId) ? int(query.branchId) : null;
      if (bFilter) {
        const st = db.prepare(`SELECT ${cols} FROM users WHERE branchId=? OR branchId IS NULL ORDER BY id`);
        st.execute([bFilter]); rows = st.fetchAll();
      } else {
        rows = db.query(`SELECT ${cols} FROM users ORDER BY id`).fetchAll();
      }
    } else {
      const st = db.prepare(`SELECT ${cols} FROM users WHERE branchId=? OR branchId IS NULL ORDER BY id`);
      st.execute([bid]); rows = st.fetchAll();
    }
    jsonOut(rows.map((r) => userRow(r)));
  }
  if (method === 'POST' && uri === '/users') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const role = body.role || 'server';
    if (user.role === 'manager' && ['manager', 'superManager', 'admin'].includes(role)) err('Not authorized to create this role', 403);
    if (user.role === 'superManager' && role === 'admin') err('Not authorized to create this role', 403);
    const authMethod = body.authMethod || 'pin';
    const pinRaw = String(body.pin ?? '0000');
    if (authMethod === 'pin') assertPinAvailable(db, pinRaw);
    let pin = authMethod === 'pin' ? hashPin(pinRaw) : '____';
    let ph = null, mustChange = 0, username = null;
    if (authMethod === 'password') {
      const tempPw = body.tempPassword || '';
      if (tempPw.length < 6) err('Temporary password must be at least 6 characters');
      username = truncate(String(body.username || '').trim(), 100);
      if (!username) err('Username required for password auth');
      ph = passwordHash(tempPw); mustChange = 1; pin = '____';
    }
    const pinIndex = authMethod === 'pin' ? sha256hex(pinRaw) : null;
    const branchScoped = !['admin', 'superManager'].includes(role);
    let newBranchId = body.branchId ?? null;
    if (newBranchId === '' || newBranchId === 0) newBranchId = null;
    if (newBranchId === null && branchScoped) newBranchId = bid;
    if (branchScoped) {
      if (!newBranchId) err('Pick a branch for this user — ' + role + ' accounts must belong to one branch.', 400);
      const bChk = db.prepare('SELECT COUNT(*) AS c FROM branches WHERE id=?'); bChk.execute([int(newBranchId)]);
      if (!int(bChk.fetch().c)) err('That branch does not exist', 400);
      newBranchId = int(newBranchId);
    } else { newBranchId = null; }
    try {
      db.prepare('INSERT INTO users (branchId,name,pin,pin_index,role,payRate,payType,authMethod,username,passwordHash,mustChangePassword) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .execute([newBranchId, truncate(body.name || '', 200), pin, pinIndex, role, flt(body.payRate || 0), body.payType || 'hourly', authMethod, username, ph, mustChange]);
    } catch (e) { if (e instanceof Resp) throw e; err('Database error creating user: ' + e.message, 500); }
    const id = db.lastInsertId();
    const f = db.prepare('SELECT id,branchId,name,role,payRate,payType,authMethod,username,isHeld,mustChangePassword FROM users WHERE id=?');
    f.execute([id]);
    jsonOut(userRow(f.fetch()), 201);
  }
  if (routeMatch('/users/:id', uri, params)) {
    const uId = int(params.id);
    if (method === 'PUT' || method === 'PATCH') {
      requireRole(['superManager', 'manager', 'admin'], user);
      const f = db.prepare('SELECT * FROM users WHERE id=?'); f.execute([uId]);
      const target = userRow(f.fetch());
      if (!target) err('User not found', 404);
      if (!canManage(user, target)) err('You do not have permission to edit this account.', 403);
      if (user.role === 'manager' && has(body.role) && ['admin', 'superManager', 'manager'].includes(body.role)) err('You cannot assign this role', 403);
      const [sets, vals] = buildSet(body, ['name', 'role', 'payRate', 'payType', 'branchId']);
      if (sets) db.prepare(`UPDATE users SET ${sets} WHERE id=?`).execute([...vals, uId]);
      const f2 = db.prepare('SELECT id,branchId,name,role,payRate,payType,authMethod,username,isHeld,mustChangePassword FROM users WHERE id=?');
      f2.execute([uId]);
      jsonOut(userRow(f2.fetch()));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager', 'admin'], user);
      const f = db.prepare('SELECT * FROM users WHERE id=?'); f.execute([uId]);
      const target = userRow(f.fetch());
      if (!target) err('User not found', 404);
      if (target.id === user.id) err('You cannot delete your own account', 403);
      if (!canManage(user, target)) err('You do not have permission to delete this account.', 403);
      db.prepare('DELETE FROM users WHERE id=?').execute([uId]);
      jsonOut({ ok: true });
    }
  }

  // ── MY PROFILE (self-service, every role) ────────────────
  const meCols = 'id,branchId,name,role,payRate,payType,authMethod,username,isHeld,mustChangePassword,approvalPinIndex';
  if (method === 'PUT' && uri === '/me') {
    const name = truncate(String(body.name || '').trim(), 200);
    if (!name) err('Name is required');
    db.prepare('UPDATE users SET name=? WHERE id=?').execute([name, user.id]);
    const f = db.prepare(`SELECT ${meCols} FROM users WHERE id=?`); f.execute([user.id]);
    jsonOut(userRow(f.fetch()));
  }
  if (method === 'POST' && uri === '/me/login-pin') {
    if ((user.authMethod || 'pin') !== 'pin') err('Your account uses password login — change your password instead.', 400);
    const pinRaw = String(body.pin ?? '').trim();
    assertPinAvailable(db, pinRaw, user.id);
    db.prepare('UPDATE users SET pin=?, pin_index=? WHERE id=?').execute([hashPin(pinRaw), sha256hex(pinRaw), user.id]);
    jsonOut({ ok: true });
  }
  if (method === 'POST' && uri === '/me/approval-pin') {
    requireRole(['manager', 'superManager', 'admin'], user);
    const pinRaw = String(body.approvalPin ?? '').trim();
    if (pinRaw === '') {
      db.prepare('UPDATE users SET approvalPin=NULL, approvalPinIndex=NULL WHERE id=?').execute([user.id]);
      jsonOut({ ok: true, hasApprovalPin: false });
    }
    // An approval PIN must differ from the user's own login PIN.
    const self = db.prepare('SELECT pin FROM users WHERE id=?'); self.execute([user.id]);
    const selfRow = self.fetch();
    if (selfRow && verifyPin(pinRaw, selfRow.pin)) err('Your approval PIN must be different from your login PIN.', 400);
    assertApprovalPinAvailable(db, pinRaw, user.id);
    db.prepare('UPDATE users SET approvalPin=?, approvalPinIndex=? WHERE id=?').execute([hashPin(pinRaw), sha256hex(pinRaw), user.id]);
    jsonOut({ ok: true, hasApprovalPin: true });
  }

  // ── ADMIN ────────────────────────────────────────────────
  if (method === 'GET' && uri === '/admin/users') {
    requireRole(['admin'], user);
    const rows = db.query('SELECT id,branchId,name,role,payRate,payType,authMethod,username,isHeld,mustChangePassword FROM users ORDER BY id').fetchAll();
    jsonOut(rows.map((r) => userRow(r)));
  }
  if (method === 'POST' && routeMatch('/admin/users/:id/reset-pin', uri, params)) {
    requireRole(['admin', 'superManager'], user);
    const uid = int(params.id);
    const target = requireManageTarget(uid);
    if ((target.authMethod || 'pin') === 'password') err('This user uses password login. Use Reset Password instead.', 400);
    const pinRaw = String(body.pin ?? '');
    assertPinAvailable(db, pinRaw, uid);
    db.prepare('UPDATE users SET pin=?, pin_index=? WHERE id=?').execute([hashPin(pinRaw), sha256hex(pinRaw), uid]);
    jsonOut({ ok: true, method: 'pin' });
  }
  if (method === 'POST' && routeMatch('/admin/users/:id/reset-password', uri, params)) {
    requireRole(['admin', 'superManager'], user);
    const uid = int(params.id);
    const target = requireManageTarget(uid);
    const tempPassword = body.tempPassword || '';
    if (tempPassword.length < 6) err('Temporary password must be at least 6 characters');
    db.prepare('UPDATE users SET passwordHash=?, mustChangePassword=1 WHERE id=?').execute([passwordHash(tempPassword), uid]);
    jsonOut({ ok: true, method: 'password', name: target.name });
  }
  if (method === 'GET' && uri === '/admin/login-logs') {
    requireRole(['admin'], user);
    const limit = Math.min(int(query.limit || 100), 1000);
    const st = db.prepare('SELECT * FROM login_logs ORDER BY at DESC LIMIT ?'); st.execute([limit]);
    jsonOut(st.fetchAll());
  }
  if (method === 'POST' && routeMatch('/admin/users/:id/hold', uri, params)) {
    requireRole(['admin', 'superManager'], user);
    requireManageTarget(int(params.id));
    db.prepare('UPDATE users SET isHeld=1 WHERE id=?').execute([int(params.id)]);
    jsonOut({ ok: true, held: true });
  }
  if (method === 'POST' && routeMatch('/admin/users/:id/unhold', uri, params)) {
    requireRole(['admin', 'superManager'], user);
    requireManageTarget(int(params.id));
    db.prepare('UPDATE users SET isHeld=0 WHERE id=?').execute([int(params.id)]);
    jsonOut({ ok: true, held: false });
  }
  if (method === 'POST' && routeMatch('/admin/users/:id/set-auth', uri, params)) {
    requireRole(['admin', 'superManager'], user);
    const uid = int(params.id);
    requireManageTarget(uid);
    const authMethod = body.authMethod || 'pin';
    if (authMethod === 'password') {
      const username = truncate(String(body.username || '').trim(), 100);
      const tempPass = body.tempPassword || '';
      if (!username) err('Username required for password auth');
      if (tempPass.length < 6) err('Temporary password must be at least 6 characters');
      db.prepare("UPDATE users SET authMethod='password', username=?, passwordHash=?, mustChangePassword=1 WHERE id=?")
        .execute([username, passwordHash(tempPass), uid]);
    } else {
      const pinRaw = String(body.pin ?? '');
      if (pinRaw.length < 4) err('PIN must be at least 4 digits');
      db.prepare("UPDATE users SET authMethod='pin', pin=?, pin_index=?, username=NULL, passwordHash=NULL, mustChangePassword=0 WHERE id=?")
        .execute([hashPin(pinRaw), sha256hex(pinRaw), uid]);
    }
    jsonOut({ ok: true });
  }

  // ── SHIFTS ───────────────────────────────────────────────
  if (method === 'GET' && routeMatch('/shifts/open/:userId', uri, params)) {
    const st = db.prepare('SELECT * FROM shifts WHERE userId=? AND clockOut IS NULL ORDER BY clockIn DESC LIMIT 1');
    st.execute([int(params.userId)]);
    const r = st.fetch();
    jsonOut(r ? shiftRow(r) : null);
  }
  if (method === 'POST' && uri === '/shifts/clockin') {
    const uid = int(body.userId ?? user.id);
    if (uid !== user.id && !['superManager', 'manager', 'admin'].includes(user.role)) err('Not authorized to clock in other users', 403);
    const f = db.prepare('SELECT * FROM users WHERE id=?'); f.execute([uid]);
    const u2 = userRow(f.fetch());
    if (!u2) err('User not found', 404);
    db.prepare('INSERT INTO shifts (branchId,userId,userName,clockIn) VALUES (?,?,?,?)').execute([u2.branchId || bid, uid, u2.name, nowStr()]);
    const f2 = db.prepare('SELECT * FROM shifts WHERE id=?'); f2.execute([db.lastInsertId()]);
    jsonOut(shiftRow(f2.fetch()), 201);
  }
  if (method === 'POST' && uri === '/shifts/clockout') {
    const uid = int(body.userId ?? user.id);
    if (uid !== user.id && !['superManager', 'manager', 'admin'].includes(user.role)) err('Not authorized to clock out other users', 403);
    const st = db.prepare('SELECT * FROM shifts WHERE userId=? AND clockOut IS NULL ORDER BY clockIn DESC LIMIT 1');
    st.execute([uid]);
    const s = st.fetch(); if (!s) err('No open shift', 404);
    db.prepare('UPDATE shifts SET clockOut=? WHERE id=?').execute([nowStr(), int(s.id)]);
    const f = db.prepare('SELECT * FROM shifts WHERE id=?'); f.execute([int(s.id)]);
    jsonOut(shiftRow(f.fetch()));
  }
  if (method === 'GET' && uri === '/shifts') {
    let st;
    if (has(query.userId)) {
      st = db.prepare('SELECT * FROM shifts WHERE userId=? ORDER BY clockIn DESC LIMIT 50'); st.execute([int(query.userId)]);
    } else {
      st = db.prepare('SELECT * FROM shifts WHERE branchId=? ORDER BY clockIn DESC'); st.execute([bid]);
    }
    jsonOut(st.fetchAll().map((r) => shiftRow(r)));
  }

  // ── KITCHEN TAG TEMPLATES ────────────────────────────────
  if (method === 'GET' && uri === '/kitchen-tag-templates') {
    jsonOut(['Running behind', 'Waiting on ingredient', 'Out of stock — substituting', 'Extra prep time needed', 'Equipment issue', 'Custom note']);
  }

  // ── MESSAGES ─────────────────────────────────────────────
  if (method === 'GET' && uri === '/messages/unread-count') {
    const uid = user.id;
    const st = db.prepare("SELECT * FROM messages WHERE parentId IS NULL AND (fromUserId=? OR toUserId=? OR (toRole=? AND branchId=?) OR (toRole='all' AND branchId=?))");
    st.execute([uid, uid, user.role, bid, bid]);
    let count = 0;
    for (const root of st.fetchAll()) {
      const rootId = int(root.id);
      const replies = db.prepare('SELECT readBy FROM messages WHERE id=? OR parentId=?'); replies.execute([rootId, rootId]);
      for (const m of replies.fetchAll()) { if (!jsonDecode(m.readBy, []).includes(uid)) { count++; break; } }
    }
    jsonOut({ count });
  }
  if (method === 'GET' && uri === '/messages/threads') {
    const uid = user.id;
    const st = db.prepare("SELECT * FROM messages WHERE parentId IS NULL AND (fromUserId=? OR toUserId=? OR (toRole=? AND branchId=?) OR (toRole='all' AND branchId=?)) ORDER BY createdAt DESC");
    st.execute([uid, uid, user.role, bid, bid]);
    const threads = [];
    for (const root of st.fetchAll()) {
      const rootId = int(root.id);
      const replSt = db.prepare('SELECT * FROM messages WHERE parentId=? ORDER BY createdAt'); replSt.execute([rootId]);
      const replies = replSt.fetchAll();
      const all = [root, ...replies];
      const last = all[all.length - 1];
      let unread = false;
      for (const m of all) { if (!jsonDecode(m.readBy, []).includes(uid) && int(m.fromUserId) !== uid) { unread = true; break; } }
      const toLabel = root.toUserId ? root.toName : (root.toRole === 'all' ? 'Everyone' : `${root.toRole} (broadcast)`);
      threads.push({ threadId: rootId, to: toLabel, subject: String(root.body).substring(0, 60), lastMessage: last, messageCount: all.length, unread });
    }
    jsonOut(threads);
  }
  if (method === 'GET' && routeMatch('/messages/thread/:id', uri, params)) {
    const tid = int(params.id);
    const f = db.prepare('SELECT * FROM messages WHERE id=?'); f.execute([tid]);
    const root = f.fetch(); if (!root) err('Not found', 404);
    const replSt = db.prepare('SELECT * FROM messages WHERE parentId=? ORDER BY createdAt'); replSt.execute([tid]);
    const all = [root, ...replSt.fetchAll()];
    for (const m of all) {
      const rb = jsonDecode(m.readBy, []);
      if (!rb.includes(user.id)) { rb.push(user.id); db.prepare('UPDATE messages SET readBy=? WHERE id=?').execute([jsonEncode(rb), int(m.id)]); }
    }
    jsonOut(all);
  }
  if (method === 'POST' && uri === '/messages') {
    const parentId = body.parentId || null;
    if (!parentId) {
      requireRole(['manager', 'superManager'], user);
      const toUserId = body.toUserId || null;
      const toRole = body.toRole || null;
      let toName = '';
      if (toUserId) {
        const tuSt = db.prepare('SELECT * FROM users WHERE id=?'); tuSt.execute([int(toUserId)]);
        const tu = userRow(tuSt.fetch());
        toName = tu ? tu.name : '';
      }
      db.prepare('INSERT INTO messages (branchId,fromUserId,fromName,fromRole,toUserId,toName,toRole,body,readBy) VALUES (?,?,?,?,?,?,?,?,?)')
        .execute([bid, user.id, user.name, user.role, toUserId || null, toName, toRole || null, truncate(body.body || '', 5000), jsonEncode([user.id])]);
      const msgId = db.lastInsertId();
      if (toUserId) addNotification({ branchId: bid, type: 'message', message: `New message from ${user.name}`, targetUserId: int(toUserId), relatedId: msgId });
      else addNotification({ branchId: bid, type: 'message', message: `New message from ${user.name} (to ` + (toRole === 'all' ? 'everyone' : toRole) + ')', targetRole: toRole, relatedId: msgId });
      const f = db.prepare('SELECT * FROM messages WHERE id=?'); f.execute([msgId]);
      jsonOut(f.fetch(), 201);
    } else {
      const rootSt = db.prepare('SELECT * FROM messages WHERE id=?'); rootSt.execute([int(parentId)]);
      const root = rootSt.fetch(); if (!root) err('Thread not found', 404);
      const uid = user.id;
      const isParticipant = int(root.fromUserId) === uid || int(root.toUserId) === uid ||
        (root.toRole === user.role && int(root.branchId) === bid) || (root.toRole === 'all' && int(root.branchId) === bid);
      if (!isParticipant) err('Not a participant', 403);
      const toUid = uid === int(root.fromUserId) ? root.toUserId : root.fromUserId;
      const toName = uid === int(root.fromUserId) ? root.toName : root.fromName;
      db.prepare('INSERT INTO messages (branchId,parentId,fromUserId,fromName,fromRole,toUserId,toName,body,readBy) VALUES (?,?,?,?,?,?,?,?,?)')
        .execute([int(root.branchId), int(parentId), uid, user.name, user.role, toUid || null, toName || '', truncate(body.body || '', 5000), jsonEncode([uid])]);
      const msgId = db.lastInsertId();
      if (toUid) addNotification({ branchId: int(root.branchId), type: 'message', message: `${user.name} replied to a message`, targetUserId: int(toUid), relatedId: int(root.id) });
      const f = db.prepare('SELECT * FROM messages WHERE id=?'); f.execute([msgId]);
      jsonOut(f.fetch(), 201);
    }
  }

  // ── PAYROLL ──────────────────────────────────────────────
  if (method === 'GET' && uri === '/payroll/summary') {
    const bScope = user.role === 'superManager' ? null : bid;
    let sql = 'SELECT * FROM shifts WHERE clockOut IS NOT NULL';
    const args = [];
    if (bScope) { sql += ' AND branchId=?'; args.push(bScope); }
    if (has(query.from)) { sql += ' AND clockIn>=?'; args.push(query.from); }
    if (has(query.to)) { sql += ' AND clockIn<?'; args.push(query.to); }
    const st = db.prepare(sql); st.execute(args);
    const shifts = st.fetchAll();
    const byUser = {};
    for (const s of shifts) {
      const uid = int(s.userId);
      if (!byUser[uid]) byUser[uid] = { userId: uid, userName: s.userName, hours: 0 };
      byUser[uid].hours += (tsSeconds(s.clockOut) - tsSeconds(s.clockIn)) / 3600;
    }
    let users;
    if (bScope) { const uSt = db.prepare('SELECT * FROM users WHERE branchId=?'); uSt.execute([bScope]); users = uSt.fetchAll(); }
    else users = db.query('SELECT * FROM users').fetchAll();
    const rows = [];
    for (const uid in byUser) {
      const row = byUser[uid];
      const u = users.find((x) => int(x.id) === int(uid)) || null;
      const payRate = u ? flt(u.payRate) : 0;
      const payType = u ? (u.payType || 'hourly') : 'hourly';
      if (payType === 'daily') {
        const days = new Set(shifts.filter((s) => int(s.userId) === int(uid)).map((s) => todayStr(new Date(s.clockIn.replace(' ', 'T'))))).size;
        rows.push(Object.assign({}, row, { hours: round2(row.hours), days, payRate, payType: 'daily', amountDue: round2(days * payRate) }));
      } else {
        rows.push(Object.assign({}, row, { hours: round2(row.hours), payRate, payType: 'hourly', amountDue: round2(row.hours * payRate) }));
      }
    }
    jsonOut(rows);
  }

  // ── INGREDIENTS / INVENTORY ──────────────────────────────
  if (method === 'GET' && uri === '/ingredients') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM ingredients WHERE branchId=? ORDER BY name'); st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => ingredientRow(r)));
  }
  if (method === 'POST' && uri === '/ingredients') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO ingredients (branchId,name,unit,qty,unitCost,lowStockThreshold) VALUES (?,?,?,?,?,?)')
      .execute([bid, truncate(body.name || '', 200), truncate(body.unit || 'pcs', 30), flt(body.qty || 0), flt(body.unitCost || 0), flt(body.lowStockThreshold || 0)]);
    const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(ingredientRow(f.fetch()), 201);
  }
  if (routeMatch('/ingredients/:id/restock', uri, params)) {
    const iId = int(params.id);
    if (method === 'POST' || method === 'PATCH') {
      requireRole(['superManager', 'manager', 'finance'], user);
      const qty = flt(has(body.amount) ? body.amount : (body.qty || 0));
      if (qty <= 0) err('Amount must be greater than 0', 400);
      db.prepare('UPDATE ingredients SET qty = qty + ? WHERE id=?').execute([qty, iId]);
      const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([iId]);
      jsonOut(ingredientRow(f.fetch()));
    }
  }
  // ── WASTE / TRANSFER TRACKING ────────────────────────────
  // Record spoilage/loss: decrement stock (never below zero) and log it.
  if (method === 'POST' && uri === '/inventory/waste') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    const iId = int(body.ingredientId);
    const qty = round2(flt(body.qty || 0));
    if (qty <= 0) err('Quantity must be greater than 0', 400);
    const f = db.prepare('SELECT * FROM ingredients WHERE id=? AND branchId=?'); f.execute([iId, bid]);
    const ing = f.fetch(); if (!ing) err('Ingredient not found', 404);
    db.prepare('UPDATE ingredients SET qty = MAX(0, qty - ?) WHERE id=?').execute([qty, iId]);
    db.prepare('INSERT INTO stock_movements (branchId,ingredientId,ingredientName,type,qty,unit,reason,byStaffName) VALUES (?,?,?,?,?,?,?,?)')
      .execute([bid, iId, ing.name, 'waste', qty, ing.unit || '', truncate(body.reason || '', 300), user.name]);
    const g = db.prepare('SELECT * FROM ingredients WHERE id=?'); g.execute([iId]);
    jsonOut(ingredientRow(g.fetch()));
  }
  // Transfer stock to another branch: decrement here, add there (matching by
  // name, creating the ingredient at the destination if needed). Two log rows.
  if (method === 'POST' && uri === '/inventory/transfer') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const iId = int(body.ingredientId);
    const qty = round2(flt(body.qty || 0));
    const toBranch = int(body.toBranchId);
    if (qty <= 0) err('Quantity must be greater than 0', 400);
    if (!toBranch || toBranch === bid) err('Choose a different destination branch', 400);
    const dchk = db.prepare('SELECT id,name FROM branches WHERE id=?'); dchk.execute([toBranch]);
    const dbr = dchk.fetch(); if (!dbr) err('Destination branch not found', 404);
    const f = db.prepare('SELECT * FROM ingredients WHERE id=? AND branchId=?'); f.execute([iId, bid]);
    const ing = f.fetch(); if (!ing) err('Ingredient not found', 404);
    if (flt(ing.qty) < qty) err(`Only ${flt(ing.qty)} ${ing.unit || ''} in stock to transfer`, 400);
    db.prepare('UPDATE ingredients SET qty = MAX(0, qty - ?) WHERE id=?').execute([qty, iId]);
    // Find or create the matching ingredient at the destination.
    const dSt = db.prepare('SELECT * FROM ingredients WHERE branchId=? AND name=?'); dSt.execute([toBranch, ing.name]);
    let dIng = dSt.fetch();
    if (dIng) {
      db.prepare('UPDATE ingredients SET qty = qty + ? WHERE id=?').execute([qty, int(dIng.id)]);
    } else {
      db.prepare('INSERT INTO ingredients (branchId,name,unit,qty,unitCost,lowStockThreshold) VALUES (?,?,?,?,?,?)')
        .execute([toBranch, ing.name, ing.unit || '', qty, flt(ing.unitCost || 0), flt(ing.lowStockThreshold || 0)]);
      dIng = { id: db.lastInsertId() };
    }
    const reason = truncate(body.reason || '', 300);
    db.prepare('INSERT INTO stock_movements (branchId,ingredientId,ingredientName,type,qty,unit,reason,counterpartyBranchId,byStaffName) VALUES (?,?,?,?,?,?,?,?,?)')
      .execute([bid, iId, ing.name, 'transfer_out', qty, ing.unit || '', reason, toBranch, user.name]);
    db.prepare('INSERT INTO stock_movements (branchId,ingredientId,ingredientName,type,qty,unit,reason,counterpartyBranchId,byStaffName) VALUES (?,?,?,?,?,?,?,?,?)')
      .execute([toBranch, int(dIng.id), ing.name, 'transfer_in', qty, ing.unit || '', reason, bid, user.name]);
    const g = db.prepare('SELECT * FROM ingredients WHERE id=?'); g.execute([iId]);
    jsonOut({ source: ingredientRow(g.fetch()), toBranch: dbr.name });
  }
  if (method === 'GET' && uri === '/inventory/movements') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    if (!bid) jsonOut([]);
    const type = truncate(query.type || '', 20);
    let st;
    if (type) { st = db.prepare('SELECT * FROM stock_movements WHERE branchId=? AND type=? ORDER BY id DESC LIMIT 200'); st.execute([bid, type]); }
    else { st = db.prepare('SELECT * FROM stock_movements WHERE branchId=? ORDER BY id DESC LIMIT 200'); st.execute([bid]); }
    jsonOut(st.fetchAll().map((r) => ({
      id: int(r.id), ingredientId: int(r.ingredientId), ingredientName: r.ingredientName,
      type: r.type, qty: flt(r.qty), unit: r.unit, reason: r.reason,
      counterpartyBranchId: r.counterpartyBranchId ? int(r.counterpartyBranchId) : null,
      byStaffName: r.byStaffName, createdAt: r.createdAt,
    })));
  }
  if (routeMatch('/ingredients/:id', uri, params)) {
    const iId = int(params.id);
    if (method === 'PUT' || method === 'PATCH') {
      requireRole(['superManager', 'manager', 'admin'], user);
      const [sets, vals] = buildSet(body, ['name', 'unit', 'qty', 'unitCost', 'lowStockThreshold']);
      if (sets) db.prepare(`UPDATE ingredients SET ${sets} WHERE id=?`).execute([...vals, iId]);
      const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([iId]);
      jsonOut(ingredientRow(f.fetch()));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM ingredients WHERE id=?').execute([iId]);
      jsonOut({ ok: true });
    }
  }
  if (method === 'GET' && uri === '/inventory') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM ingredients WHERE branchId=? ORDER BY name'); st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => ingredientRow(r)));
  }
  if (method === 'POST' && uri === '/inventory') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO ingredients (branchId,name,unit,qty,unitCost,lowStockThreshold) VALUES (?,?,?,?,?,?)')
      .execute([bid, truncate(body.name || '', 200), truncate(body.unit || 'pcs', 30), flt(body.qty || 0), flt(body.unitCost || 0), flt(body.lowStockThreshold || 0)]);
    const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(ingredientRow(f.fetch()), 201);
  }
  if (routeMatch('/inventory/:id', uri, params)) {
    const iId = int(params.id);
    if (method === 'PUT') {
      requireRole(['superManager', 'manager'], user);
      const [sets, vals] = buildSet(body, ['name', 'unit', 'qty', 'unitCost', 'lowStockThreshold']);
      if (sets) db.prepare(`UPDATE ingredients SET ${sets} WHERE id=?`).execute([...vals, iId]);
      const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([iId]);
      jsonOut(ingredientRow(f.fetch()));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM ingredients WHERE id=?').execute([iId]);
      jsonOut({ ok: true });
    }
  }
  if (method === 'POST' && routeMatch('/inventory/:id/adjust', uri, params)) {
    requireRole(['superManager', 'manager'], user);
    const iId = int(params.id);
    const delta = flt(body.delta || 0);
    db.prepare('UPDATE ingredients SET qty = qty + ? WHERE id=?').execute([delta, iId]);
    const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([iId]);
    jsonOut(ingredientRow(f.fetch()));
  }

  // ── SUPPLIERS & PURCHASES ────────────────────────────────
  if (method === 'GET' && uri === '/suppliers') {
    const st = db.prepare('SELECT * FROM suppliers WHERE branchId=? ORDER BY name'); st.execute([bid]);
    jsonOut(st.fetchAll());
  }
  if (method === 'POST' && uri === '/suppliers') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO suppliers (branchId,name,contact,email,notes) VALUES (?,?,?,?,?)')
      .execute([bid, truncate(body.name || '', 200), truncate(body.contact || '', 200), truncate(body.email || '', 200), truncate(body.notes || '', 2000)]);
    const f = db.prepare('SELECT * FROM suppliers WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(f.fetch(), 201);
  }
  if (routeMatch('/suppliers/:id', uri, params)) {
    const sId = int(params.id);
    if (method === 'PUT') {
      requireRole(['superManager', 'manager'], user);
      const [sets, vals] = buildSet(body, ['name', 'contact', 'email', 'notes']);
      if (sets) db.prepare(`UPDATE suppliers SET ${sets} WHERE id=?`).execute([...vals, sId]);
      const f = db.prepare('SELECT * FROM suppliers WHERE id=?'); f.execute([sId]);
      jsonOut(f.fetch());
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM suppliers WHERE id=?').execute([sId]);
      jsonOut({ ok: true });
    }
  }
  if (method === 'GET' && uri === '/purchases') {
    const st = db.prepare('SELECT * FROM purchases WHERE branchId=? ORDER BY createdAt DESC'); st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => {
      const items = jsonDecode(r.items || '[]', []);
      return Object.assign({}, r, {
        id: int(r.id), total: flt(r.total), items,
        ingredientName: (items[0] && items[0].name) ? items[0].name : '',
        qty: (items[0] && items[0].qty) ? flt(items[0].qty) : 0,
      });
    }));
  }

  // PUT /api/stock-auto-close — managers can toggle month-end auto close
  if (method === 'PUT' && uri === '/stock-auto-close') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const on = body.autoStockClose ? 1 : 0;
    db.prepare('UPDATE settings SET autoStockClose=? WHERE id=1').execute([on]);
    getSettings(true);
    jsonOut({ ok: true, autoStockClose: !!on });
  }

  // ── STOCK PERIODS ────────────────────────────────────────
  if (method === 'GET' && uri === '/stock-periods') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM stock_periods WHERE branchId=? ORDER BY endDate DESC, id DESC'); st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, {
      id: int(r.id), branchId: int(r.branchId), lines: jsonDecode(r.lines, []),
      openingValue: flt(r.openingValue), purchaseValue: flt(r.purchaseValue),
      consumedValue: flt(r.consumedValue), closingValue: flt(r.closingValue),
    })));
  }
  if (method === 'GET' && uri === '/stock-periods/preview') {
    requireRole(['superManager', 'manager', 'finance', 'admin'], user);
    if (!bid) err('Pick a branch first', 400);
    const from = query.from || monthStart();
    const to = query.to || todayStr();
    const ings = db.prepare('SELECT * FROM ingredients WHERE branchId=? ORDER BY name'); ings.execute([bid]);
    const ingredients = ings.fetchAll().map((r) => ingredientRow(r));
    const openingMap = {};
    let prevRow = null;
    const prev = db.prepare('SELECT "lines" FROM stock_periods WHERE branchId=? AND endDate < ? ORDER BY endDate DESC, id DESC LIMIT 1');
    prev.execute([bid, from]); prevRow = prev.fetch();
    if (prevRow) for (const ln of jsonDecode(prevRow.lines, [])) openingMap[int(ln.ingredientId)] = flt(ln.closing || 0);
    const purchasedMap = {};
    const pSt = db.prepare('SELECT items FROM purchases WHERE branchId=? AND date(createdAt) BETWEEN ? AND ?');
    pSt.execute([bid, from, to]);
    for (const pr of pSt.fetchAll()) for (const it of jsonDecode(pr.items, [])) {
      const iid = int(it.ingredientId); if (!iid) continue;
      purchasedMap[iid] = (purchasedMap[iid] || 0) + flt(it.qty || 0);
    }
    const lines = ingredients.map((ing) => {
      const iid = ing.id;
      const opening = openingMap[iid] || 0.0;
      const purchased = purchasedMap[iid] || 0.0;
      const closing = ing.qty;
      const consumed = Math.max(0, opening + purchased - closing);
      return {
        ingredientId: iid, name: ing.name, unit: ing.unit, unitCost: ing.unitCost,
        opening: H.roundN(opening, 3), purchased: H.roundN(purchased, 3),
        consumed: H.roundN(consumed, 3), closing: H.roundN(closing, 3),
      };
    });
    jsonOut({ from, to, lines, hasPrevious: !!prevRow });
  }
  if (method === 'POST' && uri === '/stock-periods') {
    requireRole(['superManager', 'manager', 'admin'], user);
    if (!bid) err('Pick a branch first', 400);
    const label = truncate(body.label || '', 60);
    const from = body.from || monthStart();
    const to = body.to || todayStr();
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!label) err('Give the period a label (e.g. "July 2026")', 400);
    if (!lines.length) err('No stock lines to save', 400);
    let openingValue = 0, purchaseValue = 0, consumedValue = 0, closingValue = 0;
    const clean = [];
    for (const ln of lines) {
      const uc = flt(ln.unitCost || 0);
      const opening = flt(ln.opening || 0), purchased = flt(ln.purchased || 0), consumed = flt(ln.consumed || 0), closing = flt(ln.closing || 0);
      openingValue += opening * uc; purchaseValue += purchased * uc; consumedValue += consumed * uc; closingValue += closing * uc;
      clean.push({ ingredientId: int(ln.ingredientId), name: truncate(ln.name || '', 200), unit: truncate(ln.unit || '', 30), unitCost: uc, opening: H.roundN(opening, 3), purchased: H.roundN(purchased, 3), consumed: H.roundN(consumed, 3), closing: H.roundN(closing, 3) });
    }
    db.prepare(
      `INSERT INTO stock_periods (branchId,label,startDate,endDate,status,"lines",openingValue,purchaseValue,consumedValue,closingValue,closedByName,note)
       VALUES (?,?,?,?,'closed',?,?,?,?,?,?,?)`
    ).execute([bid, label, from, to, jsonEncode(clean), round2(openingValue), round2(purchaseValue), round2(consumedValue), round2(closingValue), user.name, truncate(body.note || '', 2000)]);
    const newId = db.lastInsertId();
    if (body.setStockToClosing) {
      for (const ln of clean) if (ln.ingredientId) db.prepare('UPDATE ingredients SET qty=? WHERE id=? AND branchId=?').execute([ln.closing, ln.ingredientId, bid]);
    }
    const f = db.prepare('SELECT * FROM stock_periods WHERE id=?'); f.execute([newId]);
    const row = f.fetch(); row.id = int(row.id); row.lines = jsonDecode(row.lines, []);
    jsonOut(row, 201);
  }
  if (method === 'PUT' && routeMatch('/stock-periods/:id', uri, params)) {
    requireRole(['superManager', 'manager', 'admin'], user);
    const pid = int(params.id);
    const chk = db.prepare('SELECT branchId FROM stock_periods WHERE id=?'); chk.execute([pid]);
    const row = chk.fetch();
    if (!row) err('Period not found', 404);
    if (user.role !== 'superManager' && int(row.branchId) !== int(bid)) err('Not your branch', 403);
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) err('No stock lines', 400);
    let openingValue = 0, purchaseValue = 0, consumedValue = 0, closingValue = 0;
    const clean = [];
    for (const ln of lines) {
      const uc = flt(ln.unitCost || 0);
      const opening = flt(ln.opening || 0), purchased = flt(ln.purchased || 0), consumed = flt(ln.consumed || 0), closing = flt(ln.closing || 0);
      openingValue += opening * uc; purchaseValue += purchased * uc; consumedValue += consumed * uc; closingValue += closing * uc;
      clean.push({ ingredientId: int(ln.ingredientId), name: truncate(ln.name || '', 200), unit: truncate(ln.unit || '', 30), unitCost: uc, opening: H.roundN(opening, 3), purchased: H.roundN(purchased, 3), consumed: H.roundN(consumed, 3), closing: H.roundN(closing, 3) });
    }
    db.prepare('UPDATE stock_periods SET label=?, "lines"=?, openingValue=?, purchaseValue=?, consumedValue=?, closingValue=?, note=? WHERE id=?')
      .execute([truncate(body.label || '', 60), jsonEncode(clean), round2(openingValue), round2(purchaseValue), round2(consumedValue), round2(closingValue), truncate(body.note || '', 2000), pid]);
    const f = db.prepare('SELECT * FROM stock_periods WHERE id=?'); f.execute([pid]);
    const r = f.fetch(); r.id = int(r.id); r.lines = jsonDecode(r.lines, []);
    jsonOut(r);
  }
  if (method === 'DELETE' && routeMatch('/stock-periods/:id', uri, params)) {
    requireRole(['superManager', 'manager', 'admin'], user);
    const pid = int(params.id);
    db.prepare("DELETE FROM stock_periods WHERE id=? AND (branchId=? OR ?='superManager')").execute([pid, bid, user.role]);
    jsonOut({ ok: true });
  }
  if (method === 'POST' && uri === '/purchases') {
    requireRole(['superManager', 'manager', 'finance'], user);
    const ingredientId = body.ingredientId || null;
    const supplierId = body.supplierId || null;
    const qty = flt(body.qty || 0);
    const cost = flt(has(body.cost) ? body.cost : (body.total || 0));
    const note = truncate(body.note || '', 2000);
    let supplierName = '';
    if (supplierId) { const ss = db.prepare('SELECT name FROM suppliers WHERE id=?'); ss.execute([supplierId]); const sr = ss.fetch(); supplierName = sr ? sr.name : ''; }
    let items;
    if (ingredientId) {
      const is = db.prepare('SELECT name,unit FROM ingredients WHERE id=?'); is.execute([ingredientId]); const ir = is.fetch();
      items = [{ ingredientId: int(ingredientId), name: ir ? ir.name : '', qty, unit: ir ? ir.unit : '', cost }];
      db.prepare('UPDATE ingredients SET qty = qty + ? WHERE id=?').execute([qty, int(ingredientId)]);
    } else { items = body.items || []; }
    db.prepare('INSERT INTO purchases (branchId,supplierId,supplierName,items,total,note) VALUES (?,?,?,?,?,?)')
      .execute([bid, supplierId || null, supplierName, jsonEncode(items), cost, note]);
    const newId = db.lastInsertId();
    const f = db.prepare('SELECT * FROM purchases WHERE id=?'); f.execute([newId]);
    const row = f.fetch();
    const parsedItems = jsonDecode(row.items || '[]', []);
    row.ingredientName = (parsedItems[0] && parsedItems[0].name) ? parsedItems[0].name : '';
    row.supplierName = supplierName; row.qty = qty;
    jsonOut(row, 201);
  }

  // ── Z-REPORTS ────────────────────────────────────────────
  if (method === 'GET' && uri === '/zreports') {
    const st = db.prepare('SELECT * FROM z_reports WHERE branchId=? ORDER BY generatedAt DESC'); st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { grossSales: flt(r.grossSales), netSales: flt(r.netSales), paymentBreakdown: jsonDecode(r.paymentBreakdown) })));
  }
  if (method === 'POST' && uri === '/zreports') {
    requireRole(['superManager', 'manager'], user);
    const from = safeDate(body.fromDate || '');
    const to = safeDate(body.toDate || '');
    const st = db.prepare("SELECT * FROM orders WHERE branchId=? AND paymentStatus='paid' AND paidAt>=? AND paidAt<?");
    st.execute([bid, from, to]);
    const orders = st.fetchAll().map((r) => orderRow(r));
    const vs = db.prepare('SELECT * FROM orders WHERE branchId=? AND void_data IS NOT NULL AND createdAt>=? AND createdAt<?');
    vs.execute([bid, from, to]);
    const voided = vs.fetchAll().map((r) => orderRow(r));
    const gross = arrSum(arrColumn(orders, 'subtotal'));
    const disc = arrSum(orders.map((o) => (o.discount && o.discount.amount) || 0));
    const sc = arrSum(arrColumn(orders, 'serviceCharge'));
    const vat = arrSum(arrColumn(orders, 'vat'));
    const net = arrSum(arrColumn(orders, 'total'));
    const pb = { cash: 0, card: 0, wallet: 0 };
    for (const o of orders) for (const p of o.payments) if (pb[p.method] !== undefined) pb[p.method] += p.amount;
    const vt = arrSum(arrColumn(voided, 'total'));
    db.prepare('INSERT INTO z_reports (branchId,generatedBy,fromDate,toDate,orderCount,grossSales,totalDiscounts,totalServiceCharge,totalVat,netSales,paymentBreakdown,voidedCount,voidedTotal) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .execute([bid, user.name, from, to, orders.length, round2(gross), round2(disc), round2(sc), round2(vat), round2(net), jsonEncode(pb), voided.length, round2(vt)]);
    const f = db.prepare('SELECT * FROM z_reports WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(Object.assign({}, f.fetch(), { paymentBreakdown: pb }));
  }

  // ── PETTY CASH ───────────────────────────────────────────
  if (method === 'GET' && uri === '/petty-cash') {
    const st = db.prepare('SELECT * FROM petty_cash WHERE branchId=? ORDER BY createdAt DESC'); st.execute([bid]);
    const rows = st.fetchAll();
    let balance = 0;
    const entries = rows.map((r) => {
      const amt = flt(r.amount);
      balance += (r.type === 'in' ? amt : -amt);
      return {
        id: int(r.id), type: r.type, amount: amt,
        reason: r.description || '', description: r.description || '',
        recordedBy: r.staffName || '', staffName: r.staffName || '',
        createdAt: r.createdAt,
      };
    });
    jsonOut({ entries, balance: round2(balance) });
  }
  if (method === 'POST' && uri === '/petty-cash') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO petty_cash (branchId,type,amount,description,staffName) VALUES (?,?,?,?,?)')
      .execute([bid, body.type || 'out', flt(body.amount || 0), truncate(body.reason || body.description || '', 1000), user.name]);
    jsonOut({ ok: true }, 201);
  }

  // ── REPORTS / DASHBOARD ──────────────────────────────────
  if (method === 'GET' && uri === '/reports/summary') {
    const range = query.range || 'today';
    const now = todayStr();
    let from;
    switch (range) {
      case 'week': from = mondayThisWeek(); break;
      case 'all': from = '2000-01-01'; break;
      case 'month': from = monthStart(); break;
      default: from = now;
    }
    const st = db.prepare("SELECT * FROM orders WHERE branchId=? AND paymentStatus='paid' AND date(paidAt)>=?");
    st.execute([bid, from]);
    const orders = st.fetchAll().map((r) => orderRow(r));
    const revenue = round2(arrSum(orders.map((o) => o.grandTotal)));
    const count = orders.length;
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = dateAddDays(-i);
      const dayOrders = orders.filter((o) => o.paidAt && todayStr(new Date(String(o.paidAt).replace(' ', 'T'))) === d);
      trend.push(round2(arrSum(dayOrders.map((o) => o.grandTotal))));
    }
    const vs = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(total),0) as t FROM orders WHERE branchId=? AND void_data IS NOT NULL AND date(createdAt)>=?');
    vs.execute([bid, from]);
    const v = vs.fetch();
    // Refunds in range. A refund is a negative payment and already removes the
    // sale from `revenue` (it nulls the order's paidAt), so we surface it as its
    // own figure rather than subtracting twice.
    const rfSt = db.prepare(`SELECT payments FROM orders WHERE branchId=? AND payments LIKE '%"type":"refund"%'`);
    rfSt.execute([bid]);
    let refunds = 0, refundCount = 0;
    for (const row of rfSt.fetchAll()) {
      for (const p of (jsonDecode(row.payments, []) || [])) {
        if (p.type !== 'refund') continue;
        const d = p.paidAt ? String(p.paidAt).slice(0, 10) : null;
        if (!d || d < from) continue;
        refunds += Math.abs(flt(p.amount || 0)); refundCount++;
      }
    }
    jsonOut({ revenue, orderCount: count, trend, voidedCount: int(v.c), voidedTotal: round2(flt(v.t)), refunds: round2(refunds), refundCount });
  }

  if (method === 'GET' && uri === '/dashboard/summary') {
    let bids = [];
    if (user.role === 'superManager') for (const b of db.query('SELECT id FROM branches').fetchAll()) bids.push(int(b.id));
    else bids = [bid];
    const now = todayStr();
    const summaries = [];
    let totalRevenue = 0, totalOrders = 0, totalKitchen = 0, totalRefunds = 0, totalRefundCount = 0;
    let totalOpenTables = 0, totalLowStock = 0;
    const methodKeys = ['cash', 'card', 'online', 'wallet'];
    const totalByMethod = {};
    for (const k of methodKeys) totalByMethod[k] = { gross: 0, fee: 0, net: 0 };
    for (const b of bids) {
      const bSt = db.prepare('SELECT * FROM branches WHERE id=?'); bSt.execute([b]);
      const binfo = bSt.fetch();
      const os = db.prepare("SELECT * FROM orders WHERE branchId=? AND paymentStatus='paid' AND date(paidAt)=?"); os.execute([b, now]);
      const orders = os.fetchAll().map((r) => orderRow(r));
      const rev = round2(arrSum(orders.map((o) => o.grandTotal)));
      const tblSt = db.prepare('SELECT * FROM tables_list WHERE branchId=?'); tblSt.execute([b]);
      const tables = tblSt.fetchAll();
      const activeTables = tables.filter((t) => t.status !== 'open').length;
      const kcSt = db.prepare("SELECT COUNT(*) as c FROM orders WHERE branchId=? AND status IN ('pending','preparing')"); kcSt.execute([b]);
      const kitchenCount = int(kcSt.fetch().c);
      const lsSt = db.prepare('SELECT COUNT(*) as c FROM ingredients WHERE branchId=? AND qty<=lowStockThreshold'); lsSt.execute([b]);
      const lowStock = int(lsSt.fetch().c);
      const bByMethod = {};
      for (const k of methodKeys) bByMethod[k] = { gross: 0, fee: 0, net: 0 };
      for (const o of orders) for (const p of o.payments) {
        const m = p.method || '';
        if (!bByMethod[m]) continue;
        const gross = flt(p.amount || 0); const fee = flt(p.feeAmount || 0);
        const net = has(p.netAmount) ? flt(p.netAmount) : gross - fee;
        bByMethod[m].gross += gross; bByMethod[m].fee += fee; bByMethod[m].net += net;
        totalByMethod[m].gross += gross; totalByMethod[m].fee += fee; totalByMethod[m].net += net;
      }
      for (const k in bByMethod) bByMethod[k] = { gross: round2(bByMethod[k].gross), fee: round2(bByMethod[k].fee), net: round2(bByMethod[k].net) };
      // Refunds issued today at this branch (refunded orders are excluded from
      // the paid-orders set above, so scan their payments directly).
      const rfSt = db.prepare(`SELECT payments FROM orders WHERE branchId=? AND payments LIKE '%"type":"refund"%'`); rfSt.execute([b]);
      let bRefunds = 0, bRefundCount = 0;
      for (const row of rfSt.fetchAll()) for (const p of (jsonDecode(row.payments, []) || [])) {
        if (p.type !== 'refund') continue;
        const d = p.paidAt ? String(p.paidAt).slice(0, 10) : null;
        if (d !== now) continue;
        bRefunds += Math.abs(flt(p.amount || 0)); bRefundCount++;
      }
      bRefunds = round2(bRefunds);
      totalRevenue += rev; totalOrders += orders.length; totalKitchen += kitchenCount;
      totalRefunds += bRefunds; totalRefundCount += bRefundCount;
      totalOpenTables += activeTables; totalLowStock += lowStock;
      summaries.push(Object.assign({}, binfo || {}, { branchId: b, branchName: (binfo && binfo.name) || ('Branch ' + b), revenueToday: rev, refundsToday: bRefunds, refundCount: bRefundCount, openTables: activeTables, inKitchen: kitchenCount, lowStockCount: lowStock, byMethod: bByMethod }));
    }
    for (const k in totalByMethod) totalByMethod[k] = { gross: round2(totalByMethod[k].gross), fee: round2(totalByMethod[k].fee), net: round2(totalByMethod[k].net) };
    jsonOut({
      branches: summaries,
      totals: {
        totalRevenue: round2(totalRevenue), totalOrders, totalBranches: bids.length, totalKitchen,
        totalRefunds: round2(totalRefunds), refundCount: totalRefundCount,
        totalOpenTables, totalLowStock,
        byMethod: totalByMethod,
        totalCardFees: round2(arrSum(Object.values(totalByMethod).map((v) => v.fee))),
        netRevenue: round2(arrSum(Object.values(totalByMethod).map((v) => v.net))),
      },
    });
  }

  // ── SETTINGS BACKUP & RESET ──────────────────────────────
  if (method === 'GET' && uri === '/settings/health') {
    requireRole(['admin', 'superManager', 'manager'], user);
    const checks = [];
    const dupCount = int(db.query(
      `SELECT COUNT(*) AS c FROM (
        SELECT pin_index FROM users
        WHERE pin_index IS NOT NULL AND pin_index <> ''
          AND (authMethod IS NULL OR authMethod = '' OR authMethod = 'pin')
        GROUP BY pin_index HAVING COUNT(*) > 1) d`
    ).fetch().c || 0);
    checks.push({ level: dupCount ? 'bad' : 'ok', msg: dupCount ? `${dupCount} duplicate PIN(s) — fix in Users` : 'No duplicate PINs' });
    const orphan = int(db.query("SELECT COUNT(*) AS c FROM users WHERE role NOT IN ('admin','superManager') AND (branchId IS NULL OR branchId = 0)").fetch().c || 0);
    checks.push({ level: orphan ? 'warn' : 'ok', msg: orphan ? `${orphan} staff with no branch assigned` : 'All staff have a branch' });
    const noStation = int(db.query('SELECT COUNT(*) AS c FROM menu_items WHERE stationId IS NULL OR stationId = 0').fetch().c || 0);
    checks.push({ level: noStation ? 'warn' : 'ok', msg: noStation ? `${noStation} menu item(s) with no station — won't route to a KOT printer` : 'All menu items have a station' });
    const noCost = int(db.query('SELECT COUNT(*) AS c FROM ingredients WHERE unitCost IS NULL OR unitCost <= 0').fetch().c || 0);
    checks.push({ level: noCost ? 'warn' : 'ok', msg: noCost ? `${noCost} ingredient(s) have no unit cost — stock value understated` : 'All ingredients have a unit cost' });
    const s = getSettings();
    if (s.lastBackupAt) {
      const days = Math.floor((Date.now() - Date.parse(String(s.lastBackupAt).replace(' ', 'T'))) / 86400000);
      checks.push({ level: days > 7 ? 'warn' : 'ok', msg: days > 7 ? `Last backup was ${days} day(s) ago — download a fresh one` : `Last backup ${days} day(s) ago` });
    } else {
      checks.push({ level: 'warn', msg: 'No backup recorded yet — download one now' });
    }
    jsonOut({ checks });
  }
  if (method === 'GET' && uri === '/settings/export') {
    requireRole(['admin', 'superManager'], user);
    const tables = [
      'branches', 'users', 'settings', 'stations', 'categories', 'menu_items',
      'tables_list', 'ingredients', 'suppliers', 'purchases', 'stock_periods',
      'orders', 'held_orders', 'customers', 'shifts', 'z_reports', 'petty_cash',
      'permissions', 'order_sequences', 'messages', 'notifications',
    ];
    const dump = {};
    for (const t of tables) {
      try { dump[t] = db.query(`SELECT * FROM \`${t}\``).fetchAll(); }
      catch (e) { dump[t] = [{ _error: 'table not found or unreadable' }]; }
    }
    try { db.exec(`UPDATE settings SET lastBackupAt='${nowStr()}' WHERE id=1`); } catch (e) {}
    getSettings(true);
    jsonOut({ exportedAt: isoNow(), exportedBy: user.name, schemaVersion: 'pos-php-1', tables: dump });
  }
  // POST /api/settings/import — restore a downloaded JSON backup (destructive).
  if (method === 'POST' && uri === '/settings/import') {
    requireRole(['admin'], user);
    const tables = body && body.tables;
    if (!tables || typeof tables !== 'object') err('Invalid backup file — no "tables" section found.', 400);
    if (!body.confirm) err('Confirmation required to overwrite current data.', 400);
    const tableOrder = [
      'branches', 'users', 'settings', 'stations', 'categories', 'menu_items',
      'tables_list', 'ingredients', 'suppliers', 'purchases', 'stock_periods',
      'orders', 'held_orders', 'customers', 'shifts', 'z_reports', 'petty_cash',
      'permissions', 'order_sequences', 'messages', 'notifications',
    ];
    let restored = 0, rowsIn = 0;
    db.exec('PRAGMA foreign_keys=OFF');
    db.beginTransaction();
    try {
      for (const t of tableOrder) {
        const rows = tables[t];
        if (!Array.isArray(rows)) continue;
        db.exec(`DELETE FROM \`${t}\``);
        for (const row of rows) {
          if (!row || typeof row !== 'object' || row._error) continue;
          const cols = Object.keys(row);
          if (!cols.length) continue;
          const sql = `INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
          const vals = cols.map((c) => {
            const v = row[c];
            if (v === null || v === undefined) return null;
            if (typeof v === 'boolean') return v ? 1 : 0;
            if (typeof v === 'object') return JSON.stringify(v);
            return v;
          });
          try { db.prepare(sql).execute(vals); rowsIn++; } catch (e) { /* skip incompatible row */ }
        }
        restored++;
      }
      db.commit();
    } catch (e) {
      db.rollBack();
      db.exec('PRAGMA foreign_keys=ON');
      if (e instanceof Resp) throw e;
      err('Restore failed: ' + e.message, 500);
    }
    db.exec('PRAGMA foreign_keys=ON');
    getSettings(true);
    jsonOut({ ok: true, tablesRestored: restored, rowsRestored: rowsIn });
  }

  if (method === 'POST' && uri === '/settings/backup') {
    requireRole(['admin'], user);
    db.prepare('UPDATE settings SET lastBackupAt=? WHERE id=1').execute([nowStr()]);
    jsonOut({ ok: true, settings: getSettings(true) });
  }
  if (method === 'POST' && uri === '/settings/reset-test-data') {
    requireRole(['admin'], user);
    db.exec('DELETE FROM orders');
    db.exec("UPDATE tables_list SET status='open'");
    db.exec('DELETE FROM shifts');
    db.exec('DELETE FROM notifications');
    db.exec('DELETE FROM held_orders');
    jsonOut({ ok: true });
  }

  // ── ORDER SEQUENCE ───────────────────────────────────────
  if (method === 'GET' && uri === '/order-sequence') {
    requireRole(['superManager', 'manager'], user);
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM order_sequences WHERE branchId=?'); st.execute([bid]);
    let seq = st.fetch();
    if (!seq) {
      db.prepare('INSERT INTO order_sequences (branchId, currentNum) VALUES (?,0)').execute([bid]);
      seq = { branchId: bid, currentNum: 0, lastResetAt: null, lastResetNum: 0 };
    }
    jsonOut(seq);
  }
  if (method === 'POST' && uri === '/order-sequence/reset') {
    requireRole(['superManager', 'manager'], user);
    if (!bid) err('Branch required');
    const st = db.prepare('SELECT currentNum FROM order_sequences WHERE branchId=?'); st.execute([bid]);
    const seq = st.fetch();
    const lastNum = seq ? int(seq.currentNum) : 0;
    db.prepare(
      `INSERT INTO order_sequences (branchId,currentNum,lastResetAt,lastResetNum) VALUES (?,0,?,?)
       ON CONFLICT(branchId) DO UPDATE SET currentNum=0, lastResetAt=excluded.lastResetAt, lastResetNum=excluded.lastResetNum`
    ).execute([bid, nowStr(), lastNum]);
    jsonOut({ ok: true, resetFrom: lastNum, at: isoNow() });
  }

  // ── ANALYTICS ────────────────────────────────────────────
  if (method === 'GET' && uri === '/analytics/items') {
    const from = query.from || dateAddDays(-30);
    const to = query.to || dateAddDays(1);
    const stationId = has(query.stationId) ? int(query.stationId) : null;
    const bFilter = user.role === 'superManager' ? (has(query.branchId) ? int(query.branchId) : null) : bid;
    const timeFrom = query.timeFrom || null;
    const timeTo = query.timeTo || null;
    let sql = "SELECT * FROM orders WHERE paymentStatus='paid' AND date(paidAt) BETWEEN ? AND ?";
    const args = [from, to];
    if (bFilter) { sql += ' AND branchId=?'; args.push(bFilter); }
    if (timeFrom) { sql += ' AND time(createdAt) >= ?'; args.push(timeFrom); }
    if (timeTo) { sql += ' AND time(createdAt) <= ?'; args.push(timeTo); }
    const st = db.prepare(sql); st.execute(args);
    const orders = st.fetchAll();
    const itemStats = {};
    for (const o of orders) {
      for (const item of jsonDecode(o.items, [])) {
        if (stationId && int(item.stationId || 0) !== stationId) continue;
        const key = item.menuItemId || 0;
        if (!itemStats[key]) itemStats[key] = { menuItemId: key, name: item.name, stationId: item.stationId || null, stationName: item.stationName || '', totalQty: 0, totalRevenue: 0, prepTimes: [] };
        itemStats[key].totalQty += int(item.qty);
        itemStats[key].totalRevenue += flt(item.lineTotal || 0);
        if (item.readyAt && o.createdAt) {
          const prepSecs = tsSeconds(item.readyAt) - tsSeconds(o.createdAt);
          if (prepSecs > 0 && prepSecs < 7200) itemStats[key].prepTimes.push(prepSecs);
        }
      }
    }
    const result = Object.values(itemStats).map((s) => {
      const avg = s.prepTimes.length ? Math.round(arrSum(s.prepTimes) / s.prepTimes.length / 60 * 10) / 10 : null;
      delete s.prepTimes;
      s.avgPrepMinutes = avg; s.totalRevenue = round2(s.totalRevenue);
      return s;
    });
    result.sort((a, b) => b.totalQty - a.totalQty);
    jsonOut({ items: result, from, to, totalOrders: orders.length });
  }

  // ── ADVANCED REPORTS ─────────────────────────────────────
  if (method === 'GET' && uri === '/reports/advanced') {
    const from = query.from || dateAddDays(-30);
    const to = query.to || dateAddDays(1);
    const bFilter = user.role === 'superManager' ? (has(query.branchId) ? int(query.branchId) : null) : bid;
    let sql = "SELECT * FROM orders WHERE date(paidAt) BETWEEN ? AND ? AND paymentStatus='paid'";
    const args = [from, to];
    if (bFilter) { sql += ' AND branchId=?'; args.push(bFilter); }
    const st = db.prepare(sql); st.execute(args);
    const orders = st.fetchAll().map((r) => orderRow(r));
    const totalRevenue = round2(arrSum(orders.map((o) => o.grandTotal)));
    const totalOrders = orders.length;
    const totalTips = round2(arrSum(arrColumn(orders, 'tipAmount')));
    const totalDiscount = round2(arrSum(orders.map((o) => (o.discount && o.discount.amount) || 0)));
    const methodKeys = ['cash', 'card', 'online', 'wallet'];
    const byMethod = {}; methodKeys.forEach((k) => byMethod[k] = 0);
    const methodStats = {};
    for (const k of methodKeys) methodStats[k] = { method: k, gross: 0, fee: 0, net: 0, count: 0 };
    for (const o of orders) for (const p of o.payments) {
      const m = p.method || '';
      if (!methodStats[m]) continue;
      const gross = flt(p.amount || 0); const fee = flt(p.feeAmount || 0);
      const net = has(p.netAmount) ? flt(p.netAmount) : gross - fee;
      byMethod[m] += gross; methodStats[m].gross += gross; methodStats[m].fee += fee; methodStats[m].net += net; methodStats[m].count++;
    }
    for (const k in methodStats) { methodStats[k].gross = round2(methodStats[k].gross); methodStats[k].fee = round2(methodStats[k].fee); methodStats[k].net = round2(methodStats[k].net); }
    for (const k in byMethod) byMethod[k] = round2(byMethod[k]);
    const totalFees = round2(arrSum(Object.values(methodStats).map((v) => v.fee)));
    const totalNet = round2(arrSum(Object.values(methodStats).map((v) => v.net)));
    let itemBreakdown = {};
    for (const o of orders) for (const item of o.items) {
      const k = item.menuItemId || 0;
      if (!itemBreakdown[k]) itemBreakdown[k] = { name: item.name, qty: 0, revenue: 0 };
      itemBreakdown[k].qty += int(item.qty); itemBreakdown[k].revenue += flt(item.lineTotal || 0);
    }
    itemBreakdown = Object.values(itemBreakdown).sort((a, b) => b.qty - a.qty);
    const grossSales = round2(arrSum(orders.map((o) => o.subtotal || 0)));
    const netSales = round2(totalNet);
    const avgOrder = totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0;
    const catMap = {}; const mIds = {};
    for (const o of orders) for (const it of o.items) if (it.menuItemId) mIds[int(it.menuItemId)] = true;
    if (Object.keys(mIds).length) {
      const idList = Object.keys(mIds);
      const cst = db.prepare(`SELECT id, category FROM menu_items WHERE id IN (${idList.map(() => '?').join(',')})`);
      cst.execute(idList.map((x) => int(x)));
      for (const r of cst.fetchAll()) catMap[int(r.id)] = r.category || 'Uncategorised';
    }
    let categoryStats = {};
    for (const o of orders) for (const it of o.items) {
      const cat = catMap[int(it.menuItemId || 0)] || 'Uncategorised';
      if (!categoryStats[cat]) categoryStats[cat] = { category: cat, qty: 0, revenue: 0 };
      categoryStats[cat].qty += int(it.qty); categoryStats[cat].revenue += flt(it.lineTotal || 0);
    }
    for (const k in categoryStats) categoryStats[k].revenue = round2(categoryStats[k].revenue);
    categoryStats = Object.values(categoryStats).sort((a, b) => b.revenue - a.revenue);
    const hourly = [];
    for (let h = 0; h < 24; h++) hourly[h] = { hour: h, orders: 0, revenue: 0 };
    for (const o of orders) {
      const d = new Date(String(o.paidAt || o.createdAt || Date.now()).replace(' ', 'T'));
      const h = d.getHours();
      hourly[h].orders++; hourly[h].revenue += o.grandTotal;
    }
    for (let h = 0; h < 24; h++) hourly[h].revenue = round2(hourly[h].revenue);
    let peakHour = null;
    for (const v of hourly) if (peakHour === null || v.orders > peakHour.orders) peakHour = v;
    const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dow = [];
    for (let d = 0; d < 7; d++) dow[d] = { day: dowNames[d], dayIndex: d, orders: 0, revenue: 0 };
    for (const o of orders) {
      const dt = new Date(String(o.paidAt || o.createdAt || Date.now()).replace(' ', 'T'));
      const d = dt.getDay();
      dow[d].orders++; dow[d].revenue += o.grandTotal;
    }
    for (let d = 0; d < 7; d++) dow[d].revenue = round2(dow[d].revenue);
    let weekdayRev = 0, weekendRev = 0;
    for (let d = 0; d < 7; d++) { if ([1, 2, 3, 4].includes(d)) weekdayRev += dow[d].revenue; else weekendRev += dow[d].revenue; }
    const soldIds = {};
    for (const o of orders) for (const it of o.items) if (it.menuItemId) soldIds[int(it.menuItemId)] = true;
    let menuSql = 'SELECT id, name, category, price FROM menu_items';
    const menuArgs = [];
    if (bFilter) { menuSql += ' WHERE branchId=?'; menuArgs.push(bFilter); }
    const allMenuSt = db.prepare(menuSql); allMenuSt.execute(menuArgs);
    const deadStock = [];
    for (const mi of allMenuSt.fetchAll()) if (!soldIds[int(mi.id)]) deadStock.push({ name: mi.name, category: mi.category || 'Uncategorised', price: flt(mi.price) });
    let modStats = {};
    for (const o of orders) for (const it of o.items) for (const m of (it.modifiers || [])) {
      const name = m.option || m.name || '';
      if (name === '') continue;
      if (!modStats[name]) modStats[name] = { name, count: 0 };
      modStats[name].count += int(it.qty);
    }
    modStats = Object.values(modStats).sort((a, b) => b.count - a.count);
    let purchaseCost = 0;
    const pcSt = db.prepare('SELECT items FROM purchases WHERE ' + (bFilter ? 'branchId=? AND ' : '') + 'date(createdAt) BETWEEN ? AND ?');
    pcSt.execute(bFilter ? [bFilter, from, to] : [from, to]);
    for (const pr of pcSt.fetchAll()) for (const it of jsonDecode(pr.items, [])) purchaseCost += flt(it.cost || 0);
    let consumedCost = 0;
    const spSt = db.prepare('SELECT consumedValue FROM stock_periods WHERE ' + (bFilter ? 'branchId=? AND ' : '') + 'startDate <= ? AND endDate >= ?');
    spSt.execute(bFilter ? [bFilter, to, from] : [to, from]);
    for (const sp of spSt.fetchAll()) consumedCost += flt(sp.consumedValue);
    let voidSql = 'SELECT * FROM orders WHERE date(createdAt) BETWEEN ? AND ? AND void_data IS NOT NULL';
    const vargs = [from, to];
    if (bFilter) { voidSql += ' AND branchId=?'; vargs.push(bFilter); }
    const vst = db.prepare(voidSql); vst.execute(vargs);
    const voided = vst.fetchAll().map((r) => orderRow(r));
    const staffTips = {};
    for (const o of orders) if ((o.tipAmount || 0) > 0) {
      const k = o.staffId || 0;
      if (!staffTips[k]) staffTips[k] = { staffName: o.staffName, totalTips: 0, orderCount: 0 };
      staffTips[k].totalTips += o.tipAmount; staffTips[k].orderCount++;
    }
    let sequences;
    if (bFilter) { const seqSt = db.prepare('SELECT * FROM order_sequences WHERE branchId=?'); seqSt.execute([bFilter]); sequences = seqSt.fetchAll(); }
    else sequences = db.query('SELECT * FROM order_sequences').fetchAll();
    jsonOut({
      period: { from, to },
      summary: {
        totalRevenue, totalOrders, totalTips, totalDiscounts: totalDiscount,
        byPaymentMethod: byMethod, totalCardFees: totalFees, netRevenue: totalNet,
        grossSales, netSales, avgOrderValue: avgOrder,
      },
      paymentMethods: Object.values(methodStats),
      itemBreakdown, categoryStats, hourly, peakHour, dayOfWeek: dow,
      weekdayVsWeekend: { weekday: round2(weekdayRev), weekend: round2(weekendRev) },
      deadStock, modifierStats: modStats,
      inventoryCost: { purchases: round2(purchaseCost), consumed: round2(consumedCost) },
      voids: voided.map((o) => ({ orderId: o.id, tableName: o.tableName, staffName: o.staffName, staffId: o.staffId, amount: o.total, reason: (o.void && o.void.reason) || '', at: (o.void && o.void.at) || '' })),
      staffTips: Object.values(staffTips),
      orders: orders.filter((o) => (o.tipAmount || 0) > 0).map((o) => ({ id: o.id, tableName: o.tableName, staffId: o.staffId, staffName: o.staffName, tipAmount: o.tipAmount, grandTotal: o.grandTotal })),
      orderSequences: sequences,
    });
  }

  // ── DASHBOARD DETAILS ────────────────────────────────────
  if (method === 'GET' && uri === '/dashboard/details') {
    let bids = [];
    if (user.role === 'superManager') for (const b of db.query('SELECT id FROM branches').fetchAll()) bids.push(int(b.id));
    else bids = [bid];
    // Branch id -> name, so every row can carry a human label for superManager.
    const bNameMap = {};
    for (const row of db.query('SELECT id,name FROM branches').fetchAll()) bNameMap[int(row.id)] = row.name;
    const weekday = (ds) => { try { return new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }); } catch (e) { return ds.slice(5); } };
    const revenueTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = dateAddDays(-i);
      let total = 0;
      for (const b of bids) {
        const st = db.prepare("SELECT COALESCE(SUM(total),0) as t FROM orders WHERE branchId=? AND paymentStatus='paid' AND date(paidAt)=?");
        st.execute([b, d]); total += flt(st.fetch().t);
      }
      revenueTrend.push({ date: d, label: weekday(d), revenue: round2(total) });
    }
    let shiftRoster = [];
    for (const b of bids) {
      const st = db.prepare('SELECT s.*, u.name as userName, u.role FROM shifts s LEFT JOIN users u ON u.id=s.userId WHERE s.branchId=? AND s.clockOut IS NULL ORDER BY s.clockIn');
      st.execute([b]); shiftRoster = shiftRoster.concat(st.fetchAll());
    }
    shiftRoster = shiftRoster.map((r) => {
      const started = Date.parse(String(r.clockIn).replace(' ', 'T'));
      const minutesOn = isNaN(started) ? 0 : Math.max(0, Math.floor((Date.now() - started) / 60000));
      return Object.assign({}, r, { id: int(r.id), userId: int(r.userId), minutesOn, branchName: bNameMap[int(r.branchId)] || '' });
    });
    const stationPerformance = [];
    const today = todayStr();
    for (const b of bids) {
      const staSt = db.prepare('SELECT * FROM stations WHERE branchId=?'); staSt.execute([b]);
      for (const s of staSt.fetchAll()) {
        let count = 0;
        const ordSt = db.prepare('SELECT items FROM orders WHERE branchId=? AND date(createdAt)=?'); ordSt.execute([b, today]);
        for (const o of ordSt.fetchAll()) for (const item of jsonDecode(o.items, [])) if (int(item.stationId || 0) === int(s.id)) count++;
        stationPerformance.push({ stationId: int(s.id), stationName: s.name, color: s.color, branchName: bNameMap[b] || '', itemsToday: count });
      }
    }
    const auditTrail = [];
    for (const b of bids) {
      const aSt = db.prepare('SELECT * FROM orders WHERE branchId=? AND (void_data IS NOT NULL OR discount IS NOT NULL) AND date(createdAt)=? ORDER BY createdAt DESC LIMIT 20');
      aSt.execute([b, today]);
      for (const o of aSt.fetchAll()) {
        const ord = orderRow(o);
        const branchName = bNameMap[b] || '';
        if (ord.void) auditTrail.push({ type: 'void', orderId: ord.id, tableName: ord.tableName, staffName: ord.staffName, branchName, detail: (ord.void && ord.void.reason) || '', at: (ord.void && ord.void.at) || ord.createdAt, amount: ord.total });
        if (ord.discount) auditTrail.push({ type: 'discount', orderId: ord.id, tableName: ord.tableName, staffName: ord.staffName, branchName, detail: `${ord.discount.type} ${ord.discount.value}` + (ord.discount.type === 'percent' ? '%' : ''), at: ord.createdAt, amount: ord.discount.amount });
      }
    }
    jsonOut({ revenueTrend, shiftRoster, stationPerformance, auditTrail });
  }

  // ── PERMISSIONS ──────────────────────────────────────────
  if (method === 'GET' && uri === '/permissions') {
    const st = db.prepare('SELECT * FROM permissions WHERE branchId=?'); st.execute([bid]);
    const row = st.fetch();
    if (!row) jsonOut({ branchId: bid, serverMaxDiscountPercent: 10.0, allowServerVoid: false, allowCashierVoid: false });
    jsonOut({
      branchId: int(row.branchId), serverMaxDiscountPercent: flt(row.serverMaxDiscountPercent),
      allowServerVoid: !!row.allowServerVoid, allowCashierVoid: !!row.allowCashierVoid,
    });
  }
  if (method === 'PUT' && uri === '/permissions') {
    requireRole(['superManager', 'manager'], user);
    if (!bid) err('Pick a branch before changing permissions', 400);
    const pct = has(body.serverMaxDiscountPercent) ? flt(body.serverMaxDiscountPercent) : null;
    if (pct !== null && (pct < 0 || pct > 100)) err('Discount limit must be between 0 and 100', 400);
    db.prepare('INSERT OR IGNORE INTO permissions (branchId) VALUES (?)').execute([bid]);
    db.prepare('UPDATE permissions SET serverMaxDiscountPercent = ?, allowServerVoid = ?, allowCashierVoid = ? WHERE branchId = ?')
      .execute([pct !== null ? pct : 10, body.allowServerVoid ? 1 : 0, body.allowCashierVoid ? 1 : 0, bid]);
    const f = db.prepare('SELECT * FROM permissions WHERE branchId=?'); f.execute([bid]);
    const row = f.fetch();
    jsonOut({
      branchId: int(row.branchId), serverMaxDiscountPercent: flt(row.serverMaxDiscountPercent),
      allowServerVoid: !!row.allowServerVoid, allowCashierVoid: !!row.allowCashierVoid,
    });
  }

  // ── CATCH-ALL ────────────────────────────────────────────
  err(`Route not found: ${method} ${uri}`, 404);
}

module.exports = { handle, auditLog };
