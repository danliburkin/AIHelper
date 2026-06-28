export function buildLayout(root) {
  root.replaceChildren();

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const header = document.createElement('header');
  header.className = 'app-header';

  const brand = document.createElement('div');
  brand.className = 'app-brand';
  const title = document.createElement('h1');
  title.textContent = 'Context Lens';
  const subtitle = document.createElement('p');
  subtitle.className = 'app-subtitle';
  subtitle.textContent = 'Your question is wrapped with instructions — copy that to your chatbot';
  brand.append(title, subtitle);
  header.append(brand);

  const workflow = document.createElement('ol');
  workflow.className = 'workflow-steps';
  workflow.id = 'workflow-steps';
  for (const [step, text] of [
    ['1', 'Type question'],
    ['2', 'Copy to chatbot'],
    ['3', 'Paste reply'],
    ['4', 'Edit boards'],
  ]) {
    const item = document.createElement('li');
    item.className = 'workflow-step';
    item.dataset.step = step;
    if (step === '1') item.classList.add('workflow-step-active');
    const num = document.createElement('span');
    num.className = 'workflow-num';
    num.textContent = step;
    const label = document.createElement('span');
    label.textContent = text;
    item.append(num, label);
    workflow.append(item);
  }
  header.append(workflow);

  const outbound = document.createElement('section');
  outbound.className = 'outbound-panel';

  const taskRow = document.createElement('div');
  taskRow.className = 'task-row';
  const taskLabel = document.createElement('label');
  taskLabel.htmlFor = 'task-input';
  taskLabel.textContent = 'Your question';
  const taskInput = document.createElement('input');
  taskInput.id = 'task-input';
  taskInput.type = 'text';
  taskInput.className = 'task-input';
  taskInput.placeholder = 'e.g. Explain RAG simply for a complete beginner';
  taskRow.append(taskLabel, taskInput);

  const previewHeader = document.createElement('div');
  previewHeader.className = 'preview-header';
  const previewLabel = document.createElement('label');
  previewLabel.htmlFor = 'prompt-preview';
  previewLabel.textContent = 'Decorated prompt (what your chatbot receives)';
  const promptMode = document.createElement('span');
  promptMode.id = 'prompt-mode';
  promptMode.className = 'prompt-mode';
  promptMode.textContent = 'First answer';
  previewHeader.append(previewLabel, promptMode);

  const promptPreview = document.createElement('textarea');
  promptPreview.id = 'prompt-preview';
  promptPreview.className = 'prompt-preview';
  promptPreview.readOnly = true;
  promptPreview.placeholder =
    'Type your question above — this shows your question wrapped with instructions for memory, assumptions, and facts…';
  promptPreview.setAttribute('aria-label', 'Decorated prompt preview');

  const outboundActions = document.createElement('div');
  outboundActions.className = 'outbound-actions';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.id = 'copy-btn';
  copyBtn.className = 'btn btn-primary btn-large';
  copyBtn.textContent = 'Copy to chatbot';
  const copyHint = document.createElement('p');
  copyHint.className = 'copy-hint';
  copyHint.textContent = 'Paste this into ChatGPT, Claude, or Gemini — not your raw question.';
  outboundActions.append(copyBtn, copyHint);

  outbound.append(taskRow, previewHeader, promptPreview, outboundActions);

  const proposalsContainer = document.createElement('div');
  proposalsContainer.id = 'proposals-container';
  proposalsContainer.className = 'proposals-container';

  const main = document.createElement('main');
  main.className = 'app-main';

  const left = document.createElement('section');
  left.className = 'panel panel-reply';
  const replyLabel = document.createElement('h2');
  replyLabel.textContent = 'Chatbot reply';
  const replyHint = document.createElement('p');
  replyHint.className = 'panel-hint';
  replyHint.textContent =
    'Paste the chatbot’s full reply here. It only fills the boards if you sent the decorated prompt above (look for ===MEMORY=== blocks at the end).';
  const replyArea = document.createElement('textarea');
  replyArea.id = 'reply-area';
  replyArea.className = 'reply-textarea';
  replyArea.placeholder = 'Paste the chatbot reply here…';
  replyArea.setAttribute('aria-label', 'Chatbot reply');

  const replyActions = document.createElement('div');
  replyActions.className = 'reply-actions';
  const pasteBtn = document.createElement('button');
  pasteBtn.type = 'button';
  pasteBtn.id = 'paste-btn';
  pasteBtn.className = 'btn btn-accent';
  pasteBtn.textContent = 'Paste from clipboard';
  const ingestBtn = document.createElement('button');
  ingestBtn.type = 'button';
  ingestBtn.id = 'ingest-btn';
  ingestBtn.className = 'btn';
  ingestBtn.textContent = 'Parse reply';
  replyActions.append(pasteBtn, ingestBtn);
  left.append(replyLabel, replyHint, replyArea, replyActions);

  const right = document.createElement('section');
  right.className = 'panel panel-boards';
  const boardsLabel = document.createElement('h2');
  boardsLabel.textContent = 'Context boards';
  const boardsContainer = document.createElement('div');
  boardsContainer.id = 'boards-container';
  boardsContainer.className = 'boards-container';
  right.append(boardsLabel, boardsContainer);

  main.append(left, right);

  const footer = document.createElement('footer');
  footer.className = 'app-footer';

  const contextLabel = document.createElement('h2');
  contextLabel.textContent = 'Live Context Spec';
  const revocationsLabel = document.createElement('h2');
  revocationsLabel.textContent = 'Will tell chatbot to DELETE';
  revocationsLabel.className = 'revocations-label';
  revocationsLabel.hidden = true;
  const revocationsPreview = document.createElement('pre');
  revocationsPreview.id = 'revocations-preview';
  revocationsPreview.className = 'revocations-preview';
  revocationsPreview.hidden = true;
  const contextSpec = document.createElement('pre');
  contextSpec.id = 'context-spec';
  contextSpec.className = 'context-spec';

  const recordViewLabel = document.createElement('h2');
  recordViewLabel.textContent = 'Record view (longitudinal)';
  recordViewLabel.className = 'record-view-label';
  const recordView = document.createElement('div');
  recordView.id = 'record-view';
  recordView.className = 'record-view';

  const footerBar = document.createElement('div');
  footerBar.className = 'footer-bar';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.id = 'export-btn';
  exportBtn.className = 'btn btn-ghost';
  exportBtn.textContent = 'Export record';

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.id = 'import-btn';
  importBtn.className = 'btn btn-ghost';
  importBtn.textContent = 'Import record';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.id = 'import-input';
  importInput.accept = '.md,.markdown,.json,.txt,text/markdown,application/json,text/plain';
  importInput.hidden = true;

  const status = document.createElement('p');
  status.id = 'status';
  status.className = 'status';
  status.setAttribute('role', 'status');

  const retryCopyBtn = document.createElement('button');
  retryCopyBtn.type = 'button';
  retryCopyBtn.id = 'retry-copy-btn';
  retryCopyBtn.className = 'btn btn-primary btn-inline';
  retryCopyBtn.textContent = 'Copy decorated prompt';
  retryCopyBtn.hidden = true;

  footerBar.append(exportBtn, importBtn, importInput, retryCopyBtn, status);
  footer.append(
    recordViewLabel,
    recordView,
    contextLabel,
    contextSpec,
    revocationsLabel,
    revocationsPreview,
    footerBar,
  );

  shell.append(header, outbound, proposalsContainer, main, footer);
  root.append(shell);

  return {
    replyArea,
    taskInput,
    promptPreview,
    boardsContainer,
    contextSpec,
    revocationsPreview,
    revocationsLabel,
    promptMode,
    pasteBtn,
    ingestBtn,
    copyBtn,
    retryCopyBtn,
    exportBtn,
    importBtn,
    importInput,
    recordView,
    proposalsContainer,
    status,
    workflowSteps: workflow,
  };
}
