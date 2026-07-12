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
    expect(report.warnings.join("\n")).toMatch(/"orphan".*never used/);
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

describe("review report — Visual Grammar checks (Sprint A)", () => {
  const grammar = (b: Bible) =>
    buildReviewReport({ bible: b }).warnings.filter((w) => w.startsWith("Grammar:"));

  it("warns on missing visualStyle only when generation is in play (P13)", () => {
    const withBrief = draft((b) => {
      delete (b as { visualStyle?: string }).visualStyle;
      b.assets.push({
        kind: "image",
        id: "req",
        src: "generated/x/req.png",
        intrinsicWidth: 1024,
        intrinsicHeight: 1024,
        generationBrief: "A key.",
      });
    });
    expect(grammar(withBrief).join("\n")).toMatch(/no visualStyle directive/);
    // With a style present, no warning.
    expect(grammar(draft()).join("\n")).not.toMatch(/visualStyle/);
  });

  it("warns on scenes without a world plate (P1/P3)", () => {
    expect(grammar(draft()).join("\n")).toMatch(
      /without a world plate: scene-data-story, scene-punctuation, scene-closing/,
    );
  });

  it("warns when a plate asset is also featured by beats", () => {
    const b = draft((d) => (d.scenes[0].plate = "mountains"));
    expect(grammar(b).join("\n")).toMatch(/"mountains".*plate AND is featured/);
  });

  it("warns on sentence-length typography (P9)", () => {
    const b = draft((d) =>
      d.assets.push({
        kind: "text",
        id: "wall",
        content: "this is nine whole words of prose on screen",
      }),
    );
    expect(grammar(b).join("\n")).toMatch(/"wall" is 9 words/);
  });

  it("warns on briefs that invite baked lettering (P13)", () => {
    const b = draft((d) =>
      d.assets.push({
        kind: "image",
        id: "sign",
        src: "generated/x/sign.png",
        intrinsicWidth: 1024,
        intrinsicHeight: 1024,
        generationBrief: "A shopfront with a big neon sign and logo.",
      }),
    );
    expect(grammar(b).join("\n")).toMatch(/"sign" mentions lettering-like content/);

    // Negations don't trip it — "no text in image" PREVENTS baked text.
    const negated = draft((d) =>
      d.assets.push({
        kind: "image",
        id: "clean",
        src: "generated/x/clean.png",
        intrinsicWidth: 1024,
        intrinsicHeight: 1024,
        generationBrief: "A single closed book, warm colors, no text in image.",
      }),
    );
    expect(grammar(negated).join("\n")).not.toMatch(/"clean"/);
  });

  it("plate usage counts as usage: plates don't warn as unused", () => {
    const b = draft((d) => {
      d.assets.push({
        kind: "image",
        id: "world",
        src: "generated/x/world.png",
        intrinsicWidth: 1536,
        intrinsicHeight: 864,
        generationBrief: "A soft gradient field.",
      });
      d.scenes[0].plate = "world";
    });
    expect(
      buildReviewReport({ bible: b }).warnings.join("\n"),
    ).not.toMatch(/"world".*never used/);
  });

  it("warns when more than 7 elements share a window (P14)", () => {
    const b = draft((d) => {
      const scene = d.scenes[0];
      for (let i = 0; i < 8; i++) {
        d.assets.push({ kind: "text", id: `t${i}`, content: `item ${i}` });
        scene.beats.push({
          id: `beat-crowd-${i}`,
          narration: "More.",
          durationInFrames: 60,
          visualIntent: "crowding",
          assetId: `t${i}`,
          recipeName: "static-fade",
          placement: { x: 0.1 + i * 0.1, y: 0.5, scale: 1, zIndex: 0 },
        });
      }
    });
    expect(grammar(b).join("\n")).toMatch(/simultaneous elements/);
  });

  it("warns when nothing persists (no hero, P4)", () => {
    const b = draft((d) => {
      // Rebuild as churn: every beat replaces the previous asset.
      d.scenes = [
        {
          id: "churn",
          title: "Churn",
          beats: ["a", "b", "c", "d"].map((name, i) => ({
            id: `beat-${name}`,
            narration: "Next.",
            durationInFrames: 60,
            visualIntent: "swap",
            assetId: name,
            recipeName: "static-fade",
            placement: { x: 0.5, y: 0.5, scale: 1, zIndex: 0 },
            ...(i > 0 ? { exit: [["a", "b", "c"][i - 1]] } : {}),
          })),
        },
      ];
      d.assets = ["a", "b", "c", "d"].map((name) => ({
        kind: "text" as const,
        id: name,
        content: name,
      }));
    });
    expect(grammar(b).join("\n")).toMatch(/no persistent hero/);
    // The showcase HAS a hero (headline spans 3 windows): no warning.
    expect(grammar(draft()).join("\n")).not.toMatch(/no persistent hero/);
  });

  it("warns when full-frame imagery dominates the runtime (P10)", () => {
    const b = draft((d) => {
      // Feature the 1600x900 image at cover scale for a long final beat.
      d.scenes[2].beats[0].placement = { x: 0.5, y: 0.5, scale: 1, zIndex: 0 };
      d.scenes[2].beats[0].durationInFrames = 300;
    });
    expect(grammar(b).join("\n")).toMatch(/full-frame imagery covers/);
    // The normal showcase (mountains at 0.55 scale) stays quiet.
    expect(grammar(draft()).join("\n")).not.toMatch(/full-frame imagery/);
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
