import { useCallback, useEffect, useMemo, useState } from "react"
import { Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import PageHeader from "@/app/layout/PageHeader"
import SettlementUploader from "@/features/settlements/components/SettlementUploader"
import MarginCalculatorPage from "@/features/margin/pages/MarginCalculatorPage"
import MarketplacePerformance from "@/features/dashboard/components/MarketplacePerformance"
import { AppCard } from "@/components/app/AppCard"
import { AppButton } from "@/components/app/AppButton"
import { AppBadge } from "@/components/app/AppBadge"

import { EmptyState } from "@/components/shared/EmptyState"
import { Skeleton } from "@/components/shared/Skeleton"
import { ErrorState } from "@/components/shared/ErrorState"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"

import { useAppData } from "@/features/core/useAppData"
import {
  listSettlementsDB,
  getSettlementDetailDB,
  deleteSettlementV2DB,
  listSettlementLinesV2DB,
  upsertInventoryItemDB,
  recomputeSettlementProductStatsDB,
  listSettlementProductStatsDB,
} from "@/data/store.supabase"

import { toast } from "@/lib/toast"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function monthOptions(n = 24) {
  return Array.from({ length: n }).map((_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    return { value: `${y}-${m}`, label: `${y}.${m}` }
  })
}

function yearOptions(range = 4) {
  const y = new Date().getFullYear()
  return Array.from({ length: range + 1 }).map((_, i) => String(y - i))
}

function monthNumOptions() {
  return Array.from({ length: 12 }).map((_, i) => {
    const mm = String(i + 1).padStart(2, "0")
    return { value: mm, label: `${mm}월` }
  })
}

function splitYYYYMM(v: string) {
  const [yy, mm] = String(v ?? "").split("-")
  return { yy: yy || String(new Date().getFullYear()), mm: mm || "01" }
}

function fmtKRW(v: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(v))
}

export default function SettlementsPage() {
  const a = useAppData()

  // 조회 필터
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  })
  const { yy: selectedYear, mm: selectedMonthNum } = useMemo(() => splitYYYYMM(month), [month])
  const [storeId, setStoreId] = useState<string>("") // "" = 전체
  const [marginProfiles, setMarginProfiles] = useState<any[]>([])
  const [marginTargets, setMarginTargets] = useState<any[]>([])
  // 목록/상세
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>("")
  const [items, setItems] = useState<any[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [detail, setDetail] = useState<{ settlement: any; lines: any[] } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    storeId: string
    month: string
    applyToInventory: boolean
  } | null>(null)
  const [restoreOnDelete, setRestoreOnDelete] = useState(true)
  const [costPickerOpen, setCostPickerOpen] = useState(false)
  const [targetLine, setTargetLine] = useState<any | null>(null)
  const [createProfileOpen, setCreateProfileOpen] = useState(false)
  const stores = (a.data.stores ?? []) as any[]

  const storeNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of stores) m.set(String(s.id), String(s.name ?? ""))
    return m
  }, [stores])

  const productMap = useMemo(() => {
    const m = new Map<string, any>()
    for (const p of a.data.products ?? []) {
      m.set(String(p.id), p)
    }
    return m
  }, [a.data.products])

  const profileMap = useMemo(() => {
    const m = new Map<string, any>()
    for (const p of marginProfiles) {
      m.set(String(p.id), p)
    }
    return m
  }, [marginProfiles])

  const productCostMap = useMemo(() => {
    const m = new Map<string, number>()

    for (const t of marginTargets) {
      if (t.target_type !== "product") continue

      const profile = profileMap.get(String(t.profile_id))
      if (!profile) continue

      m.set(String(t.target_key), Number(profile.total_cost ?? 0))
    }

    return m
  }, [marginTargets, profileMap])

  const categoryCostMap = useMemo(() => {
    const m = new Map<string, number>()

    for (const t of marginTargets) {
      if (t.target_type !== "category") continue

      const profile = profileMap.get(String(t.profile_id))
      if (!profile) continue

      m.set(String(t.target_key), Number(profile.total_cost ?? 0))
    }

    return m
  }, [marginTargets, profileMap])

  const summary = useMemo(() => {
    if (!detail?.lines) {
      return {
        totalCost: 0,
        totalProfit: 0,
        avgMarginRate: 0,
        unmatched: 0,
      }
    }

    let totalCost = 0
    let totalProfit = 0
    let totalRevenue = 0
    let unmatched = 0

    for (const l of detail.lines) {
      const calc = calcNetProfit(
        l,
        productCostMap,
        categoryCostMap,
        productMap,
        stores
      )

      totalCost += calc.cost
      totalProfit += calc.profit
      totalRevenue += Number(l.gross_amount ?? 0)

      if (calc.matched === "none") {
        unmatched++
      }
    }

    return {
      totalCost,
      totalProfit,
      avgMarginRate:
        totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
      unmatched,
    }
  }, [detail, productCostMap, categoryCostMap, productMap, stores])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError("")
      setDetail(null)
      setSelectedId("")

      const list = await listSettlementsDB({
        marketplaceId: storeId || undefined,
        periodMonth: month || undefined,
      })
      setItems(list)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [month, storeId])

  const handleSettlementSaved = useCallback(async () => {
    await a.refresh()
    await load()
  }, [a, load])

  useEffect(() => {
    load()
    loadMarginData()
  }, [load])

  const loadMarginData = async () => {
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) return

    const { data: profiles } = await supabase
      .from("margin_profiles")
      .select("*")
      .eq("user_id", user.id)

    const { data: targets } = await supabase
      .from("margin_profile_targets")
      .select("*")
      .eq("user_id", user.id)

    setMarginProfiles(profiles ?? [])
    setMarginTargets(targets ?? [])
  }

  const openDetail = async (settlementId: string) => {
    // 같은 행 다시 클릭하면 닫기
    if (settlementId === selectedId) {
      setSelectedId("")
      setDetail(null)
      return
    }

    try {
      setError("")
      setSelectedId(settlementId)
      const d = await getSettlementDetailDB({ settlementId })
      setDetail(d)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  const handleCreateProfile = () => {
    setCostPickerOpen(false)
    window.location.href = "/margin"
  }

  const handleConnectProfile = async (profileId: string) => {
    if (!targetLine) return

    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) return

    const productId = String(targetLine.product_id ?? "")

    try {
      // 기존 매핑 제거 (중복 방지)
      await supabase
        .from("margin_profile_targets")
        .delete()
        .eq("user_id", user.id)
        .eq("target_type", "product")
        .eq("target_key", productId)

      // 새 매핑 추가
      await supabase
        .from("margin_profile_targets")
        .insert({
          user_id: user.id,
          profile_id: profileId,
          target_type: "product",
          target_key: productId,
        })

      toast.success("원가 프로필 연결 완료")

      setCostPickerOpen(false)

      // 🔥 핵심: 다시 로드해서 즉시 반영
      await loadMarginData()

    } catch (e: any) {
      toast.error(e.message ?? "연결 실패")
    }
  }

  const doDelete = () => {
    if (!deleteTarget) return
    setDeleteBusy(true)

    const target = deleteTarget
    const restore = restoreOnDelete
    const deletingId = target.id

    // 모달 닫기
    setDeleteOpen(false)
    setDeleteTarget(null)

    // Optimistic
    setItems((prev) => prev.filter((x) => x.id !== deletingId))
    if (selectedId === deletingId) {
      setSelectedId("")
      setDetail(null)
    }

    ; (async () => {
      try {
        const loadingId = (toast as any).loading?.("삭제 중...")

        // (선택) 재고 복원
        if (target.applyToInventory && restore) {
          const lines = await listSettlementLinesV2DB({ settlementId: deletingId })

          const restoreMap = new Map<string, number>()
          for (const l of lines ?? []) {
            const pid = String((l as any).product_id ?? (l as any).productId ?? "")
            if (!pid) continue
            const q = Number((l as any).qty_sold ?? (l as any).qtySold ?? 0)
            restoreMap.set(pid, (restoreMap.get(pid) ?? 0) + q)
          }

          for (const [pid, restoreQty] of restoreMap.entries()) {
            const inv = (a.data.inventory ?? []).find(
              (x: any) => String(x.storeId) === String(target.storeId) && String(x.productId) === String(pid)
            )
            const current = Number(inv?.onHandQty ?? 0)
            const nextQty = current + restoreQty

            await upsertInventoryItemDB({
              storeId: target.storeId,
              productId: pid,
              onHandQty: nextQty,
            })
          }
        }

        await deleteSettlementV2DB({ settlementId: deletingId })

        await recomputeSettlementProductStatsDB({
          marketplaceId: target.storeId,
          periodMonth: target.month,
        })

        if (loadingId) (toast as any).dismiss?.(loadingId)
        toast.success(target.applyToInventory && restore ? "삭제 완료 (재고 복원됨)" : "정산 데이터가 삭제되었습니다.")

        await a.refresh()
        await load()
      } catch (e: any) {
        toast.error(`삭제 실패: ${e?.message ?? String(e)}`)
        await load()
      } finally {
        setDeleteBusy(false)
      }
    })()
  }

  if (a.errorMsg) return <ErrorState message={a.errorMsg} onRetry={a.refresh} />

  return (
    <div className="space-y-6">
      <PageHeader
        title="정산"
        description="입점처 정산 CSV를 업로드하면 판매 수량이 반영되고, (선택 시) 재고가 자동으로 차감됩니다."
      />

      {/* 상단 요약 2열 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <MarketplacePerformance
          settlements={(a.data as any).settlementsV2 ?? []}
          marketplaces={(stores ?? []).map((s: any) => ({
            id: String(s.id),
            name: String(s.name ?? "입점처"),
          }))}
          userPlan={"basic"}
          isLoading={a.loading}
          focusMonth={month}
          focusMarketplaceId={storeId || undefined}
        />

        <TopProductsMiniCard
          month={month}
          storeId={storeId}
          items={items}
          storeNameById={storeNameById}
        />
      </div>

      {/* 업로드 */}
      <SettlementUploader onSaved={handleSettlementSaved} />

      {/* 저장된 정산(v2) 조회 */}
      <AppCard
        density="compact"
        title="저장된 정산(v2)"
        description="월/입점처별로 저장된 정산을 확인할 수 있어요."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Year */}
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={selectedYear}
              onChange={(e) => {
                const nextYear = e.target.value
                setMonth(`${nextYear}-${selectedMonthNum}`)
              }}
            >
              {yearOptions(6).map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>

            {/* Month */}
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={selectedMonthNum}
              onChange={(e) => {
                const nextMm = e.target.value
                setMonth(`${selectedYear}-${nextMm}`)
              }}
            >
              {monthNumOptions().map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="">전체 입점처</option>
              {stores.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <AppButton type="button" variant="outline" onClick={load} disabled={loading}>
              새로고침
            </AppButton>
          </div>
        }
        contentClassName="px-4 pb-4"
      >
        {loading ? <Skeleton className="h-24" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        <div className="mt-3 overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">입점처</TableHead>
                <TableHead className="w-[90px]">월</TableHead>
                <TableHead className="w-[120px] text-right">총매출</TableHead>
                <TableHead className="w-[120px] text-right">수수료</TableHead>
                <TableHead className="w-[120px] text-right">정산금</TableHead>
                <TableHead className="w-[160px] text-right pr-6">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s: any) => (
                <TableRow
                  key={s.id}
                  className={selectedId === s.id ? "bg-muted/30" : undefined}
                  onClick={() => openDetail(s.id)}
                >
                  <TableCell className="truncate">
                    {storeNameById.get(String(s.marketplace_id)) ?? "-"}
                  </TableCell>
                  <TableCell>{s.period_month?.replace("-", ".")}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(s.gross_amount ?? 0).toLocaleString()}원</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(s.commission_amount ?? 0).toLocaleString()}원</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(s.net_amount ?? 0).toLocaleString()}원</TableCell>
                  <TableCell className="text-right pr-6">
                    <div className="inline-flex items-center justify-end gap-2">
                      <span
                        className={
                          s.apply_to_inventory
                            ? "inline-flex items-center rounded-md border px-2 py-1 text-[11px] text-foreground"
                            : "inline-flex items-center rounded-md border px-2 py-1 text-[11px] text-muted-foreground"
                        }
                      >
                        {s.apply_to_inventory ? "재고반영" : "미반영"}
                      </span>

                      <AppButton
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive hover:bg-transparent"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setDeleteTarget({
                            id: s.id,
                            storeId: s.marketplace_id,
                            month: s.period_month,
                            applyToInventory: Boolean(s.apply_to_inventory),
                          })
                          setRestoreOnDelete(Boolean(s.apply_to_inventory))
                          setDeleteOpen(true)
                        }}
                      >
                        <Trash2 className="h-4 w-4 transition-colors duration-200" />
                      </AppButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    저장된 정산이 없습니다.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        {detail ? (
          <div className="mt-4 space-y-2">
            <div className="text-sm font-medium">정산 상세</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <AppCard title="총원가">
                <div className="text-lg font-semibold">
                  {summary.totalCost.toLocaleString()}원
                </div>
              </AppCard>

              <AppCard title="순마진">
                <div className="text-lg font-semibold">
                  {summary.totalProfit.toLocaleString()}원
                </div>
              </AppCard>

              <AppCard title="마진율">
                <div className="text-lg font-semibold">
                  {summary.avgMarginRate.toFixed(1)}%
                </div>
              </AppCard>

              <AppCard title="미매칭">
                <div className="text-lg font-semibold">
                  {summary.unmatched}건
                </div>
              </AppCard>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>상품</TableHead>
                    <TableHead className="w-[90px] text-right">판매</TableHead>
                    <TableHead className="w-[110px] text-right">단가</TableHead>
                    <TableHead className="w-[120px] text-right">매출</TableHead>

                    <TableHead className="w-[120px] text-right">원가</TableHead>
                    <TableHead className="w-[120px] text-right">순마진</TableHead>
                    <TableHead className="w-[90px] text-right">마진율</TableHead>

                    <TableHead className="w-[90px]">매칭</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.map((l: any) => {
                    const calc = calcNetProfit(
                      l,
                      productCostMap,
                      categoryCostMap,
                      productMap,
                      stores
                    )

                    return (
                      <TableRow key={l.id}>
                        <TableCell className="truncate">
                          {l.product_name_matched ?? l.product_name_raw}
                        </TableCell>

                        <TableCell className="text-right tabular-nums">
                          {Number(l.qty_sold ?? 0).toLocaleString()}
                        </TableCell>

                        <TableCell className="text-right tabular-nums">
                          {Number(l.unit_price ?? 0).toLocaleString()}
                        </TableCell>

                        <TableCell className="text-right tabular-nums">
                          {Number(l.gross_amount ?? 0).toLocaleString()}
                        </TableCell>

                        <TableCell className="text-right tabular-nums">
                          {Number(calc.cost ?? 0).toLocaleString()}
                        </TableCell>

                        <TableCell className="text-right tabular-nums">
                          {Number(calc.profit ?? 0).toLocaleString()}
                        </TableCell>

                        <TableCell className="text-right tabular-nums">
                          {Number(calc.marginRate ?? 0).toFixed(1)}%
                        </TableCell>

                        <TableCell
                          className={calc.matched === "none" ? "text-destructive cursor-pointer" : ""}
                          onClick={() => {
                            if (calc.matched === "none") {
                              setTargetLine(l)
                              setCostPickerOpen(true)
                            }
                          }}
                        >
                          {calc.matched === "product"
                            ? "제품"
                            : calc.matched === "category"
                              ? "카테고리"
                              : "미매칭"}
                        </TableCell>
                      </TableRow>
                    )
                  })}

                  {detail.lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-sm text-muted-foreground">
                        라인이 없습니다.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={(o) => {
            setDeleteOpen(o)
            if (!o) setDeleteTarget(null)
          }}
          title="정산 데이터를 삭제할까요?"
          description={
            <div className="space-y-3">
              <div>
                {deleteTarget
                  ? `${storeNameById.get(deleteTarget.storeId) ?? "입점처"} · ${deleteTarget.month} 정산을 삭제합니다.`
                  : "정산 데이터를 삭제합니다."}
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={restoreOnDelete}
                  disabled={!deleteTarget?.applyToInventory}
                  onChange={(e) => setRestoreOnDelete(e.target.checked)}
                />
                <span className={deleteTarget?.applyToInventory ? "" : "text-muted-foreground"}>
                  삭제 시 재고도 복원하기
                  {!deleteTarget?.applyToInventory ? " (이 정산은 재고차감 미적용)" : ""}
                </span>
              </label>
            </div>
          }
          confirmText="삭제"
          cancelText="취소"
          destructive
          busy={deleteBusy}
          onConfirm={doDelete}
        />
        <ConfirmDialog
          open={costPickerOpen}
          onOpenChange={setCostPickerOpen}
          title="원가 프로필 연결"
          description={
            targetLine ? (
              <div className="space-y-4">
                <div>
                  상품: {targetLine.product_name_matched ?? targetLine.product_name_raw}
                </div>

                <div className="text-sm text-muted-foreground">
                  원가 프로필을 선택하세요
                </div>

                <div className="max-h-48 overflow-y-auto border rounded-md">
                  {(() => {
                    const uniqueProfiles = Array.from(
                      new Map(marginProfiles.map((p) => [p.id, p])).values()
                    )

                    if (uniqueProfiles.length === 0) {
                      return (
                        <div className="p-3 text-sm text-muted-foreground">
                          원가 프로필이 없습니다
                        </div>
                      )
                    }

                    return uniqueProfiles.map((p) => (
                      <button
                        key={p.id}
                        className="w-full text-left px-3 py-2 hover:bg-muted border-b last:border-b-0"
                        onClick={() => handleConnectProfile(p.id)}
                      >
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          원가 {Number(p.total_cost ?? 0).toLocaleString()}원
                        </div>
                      </button>
                    ))
                  })()}
                </div>

                <AppButton
                  variant="secondary"
                  onClick={() => setCreateProfileOpen(true)}
                >
                  + 새 원가 프로필 만들기
                </AppButton>
              </div>
            ) : null
          }
          confirmText="닫기"
          cancelText="취소"
          onConfirm={() => setCostPickerOpen(false)}
        />
        <Dialog open={createProfileOpen} onOpenChange={setCreateProfileOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>원가 프로필 생성</DialogTitle>
            </DialogHeader>
            <MarginCalculatorPage
              embedded
              onSaved={async () => {
                setCreateProfileOpen(false)
                await loadMarginData()
              }}
            />
          </DialogContent>
        </Dialog>
      </AppCard>
    </div>
  )
}

function calcNetProfit(
  line: any,
  productCostMap: Map<string, number>,
  categoryCostMap: Map<string, number>,
  productMap: Map<string, any>,
  stores: any[]
) {
  const productId = String(line.product_id ?? "")
  const qty = Number(line.qty_sold ?? 0)
  const revenue = Number(line.gross_amount ?? 0)

  // 1️⃣ product 기준 매칭
  let costPerUnit = productCostMap.get(productId)

  // 2️⃣ category fallback
  if (costPerUnit == null) {
    const product = productMap.get(productId)
    const category = product?.category
    if (category) {
      costPerUnit = categoryCostMap.get(String(category))
    }
  }

  // 3️⃣ 없으면 0
  if (costPerUnit == null) costPerUnit = 0

  const totalCost = costPerUnit * qty

  // 수수료
  const lineCommissionRate =
    line.commission_rate != null
      ? Number(line.commission_rate)
      : null

  const store = stores.find(
    (s: any) => String(s.id) === String(line.marketplace_id)
  )

  const commissionRate =
    lineCommissionRate != null
      ? lineCommissionRate
      : Number(store?.commission_rate ?? 0)
  const commission = revenue * (commissionRate / 100)

  // VAT (일단 10% 고정, 이후 개선 가능)
  const vat = revenue * 0.1

  const profit = revenue - totalCost - commission - vat
  const marginRate = revenue > 0 ? (profit / revenue) * 100 : 0

  return {
    cost: totalCost,
    profit,
    marginRate,
    matched:
      productCostMap.has(productId)
        ? "product"
        : (() => {
          const product = productMap.get(productId)
          const category = product?.category
          return categoryCostMap.has(String(category)) ? "category" : "none"
        })(),
  }
}

function TopProductsMiniCard(props: {
  month: string
  storeId: string
  items: any[]
  storeNameById: Map<string, string>
}) {
  const { month, storeId, storeNameById } = props

  const [openKey, setOpenKey] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>("")
  const [rows, setRows] = useState<
    Array<{
      name: string
      qty: number
      gross: number
      byMarketplace: Array<{
        marketplaceId: string
        marketplaceName: string
        qty: number
        gross: number
      }>
    }>
  >([])

  useEffect(() => {
    let cancelled = false

      ; (async () => {
        try {
          setBusy(true)
          setErr("")
          setRows([])
          setOpenKey("")

          const stats = await listSettlementProductStatsDB({
            periodMonth: month,
            marketplaceId: storeId || undefined,
          })

          const agg = new Map<
            string,
            {
              qty: number
              gross: number
              by: Map<string, { qty: number; gross: number }>
            }
          >()

          for (const row of stats ?? []) {
            const name = String((row as any).product_name ?? "상품").trim() || "상품"
            const mid = String((row as any).marketplace_id ?? "")
            const qty = Number((row as any).qty_sold_sum ?? 0) || 0
            const gross = Number((row as any).gross_amount_sum ?? 0) || 0

            const cur =
              agg.get(name) ??
              { qty: 0, gross: 0, by: new Map<string, { qty: number; gross: number }>() }

            cur.qty += qty
            cur.gross += gross

            if (mid) {
              const curBy = cur.by.get(mid) ?? { qty: 0, gross: 0 }
              cur.by.set(mid, {
                qty: curBy.qty + qty,
                gross: curBy.gross + gross,
              })
            }

            agg.set(name, cur)
          }

          const out = Array.from(agg.entries())
            .map(([name, v]) => {
              const byMarketplace = Array.from(v.by.entries())
                .map(([marketplaceId, mv]) => ({
                  marketplaceId,
                  marketplaceName: String(storeNameById.get(marketplaceId) ?? marketplaceId),
                  qty: mv.qty,
                  gross: mv.gross,
                }))
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 5)

              return {
                name,
                qty: v.qty,
                gross: v.gross,
                byMarketplace,
              }
            })
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5)

          if (!cancelled) {
            setRows(out)
          }
        } catch (e: any) {
          if (!cancelled) {
            setErr(e?.message ?? String(e))
          }
        } finally {
          if (!cancelled) {
            setBusy(false)
          }
        }
      })()

    return () => {
      cancelled = true
    }
  }, [month, storeId, storeNameById])

  const scopeLabel =
    storeId && storeId.trim()
      ? `${storeNameById.get(storeId) ?? "입점처"} · ${month}`
      : `전체 · ${month}`

  return (
    <AppCard title="베스트 상품 TOP" description={`판매 수량 기준 · ${scopeLabel}`}>
      {busy ? <Skeleton className="h-24" /> : null}
      {err ? (
        <ErrorState
          title="베스트 상품을 불러오지 못했습니다."
          message={err}
        />
      ) : null}

      {!busy && !err ? (
        rows.length === 0 ? (
          <EmptyState
            title="표시할 상품 데이터가 없습니다."
            description="이 월/입점처에 판매 라인이 없어요."
          />
        ) : (
          <div className="space-y-2">
            {rows.map((r, idx) => {
              const opened = openKey === r.name

              return (
                <div key={`${r.name}-${idx}`} className="rounded-lg border bg-background">
                  <button
                    type="button"
                    onClick={() => setOpenKey(opened ? "" : r.name)}
                    className="w-full rounded-lg px-3 py-2 text-left hover:bg-accent/20"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtKRW(r.gross)}원 · {r.qty.toLocaleString()}개
                        </div>
                      </div>

                      <div className="shrink-0">
                        <AppBadge variant={idx === 0 ? "default" : "muted"}>
                          #{idx + 1}
                        </AppBadge>
                      </div>
                    </div>
                  </button>

                  {opened ? (
                    <div className="border-t px-3 pb-3 pt-2">
                      <div className="mb-2 text-xs text-muted-foreground">입점처별 판매</div>
                      <div className="space-y-2">
                        {r.byMarketplace.length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            입점처 정보가 없습니다.
                          </div>
                        ) : (
                          r.byMarketplace.map((b) => (
                            <div
                              key={b.marketplaceId}
                              className="flex items-center justify-between text-sm"
                            >
                              <div className="truncate">{b.marketplaceName}</div>
                              <div className="tabular-nums text-muted-foreground">
                                {b.qty.toLocaleString()}개 · {fmtKRW(b.gross)}원
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )
      ) : null}
    </AppCard>

  )
}