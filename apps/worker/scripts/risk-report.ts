import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, renderReport } from "../src/risk/eval/evaluate.js";
import { SCENARIOS } from "../src/risk/eval/scenarios.js";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "../../../docs/risk-evaluation.md");
const report = renderReport(evaluate(SCENARIOS));
writeFileSync(target, report, "utf8");
console.log(`Wrote ${target}`);
