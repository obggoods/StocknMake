import { AppCard } from "@/components/app/AppCard"
import { AppInput } from "@/components/app/AppInput"
import { Label } from "@/components/ui/label"

type StoreRow = {
    id: string
    name: string
    commission_rate?: number | null
}

type ProductProfile = {
    id: string
    name: string
    memo?: string
    sellingPrice: number
    salesCommissionRate: number
    vatRate: number
    materials: Array<{
        id: string
        name: string
        unitPrice: number
        quantity: number
    }>
    hourlyRate: number
    productionPerHour: number
    laborInputMode: "perHour" | "perItem"
    minutesPerItem?: number
    outsourcingCost: number
    lossRate: number
    createdAt: number
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

function calcMaterialCost(materials: ProductProfile["materials"]) {
    return materials.reduce((sum, m) => sum + (m.unitPrice || 0) * (m.quantity || 0), 0)
}

function calcLaborCost(p: ProductProfile) {
    if (p.laborInputMode === "perItem") {
        const minutes = clamp(Number(p.minutesPerItem ?? 0), 0)
        const hoursPerItem = minutes / 60
        return p.hourlyRate * hoursPerItem
    }
    const perHour = clamp(p.productionPerHour, 0.0001)
    return p.hourlyRate / perHour
}

function calcCOGS(p: ProductProfile) {
    const materials = calcMaterialCost(p.materials)
    const labor = calcLaborCost(p)
    const base = materials + labor + p.outsourcingCost
    const lossMultiplier = 1 + clamp(p.lossRate, 0, 100) / 100
    return base * lossMultiplier
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
            message: "원가/수수료/VAT가 판매가를 초과합니다.",
        }
    }
    if (marginRate < 10) {
        return {
            level: "danger",
            label: "위험",
            message: "마진이 매우 낮습니다.",
        }
    }
    if (marginRate < 20) {
        return {
            level: "warn",
            label: "보통",
            message: "운영비를 포함하면 타이트할 수 있습니다.",
        }
    }
    if (marginRate < 35) {
        return {
            level: "good",
            label: "양호",
            message: "비교적 안정적인 구간입니다.",
        }
    }
    return {
        level: "good",
        label: "매우 좋음",
        message: "여력이 충분한 편입니다.",
    }
}

function badgeClasses(level: "danger" | "warn" | "good") {
    if (level === "danger") return "bg-destructive/10 text-destructive border-destructive/20"
    if (level === "warn") return "bg-warning/10 text-warning border-warning/20"
    return "bg-success/10 text-success border-success/20"
}

export default function CostSimulationCard(props: {
    profiles: ProductProfile[]
    stores: StoreRow[]
    selectedProfileId: string
    onSelectedProfileIdChange: (value: string) => void
    selectedStoreId: string
    onSelectedStoreIdChange: (value: string) => void
    manualCommissionRate: string
    onManualCommissionRateChange: (value: string) => void
}) {
    const {
        profiles,
        stores,
        selectedProfileId,
        onSelectedProfileIdChange,
        selectedStoreId,
        onSelectedStoreIdChange,
        manualCommissionRate,
        onManualCommissionRateChange,
    } = props

    const selectedProfile =
        profiles.find((p) => String(p.id) === String(selectedProfileId)) ?? null

    const selectedStore =
        stores.find((s) => String(s.id) === String(selectedStoreId)) ?? null

    const appliedCommissionRate =
        manualCommissionRate.trim() !== ""
            ? clamp(toNumber(manualCommissionRate), 0, 100)
            : clamp(Number(selectedStore?.commission_rate ?? selectedProfile?.salesCommissionRate ?? 0), 0, 100)

    const sellingPrice = Number(selectedProfile?.sellingPrice ?? 0)
    const vatRate = Number(selectedProfile?.vatRate ?? 10)
    const cogs = selectedProfile ? calcCOGS(selectedProfile) : 0
    const commission = sellingPrice * (appliedCommissionRate / 100)
    const vat = sellingPrice * (vatRate / 100)
    const profit = sellingPrice - cogs - commission - vat
    const marginRate = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0
    const assessment = assessMargin(marginRate)

    return (
        <AppCard
            title="원가 시뮬레이션"
            description="저장된 원가 프로필을 선택하고 입점처 또는 수수료율 기준으로 예상 마진을 계산합니다."
        >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-1">
                    <div className="space-y-2">
                        <Label>원가 프로필 선택</Label>
                        <select
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                            value={selectedProfileId}
                            onChange={(e) => onSelectedProfileIdChange(e.target.value)}
                        >
                            <option value="">원가 프로필 선택</option>
                            {profiles.map((profile) => (
                                <option key={profile.id} value={profile.id}>
                                    {profile.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <Label>입점처 선택</Label>
                        <select
                            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                            value={selectedStoreId}
                            onChange={(e) => onSelectedStoreIdChange(e.target.value)}
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
                        <Label>직접 수수료율 입력 (%)</Label>
                        <AppInput
                            inputMode="decimal"
                            value={manualCommissionRate}
                            onChange={(e) => onManualCommissionRateChange(e.target.value)}
                            placeholder="비워두면 입점처 수수료율 사용"
                        />
                    </div>

                    <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                        직접 수수료율을 입력하면 입점처 수수료율보다 우선 적용됩니다.
                    </div>
                </div>

                <div className="space-y-4 lg:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="text-sm font-medium">
                                {selectedProfile?.name ?? "원가 프로필을 선택하세요"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                                입점처: {selectedStore?.name ?? "선택 안함"}
                            </div>
                        </div>

                        <span className={`text-xs px-2 py-0.5 rounded border ${badgeClasses(assessment.level)}`}>
                            {assessment.label}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        <div className="rounded-lg border p-3">
                            <div className="text-xs text-muted-foreground">기준 판매가</div>
                            <div className="mt-1 font-medium">{formatCurrency(sellingPrice)}</div>
                        </div>

                        <div className="rounded-lg border p-3">
                            <div className="text-xs text-muted-foreground">총원가(COGS)</div>
                            <div className="mt-1 font-medium">{formatCurrency(cogs)}</div>
                        </div>

                        <div className="rounded-lg border p-3">
                            <div className="text-xs text-muted-foreground">적용 수수료율</div>
                            <div className="mt-1 font-medium">{formatPercent(appliedCommissionRate)}</div>
                        </div>

                        <div className="rounded-lg border p-3">
                            <div className="text-xs text-muted-foreground">예상 수수료</div>
                            <div className="mt-1 font-medium">{formatCurrency(commission)}</div>
                        </div>

                        <div className="rounded-lg border p-3">
                            <div className="text-xs text-muted-foreground">VAT</div>
                            <div className="mt-1 font-medium">{formatCurrency(vat)}</div>
                        </div>

                        <div className="rounded-lg border p-3">
                            <div className="text-xs text-muted-foreground">예상 순마진</div>
                            <div className="mt-1 font-medium">{formatCurrency(profit)}</div>
                        </div>
                    </div>

                    <div className="rounded-lg bg-muted/40 p-4">
                        <div className="text-sm font-medium">예상 마진율</div>
                        <div className="mt-1 text-2xl font-semibold">{formatPercent(marginRate)}</div>
                        <div className="mt-2 text-xs text-muted-foreground">{assessment.message}</div>
                    </div>
                </div>
            </div>
        </AppCard>
    )
}