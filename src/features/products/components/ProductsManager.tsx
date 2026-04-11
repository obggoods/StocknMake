// src/features/products/components/ProductsManager.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import type { ChangeEvent } from "react"

import ProductRowActions from "@/features/products/components/ProductRowActions"

import { AppButton } from "@/components/app/AppButton"
import { AppCard } from "@/components/app/AppCard"
import { AppInput } from "@/components/app/AppInput"
import { AppSwitch } from "@/components/app/AppSwitch"
import { AppSelect } from "@/components/app/AppSelect"
import { AppBadge } from "@/components/app/AppBadge"

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

import { useAppData } from "@/features/core/useAppData"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { toast } from "@/lib/toast"
import { EmptyState } from "@/components/shared/EmptyState"
import { Skeleton } from "@/components/shared/Skeleton"
import { ErrorState } from "@/components/shared/ErrorState"

import { upsertProductsBulkDB, deleteProductsBulkDB } from "@/data/store.supabase"

const ITEMS_PER_PAGE = 20

const COL = {
  select: "w-[44px]",
  category: "w-[110px]",
  name: "w-[180px]",
  price: "w-[88px]",
  sku: "w-[110px]",
  barcode: "w-[150px]",
  status: "w-[140px]",
  actions: "w-[96px]",
} as const

type LocalProduct = any

export default function ProductsManager() {
  const a = useAppData()

  // ✅ A 전용: CSV conflict dialog open
  const csvConflictOpen = Boolean((a as any)?.csvConflictInfo)

  // ✅ A 전용: CSV input ref (useAppData가 ref를 제공하면 그걸 우선 사용)
  const fallbackCsvInputRef = useRef<HTMLInputElement | null>(null)
  const csvInputRef =
    ((a as any)?.csvInputRef as React.RefObject<HTMLInputElement | null>) ?? fallbackCsvInputRef

  // ====== Optimistic products state ======
  const [localProducts, setLocalProducts] = useState<LocalProduct[]>([])
  const dirtyMapRef = useRef<Map<string, LocalProduct>>(new Map()) // id -> patched product
  const [dirtyCount, setDirtyCount] = useState(0)

  useEffect(() => {
    // 앱 데이터가 refresh되면 로컬을 동기화 (dirty는 유지하지 않음)
    setLocalProducts((a.data.products ?? []) as any[])
    dirtyMapRef.current = new Map()
    setDirtyCount(0)
  }, [a.data.products])

  const markDirty = useCallback((p: any) => {
    dirtyMapRef.current.set(String(p.id), p)
    setDirtyCount(dirtyMapRef.current.size)
  }, [])

  // ====== selection (bulk delete) ======
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  // ====== filters/sort/paging ======
  const [productListCategory, setProductListCategory] = useState<string>("all")
  const [productListPage, setProductListPage] = useState<number>(1)
  const [query, setQuery] = useState<string>("")
  const [sort, setSort] = useState<{
    key: "createdAt" | "name" | "category" | "active" | "price"
    dir: "asc" | "desc"
  }>({ key: "createdAt", dir: "desc" })

  const [deleteProductId, setDeleteProductId] = useState<string>("")
  const [deleteProductName, setDeleteProductName] = useState<string>("")
  const [deleteCategoryName, setDeleteCategoryName] = useState<string>("")

  // 편집 값(로컬)
  const editPriceRef = useRef<number>(0)
  const editSkuRef = useRef<string>("")
  const editBarcodeRef = useRef<string>("")

  const [editingPrice, setEditingPrice] = useState<number>(0)
  const [editingSku, setEditingSku] = useState<string>("")
  const [editingBarcode, setEditingBarcode] = useState<string>("")

  // ====== 제품 CSV 템플릿 다운로드 (A 전용) ======
  const downloadProductsCsvTemplate = () => {
    // 지시서 목적: 신규 생성/업데이트 모두 커버
    // category/name은 매칭 키. overwrite/safe는 useAppData 내부 confirm에서 결정.
    const body =
      "category,name,price,sku,barcode,active\n" +
      "상의,미드나잇블루 티셔츠,12000,SKU-001,8801234567890,true\n" +
      "하의,오프화이트 팬츠,39000,SKU-002,8801234567891,true\n"
    const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const aTag = document.createElement("a")
    aTag.href = url
    aTag.download = "products_upload_template.csv"
    aTag.click()
    URL.revokeObjectURL(url)
    toast.success("제품 CSV 템플릿을 다운로드했어요.")
  }

  // ====== A 전용: CSV 업로드 change 핸들러 (useAppData가 제공하면 위임) ======
  const onChangeProductCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const handler = (a as any)?.onChangeProductCsv as ((e: ChangeEvent<HTMLInputElement>) => Promise<void>) | undefined
    if (!handler) {
      toast.error("CSV 업로드 핸들러가 연결되지 않았어요. (useAppData.ts 확인 필요)")
      // input reset
      if (e.target) e.target.value = ""
      return
    }
    await handler(e)
  }

  // ====== 정렬 ======
  const sortedProducts = useMemo(() => {
    const arr = [...localProducts]
    const dir = sort.dir === "asc" ? 1 : -1

    arr.sort((x, y) => {
      // 판매중(활성) 우선: OFF는 아래
      const ax = Boolean(x.active)
      const ay = Boolean(y.active)
      if (ax !== ay) return ax ? -1 : 1

      if (sort.key === "createdAt") return ((x.createdAt ?? 0) - (y.createdAt ?? 0)) * dir

      if (sort.key === "price") {
        const px = Number(x.price ?? 0)
        const py = Number(y.price ?? 0)
        if (px === py) return 0
        return (px - py) * dir
      }

      if (sort.key === "active") {
        if (ax === ay) return 0
        return (ax ? 1 : -1) * dir
      }

      if (sort.key === "category") {
        const cx = (x.category ?? "미분류").trim() || "미분류"
        const cy = (y.category ?? "미분류").trim() || "미분류"
        const cmp = cx.localeCompare(cy, "ko")
        if (cmp !== 0) return cmp * dir
        return String(x.name ?? "").localeCompare(String(y.name ?? ""), "ko") * dir
      }

      return String(x.name ?? "").localeCompare(String(y.name ?? ""), "ko") * dir
    })

    return arr
  }, [localProducts, sort])

  const filteredProducts = useMemo(() => {
    if (productListCategory === "all") return sortedProducts
    if (productListCategory === "uncategorized") return sortedProducts.filter((p) => !p.category)
    return sortedProducts.filter((p) => (p.category ?? "") === productListCategory)
  }, [sortedProducts, productListCategory])

  const searchedProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return filteredProducts
    return filteredProducts.filter((p) => String(p.name ?? "").toLowerCase().includes(q))
  }, [filteredProducts, query])

  const totalPages = Math.max(1, Math.ceil(searchedProducts.length / ITEMS_PER_PAGE))
  const safePage = Math.min(productListPage, totalPages)

  // ✅ 렌더 중 setState 금지 → effect로 보정
  useEffect(() => {
    if (safePage !== productListPage) setProductListPage(safePage)
  }, [safePage, productListPage])

  const pagedProducts = useMemo(() => {
    const start = (safePage - 1) * ITEMS_PER_PAGE
    return searchedProducts.slice(start, start + ITEMS_PER_PAGE)
  }, [searchedProducts, safePage])

  const pageIds = useMemo(() => pagedProducts.map((p) => String(p.id)), [pagedProducts])
  const allSelectedOnPage = useMemo(
    () => pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id)),
    [pageIds, selectedIds]
  )

  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of pageIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  // ====== inline optimistic update helpers ======
  const patchProduct = (id: string, patch: Partial<LocalProduct>) => {
    setLocalProducts((prev) => {
      const next = prev.map((p) => {
        if (String(p.id) !== String(id)) return p
        const updated = { ...p, ...patch }
        markDirty(updated)
        return updated
      })
      return next
    })

  // ✅ 연속 조작 후 멈췄을 때 자동 저장
  scheduleAutoSave()
  }

  // ====== Save all dirty changes ======
  const [savingBulk, setSavingBulk] = useState(false)

  const [autoSaving, setAutoSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveAllDirty = useCallback(async () => {
    const dirty = Array.from(dirtyMapRef.current.values())
    if (dirty.length === 0) return
  
    try {
      setAutoSaving(true)
  
      await upsertProductsBulkDB({
        products: dirty.map((p: any) => ({
          id: p.id,
          name: p.name,
          category: p.category ?? null,
          active: p.active ?? true,
          make_enabled: p.makeEnabled ?? p.make_enabled ?? true,
          price: p.price ?? 0,
          sku: p.sku ?? null,
          barcode: p.barcode ?? null,
        })),
      })
  
      // ✅ 저장 완료되면 dirty 비우기
      dirtyMapRef.current = new Map()
      setDirtyCount(0)
      setLastSavedAt(Date.now())
  
      // ✅ DB 최신값 동기화(너무 자주 치지 않게, 여기선 1회만)
      await a.refresh()
    } catch (e: any) {
      console.error(e)
      toast.error(`자동 저장 실패: ${e?.message ?? e}`)
    } finally {
      setAutoSaving(false)
    }
  }, [a])

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
  
    // 마지막 조작 후 800ms 지나면 1번만 저장
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null
      saveAllDirty()
    }, 800)
  }, [saveAllDirty])
  
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [])

  // ====== bulk delete selected ======
  const selectedCount = selectedIds.size
  const [deletingBulk, setDeletingBulk] = useState(false)

  const confirmBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return

    try {
      setDeletingBulk(true)

      // UI 즉시 제거
      setLocalProducts((prev) => prev.filter((p) => !selectedIds.has(String(p.id))))

      await deleteProductsBulkDB({ productIds: ids })
      toast.success(`제품 ${ids.length}개를 삭제했어요.`)

      clearSelection()
      await a.refresh()
    } catch (e: any) {
      console.error(e)
      toast.error(`일괄 삭제 실패: ${e?.message ?? e}`)
      await a.refresh()
    } finally {
      setDeletingBulk(false)
      setBulkDeleteOpen(false)
    }
  }

  if (a.errorMsg) return <ErrorState message={a.errorMsg} onRetry={a.refresh} />

  return (
    <div className="space-y-6">
      {a.loading && <div className="text-sm text-muted-foreground">동기화 중…</div>}

      {/* ✅ A 전용: CSV overwrite/safe confirm */}
      <ConfirmDialog
        open={csvConflictOpen}
        onOpenChange={(open) => {
          if (!open) (a as any)?.cancelProductCsvConflict?.()
        }}
        title="기존 제품 정보가 덮어써집니다"
        description={
          (a as any)?.csvConflictInfo
            ? `${(a as any).csvConflictInfo.conflicts.length}건의 항목이 기존 값과 다릅니다. 어떻게 진행할까요?`
            : undefined
        }
        confirmText="덮어쓰기 포함 진행"
        secondaryText="빈 값만 채우기"
        cancelText="취소"
        busy={Boolean((a as any)?.csvBusy)}
        onConfirm={() => (a as any)?.resolveProductCsvConflict?.("overwrite")}
        onSecondary={() => (a as any)?.resolveProductCsvConflict?.("safe")}
      />

      {/* 상단: 저장/선택삭제 */}
      <div className="flex flex-wrap items-center gap-2">
  <div className="text-sm text-muted-foreground">
    {autoSaving ? (
      "동기화 중…"
    ) : dirtyCount > 0 ? (
      "변경됨 (곧 자동 저장)"
    ) : lastSavedAt ? (
      "저장됨"
    ) : (
      " "
    )}
  </div>

  {selectedCount > 0 ? (
    <AppButton
      type="button"
      variant="outline"
      className="text-destructive"
      onClick={() => setBulkDeleteOpen(true)}
    >
      선택 삭제 ({selectedCount})
    </AppButton>
  ) : null}
</div>

      {/* 제품 추가 / CSV (A만 유지) */}
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">제품 추가</div>
            <div className="text-xs text-muted-foreground">
              제품을 직접 추가하거나 CSV로 일괄 업로드/업데이트할 수 있어요.
            </div>
          </div>

          {/* ✅ A 전용 버튼/인풋 */}
          <div className="flex flex-wrap items-center gap-2">
            <AppButton type="button" variant="outline" onClick={downloadProductsCsvTemplate}>
              제품 CSV 템플릿 다운로드
            </AppButton>

            <AppButton
              type="button"
              variant="outline"
              onClick={() => csvInputRef.current?.click()}
              disabled={Boolean((a as any)?.csvBusy)}
            >
              제품 CSV 업로드/업데이트
            </AppButton>

            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={onChangeProductCsv}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
  ※ barcode/SKU는 엑셀에서 “텍스트” 형식으로 입력하세요. 숫자로 저장되면 앞자리 0이 사라지거나 8.8E+12(과학적 표기)로 변환될 수 있어요.
</p>

        {/* 제품 수동 추가 UI */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Popover
            open={a.categoryOpen}
            onOpenChange={(open) => {
              a.setCategoryOpen(open)
              if (!open) a.setCategoryTyped(false)
            }}
          >
            <div className="flex-[1_1_180px] min-w-[160px] max-w-[240px]">
              <PopoverTrigger asChild>
                <AppButton type="button" variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">{a.newCategory.trim() ? a.newCategory : "카테고리 입력/선택"}</span>
                  <span className="text-muted-foreground">▾</span>
                </AppButton>
              </PopoverTrigger>

              <PopoverContent align="start" className="p-0 w-[--radix-popover-trigger-width]">
                <Command>
                  <CommandInput
                    placeholder="카테고리 검색/입력..."
                    value={a.newCategory}
                    onValueChange={(v) => {
                      a.setCategoryTyped(true)
                      a.setNewCategory(v)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                    
                        const v = a.newCategory.trim()
                        if (!v) return
                    
                        // 1) 새 카테고리 저장 시도 (중복이어도 upsert면 안전)
                        void a.saveCategoryOnly()
                    
                        // 2) 선택 확정 + 닫기
                        a.setCategoryTyped(false)
                        a.setNewCategory(v)
                        a.setCategoryOpen(false)
                      }
                    
                      // ESC로 닫기 (UX)
                      if (e.key === "Escape") {
                        a.setCategoryTyped(false)
                        a.setCategoryOpen(false)
                      }
                    }}
                  />
                  <CommandList>
                    <CommandEmpty>
                      <div className="px-2 py-2 text-sm text-muted-foreground">
                        검색 결과가 없습니다.
                        {a.newCategory.trim() ? " Enter로 새 카테고리를 저장할 수 있어요." : ""}
                      </div>
                    </CommandEmpty>

                    <CommandGroup>
                      {a.categoryOptions
                        .filter((c) => {
                          const q = a.newCategory.trim()
                          if (!q) return true
                          return c.includes(q)
                        })
                        .map((c) => (
                          <CommandItem
                            key={c}
                            value={c}
                            onSelect={() => {
                              a.setCategoryTyped(false)
                              a.setNewCategory(c)
                              a.setCategoryOpen(false)
                            
                              // ✅ 선택 후 제품명 입력으로 이동
                              requestAnimationFrame(() => {
                                const el = document.getElementById("product-name-input") as HTMLInputElement | null
                                el?.focus()
                              })
                            }}
                            className="flex items-center justify-between"
                          >
                            <span className="truncate">{c}</span>
                            <AppButton
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setDeleteCategoryName(c)
                              }}
                              title="카테고리 삭제"
                            >
                              ×
                            </AppButton>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </div>
          </Popover>

          <AppInput
            id="product-name-input"
            className="flex-[2_1_220px] min-w-0"
            value={a.newProductName}
            onChange={(e) => a.setNewProductName(e.target.value)}
            placeholder="예: 미드나잇블루"
            onKeyDown={(e) => {
              if (e.key === "Enter") a.addProduct()
            }}
          />

          <AppButton className="flex-shrink-0 whitespace-nowrap" onClick={a.addProduct} disabled={a.loading}>
            추가
          </AppButton>
        </div>
      </div>

      {/* 제품 목록 */}
      <AppCard density="compact" title="제품 목록" className="min-w-0" contentClassName="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[160px_140px_1fr_auto] items-center">
          <AppSelect
            value={productListCategory}
            onValueChange={(v) => {
              setProductListCategory(v)
              setProductListPage(1)
            }}
            options={[
              { value: "all", label: "전체" },
              { value: "uncategorized", label: "미분류" },
              ...a.categoryOptions.map((c) => ({ value: c, label: c })),
            ]}
            className="w-full"
          />

          <AppSelect
            value={`${sort.key}:${sort.dir}`}
            onValueChange={(v) => {
              const [k, d] = v.split(":") as any
              setSort({ key: k, dir: d })
            }}
            options={[
              { value: "createdAt:desc", label: "최신순" },
              { value: "createdAt:asc", label: "오래된순" },
              { value: "name:asc", label: "제품명 A→Z" },
              { value: "name:desc", label: "제품명 Z→A" },
              { value: "category:asc", label: "카테고리 A→Z" },
              { value: "category:desc", label: "카테고리 Z→A" },
              { value: "price:asc", label: "가격 낮은순" },
              { value: "price:desc", label: "가격 높은순" },
            ]}
            className="w-full"
          />

          <AppInput
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setProductListPage(1)
            }}
            placeholder="제품명 검색"
            className="w-full"
          />

          <div className="text-xs text-muted-foreground justify-self-end whitespace-nowrap">
            {searchedProducts.length}개 중 {pagedProducts.length}개 표시
          </div>
        </div>

        {a.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : pagedProducts.length === 0 ? (
          <EmptyState
            title="표시할 제품이 없습니다"
            description={
              productListCategory === "all"
                ? "먼저 제품을 추가하거나 CSV로 업로드하세요."
                : "다른 카테고리를 선택하거나 제품을 추가하세요."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border">
              <Table className="w-full table-fixed text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className={`${COL.select} text-center`}>
                      <input
                        type="checkbox"
                        checked={allSelectedOnPage}
                        onChange={(e) => toggleSelectAllOnPage(e.target.checked)}
                      />
                    </TableHead>
                    <TableHead className={`${COL.category} text-center`}>카테고리</TableHead>
                    <TableHead className={`${COL.name} text-left`}>제품명</TableHead>
                    <TableHead className={`${COL.price} px-1 text-right`}>가격</TableHead>
                    <TableHead className={`${COL.sku} text-center`}>SKU</TableHead>
                    <TableHead className={`${COL.barcode} text-center`}>바코드</TableHead>
                    <TableHead className={`${COL.status} text-center`}>상태</TableHead>
                    <TableHead className={`${COL.actions} text-right`}>작업</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {pagedProducts.map((p) => {
                    const isEditing = a.editingProductId === p.id
                    const id = String(p.id)
                    const checked = selectedIds.has(id)

                    return (
                      <TableRow key={p.id}>
                        <TableCell className={`${COL.select} align-middle px-2 py-2 text-center`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleSelected(id, e.target.checked)}
                          />
                        </TableCell>

                        <TableCell className={`${COL.category} align-middle px-2 py-2 text-center`}>
                          {isEditing ? (
                            <AppSelect
                            value={a.editingProductCategory || ""}
                            onValueChange={(v) => a.setEditingProductCategory(v)}
                            options={[
                              { value: "", label: "미분류" },
                              ...a.categories.map((name) => ({ value: name, label: name })),
                            ]}
                            className="flex items-center h-full"
                          />
                          ) : (
                            <AppBadge variant="outline" className="max-w-[96px] truncate">
                              {p.category ? p.category : "미분류"}
                            </AppBadge>
                          )}
                        </TableCell>

                        <TableCell className={`${COL.name} align-middle px-2 py-2`}>
                          {isEditing ? (
                            <AppInput
                            className="flex items-center h-full"
                            value={a.editingProductName}
                            onChange={(e) => a.setEditingProductName(e.target.value)}
                            placeholder="제품명"
                          />
                          ) : (
                            <div className="min-w-0 flex items-center gap-2">
                              <div className="truncate text-sm font-medium">{p.name}</div>
                              {p.makeEnabled === false ? (
                                <AppBadge variant="secondary" className="shrink-0">
                                  제작중지
                                </AppBadge>
                              ) : null}
                            </div>
                          )}
                        </TableCell>

                        <TableCell className={`${COL.price} align-middle px-1 py-2 text-right whitespace-nowrap`}>
                          {isEditing ? (
                            <AppInput
                            className="flex items-center h-full"
                            type="number"
                            inputMode="numeric"
                            value={String(editingPrice)}
                            onChange={(e) => {
                              const v = e.target.value
                              setEditingPrice(v === "" ? 0 : Math.max(0, parseInt(v, 10) || 0))
                            }}
                            placeholder="0"
                          />
                          ) : (
                            <span className="tabular-nums">{(p.price ?? 0).toLocaleString("ko-KR")}</span>
                          )}
                        </TableCell>

                        <TableCell className={`${COL.sku} align-middle px-2 py-2 text-center`}>
                          {isEditing ? (
                            <AppInput
                            className="flex items-center h-full"
                            value={editingSku}
                            onChange={(e) => setEditingSku(e.target.value)}
                            placeholder="-"
                          />
                          ) : (
                            <span className="truncate block">{p.sku ? p.sku : "-"}</span>
                          )}
                        </TableCell>

                        <TableCell className={`${COL.barcode} align-middle px-2 py-2 text-center`}>
                          {isEditing ? (
                            <AppInput
                            className="flex items-center h-full"
                            value={editingBarcode}
                            onChange={(e) => setEditingBarcode(e.target.value)}
                            placeholder="-"
                          />
                          ) : (
                            <span className="truncate block">{p.barcode ? p.barcode : "-"}</span>
                          )}
                        </TableCell>

                        <TableCell className={`${COL.status} align-middle px-2 py-2`}>
                          <div className="flex items-center justify-center gap-3">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                              <AppSwitch
                                checked={Boolean(p.active)}
                                onCheckedChange={(v) => patchProduct(id, { active: Boolean(v) })}
                                disabled={false}
                              />
                              <span className="text-[11px] text-muted-foreground select-none">판매</span>
                            </div>

                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <AppSwitch
                                checked={p.makeEnabled !== false}
                                onCheckedChange={(v) => patchProduct(id, { makeEnabled: Boolean(v) })}
                                disabled={false}
                              />
                              <span className="text-[11px] text-muted-foreground select-none">제작</span>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className={`${COL.actions} align-middle px-2 py-2 text-right`}>
                          {isEditing ? (
                            <div className="flex justify-end gap-1.5 whitespace-nowrap">
                              <AppButton
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2.5 text-xs flex-shrink-0"
                                onClick={() => {
                                  a.setEditingProductName(a.editingOriginalRef.current)
                                  a.setEditingProductCategory(a.editingOriginalCategoryRef.current)
                                  setEditingPrice(editPriceRef.current)
                                  setEditingSku(editSkuRef.current)
                                  setEditingBarcode(editBarcodeRef.current)
                                  a.setEditingProductId(null)
                                }}
                              >
                                취소
                              </AppButton>

                              <AppButton
                                type="button"
                                size="sm"
                                className="h-8 px-2.5 text-xs flex-shrink-0"
                                onClick={() => {
                                  patchProduct(id, {
                                    name: a.editingProductName,
                                    category: a.editingProductCategory || null,
                                    price: editingPrice,
                                    sku: editingSku,
                                    barcode: editingBarcode,
                                  })
                                  a.setEditingProductId(null)
                                  toast.success("반영됐어요. 잠시 후 자동 저장됩니다.")
                                }}
                              >
                                적용
                              </AppButton>
                            </div>
                          ) : (
                            <div className="flex justify-end">
                              <ProductRowActions
                                disabled={false}
                                onEdit={() => {
                                  a.setEditingProductId(p.id)
                                  a.setEditingProductName(p.name)
                                  a.editingOriginalRef.current = p.name

                                  a.setEditingProductCategory(p.category ?? "")
                                  a.editingOriginalCategoryRef.current = p.category ?? ""

                                  const price0 = p.price ?? 0
                                  const sku0 = p.sku ?? ""
                                  const barcode0 = p.barcode ?? ""

                                  editPriceRef.current = price0
                                  editSkuRef.current = sku0
                                  editBarcodeRef.current = barcode0

                                  setEditingPrice(price0)
                                  setEditingSku(sku0)
                                  setEditingBarcode(barcode0)
                                }}
                                onDeleteRequest={() => {
                                  setDeleteProductId(p.id)
                                  setDeleteProductName(p.name)
                                }}
                              />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex flex-wrap justify-center gap-2 pt-3">
                {Array.from({ length: totalPages }).map((_, idx) => {
                  const pageNum = idx + 1
                  const active = pageNum === safePage
                  return (
                    <AppButton
                      key={pageNum}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      onClick={() => setProductListPage(pageNum)}
                    >
                      {pageNum}
                    </AppButton>
                  )
                })}
              </div>
            )}
          </>
        )}
      </AppCard>

      {/* 단일 삭제 */}
      <ConfirmDialog
        open={Boolean(deleteProductId)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteProductId("")
            setDeleteProductName("")
          }
        }}
        title="제품을 삭제할까요?"
        description={
          deleteProductName
            ? `“${deleteProductName}” 제품이 삭제됩니다. 되돌릴 수 없습니다.`
            : "제품이 삭제됩니다. 되돌릴 수 없습니다."
        }
        confirmText="삭제"
        cancelText="취소"
        destructive
        busy={a.loading}
        onConfirm={async () => {
          const id = deleteProductId
          if (!id) return
          try {
            setLocalProducts((prev) => prev.filter((p) => String(p.id) !== String(id)))
            await deleteProductsBulkDB({ productIds: [String(id)] })
            toast.success("삭제했어요.")
            await a.refresh()
          } catch {
            toast.error("삭제에 실패했어요.")
            await a.refresh()
          } finally {
            setDeleteProductId("")
            setDeleteProductName("")
          }
        }}
      />

      {/* 선택 일괄 삭제 */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => setBulkDeleteOpen(open)}
        title="선택한 제품을 삭제할까요?"
        description={`선택한 ${selectedCount}개 제품이 삭제됩니다. 되돌릴 수 없습니다.`}
        confirmText="삭제"
        cancelText="취소"
        destructive
        busy={deletingBulk}
        onConfirm={confirmBulkDelete}
      />

      {/* 카테고리 삭제 */}
      <ConfirmDialog
        open={Boolean(deleteCategoryName)}
        onOpenChange={(open) => {
          if (!open) setDeleteCategoryName("")
        }}
        title="카테고리를 삭제할까요?"
        description={
          deleteCategoryName
            ? `“${deleteCategoryName}” 카테고리가 삭제됩니다. (제품의 카테고리 값은 유지됩니다)`
            : "카테고리가 삭제됩니다. (제품의 카테고리 값은 유지됩니다)"
        }
        confirmText="삭제"
        cancelText="취소"
        destructive
        busy={a.loading}
        onConfirm={async () => {
          const name = deleteCategoryName
          if (!name) return
          await a.deleteCategory(name)
          setDeleteCategoryName("")
        }}
      />
    </div>
  )
}
