/**
 * Pinned segmentation model runtime. Models are external artifacts:
 * downloaded once by `npm run pipeline -- models`, SHA-256-verified at
 * every load (a mismatch is a hard configuration error — never a silent
 * substitution), and executed with a determinism-pinned ONNX session
 * (CPU execution provider, fixed threads, fixed optimization level).
 *
 * The model catalog is data: adding a candidate is one entry, and which
 * model runs is an alpha-extract PASS PARAM — a low-stakes, fingerprinted,
 * reversible choice, per the benchmark-decides rule.
 */

import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { sha256, type Bitmap } from "./framework";

export interface ModelSpec {
  name: string;
  url: string;
  /** Pinned after first verified download; "" means to-be-pinned. */
  sha256: string;
  inputSize: number;
  /** Preprocessing constants (ImageNet-style normalization). */
  mean: [number, number, number];
  std: [number, number, number];
}

export const MODELS: Record<string, ModelSpec> = {
  isnet: {
    name: "isnet",
    url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
    // Pinned from the verified first download.
    sha256: "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a",
    inputSize: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1, 1, 1],
  },
};

export const MODELS_DIR = path.join(__dirname, "models");

export function modelPath(name: string): string {
  return path.join(MODELS_DIR, `${name}.onnx`);
}

const sessions = new Map<string, Promise<ort.InferenceSession>>();

async function loadSession(spec: ModelSpec): Promise<ort.InferenceSession> {
  const file = modelPath(spec.name);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Model "${spec.name}" is not installed. Run: npm run pipeline -- models`,
    );
  }
  const actual = sha256(fs.readFileSync(file));
  if (spec.sha256 && actual !== spec.sha256) {
    throw new Error(
      `Model "${spec.name}" weights hash mismatch (expected ${spec.sha256.slice(0, 12)}…, ` +
        `got ${actual.slice(0, 12)}…). Refusing to run on unverified weights.`,
    );
  }
  return ort.InferenceSession.create(file, {
    executionProviders: ["cpu"],
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    graphOptimizationLevel: "all",
  });
}

function session(spec: ModelSpec): Promise<ort.InferenceSession> {
  let existing = sessions.get(spec.name);
  if (!existing) {
    existing = loadSession(spec);
    sessions.set(spec.name, existing);
  }
  return existing;
}

/**
 * Run the salient-object model over a bitmap and return an 8-bit alpha map
 * at the bitmap's own resolution, plus the fraction of mid-alpha pixels
 * (the mask-decisiveness signal used for confidence).
 */
export async function extractAlpha(
  modelName: string,
  bitmap: Bitmap,
): Promise<{ alpha: Uint8Array; midAlphaFraction: number }> {
  const spec = MODELS[modelName];
  if (!spec) {
    throw new Error(
      `Unknown segmentation model "${modelName}". Available: ${Object.keys(MODELS).join(", ")}.`,
    );
  }
  const size = spec.inputSize;

  // Model input: RGB at the model's square size, normalized.
  const resized = await sharp(bitmap.data, {
    raw: { width: bitmap.width, height: bitmap.height, channels: 4 },
  })
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const input = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let i = 0; i < plane; i++) {
    input[i] = (resized[i * 3] / 255 - spec.mean[0]) / spec.std[0];
    input[plane + i] = (resized[i * 3 + 1] / 255 - spec.mean[1]) / spec.std[1];
    input[2 * plane + i] = (resized[i * 3 + 2] / 255 - spec.mean[2]) / spec.std[2];
  }

  const sess = await session(spec);
  const results = await sess.run({
    [sess.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, size, size]),
  });
  const output = results[sess.outputNames[0]].data as Float32Array;

  // Min-max normalize the saliency map (standard IS-Net postprocessing).
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = output[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const mask = Buffer.alloc(plane);
  for (let i = 0; i < plane; i++) {
    mask[i] = Math.round(((output[i] - min) / range) * 255);
  }

  // Back to the bitmap's resolution. sharp may promote single-band output
  // to multi-channel — read with the actual stride, never assume 1.
  const { data: resizedMask, info } = await sharp(mask, {
    raw: { width: size, height: size, channels: 1 },
  })
    .resize(bitmap.width, bitmap.height, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const count = bitmap.width * bitmap.height;
  const alpha = new Uint8Array(count);
  const stride = info.channels;
  let mid = 0;
  for (let i = 0; i < count; i++) {
    const v = resizedMask[i * stride];
    alpha[i] = v;
    if (v > 25 && v < 230) mid++;
  }
  return { alpha, midAlphaFraction: mid / count };
}

/** Download any missing models and report their hashes for pinning. */
export async function installModels(): Promise<void> {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  for (const spec of Object.values(MODELS)) {
    const file = modelPath(spec.name);
    if (fs.existsSync(file)) {
      console.log(`${spec.name}: already installed (${sha256(fs.readFileSync(file)).slice(0, 12)}…)`);
      continue;
    }
    console.log(`${spec.name}: downloading ${spec.url} …`);
    const response = await fetch(spec.url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`download failed: ${response.status} ${response.statusText}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (spec.sha256 && actual !== spec.sha256) {
      throw new Error(
        `${spec.name}: downloaded weights hash ${actual} does not match pinned ${spec.sha256}.`,
      );
    }
    fs.writeFileSync(file, bytes);
    console.log(`${spec.name}: installed, sha256 ${actual}`);
  }
}
