import type { Asset, Capability } from "../assets";

/**
 * A Recipe is the unit of *choreography*: a named, pure description of how a
 * bound asset behaves over the frames of a single beat. Recipes are shared
 * by the compiler (which uses their binding/timing declarations to validate
 * a Bible before anything renders) and the renderer (which evaluates their
 * frame function to produce actual pixels). Because of that dual role, this
 * module must stay pure TypeScript: no Remotion, no side effects, no
 * wall-clock time, no randomness.
 *
 * Division of labor with the Stage (M4): the Stage owns *where an asset is*
 * between beats (placement, z-order, camera); a Recipe owns *how it moves*
 * within one beat. A recipe's output is therefore always relative — an
 * opacity to apply, an offset from the asset's stage placement, a scale
 * factor — never an absolute position. Recipes do not import or mutate the
 * Stage; the compiler/renderer compose the two.
 */

/** The value a resolved recipe parameter can take. */
export type RecipeParamValue = string | number;

/**
 * A recipe's declared parameter (added in sprint M15, driven by production
 * evidence: "drops on top" needed a slide direction). Each spec carries its
 * own default: the COMPILER resolves defaults and validates authored values
 * against the spec, so by the time `sample` runs, every declared parameter
 * is present and legal — the plan embeds fully-resolved values, keeping the
 * byte-identical determinism contract intact.
 */
export type RecipeParamSpec =
  | {
      kind: "enum";
      values: readonly string[];
      default: string;
      description: string;
    }
  | {
      kind: "number";
      min: number;
      max: number;
      default: number;
      description: string;
    };

/**
 * Everything a recipe's frame function is allowed to know. Deliberately
 * closed: if it isn't in the context, the recipe can't depend on it, which
 * is what makes `sample` auditable for determinism.
 */
export interface RecipeContext {
  /** Current frame, local to the beat (0-based; 0 is the beat's first frame). */
  frame: number;
  /**
   * Total length of the beat, so recipes can phrase choreography in
   * proportions ("fade over the first 20% of the beat") rather than
   * hard-coded frame counts.
   */
  durationInFrames: number;
  /**
   * The asset this recipe was bound to. The binding is validated against
   * `requiredCapabilities` before `sample` is ever called, so recipes may
   * assume the capabilities they declared are present.
   */
  asset: Asset;
  /**
   * Resolved parameter values (every declared param present when the
   * compiler built the context's source layer). Optional so hand-built
   * contexts (tests, tools) stay valid; recipes must still fall back to
   * their spec defaults when reading, keeping `sample` total.
   */
  params?: Readonly<Record<string, RecipeParamValue>>;
}

/**
 * The resolved visual state a recipe produces for one frame — plain data,
 * expressed in renderer-agnostic terms. Offsets are fractions of the frame
 * dimension (0.1 = 10% of frame width/height) so the same recipe output is
 * meaningful at any resolution; how a renderer realizes "opacity" or
 * "scale" is its own business.
 */
export interface RecipeFrameProps {
  /** 0 (invisible) to 1 (fully visible). */
  opacity: number;
  /** Horizontal offset from the asset's stage placement, as a fraction of frame width. */
  offsetX: number;
  /** Vertical offset from the asset's stage placement, as a fraction of frame height. */
  offsetY: number;
  /** Scale multiplier applied on top of the asset's stage placement (1 = unchanged). */
  scale: number;
  /**
   * Fraction of the asset's content revealed, 0..1 (added at M9, optional
   * for backwards compatibility; absent means 1 — fully revealed). This is
   * a semantic channel, not a visual one: the recipe says "60% of the
   * content is out", and the renderer decides what that means per asset
   * kind (text: characters typed; chart: marks drawn). Recipes should only
   * emit it when they declared the "revealable" capability.
   */
  reveal?: number;
}

/** The "do nothing" frame state: visible, unmoved, unscaled, fully revealed. */
export const NEUTRAL_FRAME_PROPS: RecipeFrameProps = {
  opacity: 1,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  reveal: 1,
};

export interface Recipe {
  /** Unique name the registry (and eventually the compiler) looks this recipe up by. */
  name: string;

  /**
   * The capabilities an asset must have for this recipe to bind to it.
   * Expressed in M2's capability vocabulary — never as concrete asset
   * kinds — so a recipe written today automatically works with any future
   * asset kind that carries the right capabilities.
   */
  requiredCapabilities: readonly Capability[];

  /**
   * The shortest beat this recipe can perform its choreography in. The
   * compiler uses this to reject a Bible that gives, say, a 30-frame
   * animation a 10-frame beat — at validation time, not render time.
   */
  minDurationInFrames: number;

  /**
   * The parameters this recipe accepts (absent = none). The compiler
   * rejects authored params that aren't declared here, don't match the
   * spec's type, or fall outside its bounds — a Bible can only say things
   * the recipe actually understands.
   */
  params?: Readonly<Record<string, RecipeParamSpec>>;

  /**
   * The frame function. MUST be pure and deterministic: same context in,
   * same props out, on every call, on every machine. No Date.now(), no
   * Math.random(), no reading anything outside `ctx`. Defined for every
   * frame in [0, ctx.durationInFrames).
   */
  sample(ctx: RecipeContext): RecipeFrameProps;
}
