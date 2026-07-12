import { z } from "zod";

/**
 * The Production Bible is the only source of truth for everything downstream
 * of Claude. This file is the single place that shape is defined: every type
 * in this module is inferred from a Zod schema, never hand-written, so
 * validation rules and TypeScript types cannot drift apart.
 *
 * As of M5, the Bible carries the concrete bindings the compiler consumes:
 * each Bible declares its assets, and each beat names the asset it shows,
 * the recipe that choreographs it, and where on stage it sits. This is the
 * binding step M1 deliberately deferred ("binding intent to concrete
 * assets/recipes is M5+"), and it lives in the Bible — not in a separate
 * bindings file — because the Bible is the *only* source of truth; a second
 * input to the compiler would break that principle. No LLM runs downstream
 * of this document, so nothing downstream may infer a binding from
 * `visualIntent` free text: Claude proposes bindings at draft time, humans
 * review them, and the compiler only validates and executes them.
 *
 * The asset declaration schemas below intentionally mirror the M2 asset
 * vocabulary (src/assets) without importing it, keeping this module fully
 * standalone. Drift between the two is caught mechanically: the compiler
 * passes parsed declarations straight into the M2 AssetRegistry, so any
 * structural mismatch is a type error in the compiler.
 *
 * Every object schema is `.strict()` (decided at M7, when this schema
 * became a real trust boundary): the Bible arrives as JSON from outside
 * the type system, and a typo'd or unknown field must surface as a
 * validation error — Zod's default of silently stripping it would make a
 * reviewer approve one document while the compiler sees another.
 */

// Bumped whenever a breaking change is made to this schema. Lets a future
// compiler detect "this Bible was authored against an older shape" and
// refuse or migrate it, instead of silently misinterpreting fields.
export const BIBLE_SCHEMA_VERSION = "1" as const;

// ---- Asset declarations ------------------------------------------------
// One schema per M2 asset kind. See the module comment for why these are
// mirrored here instead of imported.

export const TextAssetDeclSchema = z.object({
  kind: z.literal("text"),
  id: z.string().min(1),
  content: z.string().min(1),
}).strict();

export const ImageAssetDeclSchema = z.object({
  kind: z.literal("image"),
  id: z.string().min(1),
  src: z.string().min(1),
  intrinsicWidth: z.number().int().positive(),
  intrinsicHeight: z.number().int().positive(),

  // Asset Request (added sprint M15, planning only): when present, this
  // image does not exist yet — `src` is the agreed path a to-be-generated
  // file will land at, and this brief is the generation spec (subject,
  // composition, style) for whoever/whatever produces it (the long-term
  // direction is AI image generation). Because it lives in the Bible, the
  // approval hash covers the brief itself: the reviewer approves the
  // generation spec along with everything else. The compiler ignores it.
  generationBrief: z.string().min(1).optional(),
}).strict();

export const AudioAssetDeclSchema = z.object({
  kind: z.literal("audio"),
  id: z.string().min(1),
  src: z.string().min(1),
  durationInSeconds: z.number().positive(),
}).strict();

// ---- Kinds added at M8 (additive: version stays "1") ----

export const VideoAssetDeclSchema = z
  .object({
    kind: z.literal("video"),
    id: z.string().min(1),
    src: z.string().min(1),
    intrinsicWidth: z.number().int().positive(),
    intrinsicHeight: z.number().int().positive(),
    durationInSeconds: z.number().positive(),
  })
  .strict();

export const IconAssetDeclSchema = z
  .object({
    kind: z.literal("icon"),
    id: z.string().min(1),
    viewBox: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

export const ChartAssetDeclSchema = z
  .object({
    kind: z.literal("chart"),
    id: z.string().min(1),
    chartType: z.literal("bar"),
    // Non-negative: the v1 bar renderer draws from a zero baseline (see
    // src/assets/asset.ts). Data is embedded because fetching it at render
    // time would put I/O inside the deterministic boundary.
    data: z
      .array(
        z
          .object({
            label: z.string().min(1),
            value: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const CaptionAssetDeclSchema = z
  .object({
    kind: z.literal("caption"),
    id: z.string().min(1),
    content: z.string().min(1),
  })
  .strict();

export const AssetDeclSchema = z.discriminatedUnion("kind", [
  TextAssetDeclSchema,
  ImageAssetDeclSchema,
  AudioAssetDeclSchema,
  VideoAssetDeclSchema,
  IconAssetDeclSchema,
  ChartAssetDeclSchema,
  CaptionAssetDeclSchema,
]);

// Where a beat's asset sits on stage, in normalized frame coordinates
// ((0,0) = top-left, (1,1) = bottom-right — the Stage module's convention).
// Values outside [0,1] are legal on purpose: placing an asset off-screen is
// how entrances/exits will be staged once transitions arrive (M10).
export const PlacementSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().positive(),
  zIndex: z.number().int(),
}).strict();

export const BeatSchema = z.object({
  // Stable, Claude-authored slug (e.g. "beat-2-problem"). Not a UUID —
  // Claude should be free to produce readable ids. Required now because
  // Stage continuity (M4) and the compiler's Render Plan (M5+) need a
  // stable key to hang state off of; retrofitting ids later would mean
  // touching every previously-generated Bible.
  id: z.string().min(1),

  // The voiceover text spoken during this beat. This is the primary timing
  // anchor a human reviewer checks a beat against — does the narration fit
  // in the duration below.
  narration: z.string().min(1),

  // The beat's length as a resolved, concrete integer. Determinism requires
  // the timeline to be fully decided before the compiler ever runs, so this
  // may not be a hint or estimate the compiler derives later — Claude
  // proposes it at draft time, and the schema demands it already be a fact.
  durationInFrames: z.number().int().positive(),

  // Natural-language description of what should appear on screen during
  // this beat (e.g. "Show a bar chart comparing X and Y rising"). Kept now
  // that concrete bindings exist below: this is the *intent trace* a human
  // reviewer checks the binding against ("does static-fade on the headline
  // actually deliver what this sentence promises?").
  visualIntent: z.string().min(1),

  // ---- Binding (added at M5) ----
  // Which declared asset appears in this beat. Referential integrity
  // (does this id exist in Bible.assets?) is the compiler's job, not the
  // schema's — Zod validates shape, the compiler validates meaning.
  assetId: z.string().min(1),

  // Which recipe choreographs the asset. Same division: the schema checks
  // it's a non-empty string; the compiler checks the recipe exists and its
  // required capabilities are satisfied by the asset.
  recipeName: z.string().min(1),

  // Parameters for the featured recipe (added M15, e.g. slide-in's
  // direction). Shape-checked here; validated against the recipe's declared
  // parameter spec by the compiler, which also resolves defaults — the plan
  // only ever contains fully-resolved values.
  recipeParams: z.record(z.union([z.string(), z.number()])).optional(),

  // Where the stage places the asset for this beat. Authored in the Bible
  // (not defaulted by the compiler) because layout is a creative decision
  // and the compiler is not allowed to make decisions — only to execute.
  placement: PlacementSchema,

  // ---- Continuity directives (added at M10, all optional/additive) ----
  // Assets placed by earlier beats REMAIN on stage by default; these
  // directives are how a beat changes the carried state. All apply as the
  // beat begins and persist afterward.

  // Asset ids struck from the stage. Each plays the exit transition during
  // this beat. Must currently be on stage — exiting an absent asset is a
  // continuity contradiction the compiler rejects.
  exit: z.array(z.string().min(1)).optional(),

  // Which recipe plays the exits this beat emits (added M15; default
  // exit-fade). Applies uniformly to the beat's exits. Validated by the
  // compiler like any recipe reference.
  exitRecipeName: z.string().min(1).optional(),

  // Parameters for the exit recipe, same contract as recipeParams.
  exitRecipeParams: z.record(z.union([z.string(), z.number()])).optional(),

  // A camera cut: partial on purpose (a beat that only zooms shouldn't
  // restate position); merges into the carried camera state.
  camera: z
    .object({
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      zoom: z.number().positive().optional(),
    })
    .strict()
    .optional(),

  // Replaces the carried theme from this beat onward.
  theme: z
    .object({
      backgroundColor: z.string().min(1),
      foregroundColor: z.string().min(1),
    })
    .strict()
    .optional(),
}).strict();

export const SceneSchema = z.object({
  // Stable, Claude-authored slug, same rationale as Beat.id.
  id: z.string().min(1),

  // Human-readable label for review/debugging. Not consumed by the
  // compiler — scenes are identified by `id`, not `title`.
  title: z.string().min(1),

  // A scene must contain at least one beat; an empty scene has no timeline
  // contribution and is almost certainly a drafting mistake.
  beats: z.array(BeatSchema).min(1),
}).strict();

export const BibleSchema = z.object({
  // See BIBLE_SCHEMA_VERSION above.
  schemaVersion: z.literal(BIBLE_SCHEMA_VERSION),

  // Stable identity for this Bible artifact, independent of its title
  // (titles may be edited during review; the id should not change).
  id: z.string().min(1),

  title: z.string().min(1),

  // When this draft was generated. An audit trail field — the Bible is a
  // generated artifact that may be regenerated, so reviewers need to know
  // which draft they're looking at.
  createdAt: z.string().datetime(),

  // The raw script text this Bible was derived from, kept verbatim so a
  // reviewer can compare the draft against its source without needing a
  // separate system.
  sourceScript: z.string().min(1),

  // Global frame rate. Fixed once at the Bible level so every beat's
  // `durationInFrames` means the same thing throughout the whole video.
  fps: z.number().int().positive(),

  // Output resolution. Fixed at the Bible level because layout decisions
  // made anywhere downstream (Assets, Recipes, Stage) need a single shared
  // frame of reference.
  width: z.number().int().positive(),
  height: z.number().int().positive(),

  // Every asset the video uses, declared up front. Beats reference these
  // by id. Declared in the Bible (not registered in code) because asset
  // content — especially on-screen text — is script-derived creative
  // material, which makes it Bible territory by definition.
  assets: z.array(AssetDeclSchema).min(1),

  // A Bible must contain at least one scene; an empty Bible describes no
  // video.
  scenes: z.array(SceneSchema).min(1),
}).strict();

export type AssetDecl = z.infer<typeof AssetDeclSchema>;
export type Placement = z.infer<typeof PlacementSchema>;
export type Beat = z.infer<typeof BeatSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Bible = z.infer<typeof BibleSchema>;
