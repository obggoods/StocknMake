import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AppButton } from "@/components/app/AppButton"

export function ConfirmDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmText?: string
  secondaryText?: string
  cancelText?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onSecondary?: () => void | Promise<void>
}) {
  const {
    open,
    onOpenChange,
    title,
    description,
    confirmText = "확인",
    secondaryText,
    cancelText = "취소",
    destructive = false,
    busy = false,
    onConfirm,
    onSecondary,
  } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
      )}
      <DialogContent
        className="sm:max-w-md fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <AppButton type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelText}
          </AppButton>

          {secondaryText && onSecondary ? (
            <AppButton type="button" variant="outline" onClick={onSecondary} disabled={busy}>
              {secondaryText}
            </AppButton>
          ) : null}

          <AppButton
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmText}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
