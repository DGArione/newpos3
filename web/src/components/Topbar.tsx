"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Bell, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  superManager: "Super Manager",
  manager: "Manager",
  finance: "Finance",
  server: "Server",
  cashier: "Cashier",
  kitchen: "Kitchen",
};

export function AppHeader({ onSearch }: { onSearch?: () => void }) {
  const { user } = useAuth();
  const settings = useSettings();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const t = (document.documentElement.getAttribute("data-theme") as "light" | "dark") || "light";
    setTheme(t);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("gb-theme", next); } catch {}
  }

  if (!user) return null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = user.name.split(" ")[0];

  return (
    <header className="flex shrink-0 items-center gap-3">
      {/* greeting */}
      <div className="min-w-0">
        <h1 className="truncate text-[19px] font-semibold leading-tight text-ink">
          Hello, {firstName}!
        </h1>
        <p className="text-[11.5px] text-muted">
          {settings?.businessName || "Golden Beach"} &middot; {ROLE_LABEL[user.role] || user.role}
        </p>
      </div>

      {/* search bar */}
      <button
        onClick={onSearch}
        className="ml-auto flex h-10 w-full max-w-sm items-center gap-2.5 rounded-xl px-4 text-[13px] text-muted transition-shadow hover:ring-1 hover:ring-line"
        style={{ background: "var(--panel)" }}
      >
        <Search size={16} style={{ color: "var(--olive)" }} />
        <span className="flex-1 text-left">Search…</span>
        <kbd
          className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
          style={{ background: "var(--panel-2)", color: "var(--muted)" }}
        >
          Ctrl K
        </kbd>
      </button>

      {/* right pill */}
      <div
        className="flex h-12 shrink-0 items-center gap-1.5 rounded-2xl px-2.5"
        style={{ background: "var(--panel)" }}
      >
        {/* theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle light/dark"
          className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink transition-colors"
        >
          {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
        </button>

        {/* notification bell (visual only) */}
        <button
          aria-label="Notifications"
          className="relative flex size-9 items-center justify-center rounded-lg text-white transition-colors hover:opacity-90"
          style={{ background: "var(--olive)" }}
        >
          <Bell size={16} />
        </button>

        {/* avatar + name */}
        <div className="ml-1 hidden items-center gap-2 sm:flex">
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
            style={{ background: "var(--kot)" }}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="hidden pr-1 lg:block">
            <p className="text-[12.5px] font-semibold leading-tight text-ink">{user.name}</p>
            <p className="text-[11px] text-muted">{ROLE_LABEL[user.role] || user.role}</p>
          </div>
        </div>
      </div>
    </header>
  );
}

// Keep legacy export name for any file that imports Topbar
export { AppHeader as Topbar };
