# Context Lens — Idea & Concept

## One-line

A local tool that sits beside a chatbot window and makes the **inbound context** of every answer visible and editable: the memory, assumptions, and facts an answer rests on are surfaced as panels the user can inspect, correct, and switch off — then the answer is regenerated from the corrected context.

## Status (validated)

The core hypothesis is **proven in real use** (B1, clipboard transport). First live run: a question about a Docker course surfaced memory bullets that were irrelevant and wrong for that question (including job-market ageism, entirely unrelated). The bullets were **visible on the board and one-click removable**; unchecking them changed the model's answer. This is exactly the disease the tool exists to treat — irrelevant memory contaminating an unrelated query — and the tool made it visible and correctable instead of silently poisoning the answer.

Two design truths emerged from that run, now folded into this doc:

1. **Irrelevant bullets are the normal case, not the exception.** The injected memory has no sense of relevance to the current question, so the boards will routinely contain unrelated items. The tool's job is to make that irrelevance visible and cheap to remove — ideally with a **relevance pre-pass** that pre-dims bullets unrelated to the current question (a natural job for on-device Nano).
2. **Removal must mean "ignore and proceed," not "wipe and restart."** In the first run, unchecking everything left the model with nothing and it cold-restarted ("started asking from the beginning"). Hard deletion leaves a hole the model anxiously refills by re-interrogating. The remedy is to distinguish three user actions (see below).

## The problem

A chatbot user sees two things: an input box and an output box. Everything that shapes the answer is invisible:

- **Memory** — cross-session facts the model carries are hidden, lossy (a long, nuanced message becomes a flat bullet), and carry no status (something mentioned once and never built is stored as "user has X").
- **Assumptions** — the model silently pitches an answer at an assumed expertise level ("user knows RAG, skip it"). The user never sees the assumption, so when the answer doesn't fit, they can't see why.
- **Facts** — the model weaves in retrieved or computed claims (a stale 2024 press release, an arithmetic result) without exposing which claims the answer depends on.

The user has no control surface over any of it, and no way to say "that assumption is wrong, redo it."

## The idea

Put the inbound context on screen as **editable panels**, all **session-scoped**, refreshed after every model turn. The user corrects the context, then **regenerates** the answer from the corrected version.

### The panels

1. **Memory board** — the cross-session bullets in use this turn. Each has a checkbox (suppress for this session) and an override. Override uses a **handshake**: the user edits a bullet ("discussed JobShield, never built"), the model restates the exact phrasing it will hold ("User discussed a JobShield project but never built it; treat as hypothetical"), the user ratifies that phrasing, and the ratified string is **pinned** for the session so it does not drift back.

2. **Facts board** — discrete claims the answer relies on, split by type:
   - *Retrieved* (web results): shown with source and date; user can switch off a stale/dead-source result.
   - *Computed* (arithmetic, syntax): shown for inspection.
   The retrieved set is a **frozen evidence pool** — regeneration runs against the checked subset, no fresh search unless explicitly requested.

3. **Assumptions board** — surfaced **after** the answer, as `(assumption, likely_reason)` pairs ("RAG not explained" / "likely because: treated you as an experienced developer"). The user edits, corrects the reason, or switches an assumption off. Phrasing is deliberately inferential ("likely because…") so the panel invites correction rather than asserting a fact the model doesn't actually have.

4. **Actions board** (optional, low priority) — one-click verbs on the current artifact ("describe", "analyze").

### Restart

The user edits memory / assumptions / facts, presses **Restart**. The tool serializes the corrected active state into a structured context block (the **Context Spec**) and prepends it to the original question. The model regenerates against explicit, user-ratified constraints.

This is the core insight: the first answer's surfaced context is a *reconstruction* (the model's best guess at what drove it). The user edits that into what they want to be true. On restart those edits become a **declared input** — no longer reconstructed, genuinely operative. The system never depends on the model being honest about itself; it only depends on the second generation obeying an explicit instruction block, which models do reliably.

### Three distinct user actions (learned from first use)

A single "uncheck = delete" is too blunt. Unchecking must carry an intent about *what happens after removal*, or the model cold-restarts. Three actions, each composing a different instruction:

- **Suppress** — "this is irrelevant to my question; ignore it and **proceed** with what remains. Do not re-ask." (The common case — what the Docker run needed.)
- **Correct / Replace** — "this is wrong; here is the right version; use it and continue." (The override handshake path — the *non-blank* way to fix a bullet.)
- **Delete + re-ask** — "remove this and genuinely re-establish it from me." (Only when the user actually wants fresh input on that one item.)

The default for an unchecked bullet is **Suppress**, not Delete, precisely because hard deletion makes the model revert to first-principles interrogation.

## The real artifact: the Context Spec

The serialized, human-edited context block (called the "md file" in discussion) is the actual thing of value. It is inspectable, diffable, reusable, and portable across models. The four panels are just the editor for it. Keep the Context Spec as the centre of gravity.

## Honesty boundaries (do not oversell)

- **Memory** and **retrieved facts**, when read from real structured data, are *true readouts*. In the chatbox-only deployment (below) they become *self-report*, because the tool cannot see the model's actual internal memory store — it only sees what the model prints. Label accordingly.
- **Assumptions** and **computed facts** are always *reconstruction* — the model explaining its finished answer, not replaying its computation. A good, usually-accurate witness, not a camera. The value holds anyway because the **user is the ground truth** that closes the loop: even an imperfect assumption list is falsifiable and correctable by the person reading it.

## Deployment model (the constraint that shapes everything)

- **No API, no keys, no per-token fee.** The heavy reasoning happens inside the user's existing chatbot subscription (e.g. claude.ai), driven by copy-paste.
- **Local-first core with an optional hosted tier (Supabase)** for a 4–6 person multi-tester pilot. Three access tiers: signed-in synced, anonymous browser-local, and downloaded offline build. Admin has read access to tester data for validation analysis, disclosed at sign-in.
- **Local small model for glue.** Chrome's built-in Gemini Nano (Prompt API, on-device, free) does the small structured jobs: composing the prompts the user pastes, interpreting reply structure, and **scoring injected bullets for relevance to the current question** (the relevance pre-pass that pre-dims unrelated items). It is *not* used to answer the user's task — too weak and not factual. Heavy model answers; Nano glues.

### Two transports (same engine)

- **B1 (build first): clipboard.** User copies the model's reply into the tool; the engine parses it into panels; user edits; the engine composes the next prompt; user copies it back. No DOM access, maximally robust, simplest form factor.
- **B2 (later): browser extension.** A content script reads the live reply node and writes the input box directly (assignment, not paste), and detects when streaming finishes. Adds capability B1 cannot have, at the cost of coupling to the page. Built in a fresh phase; the engine is unchanged.

The engine must never assume clipboard. It exposes `ingestReplyWithFallback(text)` and `getComposedPrompt() -> text`; B1 wires these to copy-paste, B2 later wires the same two to DOM read/write.

## Market position (deferred, noted for later)

The idea itself has no moat — four panels and a restart is a UX pattern, copyable in a weekend. Defensibility, if pursued, would come from: the Context Spec becoming a cross-model standard; an accumulated library of user-authored specs (switching cost); a model-agnostic neutral layer the model vendors structurally won't build; or an auditable-context wedge for regulated industries. The platform (the chatbot vendor shipping this natively) is the real risk, not copycats. **This is explicitly out of scope until the local MVP works.**

## Build sequence

1. **Engine spine** — ingest a reply → boards → edit → compose next prompt → (manually) restart. Prove the one uncertain thing: *does editing the context and regenerating produce a meaningfully different, intended answer?*
2. **Introspection prompts** — the prompt templates that make the heavy model emit memory/assumptions/facts as parseable blocks. Check whether the surfaced assumptions are useful or generically useless.
3. **Session persistence** — Context Spec versioning, diffable restarts (local only).
4. **UI** — the four panels, modern and distinctive (not the generic AI-app look). UI last, on a proven engine.
