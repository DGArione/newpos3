export interface ModifierOption { option: string; priceDelta: number; }
export interface ModifierGroup { id: number; name: string; options: ModifierOption[]; }

export interface MenuItem {
  id: number;
  name: string;
  price: number;
  category: string;
  plu?: string;
  imageUrl?: string;
  stationId: number | null;
  soldOut?: boolean;
  tags?: string;
  modifiers?: ModifierGroup[];
}

export interface Category { id: number; name: string; sortOrder?: number; }
export interface Station { id: number; name: string; color?: string; }

export interface TableRow {
  id: number;
  name: string;
  seats: number;
  status: string; // open | ordered | reserved | ...
  qrToken?: string;
}

export interface CartModifier { group: string; option: string; priceDelta: number; }
export interface CartLine {
  menuItemId: number;
  name: string;
  basePrice: number;
  qty: number;
  modifiers: CartModifier[];
  notes: string;
  stationId: number | null;
  lineTotal: number;
}

export interface OrderItem {
  menuItemId: number;
  name: string;
  basePrice: number;
  qty: number;
  modifiers: CartModifier[];
  notes: string;
  stationId: number | null;
  stationName?: string;
  lineTotal: number;
  status: string; // pending | ready | served
}

export interface Order {
  id: number;
  displayNum: string;
  orderType: string;
  tableId: number | null;
  tableName: string;
  staffName?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  note?: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  serviceCharge: number;
  vat: number;
  total: number;
  grandTotal?: number;
  amountPaid?: number;
  status: string;        // pending | preparing | ready | served | completed | voided
  paymentStatus: string; // unpaid | partial | paid
  priority: string;      // normal | high
  kitchenTag?: string;
  createdAt?: string;
  readyAt?: string;
  source?: string;
}
