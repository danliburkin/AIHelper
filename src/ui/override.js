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

export function showAssumptionEdit(engine, assumption) {
  const statement = window.prompt('Assumption statement:', assumption.statement);
  if (statement === null) return false;

  const reason = window.prompt('Likely because:', assumption.reason);
  if (reason === null) return false;

  engine.editAssumption(assumption.id, statement.trim(), reason.trim());
  return true;
}
