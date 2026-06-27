export async function showMemoryOverride(engine, id, userText) {
  if (!userText.trim()) return null;

  const committedText = await engine.overrideMemory(id, userText);
  const accepted = window.confirm(
    `Proposed committed phrasing:\n\n${committedText}\n\nAccept and pin this wording?`,
  );

  if (!accepted) return null;

  engine.ratifyMemory(id, committedText);
  return committedText;
}

function createField(id, labelText, value) {
  const group = document.createElement('label');
  group.className = 'dialog-field';
  group.htmlFor = id;

  const label = document.createElement('span');
  label.textContent = labelText;

  const textarea = document.createElement('textarea');
  textarea.id = id;
  textarea.value = value;
  textarea.rows = 3;

  group.append(label, textarea);
  return { group, textarea };
}

export function showAssumptionEdit(engine, assumption) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('section');
    dialog.className = 'edit-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'assumption-dialog-title');

    const title = document.createElement('h2');
    title.id = 'assumption-dialog-title';
    title.textContent = 'Override assumption';

    const intro = document.createElement('p');
    intro.textContent =
      'The next prompt will tell the chatbot to ignore the old assumption and use this one instead.';

    const statement = createField('assumption-statement', 'Use this assumption instead', assumption.statement);
    const reason = createField('assumption-reason', 'Likely because', assumption.reason);

    const error = document.createElement('p');
    error.className = 'dialog-error';
    error.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save override';

    actions.append(cancelBtn, saveBtn);
    dialog.append(title, intro, statement.group, reason.group, error, actions);
    overlay.append(dialog);
    document.body.append(overlay);

    const close = (saved) => {
      overlay.remove();
      resolve(saved);
    };

    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false);
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        saveBtn.click();
      }
    });

    saveBtn.addEventListener('click', () => {
      const statementValue = statement.textarea.value.trim();
      const reasonValue = reason.textarea.value.trim();

      if (!statementValue || !reasonValue) {
        error.textContent = 'Add both the replacement assumption and the reason.';
        error.hidden = false;
        return;
      }

      engine.editAssumption(assumption.id, statementValue, reasonValue);
      close(true);
    });

    statement.textarea.focus();
    statement.textarea.select();
  });
}
