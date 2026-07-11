import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showcaseBible } from "../src/bible/showcase";
import type { Bible } from "../src/bible/schema";
import { parseBible } from "../src/bible/validate";
import { compileBible } from "../src/compiler";
import { createDefaultRecipeRegistry } from "../src/recipes";
import { approveDraft, reviewFile } from "../review/workflow";
import { compilePlanFromFiles, readJson } from "./run";

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
