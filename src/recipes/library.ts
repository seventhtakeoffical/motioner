import { drawOn } from "./draw-on";
import { exitFade } from "./exit-fade";
import { hold } from "./hold";
import { panZoom } from "./pan-zoom";
import { popIn } from "./pop-in";
import { createRecipeRegistry, type RecipeRegistry } from "./registry";
import { slideIn } from "./slide-in";
import { staticFade } from "./static-fade";
import { typewriter } from "./typewriter";

/**
 * The canonical recipe set. The Render Plan references recipes by name
 * only (functions aren't data), so the compiler — which validates names —
 * and the renderer — which evaluates them — MUST resolve names against the
 * same set. Both sides obtain their registry from this one factory; a
 * recipe that isn't registered here does not exist as far as the pipeline
 * is concerned.
 *
 * Names are frozen once shipped: an approved Bible on disk references
 * recipes by these strings, so a rename would orphan it. Deprecate by
 * adding a successor name, never by renaming.
 */
export function createDefaultRecipeRegistry(): RecipeRegistry {
  const registry = createRecipeRegistry();
  registry.register(staticFade);
  registry.register(slideIn);
  registry.register(panZoom);
  registry.register(typewriter);
  registry.register(drawOn);
  registry.register(popIn);
  // Continuity recipes (M10): emitted by the compiler for held and exiting
  // stage entities. Ordinary recipes on purpose — same contract, same
  // validation, same sampling path.
  registry.register(hold);
  registry.register(exitFade);
  return registry;
}
