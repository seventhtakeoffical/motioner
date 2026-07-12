import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showcaseBible } from "../src/bible/showcase";
import type { Bible } from "../src/bible/schema";
import { approveDraft } from "../review/workflow";
import {
  deterministicSeed,
  makeExplainerTemplate,
  ProviderError,
  type AssetProvider,
  type GenerationRequest,
} from "./provider";
import sharp from "sharp";
import { selectProvider } from "./registry";
import { runGeneration, GENERATOR_VERSION } from "./run";

/**
 * M16 tests. Providers are faked in-memory — no network — so what's under
 * test is everything the orchestrator owns: spec loading and the
 * draft/approved distinction, skip/force, retries, atomic writes,
 * validation, provenance, and the report.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "motioner-generate-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A real PNG: an opaque colored square centered on a transparent canvas.
 * Real transparency means alpha-extract passes through without the ML
 * model — unit tests exercise the full pipeline, ONNX-free.
 */
async function fakePng(width: number, height: number): Promise<Uint8Array> {
  const data = Buffer.alloc(width * height * 4);
  const x0 = Math.floor(width * 0.3), x1 = Math.floor(width * 0.7);
  const y0 = Math.floor(height * 0.3), y1 = Math.floor(height * 0.7);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      data[i] = 200; data[i + 1] = 120; data[i + 2] = 60; data[i + 3] = 255;
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function fakeProvider(
  overrides: Partial<AssetProvider> & {
    onGenerate?: (req: GenerationRequest, prompt: string) => void;
    failures?: Array<{ retryable: boolean }>;
    dims?: [number, number];
    transparent?: boolean;
  } = {},
): AssetProvider {
  const failures = [...(overrides.failures ?? [])];
  const transparent = overrides.transparent ?? true;
  return {
    name: overrides.name ?? "fake",
    capabilities: overrides.capabilities ?? ["image"],
    supportsTransparentBackground: transparent,
    promptTemplate:
      overrides.promptTemplate ??
      makeExplainerTemplate({ transparentBackground: transparent }),
    isConfigured: () => ({ ok: true }),
    async generate(req, prompt) {
      overrides.onGenerate?.(req, prompt);
      const failure = failures.shift();
      if (failure) throw new ProviderError("simulated failure", failure.retryable);
      const [w, h] = overrides.dims ?? [req.width, req.height];
      return { bytes: await fakePng(w, h), format: "png", model: "fake-model-1" };
    },
  };
}

function writeDraft(mutate?: (b: Bible) => void): string {
  const bible = structuredClone(showcaseBible);
  bible.id = "gen-test";
  bible.assets.push({
    kind: "image",
    id: "requested-one",
    src: "generated/gen-test/one.png",
    intrinsicWidth: 1536,
    intrinsicHeight: 1024,
    generationBrief: "A tall library shelf, one glowing book.",
  });
  mutate?.(bible);
  const p = path.join(dir, "gen-test.bible.json");
  fs.writeFileSync(p, JSON.stringify(bible, null, 2));
  return p;
}

const publicDir = () => path.join(dir, "public");
const rawDir = () => path.join(dir, "assets-raw");
const opts = (biblePath: string, extra = {}) => ({
  biblePath,
  draft: true,
  publicDir: publicDir(),
  rawDir: rawDir(),
  backoffMs: 0,
  ...extra,
});

describe("spec loading: draft vs approved", () => {
  it("refuses a lone draft without --draft, accepts with it, and records the source", async () => {
    const draftPath = writeDraft();
    await expect(
      runGeneration({ biblePath: draftPath, publicDir: publicDir() }, fakeProvider()),
    ).rejects.toThrow(/approve it first, or acknowledge the draft/);

    const report = await runGeneration(opts(draftPath), fakeProvider());
    expect(report.source).toBe("draft");
    expect(report.satisfied).toBe(true);
  });

  it("uses the approved pair when present — and hard-fails on a stale approval", async () => {
    const draftPath = writeDraft();
    const approved = approveDraft({
      draftPath,
      approvedDir: path.join(dir, "approved"),
      reviewer: "kaus",
      approvedAt: "2026-07-12T10:00:00.000Z",
    });
    const report = await runGeneration(
      { biblePath: approved.biblePath, publicDir: publicDir(), rawDir: rawDir() },
      fakeProvider(),
    );
    expect(report.source).toBe("approved");

    // Tamper with the approved Bible: generation must refuse.
    const edited = JSON.parse(fs.readFileSync(approved.biblePath, "utf8"));
    edited.title = "edited";
    fs.writeFileSync(approved.biblePath, JSON.stringify(edited, null, 2));
    await expect(
      runGeneration(
        { biblePath: approved.biblePath, publicDir: publicDir(), rawDir: rawDir() },
        fakeProvider(),
      ),
    ).rejects.toThrow(/changed since it was approved/);
  });
});

describe("generation, skip, and force", () => {
  it("generates missing files, then skips them, then --force regenerates", async () => {
    const draftPath = writeDraft();
    const first = await runGeneration(opts(draftPath), fakeProvider());
    expect(first.items[0].status).toBe("generated");
    const target = path.join(publicDir(), "generated/gen-test/one.png");
    expect(fs.existsSync(target)).toBe(true);

    const second = await runGeneration(opts(draftPath), fakeProvider());
    expect(second.items[0].status).toBe("skipped");

    const third = await runGeneration(opts(draftPath, { force: true }), fakeProvider());
    expect(third.items[0].status).toBe("generated");
  });

  it("regenerates without --force when the spec changed (brief staleness)", async () => {
    const draftPath = writeDraft();
    await runGeneration(opts(draftPath), fakeProvider());

    // Same spec → skipped, as ever.
    const unchanged = await runGeneration(opts(draftPath), fakeProvider());
    expect(unchanged.items[0].status).toBe("skipped");

    // Edit the brief in the draft: the canonical asset is now stale and
    // must be regenerated even without --force — an edited spec must never
    // silently keep the old image.
    const edited = JSON.parse(fs.readFileSync(draftPath, "utf8"));
    const img = edited.assets.find(
      (a: { id: string }) => a.id === "requested-one",
    );
    img.generationBrief = "A completely different subject.";
    fs.writeFileSync(draftPath, JSON.stringify(edited, null, 2));

    const report = await runGeneration(opts(draftPath), fakeProvider());
    expect(report.items[0].status).toBe("generated");
    expect(report.items[0].detail).toMatch(/regenerated: generationBrief changed/);
  });

  it("refuses to run over a corrupted manifest instead of silently resetting it", async () => {
    const draftPath = writeDraft();
    await runGeneration(opts(draftPath), fakeProvider());
    const manifestPath = path.join(rawDir(), "gen-test/manifest.json");
    fs.writeFileSync(manifestPath, "{not json — simulated crash damage");
    await expect(
      runGeneration(opts(draftPath, { force: true }), fakeProvider()),
    ).rejects.toThrow(/corrupted.*restore it from git/s);
  });

  it("does nothing gracefully when the Bible requests no assets", async () => {
    const bible = structuredClone(showcaseBible);
    const p = path.join(dir, "no-requests.bible.json");
    fs.writeFileSync(p, JSON.stringify(bible, null, 2));
    const report = await runGeneration(opts(p), fakeProvider());
    expect(report.items).toEqual([]);
    expect(report.satisfied).toBe(true);
  });
});

describe("prompt template layer", () => {
  it("providers receive the templated prompt, never the raw brief", async () => {
    let seen = { prompt: "", seed: -1 };
    const provider = fakeProvider({
      onGenerate: (req, prompt) => (seen = { prompt, seed: req.seed }),
    });
    await runGeneration(opts(writeDraft()), provider);
    expect(seen.prompt).toContain("A tall library shelf, one glowing book.");
    expect(seen.prompt).toContain("explainer video");
    expect(seen.prompt).toContain("no watermarks");
    expect(seen.prompt).not.toBe("A tall library shelf, one glowing book.");
    // Seed is spec-derived and stable.
    expect(seen.seed).toBe(
      deterministicSeed("gen-test", "requested-one", "A tall library shelf, one glowing book."),
    );
  });
});

describe("the Object World (Sprint A)", () => {
  it("derives form deterministically: plate-referenced images are plates, the rest objects", async () => {
    const prompts = new Map<string, { form: string; prompt: string }>();
    const provider = fakeProvider({
      onGenerate: (req, prompt) =>
        prompts.set(req.assetId, { form: req.form, prompt }),
    });
    const draftPath = writeDraft((b) => {
      b.assets.push({
        kind: "image",
        id: "world",
        src: "generated/gen-test/world.png",
        intrinsicWidth: 1536,
        intrinsicHeight: 1024,
        generationBrief: "A soft dark gradient field.",
      });
      b.scenes[0].plate = "world";
    });
    await runGeneration(opts(draftPath), provider);

    expect(prompts.get("world")?.form).toBe("plate");
    expect(prompts.get("world")?.prompt).toContain("BACKGROUND PLATE");
    expect(prompts.get("world")?.prompt).toContain("no focal subject");

    expect(prompts.get("requested-one")?.form).toBe("object");
    expect(prompts.get("requested-one")?.prompt).toContain("ISOLATED SUBJECT");
    expect(prompts.get("requested-one")?.prompt).toContain("no environment");
  });

  it("transparency is the provider's implementation detail", async () => {
    let prompt = "";
    await runGeneration(
      opts(writeDraft()),
      fakeProvider({ transparent: true, onGenerate: (_r, p) => (prompt = p) }),
    );
    expect(prompt).toContain("Fully transparent background");

    fs.rmSync(publicDir(), { recursive: true, force: true });
    await runGeneration(
      opts(writeDraft()),
      fakeProvider({ transparent: false, onGenerate: (_r, p) => (prompt = p) }),
    );
    expect(prompt).toContain("#111111");
    expect(prompt).not.toContain("Fully transparent");
  });

  it("injects the Bible's visualStyle into every prompt (one wardrobe)", async () => {
    let prompt = "";
    const draftPath = writeDraft((b) => {
      b.visualStyle = "flat vector illustration, muted warm palette";
    });
    await runGeneration(
      opts(draftPath),
      fakeProvider({ onGenerate: (_r, p) => (prompt = p) }),
    );
    expect(prompt).toContain(
      "Visual style for the entire video, apply strictly: flat vector illustration, muted warm palette",
    );
  });
});

describe("retries", () => {
  it("retries retryable failures and succeeds", async () => {
    const provider = fakeProvider({ failures: [{ retryable: true }, { retryable: true }] });
    const report = await runGeneration(opts(writeDraft()), provider);
    expect(report.items[0].status).toBe("generated");
    expect(report.items[0].attempts).toBe(3);
  });

  it("fails immediately on permanent errors but continues the batch", async () => {
    const draftPath = writeDraft((b) => {
      b.assets.push({
        kind: "image",
        id: "requested-two",
        src: "generated/gen-test/two.png",
        intrinsicWidth: 1024,
        intrinsicHeight: 1024,
        generationBrief: "Second image.",
      });
    });
    // First asset hits a permanent failure; second succeeds.
    const provider = fakeProvider({ failures: [{ retryable: false }] });
    const report = await runGeneration(opts(draftPath), provider);
    expect(report.items.map((i) => i.status)).toEqual(["failed", "generated"]);
    expect(report.items[0].attempts).toBe(1);
    expect(report.satisfied).toBe(false);
  });
});

describe("canonicalization (the Asset Pipeline owns production assets)", () => {
  it("canonical output has exactly the declared dimensions, whatever the provider sent", async () => {
    // Provider returns a square raw; the Bible declares 1536x1024. The old
    // aspect *validation* is gone — the pipeline MAKES it correct.
    const provider = fakeProvider({ dims: [1024, 1024] });
    const report = await runGeneration(opts(writeDraft()), provider);
    expect(report.items[0].status).toBe("generated");
    const meta = await sharp(
      path.join(publicDir(), "generated/gen-test/one.png"),
    ).metadata();
    expect(meta.width).toBe(1536);
    expect(meta.height).toBe(1024);
    expect(meta.hasAlpha).toBe(true);
  });

  it("refuses src paths escaping the public directory", async () => {
    const draftPath = writeDraft((b) => {
      const img = b.assets.find((a) => a.id === "requested-one");
      if (img?.kind === "image") img.src = "../evil.png";
    });
    const report = await runGeneration(opts(draftPath), fakeProvider());
    expect(report.items[0].status).toBe("failed");
    expect(report.items[0].detail).toMatch(/escapes the public directory/);
  });

  it("regenerates once on a classified failure, then reports for a human", async () => {
    // A raw with real alpha but ~100% coverage: an environment, not an
    // object — classified in the alpha-carrying passthrough path, no ML.
    const data = Buffer.alloc(64 * 64 * 4, 255);
    data[3] = 0; // one transparent pixel so sourceHadAlpha is true
    const solid = await sharp(data, {
      raw: { width: 64, height: 64, channels: 4 },
    })
      .png()
      .toBuffer();
    let calls = 0;
    const provider = fakeProvider({});
    provider.generate = async () => {
      calls++;
      return { bytes: solid, format: "png", model: "fake-model-1" };
    };
    const report = await runGeneration(opts(writeDraft()), provider);
    expect(report.items[0].status).toBe("failed");
    expect(report.items[0].detail).toMatch(/environment-not-object|no-subject/);
    expect(calls).toBe(2); // original + one regeneration
    expect(report.satisfied).toBe(false);
  });
});

describe("provenance: raw + canonical, hash-chained", () => {
  it("archives the raw with its provenance and links the canonical to it", async () => {
    await runGeneration(opts(writeDraft()), fakeProvider());

    const raw = JSON.parse(
      fs.readFileSync(path.join(rawDir(), "gen-test/manifest.json"), "utf8"),
    );
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({
      assetId: "requested-one",
      src: "generated/gen-test/one.png",
      provider: "fake",
      model: "fake-model-1",
      form: "object",
      targetWidth: 1536,
      targetHeight: 1024,
      promptTemplateVersion: "object-world-v1",
      generatorVersion: GENERATOR_VERSION,
      source: "draft",
    });
    expect(raw[0].rawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(raw[0].briefSha256).toMatch(/^[0-9a-f]{64}$/);
    // The raw file itself is archived, hash-named.
    expect(fs.existsSync(path.join(rawDir(), "gen-test", raw[0].rawPath))).toBe(true);

    const canonical = JSON.parse(
      fs.readFileSync(
        path.join(publicDir(), "generated/gen-test/manifest.json"),
        "utf8",
      ),
    );
    expect(canonical).toHaveLength(1);
    expect(canonical[0]).toMatchObject({
      src: "generated/gen-test/one.png",
      assetId: "requested-one",
      pipeline: "object-v1",
      form: "object",
      source: "draft",
      rawSha256: raw[0].rawSha256, // the chain link
    });
    expect(canonical[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(canonical[0].canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
    // Runtime stack recorded (audit #2): explains byte differences between
    // re-normalizations of the same raw with the same chain, years apart.
    expect(canonical[0].runtime.node).toBe(process.version);
    expect(canonical[0].runtime.sharp).toMatch(/^\d+\.\d+\.\d+/);
    expect(canonical[0].runtime.libvips).toMatch(/^\d+\.\d+/);
    expect(canonical[0].runtime.onnxruntime).toMatch(/^\d+\.\d+\.\d+/);
    expect(canonical[0].chain.map((c: { pass: string }) => c.pass)).toEqual([
      "decode",
      "alpha-extract",
      "keep-largest-component",
      "repair-accidental-holes",
      "trim",
      "pad-center",
      "encode-canonical",
    ]);
  });
});

describe("provider registry", () => {
  it("explains itself when a named provider is unknown, incapable, or unconfigured", () => {
    expect(() => selectProvider("image", "no-such")).toThrow(/Unknown provider/);
    expect(() => selectProvider("video", "nano-banana")).toThrow(
      /cannot generate "video"/,
    );
    // Without keys in the test environment, selection fails with reasons.
    if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
      expect(() => selectProvider("image")).toThrow(/No configured provider/);
    }
  });
});
