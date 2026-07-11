/**
 * The pipeline CLI (M14): one entry point for the whole production
 * workflow. Each command delegates to the stage's existing implementation —
 * nothing is reimplemented here, this is pure orchestration:
 *
 *   author  → the M12 Claude Author (the only non-deterministic stage)
 *   review  → the M13 review report
 *   approve → the M13 approval workflow (interactive human gate)
 *   render  → M7 gate → compiler → Remotion, headless
 *   preview → M7 gate → compiler → Remotion Studio
 *
 * Rendering and previewing accept ONLY approved Bibles: both paths begin
 * at compileApprovedBible, which demands an approval whose hash matches
 * the exact Bible bytes. A draft has no approval, so a draft cannot render
 * — not as policy, but structurally.
 */

import { runAuthor } from "../author/author";
import { runReviewCli } from "../review/cli";
import { previewInStudio, renderVideo } from "./run";

const USAGE = `The production pipeline:

  script → author → draft → review → approve → render

Usage:
  npm run pipeline -- author <script.txt> [--id <id>] [--title <t>] [--dry-run]
      Draft a Bible from a script via Claude. Output: drafts/<id>.bible.json

  npm run pipeline -- review <bible.json> [--script <file>]
      Print the human review report (validation, warnings, assumptions,
      runtime, scenes, assets, continuity, approval status).

  npm run pipeline -- approve <draft.bible.json> --by <reviewer> [--yes]
      Review + explicit confirmation, then write the approved pair to
      approved/. This is the only way an approval comes into being.

  npm run pipeline -- render <bible.json> <approval.json> [--out <file.mp4>]
                     [--frames <a-b>]
      Compile the approved pair through the gate and render headlessly.

  npm run pipeline -- preview <bible.json> <approval.json>
      Compile the approved pair through the gate and open Remotion Studio
      on the resulting plan.`;

function parseRenderArgs(argv: string[]) {
  const args: { positional: string[]; out?: string; frames?: string } = {
    positional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--frames") args.frames = argv[++i];
    else args.positional.push(arg);
  }
  return args;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "author":
      await runAuthor(rest);
      return;

    case "review":
      await runReviewCli(["report", ...rest]);
      return;

    case "approve":
      await runReviewCli(["approve", ...rest]);
      return;

    case "render": {
      const args = parseRenderArgs(rest);
      const [biblePath, approvalPath] = args.positional;
      if (!biblePath || !approvalPath) {
        console.error(
          "render needs both files: pipeline render <bible.json> <approval.json>",
        );
        process.exit(2);
      }
      const outPath = renderVideo({
        biblePath,
        approvalPath,
        outPath: args.out,
        frames: args.frames,
      });
      console.log(`\nRendered: ${outPath}`);
      return;
    }

    case "preview": {
      const [biblePath, approvalPath] = rest;
      if (!biblePath || !approvalPath) {
        console.error(
          "preview needs both files: pipeline preview <bible.json> <approval.json>",
        );
        process.exit(2);
      }
      previewInStudio(biblePath, approvalPath);
      return;
    }

    default:
      console.error(USAGE);
      process.exit(command ? 2 : 0);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
