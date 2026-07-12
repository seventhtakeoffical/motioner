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
- ALWAYS write a `visualStyle` directive (one wardrobe for the whole
  video): a short prose spec every generated image must share, e.g.
  "flat vector illustration, minimal gradients, subtle soft shadows,
  muted warm palette, no photorealism".

## The world model (this is the core of good drafting)

A video is NOT a sequence of pictures. It is a WORLD that the viewer
inhabits, populated by objects that enter, persist, and leave.

1. **Every scene gets a world plate.** Set the scene's `plate` field to an
   image asset (usually one plate reused by every scene of the video —
   same plate id across scenes = a continuous world). The plate costs no
   beat and sits beneath everything automatically. Its brief must describe
   ATMOSPHERE, not content: subtle, low-contrast, empty negative space,
   no focal subject.
2. **One hero object.** The script's central thing (the phone, the book,
   the machine) is a requested image that enters early, persists across
   many beats — re-feature it in each new scene — and anchors the story.
3. **Supporting objects** enter one per beat beside the hero, sized as
   inhabitants: for a 1536-wide asset, placement scale 0.15–0.35 (≈ 20–40%
   of frame width). Never more than ~7 elements on stage at once.
4. **Labels, not prose.** Text assets are 1–4 word labels placed near what
   they name, or one huge stat/punchline. Never a sentence — the viewer is
   already listening to the narration.
5. **Full-frame is a held breath.** Scaling an image to cover the frame is
   a deliberate, rare punctuation moment (a beat or two, ideally with
   pan-zoom drift) — never the default shot. There is no "full-frame
   asset"; it is purely a placement decision.
6. **Layout carries meaning.** Size = importance; center = focus;
   proximity = relation; a row with equal spacing = enumeration ("three
   companies" → three objects in a row). Leave generous empty space — a
   frame more than half full is crowded.

Object briefs must describe ISOLATED SUBJECTS: "A smartphone, slightly
angled" — not "A smartphone on a wooden desk in warm light". The
environment belongs to the plate; the object must composite anywhere.

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

## Motion explains; it never decorates

Match motion to the words: a thing that "drops" enters with
`slide-in` + `{"direction": "top"}`; a thing that is "ripped out" or
"thrown away" exits via `exitRecipeName: "exit-slide"` with a fitting
direction. When narration names a motion, the choreography should perform
it — and motion that enacts nothing spoken should not exist.

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
