import "server-only";
import { Cashfree, CFEnvironment } from "cashfree-pg";
import {
  cashfreeEnv,
  cashfreePgConfig,
  isProductionDeployment,
  razorpayConfig,
} from "@/server/env";
import { AppError } from "@/server/errors";
import { paiseToRupees } from "@/lib/payments";

/** Our order plus what the provider gave us for it (Payment.sessionId / Payment.cfPaymentId). */
export interface OrderRef {
  orderId: string;
  /** Cashfree payment_session_id, or the Razorpay order id. */
  sessionId: string | null;
  /** The provider's payment id once paid (Cashfree cf_payment_id, Razorpay pay_…). */
  providerPaymentId?: string | null;
}

/**
 * Entry-fee payments. Razorpay or Cashfree in real use; a local stub when keys are absent (dev/test
 * only). The amount always comes from our Payment row, never from the browser.
 */
export interface PaymentGateway {
  readonly kind: "cashfree" | "razorpay" | "stub";
  /** Cashfree needs the payer's mobile number; Razorpay doesn't (DECISIONS M43). */
  readonly requiresPhone: boolean;
  /** Secret used to sign webhooks for this gateway. */
  readonly webhookSecret: string;
  createOrder(input: {
    orderId: string;
    amountPaise: number;
    customerId: string;
    customerPhone: string | null;
    returnUrl: string;
    notifyUrl: string;
    expiresAt: Date;
  }): Promise<{ paymentSessionId: string }>;
  /** "PAID" when the provider has the money; anything else means not paid (yet). */
  fetchOrderStatus(order: OrderRef): Promise<string>;
  refund(
    input: OrderRef & { refundId: string; amountPaise: number; note: string },
  ): Promise<{ status: string }>;
  /** "SUCCESS" | "PENDING" | "CANCELLED" | "NOT_FOUND" | … */
  fetchRefundStatus(input: OrderRef & { refundId: string }): Promise<string>;
}

/** 10-digit Indian number for Cashfree's customer_phone. */
function localPhone(e164: string): string {
  return e164.startsWith("+91") ? e164.slice(3) : e164.replace(/^\+/, "");
}

class CashfreePaymentGateway implements PaymentGateway {
  readonly kind = "cashfree" as const;
  readonly requiresPhone = true;
  readonly webhookSecret: string;
  private cf: Cashfree;

  constructor(cfg: { appId: string; secretKey: string }) {
    const env = cashfreeEnv() === "production" ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
    // Error analytics off: the SDK would otherwise report errors to Cashfree's Sentry.
    this.cf = new Cashfree(env, cfg.appId, cfg.secretKey, undefined, undefined, undefined, false);
    this.webhookSecret = cfg.secretKey;
  }

  async createOrder(i: Parameters<PaymentGateway["createOrder"]>[0]) {
    if (!i.customerPhone) throw new AppError("VALIDATION", "A mobile number is needed to pay.");
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

  async fetchOrderStatus(order: OrderRef) {
    const res = await this.cf.PGFetchOrder(order.orderId);
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

  async fetchRefundStatus(i: Parameters<PaymentGateway["fetchRefundStatus"]>[0]) {
    const res = await this.cf.PGOrderFetchRefund(i.orderId, i.refundId);
    return res.data.refund_status ?? "UNKNOWN";
  }
}

/** A Razorpay payment as returned by GET /v1/payments/:id (the fields we use). */
export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
}

interface RazorpayRefund {
  id: string;
  receipt: string | null;
  /** pending | processed | failed */
  status: string;
}

const RAZORPAY_API = "https://api.razorpay.com/v1";

/** Razorpay refund status in our RefundEvent words. */
export function mapRazorpayRefundStatus(status: string): string {
  if (status === "processed") return "SUCCESS";
  if (status === "failed") return "CANCELLED";
  return "PENDING";
}

/**
 * Razorpay Standard Checkout (DECISIONS M43): our server creates the order with the match's entry
 * fee, the browser only opens Razorpay's popup for that order, and the payment counts after we
 * verify its signature and re-read it from Razorpay (amount, order, status).
 */
export class RazorpayPaymentGateway implements PaymentGateway {
  readonly kind = "razorpay" as const;
  readonly requiresPhone = false;
  readonly webhookSecret: string;
  readonly keyId: string;
  readonly keySecret: string;

  constructor(cfg: { keyId: string; keySecret: string; webhookSecret: string }) {
    this.keyId = cfg.keyId;
    this.keySecret = cfg.keySecret;
    this.webhookSecret = cfg.webhookSecret;
  }

  private async api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${RAZORPAY_API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as T & {
      error?: { code?: string; description?: string };
    };
    if (!res.ok) {
      console.error("Razorpay API error", method, path, res.status, json.error?.code);
      throw new Error(
        `Razorpay ${method} ${path} -> ${res.status} ${json.error?.description ?? ""}`,
      );
    }
    return json;
  }

  async createOrder(i: Parameters<PaymentGateway["createOrder"]>[0]) {
    try {
      const order = await this.api<{ id: string }>("POST", "/orders", {
        amount: i.amountPaise,
        currency: "INR",
        // Our order id (36 chars, Razorpay allows 40) ties their order back to ours.
        receipt: i.orderId,
        notes: { order_id: i.orderId, user_id: i.customerId },
      });
      if (!order.id) throw new Error("missing order id");
      return { paymentSessionId: order.id };
    } catch (e) {
      console.error("Razorpay create order failed", e);
      throw new AppError("UNAVAILABLE", "Could not start the payment. Please try again.");
    }
  }

  async fetchOrderStatus(order: OrderRef) {
    if (!order.sessionId) return "ACTIVE";
    const o = await this.api<{ status: string }>(
      "GET",
      `/orders/${encodeURIComponent(order.sessionId)}`,
    );
    return o.status === "paid" ? "PAID" : "ACTIVE";
  }

  /** The order's payment that holds money (captured, or authorized and not yet captured), if any. */
  async findOrderPayment(razorpayOrderId: string): Promise<string | null> {
    const list = await this.api<{ items: RazorpayPayment[] }>(
      "GET",
      `/orders/${encodeURIComponent(razorpayOrderId)}/payments`,
    );
    const paid =
      list.items.find((p) => p.status === "captured") ??
      list.items.find((p) => p.status === "authorized");
    return paid?.id ?? null;
  }

  fetchPayment(paymentId: string) {
    return this.api<RazorpayPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
  }

  /** Capture an authorized payment (when the account doesn't auto-capture). */
  capture(paymentId: string, amountPaise: number) {
    return this.api<RazorpayPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, {
      amount: amountPaise,
      currency: "INR",
    });
  }

  private async findRefund(paymentId: string, receipt: string) {
    const list = await this.api<{ items: RazorpayRefund[] }>(
      "GET",
      `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`,
    );
    return list.items.find((r) => r.receipt === receipt) ?? null;
  }

  async refund(i: Parameters<PaymentGateway["refund"]>[0]) {
    if (!i.providerPaymentId) throw new Error(`No Razorpay payment id for ${i.orderId}`);
    // Razorpay refunds aren't idempotent by receipt: look first so a retry never refunds twice.
    const existing = await this.findRefund(i.providerPaymentId, i.refundId);
    if (existing) return { status: mapRazorpayRefundStatus(existing.status) };
    const created = await this.api<RazorpayRefund>(
      "POST",
      `/payments/${encodeURIComponent(i.providerPaymentId)}/refund`,
      { amount: i.amountPaise, receipt: i.refundId, notes: { reason: i.note.slice(0, 250) } },
    );
    return { status: mapRazorpayRefundStatus(created.status) };
  }

  async fetchRefundStatus(i: Parameters<PaymentGateway["fetchRefundStatus"]>[0]) {
    if (!i.providerPaymentId) return "NOT_FOUND";
    const r = await this.findRefund(i.providerPaymentId, i.refundId);
    return r ? mapRazorpayRefundStatus(r.status) : "NOT_FOUND";
  }
}

/** Fixed secret for signing stub webhooks locally. Never valid in production (stub is refused there). */
export const STUB_WEBHOOK_SECRET = "local-stub-webhook-secret";

/** Local stand-in: orders are "ACTIVE" until our stub checkout page posts a signed webhook. */
class StubPaymentGateway implements PaymentGateway {
  readonly kind = "stub" as const;
  readonly requiresPhone = false;
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
  const rzp = razorpayConfig();
  if (rzp) return new RazorpayPaymentGateway(rzp);
  const cfg = cashfreePgConfig();
  if (cfg) return new CashfreePaymentGateway(cfg);
  if (isProductionDeployment()) throw new AppError("UNAVAILABLE", "Payments are not configured.");
  return new StubPaymentGateway();
}

/** The Razorpay gateway when Razorpay is configured, else null. */
export function getRazorpayGateway(): RazorpayPaymentGateway | null {
  const rzp = razorpayConfig();
  return rzp ? new RazorpayPaymentGateway(rzp) : null;
}
