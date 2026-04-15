import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { supabase } from "../lib/supabaseClient"

import { AppCard } from "@/components/app/AppCard"
import { AppInput } from "@/components/app/AppInput"
import { AppButton } from "@/components/app/AppButton"

export default function InviteGate() {
  const nav = useNavigate()

  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const trimmed = useMemo(() => code.trim(), [code])

  const submit = async () => {
    if (!trimmed || busy) return
    setBusy(true)
    setMsg(null)

    try {
      const { data, error } = await supabase.rpc("redeem_invite", { p_code: trimmed })
      if (error) throw error

      if (!data?.ok) {
        const e = data?.error ?? "unknown"
        if (e === "invalid_code") setMsg("초대코드가 올바르지 않아요.")
        else if (e === "already_used") setMsg("이미 사용된 초대코드예요.")
        else if (e === "not_authenticated") setMsg("로그인이 필요해요.")
        else setMsg("처리 중 오류가 발생했어요.")
        return
      }

      // ✅ 성공: 초대 통과 후 대시보드로 이동
      // App.tsx가 프로필을 다시 로드하게끔 확실하게 새로고침 방식 유지
      window.location.href = "/dashboard"
      // (대안) nav("/dashboard", { replace: true }) 를 쓰고 싶으면,
      // App.tsx에서 프로필 refresh 로직이 확실할 때만 추천.
    } catch (e: any) {
      setMsg(e?.message ?? "처리 실패")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <AppCard className="p-6">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">초대코드 입력</h1>
            <p className="text-sm text-muted-foreground">
              베타 테스트는 초대된 사용자만 이용할 수 있어요.
              <br />
              초대코드를 입력해 주세요.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            <AppInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="초대코드"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit()
              }}
              className="w-full"
            />

            <AppButton
              type="button"
              onClick={submit}
              disabled={busy || !trimmed}
              className="w-full"
            >
              {busy ? "확인 중..." : "확인"}
            </AppButton>

            {msg && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {msg}
              </div>
            )}
          </div>

          <div className="mt-6 text-xs text-muted-foreground">
            문제가 계속되면 초대코드를 다시 확인하거나 관리자에게 문의해 주세요.
          </div>
        </AppCard>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          Stock &amp; Make · 클로즈 베타
        </div>
      </div>
    </div>
  )
}