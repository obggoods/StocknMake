import { useEffect, useMemo, useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "react-router-dom"

import { supabase } from "../lib/supabaseClient"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AppCard } from "@/components/app/AppCard"
import { AppInput } from "@/components/app/AppInput"
import { AppButton } from "@/components/app/AppButton"

export default function Login() {
  const nav = useNavigate()

  // 이미 로그인 상태면 대시보드로
  useEffect(() => {
    let alive = true

    const check = async () => {
      const { data } = await supabase.auth.getSession()
      if (!alive) return
      if (data.session) nav("/dashboard", { replace: true })
    }
    check()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) nav("/dashboard", { replace: true })
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [nav])

  const [mode, setMode] = useState<"login" | "signup">("login")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string>("")

  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState("")
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotMsg, setForgotMsg] = useState("")

  const emailTrimmed = useMemo(() => email.trim(), [email])

  useEffect(() => {
    setMessage("")
    // 모드 바뀌면 비번찾기 패널은 닫는 게 UX상 자연스러움
    setForgotOpen(false)
    setForgotMsg("")
  }, [mode])

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setMessage("")

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: emailTrimmed,
          password,
        })
        if (error) throw error

        // supabase 설정에 따라 이메일 인증이 필요할 수 있음
        setMessage("회원가입이 완료됐어요. 인증을 위해 가입한 이메일의 메일함을 확인해주세요.")
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailTrimmed,
          password,
        })
        if (error) throw error

        setMessage("로그인 성공! 이동 중…")
        // 실제 이동은 onAuthStateChange가 처리
      }
    } catch (err: any) {
      setMessage(err?.message ?? "에러가 발생했어요.")
    } finally {
      setLoading(false)
    }
  }

  const sendResetEmail = async () => {
    const target = (forgotEmail || "").trim()
    if (!target) {
      setForgotMsg("이메일을 입력해 주세요.")
      return
    }

    setForgotLoading(true)
    setForgotMsg("")

    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) setForgotMsg("메일 전송 실패: " + error.message)
    else setForgotMsg("재설정 메일을 보냈어요. 메일함을 확인해 주세요.")

    setForgotLoading(false)
  }

  return (
    <div className="min-h-screen bg-background text-foreground grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <AppCard className="p-6">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">스톡앤메이크 | 재고·제작 관리</h1>
            <p className="text-sm text-muted-foreground">Supabase 이메일 로그인</p>
          </div>

          <div className="mt-6">
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as "login" | "signup")}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">로그인</TabsTrigger>
                <TabsTrigger value="signup">회원가입</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-4 min-h-[240px]">
                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium">
                      이메일
                    </label>
                    <AppInput
                      id="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
                      disabled={loading}
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="password" className="text-sm font-medium">
                      비밀번호
                    </label>
                    <AppInput
                      id="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type="password"
                      placeholder="비밀번호"
                      required
                      autoComplete="current-password"
                      disabled={loading}
                    />
                  </div>

                  <AppButton type="submit" disabled={loading} className="w-full">
                    {loading ? "처리 중..." : "로그인"}
                  </AppButton>

                  {/* 비밀번호 찾기 */}
                  <div className="pt-2">
                    <button
                      type="button"
                      className="text-sm text-primary underline-offset-4 hover:underline"
                      onClick={() => {
                        setForgotOpen((v) => !v)
                        setForgotMsg("")
                        setForgotEmail(emailTrimmed || "")
                      }}
                      disabled={loading}
                    >
                      비밀번호를 잊으셨나요?
                    </button>

                    {forgotOpen && (
                      <div className="mt-3 rounded-md border bg-card p-3">
                        <div className="space-y-2">
                          <label htmlFor="forgotEmail" className="text-sm font-medium">
                            이메일
                          </label>
                          <AppInput
                            id="forgotEmail"
                            type="email"
                            value={forgotEmail}
                            onChange={(e) => setForgotEmail(e.target.value)}
                            placeholder="you@example.com"
                            autoComplete="email"
                            disabled={forgotLoading || loading}
                          />
                        </div>

                        <div className="mt-3 flex gap-2">
                          <AppButton
                            type="button"
                            onClick={sendResetEmail}
                            disabled={forgotLoading || loading}
                            className="flex-1"
                          >
                            {forgotLoading ? "전송 중..." : "재설정 메일 보내기"}
                          </AppButton>
                          <AppButton
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setForgotOpen(false)
                              setForgotMsg("")
                            }}
                            className="flex-1"
                          >
                            닫기
                          </AppButton>
                        </div>

                        {forgotMsg && (
                          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {forgotMsg}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 메시지 */}
                  {message && (
                    <div className={`rounded-md border px-3 py-2 text-sm ${message ? "text-muted-foreground" : "text-transparent"}`}>
                      {message || "placeholder"}
                    </div>
                  )}
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-4 min-h-[240px]">
                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="email2" className="text-sm font-medium">
                      이메일
                    </label>
                    <AppInput
                      id="email2"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
                      disabled={loading}
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="password2" className="text-sm font-medium">
                      비밀번호
                    </label>
                    <AppInput
                      id="password2"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type="password"
                      placeholder="비밀번호"
                      required
                      autoComplete="new-password"
                      disabled={loading}
                    />
                  </div>

                  <AppButton type="submit" disabled={loading} className="w-full">
                    {loading ? "처리 중..." : "회원가입"}
                  </AppButton>

                  {message && (
                    <div className={`rounded-md border px-3 py-2 text-sm ${message ? "text-muted-foreground" : "text-transparent"}`}>
                      {message || "placeholder"}
                    </div>
                  )}
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </AppCard>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          Stock &amp; Make · 클로즈 베타
        </div>
      </div>
    </div>
  )
}