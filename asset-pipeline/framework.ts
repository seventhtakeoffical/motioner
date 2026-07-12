/**
 * The Asset Pipeline framework (stable architecture — see the design
 * review). Providers produce raw imagery; THIS subsystem decides what a
 * Motioner asset is. It is a pipeline of versioned, deterministic
 * processing passes over a shared WorkingImage context:
 *
 *  - passes declare DEPENDENCIES, not array positions; the resolver
 *    topo-sorts them into a deterministic sequence (ties broken
 *    lexicographically by name — a value-based total order);
 *  - every pass returns METRICS (observability channel, firewalled from
 *    provenance: wall-clock and machine facts never enter fingerprints);
 *  - the pipeline FINGERPRINT is a sha256 over the resolved chain
 *    descriptor (names, versions, resolved params, artifact hashes) —
 *    same definition, same fingerprint, forever;
 *  - new capabilities arrive as new passes or pass versions, never as
 *    framework changes.
 *
 * This subsystem knows images, not Bibles.
 */

import crypto from "node:crypto";

/** RGBA bitmap: the single source of pixel truth. */
export interface Bitmap {
  data: Buffer; // RGBA, 4 bytes/pixel, row-major
  width: number;
  height: number;
}

/**
 * Facts: well-known fields written once by a pass and reused downstream
 * instead of recomputed. A fact's absence must never corrupt a pass —
 * function correctly or fail loudly.
 */
export interface Facts {
  sourceHadAlpha?: boolean;
  alphaBBox?: { left: number; top: number; right: number; bottom: number };
  subjectCoverage?: number; // fraction of pixels with α > threshold
  componentCount?: number;
  holeInventory?: Array<{ area: number; filled: boolean }>;
  extractionConfidence?: number;
  [key: string]: unknown;
}

/** The shared processing context that flows through the pipeline. */
export interface WorkingImage {
  pixels: Bitmap;
  facts: Facts;
  /** Per-pass open namespace for facts only their author interprets. */
  notes: Record<string, unknown>;
  warnings: string[];
}

export type ParamValue = string | number | boolean;

export type FailureKind =
  | "no-subject"
  | "environment-not-object"
  | "multi-object"
  | "subject-cropped"
  | "decode-failed";

export class ClassifiedFailure extends Error {
  readonly kind: FailureKind;
  constructor(kind: FailureKind, message: string) {
    super(message);
    this.name = "ClassifiedFailure";
    this.kind = kind;
  }
}

/** Observability channel — never provenance, never behavior. */
export interface PassMetrics {
  pass: string;
  durationMs: number;
  pixelsChanged: number;
  confidence?: number;
  warnings: string[];
  stats: Record<string, number>;
}

export interface PassOutput {
  image: WorkingImage;
  /** Everything except pass/durationMs, which the runner fills in. */
  pixelsChanged?: number;
  confidence?: number;
  stats?: Record<string, number>;
}

export interface PinnedArtifact {
  name: string;
  /** Pinned content hash, verified before use. */
  sha256: string;
}

export interface ProcessingPass {
  /** Frozen identifier. */
  name: string;
  /** Bumped on ANY behavior change. */
  version: string;
  /** Explicit dependencies — the resolver derives execution order. */
  dependsOn: readonly string[];
  /** Declared params with defaults; unknown names/type mismatches error. */
  defaults: Readonly<Record<string, ParamValue>>;
  /** Pinned external files (model weights…) recorded in the fingerprint. */
  artifacts?: readonly PinnedArtifact[];
  apply(
    image: WorkingImage,
    params: Readonly<Record<string, ParamValue>>,
  ): Promise<PassOutput> | PassOutput;
}

export interface PassInstance {
  pass: ProcessingPass;
  params?: Readonly<Record<string, ParamValue>>;
}

export interface PipelineDefinition {
  /** Frozen pipeline name, e.g. "object-v1". */
  name: string;
  /** A SET of pass instances — order is derived, never declared. */
  passes: readonly PassInstance[];
}

export interface ResolvedPipeline {
  name: string;
  /** Deterministic execution sequence. */
  sequence: ReadonlyArray<{
    pass: ProcessingPass;
    params: Readonly<Record<string, ParamValue>>;
  }>;
  /** sha256 over the resolved chain descriptor. */
  fingerprint: string;
  /** The provenance-facing chain description. */
  chain: ReadonlyArray<{
    pass: string;
    version: string;
    params: Record<string, ParamValue>;
    artifacts?: Array<{ name: string; sha256: string }>;
  }>;
}

function resolveParams(
  pass: ProcessingPass,
  overrides: Readonly<Record<string, ParamValue>> | undefined,
): Record<string, ParamValue> {
  for (const key of Object.keys(overrides ?? {})) {
    if (!(key in pass.defaults)) {
      throw new Error(
        `Pass "${pass.name}" has no parameter "${key}". ` +
          `It accepts: ${Object.keys(pass.defaults).join(", ") || "none"}.`,
      );
    }
    const expected = typeof pass.defaults[key];
    const actual = typeof (overrides as Record<string, ParamValue>)[key];
    if (expected !== actual) {
      throw new Error(
        `Pass "${pass.name}" parameter "${key}" must be a ${expected}, got ${actual}.`,
      );
    }
  }
  // Spec-declaration order, then overrides applied — value-stable output.
  const resolved: Record<string, ParamValue> = {};
  for (const key of Object.keys(pass.defaults)) {
    resolved[key] = overrides?.[key] ?? pass.defaults[key];
  }
  return resolved;
}

/**
 * Topological sort with lexicographic tie-breaking: a pure function of the
 * definition — never of declaration order, never of map iteration.
 */
export function resolvePipeline(definition: PipelineDefinition): ResolvedPipeline {
  const byName = new Map<string, PassInstance>();
  for (const instance of definition.passes) {
    if (byName.has(instance.pass.name)) {
      throw new Error(
        `Pipeline "${definition.name}" declares pass "${instance.pass.name}" twice.`,
      );
    }
    byName.set(instance.pass.name, instance);
  }
  for (const instance of definition.passes) {
    for (const dep of instance.pass.dependsOn) {
      if (!byName.has(dep)) {
        throw new Error(
          `Pipeline "${definition.name}": pass "${instance.pass.name}" depends on ` +
            `"${dep}", which is not in the pipeline.`,
        );
      }
    }
  }

  const sorted: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string, path: string[]) => {
    const s = state.get(name);
    if (s === "done") return;
    if (s === "visiting") {
      throw new Error(
        `Pipeline "${definition.name}" has a dependency cycle: ${[...path, name].join(" → ")}.`,
      );
    }
    state.set(name, "visiting");
    const deps = [...(byName.get(name) as PassInstance).pass.dependsOn].sort();
    for (const dep of deps) visit(dep, [...path, name]);
    state.set(name, "done");
    sorted.push(name);
  };
  for (const name of [...byName.keys()].sort()) visit(name, []);

  const sequence = sorted.map((name) => {
    const instance = byName.get(name) as PassInstance;
    return { pass: instance.pass, params: resolveParams(instance.pass, instance.params) };
  });

  const chain = sequence.map(({ pass, params }) => ({
    pass: pass.name,
    version: pass.version,
    params,
    ...(pass.artifacts && pass.artifacts.length > 0
      ? { artifacts: pass.artifacts.map((a) => ({ name: a.name, sha256: a.sha256 })) }
      : {}),
  }));
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({ name: definition.name, chain }))
    .digest("hex");

  return { name: definition.name, sequence, fingerprint, chain };
}

export interface RunResult {
  image: WorkingImage;
  metrics: PassMetrics[];
}

/** Execute a resolved pipeline. Throws ClassifiedFailure on classified stops. */
export async function runPipeline(
  pipeline: ResolvedPipeline,
  input: WorkingImage,
): Promise<RunResult> {
  let image = input;
  const metrics: PassMetrics[] = [];
  for (const { pass, params } of pipeline.sequence) {
    const before = Date.now();
    const warningsBefore = image.warnings.length;
    const output = await pass.apply(image, params);
    image = output.image;
    metrics.push({
      pass: pass.name,
      durationMs: Date.now() - before,
      pixelsChanged: output.pixelsChanged ?? 0,
      confidence: output.confidence,
      warnings: image.warnings.slice(warningsBefore),
      stats: output.stats ?? {},
    });
  }
  return { image, metrics };
}

export function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
