/**
 * The review CLI (M13) — the interactive shell.
 *
 *   npm run review -- report <bible.json> [--script <file>]
 *   npm run review -- approve <draft.bible.json> --by <reviewer>
 *                     [--script <file>] [--out approved] [--yes]
 *
 * `report` prints the review for any Bible file (draft or approved — a
 * sibling <id>.approval.json is picked up automatically, so it also answers
 * "is this approval still valid?").
 *
 * `approve` prints the review, refuses drafts with validation errors, asks
 * for explicit confirmation, then writes the approved pair the M7 gate
 * demands. This is the ONLY sanctioned way an approval comes into being.
 */

import fs from "node:fs";
import readline from "node:readline/promises";
import { renderReport } from "./report";
import { approveDraft, reviewFile } from "./workflow";

function parseArgs(argv: string[]) {
  const args = {
    command: "",
    file: "",
    script: "",
    by: "",
    out: "approved",
    yes: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--script") args.script = argv[++i] ?? "";
    else if (arg === "--by") args.by = argv[++i] ?? "";
    else if (arg === "--out") args.out = argv[++i] ?? "approved";
    else if (arg === "--yes") args.yes = true;
    else rest.push(arg);
  }
  args.command = rest[0] ?? "";
  args.file = rest[1] ?? "";
  return args;
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npm run review -- report <bible.json> [--script <file>]",
      "  npm run review -- approve <draft.bible.json> --by <reviewer>",
      "                    [--script <file>] [--out approved] [--yes]",
    ].join("\n"),
  );
  process.exit(2);
}

export async function runReviewCli(argv: string[]) {
  const args = parseArgs(argv);
  if (!args.file) usage();
  const scriptText = args.script
    ? fs.readFileSync(args.script, "utf8")
    : undefined;

  if (args.command === "report") {
    const report = reviewFile(args.file, scriptText);
    console.log(renderReport(report));
    process.exit(report.ok ? 0 : 1);
  }

  if (args.command === "approve") {
    if (!args.by) {
      console.error("approve requires --by <reviewer name>");
      process.exit(2);
    }

    const report = reviewFile(args.file, scriptText);
    console.log(renderReport(report));

    if (!report.ok) {
      console.error(
        "Cannot approve: the draft has validation errors (listed above). " +
          "Regenerate or fix the draft, then review again.",
      );
      process.exit(1);
    }

    if (!args.yes) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await rl.question(
        `\nYou are approving "${report.bible?.title}" (${report.bible?.id}) as ` +
          `${JSON.stringify(args.by)}.\nThe compiler will treat the exact bytes ` +
          `above as the reviewed truth. Type "yes" to approve: `,
      );
      rl.close();
      if (answer.trim().toLowerCase() !== "yes") {
        console.error("Not approved. No artifacts written.");
        process.exit(1);
      }
    }

    const result = approveDraft({
      draftPath: args.file,
      approvedDir: args.out,
      reviewer: args.by,
      approvedAt: new Date().toISOString(),
      scriptText,
    });

    console.log(`\nApproved.`);
    console.log(`  Bible:    ${result.biblePath}`);
    console.log(`  Approval: ${result.approvalPath}`);
    console.log(`  Hash:     ${result.approval.bibleHash}`);
    console.log(
      `\nThe pair is now accepted by compileApprovedBible. Any edit to the ` +
        `approved Bible invalidates the approval — changes go through a new draft.`,
    );
    return;
  }

  usage();
}

if (require.main === module) {
  runReviewCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
