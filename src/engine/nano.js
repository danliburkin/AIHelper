import { parseReplyBlocks } from './parser.js';

export async function isNanoAvailable() {
  if (typeof LanguageModel === 'undefined') return false;

  try {
    const availability = await LanguageModel.availability();
    return availability === 'available';
  } catch {
    return false;
  }
}

async function runNano(prompt) {
  if (!(await isNanoAvailable())) return null;

  try {
    const session = await LanguageModel.create();
    const result = await session.prompt(prompt);
    await session.destroy?.();
    return typeof result === 'string' ? result.trim() : null;
  } catch {
    return null;
  }
}

/**
 * When strict parsing fails, optionally ask Nano to normalize into block format.
 * @param {string} text
 */
export async function parseWithNanoFallback(text) {
  const strict = parseReplyBlocks(text);
  const hasContent =
    strict.memory.length > 0 ||
    strict.assumptions.length > 0 ||
    strict.facts.length > 0;

  if (hasContent) return strict;

  const normalized = await runNano(
    `Convert the following chatbot reply into this exact block format. Preserve meaning. Output only the blocks:

===MEMORY===
- <bullet>
===ASSUMPTIONS===
- assumption: <text> | reason: <text>
===FACTS===
- type: retrieved | content: <text> | source: <url> | date: <date>
- type: computed | content: <text>
===END===

Reply to convert:
"""
${text}
"""`,
  );

  if (!normalized) return strict;
  return parseReplyBlocks(normalized);
}

/**
 * Optional Nano polish for composed prompts; returns fallback when Nano unavailable.
 * @param {string} nanoPrompt
 * @param {string} fallback
 */
export async function polishPromptWithNano(nanoPrompt, fallback) {
  const polished = await runNano(nanoPrompt);
  return polished || fallback;
}
