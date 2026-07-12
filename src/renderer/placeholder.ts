import type { RenderPlan } from "../render-plan";

/**
 * What the Studio shows when no Render Plan has been supplied (M14). This
 * is a hand-written, valid RenderPlan literal — NOT a compiled fixture: as
 * of M14 nothing compiles at bundle load, so the render bundle contains no
 * Bibles, no compiler invocation, and no demo content. Real plans arrive
 * exclusively as input props, compiled by the pipeline CLI from an
 * approved Bible + approval pair.
 */
export const placeholderPlan: RenderPlan = {
  fps: 30,
  width: 1280,
  height: 720,
  totalDurationInFrames: 90,
  scenes: [
    {
      id: "placeholder",
      title: "No Render Plan supplied",
      startFrame: 0,
      durationInFrames: 90,
    },
  ],
  beats: [
    {
      id: "placeholder/no-plan",
      sceneId: "placeholder",
      startFrame: 0,
      durationInFrames: 90,
      camera: { x: 0.5, y: 0.5, zoom: 1 },
      theme: { backgroundColor: "#111111", foregroundColor: "#ffffff" },
      layers: [
        {
          entityId: "placeholder-message",
          role: "enter",
          recipeName: "static-fade",
          params: {},
          asset: {
            kind: "text",
            id: "placeholder-message",
            content:
              "No Render Plan supplied.\n\nCompile an approved Bible:\n" +
              "npm run pipeline -- preview <bible.json> <approval.json>",
          },
          placement: { assetId: "placeholder-message", x: 0.5, y: 0.5, scale: 0.5, zIndex: 0 },
        },
      ],
    },
  ],
  manifest: [],
};
