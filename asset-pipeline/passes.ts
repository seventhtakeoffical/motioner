/**
 * The processing passes. Each is a versioned, deterministic transformation
 * over the WorkingImage context — pure functions of (pixels, params,
 * pinned artifacts). Passes read facts written by their dependencies
 * instead of recomputing; every alpha/mask analysis helper lives here and
 * writes its results into the facts channel.
 */

import sharp from "sharp";
import {
  ClassifiedFailure,
  type Bitmap,
  type PassOutput,
  type ProcessingPass,
  type WorkingImage,
} from "./framework";
import { extractAlpha } from "./models";

const ALPHA_SOLID = 127; // binary-mask threshold for component/hole analysis

// ---------------------------------------------------------------------------
// Shared mask analysis (writes facts; used by several passes)
// ---------------------------------------------------------------------------

interface MaskAnalysis {
  coverage: number;
  components: Array<{ area: number; pixels: Int32Array }>;
  bbox?: { left: number; top: number; right: number; bottom: number };
}

function analyzeMask(bitmap: Bitmap): MaskAnalysis {
  const { data, width, height } = bitmap;
  const total = width * height;
  const solid = new Uint8Array(total);
  let covered = 0;
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] > ALPHA_SOLID) {
      solid[i] = 1;
      covered++;
    }
  }

  // Connected components (4-connectivity) over solid pixels.
  const labels = new Int32Array(total).fill(-1);
  const components: Array<{ area: number; pixels: Int32Array }> = [];
  const queue = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (solid[start] === 0 || labels[start] !== -1) continue;
    const label = components.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    const members: number[] = [];
    while (head < tail) {
      const p = queue[head++];
      members.push(p);
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0 && solid[p - 1] && labels[p - 1] === -1) { labels[p - 1] = label; queue[tail++] = p - 1; }
      if (x < width - 1 && solid[p + 1] && labels[p + 1] === -1) { labels[p + 1] = label; queue[tail++] = p + 1; }
      if (y > 0 && solid[p - width] && labels[p - width] === -1) { labels[p - width] = label; queue[tail++] = p - width; }
      if (y < height - 1 && solid[p + width] && labels[p + width] === -1) { labels[p + width] = label; queue[tail++] = p + width; }
    }
    components.push({ area: members.length, pixels: Int32Array.from(members) });
  }
  components.sort((a, b) => b.area - a.area);

  let bbox: MaskAnalysis["bbox"];
  if (covered > 0) {
    let left = width, top = height, right = -1, bottom = -1;
    for (let i = 0; i < total; i++) {
      if (!solid[i]) continue;
      const x = i % width;
      const y = (i / width) | 0;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
    bbox = { left, top, right, bottom };
  }

  return { coverage: covered / total, components, bbox };
}

/** Background-connected transparency vs interior holes. */
function findHoles(bitmap: Bitmap): Array<{ area: number; pixels: Int32Array }> {
  const { data, width, height } = bitmap;
  const total = width * height;
  const transparent = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] <= ALPHA_SOLID) transparent[i] = 1;
  }
  // Flood the OUTSIDE from the borders; unreached transparency = holes.
  const outside = new Uint8Array(total);
  const queue = new Int32Array(total);
  let tail = 0;
  const seed = (p: number) => {
    if (transparent[p] && !outside[p]) { outside[p] = 1; queue[tail++] = p; }
  };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  let head = 0;
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0 && transparent[p - 1] && !outside[p - 1]) { outside[p - 1] = 1; queue[tail++] = p - 1; }
    if (x < width - 1 && transparent[p + 1] && !outside[p + 1]) { outside[p + 1] = 1; queue[tail++] = p + 1; }
    if (y > 0 && transparent[p - width] && !outside[p - width]) { outside[p - width] = 1; queue[tail++] = p - width; }
    if (y < height - 1 && transparent[p + width] && !outside[p + width]) { outside[p + width] = 1; queue[tail++] = p + width; }
  }
  // Component-ize the holes.
  const holes: Array<{ area: number; pixels: Int32Array }> = [];
  const seen = new Uint8Array(total);
  for (let start = 0; start < total; start++) {
    if (!transparent[start] || outside[start] || seen[start]) continue;
    let h = 0;
    const q: number[] = [start];
    seen[start] = 1;
    const members: number[] = [];
    while (h < q.length) {
      const p = q[h++];
      members.push(p);
      const x = p % width;
      const y = (p / width) | 0;
      const push = (n: number) => {
        if (transparent[n] && !outside[n] && !seen[n]) { seen[n] = 1; q.push(n); }
      };
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (y > 0) push(p - width);
      if (y < height - 1) push(p + width);
    }
    holes.push({ area: members.length, pixels: Int32Array.from(members) });
  }
  holes.sort((a, b) => b.area - a.area);
  return holes;
}

const out = (image: WorkingImage, extra?: Partial<PassOutput>): PassOutput => ({
  image,
  ...extra,
});

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

/** Decode raw bytes (stored in notes.rawBytes) into the RGBA bitmap. */
export const decode: ProcessingPass = {
  name: "decode",
  version: "1.0.0",
  dependsOn: [],
  defaults: {},
  async apply(image) {
    const raw = image.notes.rawBytes as Buffer | undefined;
    if (!raw) throw new ClassifiedFailure("decode-failed", "no raw bytes supplied");
    let pixels: Bitmap;
    let hadAlphaChannel = false;
    try {
      const instance = sharp(raw).ensureAlpha().toColorspace("srgb");
      const meta = await sharp(raw).metadata();
      hadAlphaChannel = Boolean(meta.hasAlpha);
      const { data, info } = await instance
        .raw()
        .toBuffer({ resolveWithObject: true });
      pixels = { data, width: info.width, height: info.height };
    } catch (error) {
      throw new ClassifiedFailure(
        "decode-failed",
        `undecodable raw image: ${error instanceof Error ? error.message : error}`,
      );
    }
    // "Had alpha" means real transparency, not just a 4th channel.
    let anyTransparent = false;
    if (hadAlphaChannel) {
      for (let i = 3; i < pixels.data.length; i += 4) {
        if (pixels.data[i] < 250) { anyTransparent = true; break; }
      }
    }
    image.pixels = pixels;
    image.facts.sourceHadAlpha = hadAlphaChannel && anyTransparent;
    return out(image, {
      stats: { width: pixels.width, height: pixels.height, sourceHadAlpha: image.facts.sourceHadAlpha ? 1 : 0 },
    });
  },
};

/**
 * Alpha extraction: real transparency passes through untouched; otherwise
 * the pinned segmentation model produces the subject mask.
 */
export const alphaExtract: ProcessingPass = {
  name: "alpha-extract",
  version: "1.0.0",
  dependsOn: ["decode"],
  defaults: { model: "isnet" },
  async apply(image, params) {
    let changed = 0;
    let midAlphaFraction = 0;
    let skipped = 0;
    if (image.facts.sourceHadAlpha) {
      // Real transparency passes through; only the sanity checks run.
      skipped = 1;
    } else {
      const extraction = await extractAlpha(String(params.model), image.pixels);
      midAlphaFraction = extraction.midAlphaFraction;
      for (let i = 0; i < extraction.alpha.length; i++) {
        const target = i * 4 + 3;
        if (image.pixels.data[target] !== extraction.alpha[i]) changed++;
        image.pixels.data[target] = extraction.alpha[i];
      }
    }

    const analysis = analyzeMask(image.pixels);
    image.facts.subjectCoverage = analysis.coverage;
    image.facts.componentCount = analysis.components.length;
    image.facts.alphaBBox = analysis.bbox;
    const confidence = 1 - midAlphaFraction;
    image.facts.extractionConfidence = confidence;
    if (confidence < 0.9) {
      image.warnings.push(
        `alpha-extract: ${(midAlphaFraction * 100).toFixed(1)}% of pixels are ` +
          `mid-alpha — soft/uncertain mask edges; inspect the cutout.`,
      );
    }

    // Sanity checks apply to BOTH paths: an alpha-carrying raw that is 99%
    // opaque is just as much "an environment, not an object" as a bad mask.
    if (analysis.coverage < 0.02) {
      throw new ClassifiedFailure("no-subject", "no subject found (alpha coverage < 2%)");
    }
    if (analysis.coverage > 0.95) {
      throw new ClassifiedFailure(
        "environment-not-object",
        "alpha covers >95% of the frame — the raw is an environment, not an isolated object",
      );
    }
    return out(image, {
      pixelsChanged: changed,
      confidence,
      stats: {
        skipped,
        coverage: analysis.coverage,
        components: analysis.components.length,
        midAlphaFraction,
      },
    });
  },
};

/** Drop satellite specks; a substantial second component is a real failure. */
export const keepLargestComponent: ProcessingPass = {
  name: "keep-largest-component",
  version: "1.0.0",
  dependsOn: ["alpha-extract"],
  defaults: { satelliteMaxFraction: 0.05 },
  apply(image, params) {
    const analysis = analyzeMask(image.pixels);
    if (analysis.components.length <= 1) {
      return out(image, { stats: { components: analysis.components.length, dropped: 0 } });
    }
    const largest = analysis.components[0];
    const second = analysis.components[1];
    if (second.area / largest.area >= Number(params.satelliteMaxFraction)) {
      throw new ClassifiedFailure(
        "multi-object",
        `mask has ${analysis.components.length} components; the second is ` +
          `${((second.area / largest.area) * 100).toFixed(0)}% of the largest — ambiguous multi-object raw`,
      );
    }
    let dropped = 0;
    for (let c = 1; c < analysis.components.length; c++) {
      for (const p of analysis.components[c].pixels) {
        image.pixels.data[p * 4 + 3] = 0;
        dropped++;
      }
    }
    const after = analyzeMask(image.pixels);
    image.facts.subjectCoverage = after.coverage;
    image.facts.componentCount = 1;
    image.facts.alphaBBox = after.bbox;
    return out(image, {
      pixelsChanged: dropped,
      stats: { components: analysis.components.length, dropped },
    });
  },
};

/**
 * Heuristic-gated hole repair: fills only what reads as segmentation noise
 * (speck-sized relative to the subject). Structural holes — the key's bow,
 * the wheel's spokes — are untouched by default. A preserved accidental
 * hole is a reviewable flaw; an erased legitimate hole is silent content
 * destruction, so the default is conservative.
 */
export const repairAccidentalHoles: ProcessingPass = {
  name: "repair-accidental-holes",
  version: "1.0.0",
  dependsOn: ["keep-largest-component"],
  defaults: { mode: "auto", maxHoleFraction: 0.001 },
  apply(image, params) {
    if (params.mode === "off") return out(image, { stats: { skipped: 1 } });
    const holes = findHoles(image.pixels);
    if (holes.length === 0) {
      image.facts.holeInventory = [];
      return out(image, { stats: { holes: 0, filled: 0 } });
    }
    const subjectArea =
      (image.facts.subjectCoverage ?? 0) * image.pixels.width * image.pixels.height;
    const limit =
      params.mode === "aggressive"
        ? subjectArea * 0.02
        : subjectArea * Number(params.maxHoleFraction);
    let filled = 0;
    const inventory: Array<{ area: number; filled: boolean }> = [];
    for (const hole of holes) {
      const accidental = hole.area <= limit;
      inventory.push({ area: hole.area, filled: accidental });
      if (accidental) {
        for (const p of hole.pixels) image.pixels.data[p * 4 + 3] = 255;
        filled += hole.area;
      }
    }
    image.facts.holeInventory = inventory;
    const preserved = inventory.filter((h) => !h.filled).length;
    if (preserved > 0) {
      image.warnings.push(
        `repair-accidental-holes: preserved ${preserved} structural hole(s) — ` +
          `verify they are intentional (rings, handles, spokes…).`,
      );
    }
    return out(image, {
      pixelsChanged: filled,
      stats: { holes: holes.length, filled: inventory.filter((h) => h.filled).length, preserved },
    });
  },
};

/** Crop to the subject's alpha bounding box; edge contact is a failure. */
export const trim: ProcessingPass = {
  name: "trim",
  version: "1.0.0",
  dependsOn: ["repair-accidental-holes"],
  defaults: { alphaThreshold: 2 },
  apply(image, params) {
    const threshold = Number(params.alphaThreshold);
    const { data, width, height } = image.pixels;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > threshold) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (right < 0) throw new ClassifiedFailure("no-subject", "nothing above the alpha threshold");
    if (left === 0 || top === 0 || right === width - 1 || bottom === height - 1) {
      throw new ClassifiedFailure(
        "subject-cropped",
        "subject touches the raw frame edge — it was not fully inside the generation",
      );
    }
    const w = right - left + 1;
    const h = bottom - top + 1;
    const cropped = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      data.copy(cropped, y * w * 4, ((top + y) * width + left) * 4, ((top + y) * width + right + 1) * 4);
    }
    image.pixels = { data: cropped, width: w, height: h };
    image.facts.alphaBBox = { left: 0, top: 0, right: w - 1, bottom: h - 1 };
    return out(image, { pixelsChanged: w * h, stats: { width: w, height: h } });
  },
};

/** Pad, center, and contain-fit into the declared canonical dimensions. */
export const padCenter: ProcessingPass = {
  name: "pad-center",
  version: "1.0.0",
  dependsOn: ["trim"],
  defaults: { paddingFraction: 0.04, targetWidth: 0, targetHeight: 0 },
  async apply(image, params) {
    const tw = Number(params.targetWidth);
    const th = Number(params.targetHeight);
    if (tw <= 0 || th <= 0) {
      throw new Error("pad-center requires targetWidth/targetHeight params");
    }
    const { width, height } = image.pixels;
    const pad = Math.round(Math.max(width, height) * Number(params.paddingFraction));
    const boxW = width + 2 * pad;
    const boxH = height + 2 * pad;
    const scale = Math.min(tw / boxW, th / boxH);
    const drawW = Math.max(1, Math.round(width * scale));
    const drawH = Math.max(1, Math.round(height * scale));

    const resized = await sharp(image.pixels.data, {
      raw: { width, height, channels: 4 },
    })
      .resize(drawW, drawH, { kernel: "lanczos3", fit: "fill" })
      .raw()
      .toBuffer();

    const canvas = Buffer.alloc(tw * th * 4);
    const offsetX = Math.round((tw - drawW) / 2);
    const offsetY = Math.round((th - drawH) / 2);
    for (let y = 0; y < drawH; y++) {
      resized.copy(canvas, ((offsetY + y) * tw + offsetX) * 4, y * drawW * 4, (y + 1) * drawW * 4);
    }
    image.pixels = { data: canvas, width: tw, height: th };
    return out(image, {
      pixelsChanged: tw * th,
      stats: { scale, drawW, drawH, pad },
    });
  },
};

/** Cover-fit for plates: fill the declared dimensions exactly, no alpha work. */
export const coverFit: ProcessingPass = {
  name: "cover-fit",
  version: "1.0.0",
  dependsOn: ["decode"],
  defaults: { targetWidth: 0, targetHeight: 0 },
  async apply(image, params) {
    const tw = Number(params.targetWidth);
    const th = Number(params.targetHeight);
    if (tw <= 0 || th <= 0) throw new Error("cover-fit requires target dimensions");
    const data = await sharp(image.pixels.data, {
      raw: { width: image.pixels.width, height: image.pixels.height, channels: 4 },
    })
      .resize(tw, th, { kernel: "lanczos3", fit: "cover", position: "centre" })
      .raw()
      .toBuffer();
    image.pixels = { data, width: tw, height: th };
    return out(image, { pixelsChanged: tw * th, stats: { width: tw, height: th } });
  },
};

/** Plates are fully opaque by definition. */
export const opaqueAlpha: ProcessingPass = {
  name: "opaque-alpha",
  version: "1.0.0",
  dependsOn: ["cover-fit"],
  defaults: {},
  apply(image) {
    let changed = 0;
    for (let i = 3; i < image.pixels.data.length; i += 4) {
      if (image.pixels.data[i] !== 255) { image.pixels.data[i] = 255; changed++; }
    }
    return out(image, { pixelsChanged: changed, stats: {} });
  },
};

/** Canonical PNG encoding: pinned settings, byte-stable for equal pixels. */
export function makeEncodePass(dependsOn: string): ProcessingPass {
  return {
    name: "encode-canonical",
    version: "1.0.0",
    dependsOn: [dependsOn],
    defaults: { compressionLevel: 9 },
    async apply(image, params) {
      const bytes = await sharp(image.pixels.data, {
        raw: { width: image.pixels.width, height: image.pixels.height, channels: 4 },
      })
        .png({
          compressionLevel: Number(params.compressionLevel),
          adaptiveFiltering: false,
          palette: false,
        })
        .toBuffer();
      image.notes.canonicalBytes = bytes;
      return out(image, { stats: { bytes: bytes.length } });
    },
  };
}
