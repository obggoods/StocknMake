import type { VercelRequest, VercelResponse } from "@vercel/node"
import { createClient } from "@supabase/supabase-js"
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks"

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }

  return Buffer.concat(chunks)
}

function toBillingStatus(status?: string | null) {
  switch (status) {
    case "active":
      return "active"
    case "trialing":
      return "trialing"
    case "canceled":
      return "canceled"
    case "unpaid":
      return "unpaid"
    case "past_due":
      return "past_due"
    default:
      return "inactive"
  }
}

function toPlanTier(productName?: string | null) {
  const name = (productName ?? "").toLowerCase()

  if (name.includes("premium")) return "premium"
  if (name.includes("basic")) return "basic"
  return "basic"
}

function getExternalUserIdFromPayload(payload: any): string | null {
  return (
    payload?.data?.customer?.external_id ??
    payload?.data?.customer?.externalId ??
    payload?.data?.customer_external_id ??
    payload?.data?.customerExternalId ??
    null
  )
}

function getSubscriptionId(payload: any): string | null {
  return payload?.data?.id ?? null
}

function getCustomerId(payload: any): string | null {
  return payload?.data?.customer_id ?? payload?.data?.customerId ?? payload?.data?.customer?.id ?? null
}

function getCurrentPeriodEnd(payload: any): string | null {
  return (
    payload?.data?.current_period_end ??
    payload?.data?.currentPeriodEnd ??
    payload?.data?.ends_at ??
    payload?.data?.endsAt ??
    null
  )
}

function getCancelAtPeriodEnd(payload: any): boolean {
  return Boolean(
    payload?.data?.cancel_at_period_end ??
      payload?.data?.cancelAtPeriodEnd ??
      false
  )
}

function getProductName(payload: any): string | null {
  const product =
    payload?.data?.product ??
    payload?.data?.items?.[0]?.product ??
    payload?.data?.items?.[0]?.product_snapshot ??
    null

  return product?.name ?? null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!webhookSecret) {
    return res.status(500).json({ error: "POLAR_WEBHOOK_SECRET is missing" })
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Supabase server env is missing" })
  }

  try {
    const rawBody = await readRawBody(req)

    const payload = validateEvent(rawBody, req.headers, webhookSecret)

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const eventType = payload.type
    const externalUserId = getExternalUserIdFromPayload(payload)

    console.log("[polar webhook] eventType:", eventType)
    console.log("[polar webhook] externalUserId:", externalUserId)

    if (!externalUserId) {
      return res.status(202).json({ ok: true, skipped: "no external user id" })
    }

    // 1) 구독 활성/생성/업데이트/취소/회수 처리
    if (
      eventType === "subscription.created" ||
      eventType === "subscription.updated" ||
      eventType === "subscription.active" ||
      eventType === "subscription.canceled" ||
      eventType === "subscription.revoked" ||
      eventType === "subscription.uncanceled"
    ) {
      const subscriptionStatus =
        payload?.data?.status ??
        payload?.data?.subscription_status ??
        "inactive"

      const productName = getProductName(payload)
      const planTier = toPlanTier(productName)

      const { error } = await supabaseAdmin
        .from("billing_subscriptions")
        .upsert(
          {
            user_id: externalUserId,
            plan_tier: planTier,
            billing_status: toBillingStatus(subscriptionStatus),
            provider: "polar",
            provider_customer_id: getCustomerId(payload),
            provider_subscription_id: getSubscriptionId(payload),
            current_period_ends_at: getCurrentPeriodEnd(payload),
            cancel_at_period_end: getCancelAtPeriodEnd(payload),
          },
          { onConflict: "user_id" }
        )

      if (error) {
        console.error("[polar webhook] subscription upsert error", error)
        return res.status(500).json({ error: "subscription upsert failed" })
      }

      return res.status(202).json({ ok: true })
    }

    // 2) 구독 갱신 감지
    if (eventType === "order.created") {
      const billingReason =
        payload?.data?.billing_reason ??
        payload?.data?.billingReason ??
        null

      if (billingReason === "subscription_cycle" || billingReason === "subscription_create") {
        const productName = getProductName(payload)
        const planTier = toPlanTier(productName)

        const { error } = await supabaseAdmin
          .from("billing_subscriptions")
          .upsert(
            {
              user_id: externalUserId,
              plan_tier: planTier,
              billing_status: "active",
              provider: "polar",
              provider_customer_id: getCustomerId(payload),
              current_period_ends_at: getCurrentPeriodEnd(payload),
            },
            { onConflict: "user_id" }
          )

        if (error) {
          console.error("[polar webhook] order upsert error", error)
          return res.status(500).json({ error: "order upsert failed" })
        }
      }

      return res.status(202).json({ ok: true })
    }

    // 나머지 이벤트는 일단 무시
    return res.status(202).json({ ok: true, ignored: eventType })
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error("[polar webhook] invalid signature")
      return res.status(403).json({ error: "Invalid webhook signature" })
    }

    console.error("[polar webhook] unexpected error", error)
    return res.status(500).json({ error: "Webhook handler failed" })
  }
}