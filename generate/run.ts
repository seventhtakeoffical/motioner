/**
 * The asset generation orchestrator.
 *
 * Since the Asset Pipeline (stable architecture): providers produce RAW
 * imagery only; every raw is archived write-once under assets/raw/ with
 * its own provenance, then canonicalized by the Asset Pipeline into the
 * production asset that lands in public/ — transparent, trimmed, padded,
 * centered, exactly the Bible-declared dimensions, visually identical
 * regardless of provider. The renderer's world is canonical-only.
 *
 * Failure ownership: provider errors retry with backoff (as ever);
 * canonicalization failures are CLASSIFIED (no-subject, multi-object,
 * subject-cropped, environment-not-object…) and earn one full
 * regeneration — a fresh raw — before landing in the report for a human.
 *
 * The Bible is never modified; the approval boundary never moves;
 * generation remains honestly non-deterministic while every artifact it
 * freezes is hash-chained: brief → raw → canonical.
 */

import fs from "node:fs";
import path from "node:path";
import {
  canonicalize,
  ClassifiedFailure,
  type CanonicalizeResult,
  type RuntimeVersions,
} from "../asset-pipeline/pipelines";
import { sha256 } from "../asset-pipeline/framework";
import { parseApproval, verifyApproval } from "../src/bible/approval";
import type { Bible } from "../src/bible/schema";
import { parseBible } from "../src/bible/validate";
import { findSiblingApproval, loadJson } from "../review/workflow";
import {
  deterministicSeed,
  ProviderError,
  type AssetProvider,
  type GenerationForm,
  type GenerationRequest,
} from "./provider";
import { selectProvider } from "./registry";

export const GENERATOR_VERSION = "2.0.0"; // 2.x: raw archive + Asset Pipeline
const MAX_ATTEMPTS = 3;
/** One extra full regeneration when the raw is classified unusable. */
const MAX_REGENERATIONS = 1;

export interface GenerateOptions {
  biblePath: string;
  /** Explicitly acknowledge generating from an unapproved draft. */
  draft?: boolean;
  /** Provider name; otherwise ASSET_PROVIDER env or first configured. */
  provider?: string;
  /** Regenerate even when the canonical asset already exists. */
  force?: boolean;
  /** Root the Bible's src paths resolve under (canonical assets). */
  publicDir?: string;
  /** Root of the write-once raw archive. */
  rawDir?: string;
  /** Backoff base for retryable failures (tests pass 0). */
  backoffMs?: number;
}

export interface ItemResult {
  assetId: string;
  src: string;
  status: "generated" | "skipped" | "failed";
  detail: string;
  attempts: number;
}

export interface GenerateReport {
  bibleId: string;
  source: "draft" | "approved";
  providerName?: string;
  items: ItemResult[];
  /** Does every requested asset now exist canonically on disk? */
  satisfied: boolean;
}

/** Raw provenance: what the provider made. Lives in assets/raw/. */
interface RawProvenanceEntry {
  assetId: string;
  rawPath: string;
  src: string;
  provider: string;
  model: string;
  form: GenerationForm;
  targetWidth: number;
  targetHeight: number;
  seed: number;
  briefSha256: string;
  promptTemplateVersion: string;
  generatorVersion: string;
  source: "draft" | "approved";
  generatedAt: string;
  rawSha256: string;
}

/** Canonical provenance: how Motioner productionized it. Lives in public/. */
interface CanonicalProvenanceEntry {
  src: string;
  assetId: string;
  rawSha256: string;
  pipeline: string;
  fingerprint: string;
  chain: CanonicalizeResult["chain"];
  form: GenerationForm;
  source: "draft" | "approved";
  canonicalSha256: string;
  normalizedAt: string;
  /** Library stack that produced the canonical bytes (optional: absent in
   * pre-audit manifests — readers must not require it). */
  runtime?: RuntimeVersions;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeAtomically(target: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, target);
}

function updateManifest<T extends object>(
  manifestPath: string,
  entry: T,
  key: keyof T,
): void {
  let entries: T[] = [];
  if (fs.existsSync(manifestPath)) {
    // A manifest that exists but does not parse is corrupted provenance.
    // That must be a loud, run-stopping error — silently starting from an
    // empty array would erase the provenance of every other asset on the
    // next write.
    try {
      entries = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Manifest "${manifestPath}" is corrupted and cannot be parsed ` +
          `(${error instanceof Error ? error.message : error}). Refusing to ` +
          `overwrite provenance — restore it from git before regenerating.`,
      );
    }
  }
  entries = entries.filter((existing) => existing[key] !== entry[key]);
  entries.push(entry);
  entries.sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1));
  // Atomic like the assets themselves: a crash mid-write must never leave
  // a half-written manifest behind.
  writeAtomically(
    manifestPath,
    Buffer.from(JSON.stringify(entries, null, 2) + "\n"),
  );
}

/** Resolve the Bible + how trusted it is (approved pair vs explicit draft). */
function loadSpec(options: GenerateOptions): {
  bible: Bible;
  source: "draft" | "approved";
} {
  const bible = parseBible(loadJson(options.biblePath));
  const approvalPath = findSiblingApproval(options.biblePath);
  if (approvalPath) {
    const approval = parseApproval(loadJson(approvalPath));
    verifyApproval(bible, approval); // stale approval = hard error
    return { bible, source: "approved" };
  }
  if (options.draft) {
    return { bible, source: "draft" };
  }
  throw new Error(
    `No approval found next to "${options.biblePath}". Generating spends ` +
      `money on the Bible's briefs — either approve it first, or acknowledge ` +
      `the draft explicitly with --draft.`,
  );
}

export async function runGeneration(
  options: GenerateOptions,
  injectedProvider?: AssetProvider,
): Promise<GenerateReport> {
  const publicDir = options.publicDir ?? "public";
  const rawDir = options.rawDir ?? path.join("assets", "raw");
  const backoffMs = options.backoffMs ?? 1500;
  const { bible, source } = loadSpec(options);

  const requested = bible.assets.filter(
    (asset): asset is Extract<Bible["assets"][number], { kind: "image" }> =>
      asset.kind === "image" && asset.generationBrief !== undefined,
  );

  const report: GenerateReport = {
    bibleId: bible.id,
    source,
    items: [],
    satisfied: true,
  };
  if (requested.length === 0) {
    return report;
  }

  const publicRoot = path.resolve(publicDir);
  let provider: AssetProvider | undefined = injectedProvider;

  // Deterministic form derivation: an image referenced by any scene's
  // `plate` field is generated AS a plate; every other briefed image is a
  // composable object. Pure interpretation of the Bible.
  const plateAssetIds = new Set(
    bible.scenes.map((scene) => scene.plate).filter(Boolean),
  );

  // Raw provenance for staleness checks: a canonical asset may only be
  // skipped when the spec that produced it is unchanged. Without this, an
  // edited brief would silently keep the old image — spec and asset
  // diverging with no warning.
  const rawManifestPath = path.join(rawDir, bible.id, "manifest.json");
  let rawEntries: RawProvenanceEntry[] = [];
  if (fs.existsSync(rawManifestPath)) {
    try {
      rawEntries = JSON.parse(fs.readFileSync(rawManifestPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Raw manifest "${rawManifestPath}" is corrupted and cannot be parsed ` +
          `(${error instanceof Error ? error.message : error}). Refusing to ` +
          `continue — restore it from git before regenerating.`,
      );
    }
  }
  const staleness = (
    asset: Extract<Bible["assets"][number], { kind: "image" }>,
    form: GenerationForm,
  ): string | null => {
    const previous = rawEntries.find((entry) => entry.assetId === asset.id);
    if (!previous) return null; // pre-archive asset: nothing to compare
    if (previous.briefSha256 !== sha256(asset.generationBrief as string)) {
      return "generationBrief changed since the asset was generated";
    }
    if (previous.form !== form) {
      return `usage changed: was generated as a ${previous.form}, now used as a ${form}`;
    }
    if (
      previous.targetWidth !== asset.intrinsicWidth ||
      previous.targetHeight !== asset.intrinsicHeight
    ) {
      return "declared dimensions changed since the asset was generated";
    }
    return null;
  };

  for (const asset of requested) {
    const target = path.resolve(publicDir, asset.src);
    if (!target.startsWith(publicRoot + path.sep)) {
      report.items.push({
        assetId: asset.id,
        src: asset.src,
        status: "failed",
        detail: `src escapes the public directory — refusing to write "${asset.src}"`,
        attempts: 0,
      });
      continue;
    }

    const form: GenerationForm = plateAssetIds.has(asset.id) ? "plate" : "object";
    const stale = staleness(asset, form);
    if (fs.existsSync(target) && !options.force && !stale) {
      report.items.push({
        assetId: asset.id,
        src: asset.src,
        status: "skipped",
        detail: "canonical asset already exists and its spec is unchanged",
        attempts: 0,
      });
      continue;
    }

    provider ??= selectProvider("image", options.provider);
    report.providerName = provider.name;

    const request: GenerationRequest = {
      kind: "image",
      form,
      brief: asset.generationBrief as string,
      styleDirective: bible.visualStyle,
      width: asset.intrinsicWidth,
      height: asset.intrinsicHeight,
      assetId: asset.id,
      bibleId: bible.id,
      seed: deterministicSeed(bible.id, asset.id, asset.generationBrief as string),
    };
    const prompt = provider.promptTemplate.build(request);

    let attempts = 0;
    let regenerations = 0;
    let outcome: ItemResult | undefined;
    while (attempts < MAX_ATTEMPTS + MAX_REGENERATIONS) {
      attempts += 1;
      try {
        const generated = await provider.generate(request, prompt);
        const rawBytes = Buffer.from(generated.bytes);
        const rawSha = sha256(rawBytes);

        // ---- Raw archive: write-once, hash-named, never overwritten ----
        const rawName = `${asset.id}-${rawSha.slice(0, 8)}.${generated.format}`;
        const rawTarget = path.join(rawDir, bible.id, rawName);
        if (!fs.existsSync(rawTarget)) {
          writeAtomically(rawTarget, rawBytes);
        }
        updateManifest<RawProvenanceEntry>(
          path.join(rawDir, bible.id, "manifest.json"),
          {
            assetId: asset.id,
            rawPath: rawName,
            src: asset.src,
            provider: provider.name,
            model: generated.model,
            form: request.form,
            targetWidth: asset.intrinsicWidth,
            targetHeight: asset.intrinsicHeight,
            seed: request.seed,
            briefSha256: sha256(request.brief),
            promptTemplateVersion: provider.promptTemplate.version,
            generatorVersion: GENERATOR_VERSION,
            source,
            generatedAt: new Date().toISOString(),
            rawSha256: rawSha,
          },
          "assetId",
        );

        // ---- Canonicalization: the Asset Pipeline owns what lands here ----
        const canonical = await canonicalize({
          rawBytes,
          form: request.form,
          targetWidth: asset.intrinsicWidth,
          targetHeight: asset.intrinsicHeight,
        });

        writeAtomically(target, canonical.canonicalBytes);
        updateManifest<CanonicalProvenanceEntry>(
          path.join(publicDir, "generated", bible.id, "manifest.json"),
          {
            src: asset.src,
            assetId: asset.id,
            rawSha256: canonical.rawSha256,
            pipeline: canonical.pipeline,
            fingerprint: canonical.fingerprint,
            chain: canonical.chain,
            form: request.form,
            source,
            canonicalSha256: canonical.canonicalSha256,
            normalizedAt: new Date().toISOString(),
            runtime: canonical.runtime,
          },
          "src",
        );

        outcome = {
          assetId: asset.id,
          src: asset.src,
          status: "generated",
          detail:
            `${generated.model} via ${provider.name} → ${canonical.pipeline}` +
            (stale ? ` — regenerated: ${stale}` : "") +
            (canonical.warnings.length > 0
              ? ` — ${canonical.warnings.length} pipeline warning(s): ${canonical.warnings.join("; ")}`
              : ""),
          attempts,
        };
        break;
      } catch (error) {
        if (error instanceof ClassifiedFailure) {
          // The raw is archived but unusable as an asset. One fresh
          // generation may fix it; after that, a human decides.
          if (regenerations < MAX_REGENERATIONS) {
            regenerations += 1;
            continue;
          }
          outcome = {
            assetId: asset.id,
            src: asset.src,
            status: "failed",
            detail: `canonicalization: [${error.kind}] ${error.message} (raw archived for inspection)`,
            attempts,
          };
          break;
        }
        const retryable = error instanceof ProviderError && error.retryable;
        const message = error instanceof Error ? error.message : String(error);
        if (retryable && attempts < MAX_ATTEMPTS) {
          await sleep(backoffMs * 2 ** (attempts - 1));
          continue;
        }
        outcome = {
          assetId: asset.id,
          src: asset.src,
          status: "failed",
          detail: message,
          attempts,
        };
        break;
      }
    }
    report.items.push(outcome as ItemResult);
  }

  report.satisfied = requested.every((asset) =>
    fs.existsSync(path.resolve(publicDir, asset.src)),
  );
  return report;
}

export function renderGenerateReport(report: GenerateReport): string {
  const lines: string[] = [];
  lines.push("=".repeat(66));
  lines.push("ASSET GENERATION REPORT");
  lines.push(
    `Bible "${report.bibleId}" — ${report.source.toUpperCase()} specification` +
      (report.providerName ? ` — provider: ${report.providerName}` : ""),
  );
  lines.push("=".repeat(66));
  if (report.items.length === 0) {
    lines.push("This Bible requests no generated assets. Nothing to do.");
    return lines.join("\n");
  }
  for (const item of report.items) {
    lines.push(
      `  [${item.status.toUpperCase().padEnd(9)}] ${item.assetId} → ${item.src}`,
    );
    lines.push(`              ${item.detail}` + (item.attempts > 1 ? ` (${item.attempts} attempts)` : ""));
  }
  const counts = {
    generated: report.items.filter((i) => i.status === "generated").length,
    skipped: report.items.filter((i) => i.status === "skipped").length,
    failed: report.items.filter((i) => i.status === "failed").length,
  };
  lines.push("");
  lines.push(
    `${counts.generated} generated, ${counts.skipped} skipped, ${counts.failed} failed.`,
  );
  lines.push(
    report.satisfied
      ? "Specification satisfied: every requested asset exists on disk."
      : "Specification NOT satisfied: requested assets are still missing — re-run to retry failures.",
  );
  return lines.join("\n");
}
