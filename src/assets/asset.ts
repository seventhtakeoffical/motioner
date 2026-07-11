/**
 * The Asset type system describes the vocabulary of "things that can appear
 * on screen or be heard" — independent of how they are rendered (Renderer,
 * a later milestone) and independent of how a Beat's `visualIntent` gets
 * bound to one (Compiler, M5+). This file has zero imports from any other
 * module in the project: it does not know Remotion exists, and it does not
 * know the Bible schema exists.
 *
 * Two things live here:
 *  1. A closed set of concrete Asset kinds (a discriminated union).
 *  2. A Capability model: a fixed kind -> capability[] table describing
 *     what content facts each kind carries, so Recipes (M3) can ask "does
 *     this asset support X" without needing to know its concrete kind.
 *
 * Only three kinds are implemented here (text, image, audio) — enough to
 * prove the capability model works across genuinely different shapes of
 * asset. Expanding the kind vocabulary (icon, chart, video, captions, ...)
 * is explicitly M8's job, not this milestone's.
 *
 * Capability names describe facts about an asset's *content*, never
 * operations a renderer performs on it. "spatial" (has intrinsic extent
 * larger than a single view) and "scalable" (can be rendered at varying
 * scale) stay true whether the eventual renderer is Remotion, Three.js, or
 * Blender — a 2D pan, a 3D dolly, and an orbit are all just different ways
 * a Recipe might choose to express "explore this asset's spatial extent."
 * The capability only ever asserts that the content permits it; it never
 * names the technique.
 */

// Plain string alias, not a branded type. A branded AssetId would prevent
// accidentally passing a Beat or Scene id where an AssetId is expected, but
// nothing in the system does that kind of cross-domain lookup yet — adding
// the ceremony now would be abstraction ahead of a real need.
export type AssetId = string;

export interface TextAsset {
  kind: "text";
  id: AssetId;
  content: string;
}

export interface ImageAsset {
  kind: "image";
  id: AssetId;
  src: string;
  // Natural width/height of the source file, in pixels. Recipes that
  // explore this asset's spatial extent over time need to know how much
  // room it has beyond a single view; that's a property of the asset, not
  // something a recipe should have to read from disk itself.
  intrinsicWidth: number;
  intrinsicHeight: number;
}

export interface AudioAsset {
  kind: "audio";
  id: AssetId;
  src: string;
  // The asset's own physical runtime. A beat's `durationInFrames` (Bible,
  // M1) is an independently authored fact; this is the actual length of
  // the audio file. The compiler will eventually need both to decide
  // whether an audio asset must be trimmed, looped, or left as-is.
  durationInSeconds: number;
}

// ---- Kinds added at M8 -------------------------------------------------

export interface VideoAsset {
  kind: "video";
  id: AssetId;
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  durationInSeconds: number;
}

// Icons carry their vector geometry inline (an SVG path + viewBox) rather
// than a file reference. That is what makes the "colorable" capability
// honest — inline geometry can be filled with any theme color at render
// time, where a rasterized file could only be tinted approximately.
export interface IconAsset {
  kind: "icon";
  id: AssetId;
  viewBox: string;
  path: string;
}

export interface ChartDatum {
  label: string;
  // Non-negative by contract (enforced by the Bible schema): the v1 bar
  // renderer draws from a zero baseline, and signed data deserves a real
  // design decision, not an accidental one.
  value: number;
}

// Charts embed their data. The data IS the asset — script-derived creative
// material that must survive in the Bible/plan, not something fetched at
// render time (fetching would put I/O inside the deterministic boundary).
export interface ChartAsset {
  kind: "chart";
  id: AssetId;
  chartType: "bar";
  data: readonly ChartDatum[];
}

// A caption is text in *role*, not just in content: renderers style it as
// a lower-third, distinct from headline text. Same capabilities as text.
export interface CaptionAsset {
  kind: "caption";
  id: AssetId;
  content: string;
}

// The discriminated union is deliberately flat (each variant repeats `id`/
// `kind` rather than extending a shared base interface). A small inheritance
// hierarchy would save a few repeated lines but costs a layer of indirection
// for no present benefit — three flat interfaces are easier to read in full
// than a base type plus three extensions.
export type Asset =
  | TextAsset
  | ImageAsset
  | AudioAsset
  | VideoAsset
  | IconAsset
  | ChartAsset
  | CaptionAsset;

export type AssetKind = Asset["kind"];

// ---- Capability model ------------------------------------------------

export type Capability =
  | "textual" // holds text content that can be typed out, highlighted, etc.
  | "colorable" // supports recoloring/tinting
  | "spatial" // carries intrinsic extent larger than a single view, so a recipe may navigate across it
  | "scalable" // can be rendered at varying scale without a fixed native-size constraint
  | "temporal" // has an intrinsic duration that must be respected in the timeline
  | "revealable"; // content can be progressively revealed (text: characters; chart: marks) — added at M8

// A fixed table, not a per-instance field: capability is a property of the
// *kind* (every image is spatial), not something authored per asset
// instance. Typing this as `Record<AssetKind, ...>` means TypeScript forces
// an entry here whenever a new kind is added to the union above — a new
// kind cannot be added without also declaring its capabilities.
const ASSET_CAPABILITIES: Record<AssetKind, readonly Capability[]> = {
  text: ["textual", "colorable", "revealable"],
  image: ["spatial", "scalable", "colorable"],
  audio: ["temporal"],
  video: ["spatial", "scalable", "temporal"],
  icon: ["scalable", "colorable"],
  chart: ["scalable", "colorable", "revealable"],
  caption: ["textual", "colorable", "revealable"],
};

// The complete kind vocabulary as a value (the union type erases at
// runtime). Exists so tooling — e.g. the M12 authoring tool, which builds
// its prompt from the live vocabulary — can enumerate kinds without
// maintaining a parallel list that could drift.
export const ASSET_KINDS = Object.keys(ASSET_CAPABILITIES) as AssetKind[];

export function getCapabilities(kind: AssetKind): readonly Capability[] {
  return ASSET_CAPABILITIES[kind];
}

export function hasCapability(asset: Asset, capability: Capability): boolean {
  return ASSET_CAPABILITIES[asset.kind].includes(capability);
}
