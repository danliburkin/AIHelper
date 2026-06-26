# Context Lens — B1 Build Spec & Session Handoff

**Status: ~75% complete** — engine, parser, smart prompts, clipboard UI, responsive dark UI, and regenerate-with-DELETE flow are implemented. Remaining work is polish, import `.md`, and proving the full loop in real chatbot sessions.

---

## What this is

A **client-only single-page web app**. No backend. No server. No database. Session state lives in memory in the browser.

**B1** = the heavy reasoning happens in a *separate* chatbot tab (ChatGPT, Claude, Gemini, etc.). Context Lens is the **engine + editor**: it decorates your question, parses structured replies into boards, lets you edit context, and composes prompts that tell the chatbot what to delete and regenerate.

**B2** (not started) = browser extension replaces clipboard with live DOM read/write. The engine stays transport-agnostic.

**Do not build B2. Do not call paid model APIs. Do not build a backend.**

---

## How to run

```bash
cd /home/dan/CursorProjects/AIHelper
npm install          # if node_modules missing
npm run dev          # → http://localhost:5173
npm test             # 12 tests (parser + smoke)
npm run build        # → dist/
```

Requires Node/npm on PATH for development. The built `dist/` folder is static files only — no Node at runtime for end users.

---

## Stack (as built)

| Layer | Choice |
|-------|--------|
| Language | **Plain JavaScript** (ES modules) — not TypeScript |
| Bundler | Vite 6 |
| UI | Native DOM (`createElement`, `textContent`) — no React |
| CSS | Single `main.css` — dark editorial, corner gradients, responsive |
| Tests | Vitest (`tests/parser.test.js`, `tests/smoke.test.js`) |
| Fonts | Libre Baskerville, Inter, IBM Plex Mono (Google Fonts) |

Optional: Gemini Nano via `window.LanguageModel` for parse/compose fallback only (`src/engine/nano.js`).

---

## Project layout

```
/home/dan/CursorProjects/AIHelper/
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
│   │   ├── engine.js        # createEngine() factory
│   │   └── nano.js          # optional LanguageModel helpers
│   ├── ui/
│   │   ├── layout.js        # shell, outbound panel, footer
│   │   ├── boards.js        # memory / facts / assumptions rows
│   │   ├── transport.js     # copy, paste, ingest, preview
│   │   └── override.js      # memory override + assumption edit
│   └── styles/
│       └── main.css
└── tests/
    ├── parser.test.js
    └── smoke.test.js
```

---

## User flow (as implemented — one button)

The user does **not** choose Task vs Restart. One button: **Copy to chatbot**.

1. **Type question** in “Your question” → live **decorated prompt** preview updates below.
2. **Copy to chatbot** → paste into external chatbot (not the raw question).
3. **Paste reply** into “Chatbot reply” (auto-parses on paste, or click Parse reply).
4. Boards fill from structured blocks at end of reply.
5. **Edit boards** — uncheck assumptions, override memory, edit assumption text.
6. Preview badge switches to **Regenerate with your edits**; footer shows **Will tell chatbot to DELETE**.
7. **Copy to chatbot** again → prompt includes `===REVOKED_BY_USER_DO_NOT_USE===` and explicit DELETE lines.
8. Paste new reply → ingest → verify answer changed.

**Critical:** Plain chatbot answers without `===MEMORY===` / `===ASSUMPTIONS===` / `===FACTS===` / `===END===` blocks will **not** populate boards. The decorated prompt instructs the model to emit them.

---

## Architecture — transport seam

```
User question  →  composeSmartPrompt()  →  clipboard  →  external chatbot
External reply  →  ingestReplyWithFallback()  →  boards  →  UI
```

Engine never touches clipboard or DOM. UI wires the two boundaries only.

### Engine API (`createEngine()`)

```js
// Ingest
ingestReply(text)
ingestReplyWithFallback(text)   // → { memory, assumptions, facts, hadStructuredBlocks, usedNano }

// Boards
getBoards()
toggleMemory(id, active)
toggleFact(id, active)
toggleAssumption(id, active)
overrideMemory(id, userText)    // → Promise<committedText>
ratifyMemory(id, committedText)
editAssumption(id, statement, reason)

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

## Data model (plain objects)

```js
// Memory
{ id, originalText, committedText, active, source }  // source: 'imported' | 'user_override'

// Fact
{ id, content, type, sourceUrl, sourceDate, active }   // type: 'retrieved' | 'computed'

// Assumption
{ id, statement, reason, active }

// Engine state
{ memory[], facts[], assumptions[], originalTask, topic, hasCorrectiveEdits }
```

---

## Block format (parser)

```
===MEMORY===
- <bullet>
===ASSUMPTIONS===
- assumption: <text> | reason: <text>
===FACTS===
- type: retrieved | content: <text> | source: <url> | date: <date>
- type: computed | content: <text>
===END===
```

Parser: `src/engine/parser.js` — tested for well-formed, partial, and malformed input.

---

## Prompt logic (`composeSmartPrompt`)

| State | Prompt used |
|-------|-------------|
| No unchecked/overridden items | **Task** — answer + append blocks |
| Any unchecked memory/fact/assumption, or override, or `hasCorrectiveEdits` | **Restart** — regenerate from scratch |

Restart prompt includes:

1. **`===REVOKED_BY_USER_DO_NOT_USE===`** block at top with `ASSUMPTION_DELETE`, `MEMORY_DELETE`, etc.
2. **Revoked sections** in prose (`## Revoked assumptions — DELETE from your answer`)
3. **Corrected Context Spec** — active + committed items only

`prime_assumptions` still exists in engine but is **not exposed in UI** (optional future).

---

## Memory override handshake

1. User clicks Override on a memory row → prompt for new text.
2. Engine returns deterministic restatement: `User states: <text>. Treat as authoritative.` (Nano may polish).
3. User confirms in `window.confirm` → `ratifyMemory` pins `committedText`, sets `source: 'user_override'`.
4. Restart prompt emits `MEMORY_REPLACE_DELETE` / `MEMORY_REPLACE_USE` for overrides.

Assumption edit: inline `window.prompt` for statement + reason (no ratification step).

---

## UI notes (implemented)

- **Outbound panel:** question input, live prompt preview, mode badge (First answer / Regenerate with your edits), Copy to chatbot.
- **Main:** reply textarea (left on desktop) + three board panels (right).
- **Footer:** Live Context Spec, **Will tell chatbot to DELETE** (visible when revocations exist), status strip, Export .md.
- **Responsive:** mobile stack, tablet/desktop two-column, touch-friendly targets, `100dvh`, safe-area insets.
- **Design:** dark corner-to-corner gradients, Webby-inspired editorial typography (Libre Baskerville headlines), color-coded board accents (amber / blue / plum).
- **Toggle scroll fix:** checking/unchecking rows updates in place without full re-render (preserves scroll position).

---

## Tests (12 passing)

- `tests/parser.test.js` — block parser, contextSpec, composeSmartPrompt, revocation alert
- `tests/smoke.test.js` — toggle assumption → restart prompt contains DELETE; memory override → context spec

---

## Done (~75%)

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

---

## Remaining (~25%)

- [ ] **Prove end-to-end** with real chatbot sessions (success criterion below)
- [ ] **Import `.md`** — load a previously exported Context Spec (export exists, import does not)
- [ ] **Better override UX** — replace `window.prompt` / `window.confirm` with in-app modals
- [ ] **Assumption edit revocations** — if user edits assumption text (not just unchecks), surface old vs new in DELETE block
- [ ] **README** for non-Cursor users (optional)
- [ ] **prime_assumptions** — expose in UI only if user wants two-phase flow (optional)
- [ ] Polish: keyboard shortcuts, “suppress” label on toggles, import flow

---

## Explicit non-goals (still out of scope)

- Browser extension (B2), live DOM, streaming
- Paid API calls, API keys, backend, DB
- localStorage / multi-session
- Actions board
- TypeScript / React migration (unless deliberately chosen later)

---

## Success criterion

One complete loop in production use:

> Type question → copy decorated prompt → get structured reply → uncheck wrong assumption → copy again → chatbot **visibly changes answer** and no longer relies on deleted assumption.

---

## Handoff notes for next session

1. If boards stay empty after paste, user sent **raw question** to chatbot instead of **decorated prompt** from preview.
2. After edits, verify footer **Will tell chatbot to DELETE** is populated before copying.
3. Preview must start with `===REVOKED_BY_USER_DO_NOT_USE===` when assumptions are unchecked.
4. Engine detection uses **board state** (`hasRevocations`) not only the `hasCorrectiveEdits` flag.
5. Do not edit this file unless updating handoff status — implementation lives in `src/`.
