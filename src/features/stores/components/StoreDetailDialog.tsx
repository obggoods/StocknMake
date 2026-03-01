import { useEffect, useState } from "react"
import type { Store } from "@/data/models"

import { AppButton } from "@/components/app/AppButton"
import { AppInput } from "@/components/app/AppInput"
import { AppSelect } from "@/components/app/AppSelect"
import { AppBadge } from "@/components/app/AppBadge"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Trash2, X } from "lucide-react"

function toNumOrNull(v: string) {
  const t = (v ?? "").trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n))
}

function statusLabel(v?: Store["status"] | null) {
  return v === "inactive" ? "퇴점" : "입점중"
}
function channelLabel(v?: Store["channel"] | null) {
  return v === "online" ? "온라인" : "오프라인"
}

type StoreUpsertInput = {
  name: string
  commissionRate: number | null
  targetQtyOverride: number | null
  contactName: string | null
  phone: string | null
  address: string | null
  memo: string | null
  status: "active" | "inactive"
  channel: "online" | "offline"
  tags: string[]
  storeFee: number | null
  settlementCycle: "monthly" | "weekly" | "biweekly" | "ad-hoc" | null
  settlementDay: number | null
  settlementNote: string | null
}

export function StoreDetailDialog(props: {
  mode?: "edit" | "create"
  open: boolean
  onOpenChange: (open: boolean) => void

  // edit 모드에선 store 필요, create 모드에선 null 가능
  store: Store | null

  busy?: boolean

  // edit
  onSave?: (storeId: string, input: StoreUpsertInput) => Promise<void>

  // create
  onCreate?: (input: StoreUpsertInput) => Promise<void>

  // edit only
  onRequestDelete?: (storeId: string, storeName: string) => void
}) {
  const mode = props.mode ?? "edit"
  const store = props.store
  const isCreate = mode === "create"

  const [isEditing, setIsEditing] = useState(false)

  // draft states
  const [name, setName] = useState("")
  const [commission, setCommission] = useState("")
  const [targetQty, setTargetQty] = useState("")
  const [contactName, setContactName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [memo, setMemo] = useState("")

  const [status, setStatus] = useState<"active" | "inactive">("active")
  const [channel, setChannel] = useState<"online" | "offline">("offline")

  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")

  const [storeFee, setStoreFee] = useState("")
  const [settlementCycle, setSettlementCycle] = useState<
    "monthly" | "weekly" | "biweekly" | "ad-hoc" | ""
  >("")
  const [settlementDay, setSettlementDay] = useState("")
  const [settlementNote, setSettlementNote] = useState("")

  function normalizeTag(v: string) {
    return String(v ?? "").trim().replace(/\s+/g, " ")
  }

  function addTag(raw: string) {
    const t = normalizeTag(raw)
    if (!t) return
    setTags((prev) => {
      const lower = t.toLowerCase()
      const exists = prev.some((x) => x.toLowerCase() === lower)
      if (exists) return prev
      if (prev.length >= 20) return prev
      return [...prev, t]
    })
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  function resetForCreate() {
    setIsEditing(true)

    setName("")
    setCommission("")
    setTargetQty("")
    setContactName("")
    setPhone("")
    setAddress("")
    setMemo("")

    setStatus("active")
    setChannel("offline")

    setTags([])
    setTagInput("")

    setStoreFee("")
    setSettlementCycle("")
    setSettlementDay("")
    setSettlementNote("")
  }

  function resetFromStore(s: Store) {
    setIsEditing(false)

    setName(s.name ?? "")
    setCommission(s.commissionRate == null ? "" : String(s.commissionRate))
    setTargetQty(s.targetQtyOverride == null ? "" : String(s.targetQtyOverride))
    setContactName(s.contactName ?? "")
    setPhone(s.phone ?? "")
    setAddress(s.address ?? "")
    setMemo(s.memo ?? "")

    setStatus((s.status as any) ?? "active")
    setChannel((s.channel as any) ?? "offline")

    setTags(((s.tags ?? []) as any[]).map((t) => String(t ?? "").trim()).filter(Boolean))
    setTagInput("")

    setStoreFee(s.storeFee == null ? "" : String(s.storeFee))
    setSettlementCycle((s.settlementCycle as any) ?? "")
    setSettlementDay(s.settlementDay == null ? "" : String(s.settlementDay))
    setSettlementNote(s.settlementNote ?? "")
  }

  // init on open/change
  useEffect(() => {
    if (!props.open) return

    if (isCreate) {
      resetForCreate()
      return
    }

    if (store) resetFromStore(store)
  }, [props.open, store, isCreate])

  const close = () => props.onOpenChange(false)

  const onClickCancelEdit = () => {
    if (isCreate) {
      close()
      return
    }
    if (!store) return
    resetFromStore(store)
  }

  const buildInput = (): StoreUpsertInput => {
    const commissionRate = toNumOrNull(commission)
    const targetQtyOverride = toNumOrNull(targetQty)
    const storeFeeNum = toNumOrNull(storeFee)

    const sd = toNumOrNull(settlementDay)
    const safeSettlementDay = sd == null ? null : sd >= 1 && sd <= 31 ? sd : null

    return {
      name: name.trim(),
      commissionRate,
      targetQtyOverride,
      contactName: contactName.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      memo: memo.trim() || null,

      status,
      channel,
      tags,

      storeFee: storeFeeNum,
      settlementCycle: settlementCycle === "" ? null : settlementCycle,
      settlementDay: safeSettlementDay,
      settlementNote: settlementNote.trim() || null,
    }
  }

  const onClickPrimary = async () => {
    const input = buildInput()

    if (!input.name) return // 입점처명 필수

    if (isCreate) {
      if (!props.onCreate) return
      await props.onCreate(input)
      close()
      return
    }

    if (!store || !props.onSave) return
    await props.onSave(store.id, input)
    setIsEditing(false)
  }

  const title = isCreate ? "입점처 추가" : store?.name ?? "입점처 상세"

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[820px]">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate">{title}</DialogTitle>

              {!isCreate && store && !isEditing && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <AppBadge variant="muted">{statusLabel(store.status)}</AppBadge>
                  <AppBadge variant="muted">{channelLabel(store.channel)}</AppBadge>

                  {(store.tags ?? []).slice(0, 4).map((t) => (
                    <AppBadge key={t} variant="secondary">
                      {t}
                    </AppBadge>
                  ))}

                  {(store.tags ?? []).length > 4 && (
                    <AppBadge variant="muted">+{(store.tags ?? []).length - 4}</AppBadge>
                  )}
                </div>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* create는 항상 편집 UI */}
        {!store && !isCreate ? (
          <div className="py-6 text-sm text-muted-foreground">선택된 입점처가 없습니다.</div>
        ) : !isEditing ? (
          // ✅ 보기 모드(카드)
          <div className="space-y-4">
            <div className="rounded-xl border p-4 space-y-2">
              <div className="text-sm font-semibold">기본 정보</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="text-sm text-muted-foreground">입점처명</div>
                <div className="text-sm">{store?.name ?? "-"}</div>

                <div className="text-sm text-muted-foreground">주소</div>
                <div className="text-sm">{store?.address ?? "-"}</div>
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-2">
              <div className="text-sm font-semibold">계약/운영</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="text-sm text-muted-foreground">상태</div>
                <div className="text-sm">{statusLabel(store?.status ?? "active")}</div>

                <div className="text-sm text-muted-foreground">온/오프라인</div>
                <div className="text-sm">{channelLabel(store?.channel ?? "offline")}</div>

                <div className="text-sm text-muted-foreground">수수료</div>
                <div className="text-sm">
                  {store?.commissionRate == null ? "-" : `${store.commissionRate}%`}
                </div>

                <div className="text-sm text-muted-foreground">입점료</div>
                <div className="text-sm">{store?.storeFee == null ? "-" : `${store.storeFee}`}</div>

                <div className="text-sm text-muted-foreground">태그</div>
                <div className="text-sm">
                  {(store?.tags ?? []).length ? (store?.tags ?? []).join(", ") : "-"}
                </div>
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-2">
              <div className="text-sm font-semibold">정산 운영</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="text-sm text-muted-foreground">정산 주기</div>
                <div className="text-sm">{store?.settlementCycle ?? "-"}</div>

                <div className="text-sm text-muted-foreground">정산일</div>
                <div className="text-sm">
                  {store?.settlementDay == null ? "-" : `매월 ${store.settlementDay}일`}
                </div>

                <div className="text-sm text-muted-foreground">정산 메모</div>
                <div className="text-sm">{store?.settlementNote ?? "-"}</div>
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-2">
              <div className="text-sm font-semibold">담당자/메모</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="text-sm text-muted-foreground">담당자/대표명</div>
                <div className="text-sm">{store?.contactName ?? "-"}</div>

                <div className="text-sm text-muted-foreground">전화</div>
                <div className="text-sm">{store?.phone ?? "-"}</div>

                <div className="text-sm text-muted-foreground">메모</div>
                <div className="text-sm">{store?.memo ?? "-"}</div>
              </div>
            </div>
          </div>
        ) : (
          // ✅ 편집/추가 모드(폼)
          <div className="space-y-4">
            <div className="rounded-xl border p-4 space-y-3">
              <div className="text-sm font-semibold">기본 정보</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <AppInput value={name} onChange={(e) => setName(e.target.value)} placeholder="입점처명" />
                <AppInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="주소(선택)" />
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-3">
              <div className="text-sm font-semibold">계약/운영</div>
              <div className="grid gap-2 sm:grid-cols-4">
                <AppSelect
                  value={status}
                  onValueChange={(v) => setStatus(v as any)}
                  placeholder="상태"
                  options={[
                    { value: "active", label: "입점중" },
                    { value: "inactive", label: "퇴점" },
                  ]}
                />
                <AppSelect
                  value={channel}
                  onValueChange={(v) => setChannel(v as any)}
                  placeholder="온/오프라인"
                  options={[
                    { value: "offline", label: "오프라인" },
                    { value: "online", label: "온라인" },
                  ]}
                />
                <AppInput value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="수수료(%)" inputMode="decimal" />
                <AppInput value={storeFee} onChange={(e) => setStoreFee(e.target.value)} placeholder="입점료(선택)" inputMode="numeric" />
              </div>

              {/* 태그 칩 */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-background px-2 py-2">
                  {tags.length === 0 ? (
                    <span className="text-xs text-muted-foreground px-1">태그 없음</span>
                  ) : (
                    tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full border bg-muted/30 px-2 py-1 text-xs">
                        {t}
                        <button
                          type="button"
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-muted"
                          aria-label={`remove ${t}`}
                          onClick={() => removeTag(t)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  )}

                  <input
                    value={tagInput}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v.includes(",")) {
                        const parts = v.split(",")
                        for (let i = 0; i < parts.length - 1; i++) addTag(parts[i])
                        setTagInput(parts[parts.length - 1])
                      } else {
                        setTagInput(v)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        addTag(tagInput)
                        setTagInput("")
                        return
                      }
                      if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                        e.preventDefault()
                        removeTag(tags[tags.length - 1])
                      }
                    }}
                    placeholder="태그 입력 후 Enter (또는 콤마)"
                    className="min-w-[180px] flex-1 bg-transparent px-1 text-sm outline-none"
                  />
                </div>
                <div className="text-xs text-muted-foreground">Enter로 추가, X로 삭제. 최대 20개.</div>
              </div>
            </div>

            <div className="rounded-xl border p-4 space-y-3">
              <div className="text-sm font-semibold">정산 운영</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <AppSelect
                  value={settlementCycle}
                  onValueChange={(v) => setSettlementCycle(v as any)}
                  placeholder="정산 주기(선택)"
                  options={[
                    { value: "monthly", label: "월 1회" },
                    { value: "weekly", label: "주 1회" },
                    { value: "biweekly", label: "격주" },
                    { value: "ad-hoc", label: "수시" },
                  ]}
                />
                <AppInput value={settlementDay} onChange={(e) => setSettlementDay(e.target.value)} placeholder="정산일(1~31, 선택)" inputMode="numeric" />
                <AppInput value={targetQty} onChange={(e) => setTargetQty(e.target.value)} placeholder="목표재고(선택)" inputMode="numeric" />
              </div>

              <textarea
                value={settlementNote}
                onChange={(e) => setSettlementNote(e.target.value)}
                placeholder="정산 메모(선택) 예: 배송비 공제, 카드매출 제외"
                className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="rounded-xl border p-4 space-y-3">
              <div className="text-sm font-semibold">담당자/메모</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <AppInput value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="담당자/대표명(선택)" />
                <AppInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="전화(선택)" inputMode="tel" />
                <AppInput value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모(선택)" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="mt-2">
          {/* edit에서만 삭제 */}
          {!isCreate && store && props.onRequestDelete && (
            <AppButton
              variant="outline"
              onClick={() => props.onRequestDelete?.(store.id, store.name)}
              disabled={props.busy}
              className="mr-auto"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              삭제
            </AppButton>
          )}

          {!isEditing ? (
            <>
              <AppButton variant="outline" onClick={() => setIsEditing(true)} disabled={props.busy || !store}>
                수정
              </AppButton>
              <AppButton variant="secondary" onClick={close}>
                닫기
              </AppButton>
            </>
          ) : (
            <>
              <AppButton variant="secondary" onClick={onClickCancelEdit} disabled={props.busy}>
                {isCreate ? "취소" : "취소"}
              </AppButton>
              <AppButton onClick={onClickPrimary} disabled={props.busy || !name.trim()}>
                {isCreate ? "추가" : "저장"}
              </AppButton>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}