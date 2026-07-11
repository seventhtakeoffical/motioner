import type { AssetId } from "../assets";

/**
 * The Stage is the state that persists *between* beats: which assets are
 * on stage and where, what the camera is looking at, and the active theme.
 * It is the system's answer to continuity — when beat N ends and beat N+1
 * begins, the Stage is what carries over.
 *
 * Division of labor with Recipes (M3): the Stage owns where things *are*;
 * recipes own how things *move* within a beat. A recipe's RecipeFrameProps
 * are applied relative to the placement the Stage holds (its offsets add to
 * the placement's position, its scale multiplies the placement's scale).
 * Recipes never read or write the Stage; this module never imports recipes.
 * The compiler (M5) composes the two: it walks beats in order, threading a
 * Stage value through, applying each beat's StageUpdates *between* beats.
 *
 * Everything here is immutable and pure: applyStageUpdates returns a new
 * Stage and never touches its input. That is what lets the compiler
 * reconstruct the exact stage state at any beat deterministically — the
 * Stage at beat N is a pure fold of all updates before it.
 *
 * Coordinates are normalized to the frame — (0,0) is the top-left corner,
 * (1,1) the bottom-right — rather than pixels, so stage state is
 * meaningful at any output resolution and independent of any particular
 * renderer's coordinate conventions.
 */

export interface StagePlacement {
  assetId: AssetId;
  /** Center of the asset, in normalized frame coordinates. */
  x: number;
  y: number;
  /** Base scale (1 = the asset's natural size). Recipe scale multiplies this. */
  scale: number;
  /** Stacking order: higher renders in front. Ties are resolved by placement order. */
  zIndex: number;
}

export interface StageCamera {
  /** Point the camera is centered on, in normalized frame coordinates. */
  x: number;
  y: number;
  /** 1 = the full frame is visible; 2 = viewing half the frame (zoomed in). */
  zoom: number;
}

export interface StageTheme {
  backgroundColor: string;
  foregroundColor: string;
}

export interface Stage {
  camera: StageCamera;
  /**
   * Kept as an ordered array (insertion order), not a keyed record, so
   * iteration order is explicit and deterministic — object-key ordering is
   * exactly the kind of subtle nondeterminism M6 will ban.
   */
  placements: readonly StagePlacement[];
  theme: StageTheme;
}

/**
 * The declarative deltas by which the Stage changes between beats. A
 * closed union rather than free-form mutation so that every possible stage
 * change is enumerable, serializable, and replayable — the compiler can
 * log, diff, and reapply them.
 */
export type StageUpdate =
  | {
      // Adds the asset to the stage, or — if it is already placed —
      // replaces its placement. Re-placing is deliberately legal: "move
      // this asset somewhere else for the next beat" is the common case,
      // and forcing a remove+place pair for it would just be ceremony.
      type: "place-asset";
      placement: StagePlacement;
    }
  | { type: "remove-asset"; assetId: AssetId }
  | {
      // Partial on purpose: a beat that only zooms shouldn't have to
      // restate the camera's position.
      type: "move-camera";
      camera: Partial<StageCamera>;
    }
  | { type: "set-theme"; theme: StageTheme };

export const DEFAULT_STAGE_THEME: StageTheme = {
  backgroundColor: "#111111",
  foregroundColor: "#ffffff",
};

/** An empty stage: nothing placed, camera centered on the full frame. */
export function createInitialStage(
  theme: StageTheme = DEFAULT_STAGE_THEME,
): Stage {
  return {
    camera: { x: 0.5, y: 0.5, zoom: 1 },
    placements: [],
    theme,
  };
}

export function getPlacement(
  stage: Stage,
  assetId: AssetId,
): StagePlacement | undefined {
  return stage.placements.find((p) => p.assetId === assetId);
}

/**
 * Pure fold of updates over a stage. Updates apply strictly in array
 * order; the input stage is never modified.
 */
export function applyStageUpdates(
  stage: Stage,
  updates: readonly StageUpdate[],
): Stage {
  return updates.reduce(applyStageUpdate, stage);
}

function applyStageUpdate(stage: Stage, update: StageUpdate): Stage {
  switch (update.type) {
    case "place-asset": {
      const existing = getPlacement(stage, update.placement.assetId);
      // Replacement keeps the asset's original position in the placement
      // order (so its z-tie-break behavior is stable); a new asset appends.
      const placements = existing
        ? stage.placements.map((p) =>
            p.assetId === update.placement.assetId ? update.placement : p,
          )
        : [...stage.placements, update.placement];
      return { ...stage, placements };
    }
    case "remove-asset": {
      if (!getPlacement(stage, update.assetId)) {
        // Removing something that isn't on stage means the Bible's beat
        // sequence and the compiler's stage-threading disagree — a real
        // bug that should fail loudly, not be papered over.
        throw new Error(
          `Cannot remove asset "${update.assetId}": it is not on stage.`,
        );
      }
      return {
        ...stage,
        placements: stage.placements.filter(
          (p) => p.assetId !== update.assetId,
        ),
      };
    }
    case "move-camera":
      return { ...stage, camera: { ...stage.camera, ...update.camera } };
    case "set-theme":
      return { ...stage, theme: update.theme };
  }
}
