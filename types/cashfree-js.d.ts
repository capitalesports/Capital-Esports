// Minimal typings for Cashfree's browser checkout SDK (the package ships none).
declare module "@cashfreepayments/cashfree-js" {
  interface CheckoutOptions {
    paymentSessionId: string;
    redirectTarget?: "_self" | "_blank" | "_top" | "_modal" | HTMLElement;
  }
  interface CashfreeInstance {
    checkout(options: CheckoutOptions): Promise<unknown>;
  }
  export function load(options: { mode: "sandbox" | "production" }): Promise<CashfreeInstance>;
}
