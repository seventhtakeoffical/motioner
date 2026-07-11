import type { Asset, AssetId } from "./asset";

/**
 * A minimal, strongly-typed store of Asset instances keyed by id. This is
 * intentionally the only thing the registry does at this milestone: no
 * capability-based querying, no kind-based filtering, no loading from disk
 * or a manifest file. Those would be speculative additions — nothing
 * downstream needs them yet, and real asset sources are M8's job. Adding
 * them later is additive (new methods on this interface), not a redesign,
 * because consumers only ever depend on this narrow surface.
 */
export interface AssetRegistry {
  register(asset: Asset): void;
  get(id: AssetId): Asset;
  has(id: AssetId): boolean;
}

export function createAssetRegistry(): AssetRegistry {
  const assets = new Map<AssetId, Asset>();

  return {
    register(asset) {
      if (assets.has(asset.id)) {
        // A duplicate id would let some later binding silently resolve to
        // the wrong asset. Failing loudly here, at registration time, is
        // far cheaper than debugging a wrong-asset-on-screen bug downstream.
        throw new Error(`Asset with id "${asset.id}" is already registered.`);
      }
      assets.set(asset.id, asset);
    },
    get(id) {
      const asset = assets.get(id);
      if (!asset) {
        throw new Error(`No asset registered with id "${id}".`);
      }
      return asset;
    },
    has(id) {
      return assets.has(id);
    },
  };
}
