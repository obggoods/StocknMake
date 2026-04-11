import { Link } from "react-router-dom"
import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"

export default function Pricing() {
  const [checkoutLoading, setCheckoutLoading] = useState(false)

  async function handleStartBasicCheckout() {
    try {
      setCheckoutLoading(true)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) throw userError

      if (!user) {
        alert("먼저 로그인해 주세요.")
        return
      }

      const response = await fetch("/api/polar/create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
        }),
      })
      
      const rawText = await response.text()
      console.log("[Pricing] checkout raw response:", response.status, rawText)
      
      let result: any = null
      
      try {
        result = rawText ? JSON.parse(rawText) : null
      } catch {
        result = null
      }
      
      if (!response.ok) {
        throw new Error(
          result?.error ||
            rawText ||
            `결제 링크 생성 실패 (status: ${response.status})`
        )
      }
      
      if (!result?.url) {
        throw new Error("결제 URL이 없습니다.")
      }

      window.location.href = result.url
    } catch (error: any) {
      console.error("[Pricing] checkout error", error)
      alert(error?.message || "결제 시작 중 오류가 발생했습니다.")
    } finally {
      setCheckoutLoading(false)
    }
  }

  return (
    <div className="pageWrap">
      <div className="pageContainer max-w-6xl">
        <section className="mx-auto max-w-3xl pt-2 text-center">
          <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            현재 베타 운영 중
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            필요한 기능만 남긴, 브랜드 운영용 요금제
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            스톡앤메이크는 오프라인 입점처 재고, 제작 부족분, 정산 흐름을 한 곳에서 관리할 수 있도록 돕습니다.
            지금은 베타 운영 중이며, 유료 플랜은 필요한 기능부터 순차적으로 연결하고 있습니다.
          </p>
        </section>

        <section className="mx-auto mt-8 grid max-w-5xl gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">Beta</div>
                <div className="mt-2 text-3xl font-bold tracking-tight text-foreground">무료</div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  기본 재고/입점처 관리가 필요한 초기 사용자용
                </p>
              </div>

              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                현재 사용 가능
              </span>
            </div>

            <div className="mt-6 h-px bg-border" />

            <ul className="mt-6 space-y-3 text-sm text-foreground">
              <li>제품 / 입점처 / 재고 관리</li>
              <li>입점처별 취급 제품 ON/OFF</li>
              <li>제작 대상 / 비활성 제품 관리</li>
              <li>백업(JSON) 다운로드</li>
            </ul>

            <div className="mt-8 rounded-xl bg-muted/60 px-4 py-3 text-xs leading-6 text-muted-foreground">
              베타 종료 후 일부 기능은 유료 플랜으로 전환될 수 있습니다.
            </div>
          </div>

          <div className="relative rounded-2xl border border-primary/30 bg-card p-6 shadow-sm ring-1 ring-primary/15">
            <div className="absolute right-5 top-5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              추천
            </div>

            <div className="flex items-start justify-between gap-3 pr-14">
              <div>
                <div className="text-sm font-semibold text-foreground">Basic</div>
                <div className="mt-2 flex items-end gap-1">
                  <span className="text-3xl font-bold tracking-tight text-foreground">월 9,900원</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  반복 작업을 줄이고 운영 시간을 아끼고 싶은 사용자용
                </p>
              </div>
            </div>

            <div className="mt-6 h-px bg-border" />

            <ul className="mt-6 space-y-3 text-sm text-foreground">
              <li>정산 기능</li>
              <li>CSV / 엑셀 업로드</li>
              <li>다운로드 / 내보내기 확장</li>
              <li>운영 자동화 기능 순차 추가</li>
            </ul>

            <div className="mt-8 rounded-xl bg-primary/5 px-4 py-3 text-xs leading-6 text-muted-foreground">
              결제 완료 후 구독 활성화는 반영까지 약간의 시간이 걸릴 수 있습니다.
            </div>

            <button
              onClick={handleStartBasicCheckout}
              disabled={checkoutLoading}
              className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {checkoutLoading ? "결제창으로 이동 중..." : "월 9,900원으로 시작하기"}
            </button>
          </div>
        </section>

        <section className="mx-auto mt-10 max-w-5xl rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <div className="text-sm font-semibold text-foreground">어떤 사용자에게 맞나요?</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                입점처가 여러 곳이고, 재고·제작·정산을 한 화면에서 정리하고 싶은 소규모 브랜드 운영자에게 적합합니다.
              </p>
            </div>

            <div>
              <div className="text-sm font-semibold text-foreground">언제 결제하면 좋나요?</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                수기 입력과 엑셀 정리가 번거롭고, 정산과 업로드 기능이 꼭 필요한 시점부터 Basic 플랜이 가장 효율적입니다.
              </p>
            </div>

            <div>
              <div className="text-sm font-semibold text-foreground">정책 확인</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                결제 및 구독 관련 정책은{" "}
                <Link to="/terms" className="font-medium underline underline-offset-4">
                  이용약관
                </Link>
                에서 확인할 수 있습니다.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}