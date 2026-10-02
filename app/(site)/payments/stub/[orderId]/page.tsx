import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { getPaymentGateway } from "@/server/providers/payment-gateway";
import { formatINR } from "@/lib/money";
import { simulateStubPayment } from "./actions";

export const metadata: Metadata = { title: "Test checkout", robots: { index: false } };

/**
 * Local stand-in for Cashfree's checkout, available only when Cashfree keys are absent.
 * Buttons send a correctly signed webhook through the real webhook handler.
 */
export default async function StubCheckoutPage({ params }: PageProps<"/payments/stub/[orderId]">) {
  const { orderId } = await params;
  const user = await requirePageUser("/dashboard");
  if (getPaymentGateway().kind !== "stub") notFound();
  const payment = await db.payment.findUnique({
    where: { orderId },
    select: { userId: true, amountPaise: true },
  });
  if (!payment || payment.userId !== user.id) notFound();

  return (
    <div className="card-ds border-gold/60 mx-auto my-12 max-w-md space-y-4 p-6">
      <h1 className="text-3xl font-bold">Test checkout</h1>
      <p className="font-heading text-gold text-4xl font-extrabold">
        {formatINR(payment.amountPaise)}
      </p>
      <p className="text-muted-foreground">
        Development mode: no money moves. Choose what the payment provider reports for{" "}
        {formatINR(payment.amountPaise)}.
      </p>
      <form action={simulateStubPayment} className="flex flex-col gap-2">
        <input type="hidden" name="orderId" value={orderId} />
        <Button type="submit" name="outcome" value="SUCCESS">
          Simulate successful payment
        </Button>
        <Button type="submit" name="outcome" value="FAILED" variant="outline">
          Simulate failed payment
        </Button>
        <Button type="submit" name="outcome" value="USER_DROPPED" variant="ghost">
          Close checkout without paying
        </Button>
      </form>
    </div>
  );
}
