/**
 * The Claude Author (M12): raw script in, DRAFT Production Bible out.
 *
 * This is the deliberately non-deterministic leaf of the system — the only
 * component allowed to call an LLM, read the clock, or touch the network.
 * The dependency arrow points strictly one way: this tool imports the
 * deterministic modules (schema, validator, compiler) to lint its drafts;
 * nothing in src/ knows it exists.
 *
 * What it does NOT do: approve. Every artifact it writes is a draft the
 * M7 gate will refuse until a human reviews it and creates an approval
 * (workflow tooling arrives with M13). The compiler's trust boundary is
 * unchanged by this tool's existence — that is the point of it.
 *
 * Usage:
 *   npm run author -- <script-file> [--id <bible-id>] [--title <title>]
 *                     [--out <dir>] [--dry-run]
 *
 * Auth: standard Anthropic SDK resolution (ANTHROPIC_API_KEY, or an
 * `ant auth login` profile). --dry-run assembles and prints the prompt
 * without calling the API.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { ASSET_KINDS, getCapabilities } from "../src/assets";
import type { Bible } from "../src/bible/schema";
import { showcaseBible } from "../src/bible/showcase";
import { parseBible } from "../src/bible/validate";
import { compileBible } from "../src/compiler";
import { createDefaultRecipeRegistry, defaultRecipes } from "../src/recipes";

const MODEL = "claude-opus-4-8";
const MAX_ATTEMPTS = 3;
const PROMPTS_DIR = path.join(__dirname, "prompts");

// ---------------------------------------------------------------------------
// Prompt assembly. The static prose lives in prompts/*.md; everything that
// must track the codebase — the recipe table, the asset vocabulary, the
// worked example — is generated here from the live source of truth, so the
// prompt cannot drift from the library as it grows.
// ---------------------------------------------------------------------------

function prompt(name: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, name), "utf8");
}

function vocabularySection(): string {
  const recipeRows = defaultRecipes.map(
    (r) =>
      `| \`${r.name}\` | ${
        r.requiredCapabilities.length > 0
          ? r.requiredCapabilities.map((c) => `\`${c}\``).join(", ")
          : "none"
      } | ${r.minDurationInFrames} |`,
  );
  const kindRows = ASSET_KINDS.map(
    (kind) =>
      `| \`${kind}\` | ${getCapabilities(kind)
        .map((c) => `\`${c}\``)
        .join(", ")} |`,
  );
  return [
    "# Current vocabulary (generated from the live code — authoritative)",
    "",
    "## Recipes",
    "",
    "A recipe may only be bound to an asset whose capabilities include every",
    "capability the recipe requires. The beat's duration must be at least the",
    "recipe's minimum.",
    "",
    "| Recipe | Requires capabilities | Min frames |",
    "|---|---|---|",
    ...recipeRows,
    "",
    "## Asset kinds and their capabilities",
    "",
    "| Kind | Capabilities |",
    "|---|---|",
    ...kindRows,
  ].join("\n");
}

function exampleSection(): string {
  return [
    "# Worked example (generated from a real, approved fixture)",
    "",
    "Given this script:",
    "",
    "```",
    showcaseBible.sourceScript,
    "```",
    "",
    "…a good draft Bible looks like this (note the pacing, the layered",
    "staging in scene one, and the scene boundaries doing the stage-clearing):",
    "",
    "```json",
    JSON.stringify(showcaseBible, null, 2),
    "```",
  ].join("\n");
}

function taskSection(script: string, id: string, title: string): string {
  return [
    "# Your task",
    "",
    `Draft a Production Bible for the script below. Use exactly:`,
    `- id: ${JSON.stringify(id)}`,
    `- title: ${JSON.stringify(title)}`,
    `- createdAt: ${JSON.stringify(new Date().toISOString())}`,
    "",
    "No image, video, or audio files are available for this video — use only",
    "self-contained asset kinds (text, caption, chart, icon).",
    "",
    "## Script",
    "",
    "```",
    script,
    "```",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Draft-and-repair loop. The deterministic validators are the sole
// authority on what a valid Bible is: parseBible (the same strict Zod parse
// the compiler's gate runs) checks shape, then compileBible lints the
// bindings, durations, continuity, and scene grammar. Their error messages
// — written for humans — feed up to two self-repair turns.
// ---------------------------------------------------------------------------

/** Pull the JSON document out of a response that may wrap it in a fence. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The response contained no JSON object.");
  }
  return text.slice(start, end + 1);
}

async function draftBible(userPrompt: string): Promise<Bible> {
  const client = new Anthropic();
  const system = prompt("system.md");
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.error(`Drafting (attempt ${attempt}/${MAX_ATTEMPTS})…`);
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      system,
      messages,
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === "refusal") {
      throw new Error("The model declined this request (stop_reason: refusal).");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("The draft was truncated (stop_reason: max_tokens).");
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    let problem: string;
    try {
      const bible = parseBible(JSON.parse(extractJson(text)));
      // The compiler as draft lint: binding, capability, duration,
      // continuity, and scene-grammar errors surface here, before any
      // human spends review time on the draft.
      compileBible(bible, createDefaultRecipeRegistry());
      return bible;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }

    console.error(`  Draft failed validation: ${problem.split("\n")[0]}`);
    messages.push(
      { role: "assistant", content: response.content },
      {
        role: "user",
        content:
          `That draft failed the deterministic validators:\n\n${problem}\n\n` +
          `Produce a corrected, complete Bible that fixes this. Change only ` +
          `what the error requires. Output only the JSON document.`,
      },
    );
  }

  throw new Error(
    `No valid draft after ${MAX_ATTEMPTS} attempts. The last validator error is above.`,
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

function parseArgs(argv: string[]) {
  const args = { script: "", id: "", title: "", out: "drafts", dryRun: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--id") args.id = argv[++i] ?? "";
    else if (arg === "--title") args.title = argv[++i] ?? "";
    else if (arg === "--out") args.out = argv[++i] ?? "drafts";
    else if (arg === "--dry-run") args.dryRun = true;
    else rest.push(arg);
  }
  args.script = rest[0] ?? "";
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.script) {
    console.error(
      "Usage: npm run author -- <script-file> [--id <id>] [--title <title>] [--out <dir>] [--dry-run]",
    );
    process.exit(2);
  }

  const script = fs.readFileSync(args.script, "utf8").trim();
  const baseName = path.basename(args.script).replace(/\.[^.]*$/, "");
  const id = args.id || slugify(baseName);
  const title = args.title || baseName;

  const userPrompt = [
    prompt("bible-schema.md"),
    prompt("authoring-guide.md"),
    vocabularySection(),
    exampleSection(),
    taskSection(script, id, title),
  ].join("\n\n---\n\n");

  if (args.dryRun) {
    console.log(prompt("system.md"));
    console.log("\n========== USER PROMPT ==========\n");
    console.log(userPrompt);
    return;
  }

  const bible = await draftBible(userPrompt);

  fs.mkdirSync(args.out, { recursive: true });
  const outPath = path.join(args.out, `${bible.id}.bible.json`);
  fs.writeFileSync(outPath, JSON.stringify(bible, null, 2) + "\n");

  const totalFrames = bible.scenes
    .flatMap((s) => s.beats)
    .reduce((sum, b) => sum + b.durationInFrames, 0);

  console.log(`\nDraft written: ${outPath}`);
  console.log(
    `  ${bible.scenes.length} scene(s), ` +
      `${bible.scenes.reduce((n, s) => n + s.beats.length, 0)} beat(s), ` +
      `${(totalFrames / bible.fps).toFixed(1)}s at ${bible.fps} fps`,
  );
  console.log(`
┌─────────────────────────────────────────────────────────────────┐
│  THIS IS AN UNREVIEWED DRAFT.                                   │
│                                                                 │
│  The compiler will refuse it: rendering requires an approval    │
│  record whose hash matches the reviewed document (M7).          │
│                                                                 │
│  Next steps:                                                    │
│    1. Read the draft — narration pacing, bindings vs.           │
│       visualIntent, layout, chart data vs. the script.          │
│    2. Edit as needed.                                           │
│    3. Approve the exact reviewed bytes (review workflow: M13).  │
└─────────────────────────────────────────────────────────────────┘`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
