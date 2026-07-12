import {
  makeExplainerTemplate,
  ProviderError,
  type AssetProvider,
  type GeneratedAsset,
} from "../provider";

/**
 * Nano Banana — Google's Gemini image model, via the REST generateContent
 * endpoint. Plain fetch, no SDK. Configured by GEMINI_API_KEY (or
 * GOOGLE_API_KEY). Does not honor seeds; the requested dimensions map to
 * the nearest supported aspect ratio.
 */

const MODEL = "gemini-2.5-flash-image";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SUPPORTED_RATIOS: Array<{ label: string; ratio: number }> = [
  { label: "1:1", ratio: 1 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "4:5", ratio: 4 / 5 },
  { label: "5:4", ratio: 5 / 4 },
  { label: "9:16", ratio: 9 / 16 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "21:9", ratio: 21 / 9 },
];

function nearestAspect(width: number, height: number): string {
  const want = width / height;
  let best = SUPPORTED_RATIOS[0];
  for (const candidate of SUPPORTED_RATIOS) {
    if (Math.abs(candidate.ratio - want) < Math.abs(best.ratio - want)) {
      best = candidate;
    }
  }
  return best.label;
}

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

export const nanoBanana: AssetProvider = {
  name: "nano-banana",
  capabilities: ["image"],
  // No alpha channel from Gemini image gen: composability is achieved via
  // the template's uniform-matte fallback (an optional background-removal
  // normalization step can upgrade this later).
  supportsTransparentBackground: false,
  promptTemplate: makeExplainerTemplate({ transparentBackground: false }),

  isConfigured() {
    return apiKey()
      ? { ok: true }
      : { ok: false, reason: "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set" };
  },

  async generate(request, prompt): Promise<GeneratedAsset> {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey() ?? "",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            imageConfig: {
              aspectRatio: nearestAspect(request.width, request.height),
            },
          },
        }),
      });
    } catch (error) {
      throw new ProviderError(
        `network failure reaching Gemini: ${error instanceof Error ? error.message : error}`,
        true,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `Gemini returned ${response.status}: ${body.slice(0, 300)}`,
        retryable,
      );
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
      }>;
    };
    const part = payload.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data,
    );
    if (!part?.inlineData?.data) {
      // No image in a 200 response — usually safety-filtered. Not retryable
      // with the same prompt.
      throw new ProviderError(
        "Gemini returned no image data (possibly safety-filtered brief).",
        false,
      );
    }
    const mime = part.inlineData.mimeType ?? "image/png";
    return {
      bytes: Buffer.from(part.inlineData.data, "base64"),
      format: mime.includes("jpeg") ? "jpeg" : mime.includes("webp") ? "webp" : "png",
      model: MODEL,
    };
  },
};
