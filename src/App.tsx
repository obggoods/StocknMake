// src/App.tsx
import { Suspense, lazy, useEffect, useState } from "react"
import { Routes, Route, Navigate, useNavigate } from "react-router-dom"
import type { Session } from "@supabase/supabase-js"
import Pricing from "@/pages_legacy/Pricing"
import "./App.css"
import AppLoadingScreen from "@/components/shared/AppLoadingScreen"
import { Toaster } from "sonner"

<Toaster />
import AppLayout from "./app/layout/AppLayout"

const DashboardPage = lazy(() => import("./features/dashboard/pages/DashboardPage"))
const ProductsPage = lazy(() => import("./features/products/pages/ProductsPage"))
const StoresPage = lazy(() => import("./features/stores/pages/StoresPage"))
const SettingsPage = lazy(() => import("./features/settings/pages/SettingsPage"))
const MarginCalculatorPage = lazy(() => import("./features/margin/pages/MarginCalculatorPage"))
const SettlementsPage = lazy(() => import("./features/settlements/pages/SettlementsPage"))
const AdminInvitesPage = lazy(() => import("./pages_legacy/AdminInvites"))
const LoginPage = lazy(() => import("./pages_legacy/Login"))
const InviteGatePage = lazy(() => import("./pages_legacy/InviteGate"))
const InventoryPage = lazy(() => import("./features/inventory/pages/InventoryPage"))

import { supabase, getOrCreateMyProfile, getMyBilling } from "./lib/supabaseClient"

type MyProfile = {
  is_invited?: boolean
}

export default function App() {
  const nav = useNavigate()

  const [session, setSession] = useState<Session | null>(null)
  const [bootLoading, setBootLoading] = useState(true)

  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  const [isAdmin, setIsAdmin] = useState(false)
  const [adminChecked, setAdminChecked] = useState(false)

  const [billingLoaded, setBillingLoaded] = useState(false)
  const [billingPlan, setBillingPlan] = useState<"free" | "basic" | "premium">("free")
  const [isPaidUser, setIsPaidUser] = useState(false)

  // ✅ 0) 세션 부트스트랩 + Auth 상태 변화 구독
  useEffect(() => {
    let alive = true

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setBootLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setProfile(null)
      setIsAdmin(false)
      setAdminChecked(false)
      setBillingLoaded(false)
      setBillingPlan("free")
      setIsPaidUser(false)
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // ✅ 1) 로그인 상태에서만 프로필 로드 (초대 여부)
  useEffect(() => {
    let alive = true

      ; (async () => {
        if (!session) return

        try {
          setProfileLoading(true)
          const p = await getOrCreateMyProfile()
          if (!alive) return
          setProfile(p as MyProfile)
        } catch (e) {
          console.error("[App] profile load failed", e)
          if (!alive) return
          setProfile({ is_invited: false })
        } finally {
          if (alive) setProfileLoading(false)
        }
      })()

    return () => {
      alive = false
    }
  }, [session])

  // ✅ 1.5) 로그인 상태에서만 billing 로드
  useEffect(() => {
    let alive = true

      ; (async () => {
        if (!session) {
          if (!alive) return
          setBillingPlan("free")
          setIsPaidUser(false)
          setBillingLoaded(true)
          return
        }

        try {
          setBillingLoaded(false)
          const billing = await getMyBilling()
          if (!alive) return

          setBillingPlan(billing.plan_tier)
          setIsPaidUser(billing.is_paid)
        } catch (e) {
          console.error("[App] billing load failed", e)
          if (!alive) return

          setBillingPlan("free")
          setIsPaidUser(false)
        } finally {
          if (alive) setBillingLoaded(true)
        }
      })()

    return () => {
      alive = false
    }
  }, [session])

  // ✅ 2) 로그인 상태에서만 관리자 여부 체크
  useEffect(() => {
    let cancelled = false

      ; (async () => {
        if (!session) {
          if (!cancelled) {
            setIsAdmin(false)
            setAdminChecked(true)
          }
          return
        }

        const { data, error } = await supabase.rpc("is_admin")
        if (cancelled) return

        setIsAdmin(!error && !!data)
        setAdminChecked(true)
      })()

    return () => {
      cancelled = true
    }
  }, [session])

  if (bootLoading) {
    return <AppLoadingScreen message="서비스를 준비하고 있어요" />
  }

  if (!session) {
    return (
      <Suspense fallback={<AppLoadingScreen message="로그인 화면을 불러오고 있어요" />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    )
  }

  // ✅ 4) 로그인 했으면 프로필/관리자 확인이 끝날 때까지 대기
  if (profileLoading || !profile || !adminChecked || !billingLoaded) {
    return <AppLoadingScreen message="초대 여부를 확인하고 있어요" />
  }

  // 그냥 통과
  // ✅ 6) 초대(또는 관리자) 통과 → 앱 화면

  return (
    <Suspense fallback={<div className="app-loading">로딩 중...</div>}>
      <Routes>
        <Route
          element={
            <AppLayout
              sessionEmail={session.user.email ?? ""}
              isAdmin={isAdmin}
              billingPlan={billingPlan}
              onLogout={async () => {
                await supabase.auth.signOut()
                nav("/login")
              }}
            />
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/stores" element={<StoresPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/margin" element={<MarginCalculatorPage />} />
          <Route path="/settlements" element={<SettlementsPage />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route
            path="/invite"
            element={
              !isAdmin && profile.is_invited !== true ? (
                <InviteGatePage />
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />
          {/* Admin */}
          <Route
            path="/admin/invites"
            element={isAdmin ? <AdminInvitesPage /> : <Navigate to="/dashboard" replace />}
          />

          {/* (임시) /admin/users로 들어오면 invites로 보내기 */}
          <Route path="/admin/users" element={<Navigate to="/admin/invites" replace />} />

          {/* Backward compat */}
          <Route path="/master" element={<Navigate to="/products" replace />} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
