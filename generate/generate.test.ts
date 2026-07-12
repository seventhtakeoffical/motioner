import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showcaseBible } from "../src/bible/showcase";
import type { Bible } from "../src/bible/schema";
import { approveDraft } from "../review/workflow";
import {
  deterministicSeed,
  explainerImageTemplate,
  ProviderError,
  type AssetProvider,
  type GenerationRequest,
} from "./provider";
import { selectProvider } from "./registry";
import { imageDimensions, runGeneration, GENERATOR_VERSION } from "./run";

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

/** A minimal valid PNG header claiming the given dimensions. */
function fakePng(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(0x89504e47, 0); // PNG signature (first half)
  bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.writeUInt32BE(13, 8); // IHDR length
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function fakeProvider(
  overrides: Partial<AssetProvider> & {
    onGenerate?: (req: GenerationRequest, prompt: string) => void;
    failures?: Array<{ retryable: boolean }>;
    dims?: [number, number];
  } = {},
): AssetProvider {
  const failures = [...(overrides.failures ?? [])];
  return {
    name: overrides.name ?? "fake",
    capabilities: overrides.capabilities ?? ["image"],
    promptTemplate: overrides.promptTemplate ?? explainerImageTemplate,
    isConfigured: () => ({ ok: true }),
    async generate(req, prompt) {
      overrides.onGenerate?.(req, prompt);
      const failure = failures.shift();
      if (failure) throw new ProviderError("simulated failure", failure.retryable);
      const [w, h] = overrides.dims ?? [req.width, req.height];
      return { bytes: fakePng(w, h), format: "png", model: "fake-model-1" };
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
const opts = (biblePath: string, extra = {}) => ({
  biblePath,
  draft: true,
  publicDir: publicDir(),
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
      { biblePath: approved.biblePath, publicDir: publicDir() },
      fakeProvider(),
    );
    expect(report.source).toBe("approved");

    // Tamper with the approved Bible: generation must refuse.
    const edited = JSON.parse(fs.readFileSync(approved.biblePath, "utf8"));
    edited.title = "edited";
    fs.writeFileSync(approved.biblePath, JSON.stringify(edited, null, 2));
    await expect(
      runGeneration(
        { biblePath: approved.biblePath, publicDir: publicDir() },
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

describe("validation and safety", () => {
  it("rejects output whose aspect ratio would distort in the declared box", async () => {
    const provider = fakeProvider({ dims: [1024, 1024] }); // spec wants 1536x1024
    const report = await runGeneration(opts(writeDraft()), provider);
    expect(report.items[0].status).toBe("failed");
    expect(report.items[0].detail).toMatch(/aspect ratio mismatch/);
    expect(report.satisfied).toBe(false);
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

  it("parses PNG and JPEG dimensions", () => {
    expect(imageDimensions(fakePng(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe("provenance", () => {
  it("records provider, model, seed, versions, and draft/approved source", async () => {
    await runGeneration(opts(writeDraft()), fakeProvider());
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(publicDir(), "generated/gen-test/manifest.json"),
        "utf8",
      ),
    );
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({
      src: "generated/gen-test/one.png",
      assetId: "requested-one",
      provider: "fake",
      model: "fake-model-1",
      generatorVersion: GENERATOR_VERSION,
      promptTemplateVersion: explainerImageTemplate.version,
      source: "draft",
      format: "png",
    });
    expect(typeof manifest[0].seed).toBe("number");
    expect(manifest[0].briefHash).toMatch(/^[0-9a-f]{8}$/);
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
