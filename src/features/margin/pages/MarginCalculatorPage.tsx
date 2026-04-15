import { useEffect, useMemo, useState, useRef } from "react"
import PageHeader from "@/app/layout/PageHeader"
import { AppSection } from "@/components/app/AppSection"
import { AppCard } from "@/components/app/AppCard"
import { AppButton } from "@/components/app/AppButton"
import { AppInput } from "@/components/app/AppInput"
import { Label } from "@/components/ui/label"
import { toast } from "@/lib/toast"
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
import CostSimulationCard from "@/features/margin/components/CostSimulationCard"
import { Plus, Trash2, Edit2, Copy, Library, ArrowDownToLine, Check } from "lucide-react"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
// ✅ 여기가 중요: 네 프로젝트의 실제 supabase 유틸 경로로 맞추기
import {
  listMyMarginProducts,
  upsertMyMarginProduct,
  deleteMyMarginProduct,
  listMyMaterialLibrary,
  upsertMyMaterialLibraryItem,
  deleteMyMaterialLibraryItem,
} from "@/lib/supabaseClient"

import { supabase } from "@/lib/supabaseClient"
import MarginRowActions from "@/features/margin/components/MarginRowActions"
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

  targetType?: "product" | "category" | null
  targetKey?: string
  targetLabel?: string
  linkedStoreId?: string

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
    targetType:
      p?.targetType === "product" || p?.targetType === "category"
        ? p.targetType
        : null,
    targetKey: String(p?.targetKey ?? ""),
    targetLabel: String(p?.targetLabel ?? ""),
    linkedStoreId: String(p?.linkedStoreId ?? ""),
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
    targetType: null,
    targetKey: "",
    targetLabel: "",
    linkedStoreId: "",
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

const ITEMS_PER_PAGE = 10

export default function MarginCalculatorPage(props?: {
  embedded?: boolean
  onSaved?: () => void
}) {
  const [marginProducts, setMarginProducts] = useState<Product[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [stores, setStores] = useState<any[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState<string>("")
  const [simulationProfileId, setSimulationProfileId] = useState<string>("")
  const [manualCommissionRate, setManualCommissionRate] = useState<string>("")
  const [library, setLibrary] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  useEffect(() => {
    if (props?.embedded) {
      openCreate()
    }
  }, [])
  const [editing, setEditing] = useState<Product | null>(null)
  const [isReadOnly, setIsReadOnly] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string>("")
  const [draft, setDraft] = useState<Product>(() => emptyProduct())
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>("")
  const [listQuery, setListQuery] = useState("")
  const [listCategoryFilter, setListCategoryFilter] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [deleteTargetId, setDeleteTargetId] = useState<string>("")
  const [deleteTargetName, setDeleteTargetName] = useState<string>("")
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

  useEffect(() => {
    let alive = true

      ; (async () => {
        try {
          setLoading(true)
          setLoadError(null)

          const [pRows, lRows]: any = await Promise.all([
            listMyMarginProducts(),
            listMyMaterialLibrary(),
          ])

          if (!alive) return

          const margin = (pRows ?? []).map((row: any) => {
            const base = migrateProduct(row.data ?? {})
            return {
              ...base,
              id: row.id,
              name: row.name ?? base.name,
              memo: row.memo ?? base.memo ?? "",
              createdAt: base.createdAt ?? Date.now(),
            } as Product
          })

          const lib = (lRows ?? []).map((row: any) => {
            const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
            return {
              id: row.id,
              name: String(row.name ?? "").trim(),
              unitPrice: clamp(Number(row.unit_price ?? 0), 0),
              updatedAt,
            } as LibraryItem
          })

          setMarginProducts(margin)
          setLibrary(lib)

          const { data: productData } = await supabase
            .from("products")
            .select("id, name, category")

          const { data: storeData } = await supabase
            .from("stores")
            .select("id, name, commission_rate")

          setProducts(productData ?? [])
          setStores(storeData ?? [])

          const uniqueCategories = Array.from(
            new Set((productData ?? []).map((p: any) => p.category).filter(Boolean))
          )

          setCategories(uniqueCategories)

          const init: Record<string, string> = {}
          lib.forEach((it: LibraryItem) => {
            init[it.id] = String(it.unitPrice)
          })
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

  const saveDraft = async () => {
    if (saving) return

    const targetType = selectedProductId
      ? "product"
      : selectedCategory
        ? "category"
        : null

    const targetKey = selectedProductId || selectedCategory || ""

    const targetLabel =
      targetType === "product"
        ? products.find((x: any) => String(x.id) === String(selectedProductId))?.name ?? ""
        : targetType === "category"
          ? selectedCategory
          : ""

    const normalized = migrateProduct({
      ...draft,
      targetType,
      targetKey,
      targetLabel,
      linkedStoreId: selectedStoreId || "",
      createdAt: editing ? editing.createdAt : Date.now(),
    })

    if (!normalized.name.trim()) return

    try {
      setSaving(true)

      // 1) 마진 계산기 자체 목록 저장
      const row = await upsertMyMarginProduct({
        id: editing ? editing.id : undefined,
        name: normalized.name,
        memo: normalized.memo ?? "",
        data: normalized,
      })

      // 2) 현재 로그인 사용자 확인
      const { data: userData } = await supabase.auth.getUser()
      const user = userData.user
      if (!user) throw new Error("로그인 필요")

      const materialCost = calcMaterialCost(normalized.materials)
      const laborCost = calcLaborCost(normalized)
      const totalCost = calcCOGS(normalized)

      // 4) 타겟이 있는 경우: 기존 타겟이 있으면 update, 없으면 insert
      if (targetType && targetKey) {
        const { data: existingTarget, error: existingTargetError } = await supabase
          .from("margin_profile_targets")
          .select("id, profile_id")
          .eq("user_id", user.id)
          .eq("target_type", targetType)
          .eq("target_key", targetKey)
          .maybeSingle()

        if (existingTargetError) throw existingTargetError

        if (existingTarget?.profile_id) {
          // 이미 같은 카테고리/제품 공통 마진이 있으면 기존 profile 수정
          const { error: updateProfileError } = await supabase
            .from("margin_profiles")
            .update({
              name: normalized.name,
              memo: normalized.memo ?? "",
              material_cost: materialCost,
              labor_cost: laborCost,
              overhead_cost: normalized.outsourcingCost,
              loss_rate: normalized.lossRate,
              total_cost: totalCost,
            })
            .eq("id", existingTarget.profile_id)
            .eq("user_id", user.id)

          if (updateProfileError) throw updateProfileError
        } else {
          // 없으면 새 profile 생성 후 target 연결
          const { data: profile, error: profileError } = await supabase
            .from("margin_profiles")
            .insert({
              user_id: user.id,
              name: normalized.name,
              memo: normalized.memo ?? "",
              material_cost: materialCost,
              labor_cost: laborCost,
              overhead_cost: normalized.outsourcingCost,
              loss_rate: normalized.lossRate,
              total_cost: totalCost,
            })
            .select()
            .single()

          if (profileError) throw profileError

          const { error: targetError } = await supabase
            .from("margin_profile_targets")
            .insert({
              user_id: user.id,
              profile_id: profile.id,
              target_type: targetType,
              target_key: targetKey,
            })

          if (targetError) throw targetError
        }
      }

      const saved: Product = {
        ...normalized,
        id: row.id,
        name: row.name ?? normalized.name,
        memo: row.memo ?? normalized.memo ?? "",
      }

      setMarginProducts((prev) => {
        const exists = prev.some((x) => x.id === saved.id)
        if (exists) return prev.map((x) => (x.id === saved.id ? saved : x))
        return [saved, ...prev]
      })

      if (props?.onSaved) {
        props.onSaved()
      } else {
        setDialogOpen(false)
      }
      setDraft(emptyProduct())
      setSelectedProductId("")
      setSelectedStoreId("")
      setSelectedCategory("")
    } catch (e) {
      console.error("저장 실패", e)
      alert("저장 실패. 콘솔 확인")
    } finally {
      setSaving(false)
    }
  }

  const deleteProduct = (id: string) => {
    const target = marginProducts.find((p) => p.id === id)
    if (!target) return

    // 1. UI에서 먼저 제거
    setMarginProducts((prev) => prev.filter((p) => p.id !== id))

    // 2. 삭제 예약
    const timer = window.setTimeout(async () => {
      await deleteMyMarginProduct(id)
      delete deleteTimers.current[id]
    }, 3000)

    deleteTimers.current[id] = timer

    // 3. 토스트 + undo
    toast.success(`${target.name} 삭제됨`, {
      actionLabel: "되돌리기",
      onAction: () => {
        // 삭제 취소
        clearTimeout(deleteTimers.current[id])
        delete deleteTimers.current[id]

        setMarginProducts((prev) => [target, ...prev])
      },
    })
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
    setMarginProducts((prev) => [saved, ...prev])
    toast.success(`${p.name} 복사됨`)
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
  const deleteTimers = useRef<Record<string, number>>({})
  const sortedProducts = useMemo(() => {
    return [...marginProducts].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [marginProducts])

  const filteredProfileList = useMemo(() => {
    const q = listQuery.trim().toLowerCase()

    const filtered = sortedProducts.filter((p) => {
      const matchesQuery =
        q === "" ||
        p.name.toLowerCase().includes(q) ||
        String(p.memo ?? "").toLowerCase().includes(q)

      const matchesCategory =
        listCategoryFilter === "" ||
        products.some(
          (prod: any) =>
            String(prod.name) === String(p.name) &&
            String(prod.category ?? "") === String(listCategoryFilter)
        )

      return matchesQuery && matchesCategory
    })

    return filtered
  }, [sortedProducts, listQuery, listCategoryFilter, products])

  const totalPages = Math.max(1, Math.ceil(filteredProfileList.length / ITEMS_PER_PAGE))

  const pagedProfileList = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredProfileList.slice(start, start + ITEMS_PER_PAGE)
  }, [filteredProfileList, currentPage])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1)
    }
  }, [currentPage, totalPages])

  const filteredProducts = useMemo(() => {
    if (!selectedCategory) return products
    return products.filter((p: any) => p.category === selectedCategory)
  }, [products, selectedCategory])

  const openCreate = () => {
    setEditing(null)
    setIsReadOnly(false)
    setSelectedProductId("")
    setSelectedStoreId("")
    setDraft(emptyProduct())
    setNewMaterialName("")
    setNewMaterialUnitPrice("")
    setNewMaterialQty("1")
    setDialogOpen(true)
  }

  const openEdit = (p: Product) => {
    const next = migrateProduct(p)

    setEditing(p)
    setIsReadOnly(false)
    setDraft(next)

    setSelectedStoreId(next.linkedStoreId ?? "")

    if (next.targetType === "product") {
      setSelectedProductId(next.targetKey ?? "")
      setSelectedCategory("")
    } else if (next.targetType === "category") {
      setSelectedProductId("")
      setSelectedCategory(next.targetKey ?? "")
    } else {
      setSelectedProductId("")
      setSelectedCategory("")
    }

    setNewMaterialName("")
    setNewMaterialUnitPrice("")
    setNewMaterialQty("1")
    setDialogOpen(true)
  }

  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId)

    const selectedStore = stores.find((s) => String(s.id) === String(storeId))
    const nextRate = Number(selectedStore?.commission_rate ?? 0)

    setDraft((prev) => ({
      ...prev,
      salesCommissionRate: nextRate,
    }))
  }

  const sortedLibrary = useMemo(() => {
    const q = libSearch.trim().toLowerCase()
    const filtered = q
      ? library.filter((x) => x.name.toLowerCase().includes(q))
      : library

    return [...filtered].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [library, libSearch])

  const libraryNameSet = useMemo(() => {
    const s = new Set<string>()
    for (const it of library) s.add(normName(it.name))
    return s
  }, [library])

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

  const renderReadOnlyDetail = () => {
    return (
      <div className="space-y-6 pt-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">프로필명</div>
            <div className="text-base font-medium">{draft.name || "-"}</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">메모</div>
            <div className="text-base font-medium">{draft.memo || "-"}</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">적용 대상</div>
            <div className="text-base font-medium">
              {draft.targetType === "category"
                ? `카테고리 공통 · ${draft.targetLabel || draft.targetKey || "-"}`
                : draft.targetType === "product"
                  ? `제품 지정 · ${draft.targetLabel || "-"}`
                  : "지정 안 함"}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">입점처</div>
            <div className="text-base font-medium">
              {stores.find((s: any) => String(s.id) === String(draft.linkedStoreId))?.name || "지정 안 함"}
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="font-medium text-sm">재료/부자재</div>

          {draft.materials.length ? (
            <div className="rounded-lg border overflow-hidden">
              <Table className="w-full table-fixed">
                <colgroup>
                  <col style={{ width: "48%" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "48px" }} />
                  <col style={{ width: "80px" }} />
                </colgroup>

                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead>단가</TableHead>
                    <TableHead>수량</TableHead>
                    <TableHead className="text-right">합계</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {draft.materials.map((m) => {
                    const total = (m.unitPrice || 0) * (m.quantity || 0)
                    return (
                      <TableRow key={m.id}>
                        <TableCell>{m.name || "-"}</TableCell>
                        <TableCell>{formatCurrency(m.unitPrice || 0)}</TableCell>
                        <TableCell>{m.quantity}</TableCell>
                        <TableCell className="text-right">{formatCurrency(total)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">등록된 재료가 없습니다.</div>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="font-medium text-sm">인건비</div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">시급</div>
              <div className="text-base font-medium">{formatCurrency(draft.hourlyRate)}</div>
            </div>

            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">입력 방식</div>
              <div className="text-base font-medium">
                {draft.laborInputMode === "perHour" ? "시간당 생산량" : "개당 소요시간"}
              </div>
            </div>

            {draft.laborInputMode === "perHour" ? (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">시간당 생산량(개)</div>
                <div className="text-base font-medium">{draft.productionPerHour}</div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">개당 소요시간(분)</div>
                <div className="text-base font-medium">{draft.minutesPerItem ?? 0}분</div>
              </div>
            )}
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">외주/가공비(개당)</div>
            <div className="text-base font-medium">{formatCurrency(draft.outsourcingCost)}</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">로스율(%)</div>
            <div className="text-base font-medium">{draft.lossRate}%</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">판매가</div>
            <div className="text-base font-medium">{formatCurrency(draft.sellingPrice)}</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">판매수수료율(%)</div>
            <div className="text-base font-medium">{draft.salesCommissionRate}%</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">VAT(%)</div>
            <div className="text-base font-medium">{draft.vatRate}%</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">총원가</div>
            <div className="text-base font-medium">{formatCurrency(calcCOGS(draft))}</div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <AppButton
            variant="secondary"
            onClick={() => setDialogOpen(false)}
          >
            닫기
          </AppButton>

          <AppButton
            onClick={() => setIsReadOnly(false)}
          >
            수정하기
          </AppButton>
        </div>
      </div>
    )
  }

  return (
    <AppSection>
      {!props?.embedded && (
        <PageHeader
          title="마진 계산기"
          description="제품별 원가·수수료·VAT를 기준으로 마진을 계산하고 저장합니다."
        />
      )}

      {loadError ? (
        <div className="mb-4 rounded-lg border p-4 text-sm">
          <div className="font-medium">불러오기 오류</div>
          <div className="mt-1 text-muted-foreground">{loadError}</div>
        </div>
      ) : null}

      <div className="space-y-6">
        <CostSimulationCard
          profiles={sortedProducts}
          stores={stores}
          selectedProfileId={simulationProfileId}
          onSelectedProfileIdChange={setSimulationProfileId}
          selectedStoreId={selectedStoreId}
          onSelectedStoreIdChange={setSelectedStoreId}
          manualCommissionRate={manualCommissionRate}
          onManualCommissionRateChange={setManualCommissionRate}
        />

        <div className="space-y-6">
          <AppCard
            title="원가 프로필 목록"
            description={
              loading
                ? "불러오는 중..."
                : filteredProfileList.length
                  ? `총 ${filteredProfileList.length}개`
                  : "아직 저장된 원가 프로필이 없습니다."
            }
            action={
              <Dialog
                open={dialogOpen}
                onOpenChange={(open) => {
                  setDialogOpen(open)
                  if (!open) {
                    setIsReadOnly(false)
                    setEditing(null)
                  }
                }}
              >
                <DialogTrigger asChild>
                  <AppButton variant="secondary" onClick={openCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    새로 만들기
                  </AppButton>
                </DialogTrigger>

                <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto scrollbar-hide p-6 pb-24">
                  <DialogHeader>
                    <DialogTitle>{editing ? "제품 편집" : "제품 추가"}</DialogTitle>
                  </DialogHeader>

                  {isReadOnly ? (
                    renderReadOnlyDetail()
                  ) : (
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
                            <div className="space-y-2">
                              <Label>카테고리 선택</Label>
                              <select
                                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                value={selectedCategory}
                                onChange={(e) => {
                                  setSelectedCategory(e.target.value)
                                  setSelectedProductId("")
                                }}
                              >
                                <option value="">전체</option>
                                {categories.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label>입점처 선택</Label>
                            <select
                              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                              value={selectedStoreId}
                              onChange={(e) => handleStoreChange(e.target.value)}
                            >
                              <option value="">입점처 선택 안함</option>
                              {stores.map((store) => (
                                <option key={store.id} value={store.id}>
                                  {store.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>제품 선택</Label>
                            <select
                              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                              value={selectedProductId}
                              onChange={(e) => setSelectedProductId(e.target.value)}
                            >
                              <option value="">제품 선택 안함 (카테고리 공통 적용)</option>
                              {filteredProducts.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>마진 프로필 이름</Label>
                            <AppInput
                              value={draft.name}
                              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>메모(선택)</Label>
                            <AppInput
                              value={draft.memo ?? ""}
                              onChange={(e) => setDraft((p) => ({ ...p, memo: e.target.value }))}
                            />
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="font-medium text-sm">재료/부자재</div>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                            <div className="space-y-2 md:col-span-2">
                              <Label>이름</Label>
                              <AppInput
                                className="h-8 w-full px-2 text-sm"
                                value={newMaterialName}
                                onChange={(e) => setNewMaterialName(e.target.value)}
                                placeholder="예: 원단"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>단가</Label>
                              <AppInput
                                className="h-8 w-full px-2 text-sm"
                                inputMode="numeric"
                                value={newMaterialUnitPrice}
                                onChange={(e) => setNewMaterialUnitPrice(e.target.value)}
                                placeholder="예: 2500"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>수량</Label>
                              <AppInput
                                className="h-8 w-full px-2 text-sm"
                                inputMode="decimal"
                                value={newMaterialQty}
                                onChange={(e) => setNewMaterialQty(e.target.value)}
                                placeholder="예: 0.5"
                              />
                            </div>
                          </div>

                          <div className="flex justify-end gap-2">
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
                                        ? library.filter((x) =>
                                          x.name.toLowerCase().includes(libraryPickerQuery.trim().toLowerCase())
                                        )
                                        : library
                                      )
                                        .slice(0, 50)
                                        .map((it: any) => (
                                          <CommandItem
                                            key={it.id}
                                            value={`${it.name} ${it.unitPrice}`}
                                            onSelect={() => {
                                              addMaterialToDraft(String(it.name), it.unitPrice)
                                              setLibraryPickerOpen(false)
                                              setLibraryPickerQuery("")
                                              setLastAddedLibraryId(it.id)
                                              window.setTimeout(
                                                () =>
                                                  setLastAddedLibraryId((cur) =>
                                                    cur === it.id ? null : cur
                                                  ),
                                                700
                                              )
                                            }}
                                          >
                                            <div className="flex w-full items-center justify-between gap-3">
                                              <div className="min-w-0">
                                                <div className="truncate font-medium">{it.name}</div>
                                                <div className="truncate text-xs text-muted-foreground">
                                                  {formatCurrency(it.unitPrice)}
                                                </div>
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
                            <div className="overflow-hidden rounded-lg border">
                              <Table className="w-full table-fixed">
                                <colgroup>
                                  <col style={{ width: "48%" }} />
                                  <col style={{ width: "80px" }} />
                                  <col style={{ width: "48px" }} />
                                  <col style={{ width: "80px" }} />
                                  <col style={{ width: "72px" }} />
                                  <col style={{ width: "44px" }} />
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
                                        <TableCell className="px-2 py-2">
                                          <AppInput
                                            className="h-8 w-full px-2 text-sm"
                                            value={m.name}
                                            placeholder="예: 원단"
                                            onChange={(e) =>
                                              updateMaterial(m.id, { name: e.target.value })
                                            }
                                          />
                                        </TableCell>

                                        <TableCell className="px-2 py-2">
                                          <AppInput
                                            className="h-8 w-full px-2 text-sm"
                                            inputMode="numeric"
                                            value={String(m.unitPrice)}
                                            onChange={(e) =>
                                              updateMaterial(m.id, {
                                                unitPrice: clamp(toNumber(e.target.value), 0),
                                              })
                                            }
                                          />
                                        </TableCell>

                                        <TableCell className="px-2 py-2">
                                          <AppInput
                                            className="h-8 w-full px-2 text-center text-sm"
                                            inputMode="decimal"
                                            value={String(Number(m.quantity) || 0)}
                                            onChange={(e) => {
                                              const n = clamp(toNumber(e.target.value), 0.0001)
                                              updateMaterial(m.id, { quantity: n })
                                            }}
                                          />
                                        </TableCell>

                                        <TableCell className="px-2 py-2 text-right text-sm">
                                          {formatCurrency(total)}
                                        </TableCell>

                                        <TableCell className="px-2 py-2 text-center align-middle">
                                          {libraryNameSet.has(normName(m.name)) ? (
                                            <Check className="inline-block h-4 w-4 text-muted-foreground" />
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

                                        <TableCell className="px-2 py-2 text-center align-middle">
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
                                onChange={(e) =>
                                  setDraft((p) => ({
                                    ...p,
                                    hourlyRate: clamp(toNumber(e.target.value), 0),
                                  }))
                                }
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>입력 방식</Label>
                              <div className="flex flex-wrap gap-2">
                                <AppButton
                                  variant={draft.laborInputMode === "perHour" ? "default" : "secondary"}
                                  size="sm"
                                  onClick={() =>
                                    setDraft((p) => ({ ...p, laborInputMode: "perHour" }))
                                  }
                                >
                                  시간당 생산량
                                </AppButton>
                                <AppButton
                                  variant={draft.laborInputMode === "perItem" ? "default" : "secondary"}
                                  size="sm"
                                  onClick={() =>
                                    setDraft((p) => ({ ...p, laborInputMode: "perItem" }))
                                  }
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
                                  onChange={(e) =>
                                    setDraft((p) => ({
                                      ...p,
                                      productionPerHour: clamp(toNumber(e.target.value), 0.0001),
                                    }))
                                  }
                                  placeholder="예: 2"
                                />
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <Label>개당 소요시간(분)</Label>
                                <AppInput
                                  inputMode="decimal"
                                  value={String(draft.minutesPerItem ?? 0)}
                                  onChange={(e) =>
                                    setDraft((p) => ({
                                      ...p,
                                      minutesPerItem: clamp(toNumber(e.target.value), 0),
                                    }))
                                  }
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
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  outsourcingCost: clamp(toNumber(e.target.value), 0),
                                }))
                              }
                              placeholder="예: 0"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>로스율(%)</Label>
                            <AppInput
                              inputMode="decimal"
                              value={String(draft.lossRate)}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  lossRate: clamp(toNumber(e.target.value), 0, 100),
                                }))
                              }
                              placeholder="예: 5"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>판매가</Label>
                            <AppInput
                              inputMode="numeric"
                              value={String(draft.sellingPrice)}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  sellingPrice: clamp(toNumber(e.target.value), 0),
                                }))
                              }
                              placeholder="예: 30000"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>판매수수료율(%)</Label>
                            <AppInput
                              inputMode="decimal"
                              value={String(draft.salesCommissionRate)}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  salesCommissionRate: clamp(toNumber(e.target.value), 0, 100),
                                }))
                              }
                              placeholder="예: 10"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>VAT(%)</Label>
                            <AppInput
                              inputMode="decimal"
                              value={String(draft.vatRate)}
                              onChange={(e) =>
                                setDraft((p) => ({
                                  ...p,
                                  vatRate: clamp(toNumber(e.target.value), 0, 100),
                                }))
                              }
                              placeholder="예: 10"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2">
                          <AppButton variant="secondary" onClick={() => setDialogOpen(false)}>
                            닫기
                          </AppButton>

                          <AppButton
                            onClick={() => void saveDraft()}
                            disabled={!draft.name.trim() || saving}
                          >
                            {saving ? "저장 중..." : "저장"}
                          </AppButton>
                        </div>
                      </TabsContent>

                      <TabsContent value="library" className="space-y-4 pt-4">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="space-y-2 md:col-span-2">
                            <Label>검색</Label>
                            <AppInput
                              value={libSearch}
                              onChange={(e) => setLibSearch(e.target.value)}
                              placeholder="예: 원단, 지퍼, 라벨..."
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>빠른 추가 (이름)</Label>
                            <AppInput
                              value={newMaterialName}
                              onChange={(e) => setNewMaterialName(e.target.value)}
                              placeholder="예: 지퍼"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="space-y-2">
                            <Label>빠른 추가 (단가)</Label>
                            <AppInput
                              inputMode="numeric"
                              value={newMaterialUnitPrice}
                              onChange={(e) => setNewMaterialUnitPrice(e.target.value)}
                              placeholder="예: 300"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>빠른 추가 (수량)</Label>
                            <AppInput
                              inputMode="decimal"
                              value={newMaterialQty}
                              onChange={(e) => setNewMaterialQty(e.target.value)}
                              placeholder="예: 1"
                            />
                          </div>
                          <div className="flex flex-col gap-2 md:col-span-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end">
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
                                setLastAddedLibraryId("quick-add")
                                window.setTimeout(
                                  () =>
                                    setLastAddedLibraryId((cur) =>
                                      cur === "quick-add" ? null : cur
                                    ),
                                  700
                                )

                                addMaterialToDraft(name, price)
                              }}
                              title="현재 수량으로 제품 재료에 추가"
                              variant="default"
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
                          <div className="overflow-hidden rounded-lg border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>이름</TableHead>
                                  <TableHead className="w-44">단가</TableHead>
                                  <TableHead className="w-24 text-right">추가</TableHead>
                                  <TableHead className="w-16" />
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
                                          onChange={(e) =>
                                            setLibUnitPriceEdit((m) => ({
                                              ...m,
                                              [it.id]: e.target.value,
                                            }))
                                          }
                                        />
                                        <AppButton
                                          variant="secondary"
                                          size="sm"
                                          className="self-end sm:self-auto"
                                          onClick={() => void saveLibraryUnitPrice(it)}
                                        >
                                          저장
                                        </AppButton>
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <AppButton
                                        variant={
                                          lastAddedLibraryId === it.id ? "default" : "secondary"
                                        }
                                        size="sm"
                                        onClick={() => addFromLibraryToDraft(it)}
                                        title="현재 수량으로 제품 재료에 추가"
                                      >
                                        <Plus className="h-4 w-4" />
                                      </AppButton>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <AppButton
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => void deleteLibraryItem(it.id)}
                                      >
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
                  )}
                </DialogContent>
              </Dialog>
            }
          >
            {loading ? (
              <div className="text-sm text-muted-foreground">로딩 중...</div>
            ) : filteredProfileList.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                조건에 맞는 원가 프로필이 없습니다.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>검색</Label>
                    <AppInput
                      value={listQuery}
                      onChange={(e) => {
                        setListQuery(e.target.value)
                        setCurrentPage(1)
                      }}
                      placeholder="프로필명 또는 메모 검색"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>카테고리 필터</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={listCategoryFilter}
                      onChange={(e) => {
                        setListCategoryFilter(e.target.value)
                        setCurrentPage(1)
                      }}
                    >
                      <option value="">전체</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border">
                  <Table className="table-fixed w-full">
                    <colgroup>
                      <col style={{ width: "35%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "20%" }} />
                      <col style={{ width: "15%" }} />
                    </colgroup>

                    <TableHeader>
                      <TableRow>
                        <TableHead>프로필명</TableHead>
                        <TableHead>총원가</TableHead>
                        <TableHead>기준 판매가</TableHead>
                        <TableHead>메모</TableHead>
                        <TableHead className="pr-4 text-right">작업</TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {pagedProfileList.map((p) => {
                        const cogs = calcCOGS(p)

                        return (
                          <TableRow
                            key={p.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest("[data-action]")) return

                              setEditing(p)
                              setDraft(migrateProduct(p))
                              setIsReadOnly(true)
                              setDialogOpen(true)
                            }}
                          >
                            <TableCell className="truncate font-medium" title={p.name}>
                              {p.name}
                            </TableCell>
                            <TableCell>{formatCurrency(cogs)}</TableCell>
                            <TableCell>{formatCurrency(p.sellingPrice)}</TableCell>
                            <TableCell className="max-w-[240px] truncate text-muted-foreground">
                              {p.memo || "-"}
                            </TableCell>
                            <TableCell className="align-middle px-2 py-2 text-right pr-4">
                              <MarginRowActions
                                onEdit={() => openEdit(p)}
                                onDelete={() => {
                                  setDeleteTargetId(p.id)
                                  setDeleteTargetName(p.name)
                                }}
                                onDuplicate={() => duplicateProduct(p)}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 ? (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <AppButton
                        key={page}
                        size="sm"
                        variant={page === currentPage ? "default" : "secondary"}
                        onClick={() => setCurrentPage(page)}
                      >
                        {page}
                      </AppButton>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </AppCard>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTargetId("")
            setDeleteTargetName("")
          }
        }}
        title="원가 프로필을 삭제할까요?"
        description={
          deleteTargetName
            ? `“${deleteTargetName}” 프로필이 삭제됩니다. 되돌릴 수 없습니다.`
            : "원가 프로필이 삭제됩니다. 되돌릴 수 없습니다."
        }
        confirmText="삭제"
        cancelText="취소"
        destructive
        onConfirm={async () => {
          const id = deleteTargetId
          if (!id) return

          await deleteProduct(id)

          setDeleteTargetId("")
          setDeleteTargetName("")
        }}
      />
    </AppSection>
  )
}  