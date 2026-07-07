import { showPromptModal, showConfirmModal, showFieldsModal } from './modal.js';

export async function showMemoryOverride(engine, id, userText) {
  if (!userText.trim()) return null;

  const committedText = await engine.overrideMemory(id, userText);

  const accepted = await showConfirmModal(
    `Proposed committed phrasing:\n\n"${committedText}"\n\nAccept and pin this wording?`,
  );

  if (!accepted) return null;

  engine.ratifyMemory(id, committedText);
  return committedText;
}

export async function showAssumptionEdit(engine, assumption) {
  const result = await showFieldsModal({
    title: 'Edit assumption',
    fields: [
      { id: 'statement', label: 'Assumption statement', value: assumption.statement },
      { id: 'reason', label: 'Likely because…', value: assumption.reason },
    ],
    confirmLabel: 'Save',
  });

  if (!result) return false;

  const statement = result.statement.trim();
  const reason = result.reason.trim();
  if (!statement) return false;

  engine.editAssumption(assumption.id, statement, reason);
  return true;
}

export async function showMemoryOverridePrompt(currentText) {
  return showPromptModal('Override memory bullet:', currentText);
}
