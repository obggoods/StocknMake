import { Outlet } from "react-router-dom"
import { useState } from "react"

import Sidebar from "./Sidebar"
import Topbar from "./Topbar"
import { Toaster } from "@/components/shared/Toaster"

export default function AppLayout(props: {
  sessionEmail: string
  isAdmin: boolean
  billingPlan?: "free" | "basic" | "premium"
  onLogout: () => void
}) {
  const { sessionEmail, isAdmin, billingPlan, onLogout } = props

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="flex min-h-screen">
        <Sidebar
          isAdmin={isAdmin}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
          billingPlan={billingPlan}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            sessionEmail={sessionEmail}
            onLogout={onLogout}
            onOpenSidebar={() => setMobileSidebarOpen(true)}
          />

<main className="w-full overflow-x-hidden">
            <div className="mx-auto max-w-6xl px-4 py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <Toaster />
    </div>
  )
}