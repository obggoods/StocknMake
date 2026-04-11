import { NavLink } from "react-router-dom"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

type NavItem = {
  to: string
  label: string
}

const navSections: Array<{
  title: string
  items: NavItem[]
}> = [
    {
      title: "운영",
      items: [
        { to: "/dashboard", label: "대시보드" },
        { to: "/settlements", label: "정산" },
        { to: "/inventory", label: "재고" },
      ],
    },
    {
      title: "관리",
      items: [
        { to: "/products", label: "제품" },
        { to: "/stores", label: "입점처" },
      ],
    },
    {
      title: "도구",
      items: [
        { to: "/margin", label: "마진" },
      ],
    },
    {
      title: "설정",
      items: [
        { to: "/settings", label: "설정" },
      ],
    },
  ]

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

export default function Sidebar(props: {
  isAdmin: boolean
  mobileOpen: boolean
  onMobileClose: () => void
  billingPlan?: "free" | "basic" | "premium"
}) {
  const { isAdmin, mobileOpen, onMobileClose, billingPlan } = props

  const linkClass = (isActive: boolean) =>
    cx(
      "block rounded-lg px-3 py-2 text-sm transition-colors no-underline",
      "text-sidebar-foreground/80 hover:text-sidebar-foreground",
      "hover:bg-sidebar-accent",
      isActive && "bg-primary/12 text-primary font-medium"
    )

  return (
    <>
      {/* 데스크톱 */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:bg-sidebar md:text-sidebar-foreground md:border-sidebar-border">
        <div className="h-14 px-4 flex items-center border-b border-sidebar-border">
          <NavLink to="/dashboard" className="font-semibold text-sm text-sidebar-foreground">
            스톡앤메이크
          </NavLink>
        </div>

        <nav className="flex-1 p-3 space-y-6 text-sidebar-foreground">
          {navSections.map((section) => (
            <div key={section.title}>
              <div className="px-2 mb-2 text-[11px] uppercase tracking-wide text-sidebar-foreground/50">
                {section.title}
              </div>

              <div className="space-y-1">
                {section.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) => linkClass(isActive)}
                  >
                    {it.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}

          {/* 관리자 섹션 */}
          {isAdmin && (
            <div>
              <div className="px-2 mb-2 text-[11px] uppercase tracking-wide text-sidebar-foreground/50">
                관리자
              </div>

              <NavLink
                to="/admin/invites"
                className={({ isActive }) => linkClass(isActive)}
              >
                관리자
              </NavLink>
            </div>
          )}
        </nav>
        {billingPlan === "free" && (
          <div className="p-3">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="text-sm font-semibold text-foreground">
                업그레이드하기
              </div>

              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                정산, CSV 업로드, 다운로드 기능을 사용해보세요.
              </p>

              <NavLink to="/pricing">
                <button className="mt-3 w-full h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 transition">
                  Basic 시작하기
                </button>
              </NavLink>
            </div>
          </div>
        )}
      </aside>

      {/* 모바일 */}
      {mobileOpen ? (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={onMobileClose}
          />

          <div className="absolute left-0 top-0 h-full w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-lg p-3">
            <div className="h-14 px-4 flex items-center justify-between border-b border-sidebar-border">
              <NavLink
                to="/dashboard"
                className="font-semibold text-sm text-sidebar-foreground"
                onClick={onMobileClose}
              >
                스톡앤메이크
              </NavLink>

              <Button
                variant="ghost"
                size="icon"
                onClick={onMobileClose}
                className="text-sidebar-foreground/80 hover:text-sidebar-foreground"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <nav className="mt-4 space-y-6">
              {navSections.map((section) => (
                <div key={section.title}>
                  <div className="px-2 mb-2 text-[11px] uppercase tracking-wide text-sidebar-foreground/50">
                    {section.title}
                  </div>

                  <div className="space-y-1">
                    {section.items.map((it) => (
                      <NavLink
                        key={it.to}
                        to={it.to}
                        onClick={onMobileClose}
                        className={({ isActive }) => linkClass(isActive)}
                      >
                        {it.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}

              {isAdmin && (
                <div>
                  <div className="px-2 mb-2 text-[11px] uppercase tracking-wide text-sidebar-foreground/50">
                    관리자
                  </div>

                  <NavLink
                    to="/admin/invites"
                    onClick={onMobileClose}
                    className={({ isActive }) => linkClass(isActive)}
                  >
                    관리자
                  </NavLink>
                </div>
              )}
            </nav>
            {billingPlan === "free" && (
              <div className="mt-4 px-2">
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <div className="text-sm font-semibold text-foreground">
                    업그레이드하기
                  </div>

                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    정산, 일괄 업로드 등 고급 기능을 사용해보세요.
                  </p>

                  <NavLink to="/pricing" onClick={onMobileClose}>
                    <button className="mt-3 w-full h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
                      Basic 시작하기
                    </button>
                  </NavLink>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}