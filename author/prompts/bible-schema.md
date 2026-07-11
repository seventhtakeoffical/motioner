<!--
Field-by-field guide to the Production Bible schema, written for the model.
Maintenance note: this file mirrors src/bible/schema.ts and must be updated
when that schema changes. Two mechanical backstops limit drift: the API call
enforces the actual Zod schema as a structured-output format, and author.ts
runs every draft through the real parser and compiler before accepting it.
This prose exists so the model understands each field's MEANING, not just
its shape.
-->

# The Production Bible, field by field

The Bible is one JSON object. Every object is strict: unknown keys are
rejected.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | literally `"1"` | Schema version tag. Always exactly `"1"`. |
| `id` | string | Stable kebab-case identity for this Bible (e.g. `"how-caching-works"`). Use the id given in the task input. |
| `title` | string | Human-readable video title. |
| `createdAt` | ISO 8601 datetime string | Use the exact timestamp given in the task input. |
| `sourceScript` | string | The raw input script, copied VERBATIM — reviewers diff your draft against it. Do not summarize or edit it. |
| `fps` | positive integer | Frames per second. Use the authoring guide's default unless told otherwise. |
| `width`, `height` | positive integers | Output resolution. |
| `assets` | array, min 1 | Every asset the video uses, declared once, referenced by beats via id. |
| `scenes` | array, min 1 | The video's scenes, in playback order. |

## Asset declarations (`assets[]`)

Each declaration has a `kind` discriminator, a unique `id` (kebab-case
slug), and kind-specific fields:

| `kind` | Fields | Notes |
|---|---|---|
| `text` | `content: string` | On-screen headline/body text. Supports `\n` line breaks. |
| `caption` | `content: string` | Lower-third text; renderers style it as a strip. |
| `chart` | `chartType: "bar"`, `data: [{label, value}]` (min 1 entry, values ≥ 0 and finite) | Data embedded whole — numbers must come from the script. `"bar"` is the only chart type. |
| `icon` | `viewBox: string`, `path: string` | Inline SVG geometry (e.g. `viewBox: "0 0 24 24"` and an SVG path `d` string). You author the geometry — keep shapes simple and bold. |
| `image` | `src`, `intrinsicWidth`, `intrinsicHeight` | ONLY when the task input lists an available image file. |
| `video` | `src`, `intrinsicWidth`, `intrinsicHeight`, `durationInSeconds` | ONLY when the task input lists an available video file. |
| `audio` | `src`, `durationInSeconds` | ONLY when the task input lists an available audio file. |

## Scenes (`scenes[]`)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique kebab-case slug (e.g. `"scene-2-problem"`). Must be unique across the whole Bible. |
| `title` | string | Human-readable label for the scene map. |
| `beats` | array, min 1 | The scene's beats, in playback order. |

A scene is a staging unit: **crossing a scene boundary automatically strikes
every asset still on stage** (they fade out during the next scene's first
beat). Camera and theme carry across scenes until changed.

## Beats (`scenes[].beats[]`)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Slug unique within the scene (e.g. `"beat-1-hook"`). |
| `narration` | string | The voiceover text spoken during this beat. |
| `durationInFrames` | positive integer | The beat's exact length. See the authoring guide for pacing math. Must satisfy the featured recipe's minimum, and the exit-transition minimum if anything exits. |
| `visualIntent` | string | One or two sentences of natural language telling the human reviewer what this beat should look like — the intent they will judge your binding against. |
| `assetId` | string | The featured asset this beat brings on (or moves). Must match a declared asset id. |
| `recipeName` | string | The recipe choreographing the featured asset. Must exist in the recipe table and its required capabilities must be a subset of the asset's. |
| `placement` | `{x, y, scale, zIndex}` | Where the stage puts the asset: `x`/`y` are the asset's CENTER in normalized frame coordinates ((0,0) top-left, (1,1) bottom-right; values outside 0..1 are legal for offscreen staging), `scale` is a positive multiplier on natural size, `zIndex` an integer (higher = in front). |
| `exit` | optional string array | Asset ids struck from the stage as this beat begins (they play a 12-frame fade-out). Each must currently be ON stage. **Forbidden on the first beat of any scene** — scene boundaries strike automatically. |
| `camera` | optional `{x?, y?, zoom?}` | A camera cut applied at beat start and carried afterward. Partial: only state what changes. `zoom` is positive; 1 shows the full frame, 2 shows half (pushed in). Default camera is `{x: 0.5, y: 0.5, zoom: 1}`. |
| `theme` | optional `{backgroundColor, foregroundColor}` | Replaces the carried theme from this beat onward. CSS color strings. |

## Continuity model (how beats compose)

- Placing an asset puts it ON STAGE; it stays there, exactly where placed,
  through every following beat until a beat `exit`s it or its scene ends.
- One beat features one asset. To show several things at once, bring them
  on across consecutive beats — earlier ones hold while later ones enter.
- Re-featuring an already-staged asset MOVES it to the new placement.
- Everything on stage renders every frame. Strike what should disappear.
