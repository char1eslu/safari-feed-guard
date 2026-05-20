import { readFileSync } from "node:fs";
import { classifyAccount } from "./classify.ts";

/**
 * Usage:
 *   pnpm classify <signals.json> [--force]
 *
 * <signals.json> is one AccountSignals object (see fixtures/).
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: pnpm classify <signals.json> [--force]");
    process.exit(2);
  }

  const input = JSON.parse(readFileSync(file, "utf8"));
  const { record, cached, usage } = await classifyAccount(input, { force });

  const v = record.verdict;
  const bar = "─".repeat(56);
  console.log(bar);
  console.log(`@${record.handle}  (userId ${record.userId})`);
  console.log(bar);
  console.log(`label       : ${v.label}`);
  console.log(`confidence  : ${v.confidence.toFixed(2)}`);
  console.log("reasons     :");
  for (const r of v.reasons) console.log(`  • ${r}`);
  console.log(`review      : ${record.reviewStatus}  (never auto-public)`);
  console.log(`source      : ${cached ? "cache" : `LLM ${record.model}`}`);
  if (usage) console.log(`tokens      : ${usage.total_tokens}`);
  console.log(bar);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
