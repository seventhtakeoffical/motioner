import type { Recipe } from "./recipe";

/**
 * Minimal store of Recipes keyed by name, mirroring the AssetRegistry's
 * shape and failure behavior on purpose: the two registries are the
 * compiler's only lookup surfaces, and keeping them structurally identical
 * keeps the eventual binding logic (M5) easy to reason about. The
 * duplication with assets/registry.ts is intentional: two small concrete
 * registries are simpler than one premature generic abstraction.
 */
export interface RecipeRegistry {
  register(recipe: Recipe): void;
  get(name: string): Recipe;
  has(name: string): boolean;
}

export function createRecipeRegistry(): RecipeRegistry {
  const recipes = new Map<string, Recipe>();

  return {
    register(recipe) {
      if (recipes.has(recipe.name)) {
        // Same rationale as the AssetRegistry: a silently-shadowed recipe
        // would surface as wrong choreography on screen, far from the
        // actual mistake. Fail at registration instead.
        throw new Error(
          `Recipe with name "${recipe.name}" is already registered.`,
        );
      }
      recipes.set(recipe.name, recipe);
    },
    get(name) {
      const recipe = recipes.get(name);
      if (!recipe) {
        throw new Error(`No recipe registered with name "${name}".`);
      }
      return recipe;
    },
    has(name) {
      return recipes.has(name);
    },
  };
}
