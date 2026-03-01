// src/data/models.ts
export type Id = string;

export type Product = {
  id: Id;
  name: string;
  category: string | null;
  active: boolean;
  createdAt: number;
  makeEnabled?: boolean;

  // DB에도 있고 앱에서도 쓰는 필드
  price?: number | null;
  sku?: string | null;
  barcode?: string | null;
};

export type Store = {
  id: Id
  name: string
  createdAt: number

  commissionRate?: number | null
  memo?: string | null
  targetQtyOverride?: number | null
  contactName?: string | null
  phone?: string | null
  address?: string | null

  status?: "active" | "inactive" | null
  channel?: "online" | "offline" | null
  tags?: string[] | null

  storeFee?: number | null
  settlementCycle?: "monthly" | "weekly" | "biweekly" | "ad-hoc" | null
  settlementDay?: number | null
  settlementNote?: string | null
};

export type InventoryItem = {
  storeId: Id;
  productId: Id;
  onHandQty: number;
  updatedAt: number;
};

export type Settlement = {
  id: Id;
  storeId: Id;
  month: string; // YYYY-MM
  items: Array<{ productId: Id; soldQty: number; unitPrice?: number; currency?: string }>
  createdAt: number;
  updatedAt: number;
};

export type SettlementV2 = {
  id: string
  marketplace_id: string
  period_month: string
  gross_amount: number
  net_amount: number
  created_at: string
}

export type Plan = {
  id: Id;
  storeId: Id;
  month: string; // YYYY-MM
  items: Array<{ productId: Id; makeQty: number }>;
  createdAt: number;
  updatedAt: number;
};

export type AppData = {
  schemaVersion: 1;
  products: Product[];
  stores: Store[];
  inventory: InventoryItem[];
  storeProductStates: StoreProductState[];
  settlements: Settlement[];
  settlementsV2: SettlementV2[];
  plans: Plan[];
  updatedAt: number;
};

export interface StoreProductState {
  storeId: Id;
  productId: Id;
  enabled: boolean;
}
