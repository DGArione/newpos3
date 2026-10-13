(async () => {
// online-orders.js — staff view of orders placed on the public website.
//
// Flow: a customer's order arrives as status "new" and sits here awaiting
// approval. Nothing reaches the kitchen or the payment screen until a server
// or manager accepts it. Once accepted it becomes a normal ticket.
const staff = requireLogin();
if (staff) renderNav("onlineorders", staff);

const STEPS      = ["pending", "preparing", "ready", "dispatched"];
const STEP_LABEL = { pending: "In Kitchen", preparing: "Preparing", ready: "Ready", dispatched: "Dispatched" };
const ordersEl   = document.getElementById("orders");

let _hash = "";

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}

async function load() {
  const res = await api("/api/orders?status=new,pending,preparing,ready,dispatched");
  if (!res.ok) return;
  const all = await res.json();

  // Website orders only. They're created with no staffId (nobody was logged
  // in), which separates them from in-house takeaway rung up by a server.
  const online = all.filter(o =>
    !o.staffId || o.staffName === "Online Order" || o.status === "new"
  ).filter(o =>
    o.orderType && o.orderType !== "dine-in" &&
    o.paymentStatus !== "paid" &&
    o.status !== "voided"
  );

  // Newest first, and anything awaiting approval floats to the top
  online.sort((a, b) => {
    if ((a.status === "new") !== (b.status === "new")) return a.status === "new" ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const h = JSON.stringify(online.map(o => o.id + o.status + o.paymentStatus));
  if (h === _hash) return;   // avoid flicker on the 5s poll
  _hash = h;
  render(online);
}

function render(orders) {
  const waiting = orders.filter(o => o.status === "new").length;

  if (!orders.length) {
    ordersEl.innerHTML = `<div class="empty-state">No active online orders right now.</div>`;
    return;
  }

  ordersEl.innerHTML = "";

  // Banner when something needs a decision
  if (waiting) {
    const b = document.createElement("div");
    b.style = "grid-column:1/-1; background:var(--warning-bg); color:var(--warning); border-radius:10px; padding:11px 15px; font-size:13px; font-weight:600; margin-bottom:4px;";
    b.textContent = `🔔 ${waiting} new order${waiting > 1 ? "s" : ""} awaiting your approval`;
    ordersEl.appendChild(b);
  }

  orders.forEach((o) => {
    const isNew    = o.status === "new";
    const stepIdx  = STEPS.indexOf(o.status);
    const nextStep = STEPS[stepIdx + 1];
    const placed   = new Date(o.createdAt);
    const mins     = Math.floor((Date.now() - placed.getTime()) / 60000);

    const card = document.createElement("div");
    card.className = "card";
    card.style = `padding:16px;${isNew ? "border:1.5px solid var(--warning);" : ""}`;
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:8px;">
        <div>
          <strong>${esc(o.displayNum || "#" + o.id)}</strong>
          <div style="font-size:11px; color:var(--muted);">${mins < 1 ? "just now" : mins + "m ago"}</div>
        </div>
        <span style="text-align:right;">
          ${isNew ? `<span class="badge" style="background:var(--warning-bg); color:var(--warning);">NEW</span>` : ""}
          <span class="badge badge-${o.status === "dispatched" ? "dirty" : o.status}">${esc(o.orderType)}</span>
        </span>
      </div>

      <div style="font-size:13px; color:var(--muted); margin-bottom:8px;">
        ${esc(o.customerName || "no name")}${o.customerPhone ? " · " + esc(o.customerPhone) : ""}
        ${o.orderType === "delivery" && o.customerAddress ? `<br>📍 ${esc(o.customerAddress)}` : ""}
      </div>

      <div style="font-size:13px; margin-bottom:8px;">
        ${o.items.map(i => `
          <div style="display:flex; justify-content:space-between; gap:8px; padding:2px 0;">
            <span>${i.qty}× ${esc(i.name)}${(i.modifiers && i.modifiers.length) ? `<span style="color:var(--muted); font-size:11px;"> (${i.modifiers.map(m => esc(m.option || m.name)).join(", ")})</span>` : ""}</span>
            <span class="mono">${posCurrency()}${Number(i.lineTotal || 0).toFixed(2)}</span>
          </div>`).join("")}
      </div>

      ${o.note ? `<div style="font-size:12px; color:var(--warning); margin-bottom:8px;">📝 ${esc(o.note)}</div>` : ""}

      <div class="mono" style="font-weight:700; margin-bottom:12px; font-size:15px;">
        ${posCurrency()}${Number(o.grandTotal || o.total).toFixed(2)}
      </div>

      ${isNew ? `
        <div style="display:flex; gap:8px;">
          <button class="btn btn-danger" data-reject="${o.id}" style="flex:1;">Reject</button>
          <button class="btn btn-primary" data-accept="${o.id}" style="flex:2;">✓ Accept &amp; Send to Kitchen</button>
        </div>
      ` : `
        <div style="display:flex; gap:4px; margin-bottom:10px;">
          ${STEPS.map((s, i) => `<div style="flex:1; height:5px; border-radius:3px; background:${i <= stepIdx ? "var(--accent)" : "var(--neutral-bg)"};"></div>`).join("")}
        </div>
        <div style="font-size:12px; color:var(--muted); margin-bottom:10px;">Status: ${STEP_LABEL[o.status] || o.status}</div>
        ${nextStep
          ? `<button class="btn btn-primary" style="width:100%;" data-next="${nextStep}" data-id="${o.id}">Mark "${STEP_LABEL[nextStep]}"</button>`
          : `<div style="text-align:center; font-size:12px; color:var(--success);">Awaiting payment on the Payment screen</div>`}
      `}
    `;

    const acceptBtn = card.querySelector("[data-accept]");
    if (acceptBtn) {
      acceptBtn.onclick = async () => {
        acceptBtn.disabled = true;
        acceptBtn.textContent = "Sending…";
        const res = await api(`/api/orders/${o.id}/accept`, { method: "POST" });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          showToast(e.error || "Could not accept order");
          acceptBtn.disabled = false;
          acceptBtn.textContent = "✓ Accept & Send to Kitchen";
          return;
        }
        showToast("Sent to kitchen — now on the Payment screen too");
        _hash = "";
        load();
      };
    }

    const rejectBtn = card.querySelector("[data-reject]");
    if (rejectBtn) {
      rejectBtn.onclick = async () => {
        const reason = prompt("Reason for rejecting this order:", "");
        if (reason === null) return;
        const res = await api(`/api/orders/${o.id}/reject`, {
          method: "POST", json: { reason: reason.trim() || "Rejected by staff" },
        });
        if (!res.ok) { showToast("Could not reject order"); return; }
        showToast("Order rejected");
        _hash = "";
        load();
      };
    }

    const nextBtn = card.querySelector("[data-next]");
    if (nextBtn) {
      nextBtn.onclick = async () => {
        await api(`/api/orders/${nextBtn.dataset.id}/status`, {
          method: "PATCH", json: { status: nextBtn.dataset.next },
        });
        _hash = "";
        load();
      };
    }

    ordersEl.appendChild(card);
  });
}

if (staff) {
  load();
  setInterval(load, 5000);
}

})();
