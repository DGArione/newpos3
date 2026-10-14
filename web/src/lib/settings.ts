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
  currencySymbol: string;
  serviceChargeRate: number;
  vatRate: number;
  cardFeePercent: number;
  enabledAddons: string[];
  defaultOrderType: string;
  homeBanners?: HomeBanner[];
}

let cache: PublicSettings | null = null;
const listeners = new Set<(s: PublicSettings) => void>();

export async function fetchSettings(force = false): Promise<PublicSettings> {
  if (cache && !force) return cache;
  const s = await apiGet<PublicSettings>("/public/settings");
  cache = s;
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
