# Context Lens — B1 Build Spec & Session Handoff

**Status:** B1 copy-paste engine ~85% complete (parser, smart prompts, clipboard UI, regenerate-with-DELETE, conversation spiral). **Direction updated (rev. 2):** the next phase is no longer "polish the per-answer editor" — it is **build the longitudinal record (the brain)**. See _Direction update_ and _New tasks_ below. The per-answer boards become the editor for the record at task **R4**.

---

## What this is

A **client-only single-page web app**. No backend. No server. No database. Session state lives in memory in the browser.

**B1** = the heavy reasoning happens in a _separate_ chatbot tab (ChatGPT, Claude, Gemini, etc.). Context Lens is the **engine + editor**: it decorates your question, parses structured replies into boards, lets you edit context, and composes prompts that tell the chatbot what to delete and regenerate.

**B2** (not started) = browser extension replaces clipboard with live DOM read/write. The engine stays transport-agnostic.

**Do not build B2. Do not call paid model APIs. Do not build a backend** (this constraint is revisited only at task **R5**, which is explicitly optional and deferred).

---

## Direction update (rev. 2) — the record is the product

Extended review changed the target. Summary (full reasoning in `Idea.md` rev. 2):

- The problem worth solving is **stateless, timeless memory**, not per-answer assumption editing. Flat bullets have no status, no time, no supersession, no provenance — so long threads rot and cross-session/cross-model continuity is lost.
- **The record is the product.** The model is a swappable reasoner. The shell is already built by others (TypingMind, LibreChat, Msty, Poe, OpenRouter). Do not spend effort rebuilding the shell.
- The differentiated, unbuilt-at-consumer-level part is **the brain**: a structured, status-tracked, timestamped, self-superseding record that re-briefs whichever model is in use each turn.
- The existing copy-paste transport is already model-agnostic (clipboard works on every chatbox). **Keep it.** Build the record on top of it.
- **Commit authority stays with the user.** The model proposes record edits and state transitions; the user ratifies. No silent state changes.

The five new tasks (R1–R5) below are a ladder: each is independently usable and adds one capability.

---

## Build operations (read first — for the Cursor agent on the VM)

- Build incrementally, **one task at a time, in order**: R1 → R2 → R3 → R4 → (R5 optional). Do not start a task until the previous one's tests pass.
- **Commit after every task** (and after meaningful sub-steps) with a clear message, e.g. `R1: typed record schema + migration`. The commit is the checkpoint.
- Running out of tokens / usage budget is expected. Handle it like this: finish the current edit to a compiling state, run tests, commit, then stop cleanly — do not abandon work mid-file. When the token budget replenishes, resume from the **last committed checkpoint**: re-read this file, check which `[x]` boxes are done and what the latest commit is, and continue with the next unchecked task. Do not restart the whole build from scratch; pick up where the commits left off.
- Keep this file as the source of truth for progress. As each task completes, tick its `[ ]` → `[x]` here and commit that change too, so the next run (yours or a fresh session) can tell exactly where things stand.
- If a task is too large for one budget window, split it at a natural sub-step, commit the partial work, tick the sub-steps done, and resume the remainder next window.
- Never delete or rewrite working B1 code to "start over." The record layer (R1–R5) is **additive** behind the engine; the existing copy-paste loop must keep working throughout.

---

## How to run

```bash
npm install
npm run dev          # → http://localhost:5173
npm test             # vitest
npm run build        # → dist/
```

Requires Node/npm on PATH for development. The built `dist/` folder is static files only — no Node at runtime for end users.

---

## Stack (as built)

| Layer    | Choice                                                                   |
| -------- | ------------------------------------------------------------------------ |
| Language | **Plain JavaScript** (ES modules) — not TypeScript                       |
| Bundler  | Vite 6                                                                   |
| UI       | Native DOM (`createElement`, `textContent`) — no React                   |
| CSS      | Single `main.css` — dark editorial, corner gradients, responsive         |
| Tests    | Vitest (`tests/parser.test.js`, `tests/smoke.test.js`, `tests/spiral.test.js`) |
| Fonts    | Libre Baskerville, Inter, IBM Plex Mono (Google Fonts)                   |

Optional: Gemini Nano via `window.LanguageModel` for parse/compose fallback only (`src/engine/nano.js`).

---

## Project layout

```
.
├── CURSOR_BUILD.md          ← this file
├── index.html
├── package.json
├── vite.config.js
├── vitest.config.js
├── src/
│   ├── main.js              # boot, wire engine ↔ UI
│   ├── engine/
│   │   ├── parser.js        # parseReplyBlocks(text)
│   │   ├── contextSpec.js   # buildContextSpec, buildRevocations, buildRevocationAlert
│   │   ├── prompts.js       # composeSmartPrompt, composeTask, composeRestart
│   │   ├── records.js       # typed record schema + helpers (R1+)
│   │   ├── engine.js        # createEngine() factory
│   │   └── nano.js          # optional LanguageModel helpers
│   ├── ui/
│   │   ├── layout.js        # shell, outbound panel, footer
│   │   ├── boards.js        # memory / facts / assumptions / ambient rows
│   │   ├── transport.js     # copy, paste, ingest, preview
│   │   └── override.js      # memory override + assumption edit
│   └── styles/
│       └── main.css
└── tests/
    ├── parser.test.js
    ├── smoke.test.js
    ├── spiral.test.js
    └── records.test.js      # R1+
```

---

## User flow (B1, as implemented — one button)

The user does **not** choose Task vs Restart. One button: **Copy to chatbot**.

1. Type question in "Your question" → live **decorated prompt** preview updates below.
2. **Copy to chatbot** → paste into external chatbot (not the raw question). Also freezes the current revocations as the "what travelled in this prompt" snapshot.
3. Paste reply into "Chatbot reply" (auto-parses on paste, or click Parse reply).
4. Boards fill from structured blocks at end of reply. A Turn card is appended to the **Conversation spiral**.
5. **Edit boards** — uncheck assumptions, override memory, edit assumption text.
6. Preview badge switches to **Regenerate with your edits**; footer shows **Will tell chatbot to DELETE**.
7. **Copy to chatbot** again → prompt includes `===REVOKED_BY_USER_DO_NOT_USE===` and explicit DELETE lines.
8. Paste new reply → ingest → verify answer changed. New Turn card lands with a −N revoked pill.

**Critical:** Plain chatbot answers without `===MEMORY===` / `===ASSUMPTIONS===` / `===FACTS===` / `===END===` blocks will **not** populate boards or create a Turn. The decorated prompt instructs the model to emit them.

---

## Architecture — transport seam

```
User question  →  composeSmartPrompt()  →  clipboard  →  external chatbot
External reply  →  ingestReplyWithFallback()  →  boards / record  →  UI
```

Engine never touches clipboard or DOM. UI wires the two boundaries only. This seam is retained as-is — the new record layer (R1–R5) sits **behind** the engine, not in the transport.

### Engine API (`createEngine()`)

```js
// Ingest
ingestReply(text)
ingestReplyWithFallback(text)   // → { memory, assumptions, facts, ambient, hadStructuredBlocks, usedNano }

// Boards
getBoards()                     // → { memory[], facts[], assumptions[], ambient[] }
toggleMemory(id, active)
toggleFact(id, active)
toggleAssumption(id, active)
toggleAmbient(id, active)
overrideMemory(id, userText)    // → Promise<committedText>
ratifyMemory(id, committedText)
editAssumption(id, statement, reason)

// Records (R1+)
getRecords()                    // → { stateful[], ambient[] }
updateRecordStatus(id, status)
updateRecordConfidence(id, conf)

// Prompts
previewSmartPrompt()            // auto: task OR restart — use this for copy
previewPrompt(kind)             // manual: 'task' | 'restart' | 'prime_assumptions'
needsRegeneratePrompt()         // true if edits or unchecked items
buildContextSpec()              // markdown, active items only
buildRevocationsPreview()       // markdown DELETE section for footer

// Task
setOriginalTask(task)
setTopic(topic)
hasCorrectiveEdits()
```

---

## Block format (parser)

```
===MEMORY===
- <bullet> [ | status: <s> | confidence: <c> | provenance: <p> | tags: t1,t2 ]
===ASSUMPTIONS===
- assumption: <text> | reason: <text> [ | status: <s> | confidence: <c> | provenance: <p> | tags: t1,t2 ]
===FACTS===
- type: retrieved | content: <text> | source: <url> | date: <date> [ | status: ... | confidence: ... | provenance: ... | tags: ... ]
- type: computed | content: <text> [ | status: ... | confidence: ... | provenance: ... | tags: ... ]
===AMBIENT===
- text: <ambient note> | intensity: low|medium|high [ | tags: t1,t2 ]
===END===
```

Trailing `status`/`confidence`/`provenance`/`tags` fields are **optional** on every item line. The parser fills sane defaults when omitted (status=`active`, confidence=`medium`, provenance varies by board, tags=`[]`).

Parser: `src/engine/parser.js` — tested for well-formed, partial, and malformed input.

---

## Done (~85% of B1)

- [x] Vite + plain JS scaffold
- [x] Engine: parser, contextSpec, revocations, smart prompt
- [x] Clipboard transport + live decorated preview
- [x] Three boards with toggle / override / edit
- [x] Single-button UX (no Task/Restart dropdown)
- [x] Explicit DELETE / regenerate instructions for unchecked items
- [x] Footer revocation preview
- [x] Nano feature-detect (optional)
- [x] Responsive + dark gradient UI
- [x] Vitest coverage for core loop
- [x] Conversation spiral — per-turn dialog log

## Remaining B1 polish (~15%) — keep, but secondary to the record work

- [ ] Prove end-to-end with real chatbot sessions
- [ ] Import `.md` — load a previously exported Context Spec (export exists, import does not) → **folded into R2**
- [ ] Better override UX — in-app modals instead of `window.prompt`/`confirm`
- [ ] Assumption edit revocations — surface old vs new in DELETE block
- [ ] Rewind from spiral — "Restore to here" on a turn card
- [ ] Export spiral — include turn log in `.md` export
- [ ] README for non-Cursor users

---

## New tasks — the longitudinal record (the brain)

These are the rev. 2 direction. Build in order; each rung ships and is usable before the next. **No DB, no vector store, no backend until R5 (optional).**

### R1 — Typed record (replace flat bullets)

Promote each board item from a flat string to a typed record. **Two record types, not one** (see ambient note below).

- [x] Define the **stateful record** schema (for discrete things with a lifecycle — goals, facts, decisions, tasks):

  ```js
  {
    id, kind, text,
    status,
    provenance,
    confidence,
    tags,
    links,
    created_at, updated_at,
  }
  ```

  - `kind`: `'goal' | 'fact' | 'decision' | 'task' | 'open_question'`
  - `status`: `'open' | 'active' | 'done' | 'dropped' | 'revived'`
  - **provenance** (tier, not free text — the "you have it" fix): one of
    `'user_asserted' | 'model_proposed_user_confirmed' | 'inferred_from_tool' | 'stale_superseded'`
  - `confidence`: `'high' | 'medium' | 'low'` (low + weak provenance = cannot be treated as operative fact)
  - `tags[]`: topic tags used by the R3 assembler to decide relevance (written at create/commit time, see R4)
  - `links[]`: lightweight typed edges to other record ids — `{ rel, target_id }`, `rel`: `'depends_on' | 'updated_by' | 'supersedes'`. A small graph element; do not build a full KG yet.

- [x] Define the **ambient-context** record schema (for soft, non-lifecycle context — mood, tone, standing constraints like "burnt out by micromanaging boss"). This does **not** get a status; it decays:

  ```js
  { id, kind: 'ambient', text, intensity, tags, created_at, last_seen_at }
  ```

  - `intensity`: `'low' | 'medium' | 'high'`; decays toward `stale` as `last_seen_at` ages unless reaffirmed.

  Rationale: a mood has no `done`/`dropped`. Forcing soft context into the status lifecycle (the rev.1 `kind: emotion` mistake) is wrong. Ambient items are **always candidates** for the briefing (see R3).

- [x] Migrate `memory` / `facts` / `assumptions` board items to stateful records; route emotional/contextual notes to ambient records.
- [x] Board rows render `status` (or `intensity` for ambient) + `confidence` + `provenance`; user can set status/intensity and edit inline.
- [x] Introspection prompt update: instruct the model to emit `status` / `provenance` / `confidence` / `tags` per stateful item, and to emit soft context as ambient records, not collapse them into facts.
- [x] Tests: parser handles both record types; low-confidence/weak-provenance items are visibly flagged; ambient items carry no `status` field.

**Ships:** an honest, manual status ledger with a separate channel for soft context. _Not yet:_ persistence, auto-assembly.

### R2 — Local persistence + reload (the "database", trivial)

- [ ] Serialize the full record set to one local Markdown/JSON file (extend existing Context Spec export).
- [ ] Import: load a previously saved record back into the engine (the existing "Import .md" task, generalized to the typed record).
- [ ] On load, the record is the working state; the next prompt is composed from it on any model.
- [ ] No server, no IndexedDB required — file in / file out. (`localStorage` still a non-goal; user owns the file.)
- [ ] Rendered view (not raw JSON): a simple HTML/Obsidian-like render of the record — active goals up top, a timeline, superseded/done items collapsed, ambient context shown separately. Read-only is fine for R2.
- [ ] Tests: round-trip export → import preserves all record fields including status/timestamps/provenance/tags/links.

**Ships:** the record survives across sessions and reloads into the next conversation, on any model.

### R3 — Briefing assembler ("super prompt")

The core differentiator and the make-or-break task (all external reviewers flagged this as the hard part). Each turn, compose the prompt from the **relevant, currently-valid slice** of the record. **No embeddings, no semantic search, no Graphiti at this rung** — they are not needed below a few hundred items, and injecting everything is the exact failure ("lost in the middle") the assembler exists to prevent.

- [ ] `buildBriefing(currentTopicTags)` applies this ordered filter:
  1. **Status gate (deterministic):** include only stateful records with `status` in `{active, open}`. Drop `done` / `dropped` / `stale_superseded` entirely (unless the user explicitly queries history).
  2. **Tag match:** of those, include records whose `tags[]` intersect the current thread's topic tags. Tags are written at create/commit time (R1/R4), so this is a cheap set lookup, not inference.
  3. **Recency/decay:** prefer recently `updated_at`; newer wins ties.
  4. **Always-include ambient set:** include current ambient-context records (mood/constraints) regardless of status — a coach always needs them. Drop only ambient items whose intensity has decayed to `stale`.
  5. **Hard token cap:** if the assembled set exceeds the budget, drop lowest confidence first, then oldest, until it fits.
- [ ] **Supersession:** when a record supersedes/updated_by another, emit the superseded one as explicitly _no-longer-true_ (or omit it), so stale facts stop contaminating answers.
- [ ] **Time awareness:** include `created_at` / `updated_at`; on reopen after a gap, state elapsed time so the model does not assume nothing happened.
- [ ] Compose the briefing as a prepended block; this replaces the ad-hoc Context Spec prepend.
- [ ] Tests: a superseded fact never appears as current; a stale `done` goal is excluded; an off-topic record is excluded by the tag gate; ambient items always present; elapsed-time line present on gap; assembled set respects the token cap.

**Ships:** threads stop decaying as they lengthen; a thread reopened after a long gap arrives pre-briefed.

### R4 — Propose-and-confirm state updates

The trust rung. The model proposes record changes; the user commits. The existing boards/override handshake become this editor.

- [ ] After ingest, parse model-proposed transitions (e.g. `===PROPOSE=== mark <id> done | supersede <id> with <id> | new <record> | tag <id> <tags>`).
- [ ] **Material-only rule** (prevents confirm-fatigue): instruct the model to propose only material state changes — a goal completing, a plan being abandoned/superseded, a new commitment. **Do not propose** trivial rephrasings or restating things already true. A 20-minute session should yield a few proposals, not fifteen.
- [ ] Render proposals as a confirm/reject queue (reuse override-handshake UX), shown as a short batch with a one-line rationale each. Support **reject individually** and **accept all** for a quick clean batch; high-impact changes (e.g. marking a health/financial item done) are flagged and must be confirmed individually.
- [ ] On confirm, apply to the record with new `updated_at` and set `provenance: 'model_proposed_user_confirmed'`; on reject, discard. Never auto-apply.
- [ ] Confirmed proposals write/refresh `tags[]` so the R3 assembler can find the item next time.
- [ ] Optional: a confirmed `done` record with a follow-up date becomes a dated reminder surfaced when due (thin layer; deterministic).
- [ ] Tests: no proposal mutates the record without explicit confirm; trivial proposals are suppressed by the prompt; confirm updates timestamps, provenance, tags, and supersession links; high-impact items cannot be swept by "accept all".

**Ships:** Outlook-grade trust — it behaves like a reliable secretary, not a guessing chatbot.

### R5 — Temporal engine underneath (optional, deferred)

Only after R1–R4 prove the workflow. Revisits the "no backend" constraint deliberately.

- [ ] Evaluate replacing hand-rolled supersession with a bitemporal store (Graphiti / Zep): `valid_from` / `valid_until` / `learned_on` per fact, fact invalidation (not deletion), as-of-date queries.
- [ ] Decide local-embeddable vs service; if it requires a backend, that is a conscious scope change, gated on R1–R4 value.
- [ ] Tests: historical query ("what did I believe on `<date>`") returns the as-of slice.

**Ships:** true medical-record-style longitudinal accuracy.

---

## Explicit non-goals (updated)

- **Autonomous watch-and-act.** It does not watch screenshots/messages and silently advance the plan. The model proposes; the user commits (R4). Off the ladder by design — silent action destroys the trust that makes the record worth having.
- **Rebuilding the shell.** Model abstraction, multi-model chat, project folders, BYO-key routing are commodities (TypingMind, LibreChat, Msty, Poe, OpenRouter). Do not reimplement them.
- Browser extension (B2), live DOM, streaming.
- Paid API calls, API keys, backend, DB, vector store (until R5, optional and gated).
- `localStorage` / multi-session magic — persistence is an explicit user-owned file (R2).
- TypeScript / React migration (unless deliberately chosen later).

---

## Success criteria

**B1 (existing):** one complete loop — type question → copy decorated prompt → structured reply → uncheck wrong item → copy again → chatbot visibly changes answer.

**Record (new):** open a thread, build a typed record (R1), close the app, reopen days later, load the record (R2), ask a follow-up — and the model's first reply is grounded in current goals with stale items superseded and elapsed time acknowledged (R3), with no state change applied without confirmation (R4).

**The real bar (do not lose sight of this):** every session, the model's first reply must be _visibly sharper_ because of the record than the same question asked in a plain chat. If a briefed reply is no better than an unbriefed one, the ledger is a notes app with timestamps — fix the assembler (R3) or what's being captured (R1), not the plumbing. The honest test is one real months-long thread of your own (career or health) run through R1–R3, compared against plain chat.

---

## Handoff notes

1. If boards stay empty after paste, the user sent the **raw question** instead of the **decorated prompt**.
2. After edits, verify footer **Will tell chatbot to DELETE** is populated before copying.
3. The transport seam (`ingestReply` / `getComposedPrompt`) is stable — build R1–R5 **behind** the engine, not in transport.
4. Do not edit this file unless updating handoff status — implementation lives in `src/`.
