import { createRecipeRegistry, type RecipeRegistry } from "./registry";
import { staticFade } from "./static-fade";

/**
 * The canonical recipe set. The Render Plan references recipes by name
 * only (functions aren't data), so the compiler — which validates names —
 * and the renderer — which evaluates them — MUST resolve names against the
 * same set. Both sides obtain their registry from this one factory; a
 * recipe that isn't registered here does not exist as far as the pipeline
 * is concerned. Grows in M9.
 */
export function createDefaultRecipeRegistry(): RecipeRegistry {
  const registry = createRecipeRegistry();
  registry.register(staticFade);
  return registry;
}
