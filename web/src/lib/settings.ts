"use client";

import { useEffect, useState } from "react";
import { apiGet } from "./api";

export interface HomeBanner {
  title: string;
  body: string;
  color?: string;         // optional accent colour (CSS value) — overrides default
  imageUrl?: string;      // optional image for the banner
  ctaLabel?: string;      // optional button label (e.g. "Add to order")
  ctaHref?: string;       // optional link target when button is clicked
}

export interface PublicSettings {
  businessName: string;
  businessTagline: string;
  businessAddress: string;
  businessPhone: string;
  logoUrl: string;
  currencySymbol: string;
  serviceChargeRate: number;
  vatRate: number;
  cardFeePercent: number;
  enabledAddons: string[];
  defaultOrderType: string;
  homeBanners?: HomeBanner[];
}

let cache: PublicSettings | null = null;

export async function fetchSettings(): Promise<PublicSettings> {
  if (cache) return cache;
  const s = await apiGet<PublicSettings>("/public/settings");
  cache = s;
  return s;
}

export function useSettings() {
  const [settings, setSettings] = useState<PublicSettings | null>(cache);
  useEffect(() => {
    let alive = true;
    fetchSettings().then((s) => alive && setSettings(s)).catch(() => {});
    return () => { alive = false; };
  }, []);
  return settings;
}

export function money(amount: number, currency = "Rs. "): string {
  const n = Number(amount) || 0;
  const body = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${currency}${body}`;
}
