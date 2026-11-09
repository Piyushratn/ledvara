function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/gu, ",");
  return `${rest},${last3}`;
}

/** Paise as a string, e.g. "10000" -> "₹100.00". Never converts to a JS number. */
export function formatInr(minor: string): string {
  if (!/^-?\d+$/u.test(minor)) return "—";
  const negative = minor.startsWith("-");
  const digits = BigInt(negative ? minor.slice(1) : minor);
  const whole = (digits / 100n).toString();
  const paise = (digits % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}₹${groupIndian(whole)}.${paise}`;
}
