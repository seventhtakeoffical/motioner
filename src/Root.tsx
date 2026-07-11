import React from "react";
import { Composition } from "remotion";
import { demoApproval, demoBible } from "./bible/demo";
import { showcaseApproval, showcaseBible } from "./bible/showcase";
import { compileApprovedBible } from "./compiler";
import { createDefaultRecipeRegistry } from "./recipes";
import { RenderPlanVideo } from "./renderer";

// The whole deterministic pipeline runs here, once, at module load: Bible
// in, Render Plan out — through the M7 gate, so even the dev preview
// exercises the real trust boundary (schema parse + approval hash check).
// Each composition's duration/fps/dimensions are read off its plan — the
// Bible decided them; Remotion just gets told.
const demoPlan = compileApprovedBible(
  demoBible,
  demoApproval,
  createDefaultRecipeRegistry(),
);

const showcasePlan = compileApprovedBible(
  showcaseBible,
  showcaseApproval,
  createDefaultRecipeRegistry(),
);

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="DemoExplainer"
        component={RenderPlanVideo}
        durationInFrames={demoPlan.totalDurationInFrames}
        fps={demoPlan.fps}
        width={demoPlan.width}
        height={demoPlan.height}
        defaultProps={{ plan: demoPlan }}
      />
      <Composition
        id="Showcase"
        component={RenderPlanVideo}
        durationInFrames={showcasePlan.totalDurationInFrames}
        fps={showcasePlan.fps}
        width={showcasePlan.width}
        height={showcasePlan.height}
        defaultProps={{ plan: showcasePlan }}
      />
    </>
  );
};
