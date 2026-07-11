import { Audio, Video } from "@remotion/media";
import React from "react";
import { Img, staticFile } from "remotion";
import type { Asset, ChartAsset } from "../assets";
import { clamp01, easeOutCubic } from "../recipes";
import type { StageTheme } from "../stage";

/**
 * One visual per asset kind. Everything here is a pure function of
 * (asset, theme, reveal) — the renderer's only aesthetic contribution is
 * its "house style" constants (font sizes, base extents), applied
 * uniformly; every content decision was the Bible's.
 */
export const AssetView: React.FC<{
  asset: Asset;
  theme: StageTheme;
  /** 0..1 content-reveal fraction from the recipe channel (M9). */
  reveal: number;
}> = ({ asset, theme, reveal }) => {
  switch (asset.kind) {
    case "text":
      return (
        <TextView
          content={asset.content}
          reveal={reveal}
          color={theme.foregroundColor}
          fontSize={64}
        />
      );
    case "caption":
      // Same content mechanics as text; lower-third styling is what the
      // caption *kind* means to this renderer.
      return (
        <div
          style={{
            backgroundColor: theme.foregroundColor,
            color: theme.backgroundColor,
            padding: "12px 28px",
            borderRadius: 8,
          }}
        >
          <TextView
            content={asset.content}
            reveal={reveal}
            color={theme.backgroundColor}
            fontSize={36}
          />
        </div>
      );
    case "image":
      return (
        <Img
          src={resolveSrc(asset.src)}
          style={{
            width: asset.intrinsicWidth,
            height: asset.intrinsicHeight,
          }}
        />
      );
    case "video":
      return (
        <Video
          src={resolveSrc(asset.src)}
          style={{
            width: asset.intrinsicWidth,
            height: asset.intrinsicHeight,
          }}
        />
      );
    case "audio":
      // Audible, not visible; the positioning wrapper has no effect on it.
      return <Audio src={resolveSrc(asset.src)} />;
    case "icon":
      return (
        <svg
          viewBox={asset.viewBox}
          style={{ width: 200, height: 200, display: "block" }}
        >
          <path d={asset.path} fill={theme.foregroundColor} />
        </svg>
      );
    case "chart":
      return <BarChartView chart={asset} theme={theme} reveal={reveal} />;
  }
};

/** Bible src strings are public/ paths unless they're already absolute URLs. */
function resolveSrc(src: string): string {
  return src.startsWith("http://") || src.startsWith("https://")
    ? src
    : staticFile(src);
}

const TextView: React.FC<{
  content: string;
  reveal: number;
  color: string;
  fontSize: number;
}> = ({ content, reveal, color, fontSize }) => {
  // Code points, not UTF-16 units, so revealing never splits a surrogate
  // pair (and the character count is what a human would count).
  const chars = Array.from(content);
  const visible = chars.slice(0, Math.round(reveal * chars.length)).join("");
  return (
    <div
      style={{
        color,
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize,
        fontWeight: 700,
        lineHeight: 1.2,
        textAlign: "center",
        whiteSpace: "pre-wrap",
      }}
    >
      {visible}
    </div>
  );
};

// House-style chart geometry (per the dataviz guidance: thin marks with
// gaps, rounded data-ends anchored to a zero baseline, recessive baseline,
// category labels in ink — and no legend, since a single monochrome series
// is identified by the beat's narration, not a legend box).
const CHART_W = 640;
const CHART_H = 360;
const PLOT_H = 300;
const BAR_GAP = 24;
const END_RADIUS = 4;
const LABEL_SIZE = 20;

const BarChartView: React.FC<{
  chart: ChartAsset;
  theme: StageTheme;
  reveal: number;
}> = ({ chart, theme, reveal }) => {
  const n = chart.data.length;
  const max = Math.max(...chart.data.map((d) => d.value));
  const barWidth = (CHART_W - BAR_GAP * (n + 1)) / n;

  return (
    <svg width={CHART_W} height={CHART_H} style={{ display: "block" }}>
      <defs>
        {/* Bars extend END_RADIUS below the baseline and get clipped, so
            the data-end is rounded while the baseline end stays square. */}
        <clipPath id={`plot-${chart.id}`}>
          <rect x={0} y={0} width={CHART_W} height={PLOT_H} />
        </clipPath>
      </defs>
      <g clipPath={`url(#plot-${chart.id})`}>
        {chart.data.map((datum, i) => {
          // Staggered reveal: bar i grows during its own slice of the
          // overall reveal fraction, eased so each bar lands softly.
          const local = easeOutCubic(clamp01(reveal * n - i));
          const fullHeight = max > 0 ? (datum.value / max) * PLOT_H : 0;
          const height = fullHeight * local;
          return (
            <rect
              key={datum.label}
              x={BAR_GAP + i * (barWidth + BAR_GAP)}
              y={PLOT_H - height}
              width={barWidth}
              height={height + END_RADIUS}
              rx={END_RADIUS}
              fill={theme.foregroundColor}
            />
          );
        })}
      </g>
      {/* Recessive baseline. */}
      <rect
        x={0}
        y={PLOT_H}
        width={CHART_W}
        height={2}
        fill={theme.foregroundColor}
        opacity={0.4}
      />
      {chart.data.map((datum, i) => (
        <text
          key={datum.label}
          x={BAR_GAP + i * (barWidth + BAR_GAP) + barWidth / 2}
          y={PLOT_H + LABEL_SIZE + 12}
          textAnchor="middle"
          fill={theme.foregroundColor}
          opacity={0.7}
          fontFamily="Helvetica, Arial, sans-serif"
          fontSize={LABEL_SIZE}
        >
          {datum.label}
        </text>
      ))}
    </svg>
  );
};
