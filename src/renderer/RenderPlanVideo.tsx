import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Asset } from "../assets";
import { createDefaultRecipeRegistry } from "../recipes";
import type { RenderPlan, RenderPlanItem } from "../render-plan";
import type { StageTheme } from "../stage";

/**
 * The renderer: the ONLY module in the project that knows Remotion exists.
 * It is an interpreter, not a decision-maker — every value it paints was
 * fixed by the compiler; the only computation happening here is evaluating
 * each item's recipe (a pure function) at the current frame and turning
 * the result into CSS.
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
      {plan.items.map((item) => (
        <Sequence
          key={item.id}
          from={item.startFrame}
          durationInFrames={item.durationInFrames}
        >
          <BeatItemView item={item} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const BeatItemView: React.FC<{ item: RenderPlanItem }> = ({ item }) => {
  // Local to the enclosing <Sequence>, so frame 0 here is the beat's first
  // frame — exactly the coordinate system RecipeContext promises recipes.
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const recipe = recipeRegistry.get(item.recipeName);
  const frameProps = recipe.sample({
    frame,
    durationInFrames: item.durationInFrames,
    asset: item.asset,
  });

  // Composition rule (see stage/stage.ts): recipe offsets add to the stage
  // placement's normalized position; recipe scale multiplies its base scale.
  const left = (item.placement.x + frameProps.offsetX) * width;
  const top = (item.placement.y + frameProps.offsetY) * height;
  const scale = item.placement.scale * frameProps.scale;

  return (
    <AbsoluteFill style={{ backgroundColor: item.theme.backgroundColor }}>
      <div
        style={{
          position: "absolute",
          left,
          top,
          // Placement coordinates address the asset's center.
          transform: `translate(-50%, -50%) scale(${scale})`,
          opacity: frameProps.opacity,
          zIndex: item.placement.zIndex,
        }}
      >
        <AssetView asset={item.asset} theme={item.theme} />
      </div>
    </AbsoluteFill>
  );
};

const AssetView: React.FC<{ asset: Asset; theme: StageTheme }> = ({
  asset,
  theme,
}) => {
  switch (asset.kind) {
    case "text":
      return (
        <div
          style={{
            color: theme.foregroundColor,
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.2,
            textAlign: "center",
            whiteSpace: "pre-wrap",
          }}
        >
          {asset.content}
        </div>
      );
    case "image":
    case "audio":
      // The M5 slice renders text only; broadening asset coverage is M8's
      // deliverable (BUILD_PLAN.md). Failing loudly beats rendering nothing.
      throw new Error(
        `Rendering for "${asset.kind}" assets is not implemented until M8.`,
      );
  }
};
