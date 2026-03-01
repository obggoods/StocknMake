import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import PageHeader from "@/app/layout/PageHeader"
import { useAppData } from "@/features/core/useAppData"
import { upsertInventoryItemDB } from "@/data/store.supabase"

import { AppButton } from "@/components/app/AppButton"
import { AppCard } from "@/components/app/AppCard"
import { AppSelect } from "@/components/app/AppSelect"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

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
  return String(name ?? "").replace(/[\\\/:*?"<>|]/g, "_").trim()
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

  const storeOptions = useMemo(() => {
    const base = [{ label: "전체", value: "__all__" }]
    const mapped = stores
      .map((s: any) => ({ label: String(s?.name ?? "입점처"), value: String(s?.id ?? "") }))
      .filter((x) => x.value)
    return [...base, ...mapped]
  }, [stores])

  const storeById = useMemo(() => new Map<string, any>(stores.map((s: any) => [String(s.id), s])), [stores])

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

  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      const c = String(p.category ?? "").trim()
      if (c) set.add(c)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [products])

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

    const hasStates = storeProductStates.length > 0
    const enabledByKey = new Map<string, boolean>()
    if (hasStates) {
      for (const sp of storeProductStates) {
        const key = `${String(sp.storeId)}__${String(sp.productId)}`
        enabledByKey.set(key, Boolean(sp.enabled))
      }
    }

    const targetStores =
      selectedStoreId === "__all__" ? stores.map((s) => String(s.id)) : [String(selectedStoreId)]

    const out: any[] = []
    for (const sid of targetStores) {
      for (const p of products) {
        const pid = String(p.id)
        const key = `${sid}__${pid}`

        const enabled = hasStates ? enabledByKey.get(key) === true : true
        if (!enabled) continue

        const inv = invByKey.get(key)
        out.push(inv ?? { storeId: sid, productId: pid, onHandQty: 0 })
      }
    }
    return out
  }, [inventory, storeProductStates, stores, products, selectedStoreId])

  // ===== 필터 적용 (카테고리 / 저재고) =====
  const filteredInventory = useMemo(() => {
    let base = expandedInventory

    if (categoryFilter !== "__all__") {
      base = base.filter((it: any) => (productCategoryById.get(String(it.productId)) ?? "") === categoryFilter)
    }

    if (!onlyLowStock) return base
    return base.filter((it: any) => num(it.onHandQty, 0) < lowStockThreshold)
  }, [expandedInventory, categoryFilter, productCategoryById, onlyLowStock, lowStockThreshold])

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
  const exportInventoryCSV = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    const store = selectedStoreId === "__all__" ? null : storeById.get(String(selectedStoreId))

    const rows: string[][] = []
    rows.push(["입점처", "카테고리", "제품", "현재 재고"])

    for (const it of sortedInventoryRows as any[]) {
      const sName =
        selectedStoreId === "__all__" ? storeById.get(String(it.storeId))?.name ?? "-" : store?.name ?? "-"
      const pName = productNameById.get(String(it.productId)) ?? "제품"
      const cat = productCategoryById.get(String(it.productId)) ?? ""
      rows.push([String(sName), String(cat || "-"), String(pName), String(it.onHandQty ?? 0)])
    }

    const storeSafe = safeFilename(store?.name ?? "전체")
    downloadCSV(`ShopPlanner_재고현황_${storeSafe}_${today}.csv`, rows)
  }, [sortedInventoryRows, productNameById, productCategoryById, selectedStoreId, storeById])

  const exportMakeCSV = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    const store = selectedStoreId === "__all__" ? null : storeById.get(String(selectedStoreId))

    const rows: string[][] = []
    rows.push(["입점처", "카테고리", "제품", "현재 재고", "목표 재고", "필요 수량"])

    for (const { it, need } of makeRows as any[]) {
      const onHand = num(it.onHandQty, 0)
      const sName =
        selectedStoreId === "__all__" ? storeById.get(String(it.storeId))?.name ?? "-" : store?.name ?? "-"
      const pName = productNameById.get(String(it.productId)) ?? "제품"
      const cat = productCategoryById.get(String(it.productId)) ?? ""
      rows.push([String(sName), String(cat || "-"), String(pName), String(onHand), String(effectiveTargetQty), String(need)])
    }

    const storeSafe = safeFilename(store?.name ?? "전체")
    downloadCSV(`ShopPlanner_제작리스트_${storeSafe}_${today}.csv`, rows)
  }, [makeRows, productNameById, productCategoryById, selectedStoreId, storeById, effectiveTargetQty])

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
          <div className="w-full sm:w-[240px]">
            <AppSelect
              value={selectedStoreId}
              onValueChange={(v: string) => setSelectedStoreId(v)}
              options={storeOptions as any}
            />
          </div>

          <select
            className="h-9 w-full sm:w-[220px] rounded-md border bg-background px-2 text-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="__all__">전체 카테고리</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            className="h-9 w-full sm:w-[180px] rounded-md border bg-background px-2 text-sm"
            value={qtySort}
            onChange={(e) => setQtySort(e.target.value as any)}
          >
            <option value="none">재고 정렬 없음</option>
            <option value="desc">재고 많은 순</option>
            <option value="asc">재고 적은 순</option>
          </select>
        </div>

        <div className="flex gap-2">
          <AppButton variant="secondary" onClick={exportInventoryCSV}>
            재고 현황 다운로드
          </AppButton>
          <AppButton variant="secondary" onClick={exportMakeCSV}>
            제작 리스트 다운로드
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
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  제작 필요 합계: <span className="font-semibold tabular-nums">{makeNeededTotal}</span>
                </div>
              </div>

              <div className="mt-2 overflow-hidden rounded-lg border">
                <Table className="w-full text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[18%]">카테고리</TableHead>
                      <TableHead className="w-[40%]">제품</TableHead>
                      <TableHead className="w-[24%]">입점처</TableHead>
                      <TableHead className="w-[18%] text-right">필요</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {makeRows.length === 0 ? (
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
    </div>
  )
}