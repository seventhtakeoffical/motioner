import { gptImage } from "./providers/gpt-image";
import { nanoBanana } from "./providers/nano-banana";
import type { AssetProvider, GenerationKind } from "./provider";

/**
 * The provider registry (M16). Registry order is preference order: when no
 * provider is named, the first CONFIGURED provider supporting the request's
 * kind wins. Adding Flux or a Blender provider is one import and one array
 * entry — the orchestrator never changes.
 */
export const providers: readonly AssetProvider[] = [nanoBanana, gptImage];

/**
 * Pick the provider for a kind: explicit name (flag) beats ASSET_PROVIDER
 * (env) beats first-configured. Every refusal explains itself, including
 * each candidate's own unconfigured reason.
 */
export function selectProvider(
  kind: GenerationKind,
  explicitName?: string,
): AssetProvider {
  const name = explicitName || process.env.ASSET_PROVIDER;
  if (name) {
    const provider = providers.find((p) => p.name === name);
    if (!provider) {
      throw new Error(
        `Unknown provider "${name}". Available: ${providers.map((p) => p.name).join(", ")}.`,
      );
    }
    if (!provider.capabilities.includes(kind)) {
      throw new Error(
        `Provider "${name}" cannot generate "${kind}" assets ` +
          `(capabilities: ${provider.capabilities.join(", ")}).`,
      );
    }
    const configured = provider.isConfigured();
    if (!configured.ok) {
      throw new Error(`Provider "${name}" is not configured: ${configured.reason}.`);
    }
    return provider;
  }

  const capable = providers.filter((p) => p.capabilities.includes(kind));
  for (const provider of capable) {
    if (provider.isConfigured().ok) return provider;
  }
  const reasons = capable
    .map((p) => {
      const configured = p.isConfigured();
      return `  - ${p.name}: ${configured.ok ? "configured" : configured.reason}`;
    })
    .join("\n");
  throw new Error(
    `No configured provider can generate "${kind}" assets:\n${reasons}\n` +
      `Set the relevant API key, or choose one with --provider / ASSET_PROVIDER.`,
  );
}
