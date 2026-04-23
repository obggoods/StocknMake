import { useRef, useState, type FormEvent } from "react"
import { supabase } from "../lib/supabaseClient"

import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [errorType, setErrorType] = useState<"email" | "password" | null>(null)

  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")

  const [signupEmail, setSignupEmail] = useState("")
  const [signupPassword, setSignupPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const emailRef = useRef<HTMLInputElement | null>(null)
  const passwordRef = useRef<HTMLInputElement | null>(null)

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<"error" | "success">("error")
  const [shake, setShake] = useState(false)

  const triggerShake = () => {
    setShake(true)
    window.setTimeout(() => setShake(false), 300)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    setMessageType("error")
    setErrorType(null)

    try {
      if (mode === "signup") {
        if (signupPassword !== confirmPassword) {
          setMessage("비밀번호가 일치하지 않아요.")
          setErrorType("password")
          triggerShake()
          setLoading(false)
          return
        }

        const normalizedSignupEmail = signupEmail.trim().toLowerCase()

        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: normalizedSignupEmail,
          password: signupPassword,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
          },
        })

        if (signUpError) {
          if (signUpError.message.includes("User already registered")) {
            setMessage("이미 가입된 이메일입니다. 로그인 후 초대코드를 입력해 주세요.")
            setErrorType("email")
            emailRef.current?.focus()
          } else if (signUpError.message.includes("Password")) {
            setMessage("비밀번호는 최소 6자 이상이어야 합니다.")
            setErrorType("password")
            passwordRef.current?.focus()
          } else {
            setMessage("회원가입 중 오류가 발생했습니다.")
          }
          triggerShake()
          setLoading(false)
          return
        }

        // 이메일 인증이 켜져 있으면 session이 없습니다.
        // 이 경우 즉시 로그인하지 않고, 이메일 인증 후 로그인하도록 안내합니다.
        if (!signUpData.session) {
          setSignupPassword("")
          setConfirmPassword("")
          setLoginEmail(normalizedSignupEmail)
          setMode("login")
          setMessageType("success")
          setMessage("회원가입 신청이 완료됐어요. 이메일 인증 후 로그인해 주세요.")
          setLoading(false)
          return
        }

        // 이메일 인증이 꺼진 환경에서는 signUp 직후 세션이 생길 수 있습니다.
        // 초대코드는 회원가입 화면이 아니라 /invite 화면에서 한 번만 입력합니다.
        window.location.href = "/invite"
        return
      }

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: loginEmail.trim().toLowerCase(),
          password: loginPassword,
        })

        if (error) {
          if (error.message === "Invalid login credentials") {
            setMessage("이메일 또는 비밀번호가 올바르지 않습니다.")
            setErrorType("password")
            triggerShake()
            passwordRef.current?.focus()
          } else {
            setMessage("로그인 중 오류가 발생했습니다.")
            triggerShake()
          }
          setLoading(false)
          return
        }

        window.location.href = "/dashboard"
        return
      }
    } catch (e: any) {
      if (e?.message === "Invalid login credentials") {
        setMessage("이메일 또는 비밀번호가 올바르지 않습니다.")
        setErrorType("password")
        passwordRef.current?.focus()
      } else {
        setMessage("요청 처리 중 오류가 발생했습니다.")
      }
      triggerShake()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-4xl flex-col gap-6">
        <Card className="w-full overflow-hidden p-0">
          <CardContent className="grid min-h-[560px] p-0 md:grid-cols-2">
            <form
              onSubmit={onSubmit}
              className={`flex h-full flex-col p-6 md:p-8 ${shake ? "animate-[shake_0.3s]" : ""}`}
            >
              <div className="flex h-[72px] flex-col items-center justify-center gap-2 text-center">
                <h1 className="text-2xl font-bold">
                  {mode === "login" ? "다시 오셨네요" : "계정을 만들어보세요"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  스톡앤메이크에 로그인하여 관리하세요
                </p>
              </div>

              <Tabs
                value={mode}
                onValueChange={(v) => {
                  setMode(v as "login" | "signup")
                  setMessage(null)
                  setMessageType("error")
                  setErrorType(null)
                }}
                className="mt-6 flex flex-1 flex-col"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">로그인</TabsTrigger>
                  <TabsTrigger value="signup">회원가입</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="mt-2 flex flex-1 flex-col">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">이메일</label>
                      <Input
                        ref={emailRef}
                        value={loginEmail}
                        onChange={(e) => {
                          setLoginEmail(e.target.value)
                          setErrorType(null)
                          setMessage(null)
                        }}
                        type="email"
                        required
                        disabled={loading}
                        className={
                          errorType === "email"
                            ? "border-destructive focus-visible:ring-destructive"
                            : ""
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">비밀번호</label>
                      <Input
                        ref={passwordRef}
                        value={loginPassword}
                        onChange={(e) => {
                          setLoginPassword(e.target.value)
                          setErrorType(null)
                          setMessage(null)
                        }}
                        type="password"
                        required
                        disabled={loading}
                        className={
                          errorType === "password"
                            ? "border-destructive focus-visible:ring-destructive"
                            : ""
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-6 space-y-2">
                    <div
                      className={`min-h-5 text-center text-sm font-medium ${messageType === "success" ? "text-primary" : "text-destructive"
                        }`}
                    >
                      {mode === "login" ? message : ""}
                    </div>

                    <Button
                      type="submit"
                      className="h-11 w-full text-sm font-medium"
                      disabled={loading}
                    >
                      {loading ? "로그인 중..." : "로그인"}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="signup" className="mt-2 flex flex-1 flex-col">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">이메일</label>
                      <Input
                        value={signupEmail}
                        onChange={(e) => {
                          setSignupEmail(e.target.value)
                          setErrorType(null)
                          setMessage(null)
                        }}
                        type="email"
                        required
                        disabled={loading}
                        className={
                          errorType === "email"
                            ? "border-destructive focus-visible:ring-destructive"
                            : ""
                        }
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">비밀번호</label>
                        <Input
                          ref={passwordRef}
                          value={signupPassword}
                          onChange={(e) => {
                            setSignupPassword(e.target.value)
                            setErrorType(null)
                            setMessage(null)
                          }}
                          type="password"
                          required
                          disabled={loading}
                          className={
                            errorType === "password"
                              ? "border-destructive focus-visible:ring-destructive"
                              : ""
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">비밀번호 확인</label>
                        <Input
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(e.target.value)
                            setErrorType(null)
                            setMessage(null)
                          }}
                          type="password"
                          required
                          disabled={loading}
                          className={
                            errorType === "password"
                              ? "border-destructive focus-visible:ring-destructive"
                              : ""
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-2">
                    <div
                      className={`min-h-5 text-center text-sm font-medium ${messageType === "success" ? "text-primary" : "text-destructive"
                        }`}
                    >
                      {mode === "signup" ? message : ""}
                    </div>

                    <Button
                      type="submit"
                      className="h-11 w-full text-sm font-medium"
                      disabled={loading}
                    >
                      {loading ? "가입 중..." : "회원가입"}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </form>

            <div className="relative hidden overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,252,0.96)_0%,rgba(248,248,241,0.98)_100%)] md:block">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(164,196,152,0.20),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(255,237,214,0.42),transparent_30%)]" />
              <div className="absolute inset-y-0 left-0 w-px bg-border/70" />

              <div className="relative flex h-full flex-col justify-between px-12 py-12">
                <div className="space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-background/90 shadow-sm">
                      <img
                        src="/logo.png"
                        alt="스톡앤메이크 로고"
                        className="h-9 w-9 object-contain"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Stock &amp; Make
                      </div>
                      <div className="text-base font-semibold text-foreground">
                        스몰 브랜드 운영을 위한 워크스페이스
                      </div>
                    </div>
                  </div>

                  <div className="mx-auto mb-6 w-full max-w-[360px]">
                    <p className="text-center text-sm leading-6 text-muted-foreground">
                      재고, 제작, 정산을 하나의 흐름으로 관리하세요.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="mx-auto w-full max-w-[360px] rounded-2xl border border-border/60 bg-white/88 p-5 shadow-sm backdrop-blur-sm">
                    <div className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-[#6f7768]">
                      핵심 기능
                    </div>

                    <div className="grid gap-3">
                      <div className="flex items-start gap-3 rounded-xl border border-[#ecebe5] bg-[#fffefa] px-4 py-3 shadow-[0_2px_10px_rgba(120,146,110,0.04)]">
                        <div className="mt-1.5 h-2 w-2 rounded-full bg-primary" />
                        <div>
                          <div className="text-sm font-medium text-foreground">입점처별 재고 관리</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            입점처 재고 목록을 한 화면에서 정리
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 rounded-xl border border-[#ecebe5] bg-[#fffefa] px-4 py-3 shadow-[0_2px_10px_rgba(120,146,110,0.04)]">
                        <div className="mt-1.5 h-2 w-2 rounded-full bg-primary" />
                        <div>
                          <div className="text-sm font-medium text-foreground">정산 자동 계산</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            판매총액, 정산금, 순마진을 한 눈에 확인
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 rounded-xl border border-[#ecebe5] bg-[#fffefa] px-4 py-3 shadow-[0_2px_10px_rgba(120,146,110,0.04)]">
                        <div className="mt-1.5 h-2 w-2 rounded-full bg-primary" />
                        <div>
                          <div className="text-sm font-medium text-foreground">제작 수량 추적</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            필요한 제작 수량을 입점처 기준으로 관리
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 rounded-xl border border-[#ecebe5] bg-[#fffefa] px-4 py-3 shadow-[0_2px_10px_rgba(120,146,110,0.04)]">
                        <div className="mt-1.5 h-2 w-2 rounded-full bg-primary" />
                        <div>
                          <div className="text-sm font-medium text-foreground">엑셀 업로드 지원</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            재고·제작·정산 데이터를 손쉽게 업로드
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          Stock &amp; Make · 클로즈 베타
        </div>
      </div>
    </div>
  )
}
