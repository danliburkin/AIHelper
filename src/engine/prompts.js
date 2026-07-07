import { buildContextSpec, buildRevocations, hasRevocations, buildRevocationAlert } from './contextSpec.js';
import { buildBriefing } from './briefing.js';

const BLOCK_FORMAT = `Use this exact block format at the end of your reply.

For every stateful item (memory / facts / assumptions) you MAY append, in any order, these optional trailing fields after the existing payload, each prefixed with " | ":
  | status: <open | active | done | dropped | revived>
  | confidence: <high | medium | low>
  | provenance: <user_asserted | model_proposed_user_confirmed | inferred_from_tool | stale_superseded>
  | tags: <comma-separated topic tags>

If a field is omitted the app fills a safe default; never invent a value you cannot defend.

Use the AMBIENT block ONLY for soft, non-lifecycle context (mood, tone, standing constraints — e.g. "burnt out by micromanaging boss"). Ambient items have NO status; they carry an intensity instead. Do not collapse a mood into a fact.

If — AND ONLY IF — this turn produced MATERIAL changes to the longitudinal record (a goal completing, a plan being abandoned or superseded, a new commitment), append a ===PROPOSE=== block. Do NOT propose trivial rephrasings or restate things already true. A 20-minute session should yield a few proposals, not fifteen. Every line MUST end with " | rationale: <one short reason>" so the user knows why you proposed it. The user, not you, decides whether to commit each proposal.

Proposal shapes:
  - mark <existing_id> <new_status> | rationale: <reason>
  - supersede <old_existing_id> with <new_existing_id> | rationale: <reason>
  - new <board> [<prop-N>]: <text> | tags: <t1,t2> | rationale: <reason>
  - tag <existing_id> <t1,t2,...> | rationale: <reason>
  where <board> ∈ memory | facts | assumptions and <new_status> ∈ active | open | done | dropped | revived.
  Use the ids exactly as they appear in the Briefing's "id=<...>" tokens.
  Optional <prop-N> on a new line (e.g. prop-1) may be referenced by sibling proposals in the same batch; it resolves only after that new proposal is accepted.

===MEMORY===
- <bullet> [ | status: ... | confidence: ... | provenance: ... | tags: ... ]
===ASSUMPTIONS===
- assumption: <text> | reason: <text> [ | status: ... | confidence: ... | provenance: ... | tags: ... ]
===FACTS===
- type: retrieved | content: <text> | source: <url> | date: <date> [ | status: ... | confidence: ... | provenance: ... | tags: ... ]
- type: computed | content: <text> [ | status: ... | confidence: ... | provenance: ... | tags: ... ]
===AMBIENT===
- text: <ambient note> | intensity: <low | medium | high> [ | tags: ... ]
===PROPOSE===
- mark <id> done | rationale: <reason>
- new memory prop-1: <text> | tags: <t1,t2> | rationale: <reason>
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
  const briefing = buildBriefing(state, {
    questionText: task,
    lastActivityAt: state.lastActivityAt,
  });

  return `${briefing.text}

Perform the following task. Use the briefing above as binding context.

## Task
"""
${task}
"""

Answer the task fully, then append the blocks describing the assumptions and facts your answer rested on.

${BLOCK_FORMAT}`;
}

function composeRestart(state) {
  const task = state.originalTask || '(no task set)';
  const briefing = buildBriefing(state, {
    questionText: task,
    lastActivityAt: state.lastActivityAt,
  });
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
5. Use ONLY the Briefing below as binding context. Ignore everything else from earlier in this conversation.
6. Do not perform fresh retrieval — treat listed facts as the frozen evidence pool.

## Original task
"""
${task}
"""

${revocationBlock}${briefing.text}

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
