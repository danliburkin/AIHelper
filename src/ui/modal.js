/**
 * In-app modal dialogs — replaces window.prompt / window.confirm.
 *
 * All functions return Promises so callers can await them exactly like the
 * browser built-ins:
 *   const value = await showPromptModal('Label', 'default');  // null on cancel
 *   const ok    = await showConfirmModal('Are you sure?');    // false on cancel
 *   const obj   = await showFieldsModal({ title, fields });  // null on cancel
 *
 * Modals are appended to document.body and removed on dismiss.
 * They trap focus and close on Escape.
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function trapFocus(dialog) {
  const focusable = () =>
    [...dialog.querySelectorAll('input, textarea, button, select, [tabindex]')].filter(
      (n) => !n.disabled && n.tabIndex >= 0,
    );

  function onKeydown(e) {
    if (e.key !== 'Tab') return;
    const nodes = focusable();
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  dialog.addEventListener('keydown', onKeydown);
  return () => dialog.removeEventListener('keydown', onKeydown);
}

function mount(dialog) {
  const overlay = el('div', 'modal-overlay');
  overlay.setAttribute('role', 'presentation');
  overlay.append(dialog);
  document.body.append(overlay);
  const firstInput = dialog.querySelector('input, textarea');
  if (firstInput) {
    // defer focus to let the browser paint
    requestAnimationFrame(() => {
      firstInput.focus();
      if (typeof firstInput.select === 'function') firstInput.select();
    });
  } else {
    dialog.querySelector('button')?.focus();
  }
  return overlay;
}

function dismount(overlay, cleanupFn) {
  cleanupFn?.();
  overlay.remove();
}

/**
 * Single-field text prompt.
 * @param {string} label
 * @param {string} [defaultValue='']
 * @returns {Promise<string|null>}  null = cancelled
 */
export function showPromptModal(label, defaultValue = '') {
  return new Promise((resolve) => {
    const dialog = el('div', 'modal-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', label);

    const labelEl = el('label', 'modal-label', label);
    const inputId = 'modal-input-' + Math.random().toString(36).slice(2);
    labelEl.htmlFor = inputId;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = inputId;
    input.className = 'modal-input';
    input.value = defaultValue;

    const actions = el('div', 'modal-actions');
    const okBtn = el('button', 'btn btn-primary', 'OK');
    okBtn.type = 'button';
    const cancelBtn = el('button', 'btn btn-ghost', 'Cancel');
    cancelBtn.type = 'button';
    actions.append(okBtn, cancelBtn);

    dialog.append(labelEl, input, actions);

    const overlay = mount(dialog);
    const cleanup = trapFocus(dialog);

    function confirm() {
      const value = input.value;
      dismount(overlay, cleanup);
      resolve(value);
    }
    function cancel() {
      dismount(overlay, cleanup);
      resolve(null);
    }

    okBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });
  });
}

/**
 * Confirm dialog.
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export function showConfirmModal(message) {
  return new Promise((resolve) => {
    const dialog = el('div', 'modal-dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    const msg = el('p', 'modal-message', message);

    const actions = el('div', 'modal-actions');
    const okBtn = el('button', 'btn btn-primary', 'Accept');
    okBtn.type = 'button';
    const cancelBtn = el('button', 'btn btn-ghost', 'Cancel');
    cancelBtn.type = 'button';
    actions.append(okBtn, cancelBtn);

    dialog.append(msg, actions);

    const overlay = mount(dialog);
    const cleanup = trapFocus(dialog);

    function confirm() { dismount(overlay, cleanup); resolve(true); }
    function cancel() { dismount(overlay, cleanup); resolve(false); }

    okBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', cancel);
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });
  });
}

/**
 * Multi-field form modal.
 *
 * @param {{ title: string, fields: Array<{id, label, value, multiline?}>, confirmLabel?: string }} opts
 * @returns {Promise<Record<string,string>|null>}  null = cancelled
 */
export function showFieldsModal({ title, fields, confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    const dialog = el('div', 'modal-dialog modal-dialog-wide');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);

    const titleEl = el('h3', 'modal-title', title);
    dialog.append(titleEl);

    const inputs = {};
    for (const field of fields) {
      const group = el('div', 'modal-field-group');
      const labelEl = el('label', 'modal-label', field.label);
      const inputId = 'modal-field-' + field.id;
      labelEl.htmlFor = inputId;

      let inputEl;
      if (field.multiline) {
        inputEl = document.createElement('textarea');
        inputEl.rows = 3;
        inputEl.className = 'modal-textarea';
      } else {
        inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'modal-input';
      }
      inputEl.id = inputId;
      inputEl.value = field.value ?? '';
      inputs[field.id] = inputEl;

      group.append(labelEl, inputEl);
      dialog.append(group);
    }

    const actions = el('div', 'modal-actions');
    const okBtn = el('button', 'btn btn-primary', confirmLabel);
    okBtn.type = 'button';
    const cancelBtn = el('button', 'btn btn-ghost', 'Cancel');
    cancelBtn.type = 'button';
    actions.append(okBtn, cancelBtn);
    dialog.append(actions);

    const overlay = mount(dialog);
    const cleanup = trapFocus(dialog);

    function confirm() {
      const result = {};
      for (const [id, inputEl] of Object.entries(inputs)) {
        result[id] = inputEl.value;
      }
      dismount(overlay, cleanup);
      resolve(result);
    }
    function cancel() {
      dismount(overlay, cleanup);
      resolve(null);
    }

    okBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', cancel);
    // Ctrl+Enter or Enter in single-line fields confirms.
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirm(); }
    });
    for (const inputEl of Object.values(inputs)) {
      if (inputEl.tagName === 'INPUT') {
        inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); confirm(); }
        });
      }
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });
  });
}
