import { cn } from "@/lib/utils"

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

  // placeholder 지원: value가 비어있으면 placeholder option을 보여줌
  const hasEmpty = options.some((o) => o.value === "")
  const normalizedOptions = hasEmpty
    ? options
    : [{ value: "", label: placeholder }, ...options]

  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(
          "flex h-8 w-full appearance-none items-center rounded-md border border-input bg-background px-3 pr-10 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
        value={value ?? ""}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
      >
        {normalizedOptions.map((o) => (
          <option key={o.value || "__empty"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* 오른쪽 화살표 */}
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground">
        ▾
      </div>
    </div>
  )
}
