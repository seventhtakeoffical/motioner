import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  resolvePipeline,
  type PassInstance,
  type ProcessingPass,
  type WorkingImage,
} from "./framework";
import { canonicalize, ClassifiedFailure } from "./pipelines";

/**
 * Asset Pipeline tests: the framework (dependency resolution, fingerprints,
 * param validation) on synthetic passes, and the real object/plate
 * pipelines on synthetic alpha-carrying rasters — which exercise every
 * pure pass without touching the ONNX model.
 */

const noop = (name: string, dependsOn: string[] = []): ProcessingPass => ({
  name,
  version: "1.0.0",
  dependsOn,
  defaults: {},
  apply: (image: WorkingImage) => ({ image }),
});

describe("framework: dependency resolution", () => {
  const instances = (...passes: ProcessingPass[]): PassInstance[] =>
    passes.map((pass) => ({ pass }));

  it("derives execution order from dependencies with lexicographic ties", () => {
    // b and c both depend on a; d depends on both. Declaration order is
    // scrambled on purpose — the resolved order must not care.
    const resolved = resolvePipeline({
      name: "t",
      passes: instances(
        noop("d", ["c", "b"]),
        noop("c", ["a"]),
        noop("a"),
        noop("b", ["a"]),
      ),
    });
    expect(resolved.sequence.map((s) => s.pass.name)).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects cycles, missing dependencies, and duplicates", () => {
    expect(() =>
      resolvePipeline({
        name: "t",
        passes: instances(noop("a", ["b"]), noop("b", ["a"])),
      }),
    ).toThrow(/dependency cycle/);
    expect(() =>
      resolvePipeline({ name: "t", passes: instances(noop("a", ["ghost"])) }),
    ).toThrow(/depends on "ghost"/);
    expect(() =>
      resolvePipeline({ name: "t", passes: instances(noop("a"), noop("a")) }),
    ).toThrow(/twice/);
  });

  it("validates params against declared defaults", () => {
    const pass: ProcessingPass = { ...noop("p"), defaults: { level: 3 } };
    expect(() =>
      resolvePipeline({ name: "t", passes: [{ pass, params: { nope: 1 } }] }),
    ).toThrow(/no parameter "nope"/);
    expect(() =>
      resolvePipeline({ name: "t", passes: [{ pass, params: { level: "high" } }] }),
    ).toThrow(/must be a number/);
  });

  it("fingerprints are stable and sensitive to params/versions", () => {
    const pass: ProcessingPass = { ...noop("p"), defaults: { level: 3 } };
    const a = resolvePipeline({ name: "t", passes: [{ pass }] });
    const b = resolvePipeline({ name: "t", passes: [{ pass }] });
    expect(a.fingerprint).toBe(b.fingerprint);
    const c = resolvePipeline({ name: "t", passes: [{ pass, params: { level: 4 } }] });
    expect(c.fingerprint).not.toBe(a.fingerprint);
    const d = resolvePipeline({
      name: "t",
      passes: [{ pass: { ...pass, version: "1.1.0" } }],
    });
    expect(d.fingerprint).not.toBe(a.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// Synthetic rasters (real alpha → the ML model is never needed)
// ---------------------------------------------------------------------------

interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
  hole?: boolean;
}

async function raster(width: number, height: number, spots: Spot[]): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);
  for (const spot of spots) {
    for (let y = spot.y; y < spot.y + spot.h; y++) {
      for (let x = spot.x; x < spot.x + spot.w; x++) {
        const i = (y * width + x) * 4;
        if (spot.hole) {
          data[i + 3] = 0;
        } else {
          data[i] = 180;
          data[i + 1] = 100;
          data[i + 2] = 50;
          data[i + 3] = 255;
        }
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

const CANON = { targetWidth: 300, targetHeight: 200 };

async function alphaOf(png: Buffer) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

describe("object pipeline on synthetic subjects", () => {
  it("produces a canonical asset: declared dims, subject centered and padded", async () => {
    // Small off-center subject in a large canvas.
    const raw = await raster(400, 400, [{ x: 40, y: 60, w: 80, h: 40 }]);
    const result = await canonicalize({ rawBytes: raw, form: "object", ...CANON });

    const img = await alphaOf(result.canonicalBytes);
    expect(img.width).toBe(300);
    expect(img.height).toBe(200);

    // Find the subject bbox in the canonical output.
    let left = 300, right = -1, top = 200, bottom = -1;
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 300; x++) {
        if (img.data[(y * 300 + x) * 4 + 3] > 127) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    // Centered: bbox center within a pixel or two of canvas center.
    expect(Math.abs((left + right) / 2 - 149.5)).toBeLessThan(3);
    expect(Math.abs((top + bottom) / 2 - 99.5)).toBeLessThan(3);
    // Padded: the subject never touches the canonical edge.
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
    expect(right).toBeLessThan(299);
    expect(bottom).toBeLessThan(199);
    // Provenance chain names the object pipeline.
    expect(result.pipeline).toBe("object-v1");
    expect(result.metrics.map((m) => m.pass)).toContain("alpha-extract");
  });

  it("drops satellite specks but fails on a substantial second object", async () => {
    // Main subject + a tiny speck: speck removed, success.
    const speckled = await raster(400, 400, [
      { x: 100, y: 100, w: 120, h: 120 },
      { x: 350, y: 350, w: 4, h: 4 },
    ]);
    const ok = await canonicalize({ rawBytes: speckled, form: "object", ...CANON });
    const dropped = ok.metrics.find((m) => m.pass === "keep-largest-component");
    expect(dropped?.stats.dropped).toBeGreaterThan(0);

    // Two comparable objects: ambiguous — classified failure.
    const twins = await raster(400, 400, [
      { x: 40, y: 100, w: 100, h: 100 },
      { x: 260, y: 100, w: 90, h: 90 },
    ]);
    await expect(
      canonicalize({ rawBytes: twins, form: "object", ...CANON }),
    ).rejects.toMatchObject({ kind: "multi-object" });
  });

  it("preserves structural holes and repairs speck holes", async () => {
    // A ring: big subject with a large center hole (legitimate).
    const ring = await raster(400, 400, [
      { x: 100, y: 100, w: 200, h: 200 },
      { x: 160, y: 160, w: 80, h: 80, hole: true },
      { x: 120, y: 120, w: 2, h: 2, hole: true }, // accidental speck
    ]);
    const result = await canonicalize({ rawBytes: ring, form: "object", ...CANON });
    const repair = result.metrics.find((m) => m.pass === "repair-accidental-holes");
    expect(repair?.stats.filled).toBe(1);
    expect(repair?.stats.preserved).toBe(1);
    expect(result.warnings.join("\n")).toMatch(/preserved 1 structural hole/);
  });

  it("classifies edge-touching subjects and empty rasters", async () => {
    const cropped = await raster(400, 400, [{ x: 0, y: 100, w: 120, h: 120 }]);
    await expect(
      canonicalize({ rawBytes: cropped, form: "object", ...CANON }),
    ).rejects.toMatchObject({ kind: "subject-cropped" });

    const empty = await raster(400, 400, [{ x: 10, y: 10, w: 2, h: 2 }]);
    await expect(
      canonicalize({ rawBytes: empty, form: "object", ...CANON }),
    ).rejects.toBeInstanceOf(ClassifiedFailure);
  });
});

describe("plate pipeline", () => {
  it("cover-fits to declared dims with fully opaque alpha", async () => {
    const raw = await raster(500, 500, [{ x: 0, y: 0, w: 500, h: 500 }]);
    const result = await canonicalize({ rawBytes: raw, form: "plate", ...CANON });
    expect(result.pipeline).toBe("plate-v1");
    const img = await alphaOf(result.canonicalBytes);
    expect(img.width).toBe(300);
    expect(img.height).toBe(200);
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(255);
    }
  });
});

describe("reproducibility", () => {
  it("same raw in, byte-identical canonical out", async () => {
    const raw = await raster(400, 400, [{ x: 120, y: 90, w: 150, h: 110 }]);
    const a = await canonicalize({ rawBytes: raw, form: "object", ...CANON });
    const b = await canonicalize({ rawBytes: raw, form: "object", ...CANON });
    expect(a.canonicalSha256).toBe(b.canonicalSha256);
    expect(Buffer.compare(a.canonicalBytes, b.canonicalBytes)).toBe(0);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
