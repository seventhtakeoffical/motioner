import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showcaseBible } from "../src/bible/showcase";
import type { Bible } from "../src/bible/schema";
import { compileApprovedBible } from "../src/compiler";
import { createDefaultRecipeRegistry } from "../src/recipes";
import { approveDraft, loadJson, reviewFile } from "./workflow";

/**
 * M13 workflow tests: the full draft → review → approve → gate lifecycle,
 * exercised against real files on disk — because the artifacts' whole job
 * is to round-trip through the filesystem into compileApprovedBible.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "motioner-review-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeDraft(mutate?: (b: Bible) => void, name = "draft.bible.json") {
  const bible = structuredClone(showcaseBible);
  mutate?.(bible);
  const draftPath = path.join(dir, name);
  fs.writeFileSync(draftPath, JSON.stringify(bible, null, 2));
  return draftPath;
}

const approvedDir = () => path.join(dir, "approved");

describe("approval workflow", () => {
  it("approves a valid draft and the gate accepts the on-disk pair", () => {
    const result = approveDraft({
      draftPath: writeDraft(),
      approvedDir: approvedDir(),
      reviewer: "kaus",
      approvedAt: "2026-07-11T12:00:00.000Z",
    });

    expect(result.approval.approvedBy).toBe("kaus");
    expect(fs.existsSync(result.biblePath)).toBe(true);
    expect(fs.existsSync(result.approvalPath)).toBe(true);

    // The production entrypoint — fed exactly what was written to disk.
    const plan = compileApprovedBible(
      loadJson(result.biblePath),
      loadJson(result.approvalPath),
      createDefaultRecipeRegistry(),
    );
    expect(plan.totalDurationInFrames).toBe(360);
  });

  it("refuses to approve a draft with validation errors, writing nothing", () => {
    const badDraft = writeDraft((b) => {
      b.scenes[0].beats[0].recipeName = "no-such-recipe";
    });
    expect(() =>
      approveDraft({
        draftPath: badDraft,
        approvedDir: approvedDir(),
        reviewer: "kaus",
        approvedAt: "2026-07-11T12:00:00.000Z",
      }),
    ).toThrow(/Refusing to approve.*validation error/s);
    expect(fs.existsSync(approvedDir())).toBe(false);
  });

  it("refuses to re-approve an artifact inside the approved directory", () => {
    const first = approveDraft({
      draftPath: writeDraft(),
      approvedDir: approvedDir(),
      reviewer: "kaus",
      approvedAt: "2026-07-11T12:00:00.000Z",
    });
    expect(() =>
      approveDraft({
        draftPath: first.biblePath, // pointing at the approved artifact itself
        approvedDir: approvedDir(),
        reviewer: "kaus",
        approvedAt: "2026-07-11T13:00:00.000Z",
      }),
    ).toThrow(/never edited or re-approved in place/);
  });
});

describe("approval invalidation after edits", () => {
  it("an edit to the approved Bible makes the approval invalid and the gate refuse", () => {
    const result = approveDraft({
      draftPath: writeDraft(),
      approvedDir: approvedDir(),
      reviewer: "kaus",
      approvedAt: "2026-07-11T12:00:00.000Z",
    });

    // Someone edits the approved artifact directly — the forbidden move.
    const edited = loadJson(result.biblePath) as Bible;
    edited.scenes[0].beats[0].narration = "sneaky edit";
    fs.writeFileSync(result.biblePath, JSON.stringify(edited, null, 2));

    // The review report says so (sibling approval auto-detected)…
    const report = reviewFile(result.biblePath);
    expect(report.approval.status).toBe("invalid");

    // …and the production gate refuses.
    expect(() =>
      compileApprovedBible(
        loadJson(result.biblePath),
        loadJson(result.approvalPath),
        createDefaultRecipeRegistry(),
      ),
    ).toThrow(/changed since it was approved/);
  });
});

describe("regenerated drafts", () => {
  it("a regenerated draft is approved fresh; the old approval dies with the old draft", () => {
    const v1 = approveDraft({
      draftPath: writeDraft(),
      approvedDir: approvedDir(),
      reviewer: "kaus",
      approvedAt: "2026-07-11T12:00:00.000Z",
    });

    // The change request comes in → a NEW draft is generated (same id).
    const v2Draft = writeDraft(
      (b) => (b.title = "Asset & recipe showcase, v2"),
      "draft-v2.bible.json",
    );
    const v2 = approveDraft({
      draftPath: v2Draft,
      approvedDir: approvedDir(),
      reviewer: "kaus",
      approvedAt: "2026-07-12T09:00:00.000Z",
    });

    // Same artifact paths (same Bible id) — the pair was replaced together.
    expect(v2.biblePath).toBe(v1.biblePath);
    expect(v2.approval.bibleHash).not.toBe(v1.approval.bibleHash);

    // The new pair is gate-valid…
    const plan = compileApprovedBible(
      loadJson(v2.biblePath),
      loadJson(v2.approvalPath),
      createDefaultRecipeRegistry(),
    );
    expect(plan.totalDurationInFrames).toBe(360);

    // …and the OLD approval does not cover the new Bible.
    expect(() =>
      compileApprovedBible(
        loadJson(v2.biblePath),
        v1.approval,
        createDefaultRecipeRegistry(),
      ),
    ).toThrow(/changed since it was approved/);
  });
});

describe("reviewFile", () => {
  it("reports a lone draft as unapproved and an approved pair as valid", () => {
    const draftPath = writeDraft();
    expect(reviewFile(draftPath).approval.status).toBe("none");

    const result = approveDraft({
      draftPath,
      approvedDir: approvedDir(),
      reviewer: "kaus",
      approvedAt: "2026-07-11T12:00:00.000Z",
    });
    expect(reviewFile(result.biblePath).approval.status).toBe("valid");
  });
});
