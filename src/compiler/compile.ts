import { createAssetRegistry, hasCapability } from "../assets";
import type { Bible } from "../bible/schema";
import {
  EXIT_FADE_RECIPE_NAME,
  HOLD_RECIPE_NAME,
  type Recipe,
  type RecipeParamValue,
  type RecipeRegistry,
} from "../recipes";
import type {
  AssetManifestEntry,
  RenderPlan,
  RenderPlanBeat,
  RenderPlanLayer,
  RenderPlanScene,
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
 * As of M11 that continuity is SCENE-SCOPED: a scene change strikes the
 * set. Every entity still on stage when a scene ends is auto-struck —
 * removed from the stage and given an explicit exit layer in the next
 * scene's opening window, using the exact same vocabulary as a beat-level
 * exit. Camera and theme deliberately carry across scenes (they are the
 * auditorium, not the set dressing; scenes reset them explicitly with the
 * usual directives when they want to). The compiler also derives the
 * video-level artifacts a whole production needs: the scene map (absolute
 * timing per scene) and the preload manifest (every external media source
 * any layer references, deduped and value-sorted).
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

/**
 * Validate authored params against the recipe's declared spec and resolve
 * defaults (M15). The result is total: every declared parameter is present.
 * Keys are emitted in the recipe's own spec-declaration order — a value-
 * based, source-stable order, so resolved params never wobble plan bytes.
 */
function resolveRecipeParams(
  itemId: string,
  recipe: Recipe,
  authored: Readonly<Record<string, RecipeParamValue>> | undefined,
): Record<string, RecipeParamValue> {
  const spec = recipe.params ?? {};
  for (const name of Object.keys(authored ?? {})) {
    if (!(name in spec)) {
      fail(
        itemId,
        `recipe "${recipe.name}" does not accept a parameter named "${name}".` +
          (Object.keys(spec).length > 0
            ? ` It accepts: ${Object.keys(spec).join(", ")}.`
            : ` It accepts no parameters.`),
      );
    }
  }
  const resolved: Record<string, RecipeParamValue> = {};
  for (const [name, paramSpec] of Object.entries(spec)) {
    const value = authored?.[name];
    if (value === undefined) {
      resolved[name] = paramSpec.default;
      continue;
    }
    if (paramSpec.kind === "enum") {
      if (typeof value !== "string" || !paramSpec.values.includes(value)) {
        fail(
          itemId,
          `recipe "${recipe.name}" parameter "${name}" must be one of ` +
            `${paramSpec.values.join(" | ")}, got ${JSON.stringify(value)}.`,
        );
      }
    } else {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < paramSpec.min ||
        value > paramSpec.max
      ) {
        fail(
          itemId,
          `recipe "${recipe.name}" parameter "${name}" must be a number in ` +
            `[${paramSpec.min}, ${paramSpec.max}], got ${JSON.stringify(value)}.`,
        );
      }
    }
    resolved[name] = value;
  }
  return resolved;
}

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
  const scenes: RenderPlanScene[] = [];
  const seenBeatIds = new Set<string>();
  const seenSceneIds = new Set<string>();

  for (const [sceneIndex, scene] of bible.scenes.entries()) {
    // The composite beat-id check below can't catch two scenes sharing an
    // id but with differently-named beats; the scene map needs ids of its
    // own to be unambiguous.
    if (seenSceneIds.has(scene.id)) {
      fail(scene.id, `duplicate scene id — scene ids must be unique.`);
    }
    seenSceneIds.add(scene.id);
    const sceneStartFrame = cursor;

    for (const [beatIndex, beat] of scene.beats.entries()) {
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

      const featuredParams = resolveRecipeParams(
        beatId,
        recipe,
        beat.recipeParams,
      );

      // ---- Exits: authored (M10) or scene-boundary strike (M11) ----
      // A scene change strikes the set: on the first beat of every scene
      // after the first, whatever survived the previous scene is struck
      // automatically. Authored exit directives are therefore meaningless
      // on a scene's opening beat — on scene one the stage is empty, and
      // on later scenes the boundary already strikes everything — so the
      // compiler rejects them rather than silently merging.
      const isSceneOpening = beatIndex === 0;
      let exitIds: readonly string[];
      if (isSceneOpening) {
        if (beat.exit !== undefined) {
          fail(
            beatId,
            `exit directives are not allowed on the first beat of a scene — ` +
              `scene boundaries strike all surviving entities automatically; ` +
              `use exit only on later beats within a scene.`,
          );
        }
        exitIds =
          sceneIndex > 0 ? stage.placements.map((p) => p.assetId) : [];
      } else {
        exitIds = beat.exit ?? [];
      }

      // The exit recipe (M15): authored per beat, defaulting to exit-fade.
      // Applies uniformly to every exit this beat emits — authored strikes
      // and scene-boundary strikes alike (it is the beat's "how things
      // leave" decision). Scene-boundary strikes on a beat that says
      // nothing use the house default.
      const exitRecipeName = beat.exitRecipeName ?? EXIT_FADE_RECIPE_NAME;

      // Exiting entities must be captured from the PRE-update stage: their
      // final placement is what the exit transition plays at.
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
              `Assets are on stage from the beat that places them until a beat ` +
              `exits them or their scene ends.`,
          );
        }
        return {
          entityId: exitId,
          role: "exit",
          recipeName: exitRecipeName,
          // Filled in below once the exit recipe is validated — every layer
          // of this beat shares the same resolved exit params.
          params: {},
          asset: assets.get(exitId),
          placement,
        };
      });

      if (exitLayers.length > 0) {
        if (!recipes.has(exitRecipeName)) {
          fail(
            beatId,
            `beat exits assets, but recipe "${exitRecipeName}" is not in the registry.`,
          );
        }
        const exitRecipe = recipes.get(exitRecipeName);
        const exitParams = resolveRecipeParams(
          beatId,
          exitRecipe,
          beat.exitRecipeParams,
        );
        for (const layer of exitLayers) {
          layer.params = exitParams;
        }
        if (beat.durationInFrames < exitRecipe.minDurationInFrames) {
          fail(
            beatId,
            `beat is ${beat.durationInFrames} frames, but ` +
              (isSceneOpening
                ? `the scene transition strikes ${exitLayers.length} carried-over ` +
                  `entit${exitLayers.length === 1 ? "y" : "ies"} and `
                : `exiting assets `) +
              `need${isSceneOpening ? "s" : ""} at least ` +
              `${exitRecipe.minDurationInFrames} frames for the "${exitRecipeName}" exit transition.`,
          );
        }
      } else if (
        beat.exitRecipeName !== undefined ||
        beat.exitRecipeParams !== undefined
      ) {
        fail(
          beatId,
          `beat sets exitRecipeName/exitRecipeParams but emits no exits — ` +
            `nothing leaves the stage during this beat.`,
        );
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
                params: featuredParams,
                asset: featuredAsset,
                placement,
              }
            : {
                entityId: placement.assetId,
                role: "hold",
                recipeName: HOLD_RECIPE_NAME,
                params: {},
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
        sceneId: scene.id,
        startFrame: cursor,
        durationInFrames: beat.durationInFrames,
        camera: stage.camera,
        theme: stage.theme,
        layers: [...stageLayers, ...exitLayers].sort(paintOrder),
      });

      cursor += beat.durationInFrames;
    }

    scenes.push({
      id: scene.id,
      title: scene.title,
      startFrame: sceneStartFrame,
      durationInFrames: cursor - sceneStartFrame,
    });
  }

  // ---- Preload manifest (M11) ----
  // Every external media source any emitted layer references. Keyed on
  // kind+src for dedup, then value-sorted: the manifest participates in
  // the plan's byte-identical determinism like everything else, so its
  // order must come from data, not from encounter order.
  const manifestEntries = new Map<string, AssetManifestEntry>();
  for (const window of beats) {
    for (const layer of window.layers) {
      const asset = layer.asset;
      if (
        asset.kind === "image" ||
        asset.kind === "video" ||
        asset.kind === "audio"
      ) {
        manifestEntries.set(`${asset.kind} ${asset.src}`, {
          kind: asset.kind,
          src: asset.src,
        });
      }
    }
  }
  const manifest = [...manifestEntries.values()].sort((a, b) =>
    a.src !== b.src
      ? a.src < b.src
        ? -1
        : 1
      : a.kind < b.kind
        ? -1
        : a.kind > b.kind
          ? 1
          : 0,
  );

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
      scenes,
      beats,
      manifest,
    }),
  );
}
