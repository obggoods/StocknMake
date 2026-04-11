import { useEffect, useMemo, useState } from "react"
import PageHeader from "@/app/layout/PageHeader"
import { AppSection } from "@/components/app/AppSection"
import { AppCard } from "@/components/app/AppCard"
import { AppButton } from "@/components/app/AppButton"
import { AppInput } from "@/components/app/AppInput"

import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { Plus, Trash2, Edit2, Copy, Library, ArrowDownToLine, Check } from "lucide-react"

// ✅ 여기가 중요: 네 프로젝트의 실제 supabase 유틸 경로로 맞추기
import {
  listMyMarginProducts,
  upsertMyMarginProduct,
  deleteMyMarginProduct,
  listMyMaterialLibrary,
  upsertMyMaterialLibraryItem,
  deleteMyMaterialLibraryItem,
} from "@/lib/supabaseClient"

type Material = {
  id: string
  name: string
  unitPrice: number
  quantity: number
}

type LibraryItem = {
  id: string
  name: string
  unitPrice: number
  updatedAt: number
}

type Product = {
  id: string // ✅ DB row id(uuid)로 사용
  name: string
  memo?: string
  materials: Material[]

  hourlyRate: number
  productionPerHour: number
  laborInputMode: "perHour" | "perItem"
  minutesPerItem?: number

  outsourcingCost: number
  lossRate: number

  sellingPrice: number
  salesCommissionRate: number
  vatRate: number

  createdAt: number
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function uuid() {
  // modern browsers
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  // fallback (should not happen in modern Vite)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function clamp(n: number, min: number, max?: number) {
  const v = Number.isFinite(n) ? n : min
  const a = Math.max(min, v)
  return max === undefined ? a : Math.min(max, a)
}

function toNumber(input: string) {
  const cleaned = String(input ?? "").replace(/,/g, "").trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(n: number) {
  return `${Math.round(n).toLocaleString("ko-KR")}원`
}

function formatPercent(n: number) {
  return `${n.toFixed(1)}%`
}

function normName(v: string) {
  return String(v ?? "").trim().toLowerCase()
}

function migrateProduct(p: any): Product {
  const id = typeof p?.id === "string" && isUuid(p.id) ? p.id : uuid()

  return {
    id,
    name: String(p?.name ?? ""),
    memo: String(p?.memo ?? ""),

    materials: Array.isArray(p?.materials)
      ? p.materials.map((m: any) => ({
        id: typeof m?.id === "string" && isUuid(m.id) ? m.id : uuid(),
        name: String(m?.name ?? ""),
        unitPrice: clamp(Number(m?.unitPrice ?? m?.cost ?? 0), 0),
        quantity: clamp(Number(m?.quantity ?? 1), 0.0001),
      }))
      : [],

    hourlyRate: clamp(Number(p?.hourlyRate ?? 0), 0),
    productionPerHour: clamp(Number(p?.productionPerHour ?? 1), 0.0001),
    laborInputMode: p?.laborInputMode === "perItem" ? "perItem" : "perHour",
    minutesPerItem: clamp(Number(p?.minutesPerItem ?? 0), 0),

    outsourcingCost: clamp(Number(p?.outsourcingCost ?? 0), 0),
    lossRate: clamp(Number(p?.lossRate ?? 0), 0, 100),

    sellingPrice: clamp(Number(p?.sellingPrice ?? 0), 0),
    salesCommissionRate: clamp(Number(p?.salesCommissionRate ?? 0), 0, 100),
    vatRate: clamp(Number(p?.vatRate ?? 10), 0, 100),

    createdAt: Number(p?.createdAt ?? Date.now()),
  }
}

function calcMaterialCost(materials: Material[]) {
  return materials.reduce((sum, m) => sum + (m.unitPrice || 0) * (m.quantity || 0), 0)
}

function calcLaborCost(p: Product) {
  if (p.laborInputMode === "perItem") {
    const minutes = clamp(Number(p.minutesPerItem ?? 0), 0)
    const hoursPerItem = minutes / 60
    return p.hourlyRate * hoursPerItem
  }
  const perHour = clamp(p.productionPerHour, 0.0001)
  return p.hourlyRate / perHour
}

function calcCOGS(p: Product) {
  const materials = calcMaterialCost(p.materials)
  const labor = calcLaborCost(p)
  const base = materials + labor + p.outsourcingCost
  const lossMultiplier = 1 + clamp(p.lossRate, 0, 100) / 100
  return base * lossMultiplier
}

function calcCommission(p: Product) {
  return p.sellingPrice * (clamp(p.salesCommissionRate, 0, 100) / 100)
}

function calcVat(p: Product) {
  return p.sellingPrice * (clamp(p.vatRate, 0, 100) / 100)
}

function calcProfit(p: Product) {
  const cogs = calcCOGS(p)
  const commission = calcCommission(p)
  const vat = calcVat(p)
  return p.sellingPrice - cogs - commission - vat
}

function calcMarginRate(p: Product) {
  if (p.sellingPrice <= 0) return 0
  return (calcProfit(p) / p.sellingPrice) * 100
}

function emptyProduct(): Product {
  return {
    id: uuid(),
    name: "",
    memo: "",
    materials: [],
    hourlyRate: 0,
    productionPerHour: 1,
    laborInputMode: "perHour",
    minutesPerItem: 0,
    outsourcingCost: 0,
    lossRate: 0,
    sellingPrice: 0,
    salesCommissionRate: 0,
    vatRate: 10,
    createdAt: Date.now(),
  }
}

type MarginAssessment = {
  level: "danger" | "warn" | "good"
  label: string
  message: string
}

function assessMargin(marginRate: number): MarginAssessment {
  if (marginRate < 0) {
    return {
      level: "danger",
      label: "적자",
      message: "원가/수수료/VAT가 판매가를 초과합니다. 판매가 인상 또는 원가 절감이 필요합니다.",
    }
  }
  if (marginRate < 10) {
    return {
      level: "danger",
      label: "위험",
      message: "마진이 매우 낮습니다. 반품/할인/변동비를 고려하면 손익이 쉽게 무너집니다.",
    }
  }
  if (marginRate < 20) {
    return {
      level: "warn",
      label: "보통",
      message: "기본은 되지만 이벤트/광고/CS 비용을 포함하면 타이트할 수 있습니다.",
    }
  }
  if (marginRate < 35) {
    return {
      level: "good",
      label: "양호",
      message: "운영비/할인 여력까지 고려해 비교적 안정적인 구간입니다.",
    }
  }
  return {
    level: "good",
    label: "매우 좋음",
    message: "충분한 여력이 있습니다. 다만 가격경쟁력/수요탄력도도 함께 확인하세요.",
  }
}

function badgeClasses(level: MarginAssessment["level"]) {
  if (level === "danger") {
    return "bg-destructive/10 text-destructive border-destructive/20"
  }

  if (level === "warn") {
    return "bg-warning/10 text-warning border-warning/20"
  }

  return "bg-success/10 text-success border-success/20"
}

export default function MarginCalculatorPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [library, setLibrary] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)

  const [draft, setDraft] = useState<Product>(() => emptyProduct())

  const [newMaterialName, setNewMaterialName] = useState("")
  const [newMaterialUnitPrice, setNewMaterialUnitPrice] = useState("")
  const [newMaterialQty, setNewMaterialQty] = useState("1")

  const [libSearch, setLibSearch] = useState("")
  const [libUnitPriceEdit, setLibUnitPriceEdit] = useState<Record<string, string>>({})

  // ✅ 제품 입력 탭에서 "라이브러리 검색 후 즉시 추가"용
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false)
  const [libraryPickerQuery, setLibraryPickerQuery] = useState("")

  // ✅ 라이브러리에서 + 눌렀을 때 잠깐 하이라이트
  const [lastAddedLibraryId, setLastAddedLibraryId] = useState<string | null>(null)

  // ✅ 초기 로드: DB에서 products/library 가져오기
  useEffect(() => {
    let alive = true

      ; (async () => {
        try {
          setLoading(true)
          setLoadError(null)

          const [pRows, lRows] = await Promise.all([
            listMyMarginProducts(),
            listMyMaterialLibrary(),
          ])

          if (!alive) return

          const p = (pRows ?? []).map((row: any) => {
            // row.data 안에 Product 형태를 저장하고, row.id를 최종 id로 사용
            const base = migrateProduct(row.data ?? {})
            return {
              ...base,
              id: row.id,
              name: row.name ?? base.name,
              memo: row.memo ?? base.memo ?? "",
              createdAt: base.createdAt ?? Date.now(),
            } as Product
          })

          const l = (lRows ?? []).map((row: any) => {
            const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
            return {
              id: row.id,
              name: String(row.name ?? "").trim(),
              unitPrice: clamp(Number(row.unit_price ?? 0), 0),
              updatedAt,
            } as LibraryItem
          })

          setProducts(p)
          setLibrary(l)

          // lib edit input init
          const init: Record<string, string> = {}
          l.forEach((it) => (init[it.id] = String(it.unitPrice)))
          setLibUnitPriceEdit(init)
        } catch (e: any) {
          if (!alive) return
          setLoadError(e?.message ?? "데이터를 불러오지 못했습니다.")
        } finally {
          if (!alive) return
          setLoading(false)
        }
      })()

    return () => {
      alive = false
    }
  }, [])

  const sortedProducts = useMemo(() => {
    return [...products].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [products])

  const sortedLibrary = useMemo(() => {
    const q = libSearch.trim().toLowerCase()
    const filtered = q ? library.filter((x) => x.name.toLowerCase().includes(q)) : library
    return [...filtered].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [library, libSearch])

  // ✅ 라이브러리에 이미 존재하는 재료면(이름 기준) 제품 입력 탭에서 “저장(다운로드)” 버튼을 숨김
  const libraryNameSet = useMemo(() => {
    const s = new Set<string>()
    for (const it of library) s.add(normName(it.name))
    return s
  }, [library])

  const openCreate = () => {
    setEditing(null)
    setDraft(emptyProduct())
    setNewMaterialName("")
    setNewMaterialUnitPrice("")
    setNewMaterialQty("1")
    setDialogOpen(true)
  }

  const openEdit = (p: Product) => {
    setEditing(p)
    setDraft(migrateProduct(p))
    setNewMaterialName("")
    setNewMaterialUnitPrice("")
    setNewMaterialQty("1")
    setDialogOpen(true)
  }

  // ✅ 저장: DB upsert → state 반영
  const saveDraft = async () => {
    const normalized = migrateProduct({
      ...draft,
      createdAt: editing ? editing.createdAt : Date.now(),
    })
    if (!normalized.name.trim()) return

    const row = await upsertMyMarginProduct({
      id: editing ? editing.id : undefined, // ✅ DB id(uuid)
      name: normalized.name,
      memo: normalized.memo ?? "",
      data: normalized, // ✅ JSON 통째 저장
    })

    // DB에서 내려준 id로 확정
    const saved: Product = {
      ...normalized,
      id: row.id,
      name: row.name ?? normalized.name,
      memo: row.memo ?? normalized.memo ?? "",
    }

    setProducts((prev) => {
      const exists = prev.some((x) => x.id === saved.id)
      if (exists) return prev.map((x) => (x.id === saved.id ? saved : x))
      return [saved, ...prev]
    })

    setDialogOpen(false)
  }

  const deleteProduct = async (id: string) => {
    await deleteMyMarginProduct(id)
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  const duplicateProduct = async (p: Product) => {
    const copy: Product = {
      ...migrateProduct(p),
      id: uuid(), // 임시(저장 시 DB id로 바뀜)
      name: `${p.name} (복사본)`,
      createdAt: Date.now(),
    }

    const row = await upsertMyMarginProduct({
      // 새로 만들기라 id 생략
      name: copy.name,
      memo: copy.memo ?? "",
      data: copy,
    })

    const saved: Product = { ...copy, id: row.id }
    setProducts((prev) => [saved, ...prev])
  }

  const addMaterialToDraft = (name?: string, unitPrice?: number) => {
    const n = String(name ?? newMaterialName).trim()
    if (!n) return

    const up = clamp(unitPrice ?? toNumber(newMaterialUnitPrice), 0)
    const qty = clamp(toNumber(newMaterialQty), 0.0001)

    const m: Material = { id: uuid(), name: n, unitPrice: up, quantity: qty }
    setDraft((prev) => ({ ...prev, materials: [...prev.materials, m] }))

    if (!name) {
      setNewMaterialName("")
      setNewMaterialUnitPrice("")
      setNewMaterialQty("1")
    }
  }

  const updateMaterial = (id: string, patch: Partial<Material>) => {
    setDraft((prev) => ({
      ...prev,
      materials: prev.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }))
  }

  const removeMaterial = (id: string) => {
    setDraft((prev) => ({ ...prev, materials: prev.materials.filter((m) => m.id !== id) }))
  }

  // ✅ 라이브러리: DB upsert + state 반영
  const upsertLibraryItem = async (name: string, unitPrice: number) => {
    const n = name.trim()
    if (!n) return

    const row = await upsertMyMaterialLibraryItem({ name: n, unitPrice: clamp(unitPrice, 0) })

    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
    const saved: LibraryItem = {
      id: row.id,
      name: row.name,
      unitPrice: clamp(Number(row.unit_price ?? 0), 0),
      updatedAt,
    }

    setLibrary((prev) => {
      const exists = prev.some((x) => x.id === saved.id)
      if (exists) return prev.map((x) => (x.id === saved.id ? saved : x))
      return [saved, ...prev]
    })

    setLibUnitPriceEdit((m) => ({ ...m, [saved.id]: String(saved.unitPrice) }))
  }

  const deleteLibraryItem = async (id: string) => {
    await deleteMyMaterialLibraryItem(id)
    setLibrary((prev) => prev.filter((x) => x.id !== id))
    setLibUnitPriceEdit((m) => {
      const copy = { ...m }
      delete copy[id]
      return copy
    })
  }

  const addDraftMaterialToLibrary = async (m: Material) => {
    await upsertLibraryItem(m.name, m.unitPrice)
  }

  const addFromLibraryToDraft = (it: LibraryItem) => {
    // ✅ 클릭 피드백(짧게 색 변경)
    setLastAddedLibraryId(it.id)
    window.setTimeout(() => setLastAddedLibraryId((cur) => (cur === it.id ? null : cur)), 700)

    addMaterialToDraft(String(it.name), it.unitPrice)
  }

  const saveLibraryUnitPrice = async (it: LibraryItem) => {
    const raw = libUnitPriceEdit[it.id] ?? String(it.unitPrice)
    const v = clamp(toNumber(raw), 0)
    await upsertLibraryItem(it.name, v)
  }

  const draftSummary = useMemo(() => {
    const cogs = calcCOGS(draft)
    const commission = calcCommission(draft)
    const vat = calcVat(draft)
    const profit = calcProfit(draft)
    const margin = calcMarginRate(draft)
    const assessment = assessMargin(margin)
    return { cogs, commission, vat, profit, margin, assessment }
  }, [draft])

  return (
    <AppSection>
      <PageHeader
        title="마진 계산기"
        description="제품별 원가·수수료·VAT를 기준으로 마진을 계산하고 저장합니다."
      />

      {loadError ? (
        <div className="mb-4 rounded-lg border p-4 text-sm">
          <div className="font-medium">불러오기 오류</div>
          <div className="text-muted-foreground mt-1">{loadError}</div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AppCard
          title="저장된 제품"
          description={
            loading ? "불러오는 중..." : (sortedProducts.length ? `총 ${sortedProducts.length}개` : "아직 저장된 제품이 없습니다.")
          }
        >
          {loading ? (
            <div className="text-sm text-muted-foreground">로딩 중...</div>
          ) : sortedProducts.length === 0 ? (
            <div className="text-sm text-muted-foreground">오른쪽의 “새로 만들기”로 시작하세요.</div>
          ) : (
            <div className="space-y-4">
              {sortedProducts.map((p) => {
                const cogs = calcCOGS(p)
                const profit = calcProfit(p)
                const margin = calcMarginRate(p)
                const assessment = assessMargin(margin)

                return (
                  <div key={p.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate">{p.name}</div>
                          <span className={`text-xs px-2 py-0.5 rounded border ${badgeClasses(assessment.level)}`}>
                            {assessment.label}
                          </span>
                        </div>
                        {p.memo ? (
                          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.memo}</div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <AppButton variant="secondary" size="sm" onClick={() => void duplicateProduct(p)}>
                          <Copy className="h-4 w-4" />
                        </AppButton>
                        <AppButton variant="secondary" size="sm" onClick={() => openEdit(p)}>
                          <Edit2 className="h-4 w-4" />
                        </AppButton>
                        <AppButton variant="destructive" size="sm" onClick={() => void deleteProduct(p.id)}>
                          <Trash2 className="h-4 w-4" />
                        </AppButton>
                      </div>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-muted-foreground">판매가</div>
                        <div className="font-medium">{formatCurrency(p.sellingPrice)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">총원가(COGS)</div>
                        <div className="font-medium">{formatCurrency(cogs)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">이익</div>
                        <div className="font-medium">{formatCurrency(profit)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">마진율</div>
                        <div className="font-medium">{formatPercent(margin)}</div>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground">{assessment.message}</div>
                  </div>
                )
              })}
            </div>
          )}
        </AppCard>

        <AppCard
          title="계산/저장"
          description="제품을 추가하거나 편집합니다. (DB에 저장됩니다)"
          action={
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <AppButton variant="secondary" onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  새로 만들기
                </AppButton>
              </DialogTrigger>

              {/*
                ✅ UX: 데스크탑/모바일 모두에서 저장 버튼이 가려지지 않도록
                - 뷰포트 기준 높이를 제한(max-h)
                - 모달 내부 스크롤 허용(overflow-y-auto)
              */}
              <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto p-6 pb-24">
                <DialogHeader>
                  <DialogTitle>{editing ? "제품 편집" : "제품 추가"}</DialogTitle>
                </DialogHeader>

                <Tabs defaultValue="product" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="product">제품 입력</TabsTrigger>
                    <TabsTrigger value="library">
                      <Library className="mr-2 h-4 w-4" />
                      원부자재 라이브러리
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="product" className="space-y-6 pt-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>제품명</Label>
                        <AppInput
                          value={draft.name}
                          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                          placeholder="예: 카드지갑"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>메모(선택)</Label>
                        <AppInput
                          value={draft.memo ?? ""}
                          onChange={(e) => setDraft((p) => ({ ...p, memo: e.target.value }))}
                          placeholder="예: 원단 A + 부자재 B"
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="font-medium text-sm">재료/부자재</div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="space-y-2 md:col-span-2">
                          <Label>이름</Label>
                          <AppInput
                            className="w-full h-8 px-2 text-sm"
                            value={newMaterialName}
                            onChange={(e) => setNewMaterialName(e.target.value)}
                            placeholder="예: 원단"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>단가</Label>
                          <AppInput
                            className="w-full h-8 px-2 text-sm"
                            inputMode="numeric"
                            value={newMaterialUnitPrice}
                            onChange={(e) => setNewMaterialUnitPrice(e.target.value)}
                            placeholder="예: 2500"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>수량</Label>
                          <AppInput
                            className="w-full h-8 px-2 text-sm"
                            inputMode="decimal"
                            value={newMaterialQty}
                            onChange={(e) => setNewMaterialQty(e.target.value)}
                            placeholder="예: 0.5"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        {/* ✅ 제품 입력 탭에서도 라이브러리에서 바로 검색 후 추가 */}
                        <Popover open={libraryPickerOpen} onOpenChange={setLibraryPickerOpen}>
                          <PopoverTrigger asChild>
                            <AppButton variant="secondary" type="button">
                              <Library className="mr-2 h-4 w-4" />
                              라이브러리
                            </AppButton>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-[360px] p-0">
                            <Command>
                              <CommandInput
                                value={libraryPickerQuery}
                                onValueChange={setLibraryPickerQuery}
                                placeholder="저장된 재료 검색..."
                              />
                              <CommandList>
                                <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
                                <CommandGroup heading={`저장된 재료 (${library.length})`}>
                                  {(libraryPickerQuery.trim()
                                    ? library.filter((x) => x.name.toLowerCase().includes(libraryPickerQuery.trim().toLowerCase()))
                                    : library
                                  )
                                    .slice(0, 50)
                                    .map((it) => (
                                      <CommandItem
                                        key={it.id}
                                        value={`${it.name} ${it.unitPrice}`}
                                        onSelect={() => {
                                          addMaterialToDraft(String(it.name), it.unitPrice)
                                          setLibraryPickerOpen(false)
                                          setLibraryPickerQuery("")
                                          setLastAddedLibraryId(it.id)
                                          window.setTimeout(
                                            () => setLastAddedLibraryId((cur) => (cur === it.id ? null : cur)),
                                            700
                                          )
                                        }}
                                      >
                                        <div className="flex w-full items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            <div className="truncate font-medium">{it.name}</div>
                                            <div className="truncate text-xs text-muted-foreground">{formatCurrency(it.unitPrice)}</div>
                                          </div>
                                          <div className="text-xs text-muted-foreground">추가</div>
                                        </div>
                                      </CommandItem>
                                    ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>

                        <AppButton variant="secondary" onClick={() => addMaterialToDraft()}>
                          <Plus className="mr-2 h-4 w-4" />
                          재료 추가
                        </AppButton>
                      </div>

                      {draft.materials.length ? (
                        <div className="rounded-lg border overflow-hidden">
                          <Table className="w-full table-fixed">
                            <colgroup>
                              <col style={{ width: "48%" }} />   {/* 이름 ↑ */}
                              <col style={{ width: "80px" }} />  {/* 단가 ↓ */}
                              <col style={{ width: "48px" }} />  {/* 수량 ↓ */}
                              <col style={{ width: "80px" }} />  {/* 합계 (유지) */}
                              <col style={{ width: "72px" }} />  {/* 라이브러리 ↓ */}
                              <col style={{ width: "44px" }} />  {/* 삭제 ↓ */}
                            </colgroup>

                            <TableHeader>
                              <TableRow>
                                <TableHead>이름</TableHead>
                                <TableHead>단가</TableHead>
                                <TableHead>수량</TableHead>
                                <TableHead className="text-right">합계</TableHead>
                                <TableHead className="text-right">라이브러리</TableHead>
                                <TableHead />
                              </TableRow>
                            </TableHeader>

                            <TableBody>
                              {draft.materials.map((m) => {
                                const total = (m.unitPrice || 0) * (m.quantity || 0)
                                return (
                                  <TableRow key={m.id}>
                                    <TableCell className="py-2 px-2">
                                      <AppInput
                                        className="w-full h-8 px-2 text-sm"
                                        value={m.name}
                                        placeholder="예: 원단"
                                        onChange={(e) => updateMaterial(m.id, { name: e.target.value })}
                                      />
                                    </TableCell>

                                    <TableCell className="py-2 px-2">
                                      <AppInput
                                        className="w-full h-8 px-2 text-sm"
                                        inputMode="numeric"
                                        value={String(m.unitPrice)}
                                        onChange={(e) =>
                                          updateMaterial(m.id, { unitPrice: clamp(toNumber(e.target.value), 0) })
                                        }
                                      />
                                    </TableCell>

                                    <TableCell className="py-2 px-2">
                                      <AppInput
                                        className="w-full h-8 px-2 text-sm text-center"
                                        inputMode="decimal"
                                        value={String(Number(m.quantity) || 0)}   // ✅ 무조건 숫자 문자열로 렌더링
                                        onChange={(e) => {
                                          const n = clamp(toNumber(e.target.value), 0.0001)
                                          updateMaterial(m.id, { quantity: n })    // ✅ state에는 number만 저장
                                        }}
                                      />
                                    </TableCell>

                                    <TableCell className="py-2 px-2 text-right text-sm">
                                      {formatCurrency(total)}
                                    </TableCell>

                                    <TableCell className="py-2 px-2 text-center align-middle">
                                      {libraryNameSet.has(normName(m.name)) ? (
                                        <Check className="h-4 w-4 text-muted-foreground inline-block" />
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => void addDraftMaterialToLibrary(m)}
                                          title="라이브러리에 저장"
                                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                        >
                                          <ArrowDownToLine className="h-4 w-4" />
                                        </button>
                                      )}
                                    </TableCell>

                                    <TableCell className="py-2 px-2 text-center align-middle">
                                      <button
                                        type="button"
                                        onClick={() => removeMaterial(m.id)}
                                        title="삭제"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">재료를 추가하세요.</div>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <div className="font-medium text-sm">인건비</div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label>시급</Label>
                          <AppInput
                            inputMode="numeric"
                            value={String(draft.hourlyRate)}
                            onChange={(e) => setDraft((p) => ({ ...p, hourlyRate: clamp(toNumber(e.target.value), 0) }))}
                            placeholder="예: 12000"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>입력 방식</Label>
                          {/* 좁은 폭/특정 줌에서 버튼이 겹치지 않도록 wrap */}
                          <div className="flex flex-wrap gap-2">
                            <AppButton
                              variant={draft.laborInputMode === "perHour" ? "default" : "secondary"}
                              size="sm"
                              onClick={() => setDraft((p) => ({ ...p, laborInputMode: "perHour" }))}
                            >
                              시간당 생산량
                            </AppButton>
                            <AppButton
                              variant={draft.laborInputMode === "perItem" ? "default" : "secondary"}
                              size="sm"
                              onClick={() => setDraft((p) => ({ ...p, laborInputMode: "perItem" }))}
                            >
                              개당 소요시간
                            </AppButton>
                          </div>
                        </div>

                        {draft.laborInputMode === "perHour" ? (
                          <div className="space-y-2">
                            <Label>시간당 생산량(개)</Label>
                            <AppInput
                              inputMode="decimal"
                              value={String(draft.productionPerHour)}
                              onChange={(e) => setDraft((p) => ({ ...p, productionPerHour: clamp(toNumber(e.target.value), 0.0001) }))}
                              placeholder="예: 2"
                            />
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <Label>개당 소요시간(분)</Label>
                            <AppInput
                              inputMode="decimal"
                              value={String(draft.minutesPerItem ?? 0)}
                              onChange={(e) => setDraft((p) => ({ ...p, minutesPerItem: clamp(toNumber(e.target.value), 0) }))}
                              placeholder="예: 15"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>외주/가공비(개당)</Label>
                        <AppInput
                          inputMode="numeric"
                          value={String(draft.outsourcingCost)}
                          onChange={(e) => setDraft((p) => ({ ...p, outsourcingCost: clamp(toNumber(e.target.value), 0) }))}
                          placeholder="예: 0"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>로스율(%)</Label>
                        <AppInput
                          inputMode="decimal"
                          value={String(draft.lossRate)}
                          onChange={(e) => setDraft((p) => ({ ...p, lossRate: clamp(toNumber(e.target.value), 0, 100) }))}
                          placeholder="예: 5"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>판매가</Label>
                        <AppInput
                          inputMode="numeric"
                          value={String(draft.sellingPrice)}
                          onChange={(e) => setDraft((p) => ({ ...p, sellingPrice: clamp(toNumber(e.target.value), 0) }))}
                          placeholder="예: 30000"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>판매수수료율(%)</Label>
                        <AppInput
                          inputMode="decimal"
                          value={String(draft.salesCommissionRate)}
                          onChange={(e) => setDraft((p) => ({ ...p, salesCommissionRate: clamp(toNumber(e.target.value), 0, 100) }))}
                          placeholder="예: 10"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>VAT(%)</Label>
                        <AppInput
                          inputMode="decimal"
                          value={String(draft.vatRate)}
                          onChange={(e) => setDraft((p) => ({ ...p, vatRate: clamp(toNumber(e.target.value), 0, 100) }))}
                          placeholder="예: 10"
                        />
                      </div>
                    </div>

                    <div className="rounded-lg bg-muted/40 p-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">미리보기</div>
                        <span className={`text-xs px-2 py-0.5 rounded border ${badgeClasses(draftSummary.assessment.level)}`}>
                          {draftSummary.assessment.label}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-muted-foreground">총원가(COGS)</div>
                          <div className="font-medium">{formatCurrency(draftSummary.cogs)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">수수료</div>
                          <div className="font-medium">{formatCurrency(draftSummary.commission)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">VAT</div>
                          <div className="font-medium">{formatCurrency(draftSummary.vat)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">이익 / 마진율</div>
                          <div className="font-medium">
                            {formatCurrency(draftSummary.profit)} · {formatPercent(draftSummary.margin)}
                          </div>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground">{draftSummary.assessment.message}</div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <AppButton variant="secondary" onClick={() => setDialogOpen(false)}>
                        취소
                      </AppButton>
                      <AppButton onClick={() => void saveDraft()} disabled={!draft.name.trim()}>
                        저장
                      </AppButton>
                    </div>
                  </TabsContent>

                  <TabsContent value="library" className="space-y-4 pt-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="md:col-span-2 space-y-2">
                        <Label>검색</Label>
                        <AppInput value={libSearch} onChange={(e) => setLibSearch(e.target.value)} placeholder="예: 원단, 지퍼, 라벨..." />
                      </div>
                      <div className="space-y-2">
                        <Label>빠른 추가 (이름)</Label>
                        <AppInput value={newMaterialName} onChange={(e) => setNewMaterialName(e.target.value)} placeholder="예: 지퍼" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>빠른 추가 (단가)</Label>
                        <AppInput inputMode="numeric" value={newMaterialUnitPrice} onChange={(e) => setNewMaterialUnitPrice(e.target.value)} placeholder="예: 300" />
                      </div>
                      <div className="space-y-2">
                        <Label>빠른 추가 (수량)</Label>
                        <AppInput inputMode="decimal" value={newMaterialQty} onChange={(e) => setNewMaterialQty(e.target.value)} placeholder="예: 1" />
                      </div>
                      {/* 풀스크린/중간 폭에서 버튼이 겹치지 않도록: 버튼 영역을 한 줄 전체로 사용 + wrap */}
                      <div className="md:col-span-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end">
                        <AppButton
                          variant="secondary"
                          onClick={() => {
                            const name = newMaterialName.trim()
                            const price = clamp(toNumber(newMaterialUnitPrice), 0)
                            if (!name) return
                            void upsertLibraryItem(name, price)
                          }}
                          title="이름 기준으로 라이브러리에 저장/갱신"
                          className="w-full sm:w-auto"
                        >
                          <ArrowDownToLine className="mr-2 h-4 w-4" />
                          라이브러리 저장
                        </AppButton>

                        <AppButton
                          onClick={() => {
                            const name = newMaterialName.trim()
                            const price = clamp(toNumber(newMaterialUnitPrice), 0)
                            if (!name) return
                            // ✅ 클릭 피드백용(라이브러리 테이블 하이라이트와 동일)
                            setLastAddedLibraryId("quick-add")
                            window.setTimeout(() => setLastAddedLibraryId((cur) => (cur === "quick-add" ? null : cur)), 700)

                            addMaterialToDraft(name, price)
                          }}
                          title="현재 수량으로 제품 재료에 추가"
                          variant={lastAddedLibraryId === "quick-add" ? "default" : "default"}
                          className="w-full sm:w-auto"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          제품에 추가
                        </AppButton>
                      </div>
                    </div>

                    <Separator />

                    {sortedLibrary.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        아직 라이브러리가 비어 있습니다. 제품 재료에서 “라이브러리 저장” 버튼으로 쌓아두세요.
                      </div>
                    ) : (
                      <div className="rounded-lg border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>이름</TableHead>
                              <TableHead className="w-44">단가</TableHead>
                              <TableHead className="w-24 text-right">추가</TableHead>
                              <TableHead className="w-16"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedLibrary.map((it) => (
                              <TableRow key={it.id}>
                                <TableCell className="font-medium">{it.name}</TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <AppInput
                                      inputMode="numeric"
                                      className="w-full sm:w-40"
                                      value={libUnitPriceEdit[it.id] ?? String(it.unitPrice)}
                                      onChange={(e) => setLibUnitPriceEdit((m) => ({ ...m, [it.id]: e.target.value }))}
                                    />
                                    <AppButton variant="secondary" size="sm" className="self-end sm:self-auto" onClick={() => void saveLibraryUnitPrice(it)}>
                                      저장
                                    </AppButton>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <AppButton
                                    variant={lastAddedLibraryId === it.id ? "default" : "secondary"}
                                    size="sm"
                                    onClick={() => addFromLibraryToDraft(it)}
                                    title="현재 수량으로 제품 재료에 추가"
                                  >
                                    <Plus className="h-4 w-4" />
                                  </AppButton>
                                </TableCell>
                                <TableCell className="text-right">
                                  <AppButton variant="destructive" size="sm" onClick={() => void deleteLibraryItem(it.id)}>
                                    <Trash2 className="h-4 w-4" />
                                  </AppButton>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>
          }
        >
          <div className="space-y-4 text-sm">
            <div className="text-muted-foreground">
              “새로 만들기”로 계산하고 저장하세요. 저장 데이터는 이제 Supabase(DB)에 저장됩니다.
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="font-medium">계산 기준</div>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>총원가(COGS) = (재료 + 인건비 + 외주/가공비) × (1 + 로스율)</li>
                <li>이익 = 판매가 - 총원가 - 수수료 - VAT</li>
                <li>마진율 = 이익 ÷ 판매가</li>
              </ul>
            </div>
          </div>
        </AppCard>
      </div>
    </AppSection>
  )
}
