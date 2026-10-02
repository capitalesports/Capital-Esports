import type { Metadata } from "next";
import { PaymentStatusPoller } from "@/components/match/payment-status-poller";
import { requirePageUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Payment status", robots: { index: false } };

/**
 * Cashfree redirects here after checkout. The redirect proves nothing: we poll our own order status,
 * which only the verified webhook can change.
 */
export default async function PaymentReturnPage({ searchParams }: PageProps<"/payments/return">) {
  const orderId = (await searchParams).order_id;
  await requirePageUser("/dashboard");
  return (
    <div className="mx-auto max-w-md py-12">
      <div className="card-ds p-6 text-center">
        <h1 className="text-3xl font-bold">Payment status</h1>
        {typeof orderId === "string" ? (
          <PaymentStatusPoller orderId={orderId} />
        ) : (
          <p className="text-muted-foreground mt-4">Missing order reference.</p>
        )}
      </div>
    </div>
  );
}
