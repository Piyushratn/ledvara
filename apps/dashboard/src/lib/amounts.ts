/** Rupees typed by a person ("12.5", "1,000") to paise as a string. Null when not a valid amount. */
export function rupeesToPaise(input: string): string | null {
  const cleaned = input.trim().replace(/,/gu, "");
  if (cleaned === "") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const paise = BigInt(whole) * 100n + BigInt(fraction);
  return paise > 0n ? paise.toString() : null;
}
