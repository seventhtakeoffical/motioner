import type { Asset, AssetId, AssetKind } from "../assets";
import type { StageCamera, StagePlacement, StageTheme } from "../stage";

/**
 * The Render Plan is the typed IR the compiler emits and the renderer
 * consumes — the deterministic boundary between "deciding what happens"
 * and "painting it". Two properties define it:
 *
 * 1. It is FULLY RESOLVED. Assets are embedded whole, placements, cameras
 *    and themes are snapshotted values, every timing is an absolute frame
 *    number, and layers arrive pre-sorted in paint order. The renderer
 *    performs no lookups, no defaulting, and no decisions — it only
 *    interprets.
 *
 * 2. It is PURE JSON by construction: no functions, no Dates, no Maps,
 *    no undefined. That is what makes M6's determinism guarantee testable
 *    as literal byte equality of JSON.stringify output. The one exception
 *    to full resolution — recipes are referenced by name, not embedded —
 *    exists precisely because recipes are functions, and functions aren't
 *    data. Compiler and renderer agree on what a name means by sharing the
 *    same recipe registry (src/recipes/library.ts).
 *
 * Reshaped at M10 (the breaking change flagged — and deliberately left
 * unfrozen — in the staff review): one item per beat could not express an
 * asset persisting across beats. The plan is now a sequence of beat
 * WINDOWS, each carrying every entity visible during it as an explicit
 * LAYER. Entity continuity is represented, not inferred: the same entityId
 * appearing as enter → hold → exit across consecutive windows IS the
 * entity's lifecycle, and the compiler computed every step of it.
 */

/** An entity's relationship to the beat whose window it appears in. */
export type LayerRole =
  /** Featured this beat: the beat's own recipe animates it in. */
  | "enter"
  /** Persisting from an earlier beat: held at its stage placement. */
  | "hold"
  /** Struck by this beat's exit directive: plays the exit transition. */
  | "exit";

export interface RenderPlanLayer {
  /**
   * The stage entity this layer shows — the continuity key. Unique per
   * (window, role): the same entity may legally appear twice in one window
   * as exit + enter (a strike-and-re-place transition), never twice in the
   * same role.
   */
  entityId: AssetId;

  role: LayerRole;

  /** Looked up in the shared recipe registry at render time. */
  recipeName: string;

  /**
   * Fully-resolved recipe parameters (M15): every parameter the recipe
   * declares is present — authored values validated, defaults filled in by
   * the compiler — so the renderer passes this straight into `sample`
   * without a single decision. Plain JSON values, byte-stable.
   */
  params: Readonly<Record<string, string | number>>;

  /** The entity's asset, embedded whole. */
  asset: Asset;

  /**
   * Stage placement snapshot for this window. A recipe's per-frame output
   * composes onto this: offsets add to x/y, recipe scale multiplies
   * placement scale.
   */
  placement: StagePlacement;
}

export interface RenderPlanBeat {
  /** Deterministic identity, `${sceneId}/${beatId}`. Unique across the plan. */
  id: string;

  /**
   * The scene this window belongs to (M11). Explicit data, not something
   * to parse back out of the composite id — tooling that needs scene
   * membership reads it, never infers it.
   */
  sceneId: string;

  /** Absolute frame (0-based, in the whole video) at which this window begins. */
  startFrame: number;

  durationInFrames: number;

  /** Carried camera state during this window (cuts resolve between beats). */
  camera: StageCamera;

  /** Carried theme during this window. */
  theme: StageTheme;

  /**
   * Every entity visible during this window, in paint order — sorted by
   * the compiler on (zIndex, entityId, role) so the renderer paints the
   * array as-is and never re-derives stacking.
   */
  layers: readonly RenderPlanLayer[];
}

/**
 * One row of the video's scene map (M11): where each scene sits on the
 * absolute timeline. Scenes are the continuity scope — entities never
 * survive past a scene's end (the compiler strikes them explicitly);
 * camera and theme carry through.
 */
export interface RenderPlanScene {
  /** The Bible scene's id. Unique across the plan (compiler-enforced). */
  id: string;
  /** Human-readable label, for navigation/chaptering tooling. */
  title: string;
  startFrame: number;
  durationInFrames: number;
}

/**
 * One entry of the preload manifest (M11): an external media source the
 * video will load at render time. Lets render infrastructure prefetch
 * without scanning plan internals. Only src-bearing kinds appear here —
 * text, icons, charts, and captions are self-contained data.
 */
export interface AssetManifestEntry {
  kind: Extract<AssetKind, "image" | "video" | "audio">;
  src: string;
}

export interface RenderPlan {
  fps: number;
  width: number;
  height: number;

  /** Sum of all beat durations; the video's total length. */
  totalDurationInFrames: number;

  /**
   * The scene map, in timeline order; scenes are contiguous runs of beat
   * windows covering the whole timeline with no gaps.
   */
  scenes: readonly RenderPlanScene[];

  /**
   * In timeline order (startFrame strictly increasing, windows contiguous).
   * Exactly one window per Bible beat.
   */
  beats: readonly RenderPlanBeat[];

  /**
   * Every external media source any layer references, deduplicated and
   * lexicographically sorted (a value-based order — the manifest is part
   * of the plan's byte-identical determinism contract like everything
   * else). Assets declared in the Bible but never staged do not appear.
   */
  manifest: readonly AssetManifestEntry[];
}
