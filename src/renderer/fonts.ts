import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/**
 * The renderer's bundled typeface (production audit MUST-FIX #2).
 *
 * System font stacks ("Helvetica, Arial, sans-serif") resolve differently
 * per machine, which quietly broke the cross-machine render-stability
 * claim: the same approved Bible could produce different text metrics on
 * a Linux CI box than on the workstation that previewed it. The font
 * files are committed under public/fonts/ (Inter, SIL OFL) and loaded
 * from the bundle — no network, no environment dependence.
 */
export const RENDERER_FONT = "MotionerSans";

loadFont({
  family: RENDERER_FONT,
  url: staticFile("fonts/inter-400.woff2"),
  weight: "400",
});
loadFont({
  family: RENDERER_FONT,
  url: staticFile("fonts/inter-700.woff2"),
  weight: "700",
});

export const RENDERER_FONT_STACK = `${RENDERER_FONT}, sans-serif`;
