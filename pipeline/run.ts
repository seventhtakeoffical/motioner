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
import { compileApprovedBible } from "../src/compiler";
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

function withPropsFile<T>(plan: RenderPlan, fn: (propsPath: string) => T): T {
  const propsPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "motioner-props-")),
    "props.json",
  );
  try {
    fs.writeFileSync(propsPath, JSON.stringify({ plan }));
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
  console.log(
    `Plan compiled — opening Studio with the approved plan as input props.`,
  );
  withPropsFile(plan, (propsPath) => {
    runRemotion(["studio", `--props=${propsPath}`]);
  });
}
