/**
 * The asset generation CLI (M16).
 *
 *   npm run generate -- <bible.json> [--draft] [--provider <name>] [--force]
 *
 * Approved pair (sibling .approval.json) → generates from the approved
 * spec. No approval → requires --draft as explicit acknowledgment. Either
 * way the Bible is never modified and rendering still demands the approved
 * pair exactly as before.
 */

import { renderGenerateReport, runGeneration } from "./run";

function parseArgs(argv: string[]) {
  const args = { bible: "", draft: false, force: false, provider: "" };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--draft") args.draft = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--provider") args.provider = argv[++i] ?? "";
    else rest.push(arg);
  }
  args.bible = rest[0] ?? "";
  return args;
}

export async function runGenerate(argv: string[]) {
  const args = parseArgs(argv);
  if (!args.bible) {
    console.error(
      "Usage: pipeline generate <bible.json> [--draft] [--provider <name>] [--force]",
    );
    process.exit(2);
  }
  const report = await runGeneration({
    biblePath: args.bible,
    draft: args.draft,
    force: args.force,
    provider: args.provider || undefined,
  });
  console.log(renderGenerateReport(report));
  if (!report.satisfied) process.exit(1);
}

if (require.main === module) {
  runGenerate(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
