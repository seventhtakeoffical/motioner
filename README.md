# Motioner — a deterministic AI-powered explainer video compiler

Scripts become videos through a pipeline with exactly one non-deterministic
step, and it runs first:

```
script ──▶ Claude Author ──▶ DRAFT Bible ──▶ human review ──▶ approval
 (LLM, the only              (JSON,           (report +        (content-
  non-deterministic           refused by       explicit         hashed
  component)                  the renderer)    confirmation)    record)
                                                                   │
                approved Bible + approval ──▶ deterministic compiler
                                                (pure TypeScript)  │
                                                                   ▼
                          Remotion renderer ◀── Render Plan (typed IR)
```

**The Production Bible is the only source of truth.** Once a Bible is
approved, everything downstream is a pure function of it: the same Bible
compiles to a byte-identical Render Plan, forever, on any machine, with no
API key present. No LLM runs in the compiler or renderer.

## The production workflow

```console
# 1. Draft a Bible from a script (requires ANTHROPIC_API_KEY or `ant auth login`)
npm run pipeline -- author script.txt --id my-video --title "My Video"

# 2. Review the draft: validation, warnings, assumptions, asset requests,
#    runtime, scene breakdown, continuity, approval status — and SEE it:
#    draft previews open Studio with a burned-in DRAFT watermark
npm run pipeline -- review drafts/my-video.bible.json --script script.txt
npm run pipeline -- preview --draft drafts/my-video.bible.json

# 2b. Satisfy the draft's Asset Requests (images with a generationBrief):
#     generates via an asset provider (nano-banana / gpt-image; needs
#     GEMINI_API_KEY or OPENAI_API_KEY) into public/generated/<id>/,
#     with provenance in manifest.json. Generated files are production
#     inputs — commit them, like approved Bibles. Re-run to retry failures;
#     existing files are skipped (--force regenerates).
npm run pipeline -- generate drafts/my-video.bible.json --draft
#     (works on the approved pair without --draft; never modifies the Bible)

# 3. Approve it (interactive confirmation; writes the approved pair)
npm run pipeline -- approve drafts/my-video.bible.json --by "Your Name"

# 4. Preview in Remotion Studio, or render headlessly
npm run pipeline -- preview approved/my-video.bible.json approved/my-video.approval.json
npm run pipeline -- render  approved/my-video.bible.json approved/my-video.approval.json
```

Rules the tooling enforces (not just documents):

- **Only approved Bibles render.** `render` and `preview` both start at
  `compileApprovedBible`, which demands an approval record whose content
  hash matches the exact Bible bytes. Drafts have no approval; drafts
  cannot render.
- **Approved artifacts are never edited.** Any edit — one character —
  invalidates the approval hash and rendering refuses. Changes flow
  through a new draft, a new review, and a new approval.
- **Drafts are disposable** (`drafts/` is gitignored); **approved pairs
  are production inputs** (`approved/` belongs in git).

## Project layout

| Directory | Contents | Deterministic? |
|---|---|---|
| `src/bible` | Bible schema (Zod), validation, approval hashing | ✅ pure |
| `src/assets` | Asset kinds + capability vocabulary | ✅ pure |
| `src/recipes` | Choreography recipes (pure frame functions) | ✅ pure |
| `src/stage` | Cross-beat continuity state model | ✅ pure |
| `src/compiler` | Bible → Render Plan, incl. the M7 approval gate | ✅ pure |
| `src/render-plan` | The typed IR between compiler and renderer | ✅ pure |
| `src/renderer` | The ONLY module that knows Remotion exists | interprets only |
| `author/` | The Claude Author (drafting tool) | ❌ the one LLM step |
| `review/` | Review report + approval workflow | report core is pure |
| `pipeline/` | The orchestrating CLI (`npm run pipeline`) | owns fs/process |

ESLint fences the deterministic modules: `Math.random`, wall-clock time,
I/O imports, and Remotion itself are banned there and enforced in CI
(`npm run lint`). Determinism is also tested — the compiler suite asserts
byte-identical plans across repeated runs (`npm test`).

## Development commands

```console
npm run dev        # Remotion Studio (placeholder plan until you pass one)
npm test           # full test suite, including end-to-end workflow tests
npm run lint       # eslint + type-check of all four projects
npm run author     # the author CLI directly (same as pipeline -- author)
npm run review     # the review CLI directly (report | approve)
```

Studio and headless rendering share one path: a single `PipelineVideo`
composition renders whatever `RenderPlan` arrives as input props
(`calculateMetadata` reads duration/fps/size off the plan). The pipeline
CLI compiles the approved pair and passes the plan via `--props` to either
`remotion studio` or `remotion render`. Nothing is compiled inside the
bundle.

## Docs

- `BUILD_PLAN.md` — the milestone roadmap this project was built against.
- `author/README.md` — the drafting tool, its prompts, and its rules.
- Remotion fundamentals: https://www.remotion.dev/docs/the-fundamentals

## License

The Remotion framework requires a company license for some entities.
[Read the terms](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).


## Core Documents

- VISUAL_GRAMMAR.md — Product & visual rules (authoritative)
- ENGINEERING.md — Engineering policies (authoritative)
- BUILD_PLAN.md — Historical build record
- author/README.md — Author subsystem