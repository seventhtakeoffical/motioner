import { z } from "zod";

/**
 * The Production Bible is the only source of truth for everything downstream
 * of Claude. This file is the single place that shape is defined: every type
 * in this module is inferred from a Zod schema, never hand-written, so
 * validation rules and TypeScript types cannot drift apart.
 *
 * Nothing here references Assets, Recipes, or Registries — that typed
 * vocabulary doesn't exist yet (see M2/M3). Where a beat needs to describe
 * what appears on screen, it does so in plain language (`visualIntent`).
 * Binding that intent to concrete assets/recipes is compiler logic, added
 * from M5 onward.
 */

// Bumped whenever a breaking change is made to this schema. Lets a future
// compiler detect "this Bible was authored against an older shape" and
// refuse or migrate it, instead of silently misinterpreting fields.
export const BIBLE_SCHEMA_VERSION = "1" as const;

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
  // this beat (e.g. "Show a bar chart comparing X and Y rising"). Left as
  // free text on purpose: the vocabulary for what can actually appear
  // belongs to Assets (M2) and Recipes (M3), and resolving this string
  // against that vocabulary is compiler logic (M5+), not part of the Bible.
  visualIntent: z.string().min(1),
});

export const SceneSchema = z.object({
  // Stable, Claude-authored slug, same rationale as Beat.id.
  id: z.string().min(1),

  // Human-readable label for review/debugging. Not consumed by the
  // compiler — scenes are identified by `id`, not `title`.
  title: z.string().min(1),

  // A scene must contain at least one beat; an empty scene has no timeline
  // contribution and is almost certainly a drafting mistake.
  beats: z.array(BeatSchema).min(1),
});

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

  // A Bible must contain at least one scene; an empty Bible describes no
  // video.
  scenes: z.array(SceneSchema).min(1),
});

export type Beat = z.infer<typeof BeatSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Bible = z.infer<typeof BibleSchema>;
