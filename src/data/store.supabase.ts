// src/data/store.supabase.ts
import { supabase } from "../lib/supabaseClient"
import type { AppData, Product, Store } from "./models"
import { createEmptyData } from "./store"

// 🔒 전환용 유지보수 모드
const IS_MAINTENANCE = false

/* =========================
   DB Row Types
========================= */

type DBProduct = {
  id: string
  name: string
  category: string | null
  active: boolean | null
  make_enabled: boolean | null
  created_at: string
  price: number | null
  sku: string | null
  barcode: string | null
}

type DBStore = {
  id: string
  name: string
  created_at: string

  // ✅ stores 테이블 확장 컬럼(프로젝트에 이미 존재)
  commission_rate: number | null
  memo: string | null
  target_qty_override: number | null
  contact_name: string | null
  phone: string | null
  address: string | null
  store_status: string | null
  channel: string | null
  tags: string[] | null
  store_fee: number | null
  settlement_cycle: string | null
  settlement_day: number | null
  settlement_note: string | null
}

type DBInventory = {
  store_id: string
  product_id: string
  on_hand_qty: number | null
  updated_at: string
}

/**
 * ⚠️ Legacy(기존 구현): settlements / settlement_items 기반
 * - store_id, month 구조
 * - loadDataFromDB에서 사용 중
 */
type DBLegacySettlement = {
  id: string
  store_id: string
  month: string
  created_at: string
  updated_at: string
}

type DBLegacySettlementItem = {
  settlement_id: string
  product_id: string
  sold_qty: number | null
  unit_price: number | null
  currency: string | null
  created_at: string
}

/**
 * ✅ New(정산 자동 계산 엔진): marketplace_settings / settlements / settlement_lines 기반
 * - user_id + marketplace_id(=store.id) + period_month(YYYY-MM)
 * - 아래 CRUD 함수로 사용
 */

type DBSettlement = {
  id: string
  user_id: string
  marketplace_id: string
  period_month: string
  currency: string
  gross_amount: number
  commission_rate: number
  commission_amount: number
  net_amount: number
  rows_count: number
  status: "draft" | "confirmed"
  source_filename: string | null
  created_at: string
  updated_at: string
  apply_to_inventory: boolean
  settlement_type?: "detailed" | "summary"
}

type DBSettlementLine = {
  id: string
  settlement_id: string
  user_id: string
  marketplace_id: string
  product_id: string | null
  product_name_raw: string
  product_name_matched: string | null
  sku_raw: string | null
  qty_sold: number
  unit_price: number | null
  gross_amount: number
  match_status: "matched" | "unmatched" | "manual"
  created_at: string
}



/* =========================
   Auth Helper
========================= */

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error("Not authenticated")
  return data.user.id
}

/* =========================
   Store × Product Seed
========================= */

export async function ensureStoreProductStatesSeedDB(input: {
  storeIds: string[]
  productIds: string[]
}): Promise<void> {

// 🔒 유지보수 모드 차단
if (IS_MAINTENANCE) {
  throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
}

  const userId = await requireUserId()
  if (input.storeIds.length === 0 || input.productIds.length === 0) return

  const { data: existing, error } = await supabase
  .from("store_product_states")
  .select("store_id,product_id")
  .eq("user_id", userId)
  .in("store_id", input.storeIds)
  .in("product_id", input.productIds)

  if (error) throw error

  const exists = new Set(
    (existing ?? []).map((r: any) => `${r.store_id}__${r.product_id}`)
  )

  const now = new Date().toISOString()
  const rows: any[] = []

  for (const storeId of input.storeIds) {
    for (const productId of input.productIds) {
      const key = `${storeId}__${productId}`
      if (exists.has(key)) continue

      rows.push({
        user_id: userId,
        store_id: storeId,
        product_id: productId,
        enabled: true,
        updated_at: now,
      })
    }
  }

  if (rows.length === 0) return

  // 2) 동시성(레이스)에서도 안전하게: 중복이면 그냥 무시
  //    - Supabase는 upsert + ignoreDuplicates 조합으로 "ON CONFLICT DO NOTHING"을 구현 가능
  //    - onConflict는 실제 유니크/PK 컬럼 조합과 맞아야 함.
  //    - 프로젝트 구조상 user별 데이터이므로 보통 (user_id, store_id, product_id) 형태가 정석.
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)

    // 1차 시도: (user_id, store_id, product_id)
    let { error: upErr } = await supabase
      .from("store_product_states")
      .upsert(chunk, {
        onConflict: "user_id,store_id,product_id",
        ignoreDuplicates: true,
      })

    // 만약 실제 PK가 (store_id, product_id)라면 위 onConflict가 맞지 않아 에러가 날 수 있음.
    // 그 경우 2차로 (store_id, product_id)로 재시도해 안전하게 통과시킴.
    if (upErr) {
      const msg = String((upErr as any)?.message ?? upErr)
      const looksLikeConflictSpecIssue =
        msg.includes("onConflict") ||
        msg.includes("column") ||
        msg.includes("constraint") ||
        msg.includes("does not exist")

      if (looksLikeConflictSpecIssue) {
        const retry = await supabase.from("store_product_states").upsert(chunk, {
          onConflict: "user_id,store_id,product_id",
          ignoreDuplicates: true,
        })
        if (retry.error) throw retry.error
      } else {
        throw upErr
      }
    }
  }
}

/* =========================
   DB → AppData Load
   (현재 앱이 쓰는 구조 유지: legacy settlements 포함)
========================= */

export async function loadDataFromDB(): Promise<AppData> {
  console.time("[perf] loadDataFromDB")
  const userId = await requireUserId()

  const [
    productsRes,
    storesRes,
    invRes,
    settlementsV2Res,
  ] = await Promise.all([
    supabase
      .from("products")
      .select("id,name,category,active,make_enabled,created_at,price,sku,barcode")
      .eq("user_id", userId)
      .order("created_at"),

    supabase
      .from("stores")
      .select(
        "id,name,created_at,commission_rate,memo,target_qty_override,contact_name,phone,address," +
          "store_status,channel,tags,store_fee,settlement_cycle,settlement_day,settlement_note"
      )
      .eq("user_id", userId)
      .order("created_at")
      .returns<DBStore[]>(),

    supabase
      .from("inventory")
      .select("store_id,product_id,on_hand_qty,updated_at")
      .eq("user_id", userId),

    // settlements v2 (new engine header list)
    supabase
      .from("settlements_v2")
      .select("id, marketplace_id, period_month, gross_amount, net_amount, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),

  ])

  const err =
    productsRes.error ||
    storesRes.error ||
    invRes.error ||
    settlementsV2Res.error

  if (err) throw err

  const products = (productsRes.data ?? []) as DBProduct[]
  const stores = storesRes.data ?? []
  const inventory = (invRes.data ?? []) as DBInventory[]
  const settlementsV2 = (settlementsV2Res.data ?? []) as any[]

  // seed 보장 (store/product 조합이 실제로 비어있을 수 있으므로)
  await ensureStoreProductStatesSeedDB({
    storeIds: stores.map((s) => s.id),
    productIds: products.map((p) => p.id),
  })

  // store_product_states는 최종 1회만 읽음
  const { data: sps, error: spsErr } = await supabase
    .from("store_product_states")
    .select("store_id,product_id,enabled")
    .eq("user_id", userId)

  if (spsErr) throw spsErr
  console.timeEnd("[perf] loadDataFromDB")
  return {
    ...createEmptyData(),

    // ✅ v2는 최상단에 별도 보관 (legacy settlements 안에 넣지 말 것)
    settlementsV2: (settlementsV2 ?? []).map((s) => ({
      id: s.id,
      marketplace_id: s.marketplace_id,
      period_month: s.period_month,
      gross_amount: s.gross_amount ?? 0,
      net_amount: s.net_amount ?? 0,
      created_at: s.created_at,
      settlement_type: s.settlement_type ?? "detailed",
    })),

    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      active: p.active ?? true,
      makeEnabled: p.make_enabled ?? true,
      createdAt: new Date(p.created_at).getTime(),
      price: p.price ?? 0,
      sku: p.sku ?? null,
      barcode: p.barcode ?? null,
    })),

    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: new Date(s.created_at).getTime(),

      commissionRate: s.commission_rate ?? null,
      memo: s.memo ?? null,
      targetQtyOverride: s.target_qty_override ?? null,
      contactName: s.contact_name ?? null,
      phone: s.phone ?? null,
      address: s.address ?? null,

      // ✅ 신규 운영 필드
      status: (s.store_status as any) ?? "active",
      channel: (s.channel as any) ?? "offline",
      tags: s.tags ?? [],

      // ✅ 비용/정산 운영
      storeFee: s.store_fee ?? null,
      settlementCycle: (s.settlement_cycle as any) ?? null,
      settlementDay: s.settlement_day ?? null,
      settlementNote: s.settlement_note ?? null,
    })),

    inventory: inventory.map((i) => ({
      storeId: i.store_id,
      productId: i.product_id,
      onHandQty: i.on_hand_qty ?? 0,
      updatedAt: new Date(i.updated_at).getTime(),
    })),

    storeProductStates: (sps ?? []).map((x: any) => ({
      storeId: x.store_id,
      productId: x.product_id,
      enabled: x.enabled ?? true,
    })),

    // legacy settlements는 초기 전체 로딩에서 제외
    settlements: [],

    updatedAt: Date.now(),
  }
}

export async function getSettlementV2ByMarketplaceMonthDB(input: {
  marketplaceId: string
  periodMonth: string // "YYYY-MM"
}) {
  const userId = await requireUserId()

  const { data, error } = await supabase
    .from("settlements_v2")
    .select("id,user_id,marketplace_id,period_month,currency,gross_amount,commission_rate,commission_amount,net_amount,rows_count,status,apply_to_inventory,source_filename,created_at,updated_at,settlement_type")
    .eq("user_id", userId)
    .eq("marketplace_id", input.marketplaceId)
    .eq("period_month", input.periodMonth)
    .maybeSingle()

  if (error) throw error
  return data as any | null
}

export async function listSettlementLinesV2DB(input: {
  settlementId: string
}) {
  
  const userId = await requireUserId()

  console.time("[perf] settlement_lines_v2")

  const { data, error } = await supabase
    .from("settlement_lines_v2")
    .select("*")
    .eq("user_id", userId)
    .eq("settlement_id", input.settlementId)
    .order("gross_amount", { ascending: false })

  console.timeEnd("[perf] settlement_lines_v2")

  if (error) throw error
  return (data ?? []) as any[]
}

export async function recomputeSettlementProductStatsDB(input: {
  marketplaceId: string
  periodMonth: string
}): Promise<void> {
  const userId = await requireUserId()

  // 1) 해당 월/입점처의 상세 정산 헤더 id 목록
  const { data: settlements, error: sErr } = await supabase
    .from("settlements_v2")
    .select("id")
    .eq("user_id", userId)
    .eq("marketplace_id", input.marketplaceId)
    .eq("period_month", input.periodMonth)
    .eq("settlement_type", "detailed")

  if (sErr) throw sErr

  const settlementIds = (settlements ?? []).map((row: any) => String(row.id))

  // 2) 기존 집계 삭제
  const { error: delErr } = await supabase
    .from("settlement_product_stats")
    .delete()
    .eq("user_id", userId)
    .eq("marketplace_id", input.marketplaceId)
    .eq("period_month", input.periodMonth)

  if (delErr) throw delErr

  // 3) 상세 정산이 없으면 여기서 종료
  if (settlementIds.length === 0) return

  // 4) 해당 월/입점처 settlement line 로드
  const { data: lines, error: lErr } = await supabase
    .from("settlement_lines_v2")
    .select(
      [
        "product_id",
        "product_name_raw",
        "product_name_matched",
        "qty_sold",
        "gross_amount",
      ].join(",")
    )
    .eq("user_id", userId)
    .eq("marketplace_id", input.marketplaceId)
    .in("settlement_id", settlementIds)

  if (lErr) throw lErr

  // 5) 상품명 기준 집계
  const agg = new Map<
    string,
    {
      productId: string | null
      productName: string
      qtySoldSum: number
      grossAmountSum: number
    }
  >()

  for (const row of lines ?? []) {
    const productName =
      String((row as any).product_name_matched ?? (row as any).product_name_raw ?? "상품").trim() || "상품"

    const productId = (row as any).product_id ? String((row as any).product_id) : null
    const qtySold = Number((row as any).qty_sold ?? 0) || 0
    const grossAmount = Number((row as any).gross_amount ?? 0) || 0

    const current =
      agg.get(productName) ?? {
        productId,
        productName,
        qtySoldSum: 0,
        grossAmountSum: 0,
      }

    current.qtySoldSum += qtySold
    current.grossAmountSum += grossAmount

    if (!current.productId && productId) {
      current.productId = productId
    }

    agg.set(productName, current)
  }

  // 6) 저장
  const rows = Array.from(agg.values()).map((row) => ({
    user_id: userId,
    marketplace_id: input.marketplaceId,
    period_month: input.periodMonth,
    product_id: row.productId,
    product_name: row.productName,
    qty_sold_sum: row.qtySoldSum,
    gross_amount_sum: row.grossAmountSum,
    updated_at: new Date().toISOString(),
  }))

  if (rows.length === 0) return

  const { error: insErr } = await supabase
    .from("settlement_product_stats")
    .upsert(rows, {
      onConflict: "user_id,marketplace_id,period_month,product_name",
    })

  if (insErr) throw insErr
}

export async function listSettlementProductStatsDB(input: {
  periodMonth: string
  marketplaceId?: string
}) {
  const userId = await requireUserId()

  let q = supabase
    .from("settlement_product_stats")
    .select(
      [
        "id",
        "user_id",
        "marketplace_id",
        "period_month",
        "product_id",
        "product_name",
        "qty_sold_sum",
        "gross_amount_sum",
        "updated_at",
      ].join(",")
    )
    .eq("user_id", userId)
    .eq("period_month", input.periodMonth)
    .order("qty_sold_sum", { ascending: false })
    .order("gross_amount_sum", { ascending: false })

  if (input.marketplaceId) {
    q = q.eq("marketplace_id", input.marketplaceId)
  }

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

/* =========================
   Category (분리 관리)
========================= */

export async function loadCategoriesDB(): Promise<string[]> {
  const userId = await requireUserId()

  const { data, error } = await supabase
    .from("categories")
    .select("name")
    .eq("user_id", userId)
    .order("created_at")

  if (error) throw error
  return (data ?? []).map((r: any) => String(r.name))
}

export async function upsertCategoryDB(name: string): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()
  const c = name.trim()
  if (!c) return

  const { error } = await supabase
    .from("categories")
    .upsert({ user_id: userId, name: c }, { onConflict: "user_id,name" })

  if (error) throw error
}

export async function deleteCategoryDB(name: string): Promise<void> {

// 🔒 유지보수 모드 차단
if (IS_MAINTENANCE) {
  throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
}

  const userId = await requireUserId()
  const c = name.trim()
  if (!c) return

  const { error: updErr } = await supabase
    .from("products")
    .update({ category: null })
    .eq("user_id", userId)
    .eq("category", c)
  if (updErr) throw updErr

  const { error: delErr } = await supabase
    .from("categories")
    .delete()
    .eq("user_id", userId)
    .eq("name", c)
  if (delErr) throw delErr
}

/* =========================
   Inventory / States
========================= */

export async function upsertInventoryItemDB(input: {
  storeId: string
  productId: string
  onHandQty: number
}): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }
  
  const userId = await requireUserId()

  const { error } = await supabase.from("inventory").upsert(
    {
      user_id: userId,
      store_id: input.storeId,
      product_id: input.productId,
      on_hand_qty: input.onHandQty,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,store_id,product_id" }
  )

  if (error) throw error
}

// src/data/store.supabase.ts

export async function upsertInventoryItemsBatchDB(input: Array<{
  storeId: string
  productId: string
  onHandQty: number
}>): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  if (!input.length) return

  const userId = await requireUserId()
  const now = new Date().toISOString()

  const CHUNK = 200
  for (let i = 0; i < input.length; i += CHUNK) {
    const chunk = input.slice(i, i + CHUNK)

    const payload = chunk.map((x) => ({
      user_id: userId,
      store_id: x.storeId,
      product_id: x.productId,
      on_hand_qty: Math.max(0, Math.floor(Number(x.onHandQty) || 0)),
      updated_at: now,
    }))

    const { error } = await supabase
      .from("inventory")
      .upsert(payload, { onConflict: "user_id,store_id,product_id" })

    if (error) throw error
  }
}

export async function setStoreProductEnabledDB(input: {
  storeId: string
  productId: string
  enabled: boolean
}): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  const { error } = await supabase.from("store_product_states").upsert(
    {
      user_id: userId,
      store_id: input.storeId,
      product_id: input.productId,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,store_id,product_id" }
  )

  if (error) throw error
}

export async function setStoreProductsEnabledBulkDB(input: {
  storeId: string
  productIds: string[]
  enabled: boolean
}): Promise<void> {
  const userId = await requireUserId()
  if (input.productIds.length === 0) return

  const now = new Date().toISOString()

  const rows = input.productIds.map((productId) => ({
    user_id: userId,
    store_id: input.storeId,
    product_id: productId,
    enabled: input.enabled,
    updated_at: now,
  }))

  const { error } = await supabase
    .from("store_product_states")
    .upsert(rows, { onConflict: "user_id,store_id,product_id" })

  if (error) throw error
}



/* =========================
   Product / Store CRUD
========================= */

export async function createProductDB(p: Product): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  const { error } = await supabase.from("products").upsert(
    {
      user_id: userId,
      id: p.id,
      name: p.name,
      category: p.category,
      active: p.active ?? true,
      make_enabled: p.makeEnabled ?? true,
      created_at: new Date(p.createdAt).toISOString(),
      price: p.price ?? 0,
      sku: p.sku ?? null,
      barcode: p.barcode ?? null,
    },
    { onConflict: "user_id,id" }
  )
  if (error) throw error
  console.time("[perf] stores")
  const { data: stores } = await supabase.from("stores").select("id").eq("user_id", userId)
  console.timeEnd("[perf] stores")
  await ensureStoreProductStatesSeedDB({
    storeIds: (stores ?? []).map((s: any) => s.id),
    productIds: [p.id],
  })
}

export async function createStoreDB(s: Store): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  const { error } = await supabase.from("stores").upsert(
    {
      user_id: userId,
      id: s.id,
      name: s.name,
      created_at: new Date(s.createdAt).toISOString(),

      commission_rate: (s as any).commissionRate ?? null,
      memo: (s as any).memo ?? null,
      target_qty_override: (s as any).targetQtyOverride ?? null,
      contact_name: (s as any).contactName ?? null,
      phone: (s as any).phone ?? null,
      address: (s as any).address ?? null,

      store_status: (s as any).status ?? "active",
      channel: (s as any).channel ?? "offline",
      tags: (s as any).tags ?? [],

      store_fee: (s as any).storeFee ?? null,
      settlement_cycle: (s as any).settlementCycle ?? null,
      settlement_day: (s as any).settlementDay ?? null,
      settlement_note: (s as any).settlementNote ?? null,
    },
    { onConflict: "user_id,id" }
  )
  if (error) throw error
  console.time("[perf] products")
  const { data: products } = await supabase
    .from("products")
    .select("id")
    .eq("user_id", userId)
  console.timeEnd("[perf] products")

  await ensureStoreProductStatesSeedDB({
    storeIds: [s.id],
    productIds: (products ?? []).map((p: any) => p.id),
  })
  
}

export async function updateStoreDB(s: Store): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  const { error } = await supabase.from("stores").upsert(
    {
      user_id: userId,
      id: s.id,
      name: s.name,
      created_at: new Date(s.createdAt).toISOString(),

      commission_rate: (s as any).commissionRate ?? null,
      memo: (s as any).memo ?? null,
      target_qty_override: (s as any).targetQtyOverride ?? null,
      contact_name: (s as any).contactName ?? null,
      phone: (s as any).phone ?? null,
      address: (s as any).address ?? null,

      store_status: (s as any).status ?? "active",
      channel: (s as any).channel ?? "offline",
      tags: (s as any).tags ?? [],

      store_fee: (s as any).storeFee ?? null,
      settlement_cycle: (s as any).settlementCycle ?? null,
      settlement_day: (s as any).settlementDay ?? null,
      settlement_note: (s as any).settlementNote ?? null,
    },
    { onConflict: "user_id,id" }
  )

  if (error) throw error
}

export async function updateProductCategoryDB(input: {
  productId: string
  category: string | null
}): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  const { error } = await supabase
    .from("products")
    .update({ category: input.category })
    .eq("user_id", userId)
    .eq("id", input.productId)

  if (error) throw error
}

export async function deleteProductDB(productId: string): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("user_id", userId)
    .eq("id", productId)

  if (error) throw error
}

export async function deleteStoreDB(storeId: string): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  const { error } = await supabase
    .from("stores")
    .delete()
    .eq("user_id", userId)
    .eq("id", storeId)

  if (error) throw error
}

export async function upsertProductsBulkDB(input: {
  products: Array<{
    id: string
    name: string
    category?: string | null
    active?: boolean | null
    make_enabled?: boolean | null
    price?: number | null
    sku?: string | null
    barcode?: string | null
  }>
}): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()
  if (input.products.length === 0) return

  const rows = input.products.map((p) => ({
    user_id: userId,
    id: p.id,
    name: p.name,
    category: p.category ?? null,
    active: p.active ?? true,
    make_enabled: p.make_enabled ?? true,
    price: p.price ?? 0,
    sku: p.sku ?? null,
    barcode: p.barcode ?? null,
  }))

  const { error } = await supabase
    .from("products")
    .upsert(rows, { onConflict: "user_id,id" })

  if (error) throw error
}

export async function deleteProductsBulkDB(input: {
  productIds: string[]
}): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()
  if (input.productIds.length === 0) return

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("user_id", userId)
    .in("id", input.productIds)

  if (error) throw error
}

/* =========================
   ✅ New 정산 엔진 CRUD
   (marketplace_id = store.id)
========================= */

export async function getMarketplaceCommissionRateDB(input: {
  marketplaceId: string
}): Promise<number> {
  const userId = await requireUserId()

  const { data, error } = await supabase
    .from("marketplace_settings")
    .select("commission_rate")
    .eq("user_id", userId)
    .eq("marketplace_id", input.marketplaceId)
    .maybeSingle()

  if (error) throw error
  return Number(data?.commission_rate ?? 0)
}

export async function upsertMarketplaceCommissionRateDB(input: {
  marketplaceId: string
  commissionRate: number // 0.25 = 25%
}): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  const { error } = await supabase.from("marketplace_settings").upsert(
    {
      user_id: userId,
      marketplace_id: input.marketplaceId,
      commission_rate: input.commissionRate,
    },
    { onConflict: "user_id,marketplace_id" }
  )

  if (error) throw error
}

export async function listSettlementsDB(input: {
  marketplaceId?: string
  periodMonth?: string // "YYYY-MM"
}): Promise<DBSettlement[]> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  let q = supabase
    .from("settlements_v2")
    .select(
      "id,user_id,marketplace_id,period_month,currency,gross_amount,commission_rate,commission_amount,net_amount,rows_count,status,apply_to_inventory,settlement_type,source_filename,created_at,updated_at"
    )    
    .eq("user_id", userId)
    .order("period_month", { ascending: false })
    .order("created_at", { ascending: false })

  if (input.marketplaceId) q = q.eq("marketplace_id", input.marketplaceId)
  if (input.periodMonth) q = q.eq("period_month", input.periodMonth)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DBSettlement[]
}

export async function getSettlementDetailDB(input: {
  settlementId: string
}): Promise<{ settlement: DBSettlement; lines: DBSettlementLine[] }> {
  const userId = await requireUserId()

  console.time("[perf] settlements_v2")

  const { data: settlement, error: sErr } = await supabase
    .from("settlements_v2")
    .select("*")
    .eq("user_id", userId)
    .eq("id", input.settlementId)
    .single()

    console.time("[perf] settlements_v2")

  if (sErr) throw sErr

  const { data: lines, error: lErr } = await supabase
    .from("settlement_lines_v2")
    .select("*")
    .eq("user_id", userId)
    .eq("settlement_id", input.settlementId)
    .order("gross_amount", { ascending: false })

  if (lErr) throw lErr

  return {
    settlement: settlement as DBSettlement,
    lines: (lines ?? []) as DBSettlementLine[],
  }
}

export async function deleteSettlementV2DB(input: { settlementId: string }) {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  // 1) lines 삭제 (0개여도 가능)
  {
    const { error } = await supabase
      .from("settlement_lines_v2")
      .delete()
      .eq("user_id", userId)
      .eq("settlement_id", input.settlementId)

    if (error) throw error
  }

  // 2) header 삭제 (여기는 반드시 1개가 삭제돼야 정상)
  {
    const { data, error } = await supabase
      .from("settlements_v2")
      .delete()
      .eq("user_id", userId)
      .eq("id", input.settlementId)
      .select("id")

    if (error) throw error

    // ✅ 여기 중요: 실제로 삭제된 row가 0개면 실패로 처리
    if (!data || data.length === 0) {
      throw new Error("삭제 실패: DB에서 정산이 삭제되지 않았습니다 (권한/RLS 또는 조건 불일치).")
    }
  }
}

export async function restoreInventoryFromSettlementV2DB(input: {
  settlementId: string
}): Promise<void> {
  const userId = await requireUserId()

  // 1) settlement 로드

  console.time("[perf] settlements_v2")
  
  const { data: settlement, error: sErr } = await supabase
    .from("settlements_v2")
    .select("id,user_id,marketplace_id,apply_to_inventory")
    .eq("user_id", userId)
    .eq("id", input.settlementId)
    .single()

  console.timeEnd("[perf] settlements_v2")

  if (sErr) throw sErr

  // 적용 안 된 정산이면 복원하지 않음
  if (!settlement.apply_to_inventory) return

  // 2) lines 로드
  const { data: lines, error: lErr } = await supabase
    .from("settlement_lines_v2")
    .select("product_id,qty_sold")
    .eq("user_id", userId)
    .eq("settlement_id", input.settlementId)
  if (lErr) throw lErr

  const storeId = String(settlement.marketplace_id ?? "")
  if (!storeId) return

  // 3) product_id별 qty 합산
  const agg = new Map<string, number>()
  for (const l of lines ?? []) {
    const pid = String(l.product_id ?? "")
    if (!pid) continue
    const q = Number(l.qty_sold ?? 0)
    if (!Number.isFinite(q) || q === 0) continue
    agg.set(pid, (agg.get(pid) ?? 0) + q)
  }

  if (agg.size === 0) return

  const productIds = Array.from(agg.keys())

  // 4) inventory 현재값을 한 번에 조회 (IN)
  console.time("[perf] inventory")

  const { data: invRows, error: invErr } = await supabase
    .from("inventory")
    .select("product_id,on_hand_qty")
    .eq("user_id", userId)
    .eq("store_id", storeId)
    .in("product_id", productIds)

  console.timeEnd("[perf] inventory")
  
  if (invErr) throw invErr

  const currentByPid = new Map<string, number>(
    (invRows ?? []).map((r: any) => [
      String(r.product_id),
      Number(r.on_hand_qty ?? 0),
    ])
  )

  // 5) 계산 후 배치 업서트
  const payload = productIds.map((pid) => {
    const current = currentByPid.get(pid) ?? 0
    const restoreQty = agg.get(pid) ?? 0
    return {
      storeId,
      productId: pid,
      onHandQty: current + restoreQty,
    }
  })

  await upsertInventoryItemsBatchDB(payload)
}

export async function upsertSettlementHeaderDB(input: {
  marketplaceId: string
  periodMonth: string // "YYYY-MM"
  currency?: string
  grossAmount: number
  commissionRate: number
  commissionAmount: number
  netAmount: number
  rowsCount: number
  sourceFilename?: string | null
  applyToInventory: boolean
  settlementType?: "detailed" | "summary"
}): Promise<DBSettlement> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  const payload = {
    user_id: userId,
    marketplace_id: input.marketplaceId,
    period_month: input.periodMonth,
    currency: input.currency ?? "KRW",
    gross_amount: input.grossAmount,
    commission_rate: input.commissionRate,
    commission_amount: input.commissionAmount,
    net_amount: input.netAmount,
    rows_count: input.rowsCount,
    status: "confirmed",
    apply_to_inventory: input.applyToInventory,
    source_filename: input.sourceFilename ?? null,
    settlement_type: input.settlementType ?? "detailed",
  }

  const { data, error } = await supabase
    .from("settlements_v2")
    .upsert(payload, { onConflict: "user_id,marketplace_id,period_month,settlement_type" })
    .select("*")
    .single()

  if (error) throw error
  return data as DBSettlement
}

export async function replaceSettlementLinesDB(input: {
  settlementId: string
  marketplaceId: string
  lines: Array<{
    productId?: string | null
    productNameRaw: string
    productNameMatched?: string | null
    skuRaw?: string | null
    qtySold: number
    unitPrice?: number | null
    grossAmount: number
    matchStatus: "matched" | "unmatched" | "manual"
  }>
}): Promise<void> {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }

  const userId = await requireUserId()

  const { error: delErr } = await supabase
    .from("settlement_lines_v2")
    .delete()
    .eq("user_id", userId)
    .eq("settlement_id", input.settlementId)

  if (delErr) throw delErr

  if (input.lines.length === 0) return

  const rows = input.lines.map((l) => ({
    settlement_id: input.settlementId,
    user_id: userId,
    marketplace_id: input.marketplaceId,
    product_id: l.productId ?? null,
    product_name_raw: l.productNameRaw,
    product_name_matched: l.productNameMatched ?? null,
    sku_raw: l.skuRaw ?? null,
    qty_sold: l.qtySold,
    unit_price: l.unitPrice ?? null,
    gross_amount: l.grossAmount,
    match_status: l.matchStatus,
  }))

  const { error: insErr } = await supabase.from("settlement_lines_v2").insert(rows)
  if (insErr) throw insErr
}

export async function searchProductsForSettlementDB(input: {
  query: string
  limit?: number
}): Promise<DBProduct[]> {
  const userId = await requireUserId()
  const q = (input.query ?? "").trim()
  if (!q) return []

  const { data, error } = await supabase
    .from("products")
    .select("id,name,category,active,make_enabled,created_at,price,sku,barcode")
    .eq("user_id", userId)
    .or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`)
    .limit(input.limit ?? 20)

  if (error) throw error
  return (data ?? []) as DBProduct[]
}

/* =========================
   ⚠️ Legacy 정산 함수들(기존 유지)
========================= */

type CreateSettlementItemInput = {
  productId: string
  soldQty: number
  unitPrice: number
  currency?: string
}

export async function findSettlementByStoreMonthDB(params: {
  storeId: string
  month: string
}) {
  const userId = await requireUserId()
  const { storeId, month } = params

  const { data, error } = await supabase
    .from("settlements")
    .select("id, store_id, month")
    .eq("user_id", userId)
    .eq("store_id", storeId)
    .eq("month", month)
    .maybeSingle()

  if (error) throw error
  return data // 없으면 null
}

export async function createSettlementWithItemsDB(params: {
  storeId: string
  month: string
  items: CreateSettlementItemInput[]
}) {

  // 🔒 유지보수 모드 차단
  if (IS_MAINTENANCE) {
    throw new Error("현재 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.")
  }
  
  const userId = await requireUserId()
  const { storeId, month, items } = params

  // ⚠️ settlements 테이블에 payload NOT NULL이면 기본값 필요
  const { data: settlement, error: sErr } = await supabase
    .from("settlements")
    .insert({
      user_id: userId,
      store_id: storeId,
      month,
      payload: {}, // ✅ payload NOT NULL 대비
    })
    .select("id")
    .single()

  if (sErr) throw sErr

  const rows = items.map((it) => ({
    user_id: userId,
    settlement_id: settlement.id,
    product_id: it.productId,
    sold_qty: it.soldQty,
    unit_price: it.unitPrice,
    currency: (it.currency ?? "KRW").toUpperCase(),
  }))

  const { error: iErr } = await supabase.from("settlement_items").insert(rows)
  if (iErr) throw iErr

  return settlement.id as string
}

export async function loadMonthlySettlementSummary(month: string) {
  const userId = await requireUserId()

  const { data, error } = await supabase
    .from("settlements")
    .select(
      `
      id,
      store_id,
      stores:store_id (
        name,
        commission_rate
      ),
      settlement_items (
        sold_qty,
        unit_price
      )
    `
    )
    .eq("user_id", userId)
    .eq("month", month)

  if (error) throw error
  return data
}
