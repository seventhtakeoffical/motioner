/**
 * Review report generation (M13) — the pure core of the review workflow.
 *
 * Given a draft Bible (as untrusted JSON), optionally the original script,
 * and optionally an approval record, produce everything a human reviewer
 * needs to judge the draft. This module is deliberately pure: no clock, no
 * filesystem, no network — the CLI shell (cli.ts/workflow.ts) supplies file
 * contents and timestamps. Validity is decided by the SAME deterministic
 * validators the compiler's gate uses (parseBible, compileBible); this
 * module never re-implements a rule, it only presents results.
 */

import {
  parseApproval,
  verifyApproval,
  type BibleApproval,
} from "../src/bible/approval";
import type { Bible } from "../src/bible/schema";
import { parseBible } from "../src/bible/validate";
import { compileBible } from "../src/compiler";
import { createDefaultRecipeRegistry } from "../src/recipes";
import type { RenderPlan } from "../src/render-plan";

// Authoring policy constants (mirrors author/prompts/authoring-guide.md):
// narration reads at ~2.5 words/second. Outside these bounds, flag it.
const WPS_FAST = 3.2; // more words than the beat can carry
const WPS_SLOW = 1.2; // beat drags (only flagged for beats with real narration)
const SLOW_MIN_WORDS = 8;

export type ApprovalStatus =
  | { status: "none" }
  | { status: "valid"; approval: BibleApproval }
  | { status: "invalid"; detail: string };

export interface ReviewReport {
  /** True when the draft passed both schema parse and compilation. */
  ok: boolean;
  errors: string[];
  warnings: string[];
  missingInfo: string[];
  /** Observable creative decisions that require human verification. */
  assumptions: string[];
  approval: ApprovalStatus;
  /** Present when the draft parsed. */
  bible?: Bible;
  /** Present when the draft compiled. */
  plan?: RenderPlan;
}

export interface ReviewInput {
  bible: unknown;
  /** The original script, when available, for fidelity checks. */
  scriptText?: string;
  /** An approval record to check against the draft, when one exists. */
  approval?: unknown;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Case-, whitespace-, and punctuation-insensitive form for fidelity checks. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildReviewReport(input: ReviewInput): ReviewReport {
  const report: ReviewReport = {
    ok: false,
    errors: [],
    warnings: [],
    missingInfo: [],
    assumptions: [],
    approval: { status: "none" },
  };

  // ---- Validation: the real gate validators, nothing else ----
  let bible: Bible;
  try {
    bible = parseBible(input.bible);
    report.bible = bible;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    report.approval = approvalStatus(undefined, input.approval);
    return report; // without a parsed Bible, nothing below is computable
  }

  try {
    report.plan = compileBible(bible, createDefaultRecipeRegistry());
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  report.ok = report.errors.length === 0;
  report.approval = approvalStatus(bible, input.approval);

  // ---- Warnings ----
  if (
    input.scriptText !== undefined &&
    input.scriptText.trim() !== bible.sourceScript.trim()
  ) {
    report.warnings.push(
      "sourceScript does not match the provided script file — the draft may " +
        "have been generated from (or edited against) different source text.",
    );
  }

  for (const scene of bible.scenes) {
    for (const beat of scene.beats) {
      const words = countWords(beat.narration);
      const seconds = beat.durationInFrames / bible.fps;
      const wps = words / seconds;
      if (wps > WPS_FAST) {
        report.warnings.push(
          `${scene.id}/${beat.id}: narration is ${words} words in ` +
            `${seconds.toFixed(1)}s (${wps.toFixed(1)} words/sec) — too fast to speak.`,
        );
      } else if (wps < WPS_SLOW && words >= SLOW_MIN_WORDS) {
        report.warnings.push(
          `${scene.id}/${beat.id}: narration is ${words} words in ` +
            `${seconds.toFixed(1)}s (${wps.toFixed(1)} words/sec) — the beat may drag.`,
        );
      }
    }
  }

  const featuredIds = new Set(
    bible.scenes.flatMap((s) => s.beats.map((b) => b.assetId)),
  );
  for (const asset of bible.assets) {
    if (!featuredIds.has(asset.id)) {
      report.warnings.push(
        `asset "${asset.id}" (${asset.kind}) is declared but never featured by any beat.`,
      );
    }
  }

  // ---- Missing information ----
  for (const asset of bible.assets) {
    if (asset.kind === "image" || asset.kind === "video" || asset.kind === "audio") {
      report.missingInfo.push(
        `media file existence cannot be verified from the Bible alone — ` +
          `confirm "${asset.src}" exists (${asset.kind} "${asset.id}").`,
      );
    }
  }

  // ---- Observable assumptions: creative decisions needing verification ----
  const script = normalize(bible.sourceScript);
  for (const asset of bible.assets) {
    if (asset.kind === "chart") {
      const points = asset.data
        .map((d) => `${d.label}=${d.value}`)
        .join(", ");
      report.assumptions.push(
        `chart "${asset.id}" embeds data values (${points}) — verify each ` +
          `against the script; the pipeline renders whatever is here.`,
      );
    } else if (asset.kind === "icon") {
      report.assumptions.push(
        `icon "${asset.id}" uses model-authored SVG geometry — check that it ` +
          `reads as intended.`,
      );
    } else if (asset.kind === "text" || asset.kind === "caption") {
      if (!script.includes(normalize(asset.content))) {
        report.assumptions.push(
          `${asset.kind} "${asset.id}" shows copy not found verbatim in the ` +
            `script: ${JSON.stringify(asset.content)}.`,
        );
      }
    }
  }
  for (const scene of bible.scenes) {
    for (const beat of scene.beats) {
      if (beat.theme) {
        report.assumptions.push(
          `${scene.id}/${beat.id} changes the theme to bg ${beat.theme.backgroundColor} / ` +
            `fg ${beat.theme.foregroundColor} — a palette decision the script may not dictate.`,
        );
      }
      if (beat.camera) {
        report.assumptions.push(
          `${scene.id}/${beat.id} cuts the camera (${JSON.stringify(beat.camera)}) — ` +
            `an emphasis decision the script may not dictate.`,
        );
      }
    }
  }

  return report;
}

function approvalStatus(
  bible: Bible | undefined,
  approvalInput: unknown,
): ApprovalStatus {
  if (approvalInput === undefined) return { status: "none" };
  try {
    const approval = parseApproval(approvalInput);
    if (!bible) {
      return {
        status: "invalid",
        detail: "an approval exists, but the Bible itself does not parse.",
      };
    }
    verifyApproval(bible, approval);
    return { status: "valid", approval };
  } catch (error) {
    return {
      status: "invalid",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Rendering: the human-readable report. Derives the scene/asset/recipe/
// continuity summaries from the parsed Bible and compiled plan.
// ---------------------------------------------------------------------------

function section(title: string, lines: string[]): string {
  const body = lines.length > 0 ? lines.map((l) => `  ${l}`).join("\n") : "  (none)";
  return `\n${title}\n${"-".repeat(title.length)}\n${body}`;
}

function assetPreview(asset: Bible["assets"][number]): string {
  switch (asset.kind) {
    case "text":
    case "caption":
      return JSON.stringify(
        asset.content.length > 60 ? `${asset.content.slice(0, 57)}…` : asset.content,
      );
    case "chart":
      return `${asset.chartType}, ${asset.data.length} data points`;
    case "icon":
      return `viewBox ${asset.viewBox}`;
    case "image":
    case "video":
    case "audio":
      return `src ${asset.src}`;
  }
}

function continuityLines(plan: RenderPlan): string[] {
  // First window of each scene: exits there are boundary strikes.
  const sceneOpenings = new Set<string>();
  const seenScenes = new Set<string>();
  for (const window of plan.beats) {
    if (!seenScenes.has(window.sceneId)) {
      seenScenes.add(window.sceneId);
      sceneOpenings.add(window.id);
    }
  }

  const lines: string[] = [];
  const segments = new Map<string, string[]>(); // entity -> segment descriptions
  const openSegment = new Map<string, { enteredAt: string; holds: number }>();

  for (const window of plan.beats) {
    for (const layer of window.layers) {
      const perEntity = segments.get(layer.entityId) ?? [];
      segments.set(layer.entityId, perEntity);
      if (layer.role === "enter") {
        const open = openSegment.get(layer.entityId);
        if (open) {
          // Re-featured: the previous segment continues (a move), not a new one.
          continue;
        }
        openSegment.set(layer.entityId, { enteredAt: window.id, holds: 0 });
      } else if (layer.role === "hold") {
        const open = openSegment.get(layer.entityId);
        if (open) open.holds += 1;
      } else {
        const open = openSegment.get(layer.entityId);
        const reason = sceneOpenings.has(window.id) ? "scene strike" : "authored exit";
        perEntity.push(
          `enters ${open?.enteredAt ?? "?"}, held ${open?.holds ?? 0} beat(s), ` +
            `exits ${window.id} (${reason})`,
        );
        openSegment.delete(layer.entityId);
      }
    }
  }
  for (const [entityId, open] of openSegment) {
    const perEntity = segments.get(entityId) ?? [];
    segments.set(entityId, perEntity);
    perEntity.push(
      `enters ${open.enteredAt}, held ${open.holds} beat(s), on stage at video end`,
    );
  }
  for (const [entityId, segs] of segments) {
    lines.push(`${entityId}: ${segs.join(" | ")}`);
  }

  // Camera and theme carry.
  for (let i = 1; i < plan.beats.length; i++) {
    const prev = plan.beats[i - 1];
    const curr = plan.beats[i];
    if (JSON.stringify(prev.camera) !== JSON.stringify(curr.camera)) {
      lines.push(
        `camera changes at ${curr.id}: zoom ${curr.camera.zoom}, ` +
          `center (${curr.camera.x}, ${curr.camera.y})`,
      );
    }
    if (JSON.stringify(prev.theme) !== JSON.stringify(curr.theme)) {
      lines.push(
        `theme changes at ${curr.id}: bg ${curr.theme.backgroundColor}, ` +
          `fg ${curr.theme.foregroundColor}`,
      );
    }
  }
  return lines;
}

export function renderReport(report: ReviewReport): string {
  const out: string[] = [];
  const { bible, plan } = report;

  out.push("=".repeat(66));
  out.push("PRODUCTION BIBLE REVIEW");
  if (bible) {
    out.push(`"${bible.title}" (${bible.id}) — drafted ${bible.createdAt}`);
  }
  out.push("=".repeat(66));

  switch (report.approval.status) {
    case "none":
      out.push("Approval: NONE — this is an unapproved draft.");
      break;
    case "valid":
      out.push(
        `Approval: VALID — approved by ${report.approval.approval.approvedBy} ` +
          `at ${report.approval.approval.approvedAt}.`,
      );
      break;
    case "invalid":
      out.push(`Approval: INVALID — ${report.approval.detail}`);
      break;
  }
  out.push(
    report.ok
      ? "Validation: PASSED (schema + compile)"
      : `Validation: FAILED — ${report.errors.length} error(s)`,
  );

  out.push(section("Errors", report.errors));
  out.push(section("Warnings", report.warnings));
  out.push(section("Missing information", report.missingInfo));
  out.push(section("Assumptions to verify", report.assumptions));

  if (bible && plan) {
    const beats = bible.scenes.reduce((n, s) => n + s.beats.length, 0);
    out.push(
      section("Estimated runtime", [
        `${(plan.totalDurationInFrames / plan.fps).toFixed(1)}s — ` +
          `${plan.totalDurationInFrames} frames @ ${plan.fps} fps, ` +
          `${plan.width}x${plan.height}, ${plan.scenes.length} scene(s), ${beats} beat(s)`,
      ]),
    );

    out.push(
      section(
        "Scene breakdown",
        plan.scenes.flatMap((scene) => {
          const bibleScene = bible.scenes.find((s) => s.id === scene.id);
          return [
            `${scene.id} — "${scene.title}" ` +
              `(${(scene.durationInFrames / plan.fps).toFixed(1)}s from frame ${scene.startFrame})`,
            ...(bibleScene?.beats.map(
              (b) =>
                `  ${b.id}: [${b.recipeName} → ${b.assetId}] ` +
                `${(b.durationInFrames / plan.fps).toFixed(1)}s — ` +
                `"${b.narration.length > 50 ? `${b.narration.slice(0, 47)}…` : b.narration}"`,
            ) ?? []),
          ];
        }),
      ),
    );

    const featureCounts = new Map<string, number>();
    for (const scene of bible.scenes) {
      for (const beat of scene.beats) {
        featureCounts.set(beat.assetId, (featureCounts.get(beat.assetId) ?? 0) + 1);
      }
    }
    out.push(
      section(
        "Assets",
        bible.assets.map(
          (a) =>
            `${a.id} (${a.kind}) — featured ${featureCounts.get(a.id) ?? 0}x — ${assetPreview(a)}`,
        ),
      ),
    );

    const recipeCounts = new Map<string, number>();
    for (const window of plan.beats) {
      for (const layer of window.layers) {
        recipeCounts.set(
          layer.recipeName,
          (recipeCounts.get(layer.recipeName) ?? 0) + 1,
        );
      }
    }
    out.push(
      section(
        "Recipe usage (layer-windows, including compiler-emitted continuity)",
        [...recipeCounts.entries()].map(([name, n]) => `${name}: ${n}`),
      ),
    );

    out.push(section("Continuity", continuityLines(plan)));
  }

  out.push("");
  return out.join("\n");
}
