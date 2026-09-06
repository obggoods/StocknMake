import { useState } from "react"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"

import { AppButton } from "@/components/app/AppButton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Props = {
  onEdit: () => void
  onDeleteRequest: () => void
  disabled?: boolean
}

export default function ProductRowActions(props: Props) {
  const { onEdit, onDeleteRequest, disabled } = props
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <AppButton type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label="작업">
          <MoreHorizontal className="h-4 w-4" />
        </AppButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onClick={() => {
            setOpen(false)
            onEdit()
          }}
        >
          <Pencil className="mr-2 h-4 w-4" />
          수정
        </DropdownMenuItem>

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            setOpen(false)
            onDeleteRequest()
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          삭제
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
