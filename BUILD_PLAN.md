# Build Plan — Deterministic AI Explainer Video Compiler

> **HISTORICAL DOCUMENT.** This is the milestone roadmap Motioner was
> built against (M0–M15, all delivered). It is preserved unchanged as a
> record of how the system came to be — not as guidance. Motioner is now
> in **production stabilization**: the architecture is frozen, and the
> governing documents are **`VISUAL_GRAMMAR.md`** (what the system must
> express) and **`ENGINEERING.md`** (the policies the code enforces —
> versioning, frozen names, additive-only schema evolution, determinism,
> file conventions). Future engineering work follows those documents,
> never this one; where they and this plan disagree, this plan is simply
> out of date.

## Pipeline recap

```
Script → Production Bible (Claude, draft only) → [human approval] →
Deterministic Compiler (pure TS) → Render Plan (typed IR) → Remotion Renderer → Final Video
```

Everything to the right of "approval" must be pure, deterministic TypeScript. Claude
never runs inside the compiler or renderer — it only ever produces a draft Bible that
a human reviews and locks.

## Ordering principle

Types before implementations, contracts before content, one narrow vertical slice
before breadth. We prove the whole pipeline works end-to-end on the smallest possible
example (one scene, one asset, one recipe) before scaling out asset types, recipes, or
Stage continuity. This lets architecture problems surface early, while the blast
radius of a wrong turn is still one file.

---

## M0 — Module layout & conventions

**Deliverable:** Agreed folder structure, no code.
```
src/
  bible/        # Production Bible schema + validation
  assets/       # Typed asset definitions + capability declarations
  recipes/      # Pure choreography functions, shared by compiler & renderer
  stage/        # Cross-beat continuity model
  compiler/     # Bible + registries -> Render Plan (pure TS)
  render-plan/  # Typed IR emitted by the compiler, consumed by the renderer
  renderer/     # Remotion components that interpret a Render Plan
```
**Why first:** Every later milestone needs to know where its file lives and which
other modules it's allowed to import from (recipes are shared by compiler + renderer;
nothing imports from `renderer/` except the Remotion entry point, etc.).

---

## M1 — Production Bible schema

**Deliverable:** TypeScript types + runtime (zod) schema for the Bible: script
metadata, scenes, beats, asset references, timing/duration hints.

**Why now:** The Bible is the single source of truth for everything downstream. Every
other module (assets, recipes, stage, compiler) is defined in terms of "what a Bible
contains," so the schema has to exist and be stable before anything binds against it.

---

## M2 — Asset type system

**Deliverable:** Typed asset kinds (e.g. text, image, icon, chart, audio) and a
capability model — what operations/transforms each kind supports (e.g. "can be
panned/zoomed," "can be drawn-on," "has a duration"). Plus a minimal Asset Registry.

**Why here:** Recipes bind against asset types and capabilities, so the vocabulary of
"what an asset is and can do" must exist before we can define what a recipe is allowed
to require.

---

## M3 — Recipe contract + registry

**Deliverable:** The `Recipe` interface — declares required asset type(s) and
capabilities, exposes a pure function of `(frame, params) → resolved props`, and
reports its own duration/timing needs. A minimal Recipe Registry (lookup by name).
No real recipes yet beyond a trivial placeholder (e.g. static fade).

**Why here:** The compiler's core job is "match beats to recipes and validate the
binding," so the recipe contract must exist before the compiler can be written.
Recipes are pure TS and shared by both compiler (for validation/duration) and
renderer (for actual frame math) — defining the contract first keeps that sharing
clean from the start.

---

## M4 — Stage model

**Deliverable:** The `Stage` type and its update API — the state that persists across
beats (camera/viewport, active asset positions, z-order, theme), plus rules for how a
beat's recipe reads and mutates it.

**Why here:** Stage continuity is bookkeeping the compiler performs while it walks
beats in order, invoking recipes along the way — so it depends on the Recipe contract
(M3) existing, but must be defined before the compiler orchestration logic (M5) is
written.

---

## M5 — Vertical slice: smallest possible end-to-end pipeline

**Deliverable:** One minimal Bible (single scene, single beat, single text asset,
single trivial recipe) → compiler that emits a typed Render Plan → Remotion renderer
that consumes the Render Plan and renders real pixels. Runnable via `npm run dev`.

**Why here:** This is the highest-risk milestone — it proves the mechanics of the
whole architecture (Bible → Compiler → Render Plan → Renderer) actually cohere before
we invest in breadth. Everything built in M1–M4 is deliberately minimal so this slice
can be reached fast; problems found here are cheap to fix because so little exists
yet.

---

## M6 — Determinism guarantees

**Deliverable:** Tests that run the compiler N times on the same Bible and assert
byte-identical Render Plan output. A checklist/lint rule banning nondeterministic
primitives in `compiler/`, `recipes/`, and `render-plan/` (`Math.random()` without a
seed, `Date.now()`, network/filesystem calls, object-key iteration order dependence).

**Why here:** Determinism is the project's core promise, and now that a full pipeline
exists (M5), we can actually test it. Doing this right after the vertical slice
prevents nondeterminism from creeping in as we add breadth in M7+.

---

## M7 — Bible validation & approval boundary

**Deliverable:** A hard validation gate at the compiler's entry point (parse Bible
with the M1 schema, reject with clear errors on failure) and an "approval" mechanism
(e.g. a hash/lock file) that distinguishes an unreviewed Claude draft from a
human-approved Bible the compiler is allowed to run on.

**Why here:** Now that we know (M5) what a valid, compilable Bible looks like in
practice and (M6) what determinism requires of it, we can formalize the boundary
between "untrusted LLM output" and "trusted deterministic input."

---

## M8 — Expand asset type coverage

**Deliverable:** Add remaining asset kinds needed by real scripts: images, video
clips, vector icons, chart/data-viz assets, audio/voiceover, captions — each with
capability declarations (M2's model).

**Why here:** Breadth is added only once the contract (M2) and the full pipeline (M5)
are proven on one asset kind. Expanding now is informed by real script needs rather
than speculative upfront design.

---

## M9 — Expand recipe library

**Deliverable:** Multiple real choreography recipes per relevant asset type/capability
pair (pan/zoom, typewriter, draw-on chart, slide/transition recipes, camera moves),
each declaring its asset-type/capability bindings per the M3 contract.

**Why here:** Recipes are the most content-heavy part of the system; growing the
library is cheapest once assets exist to bind against (M8) and the contract (M3) has
already been stress-tested by the vertical slice.

---

## M10 — Full Stage continuity

**Deliverable:** Real continuity behavior — camera/composition state carried across
beats, transition resolution between one recipe's exit and the next's entrance,
persistent z-order/layering across a scene.

**Why here:** Continuity logic is only meaningfully testable once there are several
recipes and asset types (M8, M9) to carry state between. Building it earlier would
mean designing against hypothetical cases instead of real ones.

---

## M11 — Full multi-scene compiler orchestration

**Deliverable:** Compiler assembles many scenes/beats into one timeline: global
timing derivation (fps, total duration), deterministic ID assignment, asset
preload/manifest list, final Render Plan for an entire video.

**Why here:** This is the "scale out" step — safe to do now because the compiler's
core logic, recipe/asset contracts, Stage continuity, and determinism guarantees are
all already proven at small scale.

---

## M12 — Claude Bible-drafting tool

**Deliverable:** A script/prompt that calls Claude to turn a raw Script into a draft
Production Bible conforming to the M1/M7 schema.

**Why this late:** This is the only non-deterministic part of the system, and it's
fully decoupled from the deterministic pipeline. Building it after the schema has been
exercised end-to-end (M1–M11) avoids churn — an early schema change would otherwise
invalidate prompts and require re-tuning generation.

---

## M13 — Human review/approval workflow

**Deliverable:** A CLI/tool to view a draft Bible, diff it against a script or prior
version, and mark it approved/locked (wiring into M7's approval boundary).

**Why here:** Closes the loop from script to a compiler-ready Bible now that both ends
(drafting in M12, the approval gate in M7) exist.

---

## M14 — Full pipeline CLI + Studio integration

**Deliverable:** One command that runs `script → draft Bible → (manual approval) →
compile → Render Plan`, plus Remotion Studio wired to preview compiled output live.

**Why here:** Last-mile integration, done last because it only has to wire together
pieces that are each already independently correct.

---

## M15+ — Ongoing growth (stretch)

Additional asset kinds, more recipes, voiceover/caption timing sync, performance and
caching in the compiler, etc. — open-ended, driven by real production needs rather
than upfront design, added only as real scripts demand them.
