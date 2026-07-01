import { createEngine } from './engine/engine.js';
import { buildLayout } from './ui/layout.js';
import { initBoards } from './ui/boards.js';
import { initTransport } from './ui/transport.js';
import { initProposals } from './ui/proposals.js';
import { initSpiral } from './ui/spiral.js';
import { isNanoAvailable } from './engine/nano.js';

const engine = createEngine();
const root = document.getElementById('app');
const refs = buildLayout(root);

function refreshContext() {
  transport.updateContextSpec();
  transport.onBoardsEdited();
}

function refreshAll() {
  boards.render();
  proposals.render();
  spiral.render();
  transport.updateContextSpec();
}

const boards = initBoards(refs.boardsContainer, engine, refreshAll, refreshContext);
const proposals = initProposals(refs.proposalsContainer, engine, refreshAll);
const spiral = initSpiral(refs.spiralContainer, engine, (question) => {
  // After a rewind, sync the question input and refresh everything.
  if (refs.taskInput && question) refs.taskInput.value = question;
  refreshAll();
});
const transport = initTransport(refs, engine, refreshAll);

refreshAll();

isNanoAvailable().then((available) => {
  if (available) {
    transport.setStatus('Gemini Nano available for parse/compose fallback.');
  }
});
