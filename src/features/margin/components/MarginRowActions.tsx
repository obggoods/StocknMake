import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Edit2, Trash2, Copy } from "lucide-react"
import { useState } from "react"

export default function MarginRowActions(props: {
    onEdit: () => void
    onDelete: () => void
    onDuplicate: () => void
}) {
    const { onEdit, onDelete, onDuplicate } = props
    const [open, setOpen] = useState(false)
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="px-2 text-lg leading-none text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                        e.stopPropagation()
                    }}
                >
                    …
                </button>
            </PopoverTrigger>

            <PopoverContent
                align="end"
                className="w-32 p-1"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex flex-col text-sm">

                    {/* 복제 */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            onDuplicate()
                            setOpen(false)
                        }}
                        className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted"
                    >
                        <Copy className="h-4 w-4" />
                        복제
                    </button>

                    {/* 수정 */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            onEdit()
                            setOpen(false)
                        }}
                        className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted"
                    >
                        <Edit2 className="h-4 w-4" />
                        수정
                    </button>

                    {/* 삭제 */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            onDelete()
                            setOpen(false)
                        }}
                        className="flex items-center gap-2 rounded-md px-2 py-2 text-destructive hover:bg-destructive/10"
                    >
                        <Trash2 className="h-4 w-4" />
                        삭제
                    </button>

                </div>
            </PopoverContent>
        </Popover>
    )
}