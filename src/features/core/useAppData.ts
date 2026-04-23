// src/features/core/useAppData.ts
// Shared state + actions previously in Master.tsx, extracted for feature pages.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { toast } from "@/lib/toast"
import * as XLSX from "xlsx"
import type { AppData } from "@/data/models"
import { downloadJson, generateId, readJsonFile } from "@/data/store"
import {
  loadDataFromDB,
  setStoreProductEnabledDB,
  setStoreProductsEnabledBulkDB,
  createProductDB,
  createStoreDB,
  deleteProductDB,
  deleteStoreDB,
  loadCategoriesDB,
  upsertCategoryDB,
  deleteCategoryDB,
  updateStoreDB,
  upsertProductsBulkDB,
  updateProductCategoryDB
} from "@/data/store.supabase"
import {
  supabase,
  getOrCreateMyProfile,
  updateMyDefaultTargetQty,
  updateMyLowStockThreshold,
} from "@/lib/supabaseClient"

/**
 * ✅ CSV row 타입(템플릿: category,name,active,price,sku,barcode)
 * - 실무 요구: CSV 값이 "비어있으면 기존 값 유지"를 위해 nullable/optional로 설계
 * - price:
 *   - 빈 값이면 null (기존 유지)
 *   - 0은 0으로 반영(= 기존 유지와 구분)
 * - sku/barcode:
 *   - 빈 값이면 null (기존 유지)
 */
type ProductCsvRow = {
  category?: string
  name: string
  active: boolean
  price?: number | null
  sku?: string | null
  barcode?: string | null
}

type ProductCsvConflict = {
  key: string
  name: string
  field: "price" | "sku" | "barcode" | "active"
  oldV: any
  newV: any
}

type ProductCsvConflictInfo = {
  fileName: string
  rows: ProductCsvRow[]
  conflicts: ProductCsvConflict[]
}

function normalizeCategoryKey(raw: string | null | undefined) {
  return (raw ?? "").trim()
}

function normalizeNameKey(raw: string | null | undefined) {
  return (raw ?? "").trim()
}

const EMPTY: AppData = {
  schemaVersion: 1,
  products: [],
  stores: [],
  inventory: [],
  storeProductStates: [],
  settlements: [],
  settlementsV2: [],
  plans: [],
  updatedAt: Date.now(),
}

function parseBooleanLike(v: string): boolean {
  const t = (v ?? "").trim().toLowerCase()
  if (t === "") return true
  if (["true", "t", "1", "y", "yes", "on", "활성"].includes(t)) return true
  if (["false", "f", "0", "n", "no", "off", "비활성"].includes(t)) return false
  return true
}

function parseNumberLikeNullable(v: string): number | null {
  const t = (v ?? "").trim()
  if (!t) return null
  const n = Number(t.replace(/,/g, ""))
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n))
}

// 단순 CSV 파서(템플릿 기준). 복잡한 인용부호 케이스는 지원하지 않음.
function parseSimpleCSV(text: string): ProductCsvRow[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length === 0) return []

  const header = lines[0].split(",").map((x) => x.trim().toLowerCase())
  const idxCategory = header.indexOf("category")
  const idxName = header.indexOf("name")
  const idxActive = header.indexOf("active")
  const idxPrice = header.indexOf("price")
  const idxSku = header.indexOf("sku")
  const idxBarcode = header.indexOf("barcode")

  if (idxName === -1 || idxActive === -1) {
    throw new Error(
      'CSV 헤더에 "name,active"가 필요합니다. (권장: category,name,active,price,sku,barcode)'
    )
  }

  const rows: ProductCsvRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((x) => x.trim())

    const category = idxCategory >= 0 ? (cols[idxCategory] ?? "").trim() : ""
    const name = (cols[idxName] ?? "").trim()
    const activeRaw = cols[idxActive] ?? ""

    const priceRaw = idxPrice >= 0 ? cols[idxPrice] ?? "" : ""
    const skuRaw = idxSku >= 0 ? cols[idxSku] ?? "" : ""
    const barcodeRaw = idxBarcode >= 0 ? cols[idxBarcode] ?? "" : ""

    // ✅ 빈 값이면 null로 만들어 "기존 유지" 가능하게 함
    const price = idxPrice >= 0 ? parseNumberLikeNullable(priceRaw) : null
    const sku = idxSku >= 0 ? (skuRaw.trim() ? skuRaw.trim() : null) : null
    const barcode =
      idxBarcode >= 0 ? (barcodeRaw.trim() ? barcodeRaw.trim() : null) : null

    rows.push({
      category,
      name,
      active: parseBooleanLike(activeRaw),
      price,
      sku,
      barcode,
    })
  }

  return rows
}


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function withOneRetryOnFetch<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    // 브라우저 네트워크/프리플라이트/세션 레이스 등에서 흔히 발생
    if (msg.includes("Failed to fetch")) {
      await sleep(350)
      return await fn()
    }
    throw e
  }
}



export function useAppData() {
  const [data, setData] = useState<AppData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // ✅ refresh 중복 호출 방지
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const refreshQueuedRef = useRef(false)

  // ✅ 유저별 설정
  const [defaultTargetQtyInput, setDefaultTargetQtyInput] = useState<string>("5")
  const [lowStockThresholdInput, setLowStockThresholdInput] = useState<string>("2")
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSaving, setProfileSaving] = useState(false)

  // ✅ CSV 업로드
  const csvInputRef = useRef<HTMLInputElement | null>(null)
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvConflictInfo, setCsvConflictInfo] = useState<ProductCsvConflictInfo | null>(null)

  const handleProductCsvUpload = useCallback(() => {
    // 템플릿 다운로드는 ProductsManager에서도 하고 있으니
    // 여기서는 파일 선택만 열어주는 역할만 하면 됨
    csvInputRef.current?.click()
  }, [])  

  const [newProductName, setNewProductName] = useState("")
  const [newStoreName, setNewStoreName] = useState("")
  const [newStoreCommissionInput, setNewStoreCommissionInput] = useState<string>("")
const [newStoreTargetQtyInput, setNewStoreTargetQtyInput] = useState<string>("")
const [newStoreContactName, setNewStoreContactName] = useState<string>("")
const [newStorePhone, setNewStorePhone] = useState<string>("")
const [newStoreAddress, setNewStoreAddress] = useState<string>("")
const [newStoreMemo, setNewStoreMemo] = useState<string>("")

  // ✅ 제품명/카테고리 수정 UI 상태
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [editingProductName, setEditingProductName] = useState<string>("")
  const editingOriginalRef = useRef<string>("")
  const [editingProductCategory, setEditingProductCategory] = useState<string>("")
  const editingOriginalCategoryRef = useRef<string>("")

  // ✅ 카테고리 콤보박스
  const [newCategory, setNewCategory] = useState<string>("")
  const [categoryTyped, setCategoryTyped] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categories, setCategories] = useState<string[]>([])

  

  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of categories) {
      const v = String(c).trim()
      if (v) set.add(v)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"))
  }, [categories])

  const normalizedCategory = useMemo(() => newCategory.trim(), [newCategory])
  const isExistingCategory = useMemo(
    () => normalizedCategory !== "" && categoryOptions.includes(normalizedCategory),
    [normalizedCategory, categoryOptions]
  )

  // ===== profile bootstrap =====
useEffect(() => {
  let alive = true

  ;(async () => {
    try {
      setProfileLoading(true)

      const profile = await withOneRetryOnFetch(async () => {
        // ✅ 세션이 실제로 준비된 다음에만 프로필 RPC/쿼리 진행
        const { data: s } = await supabase.auth.getSession()
        if (!s.session) throw new Error("not_authenticated")
        return await getOrCreateMyProfile()
      })

      if (!alive) return
      setDefaultTargetQtyInput(String(profile.default_target_qty))
      setLowStockThresholdInput(String(profile.low_stock_threshold ?? 2))
    } catch (e) {
      console.error("[profiles] failed to load profile", e)
    } finally {
      if (alive) setProfileLoading(false)
    }
  })()

  return () => {
    alive = false
  }
}, [])

const refresh = useCallback(async () => {
  console.time("[perf] refresh")
  if (refreshInFlightRef.current) {
    refreshQueuedRef.current = true
    return refreshInFlightRef.current
  }

  const p = (async () => {
    setLoading(true)
    setErrorMsg(null)

    try {
      await withOneRetryOnFetch(async () => {
        // ✅ 세션 준비 확인(로그인 직후 레이스 방지)
        const { data: s } = await supabase.auth.getSession()
        if (!s.session) throw new Error("not_authenticated")
    
        const next = await loadDataFromDB()
        setData(next)
    
        const cats = await loadCategoriesDB()
        setCategories(cats)
      })
    } catch (e: any) {
      console.error(e)
      const msg = String(e?.message ?? e)
      setErrorMsg(
        msg.includes("Failed to fetch")
          ? "네트워크 연결이 잠시 불안정해요. 잠시 후 다시 시도해 주세요."
          : msg
      )
  console.timeEnd("[perf] refresh")
  
    } finally {
      setLoading(false)
    }
  })()

  refreshInFlightRef.current = p
  await p
  refreshInFlightRef.current = null

  if (refreshQueuedRef.current) {
    refreshQueuedRef.current = false
    await refresh()
  }
}, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const saveCategoryOnly = useCallback(async () => {
    const c = String(newCategory ?? "").trim()
    if (!c) return
  
    try {
      await upsertCategoryDB(c)
  
      // 로컬 목록도 즉시 갱신(중복 방지)
      setCategories((prev) => {
        if (prev.includes(c)) return prev
        return [...prev, c]
      })
  
      toast.success("카테고리를 저장했어요.")
      await refresh()
    } catch (e: any) {
      console.error(e)
      toast.error(`카테고리 저장 실패: ${e?.message ?? e}`)
      await refresh()
    }
  }, [newCategory, refresh])

  const deleteCategory = useCallback(
    async (name: string) => {
      const c = String(name ?? "").trim()
      if (!c) return
  
      try {
        setLoading(true)
        await deleteCategoryDB(c)
  
        // ✅ 로컬 categories 상태 업데이트(있을 때만)
        setCategories((prev) => prev.filter((x) => x !== c))
  
        toast.success("카테고리를 삭제했어요.")
        await refresh()
      } catch (e: any) {
        console.error(e)
        toast.error(`카테고리 삭제 실패: ${e?.message ?? e}`)
        await refresh()
      } finally {
        setLoading(false)
      }
    },
    [refresh]
  )

  const saveProductCategoryOnly = useCallback(
  async (productId: string, category: string | null) => {
    const pid = String(productId ?? "").trim()
    if (!pid) return

    try {
      await updateProductCategoryDB({
        productId: pid,
        category: category ?? null,
      })

      toast.success("카테고리를 저장했어요.")
      await refresh()
    } catch (e: any) {
      console.error(e)
      toast.error(`카테고리 저장 실패: ${e?.message ?? e}`)
      await refresh()
    }
  },
  [refresh]
)

  // ✅ 토글/대량변경 후 refresh를 "마지막 변경 2초 뒤 1번"만 실행
const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

const scheduleRefresh = useCallback(() => {
  if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current)
  refreshDebounceRef.current = setTimeout(() => {
    refreshDebounceRef.current = null
    refresh()
  }, 2000)
}, [refresh])

const createStoreWithFields = useCallback(
  async (input: any) => {
    const name = String(input?.name ?? "").trim()
    if (!name) {
      toast.error("입점처명은 비워둘 수 없어요.")
      return
    }

    const id =
      (globalThis.crypto as any)?.randomUUID?.() ??
      `store_${Date.now()}_${Math.random().toString(16).slice(2)}`

    const now = Date.now()

    const store = {
      id,
      name,
      createdAt: now,

      commissionRate: input.commissionRate ?? null,
      targetQtyOverride: input.targetQtyOverride ?? null,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      memo: input.memo ?? null,

      status: input.status ?? "active",
      channel: input.channel ?? "offline",
      tags: input.tags ?? [],

      storeFee: input.storeFee ?? null,
      settlementCycle: input.settlementCycle ?? null,
      settlementDay: input.settlementDay ?? null,
      settlementNote: input.settlementNote ?? null,
    } as any

    try {
      // loading은 프로젝트마다 setLoading이 없을 수 있으니, 있는 경우만 사용
      // @ts-ignore
      if (typeof setLoading === "function") setLoading(true)

      await createStoreDB(store)
      toast.success("입점처를 추가했어요.")
      await refresh()
    } catch (e: any) {
      console.error(e)
      toast.error(`추가 실패: ${e?.message ?? e}`)
      await refresh()
    } finally {
      // @ts-ignore
      if (typeof setLoading === "function") setLoading(false)
    }
  },
  [refresh]
)

  // ===== products =====
  const addProduct = useCallback(async () => {
    const name = newProductName.trim()
    const categoryToSave = newCategory.trim() === "" ? null : newCategory.trim()
    if (!name) return

    const p = {
      id: generateId("p"),
      name,
      category: categoryToSave,
      active: true,
      makeEnabled: true,
      createdAt: Date.now(),
      price: 0,
      sku: null,
      barcode: null,
    }

    const prevProducts = data.products
    const prevCategories = categories

    setData((prev) => ({
      ...prev,
      products: [p, ...prev.products],
      updatedAt: Date.now(),
    }))

    if (categoryToSave) {
      setCategories((prev) => {
        const set = new Set(prev.map((x) => x.trim()))
        set.add(categoryToSave.trim())
        return Array.from(set)
      })
    }

    setNewProductName("")
    setNewCategory("")
    setCategoryTyped(false)

    try {
      if (categoryToSave) await upsertCategoryDB(categoryToSave)
      // NOTE: createProductDB가 upsert라면 OK. (신규 전용이면 별도 upsert 함수로 분리 권장)
      await createProductDB(p as any)
      toast.success("제품을 추가했어요.")
    } catch (e: any) {
      console.error(e)
      setData((prev) => ({ ...prev, products: prevProducts, updatedAt: Date.now() }))
      setCategories(prevCategories)
      toast.error(`제품 추가 실패: ${e?.message ?? e}`)
      await refresh()
    }
  }, [newProductName, newCategory, data.products, categories, refresh])

  const deleteProduct = useCallback(
    async (productId: string) => {
      await deleteProductDB(productId)
      await refresh()
      toast.success("제품을 삭제했어요.")
    },
    [refresh]
  )

  // 제품 활성/비활성 (Optimistic + upsert)
  const toggleProductActiveFlip = useCallback(
    async (productId: string) => {
      const hit = data.products.find((p) => p.id === productId)
      if (!hit) return

      const next = { ...hit, active: !hit.active }
      const prevProducts = data.products

      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === productId ? next : p)),
        updatedAt: Date.now(),
      }))

      try {
        await createProductDB(next as any)
      } catch (e) {
        console.error(e)
        setData((prev) => ({ ...prev, products: prevProducts, updatedAt: Date.now() }))
        toast.error("상태 변경 실패 (로그인 / 권한 / RLS 확인)")
      }
    },
    [data.products]
  )

  // 제품 제작대상 ON/OFF (Optimistic + upsert)
  const toggleProductMakeEnabledFlip = useCallback(
    async (productId: string) => {
      const hit = data.products.find((p) => p.id === productId)
      if (!hit) return

      const next = { ...hit, makeEnabled: !(hit.makeEnabled ?? true) }
      const prevProducts = data.products

      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === productId ? next : p)),
        updatedAt: Date.now(),
      }))

      try {
        await createProductDB(next as any)
      } catch (e) {
        console.error(e)
        setData((prev) => ({ ...prev, products: prevProducts, updatedAt: Date.now() }))
        toast.error("제작대상 변경 실패 (로그인 / 권한 / RLS 확인)")
      }
    },
    [data.products]
  )

  // 제품명/카테고리 저장 (Optimistic + upsert)
  const saveProductFieldsSimple = useCallback(
    async (productId: string, nextNameRaw: string, nextCategoryRaw: string) => {
      const hit = data.products.find((p) => p.id === productId)
      if (!hit) return

      const nextName = nextNameRaw.trim()
      const nextCategory = nextCategoryRaw.trim()

      if (!nextName) {
        toast.error("제품명은 비워둘 수 없어요.")
        return
      }

      const normalized = nextCategory === "" || nextCategory === "미분류" ? "" : nextCategory
      if (nextName === hit.name && (normalized || "") === (hit.category || "")) return

      const prevProducts = data.products
      const next = { ...hit, name: nextName, category: normalized || null }

      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === productId ? next : p)),
        updatedAt: Date.now(),
      }))

      try {
        if (next.category && !categoryOptions.includes(next.category)) {
          await upsertCategoryDB(next.category)
        }
        await createProductDB(next as any)
        await refresh()
        toast.success("제품 정보를 저장했어요.")
      } catch (e: any) {
        console.error(e)
        setData((prev) => ({ ...prev, products: prevProducts, updatedAt: Date.now() }))
        toast.error(`저장 실패: ${e?.message ?? e}`)
        await refresh()
      }
    },
    [data.products, categoryOptions, refresh]
  )

  // 제품(이름/카테고리/가격/sku/barcode) 저장 (Optimistic + upsert)
  const saveProductFieldsExtended = useCallback(
    async (
      productId: string,
      input: {
        name: string
        category: string
        price: number
        sku: string
        barcode: string
      }
    ) => {
      const hit = data.products.find((p) => p.id === productId)
      if (!hit) return

      const nextName = (input.name ?? "").trim()
      const nextCategoryRaw = (input.category ?? "").trim()
      const nextCategory =
        nextCategoryRaw === "" || nextCategoryRaw === "미분류" ? null : nextCategoryRaw

      if (!nextName) {
        toast.error("제품명은 비워둘 수 없어요.")
        return
      }

      const priceNum = Number.isFinite(input.price) ? Number(input.price) : 0
      const nextPrice = Math.max(0, Math.round(priceNum)) // 정수 원화 기준

      const skuTrim = (input.sku ?? "").trim()
      const barcodeTrim = (input.barcode ?? "").trim()
      const nextSku = skuTrim === "" ? null : skuTrim
      const nextBarcode = barcodeTrim === "" ? null : barcodeTrim

      // 변경 없으면 리턴
      const unchanged =
        nextName === hit.name &&
        (nextCategory ?? "") === (hit.category ?? "") &&
        (nextPrice ?? 0) === (hit.price ?? 0) &&
        (nextSku ?? "") === (hit.sku ?? "") &&
        (nextBarcode ?? "") === (hit.barcode ?? "")
      if (unchanged) return

      const prevProducts = data.products

      const next = {
        ...hit,
        name: nextName,
        category: nextCategory,
        price: nextPrice,
        sku: nextSku,
        barcode: nextBarcode,
      }

      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === productId ? (next as any) : p)),
        updatedAt: Date.now(),
      }))

      try {
        if (next.category && !categoryOptions.includes(next.category)) {
          await upsertCategoryDB(next.category)
        }
        await createProductDB(next as any)
        await refresh()
        toast.success("제품 정보를 저장했어요.")
      } catch (e: any) {
        console.error(e)
        setData((prev) => ({ ...prev, products: prevProducts, updatedAt: Date.now() }))
        toast.error(`저장 실패: ${e?.message ?? e}`)
        await refresh()
      }
    },
    [data.products, categoryOptions, refresh]
  )

  // ===== stores =====
  const addStore = useCallback(async () => {
    const name = newStoreName.trim()
    if (!name) return
    const commissionRaw = newStoreCommissionInput.trim()
const commissionRate =
  commissionRaw === "" ? null : Math.max(0, Number(commissionRaw) || 0)

const targetRaw = newStoreTargetQtyInput.trim()
const targetQtyOverride =
  targetRaw === "" ? null : Math.max(0, parseInt(targetRaw, 10) || 0)

const contactName = newStoreContactName.trim() || null
const phone = newStorePhone.trim() || null
const address = newStoreAddress.trim() || null

const memo = newStoreMemo.trim() || null

const s = {
  id: generateId("s"),
  name,
  createdAt: Date.now(),
  commissionRate,
  targetQtyOverride,
  contactName,
  phone,
  address,
  memo,
}

    const prevStores = data.stores

    setData((prev) => ({
      ...prev,
      stores: [s, ...prev.stores],
      updatedAt: Date.now(),
    }))
    setNewStoreName("")
    setNewStoreCommissionInput("")
setNewStoreTargetQtyInput("")
setNewStoreContactName("")
setNewStorePhone("")
setNewStoreAddress("")
setNewStoreMemo("")

    try {
      await createStoreDB(s as any)
      toast.success("입점처를 추가했어요.")
    } catch (e: any) {
      console.error(e)
      setData((prev) => ({ ...prev, stores: prevStores, updatedAt: Date.now() }))
      toast.error(`입점처 추가 실패: ${e?.message ?? e}`)
      await refresh()
    }
  }, [newStoreName, data.stores, refresh])

  const deleteStore = useCallback(
    async (storeId: string) => {
      await deleteStoreDB(storeId)
      await refresh()
      toast.success("입점처를 삭제했어요.")
    },
    [refresh]
  )

  const toggleOne = useCallback(
    async (storeId: string, productId: string, next: boolean) => {
      const prevStates = data.storeProductStates
  
      // ✅ 1) UI 먼저 반영(optimistic)
      setData((prev) => {
        const cur = prev.storeProductStates ?? []
        const idx = cur.findIndex((x) => x.storeId === storeId && x.productId === productId)
  
        const nextStates =
          idx >= 0
            ? cur.map((x, i) => (i === idx ? { ...x, enabled: next } : x))
            : [{ storeId, productId, enabled: next }, ...cur]
  
        return { ...prev, storeProductStates: nextStates, updatedAt: Date.now() }
      })
  
      // ✅ 2) DB 저장
      try {
        await setStoreProductEnabledDB({ storeId, productId, enabled: next })
  
        // ✅ 3) 최종 동기화는 2초 뒤 1번만
        scheduleRefresh()
      } catch (e) {
        console.error(e)
  
        // 실패 시 롤백 + 즉시 refresh
        setData((prev) => ({ ...prev, storeProductStates: prevStates, updatedAt: Date.now() }))
        toast.error("ON/OFF 저장에 실패했어요.")
        await refresh()
      }
    },
    [data.storeProductStates, refresh, scheduleRefresh]
  )    

  const toggleAll = useCallback(
    async (storeId: string, next: boolean) => {
      const productIds = data.products.map((p) => p.id)
      const prevStates = data.storeProductStates
  
      // ✅ 1) UI 먼저 반영
      setData((prev) => {
        const cur = prev.storeProductStates ?? []
        const kept = cur.filter((x) => x.storeId !== storeId)
        const nextStates = [
          ...productIds.map((pid) => ({ storeId, productId: pid, enabled: next })),
          ...kept,
        ]
        return { ...prev, storeProductStates: nextStates, updatedAt: Date.now() }
      })
  
      // ✅ 2) DB 저장(일괄)
      try {
        await setStoreProductsEnabledBulkDB({
          storeId,
          productIds,
          enabled: next,
        })
  
        // ✅ 3) 최종 동기화는 2초 뒤 1번만
        scheduleRefresh()
      } catch (e) {
        console.error(e)
  
        // 실패 시 롤백 + 즉시 refresh
        setData((prev) => ({ ...prev, storeProductStates: prevStates, updatedAt: Date.now() }))
        toast.error("일괄 변경 저장에 실패했어요.")
        await refresh()
      }
    },
    [data.products, data.storeProductStates, refresh, scheduleRefresh]
  )  

  const saveStoreFields = useCallback(
    async (
      storeId: string,
      input: {
        name: string
        commissionRate: number | null
        targetQtyOverride: number | null
        contactName: string | null
        phone: string | null
        address: string | null
        memo: string | null
  
        // ✅ 신규 운영/정산 필드(옵션: 기존 호출부 깨지지 않게 optional)
        status?: "active" | "inactive" | null
        channel?: "online" | "offline" | null
        tags?: string[] | null
        storeFee?: number | null
        settlementCycle?: "monthly" | "weekly" | "biweekly" | "ad-hoc" | null
        settlementDay?: number | null
        settlementNote?: string | null
      }
    ) => {
      const hit = data.stores.find((s) => s.id === storeId)
      if (!hit) return
  
      const nextName = (input.name ?? "").trim()
      if (!nextName) {
        toast.error("입점처명은 비워둘 수 없어요.")
        return
      }
  
      // ✅ tags 정리(빈값 제거 + trim + 중복 제거)
      const cleanedTags = Array.from(
        new Set((input.tags ?? (hit as any).tags ?? []).map((t: string) => t.trim()).filter(Boolean))
      )
  
      // ✅ settlementDay 검증 (1~31만 허용, 아니면 null)
      const sdRaw = input.settlementDay
      const settlementDay =
        sdRaw == null ? ((hit as any).settlementDay ?? null) : Number.isFinite(sdRaw) ? sdRaw : null
      const safeSettlementDay =
        settlementDay == null ? null : settlementDay >= 1 && settlementDay <= 31 ? settlementDay : null
  
      const next = {
        ...hit,
        name: nextName,
        commissionRate: input.commissionRate ?? null,
        targetQtyOverride: input.targetQtyOverride ?? null,
        contactName: input.contactName ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        memo: input.memo ?? null,
  
        // ✅ 신규 필드: undefined면 기존값 유지
        status: input.status ?? (hit as any).status ?? "active",
        channel: input.channel ?? (hit as any).channel ?? "offline",
        tags: cleanedTags,
  
        storeFee: input.storeFee ?? (hit as any).storeFee ?? null,
        settlementCycle: input.settlementCycle ?? (hit as any).settlementCycle ?? null,
        settlementDay: safeSettlementDay,
        settlementNote: input.settlementNote ?? (hit as any).settlementNote ?? null,
      }
  
      const prevStores = data.stores
  
      setData((prev) => ({
        ...prev,
        stores: prev.stores.map((s) => (s.id === storeId ? (next as any) : s)),
        updatedAt: Date.now(),
      }))
  
      try {
        await updateStoreDB(next as any)
        toast.success("입점처 정보를 저장했어요.")
        await refresh()
      } catch (e: any) {
        console.error(e)
        setData((prev) => ({ ...prev, stores: prevStores, updatedAt: Date.now() }))
        toast.error(`저장 실패: ${e?.message ?? e}`)
        await refresh()
      }
    },
    [data.stores, refresh]
  )

  // ===== CSV products upload =====
const isProvidedCsvValue = (v: any) =>
  v !== null && v !== undefined && String(v).trim() !== ""

const differsCsvValue = (a: any, b: any) => String(a ?? "").trim() !== String(b ?? "").trim()

const applyCsvProducts = useCallback(
  async (uniqueRows: ProductCsvRow[], overwriteMode: "overwrite" | "safe") => {
    if (uniqueRows.length === 0) return

    setCsvBusy(true)

    const prevData = data
    const prevCategories = categories

    try {
      const existing = new Map<string, any>()
      for (const p of data.products) {
        const key = `${normalizeCategoryKey(p.category)}||${normalizeNameKey(p.name)}`
        existing.set(key, p)
      }

      const nextProducts = [...data.products]
      const changed: any[] = []
      const newCats: string[] = []

      for (const r of uniqueRows) {
        const catTrim = (r.category ?? "").trim()
        const categoryOrNull = catTrim === "" ? null : catTrim
        const key = `${normalizeCategoryKey(categoryOrNull ?? "")}||${normalizeNameKey(r.name)}`
        const hit = existing.get(key)

        if (hit) {
          if (overwriteMode === "overwrite") {
            const next = {
              ...hit,
              active: r.active,
              price: r.price === null || r.price === undefined ? (hit.price ?? 0) : (r.price as any),
              sku: r.sku === null || r.sku === undefined ? (hit.sku ?? null) : r.sku,
              barcode: r.barcode === null || r.barcode === undefined ? (hit.barcode ?? null) : r.barcode,
            }

            const idx = nextProducts.findIndex((x) => x.id === hit.id)
            if (idx >= 0) nextProducts[idx] = next
            changed.push(next)
          } else {
            const next = {
              ...hit,
              active: hit.active,
              price:
                hit.price === null || hit.price === undefined
                  ? r.price === null || r.price === undefined
                    ? hit.price
                    : r.price
                  : hit.price,
              sku: isProvidedCsvValue(hit.sku) ? hit.sku : isProvidedCsvValue(r.sku) ? r.sku : hit.sku,
              barcode: isProvidedCsvValue(hit.barcode)
                ? hit.barcode
                : isProvidedCsvValue(r.barcode)
                  ? r.barcode
                  : hit.barcode,
            }

            const changedAny =
              Boolean(next.active) !== Boolean(hit.active) ||
              Number(next.price ?? 0) !== Number(hit.price ?? 0) ||
              String(next.sku ?? "").trim() !== String(hit.sku ?? "").trim() ||
              String(next.barcode ?? "").trim() !== String(hit.barcode ?? "").trim()

            if (changedAny) {
              const idx = nextProducts.findIndex((x) => x.id === hit.id)
              if (idx >= 0) nextProducts[idx] = next
              changed.push(next)
            }
          }
        } else {
          const p = {
            id: generateId("p"),
            name: r.name,
            category: categoryOrNull,
            active: r.active,
            makeEnabled: true,
            createdAt: Date.now(),
            price: r.price ?? 0,
            sku: r.sku ?? null,
            barcode: r.barcode ?? null,
          }
          nextProducts.unshift(p)
          existing.set(key, p)
          changed.push(p)
          if (categoryOrNull) newCats.push(categoryOrNull)
        }
      }

      setData((prev) => ({ ...prev, products: nextProducts, updatedAt: Date.now() }))

      if (newCats.length > 0) {
        const set = new Set(
          [...categories.map((x) => x.trim()), ...newCats.map((x) => x.trim())].filter(Boolean)
        )
        setCategories(Array.from(set))
      }

      const catSet = new Set(newCats.map((x) => x.trim()).filter(Boolean))
      for (const c of catSet) await upsertCategoryDB(c)

      await upsertProductsBulkDB({
        products: changed.map((p: any) => ({
          id: p.id,
          name: p.name,
          category: p.category ?? null,
          active: p.active ?? true,
          make_enabled: p.makeEnabled ?? true,
          price: p.price ?? 0,
          sku: p.sku ?? null,
          barcode: p.barcode ?? null,
        })),
      })

      toast.success(
        `파일 반영 완료: ${changed.length}건 처리됨` +
          (overwriteMode === "overwrite" ? " (덮어쓰기 포함)" : " (빈 값만 채움)")
      )
      await refresh()
    } catch (e: any) {
      console.error(e)
      setData(prevData)
      setCategories(prevCategories)
      toast.error(`파일 업로드 실패: ${e?.message ?? e}`)
      await refresh()
    } finally {
      setCsvBusy(false)
      if (csvInputRef.current) csvInputRef.current.value = ""
    }
  },
  [data, categories, refresh]
)

const handleProductCsvFile = useCallback(
  async (file: File) => {
    const text = await file.text()
    const rows = parseSimpleCSV(text)
    // ✅ 엑셀 과학적 표기/손상 간단 감지 (barcode/SKU)
const suspicious = rows.filter((r) => {
  const sku = String(r.sku ?? "").trim()
  const bc = String(r.barcode ?? "").trim()
  // e+12 형태 or 소수점이 섞이면 엑셀 숫자 변환 가능성 높음
  return /e\+?\d+/i.test(sku) || /e\+?\d+/i.test(bc) || sku.includes(".") || bc.includes(".")
})

if (suspicious.length > 0) {
  toast.error(
    "바코드/SKU가 엑셀에서 숫자로 변환된 것 같아요. (예: 8.8E+12) 텍스트 형식으로 저장 후 다시 업로드해 주세요."
  )
  // 경고만 띄우고 진행 (차단하고 싶으면 아래 return 주석 해제)
  // return
}

    const cleaned: ProductCsvRow[] = rows
      .map((r) => ({
        category: (r.category ?? "").trim(),
        name: (r.name ?? "").trim(),
        active: r.active,
        price: r.price ?? null,
        sku: r.sku ?? null,
        barcode: r.barcode ?? null,
      }))
      .filter((r) => r.name.length > 0)

    if (cleaned.length === 0) {
      toast.error("업로드할 제품이 없습니다. (name이 비어있으면 무시됩니다)")
      return
    }

    const byKey = new Map<string, ProductCsvRow>()
    for (const r of cleaned) {
      const key = `${normalizeCategoryKey(r.category)}||${normalizeNameKey(r.name)}`
      byKey.set(key, r)
    }
    const uniqueRows: ProductCsvRow[] = Array.from(byKey.values())

    const existing = new Map<string, any>()
    for (const p of data.products) {
      const key = `${normalizeCategoryKey(p.category)}||${normalizeNameKey(p.name)}`
      existing.set(key, p)
    }

    const conflicts: ProductCsvConflict[] = []

    for (const r of uniqueRows) {
      const catTrim = (r.category ?? "").trim()
      const categoryOrNull = catTrim === "" ? null : catTrim
      const key = `${normalizeCategoryKey(categoryOrNull ?? "")}||${normalizeNameKey(r.name)}`
      const hit = existing.get(key)
      if (!hit) continue

      if (typeof r.active === "boolean" && differsCsvValue(Boolean(hit.active), Boolean(r.active))) {
        conflicts.push({ key, name: r.name, field: "active", oldV: hit.active, newV: r.active })
      }

      if (r.price !== null && r.price !== undefined) {
        const oldP = Number(hit.price ?? 0)
        const newP = Number(r.price ?? 0)
        if (Number.isFinite(newP) && oldP !== newP) {
          conflicts.push({ key, name: r.name, field: "price", oldV: hit.price, newV: r.price })
        }
      }

      if (isProvidedCsvValue(r.sku) && isProvidedCsvValue(hit.sku) && differsCsvValue(hit.sku, r.sku)) {
        conflicts.push({ key, name: r.name, field: "sku", oldV: hit.sku, newV: r.sku })
      }

      if (
        isProvidedCsvValue(r.barcode) &&
        isProvidedCsvValue(hit.barcode) &&
        differsCsvValue(hit.barcode, r.barcode)
      ) {
        conflicts.push({ key, name: r.name, field: "barcode", oldV: hit.barcode, newV: r.barcode })
      }
    }

    if (conflicts.length > 0) {
      setCsvConflictInfo({ fileName: file.name, rows: uniqueRows, conflicts })
      return
    }

    await applyCsvProducts(uniqueRows, "overwrite")
  },
  [data.products, applyCsvProducts]
)

const onChangeProductUpload = async (e: ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0]
  if (!file) return

  try {
    setCsvBusy(true)

    const fileName = file.name.toLowerCase()

    let rows: ProductCsvRow[] = []

    if (fileName.endsWith(".csv")) {
      const text = await file.text()
      rows = parseSimpleCSV(text)
    } else if (fileName.endsWith(".xlsx")) {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: "array" })
      const firstSheetName = workbook.SheetNames[0]
      const firstSheet = workbook.Sheets[firstSheetName]

      const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, {
        defval: "",
      })

      rows = jsonRows.map((row) => ({
        category: String(row.category ?? "").trim(),
        name: String(row.name ?? "").trim(),
        active: parseBooleanLike(String(row.active ?? "")),
        price: parseNumberLikeNullable(String(row.price ?? "")),
        sku: String(row.sku ?? "").trim() || null,
        barcode: String(row.barcode ?? "").trim() || null,
      }))

      if (!rows.length) {
        throw new Error("엑셀 첫 번째 시트에 업로드할 데이터가 없어요.")
      }
    } else {
      throw new Error("CSV 또는 XLSX 파일만 업로드 가능합니다.")
    }

    const suspicious = rows.filter((r) => {
      const sku = String(r.sku ?? "").trim()
      const bc = String(r.barcode ?? "").trim()
      return /e\+?\d+/i.test(sku) || /e\+?\d+/i.test(bc) || sku.includes(".") || bc.includes(".")
    })

    if (suspicious.length > 0) {
      toast.error(
        "바코드/SKU가 엑셀에서 숫자로 변환된 것 같아요. (예: 8.8E+12) 텍스트 형식으로 저장 후 다시 업로드해 주세요."
      )
    }

    const cleaned: ProductCsvRow[] = rows
      .map((r) => ({
        category: (r.category ?? "").trim(),
        name: (r.name ?? "").trim(),
        active: r.active,
        price: r.price ?? null,
        sku: r.sku ?? null,
        barcode: r.barcode ?? null,
      }))
      .filter((r) => r.name.length > 0)

    if (cleaned.length === 0) {
      toast.error("업로드할 제품이 없습니다. (name이 비어있으면 무시됩니다)")
      return
    }

    const byKey = new Map<string, ProductCsvRow>()
    for (const r of cleaned) {
      const key = `${normalizeCategoryKey(r.category)}||${normalizeNameKey(r.name)}`
      byKey.set(key, r)
    }
    const uniqueRows: ProductCsvRow[] = Array.from(byKey.values())

    const existing = new Map<string, any>()
    for (const p of data.products) {
      const key = `${normalizeCategoryKey(p.category)}||${normalizeNameKey(p.name)}`
      existing.set(key, p)
    }

    const conflicts: ProductCsvConflict[] = []

    for (const r of uniqueRows) {
      const catTrim = (r.category ?? "").trim()
      const categoryOrNull = catTrim === "" ? null : catTrim
      const key = `${normalizeCategoryKey(categoryOrNull ?? "")}||${normalizeNameKey(r.name)}`
      const hit = existing.get(key)
      if (!hit) continue

      if (typeof r.active === "boolean" && differsCsvValue(Boolean(hit.active), Boolean(r.active))) {
        conflicts.push({ key, name: r.name, field: "active", oldV: hit.active, newV: r.active })
      }

      if (r.price !== null && r.price !== undefined) {
        const oldP = Number(hit.price ?? 0)
        const newP = Number(r.price ?? 0)
        if (Number.isFinite(newP) && oldP !== newP) {
          conflicts.push({ key, name: r.name, field: "price", oldV: hit.price, newV: r.price })
        }
      }

      if (isProvidedCsvValue(r.sku) && isProvidedCsvValue(hit.sku) && differsCsvValue(hit.sku, r.sku)) {
        conflicts.push({ key, name: r.name, field: "sku", oldV: hit.sku, newV: r.sku })
      }

      if (
        isProvidedCsvValue(r.barcode) &&
        isProvidedCsvValue(hit.barcode) &&
        differsCsvValue(hit.barcode, r.barcode)
      ) {
        conflicts.push({ key, name: r.name, field: "barcode", oldV: hit.barcode, newV: r.barcode })
      }
    }

    if (conflicts.length > 0) {
      setCsvConflictInfo({ fileName: file.name, rows: uniqueRows, conflicts })
      return
    }

    await applyCsvProducts(uniqueRows, "overwrite")
  } catch (err: any) {
    toast.error(err?.message ?? "제품 파일 업로드에 실패했어요.")
  } finally {
    setCsvBusy(false)
    if (e.target) e.target.value = ""
  }
}

const resolveProductCsvConflict = useCallback(
  async (mode: "overwrite" | "safe") => {
    if (!csvConflictInfo) return
    const rows = csvConflictInfo.rows
    setCsvConflictInfo(null)
    await applyCsvProducts(rows, mode)
  },
  [csvConflictInfo, applyCsvProducts]
)

const cancelProductCsvConflict = useCallback(() => {
  setCsvConflictInfo(null)
  if (csvInputRef.current) csvInputRef.current.value = ""
}, [])

  // ===== backup/restore (local only) =====
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleBackup = useCallback(async () => {
    try {
      downloadJson("stocknmake-backup.json", data)
      toast.success("백업(JSON) 다운로드 완료")
    } catch (e) {
      console.error(e)
      toast.error("백업 실패")
    }
  }, [data])

  const handleRestore = useCallback(async (file: File) => {
    try {
      const parsed = (await readJsonFile(file)) as Partial<AppData>
      if (!parsed || parsed.schemaVersion !== 1) {
        toast.error("백업 파일 형식이 올바르지 않습니다 (schemaVersion 불일치)")
        return
      }
      const next: AppData = {
        schemaVersion: 1,
        products: parsed.products ?? [],
        stores: parsed.stores ?? [],
        inventory: parsed.inventory ?? [],
        storeProductStates: parsed.storeProductStates ?? [],
        settlements: parsed.settlements ?? [],
        settlementsV2: parsed.settlementsV2 ?? [], // ✅ 추가
        plans: parsed.plans ?? [],
        updatedAt: Date.now(),
      }
      setData(next)
      toast.success("복구(로컬 반영) 완료")
    } catch {
      toast.error("복구 실패: JSON 파일을 읽을 수 없습니다")
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }, [])

  const saveDefaultTargetQty = useCallback(async () => {
    const val =
      defaultTargetQtyInput.trim() === ""
        ? 0
        : Math.max(0, parseInt(defaultTargetQtyInput, 10) || 0)
    setDefaultTargetQtyInput(String(val))
    try {
      setProfileSaving(true)
      await updateMyDefaultTargetQty(val)
      toast.success("재고 기준을 저장했어요.")
    } catch {
      toast.error("저장에 실패했어요.")
    } finally {
      setProfileSaving(false)
    }
  }, [defaultTargetQtyInput])

  const saveLowStockThreshold = useCallback(async () => {
    const val =
      lowStockThresholdInput.trim() === ""
        ? 0
        : Math.max(0, parseInt(lowStockThresholdInput, 10) || 0)
    setLowStockThresholdInput(String(val))
    try {
      setProfileSaving(true)
      await updateMyLowStockThreshold(val)
      toast.success("재고 기준을 저장했어요.")
    } catch {
      toast.error("저장에 실패했어요.")
    } finally {
      setProfileSaving(false)
    }
  }, [lowStockThresholdInput])

  return {
    data,
    setData,
    loading,
    errorMsg,
    refresh,

    // profile
    profileLoading,
    profileSaving,
    defaultTargetQtyInput,
    setDefaultTargetQtyInput,
    lowStockThresholdInput,
    setLowStockThresholdInput,
    saveDefaultTargetQty,
    saveLowStockThreshold,

    // categories
    categories,
    categoryOptions,
    newCategory,
    setNewCategory,
    categoryTyped,
    setCategoryTyped,
    categoryOpen,
    setCategoryOpen,
    deleteCategory,
    saveCategoryOnly,
    saveProductCategoryOnly,

    // products
    newProductName,
    setNewProductName,
    addProduct,
    deleteProduct,
    toggleProductActiveFlip,
    toggleProductMakeEnabledFlip,
    saveProductFieldsSimple,
    saveProductFieldsExtended,
    editingProductId,
    setEditingProductId,
    editingProductName,
    setEditingProductName,
    editingOriginalRef,
    editingProductCategory,
    setEditingProductCategory,
    editingOriginalCategoryRef,

    // stores
    newStoreName,
    setNewStoreName,
    addStore,
    deleteStore,
    toggleOne,
    toggleAll,
    newStoreCommissionInput,
    setNewStoreCommissionInput,
    newStoreMemo,
    setNewStoreMemo,
    createStoreWithFields,

    // csv
    csvInputRef,
    csvBusy,
    csvConflictInfo,
    handleProductCsvUpload,
    onChangeProductUpload,
    resolveProductCsvConflict,
    cancelProductCsvConflict,

    // backup/restore
    fileInputRef,
    handleBackup,
    handleRestore,

    newStoreTargetQtyInput,
    setNewStoreTargetQtyInput,
    newStoreContactName,
    setNewStoreContactName,
    newStorePhone,
    setNewStorePhone,
    newStoreAddress,
    setNewStoreAddress,

saveStoreFields,
  }
}
