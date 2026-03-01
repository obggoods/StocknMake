import { useMemo } from "react"

import { AppBadge } from "@/components/app/AppBadge"
import { AppCard } from "@/components/app/AppCard"

import { EmptyState } from "@/components/shared/EmptyState"
import { Skeleton } from "@/components/shared/Skeleton"
import { UpgradeBlock } from "@/components/shared/UpgradeBlock"

export type MarketplacePerformanceSettlement = {
  id: string
  marketplace_id: string
  // 프로젝트 DB에서는 period_month / net_amount를 쓰고 있어 둘 다 허용
  month?: string // "YYYY-MM" (legacy)
  period_month?: string // "YYYY-MM" (v2)
  gross_amount: number
  net_settlement_amount?: number
  net_amount?: number
  created_at: string
}

export type MarketplacePerformanceMarketplace = {
  id: string
  name: string
}

export type MarketplacePerformanceProps = {
  settlements?: MarketplacePerformanceSettlement[] | null
  marketplaces?: MarketplacePerformanceMarketplace[] | null
  userPlan: "free" | "basic" | "pro" | "enterprise" | string
  isLoading?: boolean
  onUpgradeClick?: () => void

  // ✅ 정산 탭에서 사용
  focusMonth?: string // "YYYY-MM" (선택 시 해당 월 기준으로 집계)
  focusMarketplaceId?: string // 특정 입점처만 보고 싶으면
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

function fmtKRW(v: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(v))
}

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

export default function MarketplacePerformance(props: MarketplacePerformanceProps) {
  const {
    settlements,
    marketplaces,
    userPlan,
    isLoading = false,
    onUpgradeClick,
    focusMonth,
    focusMarketplaceId,
  } = props

  // ✅ 플랜 제한
  if (String(userPlan).toLowerCase() === "free") {
    return <UpgradeBlock onUpgradeClick={onUpgradeClick} />
  }

  // ✅ 로딩
  if (isLoading || settlements == null || marketplaces == null) {
    return (
      <AppCard
        title="입점처 성과 분석"
        description={focusMonth ? `${focusMonth} 매출/순위/전월 대비` : "최근 30일 매출/순위/전월 대비"}
      >
        <div className="grid gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      </AppCard>
    )
  }

  const marketplaceNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of marketplaces) m.set(String(x.id), String(x.name ?? ""))
    return m
  }, [marketplaces])

  // 기준 기간 계산
  const now = new Date()
  const thisPeriod = focusMonth ?? ym(now)

  // focusMonth가 있으면 해당 월의 전월 계산을 "그 월 기준"으로 잡아야 함
  const baseDateForPrev = focusMonth ? new Date(`${focusMonth}-01T00:00:00`) : now
  const prevPeriod = ym(addMonths(baseDateForPrev, -1))

  const since30d = useMemo(() => {
    const d = new Date(now)
    d.setDate(d.getDate() - 30)
    return d
  }, [now])

  const {
    rows, // (mode에 따라 최근30일 or focusMonth 집계 결과)
    total, // (최근30일 총매출 or focusMonth 총매출)
    top1,
    ranked,
    thisTotalByMonth, // 이번달(혹은 focusMonth) 월 합계
    prevTotalByMonth, // 전월 합계
    deltaLabel,
    deltaVariant,
    scopeLabel,
    titleLabel,
    emptyTitle,
    emptyDesc,
  } = useMemo(() => {
    const sumByMarketplace = new Map<string, number>()
    let totalScope = 0

    let thisM = 0
    let prevM = 0

    const focusMid = focusMarketplaceId ? String(focusMarketplaceId) : null

    for (const s of settlements) {
      const gross = n(s.gross_amount)
      const period = String((s as any).period_month ?? (s as any).month ?? "")
      const mid = String((s as any).marketplace_id ?? "")

      // 특정 입점처만 보는 경우: 모든 계산에서 필터
      if (focusMid && mid !== focusMid) continue

      // 월 합계(전월 대비)는 항상 period 기준으로 계산
      if (period === thisPeriod) thisM += gross
      if (period === prevPeriod) prevM += gross

      // 집계 스코프: focusMonth가 있으면 period 기준 / 아니면 최근 30일 created_at 기준
      if (focusMonth) {
        if (period !== thisPeriod) continue
        totalScope += gross
        sumByMarketplace.set(mid, (sumByMarketplace.get(mid) ?? 0) + gross)
      } else {
        const createdAt = new Date(String((s as any).created_at ?? ""))
        if (Number.isFinite(createdAt.getTime()) && createdAt >= since30d) {
          totalScope += gross
          sumByMarketplace.set(mid, (sumByMarketplace.get(mid) ?? 0) + gross)
        }
      }
    }

    const outRows = Array.from(sumByMarketplace.entries()).map(([marketplaceId, totalSales]) => {
      const name = marketplaceNameById.get(marketplaceId) || marketplaceId
      return {
        marketplace_id: marketplaceId,
        marketplace_name: name,
        total_sales: totalSales,
      }
    })

    outRows.sort((a, b) => b.total_sales - a.total_sales)

    const deltaPct = prevM === 0 ? null : ((thisM - prevM) / prevM) * 100
    const deltaValue = deltaPct ?? 0

    const dLabel =
      prevM === 0 ? "신규 매출" : `${deltaValue >= 0 ? "+" : ""}${deltaValue.toFixed(1)}%`

    const dVariant =
      prevM === 0 ? "muted" : deltaValue >= 0 ? "default" : "destructive"

    const scopeLabel = focusMonth ? `${thisPeriod} 기준` : "최근 30일 기준"
    const titleLabel = focusMonth ? `${thisPeriod} 매출/순위/전월 대비` : "최근 30일 매출/순위/전월 대비"

    const emptyTitle = "정산 데이터 없음"
    const emptyDesc = focusMonth
      ? `${thisPeriod}에 해당하는 정산 데이터가 없습니다.`
      : "최근 30일 내 생성된 정산 데이터가 없습니다."

    return {
      rows: outRows,
      total: totalScope,
      top1: outRows[0] ?? null,
      ranked: outRows,
      thisTotalByMonth: thisM,
      prevTotalByMonth: prevM,
      deltaLabel: dLabel,
      deltaVariant: dVariant,
      scopeLabel,
      titleLabel,
      emptyTitle,
      emptyDesc,
    }
  }, [
    settlements,
    marketplaceNameById,
    focusMonth,
    focusMarketplaceId,
    thisPeriod,
    prevPeriod,
    since30d,
  ])

  if (ranked.length === 0) {
    return (
      <AppCard title="입점처 성과 분석" description={titleLabel}>
        <EmptyState title={emptyTitle} description={emptyDesc} />
      </AppCard>
    )
  }

  // progress-style 비교를 위한 max
  const max = Math.max(...rows.map((r) => Number(r.total_sales ?? 0)), 0)

  return (
    <AppCard title="입점처 성과 분석" description={titleLabel}>
      <div className="grid gap-4">
        {/* 요약 */}
        <div className="grid gap-3 rounded-xl border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              {focusMarketplaceId ? "선택 입점처 매출 요약" : "최고 매출 입점처"}
            </div>
            <AppBadge variant="muted">{scopeLabel}</AppBadge>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-base">
              <span className="font-semibold">{top1?.marketplace_name ?? "-"}</span>
              <span className="text-muted-foreground"> · {fmtKRW(top1?.total_sales ?? 0)}원</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground">전월 대비</div>
              <AppBadge variant={deltaVariant as any}>{deltaLabel}</AppBadge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">
                {focusMonth ? "해당 월 총매출" : "최근 30일 총매출"}
              </span>
              <span className="ml-2 font-medium">{fmtKRW(total)}원</span>
            </div>
            <div>
              <span className="text-muted-foreground">이번 달({thisPeriod})</span>
              <span className="ml-2 font-medium">{fmtKRW(thisTotalByMonth)}원</span>
            </div>
            <div>
              <span className="text-muted-foreground">지난 달({prevPeriod})</span>
              <span className="ml-2 font-medium">{fmtKRW(prevTotalByMonth)}원</span>
            </div>
          </div>
        </div>

        {/* 순위 */}
        {!focusMarketplaceId ? (
          <div className="grid gap-3">
            <div className="text-sm font-medium">
              입점처별 매출 순위 ({focusMonth ? thisPeriod : "최근 30일"})
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="divide-y">
                {ranked.slice(0, 10).map((r, idx) => (
                  <div key={r.marketplace_id} className="flex items-center justify-between gap-3 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <AppBadge variant={idx === 0 ? "default" : "muted"}>#{idx + 1}</AppBadge>
                      <div className="truncate text-sm">{r.marketplace_name}</div>
                    </div>
                    <div className="shrink-0 text-sm font-medium tabular-nums">
                      {fmtKRW(r.total_sales)}원
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {ranked.length > 10 ? (
              <div className="text-xs text-muted-foreground">상위 10개만 표시합니다.</div>
            ) : null}
          </div>
        ) : null}

        {/* 비교 (미니멀 progress bars) */}
        <div className="grid gap-3">
          <div className="text-sm font-medium">입점처별 매출 비교</div>

          <div className="rounded-xl border bg-background p-4">
            <div className="grid gap-3">
              {rows.map((r, idx) => {
                const v = Number(r.total_sales ?? 0)
                const ratio = max > 0 ? clamp01(v / max) : 0
                const isTop = idx === 0

                return (
                  <div key={r.marketplace_id} className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.marketplace_name}</div>
                      </div>
                      <div className="shrink-0 text-sm font-semibold tabular-nums">
                        {fmtKRW(v)}원
                      </div>
                    </div>

                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={isTop ? "h-full rounded-full bg-primary" : "h-full rounded-full bg-primary/60"}
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                        aria-label={`${r.marketplace_name} 매출 비율`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* note */}
        {focusMonth ? (
          <div className="text-xs text-muted-foreground">
            표시 기준: 선택한 월({thisPeriod})의 정산 데이터를 집계합니다.
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            표시 기준: created_at 기준 최근 30일 내 생성된 정산을 집계합니다.
          </div>
        )}
      </div>
    </AppCard>
  )
}