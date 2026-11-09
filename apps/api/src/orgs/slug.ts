import { randomBytes } from "node:crypto";

/** Lowercase, ASCII letters and digits, single hyphens. Always valid for the slug rule. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40)
    .replace(/-+$/gu, "");
  return base.length >= 3 ? base : "org";
}

export function withSuffix(slug: string): string {
  const suffix = randomBytes(4).toString("hex").slice(0, 6);
  return `${slug.slice(0, 43).replace(/-+$/gu, "")}-${suffix}`;
}
