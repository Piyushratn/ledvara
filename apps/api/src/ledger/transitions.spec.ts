import { describe, expect, it } from "vitest";
import { canTransition, STATUSES, type TxnStatus } from "./transitions.js";

const allowed: [TxnStatus, TxnStatus][] = [
  ["created", "pending"],
  ["created", "settled"],
  ["created", "failed"],
  ["pending", "settled"],
  ["pending", "failed"],
  ["settled", "reversed"],
];

describe("canTransition", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const ok = allowed.some(([f, t]) => f === from && t === to);
      it(`${from} -> ${to} is ${ok ? "allowed" : "rejected"}`, () => {
        expect(canTransition(from, to)).toBe(ok);
      });
    }
  }
});
