/**
 * The asset generation orchestrator (M16).
 *
 * Consumes a Bible (the specification), finds every image asset carrying a
 * generationBrief, and satisfies the spec: generates the missing files into
 * public/<src> via a capability-matched provider, atomically, with retries,
 * provenance, and a report. Provider-agnostic by construction — everything
 * backend-specific lives behind the AssetProvider contract.
 *
 * Guarantees this tool does NOT touch: the Bible is never modified (the
 * approval hash cannot move); the compiler and renderer never see this
 * code; generated files are static input artifacts, committed to git like
 * approved Bibles. Generation itself is not deterministic and doesn't
 * claim to be — but skip-if-exists freezes each artifact once produced, so
 * renders stay byte-stable until a human deliberately --force regenerates.
 */

import fs from "node:fs";
import path from "node:path";
import { parseApproval, verifyApproval } from "../src/bible/approval";
import type { Bible } from "../src/bible/schema";
import { parseBible } from "../src/bible/validate";
import { findSiblingApproval, loadJson } from "../review/workflow";
import {
  deterministicSeed,
  fnv32,
  ProviderError,
  type AssetProvider,
  type GeneratedAsset,
  type GenerationRequest,
} from "./provider";
import { selectProvider } from "./registry";

export const GENERATOR_VERSION = "1.0.0";
const MAX_ATTEMPTS = 3;
const ASPECT_TOLERANCE = 0.05;

export interface GenerateOptions {
  biblePath: string;
  /** Explicitly acknowledge generating from an unapproved draft. */
  draft?: boolean;
  /** Provider name; otherwise ASSET_PROVIDER env or first configured. */
  provider?: string;
  /** Regenerate even when the file already exists. */
  force?: boolean;
  /** Root the Bible's src paths resolve under. */
  publicDir?: string;
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
  /** The point of the tool: does every requested asset now exist on disk? */
  satisfied: boolean;
}

interface ProvenanceEntry {
  src: string;
  assetId: string;
  provider: string;
  model: string;
  seed: number;
  briefHash: string;
  generatorVersion: string;
  promptTemplateVersion: string;
  /** Whether the Bible was approved when this file was generated. */
  source: "draft" | "approved";
  format: string;
  generatedAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read pixel dimensions from PNG/JPEG headers (enough for aspect checks). */
export function imageDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: 8-byte signature, IHDR width/height at offsets 16/20.
  if (buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  // JPEG: scan segments for a SOFn marker.
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) return undefined;
      const marker = buffer[offset + 1];
      const size = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + size;
    }
  }
  return undefined;
}

/** Reject empty output and aspect ratios that would distort in the frame. */
function validateAsset(
  asset: GeneratedAsset,
  request: GenerationRequest,
): string | null {
  if (asset.bytes.length === 0) return "provider returned zero bytes";
  const dims = imageDimensions(asset.bytes);
  if (dims) {
    const want = request.width / request.height;
    const got = dims.width / dims.height;
    if (Math.abs(got / want - 1) > ASPECT_TOLERANCE) {
      return (
        `aspect ratio mismatch: Bible declares ${request.width}x${request.height} ` +
        `(${want.toFixed(2)}), provider produced ${dims.width}x${dims.height} ` +
        `(${got.toFixed(2)}) — the renderer would distort it`
      );
    }
  }
  return null;
}

function writeAtomically(target: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, target);
}

function updateManifest(
  publicDir: string,
  bibleId: string,
  entry: ProvenanceEntry,
): void {
  const manifestPath = path.join(publicDir, "generated", bibleId, "manifest.json");
  let entries: ProvenanceEntry[] = [];
  if (fs.existsSync(manifestPath)) {
    try {
      entries = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      entries = [];
    }
  }
  entries = entries.filter((existing) => existing.src !== entry.src);
  entries.push(entry);
  entries.sort((a, b) => (a.src < b.src ? -1 : 1));
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(entries, null, 2) + "\n");
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

  for (const asset of requested) {
    const target = path.resolve(publicDir, asset.src);
    // The src comes from a reviewed document, but a path that escapes
    // public/ must still never be written.
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

    if (fs.existsSync(target) && !options.force) {
      report.items.push({
        assetId: asset.id,
        src: asset.src,
        status: "skipped",
        detail: "already exists (use --force to regenerate)",
        attempts: 0,
      });
      continue;
    }

    provider ??= selectProvider("image", options.provider);
    report.providerName = provider.name;

    const request: GenerationRequest = {
      kind: "image",
      brief: asset.generationBrief as string,
      width: asset.intrinsicWidth,
      height: asset.intrinsicHeight,
      assetId: asset.id,
      bibleId: bible.id,
      seed: deterministicSeed(bible.id, asset.id, asset.generationBrief as string),
    };
    const prompt = provider.promptTemplate.build(request);

    let attempts = 0;
    let outcome: ItemResult | undefined;
    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      try {
        const generated = await provider.generate(request, prompt);
        const invalid = validateAsset(generated, request);
        if (invalid) {
          outcome = {
            assetId: asset.id,
            src: asset.src,
            status: "failed",
            detail: invalid,
            attempts,
          };
          break;
        }
        writeAtomically(target, generated.bytes);
        updateManifest(publicDir, bible.id, {
          src: asset.src,
          assetId: asset.id,
          provider: provider.name,
          model: generated.model,
          seed: request.seed,
          briefHash: fnv32(request.brief).toString(16).padStart(8, "0"),
          generatorVersion: GENERATOR_VERSION,
          promptTemplateVersion: provider.promptTemplate.version,
          source,
          format: generated.format,
          generatedAt: new Date().toISOString(),
        });
        outcome = {
          assetId: asset.id,
          src: asset.src,
          status: "generated",
          detail: `${generated.model} via ${provider.name}`,
          attempts,
        };
        break;
      } catch (error) {
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
