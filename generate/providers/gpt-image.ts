import {
  explainerImageTemplate,
  ProviderError,
  type AssetProvider,
  type GeneratedAsset,
} from "../provider";

/**
 * GPT Image — OpenAI's gpt-image-1, via the REST images endpoint. Plain
 * fetch, no SDK. Configured by OPENAI_API_KEY. Does not honor seeds; the
 * requested dimensions map to the nearest supported size.
 */

const MODEL = "gpt-image-1";
const ENDPOINT = "https://api.openai.com/v1/images/generations";

const SUPPORTED_SIZES: Array<{ label: string; ratio: number }> = [
  { label: "1024x1024", ratio: 1 },
  { label: "1536x1024", ratio: 1.5 },
  { label: "1024x1536", ratio: 1024 / 1536 },
];

function nearestSize(width: number, height: number): string {
  const want = width / height;
  let best = SUPPORTED_SIZES[0];
  for (const candidate of SUPPORTED_SIZES) {
    if (Math.abs(candidate.ratio - want) < Math.abs(best.ratio - want)) {
      best = candidate;
    }
  }
  return best.label;
}

export const gptImage: AssetProvider = {
  name: "gpt-image",
  capabilities: ["image"],
  promptTemplate: explainerImageTemplate,

  isConfigured() {
    return process.env.OPENAI_API_KEY
      ? { ok: true }
      : { ok: false, reason: "OPENAI_API_KEY is not set" };
  },

  async generate(request, prompt): Promise<GeneratedAsset> {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          n: 1,
          size: nearestSize(request.width, request.height),
          output_format: "png",
        }),
      });
    } catch (error) {
      throw new ProviderError(
        `network failure reaching OpenAI: ${error instanceof Error ? error.message : error}`,
        true,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `OpenAI returned ${response.status}: ${body.slice(0, 300)}`,
        retryable,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string }>;
    };
    const b64 = payload.data?.[0]?.b64_json;
    if (!b64) {
      throw new ProviderError("OpenAI returned no image data.", false);
    }
    return { bytes: Buffer.from(b64, "base64"), format: "png", model: MODEL };
  },
};
