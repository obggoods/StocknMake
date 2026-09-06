import { cn } from "@/lib/utils"
import { Check, ChevronsUpDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { AppButton } from "@/components/app/AppButton"

export type AppSelectOption = { value: string; label: string }

export function AppSelect(props: {
  value: string
  onValueChange: (v: string) => void
  options: AppSelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const { value, onValueChange, options, placeholder = "선택", disabled, className } = props
  const selected = options.find((option) => option.value === value)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <AppButton type="button" variant="outline" disabled={disabled} className={cn("h-8 w-full min-w-[120px] justify-between px-3 text-left font-normal", className)}>
          <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </AppButton>
      </PopoverTrigger>
      <PopoverContent className="w-[min(360px,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder={`${placeholder} 검색...`} />
          <CommandList><CommandEmpty>선택지가 없습니다.</CommandEmpty><CommandGroup>
            {options.map((option) => <CommandItem key={option.value || "__empty"} value={option.label} onSelect={() => onValueChange(option.value)}>
              <Check className={cn("mr-2 h-4 w-4", option.value === value ? "opacity-100" : "opacity-0")} />
              <span className="truncate">{option.label}</span>
            </CommandItem>)}
          </CommandGroup></CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
