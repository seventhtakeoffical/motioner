import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import type { RenderPlan } from "./render-plan";
import { RenderPlanVideo } from "./renderer";
import { placeholderPlan } from "./renderer/placeholder";

/**
 * The Remotion root (as of M14): ONE composition, fed exclusively by input
 * props. Nothing compiles here — no Bibles, no fixtures, no compiler in the
 * render bundle. The pipeline CLI compiles an approved Bible into a Render
 * Plan and passes it via --props for both Studio preview and headless
 * rendering, so there is exactly one rendering path. Without props, the
 * placeholder plan renders instructions.
 *
 * All timing/dimension metadata is read off the supplied plan — the Bible
 * decided it, the compiler resolved it, Remotion just gets told.
 */
const calculateMetadata: CalculateMetadataFunction<{
  plan: RenderPlan;
  draft?: boolean;
}> = ({ props }) => ({
  durationInFrames: props.plan.totalDurationInFrames,
  fps: props.plan.fps,
  width: props.plan.width,
  height: props.plan.height,
});

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="PipelineVideo"
      component={RenderPlanVideo}
      durationInFrames={placeholderPlan.totalDurationInFrames}
      fps={placeholderPlan.fps}
      width={placeholderPlan.width}
      height={placeholderPlan.height}
      defaultProps={{ plan: placeholderPlan, draft: false }}
      calculateMetadata={calculateMetadata}
    />
  );
};
