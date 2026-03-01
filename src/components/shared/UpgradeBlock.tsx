import { AppButton } from "@/components/app/AppButton"
import { AppCard } from "@/components/app/AppCard"

/**
 * UpgradeBlock
 * - 플랜 제한 UI(Free 차단)
 * - 결제/라우팅 연동은 프로젝트마다 다르므로, onUpgradeClick 핸들러를 옵션으로 제공
 */
export function UpgradeBlock(props: {
  title?: string
  description?: string
  onUpgradeClick?: () => void
}) {
  const {
    title = "Basic 플랜 이상에서 사용 가능한 기능입니다",
    description = "업그레이드하면 입점처 성과 분석, 고급 리포트 등 추가 기능을 사용할 수 있어요.",
    onUpgradeClick,
  } = props

  return (
    <AppCard
      title={title}
      description={description}
      action={
        onUpgradeClick ? (
          <AppButton onClick={onUpgradeClick}>업그레이드</AppButton>
        ) : null
      }
    >
      <div className="text-sm text-muted-foreground">현재 플랜에서는 접근이 제한됩니다.</div>
    </AppCard>
  )
}