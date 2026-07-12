import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showcaseBible } from "../src/bible/showcase";
import type { Bible } from "../src/bible/schema";
import { parseBible } from "../src/bible/validate";
import { compileBible } from "../src/compiler";
import { createDefaultRecipeRegistry } from "../src/recipes";
import { sha256 } from "../asset-pipeline/framework";
import type { RenderPlan } from "../src/render-plan";
import { approveDraft, reviewFile } from "../review/workflow";
import {
  compileDraftPlan,
  compilePlanFromFiles,
  preflightPlanAssets,
  readJson,
} from "./run";

/**
 * M14 end-to-end tests: the complete production workflow, on disk, through
 * the same functions the pipeline CLI calls.
 *
 * The Author stage is simulated by writing a known-good draft to drafts/ —
 * the live Claude call is non-deterministic and needs credentials, so it
 * has no place in a test suite whose promise is byte-reproducibility. What
 * IS covered is everything the author's output must survive afterward:
 * review, approval, the gate, and compilation into the final plan.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "motioner-pipeline-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function simulateAuthor(mutate?: (b: Bible) => void): string {
  const bible = structuredClone(showcaseBible);
  bible.id = "e2e-video";
  mutate?.(bible);
  const draftsDir = path.join(dir, "drafts");
  fs.mkdirSync(draftsDir, { recursive: true });
  const draftPath = path.join(draftsDir, `${bible.id}.bible.json`);
  fs.writeFileSync(draftPath, JSON.stringify(bible, null, 2));
  return draftPath;
}

describe("the complete workflow: script → author → review → approve → render", () => {
  it("flows a draft through every stage into a render-ready plan", () => {
    // 1. Author (simulated): a draft lands in drafts/.
    const draftPath = simulateAuthor();

    // 2. Review: the report passes and shows an unapproved draft.
    const review = reviewFile(draftPath, showcaseBible.sourceScript);
    expect(review.ok).toBe(true);
    expect(review.approval.status).toBe("none");

    // 3. Approve: the pair lands in approved/.
    const approved = approveDraft({
      draftPath,
      approvedDir: path.join(dir, "approved"),
      reviewer: "kaus",
      approvedAt: "2026-07-11T12:00:00.000Z",
    });

    // 4. Render stage, up to its deterministic boundary: files → gate → plan.
    const plan = compilePlanFromFiles(approved.biblePath, approved.approvalPath);
    expect(plan.totalDurationInFrames).toBe(360);
    expect(plan.scenes).toHaveLength(3);
    expect(plan.manifest).toEqual([{ kind: "image", src: "sample-image.svg" }]);

    // The pipeline's plan is byte-identical to compiling the Bible pure —
    // the workflow added trust, not transformation.
    const direct = compileBible(
      parseBible(readJson(approved.biblePath, "Bible")),
      createDefaultRecipeRegistry(),
    );
    expect(JSON.stringify(plan)).toBe(JSON.stringify(direct));
  });

  it("refuses to render a draft: no approval, no plan", () => {
    const draftPath = simulateAuthor();
    // There is no approval file for a draft — any path handed to the render
    // stage fails loudly and names the missing piece.
    expect(() =>
      compilePlanFromFiles(draftPath, draftPath.replace(".bible.", ".approval.")),
    ).toThrow(/Cannot read the approval file/);

    // Even a well-formed but wrong approval is refused by the gate.
    const other = approveDraft({
      draftPath: simulateAuthor((b) => (b.id = "some-other-video")),
      approvedDir: path.join(dir, "approved"),
      reviewer: "kaus",
      approvedAt: "2026-07-11T12:00:00.000Z",
    });
    expect(() => compilePlanFromFiles(draftPath, other.approvalPath)).toThrow(
      /Refusing to render.*Approval is for Bible/s,
    );
  });
});

describe("post-approval modification kills rendering", () => {
  it("an edit to the approved Bible makes the render stage refuse", () => {
    const approved = approveDraft({
      draftPath: simulateAuthor(),
      approvedDir: path.join(dir, "approved"),
      reviewer: "kaus",
      approvedAt: "2026-07-11T12:00:00.000Z",
    });

    // Sanity: it renders (compiles) before the tamper.
    expect(() =>
      compilePlanFromFiles(approved.biblePath, approved.approvalPath),
    ).not.toThrow();

    // The tamper: one character of narration in the APPROVED artifact.
    const bible = readJson(approved.biblePath, "Bible") as Bible;
    bible.scenes[0].beats[0].narration += "!";
    fs.writeFileSync(approved.biblePath, JSON.stringify(bible, null, 2));

    expect(() =>
      compilePlanFromFiles(approved.biblePath, approved.approvalPath),
    ).toThrow(/Refusing to render.*changed since it was approved/s);
  });
});

describe("draft preview (M15 — sighted review)", () => {
  it("compiles a DRAFT to a plan through the pure core, no approval involved", () => {
    const draftPath = simulateAuthor();
    const plan = compileDraftPlan(draftPath);
    expect(plan.totalDurationInFrames).toBe(360);
  });

  it("still refuses invalid drafts with the gate's own error", () => {
    const badPath = simulateAuthor((b) => {
      b.scenes[0].beats[0].recipeName = "no-such-recipe";
    });
    expect(() => compileDraftPlan(badPath)).toThrow(/Compile error/);
    expect(() => compileDraftPlan(path.join(dir, "missing.json"))).toThrow(
      /Cannot read the draft Bible file/,
    );
  });
});

describe("asset preflight (audit SHOULD-FIX #1)", () => {
  const planWith = (src: string): RenderPlan =>
    ({
      fps: 30,
      width: 1280,
      height: 720,
      totalDurationInFrames: 1,
      scenes: [],
      beats: [],
      manifest: [{ kind: "image", src }],
    }) as unknown as RenderPlan;

  const pub = () => path.join(dir, "public");

  it("passes when the file exists and no provenance manifest is present", () => {
    fs.mkdirSync(pub(), { recursive: true });
    fs.writeFileSync(path.join(pub(), "loose.png"), "pixels");
    expect(() => preflightPlanAssets(planWith("loose.png"), pub())).not.toThrow();
  });

  it("fails loudly on missing files, naming them", () => {
    fs.mkdirSync(pub(), { recursive: true });
    expect(() => preflightPlanAssets(planWith("generated/x/gone.png"), pub())).toThrow(
      /preflight failed[\s\S]*MISSING: "generated\/x\/gone\.png"/,
    );
  });

  it("verifies canonical hashes and catches post-generation drift", () => {
    const assetDir = path.join(pub(), "generated/x");
    fs.mkdirSync(assetDir, { recursive: true });
    const bytes = Buffer.from("canonical pixels");
    fs.writeFileSync(path.join(assetDir, "a.png"), bytes);
    fs.writeFileSync(
      path.join(assetDir, "manifest.json"),
      JSON.stringify([
        { src: "generated/x/a.png", canonicalSha256: sha256(bytes) },
      ]),
    );
    // Matching hash: passes.
    expect(() =>
      preflightPlanAssets(planWith("generated/x/a.png"), pub()),
    ).not.toThrow();
    // The asset drifts after generation: refused.
    fs.writeFileSync(path.join(assetDir, "a.png"), "tampered pixels");
    expect(() =>
      preflightPlanAssets(planWith("generated/x/a.png"), pub()),
    ).toThrow(/DRIFTED: "generated\/x\/a\.png"[\s\S]*regenerate it or restore/);
  });

  it("skips remote URLs and refuses corrupted provenance manifests", () => {
    fs.mkdirSync(pub(), { recursive: true });
    expect(() =>
      preflightPlanAssets(planWith("https://example.com/remote.png"), pub()),
    ).not.toThrow();

    const assetDir = path.join(pub(), "generated/y");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "b.png"), "pixels");
    fs.writeFileSync(path.join(assetDir, "manifest.json"), "{corrupt");
    expect(() =>
      preflightPlanAssets(planWith("generated/y/b.png"), pub()),
    ).toThrow(/corrupted.*Restore it from git/s);
  });
});

describe("render-stage error messages", () => {
  it("names the stage for missing and malformed files", () => {
    expect(() => readJson(path.join(dir, "nope.json"), "Bible")).toThrow(
      /Cannot read the Bible file/,
    );
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{not json");
    expect(() => readJson(bad, "approval")).toThrow(
      /approval file .* is not valid JSON/,
    );
  });
});
