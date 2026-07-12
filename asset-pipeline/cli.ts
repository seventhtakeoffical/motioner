/**
 * Asset Pipeline CLI.
 *
 *   pipeline models                      — install + pin segmentation models
 *   pipeline renormalize <bibleId> [--all] [--raw-dir assets/raw] [--public-dir public]
 *
 * `renormalize` is the batch half of the immediate+batch design: it re-runs
 * canonicalization FROM ARCHIVED RAWS — zero generation spend — for every
 * asset whose canonical fingerprint no longer matches the current pipeline
 * (or all of them with --all). This is how normalization improvements
 * reach years-old assets. It reads raw manifests only: this subsystem
 * knows images, not Bibles.
 */

import fs from "node:fs";
import path from "node:path";
import { canonicalize, pipelineFingerprint } from "./pipelines";
import { installModels } from "./models";

interface RawEntry {
  assetId: string;
  rawPath: string;
  src: string;
  form: "object" | "plate";
  targetWidth: number;
  targetHeight: number;
  rawSha256: string;
  source: "draft" | "approved";
}

export async function runRenormalize(argv: string[]) {
  const args = { bibleId: "", all: false, rawDir: path.join("assets", "raw"), publicDir: "public" };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") args.all = true;
    else if (arg === "--raw-dir") args.rawDir = argv[++i] ?? args.rawDir;
    else if (arg === "--public-dir") args.publicDir = argv[++i] ?? args.publicDir;
    else rest.push(arg);
  }
  args.bibleId = rest[0] ?? "";
  if (!args.bibleId) {
    console.error("Usage: pipeline renormalize <bibleId> [--all]");
    process.exit(2);
  }

  const manifestPath = path.join(args.rawDir, args.bibleId, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`No raw manifest at ${manifestPath} — nothing to renormalize.`);
    process.exit(1);
  }
  const entries: RawEntry[] = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const canonicalManifestPath = path.join(
    args.publicDir, "generated", args.bibleId, "manifest.json",
  );
  const canonicalEntries: Array<{ src: string; fingerprint: string }> =
    fs.existsSync(canonicalManifestPath)
      ? JSON.parse(fs.readFileSync(canonicalManifestPath, "utf8"))
      : [];

  let refreshed = 0;
  let current = 0;
  for (const entry of entries) {
    const want = pipelineFingerprint({
      form: entry.form,
      targetWidth: entry.targetWidth,
      targetHeight: entry.targetHeight,
    });
    const have = canonicalEntries.find((c) => c.src === entry.src);
    if (!args.all && have?.fingerprint === want.fingerprint) {
      current++;
      continue;
    }
    const rawBytes = fs.readFileSync(path.join(args.rawDir, args.bibleId, entry.rawPath));
    const result = await canonicalize({
      rawBytes,
      form: entry.form,
      targetWidth: entry.targetWidth,
      targetHeight: entry.targetHeight,
    });
    const target = path.join(args.publicDir, entry.src);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, result.canonicalBytes);
    const updated = canonicalEntries.filter((c) => c.src !== entry.src);
    updated.push({
      src: entry.src,
      assetId: entry.assetId,
      rawSha256: result.rawSha256,
      pipeline: result.pipeline,
      fingerprint: result.fingerprint,
      chain: result.chain,
      form: entry.form,
      source: entry.source,
      canonicalSha256: result.canonicalSha256,
      normalizedAt: new Date().toISOString(),
      runtime: result.runtime,
    } as (typeof canonicalEntries)[number]);
    canonicalEntries.length = 0;
    canonicalEntries.push(...updated.sort((a, b) => (a.src < b.src ? -1 : 1)));
    console.log(
      `renormalized ${entry.assetId} → ${entry.src} (${result.pipeline}` +
        (result.warnings.length > 0 ? `, ${result.warnings.length} warning(s)` : "") +
        `)`,
    );
    refreshed++;
  }
  fs.mkdirSync(path.dirname(canonicalManifestPath), { recursive: true });
  // Atomic: provenance must never be left half-written by a crash.
  const tmp = `${canonicalManifestPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(canonicalEntries, null, 2) + "\n");
  fs.renameSync(tmp, canonicalManifestPath);
  console.log(`\n${refreshed} renormalized, ${current} already current.`);
}

export async function runModels() {
  await installModels();
}

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const main =
    command === "models"
      ? runModels()
      : command === "renormalize"
        ? runRenormalize(rest)
        : Promise.reject(new Error("Usage: cli.ts <models|renormalize> …"));
  main.catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
