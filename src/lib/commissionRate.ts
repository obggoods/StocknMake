export function formatCommissionPercent(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return "0"

  const oneDecimal = Math.round(n * 10) / 10
  return Number.isInteger(oneDecimal) ? String(oneDecimal) : oneDecimal.toFixed(1)
}

export function parseCommissionPercentInput(value: string): number | null {
  const text = String(value ?? "").trim()
  if (text === "") return null
  if (!/^\d{1,3}(\.\d)?$/.test(text)) return null

  const n = Number(text)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null

  return Math.round(n * 10) / 10
}

export function isEditableCommissionPercentInput(value: string): boolean {
  const text = String(value ?? "").trim()
  if (text === "") return true
  if (!/^\d{0,3}(\.\d?)?$/.test(text)) return false

  const n = Number(text)
  return !Number.isFinite(n) || n <= 100
}
