import "server-only";
import { Cashfree, CFEnvironment } from "cashfree-pg";
import { cashfreeEnv, cashfreePgConfig, isProductionDeployment } from "@/server/env";
import { AppError } from "@/server/errors";
import { paiseToRupees } from "@/lib/payments";

/** Entry-fee payments. Cashfree PG in real use; a local stub when keys are absent (dev/test only). */
export interface PaymentGateway {
  readonly kind: "cashfree" | "stub";
  /** Secret used to sign webhooks for this gateway. */
  readonly webhookSecret: string;
  createOrder(input: {
    orderId: string;
    amountPaise: number;
    customerId: string;
    customerPhone: string;
    returnUrl: string;
    notifyUrl: string;
    expiresAt: Date;
  }): Promise<{ paymentSessionId: string }>;
  /** "PAID" | "ACTIVE" | "EXPIRED" | "TERMINATED" | ... as reported by the provider. */
  fetchOrderStatus(orderId: string): Promise<string>;
  refund(input: {
    orderId: string;
    refundId: string;
    amountPaise: number;
    note: string;
  }): Promise<{ status: string }>;
  fetchRefundStatus(orderId: string, refundId: string): Promise<string>;
}

/** 10-digit Indian number for Cashfree's customer_phone. */
function localPhone(e164: string): string {
  return e164.startsWith("+91") ? e164.slice(3) : e164.replace(/^\+/, "");
}

class CashfreePaymentGateway implements PaymentGateway {
  readonly kind = "cashfree" as const;
  readonly webhookSecret: string;
  private cf: Cashfree;

  constructor(cfg: { appId: string; secretKey: string }) {
    const env = cashfreeEnv() === "production" ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
    // Error analytics off: the SDK would otherwise report errors to Cashfree's Sentry.
    this.cf = new Cashfree(env, cfg.appId, cfg.secretKey, undefined, undefined, undefined, false);
    this.webhookSecret = cfg.secretKey;
  }

  async createOrder(i: Parameters<PaymentGateway["createOrder"]>[0]) {
    try {
      const res = await this.cf.PGCreateOrder(
        {
          order_id: i.orderId,
          order_amount: paiseToRupees(i.amountPaise),
          order_currency: "INR",
          customer_details: {
            customer_id: i.customerId,
            customer_phone: localPhone(i.customerPhone),
          },
          order_meta: { return_url: i.returnUrl, notify_url: i.notifyUrl },
          order_expiry_time: i.expiresAt.toISOString(),
        },
        undefined,
        i.orderId,
      );
      const id = res.data.payment_session_id;
      if (!id) throw new Error("missing payment_session_id");
      return { paymentSessionId: id };
    } catch (e) {
      console.error(
        "Cashfree create order failed",
        (e as { response?: { data?: unknown } }).response?.data ?? e,
      );
      throw new AppError("UNAVAILABLE", "Could not start the payment. Please try again.");
    }
  }

  async fetchOrderStatus(orderId: string) {
    const res = await this.cf.PGFetchOrder(orderId);
    return res.data.order_status ?? "UNKNOWN";
  }

  async refund(i: Parameters<PaymentGateway["refund"]>[0]) {
    const res = await this.cf.PGOrderCreateRefund(
      i.orderId,
      {
        refund_amount: paiseToRupees(i.amountPaise),
        refund_id: i.refundId,
        refund_note: i.note.slice(0, 100),
      },
      undefined,
      i.refundId,
    );
    return { status: res.data.refund_status ?? "PENDING" };
  }

  async fetchRefundStatus(orderId: string, refundId: string) {
    const res = await this.cf.PGOrderFetchRefund(orderId, refundId);
    return res.data.refund_status ?? "UNKNOWN";
  }
}

/** Fixed secret for signing stub webhooks locally. Never valid in production (stub is refused there). */
export const STUB_WEBHOOK_SECRET = "local-stub-webhook-secret";

/** Local stand-in: orders are "ACTIVE" until our stub checkout page posts a signed webhook. */
class StubPaymentGateway implements PaymentGateway {
  readonly kind = "stub" as const;
  readonly webhookSecret = STUB_WEBHOOK_SECRET;
  async createOrder(i: Parameters<PaymentGateway["createOrder"]>[0]) {
    return { paymentSessionId: `stub_session_${i.orderId}` };
  }
  async fetchOrderStatus() {
    return "ACTIVE";
  }
  async refund() {
    return { status: "PENDING" };
  }
  async fetchRefundStatus() {
    return "PENDING";
  }
}

export function getPaymentGateway(): PaymentGateway {
  const cfg = cashfreePgConfig();
  if (cfg) return new CashfreePaymentGateway(cfg);
  if (isProductionDeployment()) throw new AppError("UNAVAILABLE", "Payments are not configured.");
  return new StubPaymentGateway();
}
