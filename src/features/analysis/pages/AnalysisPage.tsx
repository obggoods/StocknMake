import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import PageHeader from "@/app/layout/PageHeader"
import { AppCard } from "@/components/app/AppCard"
import { AppButton } from "@/components/app/AppButton"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorState } from "@/components/shared/ErrorState"
import { Skeleton } from "@/components/shared/Skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAppData } from "@/features/core/useAppData"
import { listSettlementAnalysisLinesDB } from "@/data/store.supabase"
import { supabase } from "@/lib/supabaseClient"
import {
  buildSalesAnalysis,
  getAnalysisMonths,
} from "@/features/analysis/lib/salesAnalysis"
import type {
  AnalysisLine,
  AnalysisRange,
  ProductChangeSummary,
  ProductSalesSummary,
  StoreSalesTrendSummary,
  StoreProductSummary,
} from "@/features/analysis/lib/analysisTypes"

const RANGE_OPTIONS: Array<{ value: AnalysisRange; label: string }> = [
  { value: "3m", label: "최근 3개월" },
  { value: "6m", label: "최근 6개월" },
  { value: "year", label: "올해" },
]

const MIN_NEW_QTY = 2

function formatKRW(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`
}

function formatQty(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}개`
}

function formatMonth(month: string) {
  const [, monthNum] = month.split("-")
  return `${Number(monthNum)}월`
}

function formatYearMonth(month: string) {
  const [year, monthNum] = month.split("-")
  return `${Number(year)}년 ${Number(monthNum)}월`
}

function formatComparisonMonth(month: string, includeYear: boolean) {
  return includeYear ? formatYearMonth(month) : formatMonth(month)
}

function getComparisonMonthLabels(months: string[]) {
  if (months.length < 2) {
    return {
      previousMonthLabel: "이전 달",
      currentMonthLabel: "최근 달",
    }
  }

  const previousMonth = months[months.length - 2]
  const currentMonth = months[months.length - 1]
  const includeYear = previousMonth.split("-")[0] !== currentMonth.split("-")[0]

  return {
    previousMonthLabel: formatComparisonMonth(previousMonth, includeYear),
    currentMonthLabel: formatComparisonMonth(currentMonth, includeYear),
  }
}

function formatChange(product: ProductChangeSummary, mode: "growth" | "decline") {
  if (product.previousQty === 0 && product.currentQty >= MIN_NEW_QTY) return "NEW"
  const rate = product.qtyChangeRate ?? product.amountChangeRate
  if (rate == null) return mode === "growth" ? "+0%" : "-0%"
  const roundedRate = Number(rate.toFixed(1))
  return `${roundedRate > 0 ? "+" : ""}${roundedRate.toLocaleString("ko-KR")}%`
}

function formatQtyChange(value: number) {
  const sign = value > 0 ? "+" : ""
  return `${value > 0 ? "▲" : "▼"} ${sign}${formatQty(value)}`
}

function formatSignedQty(value: number) {
  const sign = value > 0 ? "+" : ""
  return `${sign}${formatQty(value)}`
}

function maxMonthlyQty(product: ProductSalesSummary) {
  return Math.max(1, ...product.monthly.map((month) => month.qty))
}

function getCurrentMonthMetrics(analysis: ReturnType<typeof buildSalesAnalysis>) {
  const currentMonth = analysis.months[analysis.months.length - 1]
  const previousMonth = analysis.months[analysis.months.length - 2]
  const currentAmount = analysis.storeSalesTrends.reduce(
    (sum, store) => sum + (store.monthly.find((month) => month.month === currentMonth)?.amount ?? 0),
    0
  )
  const currentQty = analysis.storeSalesTrends.reduce(
    (sum, store) => sum + (store.monthly.find((month) => month.month === currentMonth)?.qty ?? 0),
    0
  )
  const currentNetMargin = analysis.storeSalesTrends.reduce(
    (sum, store) => sum + (store.monthly.find((month) => month.month === currentMonth)?.netMargin ?? 0),
    0
  )
  const previousAmount = previousMonth
    ? analysis.storeSalesTrends.reduce(
        (sum, store) => sum + (store.monthly.find((month) => month.month === previousMonth)?.amount ?? 0),
        0
      )
    : 0
  const amountChangeRate = previousAmount > 0 ? ((currentAmount - previousAmount) / previousAmount) * 100 : null

  return {
    currentAmount,
    currentQty,
    currentNetMargin,
    amountChangeRate,
  }
}

function formatRate(value: number | null) {
  if (value == null) return "비교 불가"
  const rounded = Number(value.toFixed(1))
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("ko-KR")}%`
}

export default function AnalysisPage() {
  const app = useAppData()
  const [range, setRange] = useState<AnalysisRange>("3m")
  const [lines, setLines] = useState<AnalysisLine[]>([])
  const [marginProfiles, setMarginProfiles] = useState<any[]>([])
  const [marginTargets, setMarginTargets] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const months = useMemo(() => getAnalysisMonths(range), [range])
  const comparisonMonthLabels = useMemo(() => getComparisonMonthLabels(months), [months])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        setLoading(true)
        setError("")
        const rows = await listSettlementAnalysisLinesDB({ months })
        if (!cancelled) setLines(rows)
      } catch {
        if (!cancelled) {
          setError("분석 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [months])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const { data: userData } = await supabase.auth.getUser()
      const user = userData.user
      if (!user) return

      const [profilesRes, targetsRes] = await Promise.all([
        supabase.from("margin_profiles").select("id,total_cost").eq("user_id", user.id),
        supabase.from("margin_profile_targets").select("profile_id,target_type,target_key").eq("user_id", user.id),
      ])

      if (cancelled) return
      setMarginProfiles(profilesRes.data ?? [])
      setMarginTargets(targetsRes.data ?? [])
    })().catch(() => {
      if (!cancelled) {
        setMarginProfiles([])
        setMarginTargets([])
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const profileCostById = useMemo(() => {
    const map = new Map<string, number>()
    for (const profile of marginProfiles) {
      map.set(String(profile.id), Number(profile.total_cost ?? 0) || 0)
    }
    return map
  }, [marginProfiles])

  const productCostMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const target of marginTargets) {
      if (target.target_type !== "product") continue
      const cost = profileCostById.get(String(target.profile_id))
      if (cost == null) continue
      map.set(String(target.target_key), cost)
    }
    return map
  }, [marginTargets, profileCostById])

  const categoryCostMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const target of marginTargets) {
      if (target.target_type !== "category") continue
      const cost = profileCostById.get(String(target.profile_id))
      if (cost == null) continue
      map.set(String(target.target_key), cost)
    }
    return map
  }, [marginTargets, profileCostById])

  const analysis = useMemo(
    () =>
      buildSalesAnalysis({
        lines,
        products: app.data.products,
        stores: app.data.stores,
        months,
        productCostMap,
        categoryCostMap,
      }),
    [app.data.products, app.data.stores, categoryCostMap, lines, months, productCostMap]
  )

  const isLoading = app.loading || loading
  const hasData = lines.length > 0

  if (app.errorMsg) {
    return <ErrorState message="기본 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." onRetry={app.refresh} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="분석"
        description="정산 데이터를 바탕으로 제품별 판매 흐름과 입점처별 성과를 확인합니다. 표시 월은 실제 판매월 기준입니다."
        action={
          <div className="inline-flex rounded-lg border bg-background p-1">
            {RANGE_OPTIONS.map((option) => (
              <AppButton
                key={option.value}
                type="button"
                variant={range === option.value ? "default" : "ghost"}
                size="sm"
                className="h-8 whitespace-nowrap px-3"
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </AppButton>
            ))}
          </div>
        }
      />

      {error ? <ErrorState message={error} /> : null}

      {isLoading ? (
        <AnalysisLoading />
      ) : !hasData ? (
        <EmptyState
          title="아직 분석할 정산 데이터가 없습니다."
          description="정산 데이터를 등록하면 판매 흐름을 확인할 수 있어요."
          className="min-h-56"
        />
      ) : (
        <>
          <SummaryCards analysis={analysis} />

          <AnalysisSection
            title="제품 흐름"
            description="최근 판매 변화를 기준으로 관리가 필요한 제품을 확인하세요."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <ChangeProductsCard
                title="주목할 제품"
                description="최근 판매 흐름이 좋아진 제품입니다."
                emptyTitle="현재 기준에 맞는 주목할 제품이 없습니다."
                mode="growth"
                previousMonthLabel={comparisonMonthLabels.previousMonthLabel}
                currentMonthLabel={comparisonMonthLabels.currentMonthLabel}
                products={analysis.growthProducts}
              />
              <ChangeProductsCard
                title="판매 둔화 제품"
                description="최근 판매 흐름이 줄어든 제품입니다."
                emptyTitle="현재 기준에 맞는 판매 둔화 제품이 없습니다."
                mode="decline"
                previousMonthLabel={comparisonMonthLabels.previousMonthLabel}
                currentMonthLabel={comparisonMonthLabels.currentMonthLabel}
                products={analysis.declineProducts}
              />
            </div>
          </AnalysisSection>

          <AnalysisSection
            title="입점처 흐름"
            description="최근 3개월 판매 추이를 확인하고 계약 연장 여부를 판단해보세요."
          >
            <StoreSalesTrendsCard stores={analysis.storeSalesTrends} />
          </AnalysisSection>

          <AnalysisSection title="하단 분석">
            <div className="grid gap-4 lg:grid-cols-2">
              <TopProductsCard products={analysis.topProducts} />
              <StoreProductsCard stores={analysis.storeProducts} />
            </div>

            <TrendProductsCard products={analysis.trendProducts} />
          </AnalysisSection>
        </>
      )}
    </div>
  )
}

function AnalysisSection(props: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{props.title}</h2>
        {props.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
      <div className="space-y-4">{props.children}</div>
    </section>
  )
}

function getStoreTrendMeta(trend: StoreSalesTrendSummary["trend"]) {
  if (trend === "growth") {
    return {
      label: "상승",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      dotClassName: "bg-emerald-500",
    }
  }

  if (trend === "decline") {
    return {
      label: "감소",
      className: "border-rose-200 bg-rose-50 text-rose-700",
      dotClassName: "bg-rose-500",
    }
  }

  return {
    label: "유지",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    dotClassName: "bg-amber-500",
  }
}

function StoreSalesTrendsCard({ stores }: { stores: StoreSalesTrendSummary[] }) {
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  const selectedStore = stores.find((store) => store.storeId === selectedStoreId) ?? null

  return (
    <>
      <AppCard title="입점처별 3개월 매출 흐름">
        {stores.length === 0 ? (
          <EmptyState title="최근 3개월 판매 데이터가 없습니다." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {stores.map((store) => {
              const trend = getStoreTrendMeta(store.trend)

              return (
                <button
                  key={store.storeId}
                  type="button"
                  className="min-h-0 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSelectedStoreId(store.storeId)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 font-semibold">
                      <div className="truncate">{store.storeName}</div>
                      <div className="mt-1 text-xs font-normal text-muted-foreground">
                        총 {formatKRW(store.totalAmount)}
                      </div>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${trend.className}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${trend.dotClassName}`} />
                      {trend.label}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {store.monthly.map((month, index) => {
                      const previous = index > 0 ? store.monthly[index - 1] : null
                      const direction =
                        previous && month.amount > previous.amount
                          ? "▲"
                          : previous && month.amount < previous.amount
                            ? "▼"
                            : ""

                      return (
                        <div
                          key={`${store.storeId}:${month.month}`}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span className="shrink-0 text-muted-foreground">
                            {formatMonth(month.month)}
                          </span>
                          <span className="whitespace-nowrap text-right font-medium tabular-nums">
                            {formatKRW(month.amount)}{" "}
                            {direction ? (
                              <span
                                className={
                                  direction === "▲" ? "text-emerald-600" : "text-rose-600"
                                }
                              >
                                {direction}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </AppCard>

      <StoreSalesDetailDialog
        store={selectedStore}
        open={Boolean(selectedStore)}
        onOpenChange={(open) => {
          if (!open) setSelectedStoreId(null)
        }}
      />
    </>
  )
}

function StoreSalesDetailDialog(props: {
  store: StoreSalesTrendSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { store, open, onOpenChange } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-24px)] max-w-[680px] flex-col overflow-hidden p-0 sm:p-6">
        {store ? (
          <>
            <DialogHeader className="shrink-0 px-4 pt-4 text-left sm:px-0 sm:pt-0">
              <DialogTitle className="truncate pr-8">{store.storeName}</DialogTitle>
            </DialogHeader>

            <div className="min-h-0 overflow-y-auto px-4 pb-4 sm:px-0 sm:pb-0">
              <div className="space-y-5">
                <DetailBlock title="최근 3개월">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {store.monthly.map((month) => (
                      <div key={month.month} className="rounded-lg border p-3">
                        <div className="text-sm text-muted-foreground">
                          {formatMonth(month.month)}
                        </div>
                        <div className="mt-1 whitespace-nowrap text-base font-semibold tabular-nums">
                          {formatKRW(month.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                </DetailBlock>

                <DetailBlock title="총 판매금액">
                  <div className="whitespace-nowrap text-xl font-semibold tabular-nums">
                    {formatKRW(store.totalAmount)}
                  </div>
                </DetailBlock>

                <DetailBlock title="순마진 계산">
                  <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
                    <MarginBreakdownRow label="매출" value={store.totalAmount} />
                    <MarginBreakdownRow label="판매수수료" value={-store.totalCommission} muted />
                    <MarginBreakdownRow label="상품원가" value={-store.totalCost} muted />
                    {store.includeMonthlyRentInMargin ? (
                      <MarginBreakdownRow label="월 입점비" value={-store.totalRentFee} muted />
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">월 입점비</span>
                        <span className="text-right text-muted-foreground">(계산 제외)</span>
                      </div>
                    )}
                    <div className="border-t pt-2">
                      <MarginBreakdownRow label="순마진" value={store.totalNetMargin} strong />
                    </div>
                  </div>
                </DetailBlock>

                <DetailBlock title="판매 제품">
                  <DetailRows
                    rows={store.productsByQty.map((product) => ({
                      key: product.productKey,
                      label: product.productName,
                      value: formatQty(product.qty),
                    }))}
                    emptyTitle="판매 제품 데이터가 없습니다."
                  />
                </DetailBlock>

                <DetailBlock title="제품별 매출">
                  <DetailRows
                    rows={store.productsByAmount.map((product) => ({
                      key: product.productKey,
                      label: product.productName,
                      value: formatKRW(product.amount),
                    }))}
                    emptyTitle="제품별 매출 데이터가 없습니다."
                  />
                </DetailBlock>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function MarginBreakdownRow(props: {
  label: string
  value: number
  muted?: boolean
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={props.muted ? "text-muted-foreground" : ""}>{props.label}</span>
      <span
        className={
          props.strong
            ? "text-right font-semibold tabular-nums"
            : "text-right tabular-nums text-muted-foreground"
        }
      >
        {formatKRW(props.value)}
      </span>
    </div>
  )
}

function DetailBlock(props: { title: string; children: ReactNode }) {
  return (
    <section className="border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-sm font-semibold">{props.title}</h3>
      {props.children}
    </section>
  )
}

function DetailRows(props: {
  rows: Array<{ key: string; label: string; value: string }>
  emptyTitle: string
}) {
  if (props.rows.length === 0) {
    return <div className="text-sm text-muted-foreground">{props.emptyTitle}</div>
  }

  return (
    <div className="space-y-2">
      {props.rows.map((row) => (
        <div key={row.key} className="flex items-start justify-between gap-4 text-sm">
          <div className="min-w-0 truncate">{row.label}</div>
          <div className="shrink-0 whitespace-nowrap text-right font-medium tabular-nums text-muted-foreground">
            {row.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function AnalysisLoading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-72" />
        ))}
      </div>
    </div>
  )
}

function SummaryCards({ analysis }: { analysis: ReturnType<typeof buildSalesAnalysis> }) {
  const current = getCurrentMonthMetrics(analysis)
  const items = [
    { label: "이번 달 매출", value: formatKRW(current.currentAmount) },
    { label: "판매 수량", value: formatQty(current.currentQty) },
    { label: "순마진", value: formatKRW(current.currentNetMargin) },
    { label: "전월 대비", value: formatRate(current.amountChangeRate) },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <AppCard key={item.label} density="compact" className="min-w-0">
          <div className="text-sm text-muted-foreground">{item.label}</div>
          <div className="mt-2 break-words text-2xl font-semibold tabular-nums">{item.value}</div>
        </AppCard>
      ))}
    </div>
  )
}

function TopProductsCard({ products }: { products: ProductSalesSummary[] }) {
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)

  return (
    <AppCard title="제품별 매출 TOP5" description="선택 기간 내 매출 기준 상위 제품입니다.">
      {products.length === 0 ? (
        <EmptyState title="판매 제품 데이터가 없습니다." />
      ) : (
        <div className="space-y-3">
          {products.map((product, index) => {
            const expanded = expandedProductId === product.productId

            return (
              <div key={product.productId} className="overflow-hidden rounded-lg border bg-background">
                <button
                  type="button"
                  className="w-full px-3 py-3 text-left transition-colors hover:bg-accent/20"
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedProductId((current) =>
                      current === product.productId ? null : product.productId
                    )
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs text-muted-foreground">{product.categoryName ?? "미분류"}</div>
                        <div className="truncate text-sm font-medium">{product.productName}</div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-start gap-2 text-right">
                      <div className="tabular-nums">
                        <div className="text-sm font-semibold">{formatKRW(product.totalAmount)}</div>
                        <div className="text-xs text-muted-foreground">{formatQty(product.totalQty)}</div>
                      </div>
                      <div className="mt-0.5 flex items-center text-muted-foreground">
                        <ChevronDown
                          className={
                            expanded
                              ? "h-4 w-4 rotate-180 transition-transform"
                              : "h-4 w-4 transition-transform"
                          }
                        />
                      </div>
                    </div>
                  </div>
                </button>

                {expanded ? (
                  <div className="border-t bg-muted/20 px-3 py-3">
                    {product.stores.length === 0 ? (
                      <div className="text-sm text-muted-foreground">입점처별 판매 데이터가 없습니다.</div>
                    ) : (
                      <div className="space-y-2">
                        {product.stores.map((store) => (
                          <div
                            key={store.storeId}
                            className="flex items-start justify-between gap-3 text-sm"
                          >
                            <div className="min-w-0 truncate">{store.storeName}</div>
                            <div className="shrink-0 text-right tabular-nums text-muted-foreground">
                              {formatQty(store.qty)} · {formatKRW(store.amount)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </AppCard>
  )
}

function ChangeProductsCard(props: {
  title: string
  description: string
  emptyTitle: string
  mode: "growth" | "decline"
  previousMonthLabel: string
  currentMonthLabel: string
  products: ProductChangeSummary[]
}) {
  const { title, description, emptyTitle, mode, previousMonthLabel, currentMonthLabel, products } = props
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)

  return (
    <AppCard title={title} description={description}>
      {products.length === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <div className="space-y-2.5">
          {products.map((product) => {
            const changeLabel = formatChange(product, mode)
            const qtyChange = product.currentQty - product.previousQty
            const showQtyChange = qtyChange !== 0
            const expanded = expandedProductId === product.productId

            return (
              <div key={product.productId} className="overflow-hidden rounded-lg border bg-background">
                <button
                  type="button"
                  className="w-full p-2.5 text-left transition-colors hover:bg-accent/20"
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedProductId((current) =>
                      current === product.productId ? null : product.productId
                    )
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-muted-foreground">{product.categoryName ?? "미분류"}</div>
                      <div className="truncate text-sm font-medium">{product.productName}</div>
                    </div>
                    <div className="mt-0.5 flex shrink-0 items-center text-muted-foreground">
                      <ChevronDown
                        className={
                          expanded
                            ? "h-4 w-4 rotate-180 transition-transform"
                            : "h-4 w-4 transition-transform"
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                    {showQtyChange ? (
                      <div
                        className={
                          mode === "growth"
                            ? "min-w-0 text-base font-bold tabular-nums text-primary"
                            : "min-w-0 text-base font-bold tabular-nums text-destructive"
                        }
                      >
                        {changeLabel === "NEW" ? (
                          <>
                            <span className="whitespace-nowrap">▲ 신규 판매</span>
                            <span className="ml-1 text-xs font-semibold whitespace-nowrap">
                              ({formatSignedQty(qtyChange)})
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="whitespace-nowrap">{formatQtyChange(qtyChange)}</span>
                            <span className="ml-1 text-xs font-semibold whitespace-nowrap">({changeLabel})</span>
                          </>
                        )}
                      </div>
                    ) : changeLabel === "NEW" ? (
                      <div className="min-w-0 text-base font-bold tabular-nums text-primary">
                        <span className="whitespace-nowrap">▲ 신규 판매</span>
                      </div>
                    ) : (
                      <div className={mode === "growth" ? "text-xs font-semibold text-primary" : "text-xs font-semibold text-destructive"}>
                        ({changeLabel})
                      </div>
                    )}
                  </div>
                  <div className="mt-1.5 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] sm:items-center">
                    <div className="rounded-md bg-muted/40 p-1.5">
                      <div className="font-medium text-foreground">{previousMonthLabel}</div>
                      <div className="mt-1 tabular-nums">
                        <span className="font-semibold text-foreground">{formatQty(product.previousQty)}</span> ·{" "}
                        {formatKRW(product.previousAmount)}
                      </div>
                    </div>
                    <div className="flex justify-center text-muted-foreground">
                      <span className="text-sm leading-none">→</span>
                    </div>
                    <div className="rounded-md bg-muted/40 p-1.5">
                      <div className="font-medium text-foreground">{currentMonthLabel}</div>
                      <div className="mt-1 tabular-nums">
                        <span className="font-semibold text-foreground">{formatQty(product.currentQty)}</span> ·{" "}
                        {formatKRW(product.currentAmount)}
                      </div>
                    </div>
                  </div>
                </button>

                {expanded ? (
                  <div className="border-t bg-muted/20 px-3 py-3">
                    {product.stores.length === 0 ? (
                      <div className="text-sm text-muted-foreground">입점처별 판매 데이터가 없습니다.</div>
                    ) : (
                      <div className="space-y-2">
                        {product.stores.map((store) => (
                          <div
                            key={store.storeId}
                            className="flex items-start justify-between gap-3 text-sm"
                          >
                            <div className="min-w-0 truncate">{store.storeName}</div>
                            <div className="shrink-0 text-right tabular-nums text-muted-foreground">
                              {formatQty(store.qty)} · {formatKRW(store.amount)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </AppCard>
  )
}

function StoreProductsCard({ stores }: { stores: StoreProductSummary[] }) {
  return (
    <AppCard title="입점처별 잘 팔린 제품" description="입점처별 판매수량 TOP3 제품입니다.">
      {stores.length === 0 ? (
        <EmptyState title="입점처별 판매 데이터가 없습니다." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
          {stores.map((store) => (
            <div key={store.storeId} className="rounded-lg border p-3">
              <div className="font-medium">{store.storeName}</div>
              <div className="mt-3 space-y-2">
                {store.products.map((product) => (
                  <div key={`${store.storeId}:${product.productId}`} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-muted-foreground">{product.categoryName ?? "미분류"}</div>
                      <div className="truncate">{product.productName}</div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums text-muted-foreground">
                      <div>{formatQty(product.qty)}</div>
                      <div className="text-xs">{formatKRW(product.amount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppCard>
  )
}

function TrendProductsCard({ products }: { products: ProductSalesSummary[] }) {
  return (
    <AppCard title="제품별 최근 월별 추이" description="매출 TOP5 제품의 월별 판매수량과 매출입니다.">
      {products.length === 0 ? (
        <EmptyState title="월별 추이를 표시할 제품 데이터가 없습니다." />
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">막대 길이 = 판매수량 기준</div>

          <div className="grid gap-4 lg:grid-cols-2">
            {products.map((product) => {
              const maxQty = maxMonthlyQty(product)

              return (
                <div key={product.productId} className="rounded-lg border p-4">
                  <div className="min-w-0">
                    <div className="truncate text-xs text-muted-foreground">{product.categoryName ?? "미분류"}</div>
                    <div className="truncate text-sm font-semibold">{product.productName}</div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {product.monthly.map((month) => {
                      const width = month.qty === 0 ? "0%" : `${Math.max(4, Math.round((month.qty / maxQty) * 100))}%`

                      return (
                        <div
                          key={`${product.productId}:${month.month}`}
                          className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[2.5rem_minmax(0,1fr)_8.75rem]"
                        >
                          <span className="shrink-0 font-medium">
                            {formatMonth(month.month)}
                          </span>

                          <div className="h-2 min-w-0 overflow-hidden rounded-full bg-muted">
                            <div
                              className={
                                month.qty === 0
                                  ? "h-full w-0 rounded-full bg-muted-foreground/25"
                                  : "h-full rounded-full bg-primary/70"
                              }
                              style={{ width }}
                            />
                          </div>

                          <span className="col-start-2 min-w-0 truncate text-right tabular-nums text-muted-foreground sm:col-start-auto">
                            {formatQty(month.qty)} · {formatKRW(month.amount)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </AppCard>
  )
}
