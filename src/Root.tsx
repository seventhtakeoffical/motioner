import React from "react";
import { Composition } from "remotion";
import { demoApproval, demoBible } from "./bible/demo";
import { compileApprovedBible } from "./compiler";
import { createDefaultRecipeRegistry } from "./recipes";
import { RenderPlanVideo } from "./renderer";

// The whole deterministic pipeline runs here, once, at module load: Bible
// in, Render Plan out — through the M7 gate, so even the dev preview
// exercises the real trust boundary (schema parse + approval hash check).
// The composition's duration/fps/dimensions are read off the plan — the
// Bible decided them; Remotion just gets told.
const plan = compileApprovedBible(
  demoBible,
  demoApproval,
  createDefaultRecipeRegistry(),
);

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="DemoExplainer"
      component={RenderPlanVideo}
      durationInFrames={plan.totalDurationInFrames}
      fps={plan.fps}
      width={plan.width}
      height={plan.height}
      defaultProps={{ plan }}
    />
  );
};
