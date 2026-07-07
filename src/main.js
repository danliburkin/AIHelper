import { createEngine } from './engine/engine.js';
import { buildLayout } from './ui/layout.js';
import { initBoards } from './ui/boards.js';
import { initTransport } from './ui/transport.js';
import { initProposals } from './ui/proposals.js';
import { initSpiral } from './ui/spiral.js';
import { initConversations } from './ui/conversations.js';
import { isNanoAvailable } from './engine/nano.js';
import { makeStorage, pickStorageKind } from './storage/adapter.js';

const engine = createEngine();
const root = document.getElementById('app');
const refs = buildLayout(root);

const hasBackend = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
);
const storage = makeStorage(pickStorageKind({ signedIn: false, hasBackend }));

function syncQuestionInputFromEngine() {
  refs.taskInput.value = engine.getOriginalTask();
}

function refreshContext() {
  transport.updateContextSpec();
  transport.onBoardsEdited();
}

function refreshAll() {
  boards.render();
  proposals.render();
  spiral.render();
  transport.updateContextSpec();
  conversations.scheduleSave();
}

// Conversations must be initialized before the other UI modules render for
// the first time, so the restored (or freshly created) conversation is what
// boards/spiral/transport show on first paint. The onSwitch callback below
// references boards/proposals/spiral/transport, which are declared further
// down — safe because it is only ever invoked after those consts are set.
const conversations = initConversations(refs, engine, () => {
  syncQuestionInputFromEngine();
  transport.resetReplyState();
  refreshAll();
}, storage);

syncQuestionInputFromEngine();

const boards = initBoards(refs.boardsContainer, engine, refreshAll, refreshContext);
const proposals = initProposals(refs.proposalsContainer, engine, refreshAll);
const spiral = initSpiral(refs.spiralContainer, engine, (question) => {
  // After a rewind, sync the question input and refresh everything.
  if (refs.taskInput && question) refs.taskInput.value = question;
  transport.resetReplyState();
  refreshAll();
});
const transport = initTransport(refs, engine, refreshAll);

refreshAll();

isNanoAvailable().then((available) => {
  if (available) {
    transport.setStatus('Gemini Nano available for parse/compose fallback.');
  }
});
