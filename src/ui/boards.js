import { showMemoryOverride, showAssumptionEdit } from './override.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createBoardSection(title, emptyMessage, modifier) {
  const section = el('section', `board-section board-${modifier}`);
  const heading = el('h3', 'board-title', title);
  const list = el('div', 'board-list');
  const empty = el('p', 'board-empty', emptyMessage);
  section.append(heading, list, empty);
  return { section, list, empty };
}

function createToggleRow(id, active, onChange, labelText) {
  const row = el('div', `board-row${active ? '' : ' suppressed'}`);
  const label = el('label', 'row-toggle');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = active;
  checkbox.setAttribute('aria-label', labelText);
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  const text = el('span', 'row-text', labelText);
  label.append(checkbox, text);
  row.append(label);
  return { row, checkbox, text };
}

export function initBoards(container, engine, onFullUpdate, onContextUpdate) {
  const memoryBoard = createBoardSection(
    'Memory',
    'Empty — copy a prompt to your chatbot first, then paste its structured reply.',
    'memory',
  );
  const factsBoard = createBoardSection(
    'Facts',
    'Retrieved and computed facts appear after parsing a reply.',
    'facts',
  );
  const assumptionsBoard = createBoardSection(
    'Assumptions',
    'Inferred assumptions appear after parsing a reply.',
    'assumptions',
  );

  container.append(memoryBoard.section, factsBoard.section, assumptionsBoard.section);

  function saveScroll() {
    return container.scrollTop;
  }

  function restoreScroll(scrollTop) {
    container.scrollTop = scrollTop;
  }

  function afterToggle(row, active) {
    row.classList.toggle('suppressed', !active);
    onContextUpdate();
  }

  function render() {
    const scrollTop = saveScroll();
    const boards = engine.getBoards();

  memoryBoard.list.replaceChildren();
  factsBoard.list.replaceChildren();
  assumptionsBoard.list.replaceChildren();

  memoryBoard.empty.hidden = boards.memory.length > 0;
  factsBoard.empty.hidden = boards.facts.length > 0;
  assumptionsBoard.empty.hidden = boards.assumptions.length > 0;

  for (const item of boards.memory) {
    const { row, text } = createToggleRow(
      item.id,
      item.active,
      (active) => {
        engine.toggleMemory(item.id, active);
        afterToggle(row, active);
      },
      item.committedText,
    );

    if (item.source === 'user_override') {
      text.classList.add('overridden');
    }

    const editBtn = el('button', 'btn btn-small', 'Override');
    editBtn.type = 'button';
    editBtn.addEventListener('click', async () => {
      const userText = window.prompt('Override memory bullet:', item.committedText);
      if (userText === null) return;

      const committedText = await showMemoryOverride(engine, item.id, userText);
      if (committedText) onFullUpdate();
    });

    row.append(editBtn);
    memoryBoard.list.append(row);
  }

  for (const item of boards.facts) {
    const label = item.type === 'computed' ? `[computed] ${item.content}` : item.content;
    const { row } = createToggleRow(item.id, item.active, (active) => {
      engine.toggleFact(item.id, active);
      afterToggle(row, active);
    }, label);

    const meta = el('div', 'row-meta');
    if (item.type === 'computed') {
      const marker = el('span', 'inferred-marker', 'inferred');
      row.querySelector('.row-toggle').append(marker);
    } else if (item.type === 'retrieved') {
      const marker = el('span', 'readout-marker', 'retrieved');
      row.querySelector('.row-toggle').append(marker);
      if (item.sourceUrl || item.sourceDate) {
        const parts = [item.sourceUrl, item.sourceDate].filter(Boolean).join(' · ');
        meta.textContent = parts;
      }
    }

    row.append(meta);
    factsBoard.list.append(row);
  }

  for (const item of boards.assumptions) {
    const { row } = createToggleRow(item.id, item.active, (active) => {
      engine.toggleAssumption(item.id, active);
      afterToggle(row, active);
    }, item.statement);

    const marker = el('span', 'inferred-marker', 'inferred');
    row.querySelector('.row-toggle').append(marker);

    const reason = el('p', 'row-reason', `likely because: ${item.reason}`);
    const editBtn = el('button', 'btn btn-small', 'Edit');
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => {
      const saved = showAssumptionEdit(engine, item);
      if (saved) onFullUpdate();
    });

    row.append(reason, editBtn);
    assumptionsBoard.list.append(row);
  }

  restoreScroll(scrollTop);
  }

  return { render };
}
