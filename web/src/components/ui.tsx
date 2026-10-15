"use client";

import { useEffect, useState, createContext, useContext, useCallback } from "react";
import { Loader2, X, CheckCircle2, AlertTriangle, Info, type LucideIcon } from "lucide-react";

/* ---------------- Spinner / loader ---------------- */

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />;
}

export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted">
      <Spinner size={26} />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

/* ---------------- Empty state ---------------- */

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      {icon && <div className="mb-2" style={{ color: "var(--olive)" }}>{icon}</div>}
      <div className="text-[17px] font-semibold text-ink">{title}</div>
      {hint && <div className="text-sm text-muted max-w-sm">{hint}</div>}
    </div>
  );
}

/* ---------------- PageHeader (Golden POS style — toolbar inside card) ----------------
 * Used by every page. Lives inside the main card so there's no second layer of chrome.
 */

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] flex-wrap items-center gap-x-4 gap-y-2 mb-5 pb-4 border-b border-line-soft">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "var(--olive-wash)", color: "var(--olive)" }}
          >
            <Icon size={18} strokeWidth={2.2} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-semibold leading-tight text-ink">{title}</h1>
          {subtitle && <p className="text-[12.5px] text-muted truncate">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/* ---------------- Toasts ---------------- */

type Toast = { id: number; kind: "ok" | "bad" | "info"; msg: string };
const ToastCtx = createContext<{ push: (kind: Toast["kind"], msg: string) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 max-w-[92vw]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="gb-card flex items-start gap-2.5 px-4 py-3 min-w-[260px] gb-enter"
            style={{
              borderLeftWidth: 4,
              borderLeftStyle: "solid",
              borderLeftColor: t.kind === "ok" ? "var(--ok)" : t.kind === "bad" ? "var(--bad)" : "var(--olive)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            {t.kind === "ok" ? (
              <CheckCircle2 size={18} style={{ color: "var(--ok)" }} className="mt-0.5" />
            ) : t.kind === "bad" ? (
              <AlertTriangle size={18} style={{ color: "var(--bad)" }} className="mt-0.5" />
            ) : (
              <Info size={18} style={{ color: "var(--olive)" }} className="mt-0.5" />
            )}
            <span className="text-sm text-ink">{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  return v || { push: () => {} };
}

/* ---------------- Modal ---------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,.45)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="gb-card w-full gb-enter"
        style={{ maxWidth: width, boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink transition-colors"
            >
              <X size={17} />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Section card ----------------
 * A rounded white panel that wraps most page content.
 * Pages are wrapped in <Screen> for the golden POS look.
 */

export function Screen({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[var(--r-2xl)] px-5 py-5 md:px-6 md:py-6 ${className}`}
      style={{ background: "var(--panel)", boxShadow: "var(--shadow-sm)" }}
    >
      {children}
    </section>
  );
}

/* ---------------- Stat tile (used on dashboard / home) ---------------- */

export function Stat({
  label,
  value,
  icon,
  accent,
  warn,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: accent ? "var(--olive-wash)" : warn ? "var(--warn-wash)" : "var(--panel)",
        border: "1px solid var(--line)",
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        {icon && (
          <span style={{ color: accent ? "var(--olive)" : warn ? "var(--warn)" : "var(--muted)" }}>
            {icon}
          </span>
        )}
      </div>
      <div className="mono text-[22px] font-semibold text-ink leading-none">{value}</div>
    </div>
  );
}
