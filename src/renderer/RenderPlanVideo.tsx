import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { createDefaultRecipeRegistry } from "../recipes";
import type { RenderPlan, RenderPlanBeat, RenderPlanLayer } from "../render-plan";
import type { StageTheme } from "../stage";
import { AssetView } from "./AssetView";

/**
 * The renderer: the ONLY module in the project that knows Remotion exists.
 * It is an interpreter, not a decision-maker — every value it paints was
 * fixed by the compiler; the only computation happening here is evaluating
 * each layer's recipe (a pure function) at the current frame and turning
 * the result, plus the window's compiled camera, into CSS.
 *
 * Continuity (M10) is executed, never inferred: a beat window arrives with
 * every visible entity as a pre-sorted layer — enters, holds, and exits
 * alike — so this module paints the array in order and does nothing else.
 *
 * Recipes reach this module by name: the plan is pure JSON, so the actual
 * frame functions are resolved against the same canonical registry the
 * compiler validated against (see recipes/library.ts). Created once at
 * module scope — the registry is immutable after construction.
 */
const recipeRegistry = createDefaultRecipeRegistry();

export const RenderPlanVideo: React.FC<{ plan: RenderPlan }> = ({ plan }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {plan.beats.map((beat) => (
        <Sequence
          key={beat.id}
          from={beat.startFrame}
          durationInFrames={beat.durationInFrames}
        >
          <BeatWindowView beat={beat} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const BeatWindowView: React.FC<{ beat: RenderPlanBeat }> = ({ beat }) => {
  // Local to the enclosing <Sequence>, so frame 0 here is the beat's first
  // frame — exactly the coordinate system RecipeContext promises recipes.
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Camera: place the camera's look-at point (normalized) at frame center,
  // scaled by zoom. With transform-origin 0 0, a point p maps to
  // zoom * p + t, so t = center − zoom * cameraPoint.
  const { camera } = beat;
  const tx = 0.5 * width - camera.zoom * camera.x * width;
  const ty = 0.5 * height - camera.zoom * camera.y * height;

  return (
    <AbsoluteFill style={{ backgroundColor: beat.theme.backgroundColor }}>
      <AbsoluteFill
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${camera.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {beat.layers.map((layer) => (
          <LayerView
            key={`${layer.entityId}:${layer.role}`}
            layer={layer}
            theme={beat.theme}
            frame={frame}
            durationInFrames={beat.durationInFrames}
          />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const LayerView: React.FC<{
  layer: RenderPlanLayer;
  theme: StageTheme;
  frame: number;
  durationInFrames: number;
}> = ({ layer, theme, frame, durationInFrames }) => {
  const { width, height } = useVideoConfig();

  const recipe = recipeRegistry.get(layer.recipeName);
  const frameProps = recipe.sample({
    frame,
    durationInFrames,
    asset: layer.asset,
  });

  // Composition rule (see stage/stage.ts): recipe offsets add to the stage
  // placement's normalized position; recipe scale multiplies its base scale.
  const left = (layer.placement.x + frameProps.offsetX) * width;
  const top = (layer.placement.y + frameProps.offsetY) * height;
  const scale = layer.placement.scale * frameProps.scale;

  // Layers arrive in compiler-computed paint order; DOM order is stacking
  // order, so no zIndex is applied here.
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        // Placement coordinates address the asset's center.
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity: frameProps.opacity,
      }}
    >
      <AssetView
        asset={layer.asset}
        theme={theme}
        reveal={frameProps.reveal ?? 1}
      />
    </div>
  );
};
