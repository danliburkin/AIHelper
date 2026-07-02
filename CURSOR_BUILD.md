# Context Lens — Build Spec & Session Handoff

**Branch:** `cursor/notepad-conversations-manual-add-6a94` (built on top of `cursor/longitudinal-record-r1-r4-6a94`, which has R1–R4 merged)
**Status:** R1 + R2 + R3 + R4 all complete. Post-R4 UX upgrade also complete: multi-conversation localStorage persistence, manual add-item buttons, and a notepad-style turn log. 140 vitest tests passing, clean Vite build. See _New tasks_ and _Post-R4 UX upgrade_ sections below.

---

## What this is

A **client-only single-page web app**. No backend. No server. No database. Session state lives in memory in the browser.

**B1** = the heavy reasoning happens in a _separate_ chatbot tab (ChatGPT, Claude, Gemini, etc.). Context Lens is the **engine + editor**: it decorates your question, parses structured replies into boards, lets you edit context, and composes prompts that tell the chatbot what to delete and regenerate.

**B2** (not started) = browser extension replaces clipboard with live DOM read/write. The engine stays transport-agnostic.

**Do not build B2. Do not call paid model APIs. Do not build a backend** (this constraint is revisited only at task **R5**, which is explicitly optional and deferred).

---

## Direction update (rev. 2) — the record is the product

The problem worth solving is **stateless, timeless memory**, not per-answer assumption editing. Flat bullets have no status, no time, no supersession, no provenance — so long threads rot and cross-session/cross-model continuity is lost.

**The record is the product.** The model is a swappable reasoner. The shell is already built by others (TypingMind, LibreChat, Msty, Poe, OpenRouter). Do not spend effort rebuilding the shell.

The differentiated, unbuilt-at-consumer-level part is **the brain**: a structured, status-tracked, timestamped, self-superseding record that re-briefs whichever model is in use each turn.

The existing copy-paste transport is already model-agnostic (clipboard works on every chatbox). **Keep it.** Build the record on top of it. **Commit authority stays with the user.**

---

## How to run

```bash
npm install
npm run dev          # → http://localhost:5173
npm test             # vitest (76 tests)
npm run build        # → dist/ (static, no Node at runtime)
```

---

## Stack (as built)

| Layer    | Choice                                                                               |
| -------- | ------------------------------------------------------------------------------------ |
| Language | **Plain JavaScript** (ES modules) — not TypeScript                                   |
| Bundler  | Vite 6                                                                               |
| UI       | Native DOM (`createElement`, `textContent`) — no React                               |
| CSS      | Single `main.css` — dark editorial, corner gradients, responsive                     |
| Tests    | Vitest — 10 test files, 140 tests (parser, records, persistence, briefing, proposals, overrides, spiral, manual-add, storage, smoke) |
| Fonts    | Libre Baskerville, Inter, IBM Plex Mono (Google Fonts)                               |

Optional: Gemini Nano via `window.LanguageModel` for parse/compose fallback only (`src/engine/nano.js`).

---

## Project layout

```
.
├── CURSOR_BUILD.md          ← this file (source of truth for progress)
├── README.md                # user-facing docs
├── LICENSE                  # MIT
├── index.html
├── package.json
├── vite.config.js
├── vitest.config.js
├── src/
│   ├── main.js              # boot, wire engine ↔ UI ↔ conversations
│   ├── engine/
│   │   ├── parser.js        # parseReplyBlocks + extractTrailingMeta (R1)
│   │   ├── contextSpec.js   # buildContextSpec (now includes ambient + badges)
│   │   ├── prompts.js       # composeSmartPrompt — uses briefing (R3) + PROPOSE format (R4)
│   │   ├── records.js       # R1: typed schema, vocabularies, canonical shapes, weak-flagging
│   │   ├── briefing.js      # R3: buildBriefing, deriveTopicTags
│   │   ├── persistence.js   # R2: buildSnapshot, applySnapshot, snapshotToMarkdown, snapshotFromMarkdown
│   │   ├── proposals.js     # R4: parseProposals, annotateImpact, applyProposal
│   │   ├── storage.js       # multi-conversation localStorage: index + per-conversation snapshot CRUD
│   │   ├── engine.js        # createEngine() factory — R1–R4 + manual add + reset/restoreSnapshot wired
│   │   └── nano.js          # optional LanguageModel helpers
│   ├── ui/
│   │   ├── layout.js        # shell + conversation bar + outbound panel + footer
│   │   ├── boards.js        # memory / facts / assumptions / ambient rows + "+ Add" modals
│   │   ├── proposals.js     # R4: pending proposals queue panel
│   │   ├── spiral.js        # conversation turn log (left column) — reply excerpt + Restore to here
│   │   ├── conversations.js # conversation switcher: list/switch/new/rename/delete + autosave
│   │   ├── modal.js         # in-app prompt/confirm/fields modals (replaces window.prompt/confirm)
│   │   ├── transport.js     # copy, paste, ingest, preview (R2 export/import, R4 dedupe)
│   │   └── override.js      # memory override + assumption edit (uses modal.js)
│   └── styles/
│       └── main.css
└── tests/
    ├── parser.test.js        # 10 tests (R1-aware shapes + meta extraction)
    ├── records.test.js       # 20 tests (R1 schema, ambient, weak-flagging, engine ingest)
    ├── persistence.test.js   # 7 tests  (R2 round-trip, links, pure-JSON, render grouping)
    ├── briefing.test.js      # 18 tests (R3 status gate, tag match, cap, supersession, elapsed time)
    ├── proposals.test.js     # 19 tests (R4 parse, high-impact, queue, accept/reject, supersede, tag, new)
    ├── overrides.test.js     # 12 tests (assumption edit revocations, DELETE block old/new)
    ├── spiral.test.js        # 11 tests (turn recording, restoreToTurn, persistence round-trip)
    ├── manual-add.test.js    # 22 tests (addMemory/Assumption/Fact/AmbientItem, reset, restoreSnapshot)
    ├── storage.test.js       # 19 tests (localStorage CRUD, title auto-derive vs custom-title lock)
    └── smoke.test.js         # 2 tests  (full engine loop)
```

---

## User flow (B1, as implemented — one button)

1. **Type question** in "Your question" → live **decorated prompt** preview updates below.
2. **Copy to chatbot** → paste into external chatbot. The decorated prompt now starts with a `===BRIEFING===` block (R3) and includes `===PROPOSE===` format instructions (R4).
3. **Paste reply** into "Chatbot reply" (auto-parses on paste, or click Parse reply).
4. Boards fill from structured blocks. **Pending proposals** panel appears above the boards when the reply contains a `===PROPOSE===` block (R4). A Turn card is appended to the Conversation spiral.
5. **Edit boards** — uncheck assumptions, override memory, edit assumption text. Set `status` per row (R1). Accept/reject model proposals (R4).
6. Preview badge switches to **Regenerate with your edits** when boards are edited.
7. **Copy to chatbot** again — prompt includes DELETE instructions for revoked items.
8. Paste new reply → ingest → verify answer changed.

**Critical:** Plain chatbot answers without structured blocks will **not** populate boards. The decorated prompt instructs the model to emit them.

---

## Architecture — transport seam

```
User question  →  composeSmartPrompt()  →  clipboard  →  external chatbot
External reply  →  ingestReplyWithFallback()  →  boards / record / proposals  →  UI
```

Engine never touches clipboard or DOM. The record layer (R1–R4) sits **behind** the engine, not in the transport.

---

## Engine API (`createEngine()`)

```js
// Ingest
ingestReply(text)
ingestReplyWithFallback(text)
  // → { memory, assumptions, facts, ambient, proposals, hadStructuredBlocks, usedNano }

// Boards
getBoards()           // → { memory[], facts[], assumptions[], ambient[] }
toggleMemory(id, active)
toggleFact(id, active)
toggleAssumption(id, active)
toggleAmbient(id, active)
overrideMemory(id, userText)    // → Promise<committedText>
ratifyMemory(id, committedText)
editAssumption(id, statement, reason)

// R1: typed record mutations
getRecords()                     // → { stateful[], ambient[] } canonical shapes
updateRecordStatus(id, status)
updateRecordConfidence(id, confidence)
updateAmbientIntensity(id, intensity)
boardOf(id)

// Manual add (post-R4 UX upgrade) — user-asserted / high-confidence / active by default
addMemory(text, opts?)           // → created item, or null if text is empty
addAssumption(statement, reason?, opts?)
addFact(content, opts?)          // opts.type: 'computed' | 'retrieved'
addAmbientItem(text, intensity?, opts?)   // opts: { tags?: string[] }

// Conversation lifecycle (post-R4 UX upgrade)
reset()                          // wipe to a blank conversation, same engine object
restoreSnapshot(snapshot)        // apply an exportSnapshot()-shaped object directly (no markdown parsing)
getOriginalTask()                // → string, for syncing the question input on conversation switch

// R2: persistence
exportSnapshot()                 // → plain object (envelope)
exportRecordMarkdown()           // → string (.md file content)
renderRecordMarkdown()           // → string (rendered view only, no JSON)
importRecord(text)               // → { memory, facts, assumptions, ambient, exported_at, originalTask, lastActivityAt }

// R3: briefing
buildBriefing(opts)              // → { text, meta: { keptCount, droppedCount, ambientCount, topicTags, tagFallback, elapsed, supersessionCount } }
deriveTopicTags(text)            // → string[]

// R4: proposals
getPendingProposals()            // → proposal[]
acceptProposal(proposalId)       // → { applied, target_id?, reason? }
rejectProposal(proposalId)       // → boolean
acceptAllSafeProposals()         // skips requiresIndividualConfirm; → result[]
rejectAllProposals()             // → N (count)

// Prompts
previewSmartPrompt()             // auto: task OR restart
previewPrompt(kind)              // 'task' | 'restart' | 'prime_assumptions'
needsRegeneratePrompt()
buildContextSpec()
buildRevocationsPreview()

// Task
setOriginalTask(task)
setTopic(topic)
hasCorrectiveEdits()

// Conversation spiral (turn log)
addTurn(question, added, revokedCount?, replyText?)   // called by transport after a successful ingest
getTurns()                       // → turn[] shallow copies, each with a nested full-record snapshot
restoreToTurn(turnIndex)         // rolls board state back to that turn's snapshot; trims later turns
```

---

## Block format (parser)

```
===MEMORY===
- <bullet> [ | status: <s> | confidence: <c> | provenance: <p> | tags: t1,t2 ]
===ASSUMPTIONS===
- assumption: <text> | reason: <text> [ | status: ... | confidence: ... | provenance: ... | tags: ... ]
===FACTS===
- type: retrieved | content: <text> | source: <url> | date: <date> [ | status: ... | confidence: ... | provenance: ... | tags: ... ]
- type: computed | content: <text> [ | status: ... | confidence: ... | provenance: ... | tags: ... ]
===AMBIENT===
- text: <ambient note> | intensity: low|medium|high [ | tags: t1,t2 ]
===PROPOSE===
- mark <existing_id> <status> | rationale: <reason>
- supersede <old_id> with <new_id> | rationale: <reason>
- new <board>: <text> | tags: t1,t2 | rationale: <reason>
- tag <existing_id> t1,t2 | rationale: <reason>
===END===
```

Trailing `status`/`confidence`/`provenance`/`tags` fields are **optional** — parser fills safe defaults when omitted. The `===PROPOSE===` block is **optional**; when present it populates the pending proposals queue (nothing auto-applied). Proposals must include `| rationale: <one-liner>` (model instruction; not enforced by parser).

---

## Data model

### Stateful record (memory / facts / assumptions after R1)

```js
{
  id, kind, status, provenance, confidence,
  tags[],           // topic tags for R3 assembler
  links[],          // { rel: 'depends_on'|'updated_by'|'supersedes', target_id }
  created_at, updated_at,
  active,           // UI toggle (revoked when false)
  // board-specific legacy fields preserved:
  committedText/originalText/source  // memory
  content/type/sourceUrl/sourceDate  // facts
  statement/reason                   // assumptions
}
```

### Ambient record

```js
{
  id, kind: 'ambient', text,
  intensity,        // 'low'|'medium'|'high'|'stale'  — NO status field
  tags[],
  created_at, last_seen_at, active
}
```

### Proposal (pending queue)

```js
{
  id, created_at,
  type,             // 'mark_status'|'supersede'|'tag'|'new'
  target_id,        // for mark/supersede/tag
  new_id,           // for supersede
  board, text, tags,// for new
  status,           // for mark_status
  rationale,
  requiresIndividualConfirm  // true for health/financial/goal-lifecycle items
}
```

---

## R1 vocabularies

```js
STATUSES   = ['open', 'active', 'done', 'dropped', 'revived']
KINDS      = ['goal', 'fact', 'decision', 'task', 'open_question']
PROVENANCES= ['user_asserted', 'model_proposed_user_confirmed',
               'inferred_from_tool', 'stale_superseded']
CONFIDENCES= ['high', 'medium', 'low']
INTENSITIES= ['low', 'medium', 'high', 'stale']

isWeak(record)           // true: confidence=low AND provenance=stale_superseded
isVisiblyUntrusted(item) // true: confidence=low OR provenance=stale_superseded
```

---

## R2 file format

One `.md` file per session. Human-readable Markdown body up top (grouped by lifecycle: Active goals & memory / Active facts / Open questions / Ambient context / Done+dropped / Stale+superseded), followed by:

```
---

<!-- CONTEXT_LENS_RECORD
{ ... full JSON snapshot ... }
-->
```

Importers prefer the JSON envelope; pure-JSON files (without the Markdown wrapper) are also accepted.

---

## R3 briefing assembler — ordered filter

`buildBriefing(state, opts)` applies in order:

1. **Status gate** — keep only `active | open | revived`; drop `done | dropped | stale_superseded`; also drop items the user toggled off (`active=false` in the UI).
2. **Tag match** — explicit `#tag` mentions in the question first; otherwise tokenize and intersect against known record tags (cheap set lookup, no inference). Falls back to the whole active pool when nothing matches.
3. **Recency** — `updated_at` descending; newer wins ties.
4. **Ambient always-in** — included regardless of topic tags; protected from the token-cap prune; items with `intensity=stale` are dropped.
5. **Hard token cap** (`tokenBudget`, default 1500 tokens ≈ 6000 chars) — iterate BEST-to-WORST (high conf → newest), drop the rest. Ambient is pre-subtracted from the budget but never pruned.

**Supersession:** stale_superseded items are emitted under `## Supersession — items that are NO LONGER TRUE` (not in the active pool). Live records with a `links[].rel='supersedes'` reference also trigger a `NO LONGER TRUE` note for the older record.

**Time awareness:** `lastActivityAt` is tracked on every engine state mutation and preserved across export/import. When the gap between `lastActivityAt` and `now` exceeds 6 hours, the briefing prepends: `Time elapsed since last activity: N days.`

The briefing block is prepended to `composeTask` / `composeRestart` in place of the legacy Context Spec block.

---

## R4 propose-and-confirm — trust rules

- **Nothing auto-applies.** The engine parses `===PROPOSE===` on ingest and pushes proposals into `state.pendingProposals`; the record is untouched until the user explicitly accepts.
- **Material-only rule** (in the decorated prompt): the model is instructed to propose only material changes — a goal completing, a plan being abandoned/superseded, a new commitment. Trivial rephrasings must NOT be proposed.
- **High-impact flagging** (`annotateImpact`): `requiresIndividualConfirm=true` when the target record has tags ∈ `{health, medical, financial, money, finance, legal}` OR is `kind=goal|decision` being marked `done|dropped`. Flagged proposals are shown with a red **"high impact — must confirm individually"** pill and are **skipped by "Accept all (safe)"**.
- **On confirm:** `applyProposal` sets `provenance='model_proposed_user_confirmed'`, bumps `updated_at`, merges `tags[]`, and writes bi-directional `supersedes`/`updated_by` links for supersession proposals.
- **On reject:** discarded; record untouched.
- **Dedupe:** the transport tracks `lastIngestedText`; re-ingesting the same reply is a no-op, preventing double-proposals from paste+click.

---

## Done

### B1 (original)

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

### B1 polish (remaining — secondary to record work)

- [ ] Prove end-to-end with real chatbot sessions (success criterion below)
- [x] Import `.md` — load a previously exported Context Spec → **done in R2** (generalized to typed record)
- [x] Better override UX — in-app modals instead of `window.prompt`/`confirm`
- [x] Assumption edit revocations — surface old vs new in DELETE block
- [x] Rewind from spiral — "Restore to here" on a turn card
- [x] Export spiral — include turn log in `.md` export
- [ ] README for non-Cursor users

### R1 — Typed record schema ✓

- [x] Define the stateful record schema (`kind`, `status`, `provenance`, `confidence`, `tags[]`, `links[]`, `created_at`, `updated_at`)
- [x] Define the ambient-context record schema (`kind='ambient'`, `intensity`, `tags[]`, `created_at`, `last_seen_at` — **no `status` field**)
- [x] Migrate `memory` / `facts` / `assumptions` board items to stateful records; route emotional/contextual notes to ambient records
- [x] Board rows render `status` (or `intensity` for ambient) + `confidence` + `provenance` + tags; user can set status/intensity and edit inline
- [x] Introspection prompt updated: instructs the model to emit `status` / `provenance` / `confidence` / `tags` per stateful item, and to emit soft context as `===AMBIENT===` records, not collapse them into facts
- [x] Tests: parser handles both record types; low-confidence/weak-provenance items are visibly flagged; ambient items carry no `status` field

### R2 — Local persistence + reload ✓

- [x] Serialize the full record set to one local Markdown/JSON file (export button: `Export record`)
- [x] Import: load a previously saved record back into the engine (`Import record` button, file picker)
- [x] On load, the record is the working state; the next prompt is composed from it on any model
- [x] No server, no IndexedDB — file in / file out (`localStorage` non-goal; user owns the file)
- [x] Rendered view (not raw JSON): **Record view (longitudinal)** panel — active goals up top, timeline, superseded/done collapsed, ambient shown separately. Rendered as live HTML in the footer.
- [x] Tests: round-trip export → import preserves all record fields including status/timestamps/provenance/tags/links

### R3 — Briefing assembler ✓

- [x] `buildBriefing(state, opts)` with the five-step ordered filter (status gate → tag match → recency → ambient always-in → token cap)
- [x] Supersession: `stale_superseded` records dropped from active pool + `NO LONGER TRUE` notes
- [x] Time awareness: elapsed-time line when gap > 6 hours; `lastActivityAt` tracked + preserved across export/import
- [x] Compose the briefing as a prepended block (replaces the ad-hoc Context Spec prepend in `composeTask` / `composeRestart`)
- [x] Tests: superseded fact never appears as current; stale done goal excluded; off-topic record excluded by tag gate; ambient items always present; elapsed-time line present on gap; assembled set respects the token cap

### R4 — Propose-and-confirm ✓

- [x] After ingest, parse model-proposed transitions from `===PROPOSE===` block (4 shapes: mark / supersede / new / tag)
- [x] Material-only rule in the decorated prompt: model instructed not to propose trivial rephrasings
- [x] Proposals rendered as confirm/reject queue (pending proposals panel above the reply/boards area), with per-row rationale, Accept / Reject, "Accept all (safe — N)", "Reject all"
- [x] High-impact flagging: health/medical/financial/legal tags OR kind=goal/decision marked done/dropped → `requiresIndividualConfirm=true`, shown with red pill, skipped by "Accept all (safe)"
- [x] On confirm: `applyProposal` sets `provenance='model_proposed_user_confirmed'`, bumps `updated_at`, merges `tags[]`, writes `supersedes`/`updated_by` links; on reject: discarded, nothing applied
- [x] Confirmed proposals write/refresh `tags[]` so the R3 assembler can find the item next time
- [ ] Optional: confirmed `done` record with follow-up date → dated reminder (deferred — explicitly optional in spec)
- [x] Tests: no proposal mutates the record without explicit confirm; confirm updates timestamps/provenance/tags/supersession links; high-impact items cannot be swept by "accept all"
- [x] Ingest dedupe: `lastIngestedText` tracking prevents double-proposals from paste+click

### R5 — Temporal engine (optional, deferred)

- [ ] Evaluate bitemporal store (Graphiti / Zep) — gated on R1–R4 proving value

---

## Post-R4 UX upgrade — multi-conversation notepad ✓

Driven by real usage feedback after R1–R4 landed: the app needed (1) a way to manually add context without waiting on the model, (2) an actual place to keep pasting replies turn after turn, and (3) real persistence — "store the assumption statuses like git" — instead of a manual export/import round-trip every session.

- [x] **Manual add buttons** — every board (Memory, Facts, Assumptions, Ambient) has a `+ Add` button in its header that opens a modal (`showFieldsModal`) and calls `engine.addMemory` / `addAssumption` / `addFact` / `addAmbientItem`. Manually added items are `provenance: 'user_asserted'`, `confidence: 'high'`, and show up in the very next briefing.
- [x] **Notepad-style turn log** — the conversation spiral moved from the footer boards panel to the TOP of the left column, directly above the "Paste the next reply" textarea, so replying reads top-to-bottom like a real conversation transcript. Each turn card now also stores and displays the raw pasted reply text behind a "Show pasted reply" `<details>` toggle.
- [x] **Multi-conversation localStorage persistence** — `src/engine/storage.js` is a small localStorage-backed index (`context-lens:index`) plus one full snapshot key per conversation (`context-lens:conv:<uuid>`). A conversation switcher bar in the header (dropdown + New/Rename/Delete) lets the user keep several independent conversations, each with its own full record (boards + turns). Auto-save is debounced (500ms) and fires after every meaningful state change; a `beforeunload` handler flushes any pending save immediately.
  - The conversation title auto-derives from the current question (`originalTask`, truncated to 60 chars) on every save UNLESS the user explicitly renamed it (`customTitle` flag in the index entry locks the title against auto-derivation).
  - `engine.reset()` and `engine.restoreSnapshot(snapshot)` swap the SAME engine object's internal state in place, so all other UI modules (boards, transport, proposals, spiral) keep working across a conversation switch without being re-wired.
  - The manual Export/Import `.md` flow is untouched and still works as a cross-device/cross-browser backup on top of the automatic localStorage persistence.
- [x] Fixed two bugs found during manual verification:
  - Turn cards were only appearing on the render AFTER the one that actually created them, because `engine.addTurn(...)` was called after `onUpdate()` in `transport.js`. Reordered so the turn is recorded before the UI refresh that displays it.
  - The "paste the next reply" textarea and the ingest dedupe tracker were not cleared when switching/creating a conversation or rewinding to a turn, so leftover text from a different conversation could linger. Added `transport.resetReplyState()`, called from every place that swaps engine state out from under the UI.
- [x] Tests: `tests/storage.test.js` (19 — CRUD, availability degradation, title auto-derive vs. custom-title lock) and `tests/manual-add.test.js` (22 — addMemory/Assumption/Fact/AmbientItem, reset, restoreSnapshot, turn replyText round-trip).

**Ships:** the app now behaves like the user asked — "store the assumption statuses like git" — with zero-friction persistence across browser sessions and support for tracking several independent topics/conversations side by side.

---

## Remaining work (next session)

If starting from this checkpoint, the codebase is fully working, all tests pass, and the post-R4 UX upgrade is complete. Next useful work, in priority order:

1. **Prove the real use case** — run a genuine months-long thread (career, health) through R1–R3, compare first reply of each session to an unbriefed chat. If the briefed reply is not visibly sharper, fix the assembler or what's being captured.
2. **README** for non-Cursor users. _(Already exists at `/README.md` — keep it in sync as features change.)_
3. **R5** (bitemporal store) — only after R1–R4 prove the workflow in real use.
4. **Possible follow-ups to the notepad upgrade** (not yet requested, just observed during testing):
   - Conversation search/filter in the dropdown once the list grows long.
   - A lightweight indicator next to the conversation dropdown showing "saved" / "saving…" so the debounced autosave isn't invisible.
   - Consider whether `localStorage`'s ~5–10MB quota needs a warning/export-and-clear flow for very long-running conversations with many turn snapshots (each turn stores a full record snapshot, which grows with the record).

---

## Success criteria

**B1 (existing):** one complete loop — type question → copy decorated prompt → structured reply → uncheck wrong item → copy again → chatbot visibly changes answer.

**Record (new):** open a thread, build a typed record (R1), close the app, reopen days later, load the record (R2), ask a follow-up — and the model's first reply is grounded in current goals with stale items superseded and elapsed time acknowledged (R3), with no state change applied without confirmation (R4).

**The real bar:** every session, the model's first reply must be _visibly sharper_ because of the record than the same question asked in a plain chat.

---

## Handoff notes

1. If boards stay empty after paste, the user sent the **raw question** instead of the **decorated prompt**.
2. After edits, verify footer **Will tell chatbot to DELETE** is populated before copying.
3. The transport seam (`ingestReply` / `getComposedPrompt`) is stable — R1–R5 sit **behind** the engine, not in the transport.
4. The briefing uses `id=<uuid>` tokens in the emitted text so the model can reference specific records in `===PROPOSE===` proposals. The tag match falls back to the whole active pool if no tags match — never silent empty briefing.
5. `requiresIndividualConfirm=true` items must be accepted one at a time; "Accept all (safe)" deliberately skips them.
6. **Multi-conversation state lives in `localStorage`, not in the engine's in-memory state alone.** The engine object is a singleton created once in `main.js`; switching conversations calls `engine.restoreSnapshot()` / `engine.reset()` to swap its internal state in place — it does **not** create a new engine instance. Any new UI module that reads engine state on init (rather than on every render) will break across conversation switches; always read fresh from `engine.getBoards()` / `engine.getTurns()` / etc. inside a `render()` function.
7. Whenever a code path swaps the engine's state out from under the UI (conversation switch/new/delete, turn rewind, `.md` import), also call `transport.resetReplyState()` so the "paste the next reply" textarea and the ingest dedupe tracker don't carry over stale content from a different context.
8. `initConversations()` must finish its synchronous bootstrap (`init()`) BEFORE `boards`/`proposals`/`spiral`/`transport` are read by its `onSwitch` callback. The bootstrap path uses `createBlankConversation(false)` (no `onSwitch` call) specifically to avoid a temporal-dead-zone crash on first page load, before those other consts exist. If you add new bootstrap-time logic to `conversations.js`, keep this ordering constraint in mind.
9. Do not edit this file unless updating handoff status — implementation lives in `src/`.
