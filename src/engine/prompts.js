import { buildContextSpec, buildRevocations, hasRevocations, buildRevocationAlert } from './contextSpec.js';

const BLOCK_FORMAT = `Use this exact block format at the end of your reply:

===MEMORY===
- <bullet>
===ASSUMPTIONS===
- assumption: <text> | reason: <text>
===FACTS===
- type: retrieved | content: <text> | source: <url> | date: <date>
- type: computed | content: <text>
===END===`;

function composePrimeAssumptions(state) {
  const topic = state.topic || state.originalTask || '(no topic set)';

  return `You are helping surface context before a task is performed.

Given this topic or task description:
"""
${topic}
"""

Do NOT answer the task yet. Instead, list only:
1. The assumptions you would make if asked to perform this task
2. The memory or prior context you would lean on
3. Any facts you would treat as given (retrieved or computed)

${BLOCK_FORMAT}

Emit the blocks only — no task answer yet.`;
}

function composeTask(state) {
  if (hasRevocations(state)) {
    return composeRestart(state);
  }

  const task = state.originalTask || '(no task set)';
  const contextSpec = buildContextSpec(state);

  return `Perform the following task. Use the Context Spec below as binding constraints where provided.

## Task
"""
${task}
"""

## Context Spec
${contextSpec}

Answer the task fully, then append the blocks describing the assumptions and facts your answer rested on.

${BLOCK_FORMAT}`;
}

function composeRestart(state) {
  const task = state.originalTask || '(no task set)';
  const contextSpec = buildContextSpec(state);
  const revocations = buildRevocations(state);
  const alert = hasRevocations(state) ? `${buildRevocationAlert(state)}\n\n` : '';

  const revocationBlock = revocations
    ? `${revocations}

`
    : '';

  return `${alert}The user has CORRECTED the context after your previous answer. You must REGENERATE from scratch.

## Instructions (mandatory)
1. DISCARD your previous answer entirely — do not revise it in place.
2. Every item in ===REVOKED_BY_USER_DO_NOT_USE=== and every "DELETE" line below is FORBIDDEN — remove them from your reasoning.
3. If an assumption was revoked (unchecked), your new answer MUST NOT treat it as true. Change the answer accordingly.
4. If memory was overridden, use only the "USE INSTEAD" wording; never the "DELETE/IGNORE" wording.
5. Use ONLY the Corrected Context Spec as binding context. Ignore everything else from earlier in this conversation.
6. Do not perform fresh retrieval — treat listed facts as the frozen evidence pool.

## Original task
"""
${task}
"""

${revocationBlock}## Corrected Context Spec (authoritative — only these items apply)
${contextSpec}

Write a completely NEW answer to the task, then append fresh blocks describing only the assumptions and facts this new answer rested on.

${BLOCK_FORMAT}`;
}

/**
 * True when boards have unchecked items or other corrections — not just the edit flag.
 * @param {object} state
 */
export function needsRegeneratePrompt(state) {
  return Boolean(state.hasCorrectiveEdits || hasRevocations(state));
}

/**
 * Pick the right prompt automatically — user never chooses Task vs Restart.
 * @param {object} state
 */
export function composeSmartPrompt(state) {
  if (needsRegeneratePrompt(state)) {
    return composeRestart(state);
  }
  return composeTask(state);
}

/**
 * @param {'prime_assumptions' | 'task' | 'restart'} kind
 * @param {object} state - engine state with boards arrays
 */
export function composePrompt(kind, state) {
  switch (kind) {
    case 'prime_assumptions':
      return composePrimeAssumptions(state);
    case 'task':
      return composeTask(state);
    case 'restart':
      return composeRestart(state);
    default:
      throw new Error(`Unknown prompt kind: ${kind}`);
  }
}

export function restateMemory(userText) {
  return `User states: ${userText}. Treat as authoritative.`;
}
