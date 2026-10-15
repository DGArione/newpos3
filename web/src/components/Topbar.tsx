"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sun, Moon, Bell, Search, LogOut, UserCog, Settings as SettingsIcon,
  ChevronDown, Clock, Shield,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { apiGet, apiPost } from "@/lib/api";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  superManager: "Super Manager",
  manager: "Manager",
  finance: "Finance",
  server: "Server",
  cashier: "Cashier",
  kitchen: "Kitchen",
};

interface Shift { id: number; clockIn: string }
interface Notification { id: number; type: string; message: string; read: boolean; createdAt: string }

export function AppHeader({ onSearch }: { onSearch?: () => void }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const settings = useSettings();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [clock, setClock] = useState<Date>(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [openShift, setOpenShift] = useState<Shift | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = (document.documentElement.getAttribute("data-theme") as "light" | "dark") || "light";
    setTheme(t);
  }, []);

  // Live clock + close dropdowns on outside click
  useEffect(() => {
    const i = setInterval(() => setClock(new Date()), 10_000);
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => { clearInterval(i); document.removeEventListener("mousedown", h); };
  }, []);

  // Fetch open shift + notifications
  useEffect(() => {
    if (!user) return;
    const refresh = async () => {
      try {
        const s = await apiGet<Shift | null>(`/shifts/open/${user.id}`);
        setOpenShift(s && s.id ? s : null);
      } catch { /* ignore */ }
      try {
        const n = await apiGet<Notification[]>("/notifications");
        setNotifs(Array.isArray(n) ? n.slice(0, 15) : []);
        const unreadCount = await apiGet<{ count: number }>("/notifications/unread-count");
        setUnread(unreadCount.count || 0);
      } catch { /* ignore */ }
    };
    refresh();
    const i = setInterval(refresh, 20_000);
    return () => clearInterval(i);
  }, [user]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("gb-theme", next); } catch {}
  }

  async function doLogout() {
    setMenuOpen(false);
    logout();
    router.replace("/login");
  }

  async function markAllRead() {
    try { await apiPost("/notifications/read-all"); setUnread(0); setNotifs((p) => p.map((n) => ({ ...n, read: true }))); }
    catch { /* ignore */ }
  }

  if (!user) return null;

  const hour = clock.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = user.name.split(" ")[0];
  const timeStr = clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  // Clocked-in duration (short)
  let shiftLabel = "Clock in";
  let shiftHref = "/timeclock";
  if (openShift) {
    const mins = Math.floor((clock.getTime() - new Date(openShift.clockIn).getTime()) / 60000);
    const h = Math.floor(mins / 60), m = mins % 60;
    shiftLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <header className="flex shrink-0 items-center gap-3">
      {/* greeting */}
      <div className="min-w-0">
        <h1 className="truncate text-[19px] font-semibold leading-tight text-ink">
          {greeting}, {firstName}!
        </h1>
        <p className="text-[11.5px] text-muted">
          {settings?.businessName || "Golden Beach"} · {ROLE_LABEL[user.role] || user.role}
        </p>
      </div>

      {/* search bar */}
      <button
        onClick={onSearch}
        className="ml-auto hidden md:flex h-10 w-full max-w-sm items-center gap-2.5 rounded-xl px-4 text-[13px] text-muted transition-shadow hover:ring-1 hover:ring-line"
        style={{ background: "var(--panel)" }}
      >
        <Search size={16} style={{ color: "var(--olive)" }} />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
          style={{ background: "var(--panel-2)", color: "var(--muted)" }}>Ctrl K</kbd>
      </button>

      {/* right pill */}
      <div className="flex h-12 shrink-0 items-center gap-1 rounded-2xl px-2"
        style={{ background: "var(--panel)" }}>

        {/* clock */}
        <div className="hidden lg:flex flex-col items-end px-2 leading-none">
          <span className="mono text-[13px] font-semibold text-ink">{timeStr}</span>
          <span className="text-[10px] text-muted">{clock.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</span>
        </div>

        {/* clocked-in chip */}
        <Link href={shiftHref} title={openShift ? `Clocked in — ${shiftLabel}` : "Not clocked in — go to Time Clock"}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
          style={{
            background: openShift ? "var(--ok-wash)" : "var(--panel-2)",
            color: openShift ? "var(--ok)" : "var(--muted)",
          }}>
          <Clock size={13} /> <span className="mono">{shiftLabel}</span>
        </Link>

        {/* theme toggle */}
        <button onClick={toggleTheme} aria-label="Toggle light/dark"
          className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink transition-colors">
          {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
        </button>

        {/* notifications */}
        <div className="relative" ref={notifRef}>
          <button onClick={() => setNotifOpen((o) => !o)} aria-label="Notifications"
            className="relative flex size-9 items-center justify-center rounded-lg text-white transition-colors hover:opacity-90"
            style={{ background: "var(--olive)" }}>
            <Bell size={16} />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: "var(--bad)", minWidth: 15, height: 15, padding: "0 3px" }}>
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-11 w-80 rounded-xl overflow-hidden z-50 gb-enter"
              style={{ background: "var(--panel)", boxShadow: "var(--shadow-lg)", border: "1px solid var(--line)" }}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-line-soft">
                <span className="text-[13px] font-semibold text-ink">Notifications</span>
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-[11.5px] text-muted hover:text-ink">
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {!notifs.length ? (
                  <div className="py-8 text-center text-sm text-muted">All quiet.</div>
                ) : (
                  notifs.map((n) => (
                    <div key={n.id} className="px-4 py-2.5 border-b border-line-soft last:border-0"
                      style={{ background: n.read ? "transparent" : "var(--olive-wash)" }}>
                      <div className="text-[12.5px] text-ink">{n.message}</div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {(n.createdAt || "").replace("T", " ").slice(0, 16)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* avatar menu */}
        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 py-1 px-1 rounded-lg transition-colors hover:bg-panel-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
              style={{ background: "var(--kot)" }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="hidden xl:block text-left leading-tight pr-1">
              <div className="text-[12.5px] font-semibold text-ink truncate max-w-[120px]">{user.name}</div>
              <div className="text-[10.5px] text-muted">{ROLE_LABEL[user.role] || user.role}</div>
            </div>
            <ChevronDown size={13} className="text-muted hidden xl:block" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-11 w-56 rounded-xl overflow-hidden z-50 gb-enter"
              style={{ background: "var(--panel)", boxShadow: "var(--shadow-lg)", border: "1px solid var(--line)" }}>
              <div className="px-4 py-3 border-b border-line-soft">
                <div className="font-semibold text-ink text-[13.5px]">{user.name}</div>
                <div className="text-[11.5px] text-muted">{ROLE_LABEL[user.role] || user.role}</div>
              </div>
              <Link href="/profile" onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-ink hover:bg-panel-2 transition-colors">
                <UserCog size={15} style={{ color: "var(--muted)" }} /> My profile
              </Link>
              {user.role === "admin" && (
                <>
                  <Link href="/admin" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-ink hover:bg-panel-2 transition-colors">
                    <Shield size={15} style={{ color: "var(--muted)" }} /> Admin
                  </Link>
                  <Link href="/settings" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-ink hover:bg-panel-2 transition-colors">
                    <SettingsIcon size={15} style={{ color: "var(--muted)" }} /> Settings
                  </Link>
                </>
              )}
              <button onClick={doLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] border-t border-line-soft transition-colors hover:bg-bad-wash"
                style={{ color: "var(--bad)" }}>
                <LogOut size={15} /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// Keep legacy export
export { AppHeader as Topbar };
