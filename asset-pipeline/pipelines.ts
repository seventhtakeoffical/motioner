/**
 * The pipeline definitions and the subsystem's public entry point:
 * canonicalize(rawBytes, form, target dims) → canonical PNG + provenance
 * chain + metrics. This module knows images, not Bibles — generate/
 * translates specs into these calls.
 */

import { createRequire } from "node:module";
import sharp from "sharp";
import {
  resolvePipeline,
  runPipeline,
  sha256,
  ClassifiedFailure,
  type ParamValue,
  type PassMetrics,
  type ResolvedPipeline,
  type WorkingImage,
} from "./framework";
import {
  alphaExtract,
  coverFit,
  decode,
  keepLargestComponent,
  makeEncodePass,
  opaqueAlpha,
  padCenter,
  repairAccidentalHoles,
  trim,
} from "./passes";

export type CanonicalForm = "object" | "plate";

export interface CanonicalizeRequest {
  rawBytes: Buffer;
  form: CanonicalForm;
  targetWidth: number;
  targetHeight: number;
  /** Per-asset pass-param overrides, e.g. {"alpha-extract": {model: "isnet"}}. */
  overrides?: Readonly<Record<string, Readonly<Record<string, ParamValue>>>>;
}

/**
 * The library stack a canonical asset was produced with (audit SHOULD-FIX
 * #2). Environment metadata for provenance ONLY — it never enters the
 * pipeline fingerprint (fingerprints identify the resolved chain; runtime
 * versions identify the machine-era that executed it). When a
 * re-normalization years from now produces different bytes from the same
 * raw and the same chain, this field is what explains it.
 */
export interface RuntimeVersions {
  node: string;
  sharp: string;
  libvips: string;
  onnxruntime: string;
}

const require_ = createRequire(__filename);

function packageVersion(name: string): string {
  try {
    return (require_(`${name}/package.json`) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

let cachedRuntime: RuntimeVersions | undefined;
export function runtimeVersions(): RuntimeVersions {
  const versions = sharp.versions as { vips?: string; sharp?: string };
  cachedRuntime ??= {
    node: process.version,
    // sharp's exports map blocks require("sharp/package.json"); its own
    // versions export is the reliable source.
    sharp: versions.sharp ?? packageVersion("sharp"),
    libvips: versions.vips ?? "unknown",
    onnxruntime: packageVersion("onnxruntime-node"),
  };
  return cachedRuntime;
}

export interface CanonicalizeResult {
  canonicalBytes: Buffer;
  canonicalSha256: string;
  rawSha256: string;
  pipeline: string;
  fingerprint: string;
  chain: ResolvedPipeline["chain"];
  runtime: RuntimeVersions;
  metrics: PassMetrics[];
  warnings: string[];
}

export { ClassifiedFailure };

function buildPipeline(request: CanonicalizeRequest): ResolvedPipeline {
  const dims = {
    targetWidth: request.targetWidth,
    targetHeight: request.targetHeight,
  };
  const override = (pass: string) => request.overrides?.[pass] ?? {};

  if (request.form === "plate") {
    return resolvePipeline({
      name: "plate-v1",
      passes: [
        { pass: decode },
        { pass: coverFit, params: { ...dims, ...override("cover-fit") } },
        { pass: opaqueAlpha },
        { pass: makeEncodePass("opaque-alpha"), params: override("encode-canonical") },
      ],
    });
  }
  return resolvePipeline({
    name: "object-v1",
    passes: [
      { pass: decode },
      { pass: alphaExtract, params: override("alpha-extract") },
      { pass: keepLargestComponent, params: override("keep-largest-component") },
      { pass: repairAccidentalHoles, params: override("repair-accidental-holes") },
      { pass: trim, params: override("trim") },
      { pass: padCenter, params: { ...dims, ...override("pad-center") } },
      { pass: makeEncodePass("pad-center"), params: override("encode-canonical") },
    ],
  });
}

/** Fingerprint of the pipeline a request would run — for staleness checks. */
export function pipelineFingerprint(request: Omit<CanonicalizeRequest, "rawBytes">): {
  pipeline: string;
  fingerprint: string;
} {
  const resolved = buildPipeline({ ...request, rawBytes: Buffer.alloc(0) });
  return { pipeline: resolved.name, fingerprint: resolved.fingerprint };
}

export async function canonicalize(
  request: CanonicalizeRequest,
): Promise<CanonicalizeResult> {
  const resolved = buildPipeline(request);
  const input: WorkingImage = {
    pixels: { data: Buffer.alloc(0), width: 0, height: 0 },
    facts: {},
    notes: { rawBytes: request.rawBytes },
    warnings: [],
  };
  const { image, metrics } = await runPipeline(resolved, input);
  const canonicalBytes = image.notes.canonicalBytes as Buffer;
  if (!canonicalBytes) {
    throw new Error(
      `pipeline "${resolved.name}" completed without producing canonical bytes — ` +
        `the encode pass is missing from its definition.`,
    );
  }
  return {
    canonicalBytes,
    canonicalSha256: sha256(canonicalBytes),
    rawSha256: sha256(request.rawBytes),
    pipeline: resolved.name,
    fingerprint: resolved.fingerprint,
    chain: resolved.chain,
    runtime: runtimeVersions(),
    metrics,
    warnings: image.warnings,
  };
}
