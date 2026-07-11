# The Claude Author (M12)

Turns a raw script into a **draft Production Bible** by calling Claude.
This directory is the system's only non-deterministic component: the one
place allowed to call an LLM, read the clock, or touch the network. It
lives outside `src/` — outside the determinism lint fences, outside the
Remotion bundle — and nothing in `src/` imports from it. The dependency
arrow points one way only: the author imports the deterministic schema,
validator, and compiler to lint its own drafts before a human ever sees
them.

## Usage

```console
npm run author -- path/to/script.txt [--id my-video] [--title "My Video"] \
                  [--out drafts] [--dry-run]
```

- Auth: `ANTHROPIC_API_KEY` or an `ant auth login` profile (standard SDK
  resolution).
- `--dry-run` prints the fully assembled prompt without calling the API.
- Output: `drafts/<id>.bible.json` (the `drafts/` directory is gitignored —
  unreviewed LLM output does not belong in version control).

## How a draft becomes a video

```
script ──author──▶ DRAFT bible ──human review+edit──▶ approval (M13 workflow)
                                                          │
                                    compileApprovedBible(bible, approval) ──▶ render
```

**Approval is a mandatory human step. There is no way around it by
design.** The compiler's production entry (`compileApprovedBible`, M7)
demands an approval record whose content hash matches the exact document —
an unapproved draft, or a draft edited after approval, is refused. This
tool never writes approvals and never will; it produces candidates for
review, nothing more.

## How the prompt is built

Modular, with a strict split between prose and facts:

| Part | Source | Changes when |
|---|---|---|
| Role & hard rules | `prompts/system.md` | Principles change (rarely) |
| Schema field guide | `prompts/bible-schema.md` | `src/bible/schema.ts` changes |
| Pacing/staging craft | `prompts/authoring-guide.md` | Authoring policy changes |
| Recipe & asset vocabulary | **generated** from `defaultRecipes` + `ASSET_KINDS` at run time | Never edited by hand — cannot drift |
| Worked example | **generated** from the `showcaseBible` fixture at run time | Never edited by hand — always a real, compiling Bible |

The deterministic validators are the sole authority on validity:
`parseBible` (the same strict Zod parse the compiler's gate runs) checks
shape, then `compileBible` acts as a draft lint catching binding,
capability, duration, and scene-grammar errors — all before a human spends
review time on the draft. Validator errors feed up to two self-repair
turns before the tool gives up.

## What the author may and may not assume

**May:** creative authority over scene/beat segmentation, narration
phrasing, pacing, layout, recipe choice, theme, and camera; that the script
is the complete content source; default staging values from the authoring
guide.

**May not:** invent schema fields or vocabulary (recipes, kinds,
capabilities); reference image/video/audio files it wasn't explicitly told
exist; assume approval, or that its output renders without review; assume
anything downstream will default or repair — the pipeline validates and
refuses, nothing else.
