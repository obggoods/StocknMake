// src/features/stores/components/StoresManager.tsx
import { useCallback, useMemo, useState } from "react"
import type { Product } from "@/data/models"
import { StoreDetailDialog } from "@/features/stores/components/StoreDetailDialog"
import { useAppData } from "@/features/core/useAppData"
import { toast } from "@/lib/toast"

import { AppBadge } from "@/components/app/AppBadge"
import { AppButton } from "@/components/app/AppButton"
import { AppCard } from "@/components/app/AppCard"
import { AppInput } from "@/components/app/AppInput"
import { AppSelect } from "@/components/app/AppSelect"
import { AppSwitch } from "@/components/app/AppSwitch"

import { EmptyState } from "@/components/shared/EmptyState"
import { Skeleton } from "@/components/shared/Skeleton"
import { ErrorState } from "@/components/shared/ErrorState"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Trash2 } from "lucide-react"

function statusLabel(v?: any) {
  return v === "inactive" ? "퇴점" : "입점중"
}
function channelLabel(v?: any) {
  return v === "online" ? "온라인" : "오프라인"
}

export default function StoresManager() {
  const a = useAppData()

  const stores = useMemo(() => {
    return [...a.data.stores].sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0))
  }, [a.data.stores])

  const products = useMemo(() => {
    return [...a.data.products].sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0))
  }, [a.data.products])

  const [manageStoreId, setManageStoreId] = useState<string>("")
  const [openStoreCats, setOpenStoreCats] = useState<Record<string, boolean>>({})

  const [deleteStoreId, setDeleteStoreId] = useState<string>("")
  const [deleteStoreName, setDeleteStoreName] = useState<string>("")

  const [bulkToggle, setBulkToggle] = useState<{ storeId: string; next: boolean } | null>(null)

  // ✅ 모달(입점처 추가)
  const [addOpen, setAddOpen] = useState(false)

  // ✅ 상세 모달
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailStoreId, setDetailStoreId] = useState<string>("")
  const detailStore = useMemo(
    () => stores.find((x) => x.id === detailStoreId) ?? null,
    [stores, detailStoreId]
  )

  // ✅ 목록 필터
  const [q, setQ] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [channelFilter, setChannelFilter] = useState<"all" | "online" | "offline">("all")
  const [tagFilter, setTagFilter] = useState("")

  const filteredStores = useMemo(() => {
    const qq = q.trim().toLowerCase()
    const tf = tagFilter.trim().toLowerCase()

    return stores.filter((s) => {
      if (qq) {
        const hay = `${s.name ?? ""} ${(s.address ?? "")}`.toLowerCase()
        if (!hay.includes(qq)) return false
      }

      if (statusFilter !== "all") {
        const st = (s as any).status ?? "active"
        if (st !== statusFilter) return false
      }

      if (channelFilter !== "all") {
        const ch = (s as any).channel ?? "offline"
        if (ch !== channelFilter) return false
      }

      if (tf) {
        const tags = ((s as any).tags ?? []) as string[]
        const hit = tags.some((t) => String(t ?? "").toLowerCase().includes(tf))
        if (!hit) return false
      }

      return true
    })
  }, [stores, q, statusFilter, channelFilter, tagFilter])

  const isEnabledInStore = useCallback(
    (storeId: string, productId: string) => {
      const hit = a.data.storeProductStates.find((x) => x.storeId === storeId && x.productId === productId)
      return hit ? hit.enabled : true
    },
    [a.data.storeProductStates]
  )

  const onSaveStoreDetail = useCallback(
    async (storeId: string, input: any) => {
      await a.saveStoreFields(storeId, input)
    },
    [a]
  )

  const onConfirmAddStore = useCallback(async () => {
    if (!a.newStoreName.trim()) {
      toast.error("입점처명을 입력해 주세요.")
      return
    }
    await a.addStore()
    setAddOpen(false)
  }, [a])

  if (a.errorMsg) return <ErrorState message={a.errorMsg} onRetry={a.refresh} />

  return (
    <div className="space-y-6">
      {/* ✅ 상단: 입점처 추가 버튼(모달 오픈) */}
      <div className="flex items-center justify-end">
        <AppButton onClick={() => setAddOpen(true)}>입점처 추가</AppButton>
      </div>

      {/* ✅ 상세 모달 */}
      <StoreDetailDialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open)
          if (!open) setDetailStoreId("")
        }}
        store={detailStore}
        busy={a.loading}
        onSave={onSaveStoreDetail}
        onRequestDelete={(id, name) => {
          setDeleteStoreId(id)
          setDeleteStoreName(name)
        }}
      />

      {/* ✅ 입점처 추가: StoreDetailDialog 재사용(create 모드) */}
<StoreDetailDialog
  mode="create"
  open={addOpen}
  onOpenChange={setAddOpen}
  store={null}
  busy={a.loading}
  onCreate={a.createStoreWithFields}
/>

      {/* 기존: 입점처별 취급 제품 ON/OFF */}
      <AppCard
        title="입점처별 취급 제품 설정"
        description="입점처마다 입고하는 제품이 다르면 여기서 ON/OFF로 관리해요. (OFF면 대시보드에서 숨김 + 제작 계산 제외)"
        className="mb-4"
        contentClassName="space-y-3"
      >
        {stores.length === 0 ? (
          <p className="text-sm text-muted-foreground">입점처가 없어요. 먼저 입점처를 추가해주세요.</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">제품이 없어요. 먼저 제품을 추가해주세요.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <AppSelect
              value={manageStoreId}
              onValueChange={(v) => setManageStoreId(v)}
              placeholder="(입점처 선택)"
              options={stores.map((s) => ({ value: s.id, label: s.name }))}
              className="min-w-[220px]"
            />

            {!manageStoreId ? (
              <span className="text-sm text-muted-foreground">입점처를 선택하면 제품 ON/OFF 목록이 보여요.</span>
            ) : (
              <span className="text-sm font-semibold">선택됨: {stores.find((s) => s.id === manageStoreId)?.name}</span>
            )}
          </div>
        )}

        {!!manageStoreId && (
          <div className="mt-2 border-t border-border pt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <AppButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBulkToggle({ storeId: manageStoreId, next: true })}
                disabled={a.loading}
              >
                전체 ON
              </AppButton>
              <AppButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBulkToggle({ storeId: manageStoreId, next: false })}
                disabled={a.loading}
              >
                전체 OFF
              </AppButton>
            </div>

            {(() => {
              const activeProducts = products.filter((p) => p.active)
              const groups = new Map<string, Product[]>()
              for (const p of activeProducts) {
                const cat = (p.category ?? "미분류").trim() || "미분류"
                const arr = groups.get(cat) ?? []
                arr.push(p)
                groups.set(cat, arr)
              }
              const cats = Array.from(groups.keys()).sort((x, y) => x.localeCompare(y, "ko"))

              return (
                <div className="space-y-3">
                  {cats.map((cat) => {
                    const list = groups.get(cat) ?? []
                    const sorted = [...list].sort((x, y) => x.name.localeCompare(y.name, "ko"))
                    const isOpen = openStoreCats[cat] ?? true
                    const onCount = sorted.reduce(
                      (acc, p) => (isEnabledInStore(manageStoreId, p.id) ? acc + 1 : acc),
                      0
                    )

                    return (
                      <div key={cat} className="rounded-xl border border-border bg-background overflow-hidden">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenStoreCats((prev) => ({
                              ...prev,
                              [cat]: !(prev[cat] ?? true),
                            }))
                          }
                          className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left bg-muted/30 hover:bg-muted/50"
                        >
                          <span className="text-sm font-semibold">
                            {cat}{" "}
                            <span className="text-xs text-muted-foreground font-medium">
                              ({onCount}/{sorted.length} ON)
                            </span>
                          </span>
                          <span className="text-muted-foreground font-semibold">{isOpen ? "▾" : "▸"}</span>
                        </button>

                        {isOpen && (
                          <ul className="list-none m-0 p-0">
                            {sorted.map((p) => {
                              const enabled = isEnabledInStore(manageStoreId, p.id)
                              return (
                                <li
                                  key={p.id}
                                  className={`flex items-center justify-between gap-3 px-3 py-2 border-t border-border ${
                                    enabled ? "" : "opacity-50"
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold truncate">{p.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {enabled ? "ON (취급)" : "OFF (미취급)"}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <AppSwitch
                                      checked={enabled}
                                      onCheckedChange={(v) => a.toggleOne(manageStoreId, p.id, Boolean(v))}
                                      disabled={a.loading}
                                    />
                                    <span className="text-xs text-muted-foreground">{enabled ? "취급" : "미취급"}</span>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}
      </AppCard>

      {/* ✅ 입점처 목록 + 필터 */}
      <AppCard density="compact" title="입점처 목록" className="min-w-0" contentClassName="space-y-3">
        {/* 필터 바 */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <AppInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색: 입점처명/주소"
            className="md:max-w-[260px]"
          />
          <AppSelect
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as any)}
            placeholder="상태"
            options={[
              { value: "all", label: "상태: 전체" },
              { value: "active", label: "상태: 입점중" },
              { value: "inactive", label: "상태: 퇴점" },
            ]}
            className="md:max-w-[200px]"
          />
          <AppSelect
            value={channelFilter}
            onValueChange={(v) => setChannelFilter(v as any)}
            placeholder="채널"
            options={[
              { value: "all", label: "채널: 전체" },
              { value: "offline", label: "채널: 오프라인" },
              { value: "online", label: "채널: 온라인" },
            ]}
            className="md:max-w-[220px]"
          />
          <AppInput
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            placeholder="태그 필터 (부분 검색)"
            className="md:max-w-[240px]"
          />

          <div className="md:ml-auto flex items-center gap-2">
            <AppBadge variant="muted">표시 {filteredStores.length}개</AppBadge>
            <AppButton
              type="button"
              variant="secondary"
              onClick={() => {
                setQ("")
                setStatusFilter("all")
                setChannelFilter("all")
                setTagFilter("")
              }}
            >
              필터 초기화
            </AppButton>
          </div>
        </div>

        {a.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filteredStores.length === 0 ? (
          <EmptyState title="결과가 없습니다" description="검색/필터 조건을 바꿔보세요." />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[240px]">입점처</TableHead>
                  <TableHead className="w-[110px]">상태</TableHead>
                  <TableHead className="w-[120px]">온/오프라인</TableHead>
                  <TableHead className="w-[110px] text-right">수수료</TableHead>
                  <TableHead className="min-w-[240px]">태그</TableHead>
                  <TableHead className="w-[160px] text-right">상세</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredStores.map((s) => {
                  const enabledCount =
                    a.data.storeProductStates.filter((sp) => sp.storeId === s.id && sp.enabled).length
                  const tags = ((s as any).tags ?? []) as string[]
                  const showTags = tags.slice(0, 2)
                  const more = tags.length - showTags.length

                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="text-sm font-medium truncate">{s.name}</div>
                          <AppBadge variant="muted" className="shrink-0">
                            {enabledCount}/{a.data.products.length}
                          </AppBadge>
                        </div>
                        {s.address ? (
                          <div className="mt-1 text-xs text-muted-foreground truncate">{s.address}</div>
                        ) : null}
                      </TableCell>

                      <TableCell>
                        <AppBadge variant="muted">{statusLabel((s as any).status)}</AppBadge>
                      </TableCell>

                      <TableCell>
                        <AppBadge variant="muted">{channelLabel((s as any).channel)}</AppBadge>
                      </TableCell>

                      <TableCell className="text-right tabular-nums">
                        {s.commissionRate == null ? "-" : `${s.commissionRate}%`}
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {showTags.map((t) => (
                            <AppBadge key={t} variant="secondary">
                              {t}
                            </AppBadge>
                          ))}
                          {more > 0 && <AppBadge variant="muted">+{more}</AppBadge>}
                          {tags.length === 0 && <span className="text-xs text-muted-foreground">-</span>}
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <AppButton
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setDetailStoreId(s.id)
                              setDetailOpen(true)
                            }}
                          >
                            상세
                          </AppButton>

                          <AppButton
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setDeleteStoreId(s.id)
                              setDeleteStoreName(s.name)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </AppButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </AppCard>

      {/* 삭제 confirm */}
      <ConfirmDialog
        open={Boolean(deleteStoreId)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteStoreId("")
            setDeleteStoreName("")
          }
        }}
        title="입점처를 삭제할까요?"
        description={
          deleteStoreName
            ? `“${deleteStoreName}” 입점처가 삭제됩니다. 되돌릴 수 없습니다.`
            : "입점처가 삭제됩니다. 되돌릴 수 없습니다."
        }
        confirmText="삭제"
        cancelText="취소"
        destructive
        busy={a.loading}
        onConfirm={async () => {
          const id = deleteStoreId
          if (!id) return
          try {
            await a.deleteStore(id)

            // ✅ 삭제된 입점처가 선택돼 있었으면 해제
            if (manageStoreId === id) setManageStoreId("")

            // ✅ 상세 모달이 그 store를 보고 있었으면 닫기
            if (detailStoreId === id) {
              setDetailOpen(false)
              setDetailStoreId("")
            }
          } catch {
            toast.error("삭제에 실패했어요.")
          } finally {
            setDeleteStoreId("")
            setDeleteStoreName("")
          }
        }}
      />

      {/* 일괄 ON/OFF confirm */}
      <ConfirmDialog
        open={Boolean(bulkToggle)}
        onOpenChange={(open) => {
          if (!open) setBulkToggle(null)
        }}
        title={bulkToggle?.next ? "전체 ON을 적용할까요?" : "전체 OFF를 적용할까요?"}
        description={
          bulkToggle?.next
            ? "선택한 입점처의 모든 제품을 ON(취급)으로 설정합니다."
            : "선택한 입점처의 모든 제품을 OFF(미취급)으로 설정합니다."
        }
        confirmText={bulkToggle?.next ? "전체 ON" : "전체 OFF"}
        cancelText="취소"
        destructive={!bulkToggle?.next}
        busy={a.loading}
        onConfirm={async () => {
          if (!bulkToggle) return
          try {
            await a.toggleAll(bulkToggle.storeId, bulkToggle.next)
            toast.success(bulkToggle.next ? "전체 ON을 적용했어요." : "전체 OFF를 적용했어요.")
          } catch {
            toast.error("일괄 변경에 실패했어요.")
          } finally {
            setBulkToggle(null)
          }
        }}
      />
    </div>
  )
}