function recordTags(item) {
  if (!Array.isArray(item.tags) || item.tags.length === 0) return '';
  return ` #${item.tags.join(' #')}`;
}

function recordBadge(item) {
  const parts = [];
  if (item.status) parts.push(item.status);
  if (item.confidence) parts.push(`${item.confidence} conf`);
  if (parts.length === 0) return '';
  return ` _(${parts.join(' · ')})_`;
}

/**
 * Build markdown Context Spec from active board state.
 * @param {{ memory: object[], facts: object[], assumptions: object[], ambient?: object[] }} boards
 */
export function buildContextSpec(boards) {
  const lines = ['# Context Spec', ''];

  const activeMemory = boards.memory.filter((m) => m.active);
  lines.push('## Memory');
  if (activeMemory.length === 0) {
    lines.push('_No active memory._');
  } else {
    for (const item of activeMemory) {
      lines.push(`- ${item.committedText}${recordBadge(item)}${recordTags(item)}`);
    }
  }
  lines.push('');

  const activeFacts = boards.facts.filter((f) => f.active);
  lines.push('## Facts');
  if (activeFacts.length === 0) {
    lines.push('_No active facts._');
  } else {
    for (const fact of activeFacts) {
      if (fact.type === 'retrieved') {
        const meta = [fact.sourceUrl, fact.sourceDate].filter(Boolean).join(' · ');
        lines.push(
          `- [retrieved] ${fact.content}${meta ? ` (${meta})` : ''}${recordBadge(fact)}${recordTags(fact)}`,
        );
      } else {
        lines.push(`- [computed] ${fact.content}${recordBadge(fact)}${recordTags(fact)}`);
      }
    }
  }
  lines.push('');

  const activeAssumptions = boards.assumptions.filter((a) => a.active);
  lines.push('## Assumptions');
  if (activeAssumptions.length === 0) {
    lines.push('_No active assumptions._');
  } else {
    for (const assumption of activeAssumptions) {
      lines.push(
        `- ${assumption.statement} — likely because: ${assumption.reason}${recordBadge(assumption)}${recordTags(assumption)}`,
      );
    }
  }
  lines.push('');

  const ambient = (boards.ambient || []).filter((x) => x.active !== false && x.intensity !== 'stale');
  lines.push('## Ambient context');
  if (ambient.length === 0) {
    lines.push('_No ambient context._');
  } else {
    for (const item of ambient) {
      const intensity = item.intensity ? ` _(intensity: ${item.intensity})_` : '';
      const tags = recordTags(item);
      lines.push(`- ${item.text}${intensity}${tags}`);
    }
  }

  return lines.join('\n');
}

/**
 * Items the user suppressed or overrode — must be named explicitly for restart prompts.
 * @param {{ memory: object[], facts: object[], assumptions: object[] }} boards
 */
export function buildRevocations(boards) {
  const sections = [];

  const revokedMemory = boards.memory.filter((m) => !m.active);
  if (revokedMemory.length > 0) {
    const lines = ['## Revoked memory — DELETE from your reasoning'];
    for (const item of revokedMemory) {
      lines.push(`- "${item.committedText}" — do not use; user suppressed this`);
    }
    sections.push(lines.join('\n'));
  }

  const overriddenMemory = boards.memory.filter(
    (m) => m.active && m.source === 'user_override' && m.originalText !== m.committedText,
  );
  if (overriddenMemory.length > 0) {
    const lines = ['## Memory corrections — REPLACE former wording'];
    for (const item of overriddenMemory) {
      lines.push(`- DELETE/IGNORE: "${item.originalText}"`);
      lines.push(`- USE INSTEAD (authoritative): "${item.committedText}"`);
    }
    sections.push(lines.join('\n'));
  }

  const revokedAssumptions = boards.assumptions.filter((a) => !a.active);
  if (revokedAssumptions.length > 0) {
    const lines = ['## Revoked assumptions — DELETE from your answer'];
    for (const item of revokedAssumptions) {
      lines.push(
        `- "${item.statement}" (was: likely because ${item.reason}) — user rejected this assumption; do not rely on it or repeat content that depended on it`,
      );
    }
    sections.push(lines.join('\n'));
  }

  const editedAssumptions = boards.assumptions.filter(
    (a) =>
      a.active &&
      a.originalStatement !== undefined &&
      (a.statement !== a.originalStatement || a.reason !== a.originalReason),
  );
  if (editedAssumptions.length > 0) {
    const lines = ['## Corrected assumptions — REPLACE old wording with new'];
    for (const item of editedAssumptions) {
      if (item.statement !== item.originalStatement) {
        lines.push(`- DELETE/IGNORE: "${item.originalStatement}"`);
        lines.push(`- USE INSTEAD (authoritative): "${item.statement}"`);
      }
      if (item.reason !== item.originalReason) {
        lines.push(
          `- Reason correction: was "likely because ${item.originalReason}" — now "likely because ${item.reason}"`,
        );
      }
    }
    sections.push(lines.join('\n'));
  }

  const revokedFacts = boards.facts.filter((f) => !f.active);
  if (revokedFacts.length > 0) {
    const lines = ['## Revoked facts — DELETE from your evidence'];
    for (const item of revokedFacts) {
      lines.push(`- "${item.content}" — user suppressed this fact`);
    }
    sections.push(lines.join('\n'));
  }

  if (sections.length === 0) return '';

  return sections.join('\n\n');
}

/**
 * @param {{ memory: object[], facts: object[], assumptions: object[] }} boards
 */
export function hasRevocations(boards) {
  return buildRevocations(boards).length > 0;
}

/**
 * Short, impossible-to-miss block for the top of outbound prompts.
 * @param {{ memory: object[], facts: object[], assumptions: object[] }} boards
 */
export function buildRevocationAlert(boards) {
  const lines = [
    '===REVOKED_BY_USER_DO_NOT_USE===',
    'The user UNCHECKED or REJECTED the following in Context Lens. DELETE them from your reasoning and answer. Do NOT mention them.',
    '',
  ];

  for (const item of boards.assumptions.filter((a) => !a.active)) {
    lines.push(`ASSUMPTION_DELETE: "${item.statement}" | reason_was: ${item.reason}`);
  }
  for (const item of boards.assumptions.filter(
    (a) =>
      a.active &&
      a.originalStatement !== undefined &&
      (a.statement !== a.originalStatement || a.reason !== a.originalReason),
  )) {
    lines.push(`ASSUMPTION_REPLACE_DELETE: "${item.originalStatement}"`);
    lines.push(`ASSUMPTION_REPLACE_USE: "${item.statement}"`);
    if (item.reason !== item.originalReason) {
      lines.push(`ASSUMPTION_REASON_WAS: "${item.originalReason}" → NOW: "${item.reason}"`);
    }
  }
  for (const item of boards.memory.filter((m) => !m.active)) {
    lines.push(`MEMORY_DELETE: "${item.committedText}"`);
  }
  for (const item of boards.memory.filter(
    (m) => m.active && m.source === 'user_override' && m.originalText !== m.committedText,
  )) {
    lines.push(`MEMORY_REPLACE_DELETE: "${item.originalText}"`);
    lines.push(`MEMORY_REPLACE_USE: "${item.committedText}"`);
  }
  for (const item of boards.facts.filter((f) => !f.active)) {
    lines.push(`FACT_DELETE: "${item.content}"`);
  }

  lines.push('===END_REVOKED===');
  return lines.join('\n');
}
