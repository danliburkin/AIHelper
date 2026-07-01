import { showMemoryOverride, showAssumptionEdit, showMemoryOverridePrompt } from './override.js';
import { STATUSES, INTENSITIES, isVisiblyUntrusted } from '../engine/records.js';

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

function statusSelect(currentStatus, onChange) {
  const select = document.createElement('select');
  select.className = 'record-status-select';
  select.setAttribute('aria-label', 'Status');
  for (const status of STATUSES) {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = status;
    if (status === currentStatus) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function intensitySelect(currentIntensity, onChange) {
  const select = document.createElement('select');
  select.className = 'record-intensity-select';
  select.setAttribute('aria-label', 'Intensity');
  for (const intensity of INTENSITIES) {
    const option = document.createElement('option');
    option.value = intensity;
    option.textContent = intensity;
    if (intensity === currentIntensity) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function appendRecordMeta(row, item, statusOnChange) {
  const meta = el('div', 'record-meta');

  if (statusOnChange) {
    const statusWrap = el('label', 'meta-field');
    statusWrap.append(el('span', 'meta-key', 'status'), statusSelect(item.status, statusOnChange));
    meta.append(statusWrap);
  }

  if (item.confidence) {
    const conf = el('span', `confidence-pill confidence-${item.confidence}`, item.confidence);
    meta.append(conf);
  }

  if (item.provenance) {
    const prov = el(
      'span',
      `provenance-pill provenance-${item.provenance}`,
      item.provenance.replace(/_/g, ' '),
    );
    meta.append(prov);
  }

  if (isVisiblyUntrusted(item)) {
    meta.append(el('span', 'weak-pill', 'verify — weak'));
  }

  if (Array.isArray(item.tags) && item.tags.length > 0) {
    const tagList = el('span', 'tag-list');
    for (const tag of item.tags) {
      tagList.append(el('span', 'tag-pill', `#${tag}`));
    }
    meta.append(tagList);
  }

  row.append(meta);
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
  const ambientBoard = createBoardSection(
    'Ambient context',
    'Soft context (mood, standing constraints) appears here when the model emits an ===AMBIENT=== block.',
    'ambient',
  );

  container.append(
    memoryBoard.section,
    factsBoard.section,
    assumptionsBoard.section,
    ambientBoard.section,
  );

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
    ambientBoard.list.replaceChildren();

    memoryBoard.empty.hidden = boards.memory.length > 0;
    factsBoard.empty.hidden = boards.facts.length > 0;
    assumptionsBoard.empty.hidden = boards.assumptions.length > 0;
    ambientBoard.empty.hidden = (boards.ambient || []).length > 0;

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
        const userText = await showMemoryOverridePrompt(item.committedText);
        if (userText === null) return;

        const committedText = await showMemoryOverride(engine, item.id, userText);
        if (committedText) onFullUpdate();
      });

      row.append(editBtn);
      appendRecordMeta(row, item, (newStatus) => {
        engine.updateRecordStatus(item.id, newStatus);
        onFullUpdate();
      });
      memoryBoard.list.append(row);
    }

    for (const item of boards.facts) {
      const label = item.type === 'computed' ? `[computed] ${item.content}` : item.content;
      const { row } = createToggleRow(item.id, item.active, (active) => {
        engine.toggleFact(item.id, active);
        afterToggle(row, active);
      }, label);

      const sourceMeta = el('div', 'row-meta');
      if (item.type === 'computed') {
        const marker = el('span', 'inferred-marker', 'inferred');
        row.querySelector('.row-toggle').append(marker);
      } else if (item.type === 'retrieved') {
        const marker = el('span', 'readout-marker', 'retrieved');
        row.querySelector('.row-toggle').append(marker);
        if (item.sourceUrl || item.sourceDate) {
          const parts = [item.sourceUrl, item.sourceDate].filter(Boolean).join(' · ');
          sourceMeta.textContent = parts;
        }
      }

      row.append(sourceMeta);
      appendRecordMeta(row, item, (newStatus) => {
        engine.updateRecordStatus(item.id, newStatus);
        onFullUpdate();
      });
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
      appendRecordMeta(row, item, (newStatus) => {
        engine.updateRecordStatus(item.id, newStatus);
        onFullUpdate();
      });
      assumptionsBoard.list.append(row);
    }

    for (const item of boards.ambient || []) {
      const { row } = createToggleRow(
        item.id,
        item.active !== false,
        (active) => {
          engine.toggleAmbient(item.id, active);
          afterToggle(row, active);
        },
        item.text,
      );

      const intensityField = el('label', 'meta-field');
      intensityField.append(
        el('span', 'meta-key', 'intensity'),
        intensitySelect(item.intensity, (newIntensity) => {
          engine.updateAmbientIntensity(item.id, newIntensity);
          onFullUpdate();
        }),
      );
      const ambientMeta = el('div', 'record-meta');
      ambientMeta.append(intensityField);
      if (Array.isArray(item.tags) && item.tags.length > 0) {
        const tagList = el('span', 'tag-list');
        for (const tag of item.tags) tagList.append(el('span', 'tag-pill', `#${tag}`));
        ambientMeta.append(tagList);
      }
      row.append(ambientMeta);
      ambientBoard.list.append(row);
    }

    restoreScroll(scrollTop);
  }

  return { render };
}
