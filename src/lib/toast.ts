// src/lib/toast.ts
// Lightweight in-app toast (no external dependency).
// Provides a similar API surface to sonner: toast.success/error/message.

export type ToastKind = "success" | "error" | "info";

export type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;

  actionLabel?: string;
  onAction?: () => void;
};

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(items);
}

function add(
  kind: ToastKind,
  message: string,
  options?: {
    actionLabel?: string;
    onAction?: () => void;
  }
) {
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const next: ToastItem = {
  id,
  kind,
  message,
  createdAt: Date.now(),
  actionLabel: options?.actionLabel,
  onAction: options?.onAction,
};
  items = [next, ...items].slice(0, 4);
  emit();

  // Auto dismiss
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 3500);
}

export const toast = {
  success: (message: string, options?: { actionLabel?: string; onAction?: () => void }) =>
    add("success", message, options),

  error: (message: string, options?: { actionLabel?: string; onAction?: () => void }) =>
    add("error", message, options),

  message: (message: string, options?: { actionLabel?: string; onAction?: () => void }) =>
    add("info", message, options),
};

export function subscribeToToasts(listener: Listener) {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}
