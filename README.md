# Golden Beach Restaurant — POS

Full-feature restaurant POS with the **Golden POS UI** — orange brand,
floating sidebar, Poppins font — on top of a Node.js + SQLite backend
that already includes everything a restaurant needs:

- **Billing / Order Entry**, **Floor / Tables**, **Kitchen (KOT)**, **Payment**
- **Dashboard**, **Reports**, **Z-Report**, **History**, **Audit Log**
- **Menu Admin**, **Inventory** (ingredients, stock periods, suppliers, purchases, movements)
- **Branches** (multi-branch), **Online Orders**, **Reservations**
- **Users / Staff**, **Time Clock**, **Payroll**, **Petty Cash**
- **Customers (CRM)**, **Loyalty**, **Gift Cards**, **Promotions**, **Messages**
- **Receipts, KOT, printing agent** support

Two UIs ship in the box — pick whichever you want.

| UI | What it is | How it looks |
|---|---|---|
| **Golden POS (recommended)** | Next.js 14 app in `web/` with orange brand + floating sidebar | Clean, modern |
| **Classic HTML** | Plain pages served from `backend/public/` | Same features, flatter layout |

---

## ▶️ Run it

### Requirements
- **Node.js ≥ 22.5** (uses the built-in `node:sqlite` module — no DB to install)
- **~2 GB free disk space on C:** (npm install is big)

### One command — Golden POS UI + backend together

```powershell
npm install
npm start
```

Then open **http://localhost:3000**.

That one command runs the backend API on `:3001` and the Golden POS UI on
`:3000`. First page load takes ~15 seconds while Next.js compiles — after
that every click is instant.

### Classic HTML UI

If you want the old plain-HTML pages instead (served directly by the
backend, no build step):

```powershell
npm run start:classic
```

### Development

```powershell
npm run dev:backend      # terminal 1 — API on :3001
npm run dev:web          # terminal 2 — Next.js UI on :3000 with hot reload
```

---

## Demo logins (PIN)

| Role          | PIN  |
|---------------|------|
| Admin         | 9999 |
| Super Manager | 1234 |
| Manager       | 1111 |
| Server        | 2222 |
| Cashier       | 3333 |
| Kitchen       | 4444 |

Change these under **Users** before real use.

---

## Where data is kept

Everything lives in `backend/data/pos.db` (SQLite). Back up that one file
to back up your whole restaurant. Delete it and restart to re-seed with
the demo menu + accounts.

---

## Troubleshooting

### `ENOSPC: no space left on device`
Your C: drive is full. Free up at least 2 GB and run `npm install` again.
Or move the npm cache to another drive: `npm config set cache "D:\npm-cache"`.

### `@next/swc-win32-x64-msvc, but an error occurred`
Corrupt install from a disk-full `npm install`. Delete `node_modules` and
`package-lock.json` in `web/` and reinstall:

```cmd
rmdir /s /q web\node_modules
del web\package-lock.json
npm install
```

### `Could not find a production build in the '.next' directory`
You ran `next start` instead of `next dev`. Use `npm start` (which runs
dev mode) or `npm run build:web` first.

### UI still shows the old kraft-paper look
That's the classic HTML UI, not the Golden POS one. Make sure you're running
`npm start` (not `npm run start:classic`) and visiting `http://localhost:3000`,
not `http://localhost:3001`.
