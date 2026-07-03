# AGENTS.md

## Cursor Cloud specific instructions

Context Lens is a **client-only single-page web app** (Vite 6 + plain JS ES modules, no React). There is **no backend, server, or database** — all state is in-memory in the browser. Do not add a backend or call paid model APIs.

Standard commands live in `package.json` and `CURSOR_BUILD.md`:
- Dev server: `npm run dev` → http://localhost:5173
- Tests: `npm test` (Vitest, runs `tests/**/*.test.js`)
- Build: `npm run build` → `dist/` (static files only)

Non-obvious notes:
- There is **no lint script**; `npm test` + `npm run build` are the only programmatic checks.
- The context boards only populate when the pasted "Chatbot reply" contains structured blocks (`===MEMORY===` / `===ASSUMPTIONS===` / `===FACTS===` / `===END===`). The "Decorated prompt" preview is what instructs an external chatbot to emit those blocks; a raw chatbot answer will leave the boards empty. For local testing you can paste a hand-written reply containing those blocks instead of using a real chatbot.
- Unchecking/overriding/editing board items flips the prompt-mode badge to "Regenerate with your edits" and reveals the footer "Will tell chatbot to DELETE" section — this is the core regenerate loop.
- Optional Gemini Nano (`window.LanguageModel`) is only a parse/compose fallback and is absent in headless/CI environments; its absence is expected and non-blocking.
