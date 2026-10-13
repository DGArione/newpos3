# Golden Beach Restaurant — POS

Point-of-sale system for **Golden Beach Restaurant, Midigama**, with a custom
"vintage coastal" brand (olive green + kraft paper, terracotta accents).

This repo has **two versions of the same app** — use whichever suits you:

| Folder     | What it is                                   | How to run                       |
|------------|----------------------------------------------|----------------------------------|
| `backend/` | **Plain Node.js app** (Express + SQLite). No build step — the UI is served directly. | `npm install && npm start` |
| `web/`     | Next.js front-end (same features, needs a build). Optional. | `npm --prefix web install && npm run build:web` |

## ▶️ Run it (plain Node.js — recommended)

No build tools, no Next.js — just Node.

```bash
npm install     # installs the backend
npm start       # starts the app
```

Then open **http://localhost:3000**.

> Requires **Node.js ≥ 22.5** (the app uses the built-in `node:sqlite` module,
> so there is no separate database to install). On first run it creates
> `backend/data/pos.db` and seeds the Golden Beach menu + demo accounts.
> Use a different port with `PORT=8080 npm start`.

You can also run it straight from the backend folder:

```bash
cd backend
npm install
npm start
```

### Demo logins (PIN)

| Role          | PIN  |
|---------------|------|
| Admin         | 9999 |
| Super Manager | 1234 |
| Manager       | 1111 |
| Server        | 2222 |
| Cashier       | 3333 |
| Kitchen       | 4444 |

Change these under **Users** before real use.

## The menu

The demo menu is replaced with the **real Golden Beach menu** from the printed
price lists — 142 dishes across 22 categories (Rice & Curry, Fried Rice, Kottu,
Pizza, Roti, Juice, Lassi, Milkshake, Breakfast, …) with the correct `Rs.`
prices, including the full pizza range (Margherita Rs.1700 → Mix Seafood
Rs.2800). It's editable in-app under **Menu Admin**. Service charge and VAT are
set to 0 so totals match the printed prices.

## The redesign

The whole interface wears a **Golden Beach** vintage brand — applied through the
app's theme system, so every screen is restyled with no build step:

- **Theme** — a new `goldenBeach` (light) / `goldenBeachNight` (dark) palette in
  `backend/public/theme.js`: olive green, kraft paper, terracotta accents.
- **Fonts** — Fraunces (headings) + Hanken Grotesk (UI), loaded in
  `backend/public/style.css`.
- Switch light/dark from the top bar; pick other palettes under **Settings**.

## The Next.js version (`web/`)

An alternative front-end built in Next.js with the same brand. It talks to the
same backend API. Run the backend on `:3001` and the web app on `:3000`:

```bash
npm run dev:backend     # terminal 1 — API on :3001
npm run dev:web         # terminal 2 — Next.js UI on :3000
```

Most people should just use the plain Node.js app above.
