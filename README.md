# Context Lens

Context Lens is a client-only web app that helps you get better answers out of ChatGPT, Claude, Gemini, or any other chatbot — without switching models or paying for API access.

The problem it solves: chatbots forget everything between sessions, and even within a session they drift. You paste a question, get an answer built on wrong assumptions, correct it, and then next week the model has no idea any of that happened. Context Lens keeps a structured record of what the model knows about you, what it assumed, and what you corrected — and injects a tight briefing into every prompt so the model starts each turn already oriented.

Everything runs in the browser. There is no backend, no database, no account.

---

## How it works

You type your question into Context Lens instead of directly into the chatbot. The app wraps your question with a briefing and structured instructions, and you copy that decorated prompt into whatever chatbot you're using.

When the chatbot replies, you paste the reply back into Context Lens. The app parses structured blocks at the end of the reply into three boards: memory, facts, and assumptions. You can review these, uncheck anything wrong, correct the wording, and mark items by status or confidence.

When you copy the next prompt, the app automatically decides whether to generate a fresh task prompt or a regenerate prompt (which tells the chatbot exactly what to delete from its previous reasoning).

Over time, the record builds up. You export it as a Markdown file, load it next week, and the model's first reply of the new session already reflects everything from the last one.

---

## Getting started

You need Node.js 18 or later.

```bash
git clone https://github.com/danliburkin/AIHelper.git
cd AIHelper
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

To build a static bundle you can host anywhere:

```bash
npm run build
# output is in dist/
```

---

## The copy-paste loop

1. Type your question in the **Your question** field. The decorated prompt updates live below it.
2. Click **Copy to chatbot** and paste into ChatGPT, Claude, or Gemini. Send it.
3. Paste the chatbot's reply into the **Chatbot reply** area. The app parses it automatically.
4. Review the boards. Uncheck assumptions the model got wrong. Override memory with the correct phrasing. Adjust status or confidence on any item.
5. Copy to chatbot again. If you made edits, the prompt now includes explicit DELETE instructions for what you changed.

The boards only fill in if the chatbot reply contains the structured blocks (`===MEMORY===`, `===ASSUMPTIONS===`, `===FACTS===`, etc.). The decorated prompt instructs the model to emit them — this is why you send the decorated prompt rather than your raw question.

---

## The record

Context Lens maintains a longitudinal record across sessions. Each item in the boards carries metadata: a status (`active`, `done`, `dropped`, etc.), a confidence level, a provenance (whether you asserted it, the model proposed it, or it came from a retrieved source), and topic tags.

The **briefing assembler** uses this record to build the context block injected into each prompt. It applies a filter in order: only active/open items, only items whose tags match the current topic, newest first, with ambient context (mood, standing constraints) always included. If the assembled set would be too long, it drops the lowest-confidence items first.

**Persist across sessions:** Use the **Export record** button in the footer to download a Markdown file containing the full record as both a readable summary and an embedded JSON snapshot. Use **Import record** to load it back in a future session. The model's first reply in that session will be grounded in the full record.

**Proposals:** When the chatbot detects a material change (a goal completing, a plan shifting), it can propose record updates in a `===PROPOSE===` block. These surface as a queue in the app — nothing is applied until you accept each one. Items tagged as health, financial, or legal must be accepted individually and cannot be swept with "Accept all".

---

## Running the tests

```bash
npm test
```

The test suite covers the parser, the briefing assembler, the proposals queue, persistence round-trips, and the full copy-paste engine loop. 88 tests, no external dependencies needed to run them.

---

## Project structure

```
src/
  engine/       pure logic — no DOM touches
    parser.js         parse structured blocks out of a chatbot reply
    records.js        typed record schema and vocabulary constants
    engine.js         main factory: boards, record mutations, proposals
    briefing.js       briefing assembler (status gate, tag match, token cap)
    persistence.js    export/import the full record to/from a .md file
    proposals.js      parse and apply model-proposed record changes
    contextSpec.js    build the Context Spec and revocation blocks
    prompts.js        compose the outbound prompts
    nano.js           optional Gemini Nano fallback (feature-detected at runtime)
  ui/           DOM wiring only — no business logic
    layout.js         build the shell HTML
    boards.js         render the four context boards
    transport.js      clipboard in/out, ingest, preview
    proposals.js      pending proposals queue panel
    modal.js          in-app prompt/confirm/form modals
    override.js       memory override and assumption edit flows
  styles/
    main.css
tests/              Vitest test suite
```

---

## What it is not

- Not a model wrapper or API client. It uses your existing chatbot accounts.
- Not a browser extension. It works through the clipboard — you copy and paste manually. (A browser extension that replaces the clipboard is on the roadmap as B2, not started.)
- Not a multi-model router. Tools like TypingMind, LibreChat, or OpenRouter do that. Context Lens is the record layer that sits on top of any of them.
- Not a backend service. The record lives in a file you own.

---

## Browser support

Any modern browser. The app uses the Clipboard API for the copy/paste buttons — if clipboard access is blocked, you can still select and copy the prompt manually from the preview textarea.

---

## License

MIT — see [LICENSE](LICENSE).
