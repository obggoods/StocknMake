import { Badge, type BadgeProps } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type AppBadgeVariant = NonNullable<BadgeProps["variant"]>

export type AppBadgeProps = BadgeProps & {
  variant?: AppBadgeVariant
}

export function AppBadge({
  className,
  variant = "muted",
  ...props
}: AppBadgeProps) {
  return (
    <Badge
      variant={variant}
      className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", className)}
      {...props}
    />
  )
}