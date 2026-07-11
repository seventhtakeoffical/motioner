import { createAssetRegistry, hasCapability } from "../assets";
import type { Bible } from "../bible/schema";
import {
  EXIT_FADE_RECIPE_NAME,
  HOLD_RECIPE_NAME,
  type RecipeRegistry,
} from "../recipes";
import type {
  RenderPlan,
  RenderPlanBeat,
  RenderPlanLayer,
} from "../render-plan";
import {
  applyStageUpdates,
  createInitialStage,
  getPlacement,
  type Stage,
  type StagePlacement,
  type StageUpdate,
} from "../stage";

/**
 * The compiler: Bible in, Render Plan out. This is the heart of the
 * deterministic pipeline, and it is deliberately boring — it makes NO
 * creative decisions. Everything it emits is either copied from the Bible,
 * derived from it by pure arithmetic (frame cursors), or produced by
 * folding the Bible's stage directives through the Stage module. Its only
 * intelligence is *validation*: refusing Bibles whose bindings don't hold.
 *
 * As of M10 the fold is the whole story: the Stage is the single source of
 * truth for what exists across beats. Each beat window's layers are read
 * straight off the threaded stage — the featured asset as an "enter"
 * layer, every other surviving placement as a "hold" layer, plus an "exit"
 * layer for each entity the beat strikes. Continuity is therefore computed
 * here, once, explicitly; the renderer never infers it.
 *
 * Purity contract: same Bible + same registry contents => byte-identical
 * plan (M6 tests enforce this). No I/O, no clock, no randomness, and the
 * input Bible is never mutated.
 *
 * Note the input is an already-typed `Bible`, not unknown JSON — the
 * runtime gate (Zod parse + approval check) lives in gate.ts (M7).
 */

/** All compiler rejections carry this prefix so callers/tests can identify them. */
function fail(itemId: string, message: string): never {
  throw new Error(`Compile error at "${itemId}": ${message}`);
}

/**
 * Recursively freezes a value in place. Paired with structuredClone at the
 * emit boundary below: the clone severs every reference the plan would
 * otherwise share with the input Bible, the asset registry, and stage
 * defaults; the freeze makes the resulting value's immutability enforced
 * rather than documented. Both are pure and deterministic.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Paint order: zIndex first (the Bible's explicit stacking control), then
 * entityId, then role. The tie-breaks are value-based on purpose — a total
 * order derived from data, never from object insertion order, which is
 * exactly the kind of incidental ordering M6 exists to keep out of the
 * plan. Role order puts an entity's exit layer beneath its own re-entrance
 * in the strike-and-re-place case.
 */
const ROLE_ORDER: Record<RenderPlanLayer["role"], number> = {
  exit: 0,
  hold: 1,
  enter: 2,
};

function paintOrder(a: RenderPlanLayer, b: RenderPlanLayer): number {
  if (a.placement.zIndex !== b.placement.zIndex) {
    return a.placement.zIndex - b.placement.zIndex;
  }
  if (a.entityId !== b.entityId) {
    return a.entityId < b.entityId ? -1 : 1;
  }
  return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
}

export function compileBible(
  bible: Bible,
  recipes: RecipeRegistry,
): RenderPlan {
  // Build the asset registry from the Bible's own declarations. This line
  // is also the type-level bridge that keeps the Bible's Zod asset schemas
  // and the M2 Asset vocabulary in lockstep: if they drift structurally,
  // this stops compiling.
  const assets = createAssetRegistry();
  for (const decl of bible.assets) {
    assets.register(decl);
  }

  // The Stage is threaded through beats in Bible order; updates apply
  // *between* beats (stage owns continuity, recipes own choreography).
  let stage: Stage = createInitialStage();

  // Absolute frame cursor. Beats butt up against each other with no gaps:
  // the timeline is exactly the sum of the Bible's authored durations.
  let cursor = 0;

  const beats: RenderPlanBeat[] = [];
  const seenBeatIds = new Set<string>();

  for (const scene of bible.scenes) {
    for (const beat of scene.beats) {
      const beatId = `${scene.id}/${beat.id}`;

      // M1 chose not to enforce id uniqueness in the schema; the compiler
      // must, because window ids are the renderer's stable keys.
      if (seenBeatIds.has(beatId)) {
        fail(beatId, `duplicate scene/beat id — plan beat ids must be unique.`);
      }
      seenBeatIds.add(beatId);

      // ---- Featured-binding validation: the compiler's original job ----
      if (!assets.has(beat.assetId)) {
        fail(
          beatId,
          `beat references asset "${beat.assetId}", which is not declared in Bible.assets.`,
        );
      }
      const featuredAsset = assets.get(beat.assetId);

      if (!recipes.has(beat.recipeName)) {
        fail(
          beatId,
          `beat references recipe "${beat.recipeName}", which is not in the recipe registry.`,
        );
      }
      const recipe = recipes.get(beat.recipeName);

      for (const capability of recipe.requiredCapabilities) {
        if (!hasCapability(featuredAsset, capability)) {
          fail(
            beatId,
            `recipe "${recipe.name}" requires capability "${capability}", ` +
              `but asset "${featuredAsset.id}" (kind "${featuredAsset.kind}") does not have it.`,
          );
        }
      }

      if (beat.durationInFrames < recipe.minDurationInFrames) {
        fail(
          beatId,
          `beat is ${beat.durationInFrames} frames, but recipe "${recipe.name}" ` +
            `needs at least ${recipe.minDurationInFrames}.`,
        );
      }

      // ---- Exit validation (M10) ----
      // Exiting entities must be captured from the PRE-update stage: their
      // final placement is what the exit transition plays at.
      const exitIds = beat.exit ?? [];
      const seenExitIds = new Set<string>();
      const exitLayers: RenderPlanLayer[] = exitIds.map((exitId) => {
        if (seenExitIds.has(exitId)) {
          fail(beatId, `asset "${exitId}" is listed in exit more than once.`);
        }
        seenExitIds.add(exitId);
        const placement = getPlacement(stage, exitId);
        if (!placement) {
          fail(
            beatId,
            `cannot exit asset "${exitId}": it is not on stage. ` +
              `Assets are on stage from the beat that places them until a beat exits them.`,
          );
        }
        return {
          entityId: exitId,
          role: "exit",
          recipeName: EXIT_FADE_RECIPE_NAME,
          asset: assets.get(exitId),
          placement,
        };
      });

      if (exitLayers.length > 0) {
        if (!recipes.has(EXIT_FADE_RECIPE_NAME)) {
          fail(
            beatId,
            `beat exits assets, but recipe "${EXIT_FADE_RECIPE_NAME}" is not in the registry.`,
          );
        }
        const exitRecipe = recipes.get(EXIT_FADE_RECIPE_NAME);
        if (beat.durationInFrames < exitRecipe.minDurationInFrames) {
          fail(
            beatId,
            `beat is ${beat.durationInFrames} frames, but exiting assets ` +
              `need at least ${exitRecipe.minDurationInFrames} for the exit transition.`,
          );
        }
      }

      // ---- Stage threading ----
      // Directive order within a beat: strikes, then camera, then theme,
      // then the featured placement. Fixed and documented so a beat that
      // exits and re-places the same asset has defined semantics
      // (strike-and-re-place: both layers are emitted).
      const featuredPlacement: StagePlacement = {
        assetId: beat.assetId,
        ...beat.placement,
      };
      const updates: StageUpdate[] = [
        ...exitIds.map(
          (assetId): StageUpdate => ({ type: "remove-asset", assetId }),
        ),
        ...(beat.camera
          ? [{ type: "move-camera", camera: beat.camera } as StageUpdate]
          : []),
        ...(beat.theme
          ? [{ type: "set-theme", theme: beat.theme } as StageUpdate]
          : []),
        { type: "place-asset", placement: featuredPlacement },
      ];
      stage = applyStageUpdates(stage, updates);

      // ---- Layers: read straight off the threaded stage ----
      // The post-update stage IS the set of surviving entities; that is
      // what "the Stage is the single source of truth" means mechanically.
      const stageLayers: RenderPlanLayer[] = stage.placements.map(
        (placement) =>
          placement.assetId === beat.assetId
            ? {
                entityId: placement.assetId,
                role: "enter",
                recipeName: beat.recipeName,
                asset: featuredAsset,
                placement,
              }
            : {
                entityId: placement.assetId,
                role: "hold",
                recipeName: HOLD_RECIPE_NAME,
                asset: assets.get(placement.assetId),
                placement,
              },
      );

      if (
        stageLayers.some((layer) => layer.role === "hold") &&
        !recipes.has(HOLD_RECIPE_NAME)
      ) {
        fail(
          beatId,
          `beat holds persistent assets, but recipe "${HOLD_RECIPE_NAME}" is not in the registry.`,
        );
      }

      beats.push({
        id: beatId,
        startFrame: cursor,
        durationInFrames: beat.durationInFrames,
        camera: stage.camera,
        theme: stage.theme,
        layers: [...stageLayers, ...exitLayers].sort(paintOrder),
      });

      cursor += beat.durationInFrames;
    }
  }

  // The emit boundary: everything above may hold references into the input
  // Bible (embedded assets) or module constants (the default theme); nothing
  // below this line may. The plan the caller receives is a fully
  // self-contained, deeply immutable value — mutating it is impossible, and
  // no write to the Bible or any shared constant can reach into it.
  return deepFreeze(
    structuredClone({
      fps: bible.fps,
      width: bible.width,
      height: bible.height,
      totalDurationInFrames: cursor,
      beats,
    }),
  );
}
