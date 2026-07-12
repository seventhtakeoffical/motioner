# Motioner Visual Grammar v1

*The design bible. Not a roadmap, not an architecture proposal. If you are new to this project: read this before you read the code, because every visual decision in the system — every prompt, every schema field, every recipe — exists to serve what's written here. When a proposed feature conflicts with this document, the feature is wrong or this document needs a deliberate v2. Nothing wins by default except the grammar.*

---

## Part I — The Grammar

### 1. Every video happens in a world, not on slides

**Why:** Viewers experience continuity as *place*. When elements share a space, the brain builds a model; when full frames replace each other, the brain resets. Resets are expensive — each one discards the mental model the previous seconds paid for.
**In the wild:** Johnny Harris tells twenty minutes of story on one map. Kurzgesagt's cells and planets live on one backdrop per chapter. PolyMatter's icons arrange and rearrange on a single pastel field.
**Optimize for:** one coherent space per scene — often per video — that elements enter, inhabit, and leave.
**Avoid:** any moment where the entire frame's contents are swapped at once without a storytelling reason.

### 2. An object is an inhabitant, not a picture

**Why:** A "picture" carries its own world — its own lighting, background, edges — and competes with everything else on screen. An "inhabitant" is an isolated subject that borrows the world it's placed in, so any number of them compose naturally.
**In the wild:** the cut-out phone, the flag, the character, the folder — every professional explainer element is a matted subject with transparency, sized well below the frame.
**Optimize for:** isolated subjects on transparent backgrounds, occupying 15–50% of frame height, composable by default.
**Avoid:** opaque rectangles; subjects with baked-in environments; any generated asset that couldn't sit next to another one without visual argument.

### 3. Backgrounds are atmosphere, not content

**Why:** The background's job is to make objects legible and set mood. The moment it demands attention, it stops being a background.
**In the wild:** solids, soft gradients, paper textures, faint particles — and per-chapter *color shifts* that mark emotional movement without clearing the stage.
**Optimize for:** simple, low-contrast, persistent plates; mood changes expressed as background/theme shifts *under* continuing objects.
**Avoid:** photographic backgrounds (unless the background *is* the subject, e.g. a map); busy textures; a new background per beat.

### 4. Persistence is the default; disappearance needs a reason

**Why:** This is what continuity *means*. An element that vanishes without narrative cause tells the viewer their mental model was wrong. An element that stays — even dimmed in a corner — keeps the story's furniture in place.
**In the wild:** the hero object (the phone, the map, the character) survives across scenes, rescaled and repositioned as context changes around it.
**Optimize for:** elements that persist across beats and — when the story continues — across scenes; exits that are motivated ("we're done with the card *because*…").
**Avoid:** clearing the stage out of habit; treating scene boundaries as mandatory amnesia.

### 5. The frame is always alive

**Why:** A static frame reads as a pause in the medium itself — the viewer's attention has nowhere to go and leaves. Life doesn't require events; it requires *breath*.
**In the wild:** Cleo Abram's text cards drift; Kurzgesagt's birds blink and bob; Harris's camera never fully stops.
**Optimize for:** at every second, at least one of — camera drift, an element entering/drawing, ambient idle motion, an emphasis on the narration's subject.
**Avoid:** any dead second; equally, avoid *everything* moving — ambience is quiet by definition.

### 6. Information arrives one thing at a time

**Why:** The viewer's eye can be directed to exactly one novelty per moment, and narration can only introduce one idea at a time. Serial arrival synced to speech is the deepest structural rule of the genre.
**In the wild:** watch any Veritasium diagram build — each arrow, label, and force appears precisely as it is spoken, never two at once. (Attachments are the exception that proves the rule: a label arriving *with* its object is one perceptual event, not two.)
**Optimize for:** one new element per narration phrase; annotations may ride in attached to their anchor.
**Avoid:** simultaneous unrelated entrances; visual events with no narration counterpart.

### 7. The camera is the narrator's eyes

**Why:** Camera movement is how the viewer is *taken* somewhere — attention, scale, and transition are all camera verbs. A camera that only teleports (cuts) can direct attention but can never convey travel, approach, or reveal.
**In the wild:** Harris flies across the map between story locations; Abram pushes slowly into everything important; Apple glides between products.
**Optimize for:** slow constant drift as the resting state; deliberate push-ins for emphasis; camera *travel* as a first-class transition between regions of the world.
**Avoid:** camera motion as decoration — every move should answer "what is the narrator looking at now, and why?"

### 8. Layout carries meaning

**Why:** Before anything moves, position and size have already told the viewer what matters. Size = importance. Center = focus. Proximity = relation. A row = enumeration. Layout is the cheapest storytelling channel we have — it costs zero motion.
**In the wild:** PolyMatter narrates "three companies" and three logos glide into a row; Apple centers one product in an ocean of negative space.
**Optimize for:** deliberate placement on a coherent hierarchy; generous negative space (empty frame area is *working* — it aims the eye); re-layout when the cast changes.
**Avoid:** everything centered; elements placed where there happened to be room; a frame more than ~half full.

### 9. Typography is punctuation, not prose

**Why:** The viewer is already listening to sentences. On-screen text that paraphrases narration forces reading and listening to compete, and both lose. Text earns the screen only when it does what voice cannot: label, quantify, or land a phrase.
**In the wild:** 1–6 word labels pinned to objects; enormous standalone numbers; a chapter title. Never a paragraph.
**Optimize for:** labels anchored to what they name; giant stats; punchline fragments.
**Avoid:** sentences; text floating unanchored in space ("orphan text"); text as a substitute for a missing visual.

### 10. Full-frame imagery is a held breath

**Why:** Because it's rare, it's powerful. A full-frame moment suspends the world for effect — an archival photo, a beauty shot — and works precisely because the grammar returns to objects afterward.
**In the wild:** Harris cuts to a full-bleed archival photo for two seconds, camera drifting, then back to the map. Perhaps a tenth of runtime, never the default.
**Optimize for:** deliberate, brief, camera-drifted full-frame punctuation.
**Avoid:** full-frame as the standard shot — that is the slideshow.

### 11. Focus is managed, never assumed

**Why:** With several elements alive, the viewer must always know which one the narration is about *right now*. Professional work manages this actively: the subject is bright, big, or centered; the rest dims but remains.
**In the wild:** Veritasium's diagram dims completed steps as the new force is discussed; Branch Education highlights the component being explained inside the full assembly.
**Optimize for:** an explicit "current subject" per beat, with non-subjects visually receded but present.
**Avoid:** several equally-weighted elements; removing things just because focus moved on.

### 12. Motion explains; it never decorates

**Why:** Every movement is read as meaning. When the narration says "drops on top," a slide from the top *is* the explanation; a slide from the left is a small lie the viewer must forgive. Unmotivated motion spends attention and buys nothing.
**In the wild:** the route line draws in the direction of travel; the counter counts up as growth is described; the card is *pulled out* of the drawer.
**Optimize for:** entrances, exits, and emphasis whose direction and character enact the verb being spoken.
**Avoid:** motion for motion's sake; contradictions between spoken verbs and screen movement.

### 13. Illustrations are cast members with one wardrobe

**Why:** Style is identity. A video whose assets come from five visual worlds feels assembled; one whose assets share a palette, rendering style, and lighting feels *authored*. Consistency is also what lets objects coexist (Principle 2).
**In the wild:** every Kurzgesagt asset is unmistakably Kurzgesagt; PolyMatter's flat icons never break style mid-video.
**Optimize for:** one declared visual style per video applied to every generated asset; isolated subjects; no text baked into images (models write gibberish, and text belongs to typography).
**Avoid:** per-asset style roulette; photorealism mixed with flat vector without intent; generated images containing lettering.

### 14. What should never happen on screen

A dead frame lasting more than a second. · Text paraphrasing the narration. · Two unrelated arrivals at once. · An object teleporting to a new position. · A full-frame slab replacing a full-frame slab. · Baked-in gibberish lettering from an image model. · More than ~7 simultaneous objects. · Motion contradicting the spoken verb. · A world reset without a narrative reason.

### 15. The PowerPoint anti-patterns

The genre we must never resemble is defined by: slide-flip transitions (everything swaps at once) · crossfade as the only transition · bullet-point text walls read aloud · centered-everything layout · dead frames between "slides" · clip-art style inconsistency. Each item above is the negation of a principle in this grammar; if a draft exhibits one, some layer of the system failed its job — Part III says which.

---

## Part II — Motioner Design Constraints

*Permanent. Every sprint respects all of these; none may be traded for a visual feature.*

1. **The Production Bible is the only source of truth.** Everything downstream is a function of it; nothing downstream may invent, infer, or fetch creative content.
2. **The script is the primary creative source.** The Bible serves the script; visuals serve the narration. Visuals exist to *explain* the narration — never to replace it, never to contradict it (Principle 12).
3. **Narration is human-recorded, always.** No TTS, ever — the voice is channel identity. `beat.narration` is the VO script; the recorded audio is timing ground truth; visuals align to it, never the reverse.
4. **The compiler is deterministic.** Same approved Bible → byte-identical Render Plan, forever, on any machine: no LLM, no clock, no I/O, no randomness inside the deterministic core, enforced by lint fences and byte-equality tests.
5. **The renderer is dumb.** It interprets fully-resolved plans and makes zero decisions beyond house style. It is the only module that knows Remotion exists.
6. **The approval gate does not move.** Only a human-approved, content-hashed Bible renders for production. Drafts preview only with a burned-in watermark. Any edit invalidates its approval. Changes flow through new drafts.
7. **The Render Plan is fully resolved, pure JSON.** Every timing, placement, parameter, and camera value is a resolved number; recipes are referenced by permanently frozen names.
8. **Impure tools (author, generator, review, retime) live outside the core** and depend on it one-way. They produce artifacts for human review; they never hold authority.
9. **Schema evolution is additive.** New fields are optional; kinds, capabilities, recipe names, and parameter names are frozen once shipped; every previously approved hash must keep verifying.
10. **Generated assets are production inputs.** Committed to git with full provenance (provider, model, seed, template version, draft/approved source) — never treated as disposable cache.
11. **Features require grammar.** Every engineering proposal must cite the principle(s) it serves. A feature no principle covers means either the feature is wrong or this document is amended first — explicitly, as a versioned change.

---

## Part III — Future Engineering Implications

*Each principle has exactly one owning layer — the place where it is enforced, and the first place to look when a draft violates it.*

| Principle | Owner | Why this layer |
|---|---|---|
| 1. World, not slides | **Authoring** | Worlds are composed by drafting decisions — background plate, scene scope, what persists. No renderer can rescue slide-thinking. |
| 2. Objects as inhabitants | **Asset generation** | Isolation, transparency, and sizing are properties of the produced file; templates and provider capabilities enforce them. |
| 3. Backgrounds as atmosphere | **Authoring** | Declaring one plate and shifting theme by chapter is a drafting choice. (Ambient texture polish is renderer house style, subordinate.) |
| 4. Persistence by default | **Bible schema** | What can persist, carry across scenes, or exit is exactly what the schema's continuity vocabulary permits the author to say. |
| 5. The living frame | **Renderer** | Ambient drift and idle-hold treatments are resting-state house style — uniform, deterministic, and not per-beat creative decisions. |
| 6. Serial information arrival | **Bible schema** | The beat model *encodes* this rule: one featured event per narration unit. This is that abstraction's justification — treat it as load-bearing. |
| 7. Camera as narrator's eyes | **Compiler** | Camera intent is authored, but continuity — resolved keyframes, smooth travel between states — is compiled stage state, like all continuity. |
| 8. Layout carries meaning | **Authoring** | Placement, hierarchy, and negative space are creative decisions in the Bible; tooling can assist, never decide. |
| 9. Typography as punctuation | **Prompt** | The author prompt is where sentence-text is forbidden and label/stat usage is taught; schema and renderer merely carry what's drafted. |
| 10. Full-frame as held breath | **Authoring** | When to suspend the world is a per-video storytelling judgment, not a template rule. |
| 11. Managed focus | **Bible schema** | "Current subject" must be *sayable* per beat before the compiler can dim anything — vocabulary precedes behavior. |
| 12. Motion explains | **Authoring** | Matching recipes, directions, and parameters to the narration's verbs is drafting craft, guided by prompts, expressed in the Bible. |
| 13. One wardrobe | **Asset generation** | Style consistency is enforced where prompts meet providers: a per-video style directive injected into every generation. |
| 14–15. Never-list & anti-patterns | **Authoring** (guarded by **Prompt** and review) | These are failures of composition; the review report is where violations should become visible before a human approves them. |

**The reading of this table matters as much as its rows:** eight of fifteen principles are owned by authoring and prompts, not by engine code. Motioner's visual quality is primarily an *authoring-intelligence* problem, secondarily a vocabulary problem (schema/compiler), and only lastly a rendering problem. Future sprints should be suspicious of any proposal that reaches for the renderer first.

---

*End of Visual Grammar v1. Amendments require a version bump and a stated reason — this document changes the way the Bible changes: deliberately, reviewably, and never by drift.*
