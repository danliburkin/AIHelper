export function initTransport(refs, engine, onUpdate) {
  const {
    replyArea,
    taskInput,
    promptPreview,
    promptMode,
    contextSpec,
    revocationsPreview,
    revocationsLabel,
    pasteBtn,
    ingestBtn,
    copyBtn,
    retryCopyBtn,
    exportBtn,
    status,
    workflowSteps,
  } = refs;

  function setStatus(message, kind = 'info', showRetry = false) {
    status.textContent = message;
    status.classList.remove('status-warning', 'status-success');
    if (kind === 'warning') status.classList.add('status-warning');
    if (kind === 'success') status.classList.add('status-success');
    retryCopyBtn.hidden = !showRetry;
  }

  function syncTask() {
    const value = taskInput.value.trim();
    engine.setOriginalTask(value);
    engine.setTopic(value);
  }

  function updatePromptPreview() {
    syncTask();
    const task = taskInput.value.trim();

    if (!task) {
      promptPreview.value = '';
      if (promptMode) promptMode.textContent = 'First answer';
      return;
    }

    const regenerating = engine.needsRegeneratePrompt();
    promptPreview.value = engine.previewSmartPrompt();

    if (promptMode) {
      promptMode.textContent = regenerating ? 'Regenerate with your edits' : 'First answer';
      promptMode.classList.toggle('prompt-mode-regenerate', regenerating);
    }

    const revocations = engine.buildRevocationsPreview();
    if (revocationsPreview && revocationsLabel) {
      const show = Boolean(revocations);
      revocationsPreview.hidden = !show;
      revocationsLabel.hidden = !show;
      revocationsPreview.textContent = revocations || '';
    }
  }

  taskInput.addEventListener('input', () => {
    updatePromptPreview();
    highlightStep(1);
  });

  taskInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && taskInput.value.trim()) {
      event.preventDefault();
      copyToChatbot();
    }
  });

  function onBoardsEdited() {
    updatePromptPreview();
    if (engine.needsRegeneratePrompt()) {
      setStatus(
        'Boards edited — Copy to chatbot now includes DELETE instructions for what you removed.',
        'warning',
      );
      highlightStep(4);
    }
  }

  function updateContextSpec() {
    contextSpec.textContent = engine.buildContextSpec();
    updatePromptPreview();
  }

  function formatAdded(added) {
    const parts = [];
    if (added.memory) parts.push(`${added.memory} memory`);
    if (added.assumptions) parts.push(`${added.assumptions} assumptions`);
    if (added.facts) parts.push(`${added.facts} facts`);
    return parts.join(', ');
  }

  async function ingestFromText(text) {
    if (!text.trim()) {
      setStatus('Paste the chatbot reply in the box on the left.', 'warning');
      return;
    }

    syncTask();

    if (!taskInput.value.trim()) {
      setStatus('Type your question first — that is how the decorated prompt is built.', 'warning');
      return;
    }

    const result = await engine.ingestReplyWithFallback(text);
    onUpdate();

    const total = result.memory + result.assumptions + result.facts;

    if (total === 0) {
      setStatus(
        'This reply has no structured blocks — you likely pasted your raw question into the chatbot instead of the decorated prompt. Copy the decorated prompt above and send that, then paste the new reply here.',
        'warning',
        true,
      );
      highlightStep(2);
      return;
    }

    setStatus(`Parsed ${formatAdded(result)} into boards.`, 'success');
    highlightStep(4);
  }

  replyArea.addEventListener('paste', () => {
    window.setTimeout(() => ingestFromText(replyArea.value), 0);
  });

  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      replyArea.value = text;
      await ingestFromText(text);
    } catch {
      setStatus('Clipboard blocked — paste with Ctrl+V into the reply box.', 'warning');
    }
  });

  ingestBtn.addEventListener('click', async () => {
    await ingestFromText(replyArea.value);
  });

  async function copyToChatbot() {
    syncTask();
    updatePromptPreview();

    if (!taskInput.value.trim()) {
      setStatus('Type your question first.', 'warning');
      taskInput.focus();
      return;
    }

    const regenerating = engine.needsRegeneratePrompt();

    try {
      const prompt = engine.previewSmartPrompt();
      await navigator.clipboard.writeText(prompt);
      setStatus(
        regenerating
          ? 'Copied regenerate prompt — tells the chatbot to delete revoked items and write a new answer.'
          : 'Copied decorated prompt — paste into your chatbot, send, then paste the reply back here.',
        'success',
      );
      highlightStep(3);
      replyArea.focus();
    } catch {
      setStatus('Copy failed — select the decorated prompt text and copy manually (Ctrl+C).', 'warning');
    }
  }

  copyBtn.addEventListener('click', copyToChatbot);
  retryCopyBtn.addEventListener('click', copyToChatbot);

  exportBtn.addEventListener('click', () => {
    const markdown = engine.buildContextSpec();
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'context-spec.md';
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Exported context-spec.md', 'success');
  });

  function highlightStep(step) {
    if (!workflowSteps) return;
    workflowSteps.querySelectorAll('.workflow-step').forEach((el) => {
      el.classList.toggle('workflow-step-active', Number(el.dataset.step) === step);
    });
  }

  replyArea.addEventListener('focus', () => highlightStep(3));

  updatePromptPreview();
  setStatus('Type your question — the decorated prompt updates automatically. One button: Copy to chatbot.');

  return { updateContextSpec, setStatus, updatePromptPreview, onBoardsEdited };
}
