import { createApproval } from "./approval";
import type { Bible } from "./schema";

/**
 * The minimal fixture Bible for the M5 vertical slice: one scene, one
 * beat, one text asset, one trivial recipe. Used by the Remotion root (to
 * preview the pipeline end-to-end) and by the M6 determinism tests.
 *
 * Note `createdAt` is a fixed constant, not `new Date()` — a fixture that
 * changed on every import would itself be a source of nondeterminism.
 */
export const demoBible: Bible = {
  schemaVersion: "1",
  id: "demo-vertical-slice",
  title: "Hello, deterministic pipeline",
  createdAt: "2026-07-11T00:00:00.000Z",
  sourceScript:
    "Every frame of this video was decided before the renderer ever ran.",
  fps: 30,
  width: 1280,
  height: 720,
  assets: [
    {
      kind: "text",
      id: "headline",
      content: "Every frame of this video\nwas decided before render.",
    },
  ],
  scenes: [
    {
      id: "scene-opening",
      title: "Opening",
      beats: [
        {
          id: "beat-hello",
          narration:
            "Every frame of this video was decided before the renderer ever ran.",
          durationInFrames: 90,
          visualIntent: "The headline fades in, centered on a dark stage.",
          assetId: "headline",
          recipeName: "static-fade",
          placement: { x: 0.5, y: 0.5, scale: 1, zIndex: 0 },
        },
      ],
    },
  ],
};

/**
 * The fixture's committed self-approval. For a fixture this is honest —
 * the document above IS reviewed, by being read and committed to git; the
 * fixed timestamp keeps the module deterministic. Real Bibles get their
 * approvals from the M13 review workflow, never from the code that
 * defines them.
 */
export const demoApproval = createApproval(
  demoBible,
  "fixture",
  "2026-07-11T00:00:00.000Z",
);
