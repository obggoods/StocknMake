import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import * as XLSX from "xlsx"

import PageHeader from "@/app/layout/PageHeader"
import { useAppData } from "@/features/core/useAppData"
import { upsertInventoryItemDB, upsertInventoryItemsBatchDB } from "@/data/store.supabase"

import { AppButton } from "@/components/app/AppButton"
import { AppCard } from "@/components/app/AppCard"
import { AppSelect } from "@/components/app/AppSelect"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorState } from "@/components/shared/ErrorState"
import { Skeleton } from "@/components/shared/Skeleton"
import { toast } from "@/lib/toast"

function num(n: unknown, fallback = 0) {
  const v = typeof n === "number" ? n : Number(n)
  return Number.isFinite(v) ? v : fallback
}

function toKey(v: unknown) {
  return String(v ?? "")
}

function safeFilename(name: string) {
  return String(name ?? "").replace(/[\\/:*?"<>|]/g, "_").trim()
}

function escapeCsvCell(v: unknown) {
  const s = String(v ?? "")
  if (/^[=+\-@]/.test(s)) return `'${s}`
  return s
}

function escapeExcelCell(v: unknown) {
  const s = String(v ?? "")
  return /^[=+\-@]/.test(s) ? `'${s}` : s
}

function safeSheetName(name: string) {
  const cleaned = String(name ?? "시트")
    .replace(/[\\\/:*?\[\]]/g, "_")
    .trim()

  return cleaned.slice(0, 31) || "시트"
}

function parseSimpleCSV(text: string) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0)

  if (!lines.length) return []

  return lines.map((line) => {
    const out: string[] = []
    let cur = ""
    let inQuotes = false

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = !inQuotes
        }
        continue
      }

      if (ch === "," && !inQuotes) {
        out.push(cur)
        cur = ""
        continue
      }

      cur += ch
    }

    out.push(cur)
    return out.map((v) => v.trim())
  })
}

function normalizeHeader(v: string) {
  return String(v ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
}

function getCell(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") {
      return String(row[key]).trim()
    }
  }
  return ""
}

function readFileAsTextWithEncoding(file: File, encoding?: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했습니다."))

    if (encoding) {
      reader.readAsText(file, encoding)
    } else {
      reader.readAsText(file)
    }
  })
}

async function readCsvFileText(file: File) {
  const utf8Text = await readFileAsTextWithEncoding(file)

  const looksBroken =
    utf8Text.includes("�") ||
    /[Ã¦Â°Â¸Â·]/.test(utf8Text)

  if (!looksBroken) return utf8Text

  try {
    const eucKrText = await readFileAsTextWithEncoding(file, "euc-kr")
    return eucKrText
  } catch {
    return utf8Text
  }
}

async function readInventoryUploadRows(file: File) {
  const lowerName = String(file.name ?? "").toLowerCase()

  // CSV
  if (lowerName.endsWith(".csv")) {
    const text = await readCsvFileText(file)
    const rows = parseSimpleCSV(text)

    if (rows.length < 2) return []

    const header = rows[0].map((h) => normalizeHeader(h))
    const body = rows.slice(1)

    return body.map((cols) => {
      const obj: Record<string, string> = {}
      header.forEach((h, i) => {
        obj[h] = String(cols[i] ?? "").trim()
      })
      return obj
    })
  }

  // XLSX / XLS
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: "array" })

    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) return []

    const sheet = workbook.Sheets[firstSheetName]
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
    })

    return jsonRows.map((row) => {
      const normalized: Record<string, string> = {}
      for (const [key, value] of Object.entries(row)) {
        normalized[normalizeHeader(key)] = String(value ?? "").trim()
      }
      return normalized
    })
  }

  throw new Error("지원하지 않는 파일 형식입니다.")
}

function downloadCSV(filename: string, rows: string[][]) {
  const csvContent = rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n")

  const BOM = "\uFEFF"
  const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)

  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

type InventoryUploadSkippedRow = {
  rowIndex: number
  category: string
  name: string
  sku: string
  qtyRaw: string
  reason: string
}

export default function InventoryPage() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()

  const a = useAppData()
  const data = a.data

  const loading = a.loading
  const errorMsg = a.errorMsg

  const stores = (data.stores ?? []) as any[]
  const products = (data.products ?? []) as any[]
  const inventory = (data.inventory ?? []) as any[] // { storeId, productId, onHandQty }
  const storeProductStates = (data.storeProductStates ?? []) as any[] // { storeId, productId, enabled }

  // ✅ 탭: querystring으로 초기화 (dashboard 버튼에서 바로 열기)
  const initialTab = (sp.get("tab") ?? "inventory") as "inventory" | "make"
  const [tab, setTab] = useState<"inventory" | "make">(initialTab === "make" ? "make" : "inventory")

  useEffect(() => {
    const q = sp.get("tab")
    if (q === "make") setTab("make")
    if (q === "inventory") setTab("inventory")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [selectedStoreId, setSelectedStoreId] = useState<string>("__all__")
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__")
  const [qtySort, setQtySort] = useState<"none" | "asc" | "desc">("none")
  const [onlyLowStock, setOnlyLowStock] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")

  const [makeViewMode, setMakeViewMode] = useState<"store" | "total">("store")
  const [csvUploading, setCsvUploading] = useState(false)
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  const [csvUploadMode, setCsvUploadMode] = useState<"replace" | "add">("add")
  const [csvPreviewOpen, setCsvPreviewOpen] = useState(false)
  const [csvPendingRows, setCsvPendingRows] = useState<
    Array<{
      storeId: string
      productId: string
      onHandQty: number
      inputQty: number
      existingQty: number
      nextQtyReplace: number
      nextQtyAdd: number
      name: string
      category: string
    }>
  >([])
  const [csvSkippedCount, setCsvSkippedCount] = useState(0)
  const [csvSelectedFileName, setCsvSelectedFileName] = useState("")
  const [csvSkippedRows, setCsvSkippedRows] = useState<InventoryUploadSkippedRow[]>([])

  const storeOptions = useMemo(() => {
    const base = [{ label: "전체", value: "__all__" }]
    const mapped = stores
      .map((s: any) => ({ label: String(s?.name ?? "입점처"), value: String(s?.id ?? "") }))
      .filter((x) => x.value)
    return [...base, ...mapped]
  }, [stores])

  const storeById = useMemo(() => new Map<string, any>(stores.map((s: any) => [String(s.id), s])), [stores])
  const selectedStoreName = useMemo(() => {
    if (selectedStoreId === "__all__") return ""
    return String(storeById.get(String(selectedStoreId))?.name ?? "").trim()
  }, [selectedStoreId, storeById])

  // ===== 목표 재고 =====
  const targetQty = useMemo(() => {
    const v = Number.parseInt(String(a.defaultTargetQtyInput ?? "5").trim(), 10)
    return Number.isFinite(v) ? Math.max(0, v) : 5
  }, [a.defaultTargetQtyInput])

  const effectiveTargetQty = useMemo(() => {
    if (selectedStoreId === "__all__") return targetQty
    const store = storeById.get(String(selectedStoreId))
    const override = Number(store?.targetQtyOverride)
    if (Number.isFinite(override) && override > 0) return override
    return targetQty
  }, [selectedStoreId, storeById, targetQty])

  const isTargetOverrideActive = useMemo(() => {
    if (selectedStoreId === "__all__") return false
    const store = storeById.get(String(selectedStoreId))
    const override = Number(store?.targetQtyOverride)
    return Number.isFinite(override) && override > 0 && override !== targetQty
  }, [selectedStoreId, storeById, targetQty])

  const targetQtyLabel = useMemo(() => {
    if (selectedStoreId === "__all__") return `${effectiveTargetQty}`
    return isTargetOverrideActive ? `${effectiveTargetQty} (override)` : `${effectiveTargetQty}`
  }, [selectedStoreId, effectiveTargetQty, isTargetOverrideActive])

  // ===== 제품명/카테고리 맵 =====
  const productNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products) m.set(String(p.id), String(p.name ?? "제품"))
    return m
  }, [products])

  const productCategoryById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products) m.set(String(p.id), String(p.category ?? "").trim())
    return m
  }, [products])

  const productById = useMemo(() => {
    const m = new Map<string, any>()
    for (const p of products) m.set(String(p.id), p)
    return m
  }, [products])

  const productIdsEnabledByStore = useMemo(() => {
    const allProductIds = products.map((p: any) => String(p.id))
    const map = new Map<string, Set<string>>()

    for (const s of stores) {
      map.set(String(s.id), new Set(allProductIds))
    }

    if (storeProductStates.length === 0) return map

    const statesByStore = new Map<string, any[]>()
    for (const sp of storeProductStates) {
      const sid = String(sp.storeId)
      if (!statesByStore.has(sid)) statesByStore.set(sid, [])
      statesByStore.get(sid)?.push(sp)
    }

    for (const [sid, rows] of statesByStore.entries()) {
      const hasAnyEnabled = rows.some((r) => Boolean(r?.enabled))
      if (!hasAnyEnabled) continue

      const enabledSet = new Set<string>()
      for (const row of rows) {
        if (row?.enabled) enabledSet.add(String(row.productId))
      }
      map.set(sid, enabledSet)
    }

    return map
  }, [storeProductStates, stores, products])

  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      const c = String(p.category ?? "").trim()
      if (c) set.add(c)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [products])

  const normalizedSearchTerm = useMemo(() => {
    return searchTerm.trim().toLowerCase()
  }, [searchTerm])

  const selectedStoreTemplateRows = useMemo(() => {
    if (selectedStoreId === "__all__") return []

    const enabledSet =
      productIdsEnabledByStore.get(String(selectedStoreId)) ??
      new Set(products.map((p: any) => String(p.id)))

    return products
      .filter((p: any) => enabledSet.has(String(p.id)))
      .map((p: any) => ({
        category: String(p.category ?? "").trim() || "",
        name: String(p.name ?? "").trim() || "",
        qty: "",
      }))
      .sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category)
        return a.name.localeCompare(b.name)
      })
  }, [selectedStoreId, productIdsEnabledByStore, products])

  // ===== 저재고 임계치 =====
  const lowStockThreshold = useMemo(() => {
    const v = Number.parseInt(String(a.lowStockThresholdInput ?? "2").trim(), 10)
    return Number.isFinite(v) ? Math.max(0, v) : 2
  }, [a.lowStockThresholdInput])

  // ===== 취급 ON + 0재고 포함 확장 inventory =====
  const expandedInventory = useMemo(() => {
    const invByKey = new Map<string, any>()
    for (const it of inventory) {
      const key = `${String(it.storeId)}__${String(it.productId)}`
      invByKey.set(key, it)
    }

    const targetStores =
      selectedStoreId === "__all__" ? stores.map((s) => String(s.id)) : [String(selectedStoreId)]

    const out: any[] = []
    for (const sid of targetStores) {
      const enabledSet =
        productIdsEnabledByStore.get(sid) ?? new Set(products.map((p: any) => String(p.id)))

      for (const pid of enabledSet) {
        const key = `${sid}__${pid}`
        const inv = invByKey.get(key)
        out.push(inv ?? { storeId: sid, productId: pid, onHandQty: 0 })
      }
    }

    return out
  }, [inventory, stores, products, selectedStoreId, productIdsEnabledByStore])

  // ===== 필터 적용 (카테고리 / 저재고) =====
  const filteredInventory = useMemo(() => {
    let base = expandedInventory

    if (categoryFilter !== "__all__") {
      base = base.filter(
        (it: any) => (productCategoryById.get(String(it.productId)) ?? "") === categoryFilter
      )
    }

    if (normalizedSearchTerm) {
      base = base.filter((it: any) => {
        const productName = String(productNameById.get(String(it.productId)) ?? "").toLowerCase()
        const category = String(productCategoryById.get(String(it.productId)) ?? "").toLowerCase()

        return (
          productName.includes(normalizedSearchTerm) ||
          category.includes(normalizedSearchTerm)
        )
      })
    }

    if (onlyLowStock) {
      base = base.filter((it: any) => num(it.onHandQty, 0) < lowStockThreshold)
    }

    return base
  }, [
    expandedInventory,
    categoryFilter,
    productCategoryById,
    productNameById,
    normalizedSearchTerm,
    onlyLowStock,
    lowStockThreshold,
  ])

  const sortedInventoryRows = useMemo(() => {
    const arr = [...filteredInventory]

    if (qtySort === "none") {
      arr.sort((a: any, b: any) => {
        const storeA = storeById.get(String(a.storeId))?.name ?? ""
        const storeB = storeById.get(String(b.storeId))?.name ?? ""

        if (selectedStoreId === "__all__") {
          if (storeA !== storeB) return storeA.localeCompare(storeB)
        }

        const catA = productCategoryById.get(String(a.productId)) ?? ""
        const catB = productCategoryById.get(String(b.productId)) ?? ""
        if (catA !== catB) return catA.localeCompare(catB)

        const nameA = productNameById.get(String(a.productId)) ?? ""
        const nameB = productNameById.get(String(b.productId)) ?? ""
        return nameA.localeCompare(nameB)
      })
      return arr
    }

    arr.sort((a: any, b: any) => {
      const qa = num(a.onHandQty, 0)
      const qb = num(b.onHandQty, 0)
      if (qa !== qb) return qtySort === "asc" ? qa - qb : qb - qa

      const nameA = productNameById.get(String(a.productId)) ?? ""
      const nameB = productNameById.get(String(b.productId)) ?? ""
      return nameA.localeCompare(nameB)
    })

    return arr
  }, [filteredInventory, qtySort, selectedStoreId, storeById, productCategoryById, productNameById])

  // 제작 리스트(need 큰 순)
  const makeRows = useMemo(() => {
    return filteredInventory
      .map((it: any) => {
        const onHand = num(it.onHandQty, 0)
        const need = Math.max(0, effectiveTargetQty - onHand)
        return { it, need }
      })
      .filter((x) => x.need > 0)
      .sort((a, b) => b.need - a.need)
  }, [filteredInventory, effectiveTargetQty])

  const makeNeededTotal = useMemo(() => {
    return filteredInventory.reduce((acc: number, it: any) => {
      const onHand = num(it.onHandQty, 0)
      return acc + Math.max(0, effectiveTargetQty - onHand)
    }, 0)
  }, [filteredInventory, effectiveTargetQty])

  const makeRowsTotal = useMemo(() => {
    const byProduct = new Map<
      string,
      {
        productId: string
        need: number
        category: string
        name: string
      }
    >()

    for (const s of stores) {
      const sid = String(s.id)
      const enabledSet = productIdsEnabledByStore.get(sid) ?? new Set<string>()

      for (const pid of enabledSet) {
        const inv = inventory.find(
          (x: any) => String(x.storeId) === sid && String(x.productId) === pid
        )
        const onHand = num(inv?.onHandQty, 0)

        const store = storeById.get(sid)
        const override = Number(store?.targetQtyOverride)
        const target =
          Number.isFinite(override) && override > 0 ? override : targetQty

        const need = Math.max(0, target - onHand)
        if (need <= 0) continue

        const p = productById.get(pid)
        const category = String(p?.category ?? "").trim() || "-"
        const name = String(p?.name ?? "제품")

        const prev = byProduct.get(pid)
        if (prev) {
          prev.need += need
        } else {
          byProduct.set(pid, {
            productId: pid,
            need,
            category,
            name,
          })
        }
      }
    }

    const arr = Array.from(byProduct.values())

    if (categoryFilter !== "__all__") {
      return arr
        .filter((x) => x.category === categoryFilter)
        .sort((a, b) => {
          if (b.need !== a.need) return b.need - a.need
          return a.name.localeCompare(b.name)
        })
    }

    return arr.sort((a, b) => {
      if (b.need !== a.need) return b.need - a.need
      if (a.category !== b.category) return a.category.localeCompare(b.category)
      return a.name.localeCompare(b.name)
    })
  }, [stores, productIdsEnabledByStore, inventory, storeById, targetQty, productById, categoryFilter])

  const makeNeededTotalAllStores = useMemo(() => {
    return makeRowsTotal.reduce((acc, row) => acc + row.need, 0)
  }, [makeRowsTotal])

  // ===== 입력 저장 (Optimistic + debounce) =====
  const qtyInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const saveTimersRef = useRef<Record<string, number>>({})

  useEffect(() => {
    return () => {
      const timers = saveTimersRef.current
      for (const k of Object.keys(timers)) window.clearTimeout(timers[k])
      saveTimersRef.current = {}
    }
  }, [])

  const setQtyLocal = useCallback(
    (storeId: string, productId: string, nextQty: number) => {
      a.setData((prev) => {
        const inv = prev.inventory ?? []
        const idx = inv.findIndex((x: any) => String(x.storeId) === storeId && String(x.productId) === productId)

        const nextInv =
          idx >= 0
            ? inv.map((x: any, i: number) => (i === idx ? { ...x, onHandQty: nextQty, updatedAt: Date.now() } : x))
            : [{ storeId, productId, onHandQty: nextQty, updatedAt: Date.now() }, ...inv]

        return { ...prev, inventory: nextInv, updatedAt: Date.now() }
      })
    },
    [a]
  )

  const scheduleSaveQty = useCallback(
    (storeId: string, productId: string, nextQty: number) => {
      const key = `${storeId}__${productId}`

      const prevTimer = saveTimersRef.current[key]
      if (prevTimer) window.clearTimeout(prevTimer)

      saveTimersRef.current[key] = window.setTimeout(async () => {
        try {
          await upsertInventoryItemDB({ storeId, productId, onHandQty: nextQty })
        } catch (e) {
          console.error(e)
          toast.error("재고 저장에 실패했어요.")
          await a.refresh()
        }
      }, 500)
    },
    [a]
  )

  const moveFocus = useCallback((fromIndex: number, dir: -1 | 1) => {
    const next = fromIndex + dir
    const el = qtyInputRefs.current[next]
    if (el) el.focus()
  }, [])

  // ===== CSV Export =====
  const exportInventoryWorkbook = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    const workbook = XLSX.utils.book_new()

    const buildInventorySheetRows = (rows: any[]) => {
      return rows.map((it) => {
        const storeName = storeById.get(String(it.storeId))?.name ?? "-"
        const productName = productNameById.get(String(it.productId)) ?? "제품"
        const category = productCategoryById.get(String(it.productId)) ?? "-"

        return {
          입점처: escapeExcelCell(storeName),
          카테고리: escapeExcelCell(category || "-"),
          제품: escapeExcelCell(productName),
          현재_재고: num(it.onHandQty, 0),
        }
      })
    }

    // 1) 전체 재고 시트
    const allRows = buildInventorySheetRows(sortedInventoryRows)
    const allSheet = XLSX.utils.json_to_sheet(allRows)
    allSheet["!cols"] = [
      { wch: 22 },
      { wch: 16 },
      { wch: 24 },
      { wch: 12 },
    ]
    XLSX.utils.book_append_sheet(workbook, allSheet, safeSheetName("전체 재고"))

    // 2) 입점처별 시트
    const targetStoreIds =
      selectedStoreId === "__all__"
        ? stores.map((s: any) => String(s.id))
        : [String(selectedStoreId)]

    for (const sid of targetStoreIds) {
      const storeName = String(storeById.get(sid)?.name ?? "입점처")
      const storeRows = sortedInventoryRows.filter(
        (it: any) => String(it.storeId) === sid
      )

      const sheetRows = storeRows.map((it: any) => {
        const productName = productNameById.get(String(it.productId)) ?? "제품"
        const category = productCategoryById.get(String(it.productId)) ?? "-"

        return {
          카테고리: escapeExcelCell(category || "-"),
          제품: escapeExcelCell(productName),
          현재_재고: num(it.onHandQty, 0),
        }
      })

      const sheet = XLSX.utils.json_to_sheet(sheetRows)
      sheet["!cols"] = [
        { wch: 16 },
        { wch: 24 },
        { wch: 12 },
      ]

      XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(storeName))
    }

    const scopeName =
      selectedStoreId === "__all__"
        ? "전체"
        : safeFilename(String(storeById.get(String(selectedStoreId))?.name ?? "입점처"))

    XLSX.writeFile(workbook, `StocknMake_재고현황_${scopeName}_${today}.xlsx`)
  }, [
    sortedInventoryRows,
    selectedStoreId,
    stores,
    storeById,
    productNameById,
    productCategoryById,
  ])

    const exportMakeWorkbook = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)

    const workbook = XLSX.utils.book_new()

    // 1) 전체 통합 시트
    const totalRows = makeRowsTotal.map((row) => ({
      카테고리: escapeExcelCell(row.category),
      제품: escapeExcelCell(row.name),
      총_필요_수량: row.need,
    }))

    const totalSheet = XLSX.utils.json_to_sheet(totalRows)
totalSheet["!cols"] = [
  { wch: 16 },
  { wch: 24 },
  { wch: 14 },
]
XLSX.utils.book_append_sheet(workbook, totalSheet, safeSheetName("전체 통합"))

    // 2) 입점처별 시트
    const rowsByStore = new Map<string, Array<Record<string, unknown>>>()

    for (const { it, need } of makeRows as any[]) {
      const sid = String(it.storeId)
      const storeName = String(storeById.get(sid)?.name ?? "입점처")
      const pName = productNameById.get(String(it.productId)) ?? "제품"
      const cat = productCategoryById.get(String(it.productId)) ?? "-"
      const onHand = num(it.onHandQty, 0)

      const store = storeById.get(sid)
      const override = Number(store?.targetQtyOverride)
      const target =
        Number.isFinite(override) && override > 0 ? override : targetQty

      if (!rowsByStore.has(storeName)) rowsByStore.set(storeName, [])

      rowsByStore.get(storeName)?.push({
        카테고리: escapeExcelCell(cat || "-"),
        제품: escapeExcelCell(pName),
        현재_재고: onHand,
        목표_재고: target,
        필요_수량: need,
      })
    }

    for (const [storeName, rows] of rowsByStore.entries()) {
      const sheet = XLSX.utils.json_to_sheet(rows)
sheet["!cols"] = [
  { wch: 16 },
  { wch: 24 },
  { wch: 12 },
  { wch: 12 },
  { wch: 12 },
]
XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(storeName))
    }

    XLSX.writeFile(workbook, `StocknMake_제작리스트_${today}.xlsx`)
  }, [
    makeRowsTotal,
    makeRows,
    storeById,
    productNameById,
    productCategoryById,
    targetQty,
  ])

  const downloadInventoryUploadTemplate = useCallback(() => {
    const workbook = XLSX.utils.book_new()

    // 1) 실제 입력용 시트
    const templateRows = [
      {
        category: "겨울 버튼 키링",
        name: "낮의금붕어",
        qty: 10,
      },
      {
        category: "스크런치",
        name: "브릭레드",
        qty: 5,
      },
    ]

    const templateSheet = XLSX.utils.json_to_sheet(templateRows)
    templateSheet["!cols"] = [
      { wch: 22 },
      { wch: 24 },
      { wch: 12 },
    ]

    XLSX.utils.book_append_sheet(
      workbook,
      templateSheet,
      safeSheetName("재고 업로드 템플릿")
    )

    // 2) 작성 안내 시트
    const guideRows = [
      { 항목: "입점처 선택", 안내: "업로드 전에 화면에서 입점처를 먼저 선택해 주세요." },
      { 항목: "category", 안내: "선택 입력입니다. 제품명이 중복될 수 있으면 같이 입력하는 것이 안전합니다." },
      { 항목: "name", 안내: "제품명과 정확히 일치해야 합니다." },
      { 항목: "qty", 안내: "반영할 수량입니다. 업로드 확인 모달에서 덮어쓰기 또는 추가 반영을 선택합니다." },
      { 항목: "sku", 안내: "선택 입력입니다. SKU가 있으면 제품 매칭이 더 정확해집니다." },
      { 항목: "주의 1", 안내: "같은 파일을 추가 반영 모드로 여러 번 업로드하면 수량이 중복 반영될 수 있습니다." },
      { 항목: "주의 2", 안내: "첫 번째 시트의 헤더(category, name, qty 또는 sku)는 변경하지 않는 것을 권장합니다." },
      { 항목: "지원 형식", 안내: "업로드는 CSV, XLSX, XLS 형식을 지원합니다. 첫 번째 시트를 기준으로 읽습니다." },
    ]

    const guideSheet = XLSX.utils.json_to_sheet(guideRows)
    guideSheet["!cols"] = [
      { wch: 16 },
      { wch: 88 },
    ]

    XLSX.utils.book_append_sheet(
      workbook,
      guideSheet,
      safeSheetName("작성 안내")
    )

    XLSX.writeFile(workbook, "StocknMake_입점처재고업로드_템플릿.xlsx")
  }, [])

  const downloadStoreSpecificInventoryTemplate = useCallback(() => {
    if (selectedStoreId === "__all__" || !selectedStoreName) {
      toast.error("입점처를 먼저 선택해 주세요.")
      return
    }

    const workbook = XLSX.utils.book_new()

    // 1) 실제 입력용 시트
    const templateRows =
      selectedStoreTemplateRows.length > 0
        ? selectedStoreTemplateRows
        : [{ category: "", name: "", qty: "" }]

    const templateSheet = XLSX.utils.json_to_sheet(templateRows)
    templateSheet["!cols"] = [
      { wch: 22 },
      { wch: 24 },
      { wch: 12 },
    ]

    XLSX.utils.book_append_sheet(
      workbook,
      templateSheet,
      safeSheetName(`${selectedStoreName} 템플릿`)
    )

    // 2) 작성 안내 시트
    const guideRows = [
      { 항목: "입점처", 안내: `${selectedStoreName} 전용 맞춤 템플릿입니다.` },
      { 항목: "구성 방식", 안내: "현재 선택한 입점처에서 취급하는 제품만 템플릿에 미리 채워집니다." },
      { 항목: "category", 안내: "제품 카테고리입니다. 가능하면 수정하지 않는 것을 권장합니다." },
      { 항목: "name", 안내: "제품명입니다. 가능하면 수정하지 않는 것을 권장합니다." },
      { 항목: "qty", 안내: "반영할 수량만 입력해 주세요." },
      { 항목: "반영 방식", 안내: "업로드 후 모달에서 현재 재고에 추가 또는 덮어쓰기를 선택할 수 있습니다." },
      { 항목: "지원 형식", 안내: "업로드는 CSV, XLSX, XLS 형식을 지원하며 첫 번째 시트를 기준으로 읽습니다." },
      { 항목: "주의", 안내: "같은 파일을 추가 반영 모드로 여러 번 업로드하면 수량이 중복 반영될 수 있습니다." },
    ]

    const guideSheet = XLSX.utils.json_to_sheet(guideRows)
    guideSheet["!cols"] = [
      { wch: 16 },
      { wch: 88 },
    ]

    XLSX.utils.book_append_sheet(
      workbook,
      guideSheet,
      safeSheetName("작성 안내")
    )

    XLSX.writeFile(
      workbook,
      `StocknMake_${safeFilename(selectedStoreName)}_맞춤_재고업로드_템플릿.xlsx`
    )
  }, [selectedStoreId, selectedStoreName, selectedStoreTemplateRows])

  const handleInventoryCsvUpload = useCallback(
    async (file: File) => {
      if (selectedStoreId === "__all__") {
        toast.error("재고 업로드 전 입점처를 먼저 선택해 주세요.")
        return
      }

      try {
        setCsvUploading(true)
        setCsvSelectedFileName(file.name)

        const mappedRows = await readInventoryUploadRows(file)

if (mappedRows.length < 1) {
  toast.error("업로드할 데이터가 없습니다.")
  return
}

        const enabledSet =
          productIdsEnabledByStore.get(String(selectedStoreId)) ??
          new Set(products.map((p: any) => String(p.id)))

        const previewRows: Array<{
          storeId: string
          productId: string
          onHandQty: number
          inputQty: number
          existingQty: number
          nextQtyReplace: number
          nextQtyAdd: number
          name: string
          category: string
        }> = []

        let skipped = 0
        const skippedRows: InventoryUploadSkippedRow[] = []

        for (const row of mappedRows) {
          const category = getCell(row, ["category", "카테고리"])
          const name = getCell(row, ["name", "productname", "제품명"])
          const sku = getCell(row, ["sku"])
          const qtyRaw = getCell(row, ["qty", "수량", "재고수량", "onhandqty"])

          const inputQty = Math.max(0, Math.floor(Number(qtyRaw || 0)))

          if ((!name && !sku) || inputQty < 0) {
            skipped += 1
            skippedRows.push({
              rowIndex: skipped + previewRows.length,
              category,
              name,
              sku,
              qtyRaw,
              reason: !name && !sku ? "제품명 또는 SKU가 필요합니다." : "수량 값이 올바르지 않습니다.",
            })
            continue
          }

          let candidates = products.filter((p: any) => enabledSet.has(String(p.id)))

          if (sku) {
            candidates = candidates.filter(
              (p: any) => String(p.sku ?? "").trim() === sku
            )
          } else {
            candidates = candidates.filter(
              (p: any) => String(p.name ?? "").trim() === name
            )
          }

          if (category) {
            candidates = candidates.filter(
              (p: any) => String(p.category ?? "").trim() === category
            )
          }

          if (candidates.length !== 1) {
            console.log("CSV row skipped:", {
              row,
              category,
              name,
              sku,
              qtyRaw,
              candidates,
            })

            let reason = "제품 매칭 실패"
            if (candidates.length === 0) {
              reason = "일치하는 제품이 없습니다."
            } else if (candidates.length > 1) {
              reason = "여러 제품이 매칭되어 반영할 수 없습니다."
            }

            skipped += 1
            skippedRows.push({
              rowIndex: skipped + previewRows.length,
              category,
              name,
              sku,
              qtyRaw,
              reason,
            })
            continue
          }

          const product = candidates[0]
          const productId = String(product.id)

          const existingInv = inventory.find(
            (x: any) =>
              String(x.storeId) === String(selectedStoreId) &&
              String(x.productId) === productId
          )

          const existingQty = num(existingInv?.onHandQty, 0)

          previewRows.push({
            storeId: String(selectedStoreId),
            productId,
            onHandQty: inputQty,
            inputQty,
            existingQty,
            nextQtyReplace: inputQty,
            nextQtyAdd: existingQty + inputQty,
            name: String(product.name ?? "제품"),
            category: String(product.category ?? "").trim() || "-",
          })
        }

        if (!previewRows.length) {
          console.log("CSV mappedRows:", mappedRows)
          console.log("selectedStoreId:", selectedStoreId)
          console.log("enabled product ids:", Array.from(enabledSet))
          toast.error("업로드 가능한 행이 없습니다. 제품명/카테고리/SKU/입점처 상태를 확인해 주세요.")
          return
        }

        setCsvPendingRows(previewRows)
        setCsvSkippedCount(skipped)
        setCsvSkippedRows(skippedRows)
        setCsvUploadMode("add")
        setCsvPreviewOpen(true)
      } catch (e) {
        console.error("inventory csv upload error:", e)
        toast.error("재고 CSV 업로드에 실패했어요.")
      } finally {
        setCsvUploading(false)
        if (csvInputRef.current) csvInputRef.current.value = ""
      }
    },
    [selectedStoreId, productIdsEnabledByStore, products, inventory]
  )

  const confirmInventoryCsvUpload = useCallback(async () => {
    if (!csvPendingRows.length) {
      toast.error("반영할 데이터가 없습니다.")
      return
    }

    try {
      setCsvUploading(true)

      const items = csvPendingRows.map((row) => ({
        storeId: row.storeId,
        productId: row.productId,
        onHandQty: csvUploadMode === "replace" ? row.nextQtyReplace : row.nextQtyAdd,
      }))

      await upsertInventoryItemsBatchDB(items)
      await a.refresh()

      toast.success(
        `재고 ${items.length}건 반영 완료${csvSkippedCount > 0 ? ` / ${csvSkippedCount}건 건너뜀` : ""}`
      )

      setCsvPreviewOpen(false)
      setCsvPendingRows([])
      setCsvSkippedCount(0)
      setCsvSkippedRows([])
      setCsvSelectedFileName("")
    } catch (e) {
      console.error("inventory csv confirm error:", e)
      toast.error("재고 반영에 실패했어요.")
    } finally {
      setCsvUploading(false)
    }
  }, [csvPendingRows, csvUploadMode, csvSkippedCount, a])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-[240px]" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-80" />
      </div>
    )
  }

  if (errorMsg) {
    return <ErrorState title="재고를 불러오지 못했습니다." message={String(errorMsg)} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="재고"
        description="입점처별 재고 현황과 제작 필요 수량을 한 번에 관리합니다."
      />

            {/* 상단 컨트롤 */}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        {/* 1행: 필터 */}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[220px_220px_180px_280px]">
          <div className="w-full">
            <AppSelect
              value={selectedStoreId}
              onValueChange={(v: string) => setSelectedStoreId(v)}
              options={storeOptions as any}
            />
          </div>

          <AppSelect
  value={categoryFilter}
  onValueChange={(v: string) => setCategoryFilter(v)}
  options={[
    { label: "전체 카테고리", value: "__all__" },
    ...categoryOptions.map((c) => ({
      label: c,
      value: c,
    })),
  ]}
/>
          <AppSelect
  value={qtySort}
  onValueChange={(v: string) => setQtySort(v as any)}
  options={[
    { label: "재고 정렬 없음", value: "none" },
    { label: "재고 많은 순", value: "desc" },
    { label: "재고 적은 순", value: "asc" },
  ]}
/>

          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="제품명 또는 카테고리 검색"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </div>

        {/* 2행: 액션 버튼 */}
        <div className="grid gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap">
        <AppButton
            variant="secondary"
            onClick={
              selectedStoreId === "__all__"
                ? downloadInventoryUploadTemplate
                : downloadStoreSpecificInventoryTemplate
            }
            className="w-full xl:w-auto"
          >
            {selectedStoreId === "__all__"
              ? "공통 템플릿 다운로드"
              : `${selectedStoreName} 맞춤 템플릿 다운로드`}
          </AppButton>

          <AppButton
            variant="default"
            onClick={() => csvInputRef.current?.click()}
            disabled={csvUploading || selectedStoreId === "__all__"}
            className="w-full xl:w-auto"
          >
            {csvUploading
              ? "업로드 중..."
              : selectedStoreId === "__all__"
                ? "입점처 선택 후 업로드"
                : "입점처 재고 파일 업로드"}
          </AppButton>

          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleInventoryCsvUpload(file)
            }}
          />

          <AppButton
            variant="secondary"
            onClick={exportInventoryWorkbook}
            className="w-full xl:w-auto"
          >
            재고 현황 엑셀 다운로드
          </AppButton>

          <AppButton
            variant="secondary"
            onClick={exportMakeWorkbook}
            className="w-full xl:w-auto"
          >
            제작 리스트 엑셀 다운로드
          </AppButton>
        </div>
      </div>


      {/* 본문 */}
      <AppCard className="shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">입점처별 재고/제작</p>
            <p className="text-xs text-muted-foreground">
              기준: 저재고 &lt; {lowStockThreshold} / 목표 재고 {targetQtyLabel}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <AppButton
              variant={onlyLowStock ? "default" : "secondary"}
              onClick={() => setOnlyLowStock((v) => !v)}
            >
              {onlyLowStock ? "저재고 필터 ON" : "저재고 필터 OFF"}
            </AppButton>
          </div>
        </div>

        <div className="mt-3">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              const next = v as any
              setTab(next)
              setSp((prev) => {
                const n = new URLSearchParams(prev)
                n.set("tab", next)
                return n
              })
            }}
            className="w-full"
          >
            <TabsList className="w-full justify-start">
              <TabsTrigger value="inventory">재고 현황</TabsTrigger>
              <TabsTrigger value="make">제작 리스트</TabsTrigger>
            </TabsList>

            {/* 재고 현황 */}
            <TabsContent value="inventory" className="mt-3">
              <div className="overflow-hidden rounded-lg border">
                <Table className="w-full text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[18%]">카테고리</TableHead>
                      <TableHead className="w-[40%]">제품</TableHead>
                      <TableHead className="w-[24%]">입점처</TableHead>
                      <TableHead className="w-[18%] text-right">현재</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {sortedInventoryRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10">
                          <EmptyState title="표시할 데이터가 없습니다." description="입점처/필터를 확인해 주세요." />
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedInventoryRows.map((it: any, rowIndex: number) => {
                        const pName = productNameById.get(String(it.productId)) ?? "제품"
                        const sName = storeById.get(String(it.storeId))?.name ?? "-"
                        const cat = productCategoryById.get(String(it.productId)) || "-"
                        const current = num(it.onHandQty, 0)
                        const isLow = current < lowStockThreshold
                        const rowClass = isLow ? "bg-destructive/10" : "hover:bg-accent/30"

                        return (
                          <TableRow key={toKey(`${it.storeId}-${it.productId}`)} className={rowClass}>
                            <TableCell>
                              <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                {cat}
                              </span>
                            </TableCell>

                            <TableCell className="font-medium">{pName}</TableCell>
                            <TableCell className="text-muted-foreground">{sName}</TableCell>

                            <TableCell className="text-right">
                              <input
                                ref={(el) => {
                                  qtyInputRefs.current[rowIndex] = el
                                }}
                                type="number"
                                inputMode="numeric"
                                className="h-9 w-[92px] rounded-md border bg-background px-2 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                                value={current}
                                onChange={(e) => {
                                  const v = Number(e.target.value)
                                  const nextQty = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
                                  setQtyLocal(String(it.storeId), String(it.productId), nextQty)
                                  scheduleSaveQty(String(it.storeId), String(it.productId), nextQty)
                                }}
                                onBlur={(e) => {
                                  const v = Number((e.target as HTMLInputElement).value)
                                  const nextQty = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
                                  setQtyLocal(String(it.storeId), String(it.productId), nextQty)
                                  scheduleSaveQty(String(it.storeId), String(it.productId), nextQty)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === "ArrowDown") {
                                    e.preventDefault()
                                    moveFocus(rowIndex, 1)
                                  }
                                  if (e.key === "ArrowUp") {
                                    e.preventDefault()
                                    moveFocus(rowIndex, -1)
                                  }
                                }}
                                onFocus={(e) => {
                                  ;(e.target as HTMLInputElement).select()
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* 제작 리스트 */}
            <TabsContent value="make" className="mt-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  제작 필요 합계:{" "}
                  <span className="font-semibold tabular-nums">
                    {makeViewMode === "total" ? makeNeededTotalAllStores : makeNeededTotal}
                  </span>
                </div>

                <div className="flex gap-2">
                  <AppButton
                    variant={makeViewMode === "store" ? "default" : "secondary"}
                    onClick={() => setMakeViewMode("store")}
                  >
                    입점처별
                  </AppButton>
                  <AppButton
                    variant={makeViewMode === "total" ? "default" : "secondary"}
                    onClick={() => setMakeViewMode("total")}
                  >
                    통합 제작
                  </AppButton>
                </div>
              </div>

              <div className="mt-2 overflow-hidden rounded-lg border">
                <Table className="w-full text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[18%]">카테고리</TableHead>
                      <TableHead className="w-[46%]">제품</TableHead>
                      <TableHead className="w-[18%]">
                        {makeViewMode === "total" ? "집계" : "입점처"}
                      </TableHead>
                      <TableHead className="w-[18%] text-right">필요</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {makeViewMode === "total" ? (
                      makeRowsTotal.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-10">
                            <EmptyState title="통합 제작 필요 항목이 없습니다." description="현재는 안정적인 상태입니다." />
                          </TableCell>
                        </TableRow>
                      ) : (
                        makeRowsTotal.map((row) => (
                          <TableRow key={row.productId} className="hover:bg-accent/30">
                            <TableCell>
                              <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                {row.category}
                              </span>
                            </TableCell>
                            <TableCell className="font-medium">{row.name}</TableCell>
                            <TableCell className="text-muted-foreground">전체 입점처 합산</TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span className="font-semibold">{row.need}</span>
                            </TableCell>
                          </TableRow>
                        ))
                      )
                    ) : makeRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10">
                          <EmptyState title="제작 필요 항목이 없습니다." description="현재는 안정적인 상태입니다." />
                        </TableCell>
                      </TableRow>
                    ) : (
                      makeRows.slice(0, 50).map(({ it, need }: any) => {
                        const pName = productNameById.get(String(it.productId)) ?? "제품"
                        const sName = storeById.get(String(it.storeId))?.name ?? "-"
                        const cat = productCategoryById.get(String(it.productId)) || "-"

                        return (
                          <TableRow key={toKey(`${it.storeId}-${it.productId}`)} className="hover:bg-accent/30">
                            <TableCell>
                              <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                {cat}
                              </span>
                            </TableCell>
                            <TableCell className="font-medium">{pName}</TableCell>
                            <TableCell className="text-muted-foreground">{sName}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span className="font-semibold">{need}</span>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </AppCard>

      <div className="flex justify-end">
        <AppButton variant="secondary" onClick={() => nav("/dashboard")}>
          대시보드로 돌아가기
        </AppButton>
      </div>
      <Dialog open={csvPreviewOpen} onOpenChange={setCsvPreviewOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>재고 업로드 반영 방식 선택</DialogTitle>
            <DialogDescription>
              업로드한 수량을 현재 재고에 어떻게 반영할지 선택해 주세요.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div>파일명: {csvSelectedFileName || "-"}</div>
              <div>반영 가능 행: {csvPendingRows.length}건</div>
              <div>건너뜀: {csvSkippedCount}건</div>
            </div>

            <p className="text-xs text-muted-foreground">
              ※ 수량이 비어있는 행은 반영되지 않습니다.
            </p>

            {csvSkippedRows.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  반영되지 않는 행
                </p>

                <div className="max-h-[220px] overflow-auto rounded-lg border">
                  <Table className="w-full table-fixed text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[12%]">행</TableHead>
                        <TableHead className="w-[28%]">카테고리</TableHead>
                        <TableHead className="w-[28%]">제품</TableHead>
                        <TableHead className="w-[32%]">사유</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvSkippedRows.slice(0, 20).map((row, idx) => (
                        <TableRow key={`${row.rowIndex}-${row.name}-${idx}`}>
                          <TableCell>{row.rowIndex}</TableCell>
                          <TableCell className="truncate">{row.category || "-"}</TableCell>
                          <TableCell className="truncate">{row.name || row.sku || "-"}</TableCell>
                          <TableCell className="truncate text-muted-foreground">
                            {row.reason}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {csvSkippedRows.length > 20 ? (
                  <p className="text-xs text-muted-foreground">
                    실패 목록은 상위 20건만 표시됩니다.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                <input
                  type="radio"
                  name="csv-upload-mode"
                  checked={csvUploadMode === "add"}
                  onChange={() => setCsvUploadMode("add")}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">현재 재고에 추가</div>
                  <div className="text-sm text-muted-foreground">
                    업로드한 수량을 현재 재고에 더합니다.
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                <input
                  type="radio"
                  name="csv-upload-mode"
                  checked={csvUploadMode === "replace"}
                  onChange={() => setCsvUploadMode("replace")}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">현재 재고로 덮어쓰기</div>
                  <div className="text-sm text-muted-foreground">
                    업로드한 수량을 해당 입점처의 최종 재고로 저장합니다.
                  </div>
                </div>
              </label>
            </div>

            <div className="max-h-[260px] overflow-auto rounded-lg border">
              <Table className="w-full table-fixed text-sm">
                <TableHeader>
                   <TableRow>
                      <TableHead className="w-[26%]">카테고리</TableHead>
                      <TableHead className="w-[26%]">제품</TableHead>
                      <TableHead className="w-[12%] text-right">현재</TableHead>
                      <TableHead className="w-[12%] text-right">업로드</TableHead>
                      <TableHead className="w-[24%] text-right whitespace-nowrap">
                        {csvUploadMode === "replace" ? "반영 후(덮어쓰기)" : "반영 후(추가)"}
                      </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
  {csvPendingRows.slice(0, 20).map((row) => (
    <TableRow key={`${row.storeId}-${row.productId}`}>
      <TableCell className="truncate">{row.category}</TableCell>
      <TableCell className="truncate">{row.name}</TableCell>
      <TableCell className="text-right tabular-nums">{row.existingQty}</TableCell>
      <TableCell className="text-right tabular-nums">{row.inputQty}</TableCell>
      <TableCell className="text-right tabular-nums font-semibold whitespace-nowrap">
        {csvUploadMode === "replace" ? row.nextQtyReplace : row.nextQtyAdd}
      </TableCell>
    </TableRow>
  ))}
</TableBody>
              </Table>
            </div>

            {csvPendingRows.length > 20 ? (
              <p className="text-xs text-muted-foreground">
                미리보기는 상위 20건만 표시됩니다.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <AppButton
              variant="secondary"
              onClick={() => {
                setCsvPreviewOpen(false)
                setCsvPendingRows([])
                setCsvSkippedCount(0)
                setCsvSkippedRows([])
                setCsvSelectedFileName("")
              }}
              disabled={csvUploading}
            >
              취소
            </AppButton>

            <AppButton onClick={confirmInventoryCsvUpload} disabled={csvUploading}>
              {csvUploading ? "반영 중..." : "반영하기"}
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}