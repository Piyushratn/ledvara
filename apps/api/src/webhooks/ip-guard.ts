import { isIP } from "node:net";

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inRange(ip: number, base: string, bits: number): boolean {
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => inRange(value, base, bits));
}

/** Expands any valid IPv6 text form into 8 groups of 16 bits, or null if it cannot be parsed. */
function expandIPv6(input: string): number[] | null {
  let addr = input.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);

  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const n = ipv4ToInt(tail);
    addr = `${addr.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;

  const groups =
    halves.length === 1 ? head : [...head, ...new Array<string>(missing).fill("0"), ...rest];
  const numbers = groups.map((group) => parseInt(group, 16));
  const valid =
    numbers.length === 8 && numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff);
  return valid ? numbers : null;
}

function embeddedV4(groups: number[], index: number): string {
  const high = groups[index] ?? 0;
  const low = groups[index + 1] ?? 0;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** True for anything that is not a public, routable address. Unparseable input counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version !== 6) return true;

  const g = expandIPv6(ip);
  if (!g) return true;
  const at = (i: number): number => g[i] ?? 0;

  const firstFiveZero = [0, 1, 2, 3, 4].every((i) => at(i) === 0);
  if (firstFiveZero && at(5) === 0 && at(6) === 0 && (at(7) === 0 || at(7) === 1)) return true; // :: and ::1
  if (firstFiveZero && at(5) === 0xffff) return isBlockedV4(embeddedV4(g, 6)); // ::ffff:a.b.c.d
  if (at(0) === 0x64 && at(1) === 0xff9b && [2, 3, 4, 5].every((i) => at(i) === 0)) {
    return isBlockedV4(embeddedV4(g, 6)); // NAT64
  }
  if ((at(0) & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((at(0) & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((at(0) & 0xffc0) === 0xfec0) return true; // fec0::/10 site local
  if ((at(0) & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (at(0) === 0x2001 && at(1) === 0x0db8) return true; // documentation
  return false;
}
