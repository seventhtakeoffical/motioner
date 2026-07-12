# Motioner Engineering Policies

*Production-stabilization companion to `VISUAL_GRAMMAR.md`. The Grammar
says what the system must express; this document records the engineering
policies the code already enforces, so they survive as commitments rather
than as folklore. Nothing here proposes anything new. Where this document and the implementation disagree, treat the implementation as authoritative until the discrepancy is investigated. The document should then be updated in the same change that resolves the mismatch.

## 1. Versioning policy

Every artifact that outlives a process run carries the version of the
thing that produced it. The complete inventory:

| Constant | Value | Lives in | Bumped when |
|---|---|---|---|
| `BIBLE_SCHEMA_VERSION` | `"1"` | `src/bible/schema.ts` | A **breaking** schema change (see §3 — effectively never; additive changes do not bump it) |
| `GENERATOR_VERSION` | `"2.0.0"` | `generate/run.ts` | The generation orchestrator's behavior changes in a way provenance readers should know about |
| Pipeline names | `object-v1`, `plate-v1` | `asset-pipeline/pipelines.ts` | A pipeline's pass composition changes → new **name** (`-v2`), never a silent redefinition |
| Pass versions | semver per pass | `asset-pipeline/passes.ts` | A pass's algorithm or defaults change → bump its `version`; the old behavior is gone, but the fingerprint records which one ran |
| Prompt template versions | e.g. `object-world-v1` | `generate/provider.ts` | The template's wording changes; recorded in raw provenance so regenerations are explainable |
| Runtime versions | node / sharp / libvips / onnxruntime | `asset-pipeline/pipelines.ts` (`runtimeVersions()`) | Never bumped by hand — observed at run time, recorded in canonical provenance **only** |

Two version domains, firewalled from each other:

- The **pipeline fingerprint** (`asset-pipeline/framework.ts`) is a sha256
  over the resolved chain descriptor — pass names, pass versions, resolved
  params, pinned artifact hashes (model weights). Same definition, same
  fingerprint, forever. Wall-clock time and machine facts **never** enter
  a fingerprint.
- **Runtime versions** are environment metadata for provenance only. When
  a re-normalization years later produces different bytes from the same
  raw and the same fingerprint, the recorded runtime stack is what
  explains it. They never influence behavior and never enter fingerprints.

`pipeline renormalize` uses the fingerprint as the staleness signal: a
canonical asset whose recorded fingerprint no longer matches the current
pipeline definition gets re-canonicalized from its archived raw (zero
generation spend).

Remotion is pinned to an exact version (`remotion`, `@remotion/cli` at
`4.0.487` in `package.json`) because renderer output pixels depend on it.
Upgrades are deliberate commits, never drive-by `^` drift.

## 2. Frozen-name policy

Approved Bibles and provenance manifests on disk reference vocabulary by
string. A rename orphans committed production artifacts, so **names are
frozen the moment they ship**. Deprecate by adding a successor name;
never rename, never remove, never repurpose.

Frozen namespaces and their canonical definitions:

- **Recipe names** — `src/recipes/library.ts` (`static-fade`, `slide-in`,
  `pan-zoom`, `typewriter`, `draw-on`, `pop-in`, `hold`, `exit-fade`,
  `exit-slide`). The Render Plan references recipes by name; compiler and
  renderer must resolve names against this one registry.
- **Recipe parameter names, enum values, and bounds** — each recipe's
  `params` spec. Approved Bibles embed authored values; loosening bounds
  is additive, tightening or renaming is breaking.
- **Asset kinds** — `src/assets/asset.ts` `ASSET_CAPABILITIES` keys
  (`text`, `image`, `audio`, `video`, `icon`, `chart`, `caption`).
- **Capabilities** — the `Capability` union (`textual`, `colorable`,
  `spatial`, `scalable`, `temporal`, `revealable`). A kind's capability
  set may **grow** (new recipes become bindable); removing a capability
  breaks previously approved bindings.
- **Bible schema field names** — `src/bible/schema.ts`. Covered by §3.
- **Provenance field names** — `RawProvenanceEntry` /
  `CanonicalProvenanceEntry` in `generate/run.ts`. Committed manifests
  are production records; fields may be added (optional), never renamed.
- **Pipeline / pass names and `GenerationForm` values** (`object`,
  `plate`) — they appear verbatim in provenance chains.

The authoring prompt enumerates recipes, params, and kinds **from the
live registries at run time** (`author/`), so the frozen vocabulary has
exactly one definition and the prompt cannot drift from it. Never
introduce a parallel hand-maintained list.

## 3. Additive-only schema evolution

The rule (Visual Grammar, Part II §9): **new fields are optional; shipped
vocabulary is frozen; every previously approved hash must keep
verifying.**

What this means mechanically:

- Every object schema in `src/bible/schema.ts` is `.strict()`: unknown
  fields are validation errors, not silently stripped. So a *new* field
  must be `.optional()` — otherwise every previously approved Bible stops
  parsing, which is a broken public contract.
- The approval hash (`hashBible`) covers exactly the document's content.
  Adding an optional field to the schema changes no existing document and
  therefore no existing hash: old approved pairs verify forever. That
  invariant is the test for whether a change is additive.
- Existing fields never change type, meaning, or requiredness. A field
  whose semantics must change gets a successor field; the old one keeps
  its meaning for the documents that already use it.
- `schemaVersion` is a **literal** (`"1"`). It exists so a future breaking
  change can be detected and refused rather than misinterpreted — but
  during production stabilization there are no breaking changes, so it
  does not move. Precedent: M8 added four asset kinds and M15 added
  `recipeParams`/`generationBrief`/`visualStyle`/`plate` — all additive,
  version stayed `"1"`.
- The same rule applies to provenance manifests: readers must tolerate
  the absence of fields newer than the manifest (e.g. `runtime` is
  optional because pre-audit manifests lack it — see
  `CanonicalProvenanceEntry`). Never require a new field of old records.

## 4. Determinism guarantees

**The contract: same approved Bible + same registry contents + same committed assets + pinned toolchain ⇒ byte-identical Render Plan and reproducible renders.** No LLM, no clock, no I/O, no randomness downstream of
approval.

How it is enforced (not just promised):

- **Lint fences** (`eslint.config.mjs`): in `src/assets`, `src/bible`,
  `src/compiler`, `src/recipes`, `src/render-plan`, `src/stage` —
  `Math.random`, `Date.now`, `performance.now`, `new Date()`,
  `crypto.randomUUID`/`getRandomValues`, all `node:*`/fs/path/os/crypto/
  child_process/http imports, and the `remotion` import are build errors.
  `src/renderer` is exempt only from the Remotion import ban; time and
  randomness are banned there too. `npm run lint` runs these in CI.
- **Byte-equality tests**: the compiler suite asserts
  `JSON.stringify`-identical plans across repeated runs (`npm test`).
- **The plan is pure JSON by construction** — no functions, Dates, Maps,
  or `undefined` — and is emitted through `structuredClone` + deep-freeze
  (`src/compiler/compile.ts`), so it shares no references with its inputs
  and cannot be mutated after emit.
- **Every ordering is value-based, never incidental**: layer paint order
  sorts on (zIndex, entityId, role); the preload manifest and provenance
  manifests are value-sorted; resolved recipe params emit in spec-
  declaration order. Object-insertion-order dependence is a bug class,
  not a style preference.
- **The approval hash** is FNV-1a 64 over canonical JSON (keys
  recursively sorted; UTF-16 code units mixed bytewise — no encoder
  dependency). It is tamper-*evidence* against accidental drift, not
  cryptographic defense; `src/bible/approval.ts` is the single swap point
  if that threat model ever changes.
- **Clock-free core**: `createApproval` and `approveDraft` take
  `approvedAt` as a parameter; only impure outer-ring tooling reads time.

Honest boundaries of the guarantee:

- The **author** (LLM) and the **generation providers** are
  non-deterministic by design and live outside the fence. They are made
  *reproducible where possible* (`deterministicSeed`: same
  bibleId+assetId+brief → same seed) and *explainable always*
  (provenance, §1).
- **Canonicalization** is deterministic given the same raw bytes, the
  same fingerprinted chain, and the same runtime stack; across runtime
  eras, bytes may differ and the recorded `runtime` explains it. The
  render-time preflight (`pipeline/run.ts`) verifies on-disk asset bytes
  against recorded `canonicalSha256`, so silent pixel drift cannot reach
  a render.

## 5. Sibling file conventions

Artifacts that belong together sit next to each other and are discovered
by name, never by a lookup table:

- **The approved pair**: `approved/<bibleId>.bible.json` +
  `approved/<bibleId>.approval.json`. `findSiblingApproval`
  (`review/workflow.ts`) derives the approval path by replacing
  `.bible.json` → `.approval.json` in the same directory. Both files are
  production inputs — committed together, never edited (any edit invalidates the hash; changes flow through a new draft). `approveDraft` refuses to
  re-approve anything already inside `approved/`.
- **Drafts**: `drafts/<bibleId>.bible.json` — gitignored, disposable,
  never carry an approval sibling.
- **Raw archive**: `assets/raw/<bibleId>/<assetId>-<rawSha256[0:8]>.<fmt>`
  — hash-named, write-once, never overwritten — plus a sibling
  `manifest.json` of `RawProvenanceEntry` records keyed by `assetId`.
  Committed: raws are what renormalization replays from.
- **Canonical assets**: `public/generated/<bibleId>/<file>.png` plus a
  sibling `manifest.json` of `CanonicalProvenanceEntry` records keyed by
  `src`. Committed. The render preflight finds an asset's provenance by
  looking for `manifest.json` in the asset's own directory — the sibling
  convention is load-bearing, not cosmetic.
- **Manifest discipline** (`updateManifest`, `generate/run.ts`): entries
  are keyed, deduplicated, value-sorted, and written atomically
  (temp-file + rename), like the assets themselves. A manifest that
  exists but does not parse is corrupted provenance: every writer and
  reader stops with a hard error telling the operator to restore from
  git — silently starting fresh would erase the provenance of every
  other asset on the next write.
- **Rendered output**: `out/<bibleId>.mp4` by default — derived from the
  Bible filename, disposable, not committed.
