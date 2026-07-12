<!--
Craft guidance: pacing math, staging conventions, and quality bar for draft
Bibles. Maintenance note: numbers here (defaults, pacing constants) are
authoring POLICY, not schema facts — changing them changes draft style, not
validity. The recipe/asset vocabulary tables are NOT here; author.ts
generates those from the live code so they cannot drift.
-->

# Authoring guide

## Defaults (use unless the task input overrides)

- `fps: 30`, `width: 1280`, `height: 720`.
- Theme: dark stage — background `#111111`, foreground `#ffffff`. Set a
  `theme` directive only when the script's tone genuinely calls for a
  palette change.

## Pacing math

Narration reads at roughly 150 words per minute — **2.5 words per second**.
For each beat:

1. Count the narration's words.
2. Seconds ≈ words / 2.5, plus ~0.5s of breathing room.
3. `durationInFrames = ceil(seconds × fps)`, rounded up to a multiple of 15.

Never go below the featured recipe's `minDurationInFrames`, and keep any
beat that exits assets (or opens a scene after the first) at 15 frames or
more so the 12-frame exit fade fits. Beats shorter than 30 frames feel
abrupt; use them only for deliberate punctuation. A typical explainer beat
is 60–120 frames.

## Staging conventions

- **Layout zones** (normalized coordinates): headlines around `y: 0.15–0.25`;
  main visual (chart, image, icon) around `y: 0.5–0.6`; captions/lower
  thirds at `y: 0.85–0.9`. Keep centers within `x: 0.2–0.8` unless staging
  an offscreen entrance.
- **zIndex**: background imagery 0, primary content 0–1, captions/overlays
  1–2. Ties are fine; stacking among equal z is deterministic.
- **Composition over clutter**: two or three simultaneous entities is a
  rich stage. If a new topic starts, prefer a new scene (automatic clear)
  over manually exiting everything.
- **Camera**: use sparingly — a push-in (`zoom: 1.2–1.4`) for emphasis, and
  reset (`zoom: 1`) when the emphasis passes. Remember it carries across
  scenes until reset.
- **Scene grammar**: scene = one staged composition. When the script moves
  to a new idea whose visuals share nothing with the current stage, that is
  a scene boundary — the compiler will fade out the old set automatically
  during your new scene's first beat.

## Show the metaphor — don't caption it

The weakest draft is a wall of text cards paraphrasing the narration the
viewer is already hearing. Production feedback is explicit on this:

- **Every scene should have a visual anchor that is not text** — an icon,
  a chart, or a requested image. Reach for a text asset only for the
  punchline the viewer should read (a key term, a number, the takeaway),
  not for restating narration.
- When the script describes something concrete (a place, an object, a
  process), prefer an **Asset Request**: declare an image with a
  `generationBrief` that an image generator could execute verbatim —
  subject, composition, camera angle, style, mood, and "no text in the
  image". One strong requested image beats three text cards.
- **Cap typed on-screen copy at ~8 words.** Long typewriter passages force
  the viewer to read and listen simultaneously; if the line matters that
  much, let the narration carry it and show a shorter fragment.
- Match motion to the words: a thing that "drops" enters with
  `slide-in` + `{"direction": "top"}`; a thing that is "ripped out" or
  "thrown away" exits via `exitRecipeName: "exit-slide"` with a fitting
  direction. When narration names a motion, the choreography should
  perform it.

## Choosing recipes

Match the recipe to the asset's role in the story (the generated vocabulary
table lists each recipe's requirements and minimum duration):

- Headlines being read aloud → `typewriter` (types in sync with narration).
- Data making an argument → `draw-on` (the chart draws itself).
- Punctuation and emphasis → `pop-in`.
- Imagery that should feel alive → `pan-zoom`.
- Quiet arrivals (captions, secondary text) → `slide-in` or `static-fade`.
- `hold` exists mainly for the compiler; feature it only for a beat whose
  featured asset should simply appear with no animation at all.

## Quality bar for a good draft

- Narration, read aloud at 150 wpm, fits each beat's duration.
- Every `visualIntent` would let a reviewer who has NOT read your JSON
  predict roughly what the frame looks like.
- The stage never holds an entity the current narration has abandoned.
- Chart data, on-screen text, and captions are all traceable to the script.
- The whole video's duration (sum of all beats ÷ fps) suits the script —
  a 100-word script is ~40–50 seconds, not three minutes.
