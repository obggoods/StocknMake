// src/components/shared/Toaster.tsx
import { useEffect, useState } from "react";

import type { ToastItem } from "@/lib/toast";
import { subscribeToToasts } from "@/lib/toast";

function kindClass(kind: ToastItem["kind"]) {
  switch (kind) {
    case "success":
      return "border-border bg-background";
    case "error":
      return "border-destructive/40 bg-background";
    default:
      return "border-border bg-background";
  }
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToToasts(setItems);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg border px-4 py-3 text-sm shadow-sm ${kindClass(t.kind)}`}
          role="status"
          aria-live="polite"
        >
          <div className="font-medium">
            {t.kind === "success" ? "완료" : t.kind === "error" ? "오류" : "안내"}
          </div>

          <div className="text-muted-foreground">{t.message}</div>

          {/* 👉 여기 중요 */}
          {t.actionLabel && t.onAction ? (
            <button
              onClick={t.onAction}
              className="mt-2 text-xs underline text-muted-foreground hover:text-foreground"
            >
              {t.actionLabel}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
