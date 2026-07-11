import { createApproval } from "./approval";
import type { Bible } from "./schema";

/**
 * The M8/M9 showcase fixture: five beats exercising the expanded asset
 * kinds (text, image, chart, icon, caption) against the expanded recipe
 * library (typewriter, pan-zoom, draw-on, pop-in, slide-in). Like the M5
 * demo it is a committed, self-approved fixture with a fixed timestamp.
 * (Video/audio kinds are exercised by the type system and renderer switch,
 * but need real media files — they get fixtures when real scripts do.)
 */
export const showcaseBible: Bible = {
  schemaVersion: "1",
  id: "showcase-m8-m9",
  title: "Asset & recipe showcase",
  createdAt: "2026-07-11T00:00:00.000Z",
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
      id: "scene-headline",
      title: "Typed headline",
      beats: [
        {
          id: "beat-typewriter",
          narration: "Charts that draw themselves.",
          durationInFrames: 75,
          visualIntent: "The headline types itself out, centered.",
          assetId: "headline",
          recipeName: "typewriter",
          placement: { x: 0.5, y: 0.5, scale: 1, zIndex: 0 },
        },
      ],
    },
    {
      id: "scene-imagery",
      title: "Drifting imagery",
      beats: [
        {
          id: "beat-panzoom",
          narration: "Imagery drifts slowly, alive but unhurried.",
          durationInFrames: 90,
          visualIntent: "The mountain image slowly zooms and drifts left.",
          assetId: "mountains",
          recipeName: "pan-zoom",
          placement: { x: 0.5, y: 0.5, scale: 0.55, zIndex: 0 },
        },
      ],
    },
    {
      id: "scene-data",
      title: "Self-drawing chart",
      beats: [
        {
          id: "beat-drawon",
          narration: "Adoption grew year over year.",
          durationInFrames: 90,
          visualIntent: "A bar chart draws on, one year at a time.",
          assetId: "adoption-chart",
          recipeName: "draw-on",
          placement: { x: 0.5, y: 0.5, scale: 1.2, zIndex: 0 },
        },
      ],
    },
    {
      id: "scene-icon",
      title: "Icon punctuation",
      beats: [
        {
          id: "beat-popin",
          narration: "Fast.",
          durationInFrames: 45,
          visualIntent: "A lightning bolt icon pops in at center.",
          assetId: "bolt",
          recipeName: "pop-in",
          placement: { x: 0.5, y: 0.48, scale: 1, zIndex: 0 },
        },
      ],
    },
    {
      id: "scene-caption",
      title: "Closing caption",
      beats: [
        {
          id: "beat-caption",
          narration: "Deterministic by construction.",
          durationInFrames: 60,
          visualIntent: "The tagline slides in as a lower-third caption.",
          assetId: "tagline",
          recipeName: "slide-in",
          placement: { x: 0.5, y: 0.85, scale: 1, zIndex: 1 },
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
