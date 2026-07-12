import { describe, expect, it } from "vitest";
import { createApproval } from "../src/bible/approval";
import { showcaseBible } from "../src/bible/showcase";
import type { Bible } from "../src/bible/schema";
import { buildReviewReport, renderReport } from "./report";

function draft(mutate?: (b: Bible) => void): Bible {
  const b = structuredClone(showcaseBible);
  mutate?.(b);
  return b;
}

describe("review report — validation", () => {
  it("passes a valid draft and carries the compiled plan", () => {
    const report = buildReviewReport({ bible: draft() });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.plan?.totalDurationInFrames).toBe(360);
  });

  it("surfaces schema errors from the real parser", () => {
    const report = buildReviewReport({ bible: { id: "x" } });
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/Invalid Production Bible/);
    expect(report.bible).toBeUndefined();
  });

  it("surfaces compiler errors from the real compiler", () => {
    const report = buildReviewReport({
      bible: draft((b) => (b.scenes[0].beats[0].recipeName = "does-not-exist")),
    });
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/Compile error.*does-not-exist/);
  });
});

describe("review report — warnings and missing info", () => {
  it("flags narration too fast for its beat", () => {
    const words = Array(40).fill("word").join(" ");
    const report = buildReviewReport({
      bible: draft((b) => (b.scenes[0].beats[0].narration = words)),
    });
    expect(report.warnings.join("\n")).toMatch(/too fast to speak/);
  });

  it("flags a dragging beat only when there is real narration", () => {
    const report = buildReviewReport({
      bible: draft((b) => {
        b.scenes[0].beats[0].narration =
          "eight whole words of narration are spoken here"; // 8 words
        b.scenes[0].beats[0].durationInFrames = 300; // 10s → 0.8 wps
      }),
    });
    expect(report.warnings.join("\n")).toMatch(/may drag/);
    // The showcase's own short beats ("Fast." at 1.5s) must NOT warn:
    expect(buildReviewReport({ bible: draft() }).warnings.join("\n")).not.toMatch(
      /may drag/,
    );
  });

  it("flags a script/sourceScript mismatch", () => {
    const report = buildReviewReport({
      bible: draft(),
      scriptText: "a completely different script",
    });
    expect(report.warnings.join("\n")).toMatch(/does not match/);
    // And no warning when they agree:
    expect(
      buildReviewReport({
        bible: draft(),
        scriptText: showcaseBible.sourceScript,
      }).warnings.join("\n"),
    ).not.toMatch(/does not match/);
  });

  it("flags declared-but-never-featured assets", () => {
    const report = buildReviewReport({
      bible: draft((b) =>
        b.assets.push({ kind: "text", id: "orphan", content: "unused" }),
      ),
    });
    expect(report.warnings.join("\n")).toMatch(/"orphan".*never featured/);
  });

  it("asks the reviewer to verify media files exist", () => {
    const report = buildReviewReport({ bible: draft() });
    expect(report.missingInfo.join("\n")).toMatch(/sample-image\.svg/);
  });

  it("checks media against supplied filesystem facts (M15)", () => {
    // Present on disk → no missing-info entry.
    const present = buildReviewReport({
      bible: draft(),
      existingMedia: ["sample-image.svg"],
    });
    expect(present.missingInfo).toEqual([]);
    // Absent → an explicit NOT-on-disk entry.
    const absent = buildReviewReport({ bible: draft(), existingMedia: [] });
    expect(absent.missingInfo.join("\n")).toMatch(/NOT on disk.*sample-image\.svg/);
  });
});

describe("asset requests (M15)", () => {
  it("lists requested images with their briefs, and flags them as to-generate", () => {
    const report = buildReviewReport({
      bible: draft((b) =>
        b.assets.push({
          kind: "image",
          id: "library-shelf",
          src: "generated/showcase/library-shelf.png",
          intrinsicWidth: 1536,
          intrinsicHeight: 1024,
          generationBrief:
            "Warm flat illustration of a tall library shelf, one book glowing.",
        }),
      ),
      existingMedia: ["sample-image.svg"],
    });
    expect(report.assetRequests.join("\n")).toMatch(
      /"library-shelf".*generated\/showcase\/library-shelf\.png.*1536x1024.*one book glowing/,
    );
    expect(report.missingInfo.join("\n")).toMatch(
      /NOT on disk.*library-shelf.*requested asset; generate it/,
    );
    // Warned as unused too (nothing features it) — that's correct and separate.
    expect(renderReport(report)).toContain("Asset requests (to be generated)");
  });
});

describe("review report — observable assumptions", () => {
  it("lists chart data, icon geometry, and non-verbatim copy", () => {
    const assumptions = buildReviewReport({ bible: draft() }).assumptions.join("\n");
    // Chart values spelled out for verification.
    expect(assumptions).toMatch(/adoption-chart.*2023=12.*2026=89/);
    // Model-authored icon geometry.
    expect(assumptions).toMatch(/icon "bolt".*model-authored/);
    // "Deterministic by construction" is not verbatim in the script.
    expect(assumptions).toMatch(/caption "tagline".*not found verbatim/);
    // The headline IS verbatim ("charts that draw themselves") — not flagged.
    expect(assumptions).not.toMatch(/text "headline"/);
  });

  it("lists camera and theme directives as decisions to verify", () => {
    const report = buildReviewReport({
      bible: draft((b) => {
        b.scenes[0].beats[0].theme = {
          backgroundColor: "#f4f1ea",
          foregroundColor: "#111111",
        };
      }),
    });
    const assumptions = report.assumptions.join("\n");
    expect(assumptions).toMatch(/changes the theme to bg #f4f1ea/);
    expect(assumptions).toMatch(/cuts the camera/); // showcase's own zoom cuts
  });
});

describe("review report — approval status", () => {
  it("reports none / valid / invalid-after-edit", () => {
    expect(buildReviewReport({ bible: draft() }).approval.status).toBe("none");

    const b = draft();
    const approval = createApproval(b, "reviewer", "2026-07-11T12:00:00.000Z");
    expect(
      buildReviewReport({ bible: b, approval }).approval.status,
    ).toBe("valid");

    const edited = structuredClone(b);
    edited.title = "Edited after approval";
    const status = buildReviewReport({ bible: edited, approval }).approval;
    expect(status.status).toBe("invalid");
    expect(status.status === "invalid" && status.detail).toMatch(
      /changed since it was approved/,
    );
  });
});

describe("rendered report", () => {
  it("contains every requested section for a valid draft", () => {
    const text = renderReport(buildReviewReport({ bible: draft() }));
    for (const heading of [
      "PRODUCTION BIBLE REVIEW",
      "Approval: NONE",
      "Validation: PASSED",
      "Warnings",
      "Missing information",
      "Assumptions to verify",
      "Estimated runtime",
      "Scene breakdown",
      "Assets",
      "Recipe usage",
      "Continuity",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toMatch(/12\.0s — 360 frames @ 30 fps/);
    // Continuity narrative: the headline is struck at the scene boundary.
    expect(text).toMatch(
      /headline: enters scene-data-story\/beat-typewriter, held 2 beat\(s\), exits scene-punctuation\/beat-popin \(scene strike\)/,
    );
    // Compiler-emitted continuity recipes are counted.
    expect(text).toMatch(/hold: 3/);
    expect(text).toMatch(/exit-fade: 4/);
  });

  it("renders a failed draft without the plan-derived sections", () => {
    const text = renderReport(buildReviewReport({ bible: { nope: 1 } }));
    expect(text).toContain("Validation: FAILED");
    expect(text).not.toContain("Scene breakdown");
  });
});
