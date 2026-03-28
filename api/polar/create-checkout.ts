import type { VercelRequest, VercelResponse } from "@vercel/node"
import { Polar } from "@polar-sh/sdk"

const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN ?? "",
  server: (process.env.POLAR_SERVER as "sandbox" | "production") ?? "sandbox",
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { userId, email } = req.body ?? {}

    if (!userId) {
      return res.status(400).json({ error: "userId is required" })
    }

    const productId = process.env.POLAR_PRODUCT_BASIC_MONTHLY
    const appUrl =
      process.env.VITE_APP_URL ||
      `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`

    if (!productId) {
      return res.status(500).json({ error: "POLAR_PRODUCT_BASIC_MONTHLY is missing" })
    }

    const checkout = await polar.checkouts.create({
      products: [productId],
      externalCustomerId: userId,
      customerEmail: email || undefined,
      successUrl: `${appUrl}/billing?checkout=success`,
      cancelUrl: `${appUrl}/pricing?checkout=cancelled`,
    })

    return res.status(200).json({
      url: checkout.url,
    })
  } catch (error: any) {
    console.error("[create-checkout] error", error)
    return res.status(500).json({
      error: error?.message || "Failed to create checkout session",
    })
  }
}