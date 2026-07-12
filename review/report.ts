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
  /**
   * Asset Requests (M15): images this Bible declares that do not exist yet
   * — each line is the agreed src path plus the generation brief. Planning
   * output for the (future) image-generation step; the reviewer approves
   * these specs along with the rest of the document.
   */
  assetRequests: string[];
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
  /**
   * Media files that actually exist (relative paths under public/),
   * supplied by the CLI shell — this module never touches the filesystem.
   * When present, media declarations are checked against it; when absent,
   * the report falls back to "confirm this exists" phrasing.
   */
  existingMedia?: readonly string[];
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
    assetRequests: [],
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
  // Serving as a scene's world plate is usage too (Sprint A).
  for (const scene of bible.scenes) {
    if (scene.plate) featuredIds.add(scene.plate);
  }
  for (const asset of bible.assets) {
    if (!featuredIds.has(asset.id)) {
      report.warnings.push(
        `asset "${asset.id}" (${asset.kind}) is declared but never used by any beat or plate.`,
      );
    }
  }

  // ---- Missing information & asset requests ----
  for (const asset of bible.assets) {
    if (asset.kind === "image" || asset.kind === "video" || asset.kind === "audio") {
      const brief = asset.kind === "image" ? asset.generationBrief : undefined;
      if (asset.kind === "image" && asset.generationBrief) {
        report.assetRequests.push(
          `"${asset.id}" → ${asset.src} (${asset.intrinsicWidth}x${asset.intrinsicHeight}): ${asset.generationBrief}`,
        );
      }
      if (input.existingMedia === undefined) {
        report.missingInfo.push(
          `media file existence cannot be verified from the Bible alone — ` +
            `confirm "${asset.src}" exists (${asset.kind} "${asset.id}").`,
        );
      } else if (!input.existingMedia.includes(asset.src)) {
        report.missingInfo.push(
          `media file NOT on disk: "${asset.src}" (${asset.kind} "${asset.id}")` +
            (brief
              ? ` — a requested asset; generate it to its brief before rendering.`
              : ` — the file must land in public/ before rendering.`),
        );
      }
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

  addGrammarWarnings(report, bible);
  return report;
}

/**
 * Visual Grammar checks (Sprint A). Each warning cites the principle it
 * enforces. Warnings only — the human reviewer stays the judge; approval
 * never blocks on style.
 */
function addGrammarWarnings(report: ReviewReport, bible: Bible): void {
  const warn = (text: string) => report.warnings.push(`Grammar: ${text}`);

  const briefedImages = bible.assets.filter(
    (a) => a.kind === "image" && a.generationBrief !== undefined,
  );
  if (briefedImages.length > 0 && !bible.visualStyle) {
    warn(
      `no visualStyle directive — every generated asset will style itself ` +
        `independently (P13 "one wardrobe").`,
    );
  }

  const unplated = bible.scenes.filter((s) => s.plate === undefined);
  if (unplated.length > 0) {
    warn(
      `scene(s) without a world plate: ${unplated.map((s) => s.id).join(", ")} ` +
        `— every scene should exist inside a shared world (P1/P3).`,
    );
  }

  const plateIds = new Set(bible.scenes.map((s) => s.plate).filter(Boolean));
  const featuredIds = new Set(
    bible.scenes.flatMap((s) => s.beats.map((b) => b.assetId)),
  );
  for (const plateId of plateIds) {
    if (featuredIds.has(plateId as string)) {
      warn(
        `asset "${plateId}" serves as a world plate AND is featured by a ` +
          `beat — it will be generated as a plate; verify both usages read well.`,
      );
    }
  }

  for (const asset of bible.assets) {
    if (
      (asset.kind === "text" || asset.kind === "caption") &&
      asset.content.split(/\s+/).filter(Boolean).length > 8
    ) {
      warn(
        `${asset.kind} "${asset.id}" is ${asset.content.split(/\s+/).filter(Boolean).length} ` +
          `words — typography is punctuation, not prose (P9).`,
      );
    }
    // Strip negations ("no text in image") before hunting for
    // lettering-inviting content — those phrases PREVENT baked text.
    const briefWithoutNegations =
      asset.kind === "image" && asset.generationBrief
        ? asset.generationBrief.replace(
            /\b(?:no|without|avoid(?:ing)?)\s+(?:any\s+)?(?:readable\s+)?(?:text|words?|letters?|labels?|signs?|logos?|captions?|writing|typography|numbers?)\b/gi,
            "",
          )
        : "";
    if (
      asset.kind === "image" &&
      asset.generationBrief &&
      /\b(text|word|letter|label|sign|logo|caption|writing|typography|number)s?\b/i.test(
        briefWithoutNegations,
      )
    ) {
      warn(
        `brief for "${asset.id}" mentions lettering-like content — image ` +
          `models write gibberish; text belongs to typography (P13).`,
      );
    }
  }

  const plan = report.plan;
  if (!plan) return;

  // ≤7 simultaneous inhabitants (P14). Plates are the world, not objects.
  for (const window of plan.beats) {
    const inhabitants = window.layers.filter((l) => l.role !== "plate");
    if (inhabitants.length > 7) {
      warn(
        `${window.id} has ${inhabitants.length} simultaneous elements — ` +
          `more than ~7 reads as clutter (P14).`,
      );
      break;
    }
  }

  // Persistent hero (P4): some non-plate entity should live ≥3 windows.
  if (plan.beats.length >= 4) {
    const residency = new Map<string, number>();
    for (const window of plan.beats) {
      for (const layer of window.layers) {
        if (layer.role === "enter" || layer.role === "hold") {
          residency.set(layer.entityId, (residency.get(layer.entityId) ?? 0) + 1);
        }
      }
    }
    if (![...residency.values()].some((n) => n >= 3)) {
      warn(
        `no persistent hero — nothing stays on stage longer than two beats; ` +
          `persistence is the default, disappearance needs a reason (P4).`,
      );
    }
  }

  // Full-frame as punctuation (P10): non-plate imagery covering ~the whole
  // frame should be rare. Coverage is pure arithmetic on the plan.
  let fullFrameFrames = 0;
  for (const window of plan.beats) {
    const covered = window.layers.some((layer) => {
      if (layer.role === "plate" || layer.asset.kind !== "image") return false;
      const w = (layer.asset.intrinsicWidth * layer.placement.scale) / plan.width;
      const h = (layer.asset.intrinsicHeight * layer.placement.scale) / plan.height;
      return Math.min(1, w) * Math.min(1, h) >= 0.85;
    });
    if (covered) fullFrameFrames += window.durationInFrames;
  }
  const share = fullFrameFrames / plan.totalDurationInFrames;
  if (share > 0.2) {
    warn(
      `full-frame imagery covers ${(share * 100).toFixed(0)}% of the runtime — ` +
        `a full frame is a held breath, not the default shot (P10).`,
    );
  }
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
  out.push(section("Asset requests (to be generated)", report.assetRequests));

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
