import { createHmac } from "node:crypto";
import process from "node:process";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const input = process.argv[2];
if (!input) {
  console.error("Usage: node apps/api/scripts/totp-now.mjs <BASE32_SECRET>");
  process.exit(1);
}

let bits = 0;
let value = 0;
const bytes = [];
for (const char of input.toUpperCase().replace(/=+$/u, "")) {
  value = ((value << 5) | ALPHABET.indexOf(char)) & 0xfff;
  bits += 5;
  if (bits >= 8) {
    bytes.push((value >>> (bits - 8)) & 0xff);
    bits -= 8;
  }
}

const counter = Buffer.alloc(8);
counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
const offset = digest[digest.length - 1] & 0x0f;
const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
console.log(String(code).padStart(6, "0"));
