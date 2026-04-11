import { useCallback, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"

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
  listSettlementLinesV2DB,
  upsertInventoryItemDB,
  upsertInventoryItemsBatchDB, // ✅ 추가
  getMarketplaceCommissionRateDB,
  replaceSettlementLinesDB,
  upsertSettlementHeaderDB,
  recomputeSettlementProductStatsDB,
} from "@/data/store.supabase"

import { generateId } from "@/data/store"
import { parseCsvTextBasic } from "@/features/settlements/lib/parseSettlementCsv"

type SettlementCsvRow = {
  store: string
  period: string
  barcode: string
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
}

type ColumnMapping = {
  barcode: string
  sold_qty: string
  amount: string
}

function downloadCsv(filename: string, csvBody: string) {
  const blob = new Blob(["\uFEFF" + csvBody], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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

function normHeader(v: string): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "")
}

function guessHeader(headers: string[], candidates: string[]): string | "" {
  const normalized = headers.map((h) => ({ h, n: normHeader(h) }))
  for (const c of candidates) {
    const cn = normHeader(c)
    const found = normalized.find((x) => x.n === cn)
    if (found) return found.h
  }
  for (const c of candidates) {
    const cn = normHeader(c)
    const found = normalized.find((x) => x.n.includes(cn) || cn.includes(x.n))
    if (found) return found.h
  }
  return ""
}

function parseWithMapping(input: {
  csvText: string
  mapping: ColumnMapping
  storeName: string
  periodMonth: string // "YYYY-MM"
}): SettlementCsvRow[] {
  const { headers, rows } = parseCsvTextBasic(input.csvText)
  if (headers.length === 0) return []

  const idx = new Map<string, number>()
  headers.forEach((h, i) => idx.set(h, i))

  if (!input.mapping.barcode || !idx.has(input.mapping.barcode)) {
    throw new Error("매핑 오류: 바코드 컬럼을 선택하세요.")
  }
  if (!input.mapping.sold_qty || !idx.has(input.mapping.sold_qty)) {
    throw new Error("매핑 오류: 판매수량 컬럼을 선택하세요.")
  }
  if (!input.mapping.amount || !idx.has(input.mapping.amount)) {
    throw new Error("매핑 오류: 순매출(amount) 컬럼을 선택하세요.")
  }

  const get = (row: string[], colName: string) => {
    const i = idx.get(colName)
    if (i == null) return ""
    return (row[i] ?? "").trim()
  }

  const out: SettlementCsvRow[] = []

  for (const row of rows) {
    const barcode = get(row, input.mapping.barcode)
    const sold_qty = parseIntSafe(get(row, input.mapping.sold_qty))
    const amount = parseMoneySafe(get(row, input.mapping.amount))

    // 완전 빈 줄 skip
    if (!barcode && sold_qty === 0 && amount === 0) continue

    // amount-only 정책
    if (sold_qty <= 0 || amount <= 0) {
      out.push({
        store: input.storeName,
        period: input.periodMonth,
        barcode,
        sold_qty,
        unit_price: 0,
        currency: "KRW",
      })
      continue
    }

    const unit_price = Math.round(amount / sold_qty)

    out.push({
      store: input.storeName,
      period: input.periodMonth,
      barcode,
      sold_qty,
      unit_price,
      currency: "KRW",
    })
  }

  return out
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
  const [summaryCommissionRate, setSummaryCommissionRate] = useState("")
  const [applyToInventory, setApplyToInventory] = useState<boolean>(true)

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
  const [csvText, setCsvText] = useState<string>("")
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({
    barcode: "",
    sold_qty: "",
    amount: "",
  })

  const [selectedStoreId, setSelectedStoreId] = useState<string>("")
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  })

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
    const template =
      "barcode,sold_qty,amount\n" +
      "8801234567890,1,11000\n" +
      "8801234567891,3,18000\n" +
      "8801234567001,4,31600\n"

    downloadCsv("settlement_template.csv", template)
    toast.success("정산 CSV 템플릿을 다운로드했어요.")
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

  // ✅ CSV → 미리보기 생성
  const buildPreview = useCallback(
    (parsed: SettlementCsvRow[]) => {
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
        if (!barcode) {
          return { idx: i + 1, storeName, period, barcode, soldQty, unitPrice, currency, status: "error", error: "barcode가 비어있습니다." }
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

        const product = a.data.products.find((p: any) => String(p.barcode ?? "").trim() === barcode)
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
            status: "error",
            error: "바코드에 해당하는 제품이 없습니다. (제품 선택 또는 새 제품 만들기를 사용하세요)",
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
        }
      })

      setRows(next)
    },
    [a.data.products, a.data.stores]
  )

  // ✅ 파일 선택 → 텍스트 저장 + 헤더 추출 + 매핑 추정
  const onPickFile = useCallback(async (file: File) => {
    // ✅ 업로드 파일 기본 검증 (운영 안전장치)
    const MAX_BYTES = 5 * 1024 * 1024 // 5MB
    if (file.size > MAX_BYTES) {
      toast.error("CSV 파일이 너무 큽니다. 5MB 이하로 업로드해주세요.")
      return
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("CSV 파일(.csv)만 업로드할 수 있습니다.")
      return
    }
    try {
      const text = await file.text()
      const { headers } = parseCsvTextBasic(text)

      if (headers.length === 0) {
        toast.error("CSV 헤더를 읽지 못했습니다. 파일 형식을 확인하세요.")
        return
      }

      setCsvText(text)
      setCsvHeaders(headers)
      setRows(null)
      setLastFileName(file.name)

      const guessed: ColumnMapping = {
        barcode: guessHeader(headers, ["barcode", "바코드", "ean", "jan", "상품바코드"]) || "",
        sold_qty: guessHeader(headers, ["sold_qty", "qty", "수량", "판매수량", "매출수량", "판매량"]) || "",
        amount: guessHeader(headers, ["amount", "순매출", "매출액", "정산금", "금액"]) || "",
      }
      setMapping(guessed)

      toast.success("CSV를 불러왔어요. 컬럼 매핑을 확인한 뒤 미리보기를 생성하세요.")
    } catch (e: any) {
      console.error(e)
      toast.error(`CSV 읽기 실패: ${e?.message ?? e}`)
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
      csvText &&
      csvHeaders.length > 0 &&
      selectedStoreId &&
      selectedMonth &&
      mapping.barcode &&
      mapping.sold_qty &&
      mapping.amount
    )
  }, [csvText, csvHeaders.length, selectedStoreId, selectedMonth, mapping])

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
        csvText,
        mapping,
        storeName: String(store.name ?? "").trim(),
        periodMonth: selectedMonth,
      })

      if (parsed.length === 0) {
        toast.error("CSV에 데이터가 없습니다.")
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
  }, [canBuildPreview, csvText, mapping, buildPreview, a.data.stores, selectedStoreId, selectedMonth])

  async function saveSummarySettlement() {
    try {
      if (busy) return

      if (!summaryStoreId) {
        toast.error("입점처를 선택해줘")
        return
      }

      if (!summaryMonth) {
        toast.error("정산 월을 선택해줘")
        return
      }

      const grossAmount = Number(String(summaryGrossAmount).replaceAll(",", "").trim())

      if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
        toast.error("판매총액을 올바르게 입력해줘")
        return
      }

      if (grossAmount > 1000000000000) {
        toast.error("판매총액이 너무 커. 값을 다시 확인해줘")
        return
      }

      const commissionRatePercent = Number(
        String(summaryCommissionRate).replaceAll(",", "").trim()
      )

      if (!Number.isFinite(commissionRatePercent) || commissionRatePercent < 0 || commissionRatePercent > 100) {
        toast.error("수수료율은 0~100 사이로 입력해줘")
        return
      }

      const commissionRate = commissionRatePercent / 100
      const commissionAmount = Math.round(grossAmount * commissionRate)
      const netAmount = grossAmount - commissionAmount

      const saved = await upsertSettlementHeaderDB({
        marketplaceId: summaryStoreId,
        periodMonth: summaryMonth,
        currency: "KRW",
        grossAmount,
        commissionRate,
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
      setSummaryCommissionRate("")

      if (typeof (a as any).refresh === "function") {
        await (a as any).refresh()
      }

      if (onSaved) {
        await onSaved()
      }

      toast.success("판매총액 정산이 저장됐어")
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message ?? "판매총액 정산 저장 중 오류가 발생했어")
    }
  }

  /**
   * ✅ v2 저장
   * - 헤더 upsert
   * - 라인 delete+insert
   * - 재업로드(동일 월/입점처)도 안전하게 덮어씀
   * - 재고 반영은 옵션(델타 방식)
   */
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
      if (!cur) byStoreMonth.set(key, { storeId: r.storeId, month: r.period, storeName: r.storeName, rows: [r] })
      else cur.rows.push(r)
    }

    try {
      setBusy(true)

      // ✅ 재고 반영 확인은 apply 시작 시 1회만 (부분 적용/반복 confirm 방지)
      const shouldApplyInventory =
        applyToInventory ? window.confirm("판매 수량을 재고에 반영하시겠습니까?") : false

      for (const g of byStoreMonth.values()) {
        // === 1) old qty map ===
        const existing = await getSettlementV2ByMarketplaceMonthDB({
          marketplaceId: g.storeId,
          periodMonth: g.month,
        })

        const oldQty = new Map<string, number>()
        if (existing?.id) {
          const oldLines = await listSettlementLinesV2DB({ settlementId: existing.id })
          for (const l of oldLines) {
            const pid = String(l.product_id ?? "")
            if (!pid) continue
            const q = Number(l.qty_sold ?? 0)
            oldQty.set(pid, (oldQty.get(pid) ?? 0) + q)
          }
        }

        // === 2) new lines aggregate ===
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

        // === 3) commission rate ===
        let commissionRate = 0
        try {
          commissionRate = await getMarketplaceCommissionRateDB({ marketplaceId: g.storeId }) // 0.25 형태
        } catch {
          commissionRate = 0
        }
        if (!commissionRate) {
          const store = a.data.stores.find((s: any) => s.id === g.storeId)
          const pct = Number(store?.commissionRate ?? 0) || 0
          commissionRate = pct / 100
        }

        const commissionAmount = Math.round(grossAmount * commissionRate)
        const netAmount = grossAmount - commissionAmount

        // === 4) header upsert + replace lines ===
        const settlement = await upsertSettlementHeaderDB({
          marketplaceId: g.storeId,
          periodMonth: g.month,
          currency: "KRW",
          grossAmount,
          commissionRate,
          commissionAmount,
          netAmount,
          rowsCount: lines.length,
          sourceFilename: lastFileName || null,
          applyToInventory: shouldApplyInventory,
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

        // === 5) delta inventory apply (optional) ===
        if (shouldApplyInventory) {
          const newQty = new Map<string, number>()
          for (const l of lines) {
            const pid = String(l.productId ?? "")
            if (!pid) continue
            newQty.set(pid, (newQty.get(pid) ?? 0) + Number(l.qtySold ?? 0))
          }

          const allPids = new Set<string>([...oldQty.keys(), ...newQty.keys()])
          const updates: Array<{ storeId: string; productId: string; onHandQty: number }> = []

          for (const pid of allPids) {
            const oldQ = oldQty.get(pid) ?? 0
            const newQ = newQty.get(pid) ?? 0
            const delta = newQ - oldQ
            if (delta === 0) continue

            const inv = a.data.inventory.find((x: any) => x.storeId === g.storeId && x.productId === pid)
            const current = Number(inv?.onHandQty ?? 0)

            const nextQty = delta > 0 ? Math.max(0, current - delta) : current + Math.abs(delta)

            updates.push({ storeId: g.storeId, productId: pid, onHandQty: nextQty })
          }

          // ✅ 여기서 한 번에 업서트 (chunk는 내부에서 처리)
          await upsertInventoryItemsBatchDB(updates)
        }
      }

      toast.success(shouldApplyInventory ? "정산 저장 + 재고 반영 완료" : "정산 저장 완료 (재고 미반영)")
      setRows(null)
      setLastFileName("")
      setCsvText("")
      setCsvHeaders([])

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
        description="CSV 업로드 → 입점처/월 선택 → 컬럼 매핑(바코드/수량/금액) → 미리보기 → v2 정산 저장"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <AppButton type="button" variant="outline" onClick={templateDownload}>
              CSV 템플릿 다운로드
            </AppButton>

            <AppButton
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={a.loading || busy}
            >
              CSV 업로드
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
              accept=".csv"
              className="hidden"
              onChange={onChangeFile}
            />
          </div>
        }
        contentClassName="px-4 pb-4"
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

              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">
                  수수료율(%) <span className="text-destructive"> *</span>
                </span>
                <AppInput
                  inputMode="decimal"
                  placeholder="예: 30"
                  value={summaryCommissionRate}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^\d.]/g, "")
                    setSummaryCommissionRate(cleaned)
                  }}
                />
              </label>

              <div className="flex flex-wrap justify-end gap-2">
                <AppButton
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSummaryOpen(false)
                    setSummaryStoreId("")
                    setSummaryGrossAmount("")
                    setSummaryCommissionRate("")
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

        {csvHeaders.length > 0 && !rows ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AppBadge variant="secondary">헤더 {csvHeaders.length}개</AppBadge>
              {lastFileName ? <span className="text-xs text-muted-foreground">{lastFileName}</span> : null}
            </div>

            <div className="rounded-xl border p-4 space-y-3">
              <div className="text-sm font-medium">컬럼 매핑</div>

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
                  options={csvHeaders}
                  onChange={(v) => setMapping((m) => ({ ...m, barcode: v }))}
                />

                <SelectField
                  label="판매수량(sold_qty)"
                  required
                  value={mapping.sold_qty}
                  options={csvHeaders}
                  onChange={(v) => setMapping((m) => ({ ...m, sold_qty: v }))}
                />

                <SelectField
                  label="순매출(amount)"
                  required
                  value={mapping.amount}
                  options={csvHeaders}
                  onChange={(v) => setMapping((m) => ({ ...m, amount: v }))}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <AppButton
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCsvText("")
                    setCsvHeaders([])
                    setLastFileName("")
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
                              <span className="text-xs text-success">OK</span>
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

                                <PopoverContent align="start" className="p-0 w-[320px]">
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
                                            <div className="min-w-0">
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
        ) : csvHeaders.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="정산 CSV를 업로드하세요"
              description="업로드 후 컬럼 매핑을 하면, 미리보기에서 매칭 결과를 확인할 수 있어요."
            />
          </div>
        ) : null}
      </AppCard>

      {/* ✅ 정산에서 새 제품 만들기 */}
      <Dialog open={createOpen} onOpenChange={(open) => setCreateOpen(open)}>
        <DialogContent>
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
