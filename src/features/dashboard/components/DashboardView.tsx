// src/features/dashboard/components/DashboardView.tsx
import { useMemo } from "react"

import { useAppData } from "@/features/core/useAppData"
import { useNavigate } from "react-router-dom"
import { AppButton } from "@/components/app/AppButton"
import { AppCard } from "@/components/app/AppCard"
import { AppBadge } from "@/components/app/AppBadge"

import { ErrorState } from "@/components/shared/ErrorState"
import { Skeleton } from "@/components/shared/Skeleton"

function fmtKRW(v: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(v))
}

function ym(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function addMonths(d: Date, delta: number) {
  const x = new Date(d)
  x.setMonth(x.getMonth() + delta)
  return x
}

function n(v: unknown) {
  const x = typeof v === "number" ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

function DashboardViewInner() {
  const a = useAppData()
  const data = a.data
  const nav = useNavigate()
  const loading = a.loading
  const errorMsg = a.errorMsg

  const stores = (data.stores ?? []) as any[]
  const products = (data.products ?? []) as any[]
  const inventory = (data.inventory ?? []) as any[] // { storeId, productId, onHandQty }
  const settlementsV2 = ((data as any).settlementsV2 ?? []) as any[] // snake_case: period_month, gross_amount...

  // ===== KPI: 기본 수치 =====
  const totalSku = useMemo(() => products.length, [products])

  const storeCount = useMemo(() => stores.length, [stores])

  // 저재고 기준은 profile의 lowStockThresholdInput 사용
  const lowStockThreshold = useMemo(() => {
    const v = Number.parseInt(String(a.lowStockThresholdInput ?? "2").trim(), 10)
    return Number.isFinite(v) ? Math.max(0, v) : 2
  }, [a.lowStockThresholdInput])

  const lowStockCount = useMemo(() => {
    return inventory.filter((it: any) => n(it.onHandQty) < lowStockThreshold).length
  }, [inventory, lowStockThreshold])

  // 제작 필요 수(간단 버전): 목표재고 - 현재재고 (store별 override는 상세 탭에서 처리)
  const targetQty = useMemo(() => {
    const v = Number.parseInt(String(a.defaultTargetQtyInput ?? "5").trim(), 10)
    return Number.isFinite(v) ? Math.max(0, v) : 5
  }, [a.defaultTargetQtyInput])

  const makeNeedProductCount = useMemo(() => {
    // storeId+productId 조합으로 들어온 inventory를 productId 기준으로 묶어서
    // 어떤 스토어에서든 목표 미달이면 제작 필요로 카운트(overview 목적)
    const need = new Set<string>()
    for (const it of inventory as any[]) {
      const onHand = n(it.onHandQty)
      const needQty = Math.max(0, targetQty - onHand)
      if (needQty > 0) need.add(String(it.productId))
    }
    return need.size
  }, [inventory, targetQty])

  // ===== 정산(성과) 요약: 이번달/전월/1위 채널 =====
  const now = new Date()
  const thisMonth = ym(now)
  const prevMonth = ym(addMonths(now, -1))

  const settlementSummary = useMemo(() => {
    let thisTotal = 0
    let prevTotal = 0

    const byMarketplace = new Map<string, number>()

    for (const s of settlementsV2 as any[]) {
      const pm = String(s.period_month ?? "")
      const mid = String(s.marketplace_id ?? "")
      const gross = n((s as any).net_amount ?? 0)

      if (pm === thisMonth) {
        thisTotal += gross
        if (mid) byMarketplace.set(mid, (byMarketplace.get(mid) ?? 0) + gross)
      }
      if (pm === prevMonth) prevTotal += gross
    }

    const ranked = Array.from(byMarketplace.entries())
      .map(([marketplaceId, total]) => ({ marketplaceId, total }))
      .sort((a, b) => b.total - a.total)

    const top = ranked[0] ?? null
    const topName =
      top?.marketplaceId
        ? String(stores.find((x: any) => String(x.id) === String(top.marketplaceId))?.name ?? top.marketplaceId)
        : "-"

    const delta =
      prevTotal > 0 ? ((thisTotal - prevTotal) / prevTotal) * 100 : null

    return {
      thisTotal,
      prevTotal,
      topName,
      topTotal: top?.total ?? 0,
      delta,
    }
  }, [settlementsV2, stores, thisMonth, prevMonth])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-[240px]" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  if (errorMsg) {
    return <ErrorState title="대시보드를 불러오지 못했습니다." message={String(errorMsg)} />
  }

  // ===== UI: Overview =====
  const deltaLabel =
    settlementSummary.prevTotal === 0
      ? "신규 매출"
      : `${(settlementSummary.delta ?? 0) >= 0 ? "+" : ""}${(settlementSummary.delta ?? 0).toFixed(1)}%`

  const deltaVariant =
    settlementSummary.prevTotal === 0
      ? "muted"
      : (settlementSummary.delta ?? 0) >= 0
        ? "success"
        : "destructive"
  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AppCard className="shadow-sm">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">총 SKU</p>
            <p className="text-3xl font-semibold tabular-nums">{totalSku}</p>
            <p className="text-xs text-muted-foreground">제품 DB 기준</p>
          </div>
        </AppCard>

        <AppCard className="shadow-sm">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">입점처 수</p>
            <p className="text-3xl font-semibold tabular-nums">{storeCount}</p>
            <p className="text-xs text-muted-foreground">등록된 채널</p>
          </div>
        </AppCard>

        <AppCard className="shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">저재고 SKU</p>
              <p className="text-3xl font-semibold tabular-nums">{lowStockCount}</p>
              <p className="text-xs text-muted-foreground">기준: &lt; {lowStockThreshold}</p>
            </div>
            {lowStockCount > 0 ? (
              <AppBadge variant="warning">주의</AppBadge>
            ) : (
              <AppBadge variant="success">안정</AppBadge>
            )}
          </div>

          <div className="mt-3">
            <AppButton
              variant="secondary"
              className="w-full font-medium"
              onClick={() => nav("/inventory?tab=inventory")}
            >
              재고 보기
            </AppButton>
          </div>
        </AppCard>

        <AppCard className="shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">제작 필요 제품</p>
              <p className="text-3xl font-semibold tabular-nums">{makeNeedProductCount}</p>
              <p className="text-xs text-muted-foreground">목표 재고: {targetQty}</p>
            </div>
            {makeNeedProductCount > 0 ? (
              <AppBadge variant="task">할 일</AppBadge>
            ) : (
              <AppBadge variant="success">완료</AppBadge>
            )}
          </div>

          <div className="mt-3">
            <AppButton
              variant="secondary"
              className="w-full"
              onClick={() => nav("/inventory?tab=make")}
            >
              제작 보기
            </AppButton>
          </div>
        </AppCard>
      </div>

      {/* 매출 요약 */}
      <AppCard className="shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">이번달 매출 요약</p>
              <AppBadge variant="muted">{thisMonth}</AppBadge>
            </div>
            <p className="text-xs text-muted-foreground">
              정산 탭에서 채널별 매출/전월 대비를 더 자세히 확인할 수 있어요.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <AppButton
              variant="default"
              onClick={() => nav("/settlements")}
            >
              정산 상세
            </AppButton>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">이번달 정산금액</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtKRW(settlementSummary.thisTotal)}원</p>
          </div>

          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">전월 대비</p>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-2xl font-semibold tabular-nums">{deltaLabel}</p>
              <AppBadge variant={deltaVariant}>{deltaLabel}</AppBadge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              지난달({prevMonth}): {fmtKRW(settlementSummary.prevTotal)}원
            </p>
          </div>

          <div className="rounded-xl border bg-background p-4">
            <p className="text-xs text-muted-foreground">최고 매출 입점처</p>
            <p className="mt-1 text-lg font-semibold truncate">{settlementSummary.topName}</p>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              {fmtKRW(settlementSummary.topTotal)}원
            </p>
          </div>
        </div>
      </AppCard>
    </div>
  )
}

export const DashboardView = DashboardViewInner
export default DashboardViewInner