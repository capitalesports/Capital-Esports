import "server-only";
import { cashfreeEnv, cashfreePayoutsConfig, stubsForbidden } from "@/server/env";
import { AppError } from "@/server/errors";
import { paiseToRupees } from "@/lib/payments";

/**
 * Prize transfers. Cashfree Payouts v2 REST API (api-version 2024-01-01), called directly because
 * the official payouts Node SDK is unmaintained and pins a vulnerable axios. Endpoints and headers
 * follow that SDK and Cashfree's v2 docs: POST /payout/beneficiary, POST /payout/transfers,
 * GET /payout/transfers?transfer_id=.
 */
export interface PayoutGateway {
  readonly kind: "cashfree" | "stub";
  readonly webhookSecret: string;
  addBeneficiary(input: {
    beneficiaryId: string;
    name: string;
    phone: string;
    vpa?: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
  }): Promise<void>;
  transfer(input: {
    transferId: string;
    amountPaise: number;
    beneficiaryId: string;
    mode: "upi" | "banktransfer";
    remarks: string;
  }): Promise<{
    cfTransferId: string | null;
    status: string;
    raw: unknown;
  }>;
  getTransferStatus(transferId: string): Promise<string>;
}

const API_VERSION = "2024-01-01";

class CashfreePayoutGateway implements PayoutGateway {
  readonly kind = "cashfree" as const;
  readonly webhookSecret: string;
  private base: string;

  constructor(private cfg: { clientId: string; clientSecret: string }) {
    this.webhookSecret = cfg.clientSecret;
    this.base =
      cashfreeEnv() === "production"
        ? "https://api.cashfree.com/payout"
        : "https://sandbox.cashfree.com/payout";
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        "x-client-id": this.cfg.clientId,
        "x-client-secret": this.cfg.clientSecret,
        "x-api-version": API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      console.error("Cashfree payouts error", res.status, json);
      const msg = typeof json.message === "string" ? json.message : "Payout provider error";
      throw new AppError(res.status >= 500 ? "UNAVAILABLE" : "VALIDATION", msg);
    }
    return json;
  }

  async addBeneficiary(i: Parameters<PayoutGateway["addBeneficiary"]>[0]) {
    await this.call("POST", "/beneficiary", {
      beneficiary_id: i.beneficiaryId,
      beneficiary_name: i.name,
      beneficiary_instrument_details: i.vpa
        ? { vpa: i.vpa }
        : { bank_account_number: i.bankAccountNumber, bank_ifsc: i.bankIfsc },
      beneficiary_contact_details: {
        beneficiary_phone: i.phone.replace(/^\+91/, ""),
        beneficiary_country_code: "+91",
      },
    });
  }

  async transfer(i: Parameters<PayoutGateway["transfer"]>[0]) {
    const json = await this.call("POST", "/transfers", {
      transfer_id: i.transferId,
      transfer_amount: paiseToRupees(i.amountPaise),
      transfer_currency: "INR",
      transfer_mode: i.mode,
      beneficiary_details: { beneficiary_id: i.beneficiaryId },
      transfer_remarks: i.remarks.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 70),
    });
    return {
      cfTransferId: (json.cf_transfer_id as string) ?? null,
      status: String(json.status ?? "PENDING"),
      raw: json,
    };
  }

  async getTransferStatus(transferId: string) {
    const json = await this.call("GET", `/transfers?transfer_id=${encodeURIComponent(transferId)}`);
    return String(json.status ?? "UNKNOWN");
  }
}

export const STUB_PAYOUT_WEBHOOK_SECRET = "local-stub-payout-webhook-secret";

/** Local stand-in: transfers are RECEIVED; a signed webhook (tests) moves them on. */
class StubPayoutGateway implements PayoutGateway {
  readonly kind = "stub" as const;
  readonly webhookSecret = STUB_PAYOUT_WEBHOOK_SECRET;
  async addBeneficiary() {}
  async transfer(i: Parameters<PayoutGateway["transfer"]>[0]) {
    return {
      cfTransferId: `stub_${i.transferId}`,
      status: "RECEIVED",
      raw: { stub: true, transfer_id: i.transferId },
    };
  }
  async getTransferStatus() {
    return "RECEIVED";
  }
}

export function getPayoutGateway(): PayoutGateway {
  const cfg = cashfreePayoutsConfig();
  if (cfg) return new CashfreePayoutGateway(cfg);
  if (stubsForbidden()) throw new AppError("UNAVAILABLE", "Payouts are not configured.");
  return new StubPayoutGateway();
}
