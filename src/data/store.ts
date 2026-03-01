// src/data/store.ts
import type { AppData, Id } from "./models";

export const STORAGE_KEY = "shop-planner-v1";

export function generateId(prefix: string): Id {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export function createEmptyData(): AppData {
    return {
      schemaVersion: 1,
      products: [],
      stores: [],
      inventory: [],
      storeProductStates: [], // ✅ 반드시 추가
      settlements: [],
      settlementsV2: [],
      plans: [],
      updatedAt: Date.now(),
    };
  }  

export function loadData(): AppData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createEmptyData();
  
      const parsed = JSON.parse(raw) as AppData;
      if (!parsed || parsed.schemaVersion !== 1) return createEmptyData();
  
      return { ...createEmptyData(), ...parsed };
    } catch {
      return createEmptyData();
    }
  }  

export function saveData(data: AppData) {
  const next: AppData = { ...data, updatedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}
// inventory upsert helper (storeId + productId 기준으로 갱신/추가)
export function upsertInventoryItem(
    data: AppData,
    input: { storeId: string; productId: string; onHandQty: number }
  ): AppData {
    const now = Date.now();
    const idx = data.inventory.findIndex(
      (it) => it.storeId === input.storeId && it.productId === input.productId
    );
  
    if (idx >= 0) {
      const nextInv = [...data.inventory];
      nextInv[idx] = { ...nextInv[idx], onHandQty: input.onHandQty, updatedAt: now };
      return { ...data, inventory: nextInv, updatedAt: now };
    }
  
    return {
      ...data,
      inventory: [
        ...data.inventory,
        { storeId: input.storeId, productId: input.productId, onHandQty: input.onHandQty, updatedAt: now },
      ],
      updatedAt: now,
    };
  }
  