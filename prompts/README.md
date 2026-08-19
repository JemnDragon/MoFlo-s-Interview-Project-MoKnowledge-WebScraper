# LLM prompts

Four prompts. None of them runs in this build — the app ships clearly-labelled
placeholders instead (see `src/lib/mock/placeholders.ts`). These files are the
real prompts that would sit behind those placeholders in production.

**Three of the four share one template.** The fourth, Art Style, does not, and
that is the point of it: it is a *vision* call rather than a text completion, so
it needs images attached to the message, a fetch-and-encode step, a different
cost profile and a different failure mode. Prompts 1–3 are unwired because no
API key is configured. Prompt 4 is unwired because the plumbing around it does
not exist either.

## The shared template

Prompts 1–3 follow the same six-part structure, in this order. Prompt 4 keeps
parts 1, 3, 4, 5 and 6 and replaces part 2 — its input blocks are attached
images, not tagged text:

1. **Role / context framing** — what the model is, what system it is part of, and
   what the output feeds into. Grounding the model in "this becomes an SMB's
   marketing copy" changes its behaviour more than any instruction about tone.
2. **Labelled, source-tagged input blocks** — each snippet arrives wrapped with
   the page type it came from. The model can then weight an About-page passage
   differently from a blog aside, and can say *where* something came from.
3. **A single narrow task instruction** — one job per prompt. Prompt 2 produces
   two fields, but from one instruction with an explicit contrast between them,
   which is a different thing from a prompt that does four unrelated jobs.
4. **An explicit no-hallucination constraint** — base the answer only on the
   provided text; return `null` rather than infer. Stated as a rule about what to
   *do* when evidence is missing, not just a prohibition, because "don't make
   things up" without an escape hatch pushes a model toward hedged invention.
5. **A worked micro-example** — one short input, one correct output, including at
   least one `null`. Showing a `null` being returned is the single most effective
   part of the whole template: it demonstrates that returning nothing is an
   acceptable, expected answer rather than a failure.
6. **A strict JSON output shape** — matching the corresponding TypeScript type
   exactly, so the response parses straight into the schema without a
   reconciliation step where errors hide.

## The prompts

| File | Produces | Input | Type it matches |
|---|---|---|---|
| [`01-writing-style.md`](./01-writing-style.md) | Writing Style, one cohesive paragraph | text snippets | `FinalBrandingAndStyle["writingStyle"]` |
| [`02-overview-pitch.md`](./02-overview-pitch.md) | Overview + Pitch, from shared source material | text snippets | `FinalCompanyFoundation["overview"]`, `FinalPositioning["pitch"]` |
| [`03-testimonials-persona.md`](./03-testimonials-persona.md) | Alignment insight (not a schema field) | resolved text | `PersonaFitInsight` |
| [`04-art-style-vision.md`](./04-art-style-vision.md) | Art Style, one paragraph | **images** | `FinalBrandingAndStyle["artStyle"]` |

## Pipeline ordering

Prompts 1 and 2 consume raw snippet bundles and can run as soon as a scan
finishes, in any order.

**Prompt 3 cannot.** It reads the *resolved* Ideal Customer Persona — final text,
not snippets — so it must run after that field has been synthesised and reviewed.
Run it earlier and it compares real testimonials against a placeholder, which
would produce a confident-looking finding about nothing. The API route
(`/api/insights/persona-fit`) enforces this by returning
`alignment: "insufficient_data"` when the persona has not been resolved.

**Prompt 4 is independent of all three** and can run the moment a scan finishes,
because its input is image URLs rather than any other field's output. It is
listed last because it needs infrastructure the other three do not, not because
it depends on them.
