/**
 * R4 — propose-and-confirm UI. Renders the queue of model-proposed record
 * changes with per-item accept / reject, batch "Accept all (safe)" and
 * "Reject all", and a "needs individual confirm" flag on high-impact items.
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function summariseProposal(p) {
  if (p.type === 'mark_status') return `Mark ${shortId(p.target_id)} → ${p.status}`;
  if (p.type === 'supersede') return `Supersede ${shortId(p.target_id)} with ${shortId(p.new_id)}`;
  if (p.type === 'tag') return `Tag ${shortId(p.target_id)} with #${p.tags.join(' #')}`;
  if (p.type === 'new') {
    const tagPart = p.tags.length > 0 ? ` [#${p.tags.join(' #')}]` : '';
    return `New ${p.board}: ${p.text}${tagPart}`;
  }
  return JSON.stringify(p);
}

function shortId(id) {
  if (!id) return '(?)';
  return String(id).length > 12 ? String(id).slice(0, 8) + '…' : String(id);
}

export function initProposals(container, engine, onUpdate) {
  const panel = el('section', 'proposals-panel');
  panel.hidden = true;

  const header = el('header', 'proposals-header');
  const title = el('h2', 'proposals-title', 'Pending proposals');
  const subtitle = el(
    'p',
    'proposals-subtitle',
    'The model proposed these record changes. Nothing is applied until you confirm.',
  );
  header.append(title, subtitle);

  const batchBar = el('div', 'proposals-batch');
  const acceptAllBtn = el('button', 'btn btn-primary btn-small', 'Accept all (safe)');
  acceptAllBtn.type = 'button';
  const rejectAllBtn = el('button', 'btn btn-ghost btn-small', 'Reject all');
  rejectAllBtn.type = 'button';
  batchBar.append(acceptAllBtn, rejectAllBtn);

  const list = el('div', 'proposals-list');

  panel.append(header, batchBar, list);
  container.append(panel);

  function render() {
    const pending = engine.getPendingProposals();
    panel.hidden = pending.length === 0;
    list.replaceChildren();

    const highImpactPending = pending.filter((p) => p.requiresIndividualConfirm).length;
    const safePending = pending.length - highImpactPending;
    acceptAllBtn.disabled = safePending === 0;
    acceptAllBtn.textContent = safePending > 0
      ? `Accept all (safe — ${safePending})`
      : 'Accept all (safe)';
    rejectAllBtn.disabled = pending.length === 0;

    for (const proposal of pending) {
      const row = el('div', 'proposal-row');
      if (proposal.requiresIndividualConfirm) row.classList.add('proposal-high-impact');

      const header = el('div', 'proposal-line');
      header.append(el('span', 'proposal-type', proposal.type.replace('_', ' ')));
      header.append(el('span', 'proposal-summary', summariseProposal(proposal)));
      if (proposal.requiresIndividualConfirm) {
        header.append(el('span', 'proposal-impact-pill', 'high impact — must confirm individually'));
      }
      row.append(header);

      if (proposal.rationale) {
        row.append(el('p', 'proposal-rationale', `rationale: ${proposal.rationale}`));
      }

      const actions = el('div', 'proposal-actions');
      const acceptBtn = el('button', 'btn btn-primary btn-small', 'Accept');
      acceptBtn.type = 'button';
      acceptBtn.addEventListener('click', () => {
        const result = engine.acceptProposal(proposal.id);
        if (!result.applied) {
          alert(`Could not apply proposal: ${result.reason || 'unknown error'}`);
        }
        onUpdate();
      });
      const rejectBtn = el('button', 'btn btn-ghost btn-small', 'Reject');
      rejectBtn.type = 'button';
      rejectBtn.addEventListener('click', () => {
        engine.rejectProposal(proposal.id);
        onUpdate();
      });
      actions.append(acceptBtn, rejectBtn);
      row.append(actions);

      list.append(row);
    }
  }

  acceptAllBtn.addEventListener('click', () => {
    engine.acceptAllSafeProposals();
    onUpdate();
  });
  rejectAllBtn.addEventListener('click', () => {
    engine.rejectAllProposals();
    onUpdate();
  });

  return { render };
}
