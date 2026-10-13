import {
  LayoutDashboard, Store, ClipboardList, Grid3x3, ChefHat, Globe,
  CreditCard, UtensilsCrossed, Boxes, History, BarChart3, Clock,
  Wallet, Users, FileText, Coins, MessageSquare, Contact, ScrollText,
  Star, Gift, Tag, CalendarCheck, Settings, type LucideIcon,
} from "lucide-react";
import type { Role } from "./api";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  addon?: string; // only shown when this add-on is enabled
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard",    label: "Dashboard",    href: "/dashboard",     icon: LayoutDashboard },
  { key: "branches",     label: "Branches",     href: "/branches",      icon: Store },
  { key: "order",        label: "Order Entry",  href: "/order",         icon: ClipboardList },
  { key: "floor",        label: "Floor",        href: "/floor",         icon: Grid3x3 },
  { key: "kitchen",      label: "Kitchen",      href: "/kitchen",       icon: ChefHat },
  { key: "onlineorders", label: "Online Orders",href: "/online-orders", icon: Globe },
  { key: "payment",      label: "Payment",      href: "/payment",       icon: CreditCard },
  { key: "menuadmin",    label: "Menu",         href: "/menu-admin",    icon: UtensilsCrossed },
  { key: "inventory",    label: "Inventory",    href: "/inventory",     icon: Boxes },
  { key: "history",      label: "History",      href: "/history",       icon: History },
  { key: "reports",      label: "Reports",      href: "/reports",       icon: BarChart3 },
  { key: "timeclock",    label: "Time Clock",   href: "/timeclock",     icon: Clock },
  { key: "payroll",      label: "Payroll",      href: "/payroll",       icon: Wallet },
  { key: "staff",        label: "Users",        href: "/staff",         icon: Users },
  { key: "zreport",      label: "Z-Report",     href: "/zreport",       icon: FileText },
  { key: "pettycash",    label: "Petty Cash",   href: "/pettycash",     icon: Coins },
  { key: "messages",     label: "Messages",     href: "/messages",      icon: MessageSquare },
  { key: "customers",    label: "Customers",    href: "/customers",     icon: Contact },
  { key: "auditlog",     label: "Audit Log",    href: "/audit",         icon: ScrollText },
  { key: "loyalty",      label: "Loyalty",      href: "/loyalty",       icon: Star,         addon: "loyalty" },
  { key: "giftcards",    label: "Gift Cards",   href: "/giftcards",     icon: Gift,         addon: "giftcards" },
  { key: "promotions",   label: "Promotions",   href: "/promotions",    icon: Tag,          addon: "promotions" },
  { key: "reservations", label: "Reservations", href: "/reservations",  icon: CalendarCheck, addon: "reservations" },
  { key: "settings",     label: "Settings",     href: "/settings",      icon: Settings },
];

export const ROLE_VISIBILITY: Record<Role, string[]> = {
  admin: ["settings", "auditlog"],
  superManager: ["dashboard","branches","order","floor","kitchen","onlineorders","payment","menuadmin","inventory","history","reports","timeclock","payroll","staff","zreport","pettycash","messages","customers","auditlog","loyalty","giftcards","promotions","reservations"],
  manager: ["dashboard","order","floor","kitchen","onlineorders","payment","menuadmin","inventory","history","reports","timeclock","payroll","staff","zreport","pettycash","messages","customers","auditlog","loyalty","giftcards","promotions","reservations"],
  finance: ["dashboard","history","reports","inventory","timeclock","payroll","zreport","pettycash","messages","customers"],
  server: ["order","floor","kitchen","payment","history","timeclock","messages","customers","loyalty","giftcards","reservations"],
  cashier: ["payment","history","timeclock","messages","customers","loyalty","giftcards"],
  kitchen: ["kitchen","onlineorders","timeclock","messages"],
};

export function visibleNav(role: Role, enabledAddons: string[] = []): NavItem[] {
  const allowed = new Set(ROLE_VISIBILITY[role] || []);
  return NAV_ITEMS.filter((i) => {
    if (!allowed.has(i.key)) return false;
    if (i.addon && !enabledAddons.includes(i.addon)) return false;
    return true;
  });
}
