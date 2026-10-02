/** Money is stored as integer paise. These helpers convert at the edges only. */

/** "49", "49.5", "49.50" -> 4950. Returns null for anything else (negative, >2 decimals, junk). */
export function rupeesToPaise(input: string | number): number | null {
  const s = String(input).trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const inrWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** 4950 -> "₹49.50", 50000 -> "₹500". */
export function formatINR(paise: number): string {
  return paise % 100 === 0 ? inrWhole.format(paise / 100) : inr.format(paise / 100);
}

/** 4950 -> "49.50" for form inputs. */
export function paiseToRupeesInput(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

export function formatEntryFee(paise: number): string {
  return paise === 0 ? "Free" : formatINR(paise);
}
