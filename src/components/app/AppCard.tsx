import type { ReactNode } from "react"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

type AppCardDensity = "default" | "compact"

export type AppCardProps = {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  density?: AppCardDensity
  className?: string
  headerClassName?: string
  contentClassName?: string
  children?: ReactNode
}

/**
 * AppCard
 * - Standardizes card header layout (title/description + optional right action).
 * - Standardizes padding via density.
 */
export function AppCard({
  title,
  description,
  action,
  density = "default",
  className,
  headerClassName,
  contentClassName,
  children,
}: AppCardProps) {
  const isCompact = density === "compact"

  return (
    <Card
      className={cn(
        // Card base already includes py-6 + px via slots; we control vertical rhythm.
        isCompact ? "gap-4 py-4" : null,
        className
      )}
    >
      {(title || description || action) && (
        <CardHeader
        className={cn(
          isCompact ? "px-4 pb-0" : null,
          "has-data-[slot=card-action]:grid-cols-1 xl:has-data-[slot=card-action]:grid-cols-[1fr_auto]",
          headerClassName
        )}
      >
          <div className="grid gap-1">
            {title ? <CardTitle className="text-base">{title}</CardTitle> : null}
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>

          {action ? (
  <CardAction className="col-start-1 row-start-auto row-span-1 w-full justify-self-start xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:w-auto xl:justify-self-end">
    {action}
  </CardAction>
) : null}
        </CardHeader>
      )}

      {children !== undefined && children !== null ? (
        <CardContent className={cn(isCompact ? "px-4" : null, contentClassName)}>
          {children}
        </CardContent>
      ) : null}
    </Card>
  )
}
