import { createAssetRegistry, hasCapability } from "../assets";
import type { Bible } from "../bible/schema";
import type { RecipeRegistry } from "../recipes";
import type { RenderPlan, RenderPlanItem } from "../render-plan";
import {
  applyStageUpdates,
  createInitialStage,
  type Stage,
  type StagePlacement,
} from "../stage";

/**
 * The compiler: Bible in, Render Plan out. This is the heart of the
 * deterministic pipeline, and it is deliberately boring — it makes NO
 * creative decisions. Everything it emits is either copied from the Bible,
 * derived from it by pure arithmetic (frame cursors), or produced by
 * folding the Bible's stage placements through the Stage module. Its only
 * intelligence is *validation*: refusing Bibles whose bindings don't hold.
 *
 * Purity contract: same Bible + same registry contents => byte-identical
 * plan (M6 tests enforce this). No I/O, no clock, no randomness, and the
 * input Bible is never mutated.
 *
 * Note the input is an already-typed `Bible`, not unknown JSON. The
 * runtime validation gate (Zod parse + approval check at this entry point)
 * is M7's deliverable — until then, callers are trusted TypeScript.
 */

/** All compiler rejections carry this prefix so callers/tests can identify them. */
function fail(itemId: string, message: string): never {
  throw new Error(`Compile error at "${itemId}": ${message}`);
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

  const items: RenderPlanItem[] = [];
  const seenItemIds = new Set<string>();

  for (const scene of bible.scenes) {
    for (const beat of scene.beats) {
      const itemId = `${scene.id}/${beat.id}`;

      // M1 chose not to enforce id uniqueness in the schema; the compiler
      // must, because plan item ids are the renderer's stable keys.
      if (seenItemIds.has(itemId)) {
        fail(itemId, `duplicate scene/beat id — plan item ids must be unique.`);
      }
      seenItemIds.add(itemId);

      // ---- Binding validation: the compiler's actual job ----
      if (!assets.has(beat.assetId)) {
        fail(
          itemId,
          `beat references asset "${beat.assetId}", which is not declared in Bible.assets.`,
        );
      }
      const asset = assets.get(beat.assetId);

      if (!recipes.has(beat.recipeName)) {
        fail(
          itemId,
          `beat references recipe "${beat.recipeName}", which is not in the recipe registry.`,
        );
      }
      const recipe = recipes.get(beat.recipeName);

      for (const capability of recipe.requiredCapabilities) {
        if (!hasCapability(asset, capability)) {
          fail(
            itemId,
            `recipe "${recipe.name}" requires capability "${capability}", ` +
              `but asset "${asset.id}" (kind "${asset.kind}") does not have it.`,
          );
        }
      }

      if (beat.durationInFrames < recipe.minDurationInFrames) {
        fail(
          itemId,
          `beat is ${beat.durationInFrames} frames, but recipe "${recipe.name}" ` +
            `needs at least ${recipe.minDurationInFrames}.`,
        );
      }

      // ---- Stage threading ----
      const placement: StagePlacement = {
        assetId: beat.assetId,
        ...beat.placement,
      };
      stage = applyStageUpdates(stage, [{ type: "place-asset", placement }]);

      items.push({
        id: itemId,
        startFrame: cursor,
        durationInFrames: beat.durationInFrames,
        recipeName: beat.recipeName,
        asset,
        placement,
        theme: stage.theme,
      });

      cursor += beat.durationInFrames;
    }
  }

  return {
    fps: bible.fps,
    width: bible.width,
    height: bible.height,
    totalDurationInFrames: cursor,
    items,
  };
}
