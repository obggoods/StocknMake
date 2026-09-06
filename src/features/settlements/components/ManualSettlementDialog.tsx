import { useEffect, useMemo, useState } from "react"
import { Check, ChevronsUpDown, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { AppButton } from "@/components/app/AppButton"
import { AppInput } from "@/components/app/AppInput"
import { createManualSettlementDB, getMarketplaceCommissionRateDB } from "@/data/store.supabase"
import { formatCommissionPercent } from "@/lib/commissionRate"
import { toast } from "@/lib/toast"

type Product = { id: string; name: string; category?: string | null; price?: number | null; sku?: string | null; barcode?: string | null; active?: boolean }
type Store = { id: string; name: string; status?: string | null; commissionRate?: number | null; commission_rate?: number | null }
type Inventory = { storeId: string; productId: string }

function previousMonth() {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() - 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function monthOptions() {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() - 25)
  return Array.from({ length: 25 }, () => {
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    const option = { value, label: `${date.getFullYear()}년 ${date.getMonth() + 1}월` }
    date.setMonth(date.getMonth() + 1)
    return option
  })
}

function parseQuantity(value: string) {
  if (value.trim() === "") return 0
  const number = Number(value)
  return Number.isInteger(number) && Number.isFinite(number) && number >= 0 ? number : null
}

export function ManualSettlementDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; stores: Store[]; products: Product[]; inventory: Inventory[]; onSaved: () => Promise<void> }) {
  const [storeId, setStoreId] = useState("")
  const [month, setMonth] = useState(previousMonth)
  const [category, setCategory] = useState("")
  const [selectedProductId, setSelectedProductId] = useState("")
  const [addQuantity, setAddQuantity] = useState("1")
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [storePickerOpen, setStorePickerOpen] = useState(false)
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [commissionRate, setCommissionRate] = useState<number | null>(null)

  useEffect(() => {
    if (props.open) return
    setStoreId(""); setMonth(previousMonth()); setCategory(""); setSelectedProductId(""); setAddQuantity("1")
    setQuantities({}); setCategoryPickerOpen(false); setStorePickerOpen(false); setProductPickerOpen(false); setConfirming(false); setCommissionRate(null)
  }, [props.open])

  const eligibleProducts = useMemo(() => {
    const stocked = new Set(props.inventory.filter((item) => item.storeId === storeId).map((item) => item.productId))
    return stocked.size ? props.products.filter((product) => stocked.has(product.id)) : props.products.filter((product) => product.active !== false)
  }, [props.inventory, props.products, storeId])
  const categories = useMemo(() => Array.from(new Set(eligibleProducts.map((product) => product.category?.trim() || "미분류"))).sort((a, b) => a.localeCompare(b, "ko")), [eligibleProducts])
  const selectableProducts = useMemo(() => eligibleProducts.filter((product) => !category || (product.category?.trim() || "미분류") === category), [category, eligibleProducts])
  const months = useMemo(monthOptions, [])
  const monthIndex = Math.max(0, months.findIndex((option) => option.value === month))
  const moveMonth = (offset: number) => {
    const nextIndex = monthIndex + offset
    if (nextIndex >= 0 && nextIndex < months.length) setMonth(months[nextIndex].value)
  }
  const selectedProduct = eligibleProducts.find((product) => product.id === selectedProductId)
  const items = useMemo(() => eligibleProducts.flatMap((product) => { const sold = parseQuantity(quantities[product.id] ?? ""); return sold && sold > 0 ? [{ product, quantity: sold, gross: sold * Number(product.price ?? 0) }] : [] }), [eligibleProducts, quantities])
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)
  const grossAmount = items.reduce((sum, item) => sum + item.gross, 0)
  const selectedStore = props.stores.find((store) => store.id === storeId)
  useEffect(() => {
    if (!props.open || !storeId) { setCommissionRate(null); return }
    let cancelled = false
    void getMarketplaceCommissionRateDB({ marketplaceId: storeId }).then((configuredRate) => {
      if (cancelled) return
      if (configuredRate > 0) setCommissionRate(configuredRate)
      else {
        const storeRate = selectedStore?.commissionRate ?? selectedStore?.commission_rate
        setCommissionRate(storeRate == null ? null : Number(formatCommissionPercent(storeRate)) / 100)
      }
    }).catch(() => {
      if (!cancelled) {
        const storeRate = selectedStore?.commissionRate ?? selectedStore?.commission_rate
        setCommissionRate(storeRate == null ? null : Number(formatCommissionPercent(storeRate)) / 100)
      }
    })
    return () => { cancelled = true }
  }, [props.open, selectedStore, storeId])
  const commissionAmount = commissionRate == null ? null : Math.round(grossAmount * commissionRate)
  const expectedSettlement = commissionAmount == null ? null : grossAmount - commissionAmount

  const addProduct = () => {
    const qty = parseQuantity(addQuantity)
    if (!selectedProduct) return toast.error("제품을 선택해주세요.")
    if (!qty || qty < 1) return toast.error("판매 수량은 1개 이상 입력해주세요.")
    if (quantities[selectedProduct.id] !== undefined) return toast.error("이미 추가된 제품입니다.")
    setQuantities((previous) => ({ ...previous, [selectedProduct.id]: String(qty) }))
    setSelectedProductId(""); setAddQuantity("1"); setProductPickerOpen(false)
  }
  const next = () => {
    if (!storeId || !month) return toast.error("입점처와 정산 월을 선택해주세요.")
    if (!items.length) return toast.error("판매 제품을 하나 이상 추가해주세요.")
    setConfirming(true)
  }
  const save = async () => {
    if (saving) return
    try {
      setSaving(true)
      await createManualSettlementDB({ marketplaceId: storeId, periodMonth: month, items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })) })
      await props.onSaved(); toast.success("정산이 등록되었습니다."); props.onOpenChange(false)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ""
      toast.error(message === "DUPLICATE_SETTLEMENT" ? `${month} ${selectedStore?.name ?? "입점처"} 정산이 이미 존재합니다.` : "정산을 등록하지 못했습니다. 잠시 후 다시 시도해주세요.")
    } finally { setSaving(false) }
  }

  return <Dialog open={props.open} onOpenChange={(open) => !saving && props.onOpenChange(open)}>
    <DialogContent className="flex h-[min(820px,calc(100dvh-1rem))] w-[calc(100%-1rem)] max-w-4xl flex-col gap-3 overflow-hidden sm:w-[calc(100%-2rem)] sm:max-w-[820px]">
      <DialogHeader className="shrink-0"><DialogTitle>{confirming ? "정산 내용 확인" : "직접 정산 등록"}</DialogTitle></DialogHeader>
      {confirming ? <div className="min-h-0 flex-1 space-y-4 overflow-y-auto text-sm"><div className="rounded-lg border p-4"><div>{month} · {selectedStore?.name}</div><div className="mt-2 font-semibold">판매 제품 {items.length}종 · 총 판매수량 {totalQuantity}개</div><div className="mt-3 grid gap-1 sm:max-w-sm"><div className="flex justify-between gap-4"><span>총매출</span><span className="font-semibold tabular-nums">{grossAmount.toLocaleString()}원</span></div>{commissionRate == null ? <div className="text-muted-foreground">{storeId ? "수수료율 미설정" : "입점처 선택 후 수수료를 계산합니다."}</div> : <><div className="flex justify-between gap-4 text-muted-foreground"><span>판매 수수료 {formatCommissionPercent(commissionRate * 100)}%</span><span className="tabular-nums">{commissionAmount?.toLocaleString()}원</span></div><div className="flex justify-between gap-4 border-t border-border/60 pt-1 font-semibold text-primary"><span>정산 예정액</span><span className="tabular-nums">{expectedSettlement?.toLocaleString()}원</span></div></>}</div></div><div className="space-y-2">{items.map((item) => <div key={item.product.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{item.product.name} · {item.quantity}개</span><span className="shrink-0 tabular-nums">{item.gross.toLocaleString()}원</span></div>)}</div></div> : <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="shrink-0 grid items-start gap-3 sm:grid-cols-2">
          <div className="space-y-1 text-sm"><span>입점처</span><Popover open={storePickerOpen} onOpenChange={setStorePickerOpen}><PopoverTrigger asChild><AppButton type="button" variant="outline" className="h-8 w-full min-w-0 justify-between px-3 text-left font-normal"><span className="truncate">{selectedStore?.name ?? "입점처 선택"}</span><ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" /></AppButton></PopoverTrigger><PopoverContent className="w-[min(420px,calc(100vw-3rem))] p-0" align="start"><Command><CommandInput placeholder="입점처 검색..." /><CommandList className="max-h-60"><CommandEmpty>입점처가 없습니다.</CommandEmpty><CommandGroup>{props.stores.filter((store) => store.status !== "inactive").map((store) => <CommandItem key={store.id} value={store.name} onSelect={() => { setStoreId(store.id); setStorePickerOpen(false) }}><Check className={`mr-2 h-4 w-4 ${store.id === storeId ? "opacity-100" : "opacity-0"}`} /><span className="min-w-0 truncate">{store.name}</span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover></div>
          <div className="space-y-1 text-sm"><span>정산 대상 월</span><div className="flex h-8 w-full items-center overflow-hidden rounded-md border border-input bg-background"><AppButton type="button" variant="ghost" size="icon" className="h-full w-9 shrink-0 rounded-none border-0" aria-label="이전 달" onClick={() => moveMonth(-1)} disabled={monthIndex <= 0}>‹</AppButton><div className="min-w-0 flex-1 truncate border-x border-input/70 bg-primary/10 px-3 text-center text-sm font-medium leading-8 text-primary">{months[monthIndex]?.label}</div><AppButton type="button" variant="ghost" size="icon" className="h-full w-9 shrink-0 rounded-none border-0" aria-label="다음 달" onClick={() => moveMonth(1)} disabled={monthIndex >= months.length - 1}>›</AppButton></div></div>
        </div>
        <div className="shrink-0 space-y-3 rounded-xl border p-3 sm:p-4"><div className="text-sm font-medium">판매 제품 추가</div><div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <label className="min-w-0 space-y-1 text-sm">카테고리<Popover open={categoryPickerOpen} onOpenChange={setCategoryPickerOpen}><PopoverTrigger asChild><AppButton type="button" variant="outline" className="h-8 w-full min-w-0 justify-between px-3 text-left font-normal"><span className="truncate">{category || "전체 카테고리"}</span><ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" /></AppButton></PopoverTrigger><PopoverContent className="w-[min(320px,calc(100vw-3rem))] p-0" align="start"><Command><CommandInput placeholder="카테고리 검색..." /><CommandList className="max-h-60"><CommandEmpty>카테고리가 없습니다.</CommandEmpty><CommandGroup><CommandItem value="전체 카테고리" onSelect={() => { setCategory(""); setSelectedProductId(""); setCategoryPickerOpen(false) }}><Check className={`mr-2 h-4 w-4 ${!category ? "opacity-100" : "opacity-0"}`} />전체 카테고리</CommandItem>{categories.map((value) => <CommandItem key={value} value={value} onSelect={() => { setCategory(value); setSelectedProductId(""); setCategoryPickerOpen(false) }}><Check className={`mr-2 h-4 w-4 ${category === value ? "opacity-100" : "opacity-0"}`} /><span className="truncate">{value}</span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover></label>
          <label className="min-w-0 space-y-1 text-sm">제품<Popover open={productPickerOpen} onOpenChange={setProductPickerOpen}><PopoverTrigger asChild><AppButton type="button" variant="outline" className="h-8 w-full min-w-0 justify-between px-3 text-left font-normal" disabled={!storeId}><span className="min-w-0 truncate">{selectedProduct?.name ?? (storeId ? "제품명 검색 또는 선택" : "입점처 먼저 선택")}</span><ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" /></AppButton></PopoverTrigger><PopoverContent className="w-[min(420px,calc(100vw-3rem))] p-0" align="start"><Command><CommandInput placeholder="제품명, SKU, 바코드 검색..." /><CommandList><CommandEmpty>제품이 없습니다.</CommandEmpty><CommandGroup>{selectableProducts.map((product) => { const added = quantities[product.id] !== undefined; return <CommandItem key={product.id} value={`${product.name} ${product.sku ?? ""} ${product.barcode ?? ""}`} disabled={added} onSelect={() => { if (!added) { setSelectedProductId(product.id); setProductPickerOpen(false) } }}><Check className={`mr-2 h-4 w-4 ${selectedProductId === product.id ? "opacity-100" : "opacity-0"}`} /><span className="min-w-0 flex-1 truncate">{product.name}</span>{added ? <span className="text-xs text-muted-foreground">이미 추가됨</span> : null}</CommandItem> })}</CommandGroup></CommandList></Command></PopoverContent></Popover></label>
          <label className="min-w-0 space-y-1 text-sm">판매 수량<AppInput className="h-8" type="number" min="1" step="1" inputMode="numeric" value={addQuantity} onChange={(event) => setAddQuantity(event.target.value)} /></label><AppButton type="button" className="h-8 w-full self-end whitespace-nowrap" onClick={addProduct} disabled={!selectedProduct}>제품 추가</AppButton>
        </div></div>
        <div className={items.length > 3 ? "flex min-h-0 flex-1 flex-col space-y-2" : "shrink-0 space-y-2"}><div className="shrink-0 text-sm font-medium">판매 제품 {items.length}종</div><div className={items.length > 3 ? "min-h-0 flex-1 max-h-[min(340px,32vh)] overflow-y-auto overflow-x-hidden pr-1" : "shrink-0"}>{items.length === 0 ? <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">아직 추가된 판매 제품이 없습니다.<br />위에서 제품과 수량을 선택해 추가해주세요.</div> : items.map((item) => <div key={item.product.id} className="mb-2 grid gap-2 rounded-lg border p-3 last:mb-0 sm:grid-cols-[1fr_110px_120px_auto] sm:items-center"><div className="min-w-0"><div className="truncate font-medium">{item.product.name}</div><div className="text-sm text-muted-foreground">{Number(item.product.price ?? 0).toLocaleString()}원 × {item.quantity}</div></div><AppInput type="number" min="1" step="1" inputMode="numeric" value={quantities[item.product.id] ?? ""} onChange={(event) => setQuantities((previous) => ({ ...previous, [item.product.id]: event.target.value }))} /><div className="text-right text-sm tabular-nums">{item.gross.toLocaleString()}원</div><AppButton type="button" variant="ghost" size="icon" aria-label={`${item.product.name} 삭제`} onClick={() => setQuantities((previous) => { const next = { ...previous }; delete next[item.product.id]; return next })}><Trash2 className="h-4 w-4" /></AppButton></div>)}</div></div>
        <div className="shrink-0 flex flex-col gap-2 rounded-lg bg-muted p-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span>판매 제품 {items.length}종 · 총 판매수량 {totalQuantity}개</span><div className="grid gap-1 sm:min-w-[230px]"><div className="flex justify-between gap-4"><span>총매출</span><span className="font-semibold tabular-nums">{grossAmount.toLocaleString()}원</span></div>{commissionRate == null ? <div className="text-muted-foreground">{storeId ? "수수료율 미설정" : "입점처 선택 후 수수료를 계산합니다."}</div> : <><div className="flex justify-between gap-4 text-muted-foreground"><span>판매 수수료 {formatCommissionPercent(commissionRate * 100)}%</span><span className="tabular-nums">{commissionAmount?.toLocaleString()}원</span></div><div className="flex justify-between gap-4 border-t border-border/60 pt-1 font-semibold text-primary"><span>정산 예정액</span><span className="tabular-nums">{expectedSettlement?.toLocaleString()}원</span></div></>}</div></div>
      </div>}
      <DialogFooter className="shrink-0">{confirming ? <><AppButton variant="outline" onClick={() => setConfirming(false)} disabled={saving}>이전</AppButton><AppButton onClick={save} disabled={saving}>{saving ? "정산 등록 중..." : "정산 등록"}</AppButton></> : <AppButton onClick={next} disabled={!items.length}>내용 확인</AppButton>}</DialogFooter>
    </DialogContent>
  </Dialog>
}
