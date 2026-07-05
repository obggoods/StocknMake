export type AnalysisRange = "3m" | "6m" | "year"

export type AnalysisLine = {
  settlementId: string
  storeId: string
  month: string
  productId: string | null
  productNameRaw: string
  productNameMatched: string | null
  qty: number
  amount: number
}

export type ProductSalesSummary = {
  productId: string
  productName: string
  categoryName: string | null
  totalQty: number
  totalAmount: number
  monthly: {
    month: string
    qty: number
    amount: number
  }[]
  stores: {
    storeId: string
    storeName: string
    qty: number
    amount: number
  }[]
}

export type StoreProductSummary = {
  storeId: string
  storeName: string
  products: {
    productId: string
    productName: string
    categoryName: string | null
    qty: number
    amount: number
  }[]
}

export type StoreSalesTrend = "growth" | "decline" | "steady"

export type StoreSalesTrendSummary = {
  storeId: string
  storeName: string
  trend: StoreSalesTrend
  totalQty: number
  totalAmount: number
  commissionRate: number
  monthlyRentFee: number
  includeMonthlyRentInMargin: boolean
  totalCommission: number
  totalCost: number
  totalRentFee: number
  totalNetMargin: number
  monthly: {
    month: string
    qty: number
    amount: number
    commission: number
    cost: number
    rentFee: number
    netMargin: number
  }[]
  productsByQty: {
    productKey: string
    productName: string
    categoryName: string | null
    qty: number
    amount: number
  }[]
  productsByAmount: {
    productKey: string
    productName: string
    categoryName: string | null
    qty: number
    amount: number
  }[]
}

export type ProductChangeSummary = {
  productId: string
  productName: string
  categoryName: string | null
  previousQty: number
  currentQty: number
  previousAmount: number
  currentAmount: number
  qtyChangeRate: number | null
  amountChangeRate: number | null
  stores: {
    storeId: string
    storeName: string
    qty: number
    amount: number
  }[]
}

export type SalesAnalysis = {
  months: string[]
  totalAmount: number
  totalQty: number
  soldProductCount: number
  activeStoreCount: number
  topProducts: ProductSalesSummary[]
  growthProducts: ProductChangeSummary[]
  declineProducts: ProductChangeSummary[]
  storeProducts: StoreProductSummary[]
  storeSalesTrends: StoreSalesTrendSummary[]
  trendProducts: ProductSalesSummary[]
}
