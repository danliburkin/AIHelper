import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine.js';
import {
  parseProposals,
  annotateImpact,
  HIGH_IMPACT_TAGS,
} from '../src/engine/proposals.js';
import { addedCount, isSuccessfulIngest, shouldWarnRawQuestion } from '../src/ui/transport.js';

const REPLY_BASE = `Some answer.

===MEMORY===
- I will quit my job by end of Q3 | confidence: medium | tags: career
===FACTS===
- type: computed | content: 7-year tenure | confidence: medium | tags: career
===ASSUMPTIONS===
- assumption: Pay is not the driver | reason: not mentioned | status: open | confidence: low | tags: career
===END===`;

function withProposals(extra) {
  return `${REPLY_BASE.replace('===END===', `===PROPOSE===\n${extra}\n===END===`)}`;
}

describe('R4 parseProposals', () => {
  it('parses mark / supersede / tag / new shapes', () => {
    const text = withProposals(
      `- mark abc done | rationale: completed
- supersede old1 with new1 | rationale: replaced
- tag abc career, planning | rationale: better discoverability
- new memory prop-1: I committed to leaving by Q3 | tags: career, decision | rationale: explicit user commitment
- not a real proposal line`,
    );
    const proposals = parseProposals(text);
    expect(proposals).toHaveLength(4);
    expect(proposals[0]).toMatchObject({
      type: 'mark_status',
      target_id: 'abc',
      status: 'done',
      rationale: 'completed',
    });
    expect(proposals[1]).toMatchObject({
      type: 'supersede',
      target_id: 'old1',
      new_id: 'new1',
    });
    expect(proposals[2]).toMatchObject({
      type: 'tag',
      target_id: 'abc',
      tags: ['career', 'planning'],
    });
    expect(proposals[3]).toMatchObject({
      type: 'new',
      board: 'memory',
      local_id: 'prop-1',
      text: 'I committed to leaving by Q3',
      tags: ['career', 'decision'],
    });
  });

  it('returns [] when no PROPOSE block', () => {
    expect(parseProposals(REPLY_BASE)).toEqual([]);
  });

  it('rejects invalid statuses', () => {
    const text = withProposals(`- mark x bogus | rationale: nope`);
    expect(parseProposals(text)).toEqual([]);
  });
});

describe('R4 — high-impact annotation', () => {
  it('flags proposals on records with health/financial tags', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(`===MEMORY===
- Need to schedule cardiology follow-up | tags: health
===END===`);
    const memId = engine.getBoards().memory[0].id;
    const text = `===PROPOSE===
- mark ${memId} done | rationale: appointment booked
===END===`;
    const proposals = parseProposals(text);
    const state = { memory: engine.getBoards().memory, facts: [], assumptions: [] };
    annotateImpact(proposals, state);
    expect(proposals[0].requiresIndividualConfirm).toBe(true);
  });

  it('flags new proposals if the new tags themselves are high-impact', () => {
    const proposals = parseProposals(
      `===PROPOSE===\n- new memory: Started new statin | tags: medical, health | rationale: user reported\n===END===`,
    );
    annotateImpact(proposals, { memory: [], facts: [], assumptions: [] });
    expect(proposals[0].requiresIndividualConfirm).toBe(true);
  });

  it('does NOT flag low-stakes proposals', () => {
    const proposals = parseProposals(
      `===PROPOSE===\n- new memory: Likes oat milk | tags: preferences | rationale: stated\n===END===`,
    );
    annotateImpact(proposals, { memory: [], facts: [], assumptions: [] });
    expect(proposals[0].requiresIndividualConfirm).toBe(false);
  });

  it('flags marking a goal/decision done', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(`===MEMORY===
- Long-term goal: ship product\n===END===`);
    const memId = engine.getBoards().memory[0].id;
    // Manually elevate kind to goal so the rule fires.
    const state = engine.exportSnapshot();
    state.memory[0].kind = 'goal';
    const text = `===PROPOSE===\n- mark ${memId} done | rationale: launched yesterday\n===END===`;
    const proposals = parseProposals(text);
    annotateImpact(proposals, state);
    expect(proposals[0].requiresIndividualConfirm).toBe(true);
  });

  it('exposes the HIGH_IMPACT_TAGS list', () => {
    expect(HIGH_IMPACT_TAGS).toContain('health');
    expect(HIGH_IMPACT_TAGS).toContain('financial');
  });
});

describe('R4 — engine queue and individual confirm', () => {
  it('ingestion does NOT auto-apply proposals; queue is non-empty', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(REPLY_BASE);
    const memId = engine.getBoards().memory[0].id;
    const reply = `===MEMORY===
===PROPOSE===
- mark ${memId} done | rationale: user said yes
===END===`;
    const result = await engine.ingestReplyWithFallback(reply);
    expect(result.proposals).toBe(1);
    // The record was NOT mutated.
    expect(engine.getBoards().memory[0].status).toBe('active');
    // The queue holds it.
    const pending = engine.getPendingProposals();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe('mark_status');
  });

  it('acceptProposal applies the change, sets provenance, bumps updated_at, and removes from queue', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(REPLY_BASE);
    const memId = engine.getBoards().memory[0].id;
    const before = engine.getBoards().memory[0].updated_at;
    await new Promise((r) => setTimeout(r, 2));
    await engine.ingestReplyWithFallback(`===MEMORY===
===PROPOSE===
- mark ${memId} done | rationale: user said yes
===END===`);

    const proposalId = engine.getPendingProposals()[0].id;
    const result = engine.acceptProposal(proposalId);
    expect(result.applied).toBe(true);

    const after = engine.getBoards().memory[0];
    expect(after.status).toBe('done');
    expect(after.provenance).toBe('model_proposed_user_confirmed');
    expect(after.updated_at >= before).toBe(true);
    expect(engine.getPendingProposals()).toHaveLength(0);
  });

  it('rejectProposal discards without mutating record', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(REPLY_BASE);
    const memId = engine.getBoards().memory[0].id;
    await engine.ingestReplyWithFallback(`===MEMORY===
===PROPOSE===
- mark ${memId} done | rationale: x
===END===`);

    const proposalId = engine.getPendingProposals()[0].id;
    expect(engine.rejectProposal(proposalId)).toBe(true);
    expect(engine.getPendingProposals()).toHaveLength(0);
    expect(engine.getBoards().memory[0].status).toBe('active');
  });

  it('acceptAllSafeProposals does NOT sweep high-impact items', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(`===MEMORY===
- Diet preference | tags: preferences
- Cholesterol med change | tags: health, medical
===END===`);
    const [pref, health] = engine.getBoards().memory;

    await engine.ingestReplyWithFallback(`===MEMORY===
===PROPOSE===
- mark ${pref.id} done | rationale: dropped that diet
- mark ${health.id} done | rationale: doc said stop
===END===`);

    const before = engine.getPendingProposals();
    expect(before.find((p) => p.target_id === health.id).requiresIndividualConfirm).toBe(true);

    engine.acceptAllSafeProposals();

    const after = engine.getBoards().memory;
    const prefAfter = after.find((m) => m.id === pref.id);
    const healthAfter = after.find((m) => m.id === health.id);
    expect(prefAfter.status).toBe('done'); // safe one applied
    expect(healthAfter.status).toBe('active'); // high-impact NOT applied
    // High-impact item must still be in the queue.
    const stillPending = engine.getPendingProposals();
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0].target_id).toBe(health.id);
  });

  it('rejectAllProposals empties the queue', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(REPLY_BASE);
    const memId = engine.getBoards().memory[0].id;
    await engine.ingestReplyWithFallback(`===MEMORY===
===PROPOSE===
- mark ${memId} done | rationale: x
- tag ${memId} planning, q3 | rationale: y
===END===`);
    expect(engine.getPendingProposals().length).toBe(2);
    expect(engine.rejectAllProposals()).toBe(2);
    expect(engine.getPendingProposals()).toHaveLength(0);
  });
});

describe('R4 — supersede applies bidirectional links and stale provenance', () => {
  it('supersede mutation creates updated_by + supersedes links and marks the old one stale', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(`===MEMORY===
- old fact
- new fact
===END===`);
    const [oldItem, newItem] = engine.getBoards().memory;
    await engine.ingestReplyWithFallback(`===MEMORY===
===PROPOSE===
- supersede ${oldItem.id} with ${newItem.id} | rationale: replaces
===END===`);
    const result = engine.acceptProposal(engine.getPendingProposals()[0].id);
    expect(result.applied).toBe(true);

    const after = engine.getBoards().memory;
    const oldAfter = after.find((m) => m.id === oldItem.id);
    const newAfter = after.find((m) => m.id === newItem.id);
    expect(oldAfter.provenance).toBe('stale_superseded');
    expect(oldAfter.status).toBe('dropped');
    expect(oldAfter.links).toEqual(
      expect.arrayContaining([expect.objectContaining({ rel: 'updated_by', target_id: newItem.id })]),
    );
    expect(newAfter.links).toEqual(
      expect.arrayContaining([expect.objectContaining({ rel: 'supersedes', target_id: oldItem.id })]),
    );
  });

  it('new-then-supersede resolves a prop-id across individual accepts', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(`===MEMORY===\n- old plan\n===END===`);
    const oldItem = engine.getBoards().memory[0];

    await engine.ingestReplyWithFallback(`===PROPOSE===
- new memory prop-1: better plan | tags: planning | rationale: replaces old plan
- supersede ${oldItem.id} with prop-1 | rationale: newer plan
===END===`);

    const [newProposal, supersedeProposal] = engine.getPendingProposals();
    expect(engine.acceptProposal(newProposal.id).applied).toBe(true);
    const result = engine.acceptProposal(supersedeProposal.id);
    expect(result.applied).toBe(true);

    const boards = engine.getBoards().memory;
    const oldAfter = boards.find((m) => m.id === oldItem.id);
    const newAfter = boards.find((m) => m.committedText === 'better plan');
    expect(oldAfter.status).toBe('dropped');
    expect(newAfter.links).toEqual(
      expect.arrayContaining([expect.objectContaining({ rel: 'supersedes', target_id: oldItem.id })]),
    );
  });

  it('supersede with an unaccepted prop-id fails clearly', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(`===MEMORY===\n- old plan\n===END===`);
    const oldItem = engine.getBoards().memory[0];

    await engine.ingestReplyWithFallback(`===PROPOSE===
- new memory prop-1: better plan | tags: planning | rationale: replaces old plan
- supersede ${oldItem.id} with prop-1 | rationale: newer plan
===END===`);

    const supersedeProposal = engine.getPendingProposals().find((p) => p.type === 'supersede');
    const result = engine.acceptProposal(supersedeProposal.id);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain(`supersede missing target(s): ${oldItem.id} / prop-1`);
  });
});

describe('R4 — tag proposal updates tags and timestamps', () => {
  it('tag proposal merges into existing tags and sets confirmed provenance', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(`===MEMORY===
- topic | tags: a
===END===`);
    const memId = engine.getBoards().memory[0].id;
    await engine.ingestReplyWithFallback(`===PROPOSE===
- tag ${memId} b, c | rationale: discoverability
===END===`);
    engine.acceptProposal(engine.getPendingProposals()[0].id);
    const after = engine.getBoards().memory[0];
    expect(after.tags.sort()).toEqual(['a', 'b', 'c']);
    expect(after.provenance).toBe('model_proposed_user_confirmed');
  });
});

describe('R4 — new proposal lands in the right board with confirmed provenance', () => {
  it('new memory creates a memory row with proper fields', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(`===PROPOSE===
- new memory: User committed to leaving by Q3 | tags: career, decision | rationale: explicit
===END===`);
    expect(engine.getPendingProposals()).toHaveLength(1);
    engine.acceptProposal(engine.getPendingProposals()[0].id);
    const m = engine.getBoards().memory.at(-1);
    expect(m.committedText).toBe('User committed to leaving by Q3');
    expect(m.provenance).toBe('model_proposed_user_confirmed');
    expect(m.tags.sort()).toEqual(['career', 'decision']);
  });

  it('new facts lands a computed fact', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(`===PROPOSE===
- new facts: User has 7 years tenure | tags: career | rationale: stated
===END===`);
    engine.acceptProposal(engine.getPendingProposals()[0].id);
    const f = engine.getBoards().facts.at(-1);
    expect(f.content).toBe('User has 7 years tenure');
    expect(f.type).toBe('computed');
  });
});

describe('R4 — proposals survive nothing if there is no PROPOSE block', () => {
  it('plain ingest produces 0 proposals', async () => {
    const engine = createEngine();
    const result = await engine.ingestReplyWithFallback(REPLY_BASE);
    expect(result.proposals).toBe(0);
    expect(engine.getPendingProposals()).toHaveLength(0);
  });
});

describe('R4 — material-only rule is in the prompt', async () => {
  it('decorated prompt instructs the model with material-only rule and PROPOSE shapes', async () => {
    const engine = createEngine();
    engine.setOriginalTask('career topic');
    const prompt = engine.previewSmartPrompt();
    expect(prompt).toContain('===PROPOSE===');
    expect(prompt).toContain('MATERIAL');
    expect(prompt).toContain('rationale:');
    expect(prompt).toContain('mark <existing_id> <new_status>');
    expect(prompt).toContain('supersede <old_existing_id> with <existing_id_or_prop_id>');
    expect(prompt).toContain('new <board> [prop-<n>]:');
    expect(prompt).toContain('tag <existing_id>');
  });
});

describe('transport ingest result helpers', () => {
  it('treats PROPOSE-only replies as successful and dedupes the same text', async () => {
    const engine = createEngine();
    const text = `===PROPOSE===\n- new memory prop-1: likes short meetings | tags: work | rationale: stated\n===END===`;
    let lastIngestedText = '';

    for (let i = 0; i < 2; i += 1) {
      if (text === lastIngestedText) continue;
      const result = await engine.ingestReplyWithFallback(text);
      expect(isSuccessfulIngest(result)).toBe(true);
      expect(shouldWarnRawQuestion(result)).toBe(false);
      if (addedCount(result) > 0) lastIngestedText = text;
    }

    expect(engine.getPendingProposals()).toHaveLength(1);
  });

  it('treats ambient-only replies as successful', async () => {
    const engine = createEngine();
    const result = await engine.ingestReplyWithFallback(
      `===AMBIENT===\n- text: feeling rushed | intensity: high\n===END===`,
    );
    expect(result.ambient).toBe(1);
    expect(isSuccessfulIngest(result)).toBe(true);
    expect(shouldWarnRawQuestion(result)).toBe(false);
  });
});
