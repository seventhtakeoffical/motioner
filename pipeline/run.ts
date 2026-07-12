/**
 * Pipeline render/preview operations (M14).
 *
 * The division of labor the architecture demands, made literal:
 *   - THIS module owns all filesystem access and process spawning.
 *   - compileApprovedBible (pure) is the only way a plan comes into being —
 *     so rendering structurally cannot accept a draft: without an approval
 *     whose hash matches the exact Bible bytes, there is no plan to render.
 *   - Both Studio preview and headless rendering consume the SAME compiled
 *     plan through the SAME composition (PipelineVideo + RenderPlanVideo),
 *     fed via --props: exactly one rendering path.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256 } from "../asset-pipeline/framework";
import { parseBible } from "../src/bible/validate";
import { compileApprovedBible, compileBible } from "../src/compiler";
import { createDefaultRecipeRegistry } from "../src/recipes";
import type { RenderPlan } from "../src/render-plan";

/** Read + parse a JSON file with errors that say which stage failed. */
export function readJson(filePath: string, what: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new Error(
      `Cannot read the ${what} file "${filePath}" — check the path exists.`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `The ${what} file "${filePath}" is not valid JSON: ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
}

/**
 * Approved Bible + approval, from disk, through the M7 gate, to a plan.
 * Every failure mode arrives with the gate's own message (invalid schema,
 * invalid approval, edited-after-approval) prefixed by the render stage.
 */
export function compilePlanFromFiles(
  biblePath: string,
  approvalPath: string,
): RenderPlan {
  const bible = readJson(biblePath, "Bible");
  const approval = readJson(approvalPath, "approval");
  try {
    return compileApprovedBible(bible, approval, createDefaultRecipeRegistry());
  } catch (error) {
    throw new Error(
      `Refusing to render. ${error instanceof Error ? error.message : error}\n` +
        `Only an approved Bible renders: review the draft ` +
        `(pipeline review), approve it (pipeline approve), and render the ` +
        `approved pair from the approved/ directory.`,
    );
  }
}

/**
 * Draft Bible → plan, through the PURE compiler core — deliberately NOT the
 * gate, and deliberately NOT reachable from the render command. Sighted
 * review (M15): a reviewer must be able to SEE a draft before approving it.
 * The resulting preview carries a burned-in DRAFT watermark.
 */
export function compileDraftPlan(biblePath: string): RenderPlan {
  const bible = parseBible(readJson(biblePath, "draft Bible"));
  return compileBible(bible, createDefaultRecipeRegistry());
}

/**
 * Preflight (production audit SHOULD-FIX #1): verify every media asset the
 * plan will load BEFORE spawning Remotion, so failures are clear, early
 * errors instead of delayRender timeouts deep inside a render — and so an
 * approved Bible whose asset files drifted since generation is caught
 * loudly (the approval hash covers the spec; this check covers the pixels).
 *
 * Rules per manifest src:
 *  - remote URLs are skipped (the renderer fetches those itself);
 *  - the file must exist under public/;
 *  - if a canonical provenance manifest sits beside the asset, the file's
 *    sha256 must match its recorded canonicalSha256 — a mismatch means the
 *    asset changed after generation.
 */
export function preflightPlanAssets(
  plan: RenderPlan,
  publicDir = "public",
): void {
  const problems: string[] = [];
  const manifestCache = new Map<string, Map<string, string>>(); // dir -> src -> sha

  const canonicalShaFor = (src: string): string | undefined => {
    const dir = path.dirname(src);
    let entries = manifestCache.get(dir);
    if (!entries) {
      entries = new Map();
      const manifestPath = path.join(publicDir, dir, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        let parsed: Array<{ src?: string; canonicalSha256?: string }>;
        try {
          parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        } catch (error) {
          throw new Error(
            `Provenance manifest "${manifestPath}" is corrupted and cannot ` +
              `be parsed (${error instanceof Error ? error.message : error}). ` +
              `Restore it from git before rendering.`,
          );
        }
        for (const entry of parsed) {
          if (entry.src && entry.canonicalSha256) {
            entries.set(entry.src, entry.canonicalSha256);
          }
        }
      }
      manifestCache.set(dir, entries);
    }
    return entries.get(src);
  };

  for (const item of plan.manifest) {
    if (item.src.startsWith("http://") || item.src.startsWith("https://")) {
      continue;
    }
    const file = path.join(publicDir, item.src);
    if (!fs.existsSync(file)) {
      problems.push(
        `MISSING: "${item.src}" (${item.kind}) — generate it ` +
          `(pipeline generate) or place the file under ${publicDir}/.`,
      );
      continue;
    }
    const expected = canonicalShaFor(item.src);
    if (expected) {
      const actual = sha256(fs.readFileSync(file));
      if (actual !== expected) {
        problems.push(
          `DRIFTED: "${item.src}" — file hash ${actual.slice(0, 12)}… does not ` +
            `match its provenance (${expected.slice(0, 12)}…). The asset ` +
            `changed after generation: regenerate it or restore it from git.`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Asset preflight failed — refusing to render:\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
}

function withPropsFile<T>(
  plan: RenderPlan,
  fn: (propsPath: string) => T,
  draft = false,
): T {
  const propsPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "motioner-props-")),
    "props.json",
  );
  try {
    fs.writeFileSync(propsPath, JSON.stringify({ plan, draft }));
    return fn(propsPath);
  } finally {
    fs.rmSync(path.dirname(propsPath), { recursive: true, force: true });
  }
}

function runRemotion(args: string[]): void {
  const result = spawnSync("npx", ["remotion", ...args], {
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`Failed to launch Remotion: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Remotion exited with status ${result.status}. The plan compiled — ` +
        `this is a rendering-stage failure; see Remotion's output above.`,
    );
  }
}

export interface RenderOptions {
  biblePath: string;
  approvalPath: string;
  outPath?: string;
  /** Optional frame subrange, e.g. "0-90" — handy for quick smoke renders. */
  frames?: string;
}

export function renderVideo(options: RenderOptions): string {
  const plan = compilePlanFromFiles(options.biblePath, options.approvalPath);
  preflightPlanAssets(plan);
  const outPath =
    options.outPath ??
    path.join("out", `${path.basename(options.biblePath, ".bible.json")}.mp4`);

  console.log(
    `Plan compiled: ${(plan.totalDurationInFrames / plan.fps).toFixed(1)}s, ` +
      `${plan.scenes.length} scene(s), ${plan.beats.length} beat(s), ` +
      `${plan.width}x${plan.height}@${plan.fps}fps` +
      (plan.manifest.length > 0
        ? `, ${plan.manifest.length} media file(s): ${plan.manifest
            .map((m) => m.src)
            .join(", ")}`
        : ""),
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  withPropsFile(plan, (propsPath) => {
    runRemotion([
      "render",
      "PipelineVideo",
      outPath,
      `--props=${propsPath}`,
      ...(options.frames ? [`--frames=${options.frames}`] : []),
    ]);
  });
  return outPath;
}

export function previewInStudio(biblePath: string, approvalPath: string): void {
  const plan = compilePlanFromFiles(biblePath, approvalPath);
  preflightPlanAssets(plan);
  console.log(
    `Plan compiled — opening Studio with the approved plan as input props.`,
  );
  withPropsFile(plan, (propsPath) => {
    runRemotion(["studio", `--props=${propsPath}`]);
  });
}

export function previewDraftInStudio(biblePath: string): void {
  const plan = compileDraftPlan(biblePath);
  preflightPlanAssets(plan);
  console.log(
    `DRAFT plan compiled — opening Studio with a watermarked draft preview.\n` +
      `This preview proves nothing about approval: rendering still requires ` +
      `the approved pair.`,
  );
  withPropsFile(
    plan,
    (propsPath) => {
      runRemotion(["studio", `--props=${propsPath}`]);
    },
    true,
  );
}
