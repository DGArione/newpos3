"use client";

import { useEffect, useState } from "react";
import { apiGet } from "./api";

export interface HomeBanner {
  title: string;
  body: string;
  color?: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface PublicSettings {
  businessName: string;
  businessTagline: string;
  businessAddress: string;
  businessPhone: string;
  logoUrl: string;
  loginBgUrl?: string;
  accentColor?: string;
  currencySymbol: string;
  serviceChargeRate: number;
  vatRate: number;
  cardFeePercent: number;
  enabledAddons: string[];
  defaultOrderType: string;
  homeBanners?: HomeBanner[];
}

/** Apply the brand accent colour from settings to the live CSS variables. */
export function applyAccent(color?: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    root.style.setProperty("--olive", color);
    root.style.setProperty("--brand", color);
    root.style.setProperty("--olive-700", mix(color, "#000000", 0.35));
    root.style.setProperty("--olive-300", mix(color, "#ffffff", 0.45));
    root.style.setProperty("--olive-wash", mix(color, "#ffffff", 0.88));
    root.style.setProperty("--clay", color);
    root.style.setProperty("--brand-soft", mix(color, "#ffffff", 0.88));
  } else {
    // reset to default orange
    ["--olive", "--brand", "--olive-700", "--olive-300", "--olive-wash", "--clay", "--brand-soft"].forEach((v) => root.style.removeProperty(v));
  }
}

function mix(a: string, b: string, t: number) {
  const pa = hex(a), pb = hex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `#${[r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
function hex(c: string): [number, number, number] {
  let s = c.replace("#", "");
  if (s.length === 3) s = s.split("").map((x) => x + x).join("");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

let cache: PublicSettings | null = null;
const listeners = new Set<(s: PublicSettings) => void>();

export async function fetchSettings(force = false): Promise<PublicSettings> {
  if (cache && !force) return cache;
  const s = await apiGet<PublicSettings>("/public/settings");
  cache = s;
  applyAccent(s.accentColor);
  listeners.forEach((fn) => { try { fn(s); } catch {} });
  return s;
}

export function clearSettingsCache() { cache = null; }

export function useSettings() {
  const [settings, setSettings] = useState<PublicSettings | null>(cache);
  useEffect(() => {
    let alive = true;
    fetchSettings().then((s) => alive && setSettings(s)).catch(() => {});
    const fn = (s: PublicSettings) => { if (alive) setSettings(s); };
    listeners.add(fn);
    return () => { alive = false; listeners.delete(fn); };
  }, []);
  return settings;
}

export function money(amount: number, currency = "Rs. "): string {
  const n = Number(amount) || 0;
  const body = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${currency}${body}`;
}
