import { createEngine } from './engine/engine.js';
import { buildLayout } from './ui/layout.js';
import { initBoards } from './ui/boards.js';
import { initTransport } from './ui/transport.js';
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
  transport.updateContextSpec();
}

const boards = initBoards(refs.boardsContainer, engine, refreshAll, refreshContext);
const transport = initTransport(refs, engine, refreshAll);

refreshAll();

isNanoAvailable().then((available) => {
  if (available) {
    transport.setStatus('Gemini Nano available for parse/compose fallback.');
  }
});
