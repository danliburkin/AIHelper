/**
 * Conversation spiral — the per-session turn log with rewind.
 *
 * Each turn card shows: turn number, timestamp, question excerpt,
 * what was added (+N items), how many were revoked (−N), and a
 * "Restore to here" button that rolls board state back to that snapshot.
 *
 * @param {HTMLElement} container - element that receives the spiral section
 * @param {ReturnType<import('../engine/engine.js').createEngine>} engine
 * @param {(question: string) => void} onRestore - called after rewind so the UI can sync
 * @returns {{ render: () => void }}
 */
export function initSpiral(container, engine, onRestore) {
  const section = document.createElement('section');
  section.className = 'spiral-section';
  section.hidden = true;

  const header = document.createElement('header');
  header.className = 'spiral-header';
  const title = document.createElement('h2');
  title.className = 'spiral-title';
  title.textContent = 'Conversation turns';
  header.append(title);

  const list = document.createElement('div');
  list.className = 'spiral-list';

  section.append(header, list);
  container.append(section);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      const today = new Date();
      if (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      ) {
        return `Today ${formatTime(iso)}`;
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + formatTime(iso);
    } catch {
      return iso;
    }
  }

  function addedSummary(added) {
    if (!added) return '';
    return Object.entries(added)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `+${v} ${k}`)
      .join('  ');
  }

  function render() {
    const turns = engine.getTurns();
    section.hidden = turns.length === 0;
    list.replaceChildren();

    for (const turn of turns) {
      const card = el('div', 'turn-card');
      card.dataset.turn = turn.index;

      const meta = el('div', 'turn-meta');
      meta.append(el('span', 'turn-number', `#${turn.index}`));
      meta.append(el('span', 'turn-time', formatDate(turn.timestamp)));
      if (turn.revokedCount > 0) {
        meta.append(el('span', 'turn-revoked-pill', `−${turn.revokedCount} revoked`));
      }
      card.append(meta);

      if (turn.question) {
        const q = turn.question.length > 72
          ? turn.question.slice(0, 72) + '…'
          : turn.question;
        card.append(el('p', 'turn-question', q));
      }

      const summary = addedSummary(turn.added);
      if (summary) {
        card.append(el('p', 'turn-added', summary));
      }

      if (turn.replyText && turn.replyText.trim()) {
        const details = document.createElement('details');
        details.className = 'turn-reply-details';
        const summaryEl = document.createElement('summary');
        summaryEl.className = 'turn-reply-summary';
        summaryEl.textContent = 'Show pasted reply';
        const replyBody = el('pre', 'turn-reply-body', turn.replyText);
        details.append(summaryEl, replyBody);
        card.append(details);
      }

      const restoreBtn = el('button', 'btn btn-ghost btn-small turn-restore-btn', 'Restore to here');
      restoreBtn.type = 'button';
      restoreBtn.title = `Roll back to the state after turn ${turn.index}`;
      restoreBtn.addEventListener('click', () => {
        const ok = engine.restoreToTurn(turn.index);
        if (ok) onRestore(turn.question);
      });
      card.append(restoreBtn);

      list.append(card);
    }
  }

  return { render };
}
