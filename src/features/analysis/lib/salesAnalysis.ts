import type { Product, Store } from "@/data/models"
import type {
  AnalysisLine,
  AnalysisRange,
  ProductChangeSummary,
  ProductSalesSummary,
  SalesAnalysis,
  StoreProductSummary,
  StoreSalesTrend,
  StoreSalesTrendSummary,
} from "./analysisTypes"

const MIN_NEW_QTY = 2
const MIN_INCREASE_QTY = 3
const MIN_DECREASE_QTY = 3

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function addMonths(month: string, offset: number) {
  const [year, monthNum] = month.split("-").map((value) => Number(value))
  const date = new Date(year, monthNum - 1 + offset, 1)
  return monthKey(date)
}

export function getSalesMonthFromSettlementMonth(month: string) {
  return addMonths(month, -1)
}

export function getAnalysisMonths(range: AnalysisRange, now = new Date()) {
  const current = monthKey(now)

  if (range === "year") {
    return Array.from({ length: now.getMonth() + 1 }, (_, index) =>
      monthKey(new Date(now.getFullYear(), index, 1))
    )
  }

  const count = range === "6m" ? 6 : 3
  return Array.from({ length: count }, (_, index) => addMonths(current, index - count + 1))
}

export function getPreviousAnalysisMonths(range: AnalysisRange, months: string[]) {
  if (months.length === 0) return []

  if (range === "year") {
    return months.map((month) => addMonths(month, -12))
  }

  const count = range === "6m" ? 6 : 3
  return months.map((month) => addMonths(month, -count))
}

function getProductName(product: Product | undefined, fallback: string) {
  const name = String(product?.name ?? fallback ?? "").trim()
  return name || "상품명 없음"
}

function getCategoryName(product: Product | undefined) {
  const category = String(product?.category ?? "").trim()
  return category || null
}

function getStoreName(store: Store | undefined) {
  const name = String(store?.name ?? "").trim()
  return name || "입점처명 없음"
}

function normalizeCommissionRate(rate: number | null | undefined) {
  const value = Number(rate ?? 0)
  if (!Number.isFinite(value) || value <= 0) return 0
  return value <= 1 ? value : value / 100
}

function normalizeMonthlyRentFee(store: Store | undefined) {
  const value = Number(store?.storeFee ?? store?.monthlyRentFee ?? 0)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function getProductCost(input: {
  productId: string | null
  product: Product | undefined
  productCostMap?: Map<string, number>
  categoryCostMap?: Map<string, number>
}) {
  const { productId, product, productCostMap, categoryCostMap } = input
  if (productId && productCostMap?.has(productId)) return Math.max(0, Number(productCostMap.get(productId) ?? 0) || 0)
  const category = String(product?.category ?? "").trim()
  if (category && categoryCostMap?.has(category)) return Math.max(0, Number(categoryCostMap.get(category) ?? 0) || 0)
  return 0
}

function calcChangeRate(previous: number, current: number) {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

function getComparableMonths(months: string[]) {
  if (months.length < 2) return null
  return {
    previousMonth: months[months.length - 2],
    currentMonth: months[months.length - 1],
  }
}

function hasRecentConsecutiveDecline(product: ProductSalesSummary) {
  if (product.monthly.length < 3) return false

  const recent = product.monthly.slice(-3).map((month) => month.qty)
  return recent[0] > recent[1] && recent[1] > recent[2]
}

function getStoreSalesTrend(monthly: { amount: number }[]): StoreSalesTrend {
  if (monthly.length < 3) return "steady"

  const recent = monthly.slice(-3).map((month) => month.amount)
  if (recent[0] < recent[1] && recent[1] < recent[2]) return "growth"
  if (recent[0] > recent[1] && recent[1] > recent[2]) return "decline"
  return "steady"
}

function isNotableProduct(product: ProductChangeSummary) {
  const qtyIncrease = product.currentQty - product.previousQty
  const amountIncrease = product.currentAmount - product.previousAmount
  const isNewMeaningfulSale = product.previousQty === 0 && product.currentQty >= MIN_NEW_QTY
  const hasRecentSalesMomentum =
    product.previousQty > 0 &&
    product.currentQty > 0 &&
    product.currentQty >= product.previousQty &&
    product.currentQty >= MIN_NEW_QTY
  const hasMeaningfulQtyIncrease = qtyIncrease >= MIN_INCREASE_QTY
  const hasMeaningfulAmountIncrease =
    amountIncrease > 0 && product.currentQty >= MIN_NEW_QTY && product.currentQty > product.previousQty

  return (
    isNewMeaningfulSale ||
    hasRecentSalesMomentum ||
    hasMeaningfulQtyIncrease ||
    hasMeaningfulAmountIncrease
  )
}

function isSlowingProduct(product: ProductChangeSummary, summary: ProductSalesSummary | undefined) {
  const qtyDecrease = product.previousQty - product.currentQty
  const amountDecrease = product.previousAmount - product.currentAmount
  const droppedToZeroFromMeaningfulSales = product.previousQty >= MIN_NEW_QTY && product.currentQty === 0
  const hasMeaningfulQtyDecrease = qtyDecrease >= MIN_DECREASE_QTY
  const hasConsecutiveDecline = summary ? hasRecentConsecutiveDecline(summary) : false
  const hasMeaningfulAmountDecrease =
    amountDecrease > 0 && product.previousQty >= MIN_NEW_QTY && product.currentQty < product.previousQty

  return (
    droppedToZeroFromMeaningfulSales ||
    hasConsecutiveDecline ||
    hasMeaningfulQtyDecrease ||
    hasMeaningfulAmountDecrease
  )
}

export function buildSalesAnalysis(input: {
  lines: AnalysisLine[]
  products: Product[]
  stores: Store[]
  months: string[]
  productCostMap?: Map<string, number>
  categoryCostMap?: Map<string, number>
}): SalesAnalysis {
  const { lines, products, stores, months, productCostMap, categoryCostMap } = input
  const productMap = new Map(products.map((product) => [String(product.id), product]))
  const storeMap = new Map(stores.map((store) => [String(store.id), store]))
  const monthSet = new Set(months)

  const totals = {
    qty: 0,
    amount: 0,
  }
  const activeStores = new Set<string>()
  const soldProducts = new Set<string>()

  const productAgg = new Map<
    string,
    {
      productId: string
      productName: string
      categoryName: string | null
      totalQty: number
      totalAmount: number
      monthly: Map<string, { qty: number; amount: number }>
      stores: Map<string, { storeName: string; qty: number; amount: number }>
    }
  >()

  const storeAgg = new Map<
    string,
    {
      storeId: string
      storeName: string
      totalQty: number
      totalAmount: number
      commissionRate: number
      monthlyRentFee: number
      includeMonthlyRentInMargin: boolean
      monthly: Map<string, { qty: number; amount: number; cost: number }>
      products: Map<
        string,
        {
          productId: string | null
          productKey: string
          productName: string
          categoryName: string | null
          qty: number
          amount: number
        }
      >
    }
  >()

  for (const line of lines) {
    if (!monthSet.has(line.month)) continue

    const qty = Number(line.qty ?? 0) || 0
    const amount = Number(line.amount ?? 0) || 0

    totals.qty += qty
    totals.amount += amount

    if (line.storeId) activeStores.add(line.storeId)

    const product = line.productId ? productMap.get(line.productId) : undefined
    const productName = getProductName(product, line.productNameMatched ?? line.productNameRaw)
    const categoryName = getCategoryName(product)
    const store = storeMap.get(line.storeId)
    const storeName = getStoreName(store)
    const unitCost = getProductCost({ productId: line.productId, product, productCostMap, categoryCostMap })
    const lineCost = unitCost * qty

    if (line.storeId) {
      const storeCurrent =
        storeAgg.get(line.storeId) ?? {
          storeId: line.storeId,
          storeName,
          totalQty: 0,
          totalAmount: 0,
          commissionRate: normalizeCommissionRate(store?.commissionRate),
          monthlyRentFee: normalizeMonthlyRentFee(store),
          includeMonthlyRentInMargin: store?.includeMonthlyRentInMargin ?? true,
          monthly: new Map<string, { qty: number; amount: number; cost: number }>(),
          products: new Map(),
        }

      storeCurrent.totalQty += qty
      storeCurrent.totalAmount += amount

      const storeMonth = storeCurrent.monthly.get(line.month) ?? { qty: 0, amount: 0, cost: 0 }
      storeCurrent.monthly.set(line.month, {
        qty: storeMonth.qty + qty,
        amount: storeMonth.amount + amount,
        cost: storeMonth.cost + lineCost,
      })

      const productKey = line.productId ? `product:${line.productId}` : `unmatched:${productName}`
      const storeProduct = storeCurrent.products.get(productKey) ?? {
        productId: line.productId,
        productKey,
        productName,
        categoryName,
        qty: 0,
        amount: 0,
      }

      storeCurrent.products.set(productKey, {
        ...storeProduct,
        qty: storeProduct.qty + qty,
        amount: storeProduct.amount + amount,
      })
      storeAgg.set(line.storeId, storeCurrent)
    }

    if (!line.productId) continue

    soldProducts.add(line.productId)

    const productCurrent =
      productAgg.get(line.productId) ?? {
        productId: line.productId,
        productName,
        categoryName,
        totalQty: 0,
        totalAmount: 0,
        monthly: new Map<string, { qty: number; amount: number }>(),
        stores: new Map<string, { storeName: string; qty: number; amount: number }>(),
      }

    productCurrent.totalQty += qty
    productCurrent.totalAmount += amount

    const monthCurrent = productCurrent.monthly.get(line.month) ?? { qty: 0, amount: 0 }
    productCurrent.monthly.set(line.month, {
      qty: monthCurrent.qty + qty,
      amount: monthCurrent.amount + amount,
    })

    if (line.storeId) {
      const storeCurrent = productCurrent.stores.get(line.storeId) ?? { storeName, qty: 0, amount: 0 }
      productCurrent.stores.set(line.storeId, {
        storeName,
        qty: storeCurrent.qty + qty,
        amount: storeCurrent.amount + amount,
      })
    }

    productAgg.set(line.productId, productCurrent)

  }

  const productSummaries: ProductSalesSummary[] = Array.from(productAgg.values())
    .map((product) => ({
      productId: product.productId,
      productName: product.productName,
      categoryName: product.categoryName,
      totalQty: product.totalQty,
      totalAmount: product.totalAmount,
      monthly: months.map((month) => ({
        month,
        qty: product.monthly.get(month)?.qty ?? 0,
        amount: product.monthly.get(month)?.amount ?? 0,
      })),
      stores: Array.from(product.stores.entries())
        .map(([storeId, value]) => ({
          storeId,
          storeName: value.storeName,
          qty: value.qty,
          amount: value.amount,
        }))
        .sort((a, b) => b.qty - a.qty || b.amount - a.amount),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount || b.totalQty - a.totalQty)

  const comparable = getComparableMonths(months)
  const changes: ProductChangeSummary[] = comparable
    ? productSummaries
        .map((product) => {
          const previous = product.monthly.find((month) => month.month === comparable.previousMonth)
          const current = product.monthly.find((month) => month.month === comparable.currentMonth)

          return {
            productId: product.productId,
            productName: product.productName,
            categoryName: product.categoryName,
            previousQty: previous?.qty ?? 0,
            currentQty: current?.qty ?? 0,
            previousAmount: previous?.amount ?? 0,
            currentAmount: current?.amount ?? 0,
            qtyChangeRate: calcChangeRate(previous?.qty ?? 0, current?.qty ?? 0),
            amountChangeRate: calcChangeRate(previous?.amount ?? 0, current?.amount ?? 0),
            stores: product.stores,
          }
        })
        .filter((product) => product.previousQty !== 0 || product.currentQty !== 0)
    : []

  const productSummaryById = new Map(productSummaries.map((product) => [product.productId, product]))

  const growthProducts = changes
    .filter((product) => isNotableProduct(product))
    .sort((a, b) => {
      const qtyDiff = b.currentQty - b.previousQty - (a.currentQty - a.previousQty)
      if (qtyDiff !== 0) return qtyDiff

      const amountDiff = b.currentAmount - b.previousAmount - (a.currentAmount - a.previousAmount)
      if (amountDiff !== 0) return amountDiff

      return b.currentQty - a.currentQty
    })
    .slice(0, 5)

  const declineProducts = changes
    .filter((product) => isSlowingProduct(product, productSummaryById.get(product.productId)))
    .sort((a, b) => {
      const qtyDiff = b.previousQty - b.currentQty - (a.previousQty - a.currentQty)
      if (qtyDiff !== 0) return qtyDiff

      const amountDiff = b.previousAmount - b.currentAmount - (a.previousAmount - a.currentAmount)
      if (amountDiff !== 0) return amountDiff

      return b.previousQty - a.previousQty
    })
    .slice(0, 5)

  const storeProducts: StoreProductSummary[] = Array.from(storeAgg.values())
    .map((store) => ({
      storeId: store.storeId,
      storeName: store.storeName,
      products: Array.from(store.products.values())
        .filter((product) => product.productId)
        .map((product) => ({
          productId: String(product.productId),
          productName: product.productName,
          categoryName: product.categoryName,
          qty: product.qty,
          amount: product.amount,
        }))
        .sort((a, b) => b.qty - a.qty || b.amount - a.amount)
        .slice(0, 3),
    }))
    .filter((store) => store.products.length > 0)
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"))

  const storeSalesTrends: StoreSalesTrendSummary[] = Array.from(storeAgg.values())
    .map((store) => {
      const monthly = months.map((month) => ({
        month,
        qty: store.monthly.get(month)?.qty ?? 0,
        amount: store.monthly.get(month)?.amount ?? 0,
        cost: store.monthly.get(month)?.cost ?? 0,
      }))
      const monthlyWithMargin = monthly.map((month) => {
        const commission = month.amount * store.commissionRate
        const rentFee =
          store.includeMonthlyRentInMargin && month.amount > 0 ? store.monthlyRentFee : 0
        return {
          ...month,
          commission,
          rentFee,
          netMargin: month.amount - commission - month.cost - rentFee,
        }
      })
      const products = Array.from(store.products.values()).map((product) => ({
        productKey: product.productKey,
        productName: product.productName,
        categoryName: product.categoryName,
        qty: product.qty,
        amount: product.amount,
      }))

      return {
        storeId: store.storeId,
        storeName: store.storeName,
        trend: getStoreSalesTrend(monthlyWithMargin),
        totalQty: store.totalQty,
        totalAmount: store.totalAmount,
        commissionRate: store.commissionRate,
        monthlyRentFee: store.monthlyRentFee,
        includeMonthlyRentInMargin: store.includeMonthlyRentInMargin,
        totalCommission: monthlyWithMargin.reduce((sum, month) => sum + month.commission, 0),
        totalCost: monthlyWithMargin.reduce((sum, month) => sum + month.cost, 0),
        totalRentFee: monthlyWithMargin.reduce((sum, month) => sum + month.rentFee, 0),
        totalNetMargin: monthlyWithMargin.reduce((sum, month) => sum + month.netMargin, 0),
        monthly: monthlyWithMargin,
        productsByQty: [...products].sort((a, b) => b.qty - a.qty || b.amount - a.amount),
        productsByAmount: [...products].sort((a, b) => b.amount - a.amount || b.qty - a.qty),
      }
    })
    .filter((store) => store.totalAmount > 0 || store.totalQty > 0)
    .sort((a, b) => {
      const currentAmountA = a.monthly[a.monthly.length - 1]?.amount ?? 0
      const currentAmountB = b.monthly[b.monthly.length - 1]?.amount ?? 0
      if (currentAmountA !== currentAmountB) return currentAmountB - currentAmountA
      return b.totalAmount - a.totalAmount || a.storeName.localeCompare(b.storeName, "ko")
    })

  return {
    months,
    totalAmount: totals.amount,
    totalQty: totals.qty,
    soldProductCount: soldProducts.size,
    activeStoreCount: activeStores.size,
    topProducts: productSummaries.slice(0, 5),
    growthProducts,
    declineProducts,
    storeProducts,
    storeSalesTrends,
    trendProducts: productSummaries.slice(0, 5),
  }
}
