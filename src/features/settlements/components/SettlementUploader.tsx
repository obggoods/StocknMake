import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { Pencil } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

import { AppButton } from "@/components/app/AppButton"
import { AppCard } from "@/components/app/AppCard"
import { AppBadge } from "@/components/app/AppBadge"
import { AppInput } from "@/components/app/AppInput"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorState } from "@/components/shared/ErrorState"
import { Skeleton } from "@/components/shared/Skeleton"

import { toast } from "@/lib/toast"
import { useAppData } from "@/features/core/useAppData"

import {
  createProductDB,
  getSettlementV2ByMarketplaceMonthDB,
  upsertInventoryItemsBatchDB, // ✅ 추가
  getMarketplaceCommissionRateDB,
  replaceSettlementLinesDB,
  createSettlementHeaderDB,
  recomputeSettlementProductStatsDB,
} from "@/data/store.supabase"

import { generateId } from "@/data/store"
import * as XLSX from "xlsx"

type SettlementUploadRow = {
  store: string
  period: string
  barcode: string
  productName?: string  // 👈 추가
  sold_qty: number
  unit_price: number
  currency?: string
}

type PreviewRow = {
  idx: number
  storeName: string
  period: string
  barcode: string
  soldQty: number
  unitPrice: number
  currency: string
  productId?: string
  productName?: string
  productNameMatched?: string
  storeId?: string
  status: "ok" | "error"
  error?: string
  ignored?: boolean
  matchType?: "barcode" | "name_exact" | "name_fuzzy" | "none" // 👈 이 줄 추가
}

type ColumnMapping = {
  barcode: string
  sold_qty: string
  amount: string
  product_name: string
}

type SettlementUploaderProps = {
  onSaved?: () => void | Promise<void>
}

function parseIntSafe(v: string): number {
  const t = (v ?? "").trim()
  if (!t) return 0
  const n = Number(t.replace(/,/g, ""))
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function parseMoneySafe(v: string): number {
  const t = (v ?? "").trim()
  if (!t) return 0
  const n = Number(t.replace(/,/g, "").replace(/₩/g, ""))
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round(n))
}

type UploadedSheetRow = Record<string, string>

function sanitizeSpreadsheetText(value: unknown): string {
  const text = String(value ?? "").trim()
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function downloadExcelTemplate(filename: string) {
  // ===== 1) 입력 시트 =====
  const ws = XLSX.utils.aoa_to_sheet([
    ["barcode", "product_name", "sold_qty", "amount"], // 👈 쉼표 추가
    ["8801234567890", "제품A", 1, 11000],
    ["8801234567891", "제품B", 3, 18000],
    ["8801234567001", "제품C", 4, 31600],
  ])

  // 👉 컬럼 너비 설정
  ws["!cols"] = [
    { wch: 20 }, // barcode
    { wch: 20 }, // product_name
    { wch: 10 }, // sold_qty
    { wch: 15 }, // amount
  ]

  // ===== 2) 가이드 시트 =====
  const guide = XLSX.utils.aoa_to_sheet([
    ["정산 엑셀 업로드 가이드"],
    [""],
    ["1. 반드시 첫 행은 헤더여야 합니다."],
    ["   - barcode / sold_qty / amount"],
    [""],
    ["2. barcode는 제품과 매칭되는 값입니다."],
    ["   - 앱에 등록된 바코드와 동일해야 합니다"],
    [""],
    ["3. sold_qty는 판매 수량입니다"],
    ["   - 1 이상의 숫자"],
    [""],
    ["4. amount는 총 판매금액입니다"],
    ["   - 자동으로 단가 계산됩니다"],
    [""],
    ["5. 엑셀 수식은 사용하지 않는 것을 권장합니다"],
    ["   - (=, +, - 등으로 시작 금지)"],
    [""],
    ["6. 한 번에 5000행 이하 업로드 권장"],
  ])

  guide["!cols"] = [{ wch: 80 }]

  // ===== 3) 워크북 =====
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Template")
  XLSX.utils.book_append_sheet(wb, guide, "가이드")

  XLSX.writeFile(wb, filename)
}

async function readExcelFile(file: File): Promise<{ headers: string[]; rows: UploadedSheetRow[] }> {
  const data = await file.arrayBuffer()
  const workbook = XLSX.read(data, { type: "array" })

  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error("엑셀 시트를 찾지 못했습니다.")
  }

  const sheet = workbook.Sheets[firstSheetName]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  })

  const headers = Array.from(
    rawRows.reduce((set, row) => {
      Object.keys(row).forEach((key) => {
        const header = String(key ?? "").trim()
        if (header) set.add(header)
      })
      return set
    }, new Set<string>())
  )

  const rows: UploadedSheetRow[] = rawRows.map((row) =>
    Object.fromEntries(
      headers.map((header) => [header, sanitizeSpreadsheetText(row[header])])
    )
  )

  return { headers, rows }
}

function parseWithMapping(input: {
  sheetRows: UploadedSheetRow[]
  mapping: ColumnMapping
  storeName: string
  periodMonth: string
}): SettlementUploadRow[] {
  if (!input.mapping.barcode && !input.mapping.product_name) {
    throw new Error("매핑 오류: 바코드 또는 제품명 컬럼을 선택하세요.")
  }
  if (!input.mapping.sold_qty) {
    throw new Error("매핑 오류: 판매수량 컬럼을 선택하세요.")
  }
  if (!input.mapping.amount) {
    throw new Error("매핑 오류: 순매출(amount) 컬럼을 선택하세요.")
  }

  const out: SettlementUploadRow[] = []

  for (const row of input.sheetRows) {
    const barcode = input.mapping.barcode
      ? sanitizeSpreadsheetText(row[input.mapping.barcode])
      : ""

    const productName = input.mapping.product_name
      ? sanitizeSpreadsheetText(row[input.mapping.product_name])
      : ""
    const sold_qty = parseIntSafe(sanitizeSpreadsheetText(row[input.mapping.sold_qty]))
    const amount = parseMoneySafe(sanitizeSpreadsheetText(row[input.mapping.amount]))

    if (!barcode && !productName && sold_qty === 0 && amount === 0) continue

    const unit_price =
      sold_qty > 0 && amount > 0
        ? Math.round(amount / sold_qty)
        : 0

    out.push({
      store: input.storeName,
      period: input.periodMonth,
      barcode,
      productName,
      sold_qty,
      unit_price,
      currency: "KRW",
    })
  }

  return out
}

function normalizeText(v: string) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\s/g, "")
    .trim()
}

function findProductFlexible(
  products: any[],
  barcode: string,
  productName?: string
): {
  product: any | null
  type: "barcode" | "name_exact" | "name_fuzzy" | "none"
} {
  // 1️⃣ barcode 매칭
  let product = products.find(
    (p) => String(p.barcode ?? "").trim() === barcode
  )
  if (product) return { product, type: "barcode" }

  if (!productName) return { product: null, type: "none" }

  const normalizedInput = normalizeText(productName)

  // 2️⃣ 완전 일치
  product = products.find(
    (p) => normalizeText(p.name) === normalizedInput
  )
  if (product) return { product, type: "name_exact" }

  // 3️⃣ 부분 포함
  product = products.find(
    (p) =>
      normalizeText(p.name).includes(normalizedInput) ||
      normalizedInput.includes(normalizeText(p.name))
  )

  if (product) return { product, type: "name_fuzzy" }

  return { product: null, type: "none" }
}

function guessHeader(headers: string[], candidates: string[]): string | undefined {
  const normalized = headers.map((h) => ({
    raw: h,
    key: String(h ?? "").trim().toLowerCase(),
  }))

  for (const candidate of candidates) {
    const c = String(candidate ?? "").trim().toLowerCase()
    const found = normalized.find((x) => x.key === c)
    if (found) return found.raw
  }

  for (const candidate of candidates) {
    const c = String(candidate ?? "").trim().toLowerCase()
    const found = normalized.find((x) => x.key.includes(c))
    if (found) return found.raw
  }

  return undefined
}

function SelectField(props: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
  required?: boolean
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-muted-foreground">
        {props.label}
        {props.required ? <span className="text-destructive"> *</span> : null}
      </span>
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">선택</option>
        {props.options.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function SettlementUploader({ onSaved }: SettlementUploaderProps) {
  const a = useAppData()
  const products = a.data.products ?? []

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<PreviewRow[] | null>(null)
  const [lastFileName, setLastFileName] = useState<string>("")
  const [applyToInventory, setApplyToInventory] = useState<boolean>(true)
  const [commissionDraft, setCommissionDraft] = useState<number>(0)
  const [commissionRate, setCommissionRate] = useState<number>(0)
  const [commissionEditing, setCommissionEditing] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryStoreId, setSummaryStoreId] = useState("")
  const [summaryMonth, setSummaryMonth] = useState(() => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    return `${y}-${m}`
  })
  const [summaryGrossAmount, setSummaryGrossAmount] = useState("")
  // ✅ 매핑 UI용 상태
  const [sheetRows, setSheetRows] = useState<UploadedSheetRow[]>([])
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({
    barcode: "",
    sold_qty: "",
    amount: "",
    product_name: "", // 👈 추가
  })
  const [autoCreateOpen, setAutoCreateOpen] = useState(false)
  const [autoCreateLoading, setAutoCreateLoading] = useState(false)
  const [selectedStoreId, setSelectedStoreId] = useState<string>("")

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  })

  const hasExistingSettlementForSelectedMonth = useMemo(() => {
    if (!selectedStoreId || !selectedMonth) return false

    return Boolean(
      a.data.settlementsV2?.some(
        (s: any) =>
          String(s.marketplaceId ?? s.marketplace_id ?? "") === selectedStoreId &&
          String(s.periodMonth ?? s.period_month ?? "") === selectedMonth
      )
    )
  }, [a.data.settlementsV2, selectedStoreId, selectedMonth])

  useEffect(() => {
    if (!selectedStoreId) return

    const store = a.data.stores.find((s: any) => s.id === selectedStoreId)
    if (!store) return

    const rate = Number(store?.commissionRate ?? 0)
    setCommissionRate(rate)
    setCommissionEditing(false)
  }, [selectedStoreId, a.data.stores])

  useEffect(() => {
    if (!summaryStoreId || !summaryOpen) return

    const store = a.data.stores.find((s: any) => s.id === summaryStoreId)
    if (!store) return

    const rate = Number(store?.commissionRate ?? 0)
    setCommissionRate(rate)
    setCommissionEditing(false)
  }, [summaryStoreId, summaryOpen, a.data.stores])

  // ===== 수동 매칭 / 제품 생성 UI 상태 =====
  const [matchOpenIdx, setMatchOpenIdx] = useState<number | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createDraft, setCreateDraft] = useState<{
    rowIdx: number
    name: string
    sku: string
    barcode: string
  }>({ rowIdx: -1, name: "", sku: "", barcode: "" })

  const applyManualMatch = useCallback((rowIdx: number, p: any) => {
    setRows((prev) =>
      (prev ?? []).map((x) => {
        if (x.idx !== rowIdx) return x
        return {
          ...x,
          status: "ok",
          error: undefined,
          ignored: false,
          productId: String(p.id),
          productName: String(p.name ?? ""),
          productNameMatched: String(p.name ?? ""),
        }
      })
    )
  }, [])

  const openCreateProduct = useCallback((r: PreviewRow) => {
    setCreateDraft({
      rowIdx: r.idx,
      name: String(r.productName ?? "").trim() || "새 제품",
      sku: "",
      barcode: String(r.barcode ?? "").trim(),
    })
    setCreateOpen(true)
  }, [])

  const templateDownload = useCallback(() => {
    downloadExcelTemplate("settlement_template.xlsx")

    toast.success("정산 엑셀 템플릿을 다운로드했어요.")
  }, [])

  // ✅ 미리보기 통계
  const previewStats = useMemo(() => {
    const r = (rows ?? []).filter((x) => !x.ignored)
    const ok = r.filter((x) => x.status === "ok")
    const err = r.filter((x) => x.status === "error")
    const gross = ok.reduce((sum, x) => sum + x.soldQty * x.unitPrice, 0)
    const sold = ok.reduce((sum, x) => sum + x.soldQty, 0)
    const stores = new Set(ok.map((x) => x.storeName.trim()).filter(Boolean)).size
    return { ok: ok.length, err: err.length, gross, sold, stores }
  }, [rows])

  // ✅ 엑셀 → 미리보기 생성
  const buildPreview = useCallback(
    (parsed: SettlementUploadRow[]) => {
      const next: PreviewRow[] = parsed.map((r, i) => {
        const storeName = (r.store ?? "").trim()
        const period = (r.period ?? "").trim()
        const barcode = String(r.barcode ?? "").trim()
        const soldQty = Math.max(0, Math.floor(r.sold_qty ?? 0))
        const unitPrice = Math.max(0, Math.round(r.unit_price ?? 0))
        const currency = (r.currency ?? "KRW").trim().toUpperCase() || "KRW"

        if (!storeName) {
          return { idx: i + 1, storeName, period, barcode, soldQty, unitPrice, currency, status: "error", error: "store(입점처명)이 비어있습니다." }
        }
        if (!/^\d{4}-\d{2}$/.test(period)) {
          return { idx: i + 1, storeName, period, barcode, soldQty, unitPrice, currency, status: "error", error: "period 형식이 올바르지 않습니다 (YYYY-MM)." }
        }
        if (!barcode && !r.productName) {
          return {
            idx: i + 1,
            storeName,
            period,
            barcode,
            soldQty,
            unitPrice,
            currency,
            status: "error",
            error: "barcode 또는 제품명이 필요합니다.",
          }
        }
        if (soldQty <= 0) {
          return { idx: i + 1, storeName, period, barcode, soldQty, unitPrice, currency, status: "error", error: "sold_qty는 1 이상이어야 합니다." }
        }
        if (unitPrice <= 0) {
          return { idx: i + 1, storeName, period, barcode, soldQty, unitPrice, currency, status: "error", error: "unit_price는 1 이상이어야 합니다." }
        }
        if (currency !== "KRW") {
          return { idx: i + 1, storeName, period, barcode, soldQty, unitPrice, currency, status: "error", error: "현재는 KRW만 지원합니다." }
        }

        const store = a.data.stores.find((s: any) => String(s.name ?? "").trim() === storeName)
        if (!store) {
          return { idx: i + 1, storeName, period, barcode, soldQty, unitPrice, currency, status: "error", error: "앱에 등록된 입점처명과 일치하지 않습니다." }
        }

        const match = findProductFlexible(
          a.data.products,
          barcode,
          r.productName
        )

        const product = match?.product
        if (!product) {
          return {
            idx: i + 1,
            ignored: false,
            storeName,
            period,
            barcode,
            soldQty,
            unitPrice,
            currency,
            storeId: store.id,
            productName: r.productName,
            productNameMatched: undefined,
            status: "error",
            matchType: "none",
            error: "제품을 찾을 수 없습니다. (바코드 또는 제품명 확인)",
          }
        }

        return {
          idx: i + 1,
          ignored: false,
          storeName,
          period,
          barcode,
          soldQty,
          unitPrice,
          currency,
          storeId: store.id,
          productId: product.id,
          productName: product.name,
          productNameMatched: product.name,
          status: "ok",
          matchType: match.type, // 👈 추가
        }
      })

      setRows(next)
    },
    [a.data.products, a.data.stores]
  )

  // ✅ 파일 선택 → 시트 읽기 + 헤더 추출 + 매핑 추정
  const onPickFile = useCallback(async (file: File) => {
    const MAX_BYTES = 5 * 1024 * 1024

    if (file.size > MAX_BYTES) {
      toast.error("엑셀 파일이 너무 큽니다. 5MB 이하로 업로드해주세요.")
      return
    }

    const lower = file.name.toLowerCase()
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      toast.error("엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.")
      return
    }

    try {
      const { headers, rows } = await readExcelFile(file)

      if (headers.length === 0) {
        toast.error("엑셀 헤더를 읽지 못했습니다. 파일 형식을 확인하세요.")
        return
      }

      setSheetRows(rows)
      setSheetHeaders(headers)
      setRows(null)
      setLastFileName(file.name)

      const guessed: ColumnMapping = {
        barcode: guessHeader(headers, ["barcode", "바코드", "ean", "jan"]) || "",
        sold_qty: guessHeader(headers, ["sold_qty", "qty", "수량", "판매수량"]) || "",
        amount: guessHeader(headers, ["amount", "매출", "금액"]) || "",
        product_name: guessHeader(headers, ["product_name", "제품명", "상품명", "name"]) || "",
      }
      setMapping(guessed)

      toast.success("엑셀을 불러왔어요. 컬럼 매핑을 확인한 뒤 미리보기를 생성하세요.")
    } catch (e: any) {
      console.error(e)
      toast.error(`엑셀 읽기 실패: ${e?.message ?? e}`)
    } finally {
      if (inputRef.current) inputRef.current.value = ""
    }
  }, [])

  const onChangeFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await onPickFile(file)
  }, [onPickFile])

  const canBuildPreview = useMemo(() => {
    return Boolean(
      sheetRows.length > 0 &&
      sheetHeaders.length > 0 &&
      selectedStoreId &&
      selectedMonth &&
      mapping.sold_qty &&
      mapping.amount &&
      (mapping.barcode || mapping.product_name) // 👈 핵심
    )
  }, [sheetRows.length, sheetHeaders.length, selectedStoreId, selectedMonth, mapping])

  useEffect(() => {
    if (hasExistingSettlementForSelectedMonth && applyToInventory) {
      setApplyToInventory(false)
      toast.error("같은 입점처/같은 월 기존 정산이 있어 재고 반영을 자동으로 껐어요.")
    }
  }, [hasExistingSettlementForSelectedMonth, applyToInventory])

  const onBuildPreviewClick = useCallback(() => {
    try {
      if (!canBuildPreview) {
        toast.error("필수 항목을 모두 선택하세요.")
        return
      }

      const store = a.data.stores.find((s: any) => s.id === selectedStoreId)
      if (!store) {
        toast.error("입점처를 선택하세요.")
        return
      }

      const parsed = parseWithMapping({
        sheetRows,
        mapping,
        storeName: String(store.name ?? "").trim(),
        periodMonth: selectedMonth,
      })

      if (parsed.length === 0) {
        toast.error("엑셀에 데이터가 없습니다.")
        return
      }

      const MAX_ROWS = 5000
      if (parsed.length > MAX_ROWS) {
        toast.error(`한 번에 ${MAX_ROWS.toLocaleString()}행 이하만 업로드할 수 있습니다.`)
        return
      }

      buildPreview(parsed)
      toast.success("미리보기를 생성했어요. 적용 전 내용을 확인하세요.")
    } catch (e: any) {
      console.error(e)
      toast.error(`미리보기 생성 실패: ${e?.message ?? e}`)
    }
  }, [canBuildPreview, sheetRows, mapping, buildPreview, a.data.stores, selectedStoreId, selectedMonth])

  async function saveSummarySettlement() {
    try {
      if (busy) return

      if (!summaryStoreId) {
        toast.error("입점처를 선택해주세요.")
        return
      }

      if (!summaryMonth) {
        toast.error("정산 월을 선택해주세요.")
        return
      }

      const grossAmount = Number(String(summaryGrossAmount).replace(/,/g, "").trim())

      if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
        toast.error("판매총액을 올바르게 입력해주세요.")
        return
      }

      if (grossAmount > 1000000000000) {
        toast.error("판매총액이 너무 큽니다. 값을 다시 확인해주세요.")
        return
      }

      const commissionRatePercent = commissionRate ?? 0

      if (!Number.isFinite(commissionRatePercent) || commissionRatePercent < 0 || commissionRatePercent > 100) {
        toast.error("수수료율은 0~100 사이로 입력해주세요.")
        return
      }

      const commissionRateDecimal = commissionRatePercent / 100
      const commissionAmount = Math.round(grossAmount * commissionRateDecimal)
      const netAmount = grossAmount - commissionAmount

      const saved = await createSettlementHeaderDB({
        marketplaceId: summaryStoreId,
        periodMonth: summaryMonth,
        currency: "KRW",
        grossAmount,
        commissionRate: commissionRateDecimal,
        commissionAmount,
        netAmount,
        rowsCount: 0,
        sourceFilename: null,
        applyToInventory: false,
        settlementType: "summary",
      })

      await replaceSettlementLinesDB({
        settlementId: saved.id,
        marketplaceId: summaryStoreId,
        lines: [],
      })

      await recomputeSettlementProductStatsDB({
        marketplaceId: summaryStoreId,
        periodMonth: summaryMonth,
      })

      setSummaryOpen(false)
      setSummaryStoreId("")
      setSummaryGrossAmount("")

      if (typeof (a as any).refresh === "function") {
        await (a as any).refresh()
      }

      if (onSaved) {
        await onSaved()
      }

      toast.success("판매총액 정산이 저장되었습니다.")
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message ?? "판매총액 정산 저장 중 오류가 발생했습니다.")
    }
  }

  const apply = useCallback(async () => {
    if (!rows || rows.length === 0) return

    if (rows.some((r) => !r.ignored && r.status === "error")) {
      toast.error("오류가 있는 행이 있어 적용할 수 없습니다. (삭제해서 제외할 수 있어요)")
      return
    }

    const okRows = rows
      .filter((r) => !r.ignored)
      .filter((r) => r.status === "ok") as Array<Required<PreviewRow>>

    const byStoreMonth = new Map<
      string,
      { storeId: string; month: string; storeName: string; rows: Required<PreviewRow>[] }
    >()

    for (const r of okRows) {
      const key = `${r.storeId}__${r.period}`
      const cur = byStoreMonth.get(key)
      if (!cur) {
        byStoreMonth.set(key, {
          storeId: r.storeId,
          month: r.period,
          storeName: r.storeName,
          rows: [r],
        })
      } else {
        cur.rows.push(r)
      }
    }

    try {
      setBusy(true)

      const requestedInventoryApply = applyToInventory
      let confirmedInventoryApply = false

      if (requestedInventoryApply) {
        confirmedInventoryApply = window.confirm("판매 수량을 재고에 반영하시겠습니까?")
      }

      for (const g of byStoreMonth.values()) {
        const existingForThisMonth = await getSettlementV2ByMarketplaceMonthDB({
          marketplaceId: g.storeId,
          periodMonth: g.month,
        })

        const shouldApplyInventoryFinal =
          confirmedInventoryApply && !existingForThisMonth?.id

        const agg = new Map<
          string,
          { productId: string; productName: string; soldQty: number; unitPrice: number; gross: number }
        >()

        for (const r of g.rows) {
          const k = r.productId
          const prev = agg.get(k)

          if (!prev) {
            const gross = r.soldQty * r.unitPrice
            agg.set(k, {
              productId: r.productId,
              productName: r.productName ?? "",
              soldQty: r.soldQty,
              unitPrice: r.unitPrice,
              gross,
            })
          } else {
            prev.soldQty += r.soldQty
            prev.unitPrice = r.unitPrice
            prev.gross = prev.soldQty * prev.unitPrice
          }
        }

        const lines = Array.from(agg.values()).map((x) => ({
          productId: x.productId,
          productNameRaw: x.productName || "(unknown)",
          productNameMatched: x.productName || null,
          skuRaw: null as string | null,
          qtySold: x.soldQty,
          unitPrice: x.unitPrice,
          grossAmount: x.gross,
          matchStatus: "matched" as const,
        }))

        const grossAmount = lines.reduce((sum, l) => sum + l.grossAmount, 0)

        let commissionRateFinal = (commissionRate ?? 0) / 100
        let storeCommissionRateFromDB = 0

        try {
          storeCommissionRateFromDB = await getMarketplaceCommissionRateDB({
            marketplaceId: g.storeId,
          })
        } catch {
          storeCommissionRateFromDB = 0
        }

        if (!commissionEditing) {
          if (storeCommissionRateFromDB > 0) {
            commissionRateFinal = storeCommissionRateFromDB
          } else {
            const store = a.data.stores.find((s: any) => s.id === g.storeId)
            const pct = Number(store?.commissionRate ?? 0) || 0
            commissionRateFinal = pct / 100
          }
        }

        const commissionAmount = Math.round(grossAmount * commissionRateFinal)
        const netAmount = grossAmount - commissionAmount

        const settlement = await createSettlementHeaderDB({
          marketplaceId: g.storeId,
          periodMonth: g.month,
          currency: "KRW",
          grossAmount,
          commissionRate: commissionRateFinal,
          commissionAmount,
          netAmount,
          rowsCount: lines.length,
          sourceFilename: lastFileName || null,
          applyToInventory: shouldApplyInventoryFinal,
          settlementType: "detailed",
        })

        await replaceSettlementLinesDB({
          settlementId: settlement.id,
          marketplaceId: g.storeId,
          lines,
        })

        await recomputeSettlementProductStatsDB({
          marketplaceId: g.storeId,
          periodMonth: g.month,
        })

        if (shouldApplyInventoryFinal) {
          const newQty = new Map<string, number>()

          for (const l of lines) {
            const pid = String(l.productId ?? "")
            if (!pid) continue
            newQty.set(pid, (newQty.get(pid) ?? 0) + Number(l.qtySold ?? 0))
          }

          const updates: Array<{ storeId: string; productId: string; onHandQty: number }> = []

          for (const [pid, soldQty] of newQty.entries()) {
            const inv = a.data.inventory.find(
              (x: any) => x.storeId === g.storeId && x.productId === pid
            )
            const current = Number(inv?.onHandQty ?? 0)
            const nextQty = Math.max(0, current - soldQty)

            updates.push({
              storeId: g.storeId,
              productId: pid,
              onHandQty: nextQty,
            })
          }

          if (updates.length > 0) {
            await upsertInventoryItemsBatchDB(updates)
          }
        }
      }

      toast.success("정산 저장이 완료되었습니다.")

      setRows(null)
      setLastFileName("")
      setSheetRows([])
      setSheetHeaders([])

      await a.refresh()

      if (onSaved) {
        await onSaved()
      }
    } catch (e: any) {
      console.error(e)
      toast.error(`정산(v2) 저장 실패: ${e?.message ?? e}`)
      await a.refresh()
    } finally {
      setBusy(false)
    }
  }, [rows, a, lastFileName, applyToInventory, onSaved])

  if (a.errorMsg) return <ErrorState message={a.errorMsg} onRetry={a.refresh} />

  return (
    <div className="space-y-4">
      {a.loading && <Skeleton className="h-24" />}

      <AppCard
        density="compact"
        title="새 정산 추가"
        description="엑셀 업로드 → 입점처/월 선택 → 컬럼 매핑(바코드/수량/금액) → 미리보기 → v2 정산 저장"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <AppButton type="button" variant="outline" onClick={templateDownload}>
              엑셀 템플릿 다운로드
            </AppButton>

            <AppButton
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={a.loading || busy}
            >
              엑셀 업로드
            </AppButton>

            <AppButton
              type="button"
              variant="outline"
              onClick={() => setSummaryOpen((v) => !v)}
              disabled={a.loading || busy}
            >
              판매총액만 입력
            </AppButton>

            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={onChangeFile}
            />
          </div>
        }
        contentClassName="px-4 pb-4 overflow-visible"
      >
        {summaryOpen ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border p-4 space-y-3">
              <div className="text-sm font-medium">판매총액만 입력</div>
              <div className="text-xs text-muted-foreground">
                제품별 판매수량 없이, 월별 판매총액만 정산으로 저장합니다.
                재고는 반영되지 않아요.
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">
                    입점처 <span className="text-destructive"> *</span>
                  </span>
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={summaryStoreId}
                    onChange={(e) => setSummaryStoreId(e.target.value)}
                  >
                    <option value="">선택</option>
                    {a.data.stores.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">
                    월(YYYY.MM) <span className="text-destructive"> *</span>
                  </span>
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={summaryMonth}
                    onChange={(e) => setSummaryMonth(e.target.value)}
                  >
                    {Array.from({ length: 24 }).map((_, i) => {
                      const d = new Date()
                      d.setMonth(d.getMonth() - i)
                      const y = d.getFullYear()
                      const m = String(d.getMonth() + 1).padStart(2, "0")
                      const value = `${y}-${m}`
                      const label = `${y}.${m}`
                      return (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">
                    판매총액(원) <span className="text-destructive"> *</span>
                  </span>
                  <AppInput
                    inputMode="numeric"
                    placeholder="예: 1250000"
                    value={summaryGrossAmount}
                    onChange={(e) => {
                      const onlyNumber = e.target.value.replace(/[^\d]/g, "")
                      setSummaryGrossAmount(onlyNumber)
                    }}
                  />
                </label>
              </div>
              <div className="flex items-center gap-2 group">
                <span className="text-xs text-muted-foreground">수수료율</span>

                <div className="flex items-center gap-1">
                  {!commissionEditing ? (
                    <span
                      className="text-sm font-medium cursor-pointer hover:underline"
                      onClick={() => {
                        setCommissionDraft(commissionRate)
                        setCommissionEditing(true)
                      }}
                    >
                      {commissionRate}%
                    </span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={commissionDraft}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (Number.isNaN(v)) return
                          setCommissionDraft(v)
                        }}
                        onBlur={() => {
                          setCommissionRate(commissionDraft)
                          setCommissionEditing(false)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setCommissionRate(commissionDraft)
                            setCommissionEditing(false)
                          }
                          if (e.key === "Escape") {
                            setCommissionEditing(false)
                          }
                        }}
                        className="h-8 w-20 rounded-md border px-2 text-sm"
                      />
                      <span className="text-sm">%</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <AppButton
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSummaryOpen(false)
                    setSummaryStoreId("")
                    setSummaryGrossAmount("")
                  }}
                  disabled={busy}
                >
                  취소
                </AppButton>

                <AppButton
                  type="button"
                  onClick={saveSummarySettlement}
                  disabled={busy}
                >
                  {busy ? "저장 중…" : "판매총액 정산 저장"}
                </AppButton>
              </div>
            </div>
          </div>
        ) : null}

        {sheetHeaders.length > 0 && !rows ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AppBadge variant="secondary">헤더 {sheetHeaders.length}개</AppBadge>
              {lastFileName ? <span className="text-xs text-muted-foreground">{lastFileName}</span> : null}
            </div>
            {hasExistingSettlementForSelectedMonth ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
                같은 입점처 / 같은 월 정산이 이미 있습니다.
                이번 업로드는 기존 정산을 덮어쓰지 않고 새 정산으로 저장되며,
                재고 반영은 기본적으로 OFF 처리됩니다.
              </div>
            ) : null}
            <div className="rounded-xl border p-4 space-y-3">
              <div className="text-sm font-medium">컬럼 매핑</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">수수료율</span>

                {!commissionEditing ? (
                  <>
                    <span className="text-sm font-medium">
                      {commissionRate}%
                    </span>

                    <AppButton
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setCommissionEditing(true)}
                    >
                      <Pencil className="h-4 w-4" />
                    </AppButton>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={commissionRate ?? 0}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (Number.isNaN(v)) return
                        if (v < 0 || v > 100) return
                        setCommissionRate(v)
                      }}
                      className="h-8 w-20 rounded-md border px-2 text-sm"
                    />

                    <button
                      type="button"
                      onClick={() => setCommissionEditing(false)}
                      className="text-xs text-primary"
                    >
                      완료
                    </button>
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">
                    입점처 <span className="text-destructive"> *</span>
                  </span>
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={selectedStoreId}
                    onChange={(e) => setSelectedStoreId(e.target.value)}
                  >
                    <option value="">선택</option>
                    {a.data.stores.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">
                    월(YYYY.MM) <span className="text-destructive"> *</span>
                  </span>
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                  >
                    {Array.from({ length: 24 }).map((_, i) => {
                      const d = new Date()
                      d.setMonth(d.getMonth() - i)
                      const y = d.getFullYear()
                      const m = String(d.getMonth() + 1).padStart(2, "0")
                      const value = `${y}-${m}`
                      const label = `${y}.${m}`
                      return (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </label>

                <SelectField
                  label="바코드(barcode)"
                  required
                  value={mapping.barcode}
                  options={sheetHeaders}
                  onChange={(v) => setMapping((m) => ({ ...m, barcode: v }))}
                />

                <SelectField
                  label="판매수량(sold_qty)"
                  required
                  value={mapping.sold_qty}
                  options={sheetHeaders}
                  onChange={(v) => setMapping((m) => ({ ...m, sold_qty: v }))}
                />

                <SelectField
                  label="순매출(amount)"
                  required
                  value={mapping.amount}
                  options={sheetHeaders}
                  onChange={(v) => setMapping((m) => ({ ...m, amount: v }))}
                />

                <SelectField
                  label="제품명(product_name)"
                  value={mapping.product_name ?? ""}
                  options={sheetHeaders}
                  onChange={(v) => setMapping((m) => ({ ...m, product_name: v }))}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <AppButton
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSheetRows([])
                    setSheetHeaders([])
                    setLastFileName("")
                    setRows(null)
                    setMapping({
                      barcode: "",
                      sold_qty: "",
                      amount: "",
                      product_name: "", // 👈 이거 추가
                    })
                  }}
                  disabled={busy}
                >
                  다시 선택
                </AppButton>

                <AppButton type="button" onClick={onBuildPreviewClick} disabled={busy || !canBuildPreview}>
                  미리보기 생성
                </AppButton>
              </div>
            </div>
          </div>
        ) : null}

        {rows ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AppBadge variant={previewStats.err > 0 ? "destructive" : "default"}>
                정상 {previewStats.ok} / 오류 {previewStats.err}
              </AppBadge>
              <AppBadge variant="secondary">판매수량 {previewStats.sold}</AppBadge>
              <AppBadge variant="secondary">총매출 {previewStats.gross.toLocaleString()}원</AppBadge>
              {lastFileName ? <span className="text-xs text-muted-foreground">{lastFileName}</span> : null}
            </div>

            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">#</TableHead>
                    <TableHead className="w-[140px]">입점처</TableHead>
                    <TableHead className="w-[90px]">월</TableHead>
                    <TableHead className="w-[160px]">바코드</TableHead>
                    <TableHead className="w-[90px] text-right">판매</TableHead>
                    <TableHead className="w-[110px] text-right">단가</TableHead>
                    <TableHead className="w-[110px] text-right">매출</TableHead>
                    <TableHead className="w-[140px] text-right pr-4">상태</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={`${r.idx}-${r.barcode}`}
                      className={r.ignored ? "opacity-40" : undefined}
                    >
                      <TableCell>{r.idx}</TableCell>
                      <TableCell className="truncate">{r.storeName}</TableCell>
                      <TableCell>{r.period}</TableCell>
                      <TableCell className="font-mono text-xs">{r.barcode}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.soldQty.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.unitPrice.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(r.soldQty * r.unitPrice).toLocaleString()}
                      </TableCell>

                      <TableCell className="text-right pr-4">
                        <div className="flex flex-col gap-2">
                          <div>
                            {r.status === "ok" ? (
                              <>
                                <div className="text-xs text-success">
                                  {r.matchType === "barcode" && "바코드 매칭"}
                                  {r.matchType === "name_exact" && "제품명 매칭"}
                                  {r.matchType === "name_fuzzy" && "유사 매칭"}
                                </div>

                                {r.matchType === "name_fuzzy" && (
                                  <div className="text-[11px] text-yellow-600">
                                    유사 매칭됨 (확인 필요)
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-destructive">매칭 필요</span>
                            )}

                            {r.status === "ok" && r.productName ? (
                              <div className="text-[11px] text-muted-foreground mt-1 break-words">
                                {r.productName}
                              </div>
                            ) : null}

                            {r.error ? (
                              <div className="text-[11px] text-muted-foreground mt-1 break-words">
                                {r.error}
                              </div>
                            ) : null}
                          </div>

                          {r.status !== "ok" && !r.ignored ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              <Popover
                                open={matchOpenIdx === r.idx}
                                onOpenChange={(open) => setMatchOpenIdx(open ? r.idx : null)}
                              >
                                <PopoverTrigger asChild>
                                  <AppButton size="sm" variant="outline">
                                    제품 선택
                                  </AppButton>
                                </PopoverTrigger>

                                <PopoverContent
                                  align="start"
                                  side="right"
                                  className="p-0 w-[320px] z-50"
                                >
                                  <Command>
                                    <CommandInput placeholder="제품 검색..." />
                                    <CommandList>
                                      <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
                                      <CommandGroup>
                                        {products.slice(0, 50).map((p: any) => (
                                          <CommandItem
                                            key={p.id}
                                            value={`${p.name ?? ""} ${(p.sku ?? "")} ${(p.barcode ?? "")}`}
                                            onSelect={() => {
                                              applyManualMatch(r.idx, p)
                                              setMatchOpenIdx(null)
                                              toast.success("수동 매칭 완료")
                                            }}
                                          >
                                            <div className="min-w-0 break-words">
                                              <div className="text-sm truncate">{p.name}</div>
                                              <div className="text-[11px] text-muted-foreground truncate">
                                                SKU: {p.sku ?? "-"} · Barcode: {p.barcode ?? "-"}
                                              </div>
                                            </div>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>

                              <AppButton size="sm" variant="outline" onClick={() => openCreateProduct(r)}>
                                새 제품 만들기
                              </AppButton>
                            </div>
                          ) : null}

                          <div className="flex justify-end">
                            <AppButton
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRows((prev) =>
                                  (prev ?? []).map((x) =>
                                    x.idx === r.idx ? { ...x, ignored: !x.ignored } : x
                                  )
                                )
                              }}
                            >
                              {r.ignored ? "복원" : "삭제"}
                            </AppButton>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground mr-auto">
                <input
                  type="checkbox"
                  checked={applyToInventory}
                  onChange={(e) => setApplyToInventory(e.target.checked)}
                />
                재고에도 반영하기 (기본 ON)
              </label>

              <AppButton
                type="button"
                variant="outline"
                onClick={() => setAutoCreateOpen(true)}
                disabled={!rows || rows.filter(r => r.status === "error" && !r.ignored).length === 0}
              >
                매칭 실패 제품 자동 생성
              </AppButton>

              <AppButton type="button" variant="outline" onClick={() => setRows(null)} disabled={busy}>
                취소
              </AppButton>

              <AppButton
                type="button"
                onClick={apply}
                disabled={busy || previewStats.err > 0 || previewStats.ok === 0}
              >
                {busy ? "저장 중…" : "정산(v2) 저장"}
              </AppButton>
            </div>
          </div>
        ) : sheetHeaders.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="정산 엑셀을 업로드하세요"
              description="업로드 후 컬럼 매핑을 하면, 미리보기에서 매칭 결과를 확인할 수 있어요."
            />
          </div>
        ) : null}
      </AppCard>

      <Dialog open={autoCreateOpen} onOpenChange={setAutoCreateOpen}>
        <DialogContent className="z-50">
          <DialogHeader>
            <DialogTitle>제품 자동 생성</DialogTitle>
          </DialogHeader>

          <div className="text-sm text-muted-foreground">
            매칭되지 않은 제품을 자동으로 생성합니다.
            <br />
            생성 후 되돌릴 수 없습니다.
          </div>

          <DialogFooter>
            <AppButton
              type="button"
              variant="outline"
              onClick={() => setAutoCreateOpen(false)}
              disabled={autoCreateLoading}
            >
              취소
            </AppButton>

            <AppButton
              type="button"
              onClick={async () => {
                if (!rows) return

                try {
                  setAutoCreateLoading(true)

                  const failedRows = rows.filter(
                    (r) => r.status === "error" && !r.ignored
                  )

                  for (const r of failedRows) {
                    const name = String(r.productName ?? "").trim()
                    if (!name) continue

                    const p = {
                      id: generateId("p"),
                      name,
                      category: null,
                      active: true,
                      makeEnabled: true,
                      createdAt: Date.now(),
                      price: 0,
                      sku: null,
                      barcode: r.barcode || null,
                    }

                    await createProductDB(p as any)

                    setRows((prev) =>
                      (prev ?? []).map((x) => {
                        if (x.idx !== r.idx) return x
                        return {
                          ...x,
                          status: "ok",
                          error: undefined,
                          productId: p.id,
                          productName: p.name,
                          productNameMatched: p.name,
                          matchType: "none",
                        }
                      })
                    )
                  }

                  await a.refresh()

                  toast.success("제품 생성 및 매칭 완료")
                  setAutoCreateOpen(false)

                } catch (e: any) {
                  console.error(e)
                  toast.error("자동 생성 중 오류 발생")
                } finally {
                  setAutoCreateLoading(false)
                }
              }}
              disabled={autoCreateLoading}
            >
              {autoCreateLoading ? "생성 중..." : "생성 진행"}
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ 정산에서 새 제품 만들기 */}
      <Dialog open={createOpen} onOpenChange={(open) => setCreateOpen(open)}>
        <DialogContent className="z-50">
          <DialogHeader>
            <DialogTitle>정산에서 새 제품 만들기</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">제품명</span>
              <AppInput
                value={createDraft.name}
                onChange={(e) => setCreateDraft((p) => ({ ...p, name: e.target.value }))}
                placeholder="제품명"
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">SKU (선택)</span>
              <AppInput
                value={createDraft.sku}
                onChange={(e) => setCreateDraft((p) => ({ ...p, sku: e.target.value }))}
                placeholder="SKU"
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">바코드 (선택)</span>
              <AppInput
                value={createDraft.barcode}
                onChange={(e) => setCreateDraft((p) => ({ ...p, barcode: e.target.value }))}
                placeholder="바코드"
              />
            </label>

            <p className="text-xs text-muted-foreground">
              생성 후 해당 정산 행은 자동으로 수동 매칭됩니다. (카테고리/가격은 제품 탭에서 나중에 수정)
            </p>
          </div>

          <DialogFooter className="gap-2">
            <AppButton type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              취소
            </AppButton>

            <AppButton
              type="button"
              onClick={async () => {
                const name = (createDraft.name ?? "").trim()
                if (!name) {
                  toast.error("제품명을 입력하세요.")
                  return
                }

                try {
                  setCreating(true)

                  const p = {
                    id: generateId("p"),
                    name,
                    category: null,
                    active: true,
                    makeEnabled: true,
                    createdAt: Date.now(),
                    price: 0,
                    sku: (createDraft.sku ?? "").trim() ? (createDraft.sku ?? "").trim() : null,
                    barcode: (createDraft.barcode ?? "").trim() ? (createDraft.barcode ?? "").trim() : null,
                  }

                  await createProductDB(p as any)
                  await a.refresh()

                  applyManualMatch(createDraft.rowIdx, p)

                  toast.success("제품을 생성하고 매칭했어요.")
                  setCreateOpen(false)
                } catch (e: any) {
                  console.error(e)
                  toast.error(`제품 생성 실패: ${e?.message ?? e}`)
                } finally {
                  setCreating(false)
                }
              }}
              disabled={creating}
            >
              {creating ? "생성 중…" : "제품 생성"}
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
