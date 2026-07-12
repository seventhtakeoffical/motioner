import { createApproval } from "./approval";
import type { Bible } from "./schema";

/**
 * The showcase fixture: five beats exercising the M8 asset kinds (text,
 * image, chart, icon, caption), the M9 recipe library (typewriter,
 * pan-zoom, draw-on, pop-in, slide-in), and — since M10 — real stage
 * continuity: the headline persists while the chart draws and the caption
 * slides in beneath both. The stage-clears are scene boundaries (M11):
 * crossing into scene 2 auto-strikes the composed trio while the icon pops
 * in under a camera push-in; crossing into scene 3 strikes the icon,
 * resets the camera, and closes on drifting imagery — no manual exit
 * directives anywhere. Like the M5 demo it is a committed, self-approved
 * fixture with a fixed timestamp. (Video/audio kinds are exercised by the
 * type system and renderer switch, but need real media files — they get
 * fixtures when real scripts do.)
 */
export const showcaseBible: Bible = {
  schemaVersion: "1",
  id: "showcase-m8-m9",
  title: "Asset & recipe showcase",
  createdAt: "2026-07-11T00:00:00.000Z",
  visualStyle:
    "flat modern illustration, minimal gradients, soft shadows, muted " +
    "palette on a dark stage, no photorealism",
  sourceScript:
    "A tour of what the pipeline can stage: typed-on headlines, drifting " +
    "imagery, charts that draw themselves, icons that pop, and captions " +
    "that slide into place.",
  fps: 30,
  width: 1280,
  height: 720,
  assets: [
    {
      kind: "text",
      id: "headline",
      content: "Charts that draw themselves.",
    },
    {
      kind: "image",
      id: "mountains",
      src: "sample-image.svg",
      intrinsicWidth: 1600,
      intrinsicHeight: 900,
    },
    {
      kind: "chart",
      id: "adoption-chart",
      chartType: "bar",
      data: [
        { label: "2023", value: 12 },
        { label: "2024", value: 31 },
        { label: "2025", value: 54 },
        { label: "2026", value: 89 },
      ],
    },
    {
      kind: "icon",
      id: "bolt",
      viewBox: "0 0 24 24",
      path: "M13 2 L4.5 13.5 H10.5 L9 22 L19.5 9.5 H12.5 Z",
    },
    {
      kind: "caption",
      id: "tagline",
      content: "Deterministic by construction",
    },
  ],
  scenes: [
    {
      id: "scene-data-story",
      title: "A headline, its chart, and its caption — composed",
      beats: [
        {
          id: "beat-typewriter",
          narration: "Charts that draw themselves.",
          durationInFrames: 75,
          visualIntent: "The headline types itself out, upper third.",
          assetId: "headline",
          recipeName: "typewriter",
          placement: { x: 0.5, y: 0.18, scale: 0.8, zIndex: 0 },
        },
        {
          id: "beat-drawon",
          narration: "Adoption grew year over year.",
          durationInFrames: 90,
          visualIntent:
            "While the headline stays put, a bar chart draws on beneath it.",
          assetId: "adoption-chart",
          recipeName: "draw-on",
          placement: { x: 0.5, y: 0.55, scale: 1.05, zIndex: 0 },
        },
        {
          id: "beat-caption",
          narration: "Deterministic by construction.",
          durationInFrames: 60,
          visualIntent:
            "Headline and chart hold; the tagline slides in as a lower-third.",
          assetId: "tagline",
          recipeName: "slide-in",
          placement: { x: 0.5, y: 0.9, scale: 1, zIndex: 1 },
        },
      ],
    },
    {
      id: "scene-punctuation",
      title: "Clear the stage, punch in",
      beats: [
        {
          id: "beat-popin",
          narration: "Fast.",
          durationInFrames: 45,
          visualIntent:
            "Everything fades out; a lightning bolt pops in under a camera push-in.",
          assetId: "bolt",
          recipeName: "pop-in",
          placement: { x: 0.5, y: 0.48, scale: 1, zIndex: 0 },
          camera: { zoom: 1.25 },
        },
      ],
    },
    {
      id: "scene-closing",
      title: "Closing imagery",
      beats: [
        {
          id: "beat-panzoom",
          narration: "Imagery drifts slowly, alive but unhurried.",
          durationInFrames: 90,
          visualIntent:
            "The bolt fades away, the camera settles back, and the mountains drift.",
          assetId: "mountains",
          recipeName: "pan-zoom",
          placement: { x: 0.5, y: 0.5, scale: 0.55, zIndex: 0 },
          camera: { zoom: 1 },
        },
      ],
    },
  ],
};

export const showcaseApproval = createApproval(
  showcaseBible,
  "fixture",
  "2026-07-11T00:00:00.000Z",
);
