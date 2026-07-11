/**
 * Pure easing math for recipes. Recipes may not import Remotion (whose
 * `interpolate`/`Easing` would otherwise provide this), so the handful of
 * curves the library needs live here as plain functions: deterministic,
 * dependency-free, defined on [0, 1].
 */

/** Clamp to [0, 1]; the domain every easing function below expects. */
export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Fast start, gentle settle. The default "arrive" curve. */
export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** Slow-fast-slow. The default "travel" curve for drifts and pans. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Overshoots past 1 (~1.1 peak) before settling at exactly 1 — the "pop".
 * Standard back-ease with the conventional overshoot constant.
 */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
