const SECTION_MARKERS = {
  memory: '===MEMORY===',
  assumptions: '===ASSUMPTIONS===',
  facts: '===FACTS===',
  end: '===END===',
};

function extractSection(text, startMarker, endMarkers) {
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) return '';

  const contentStart = startIdx + startMarker.length;
  let endIdx = text.length;

  for (const marker of endMarkers) {
    const idx = text.indexOf(marker, contentStart);
    if (idx !== -1 && idx < endIdx) {
      endIdx = idx;
    }
  }

  return text.slice(contentStart, endIdx).trim();
}

function parseMemoryLines(section) {
  if (!section) return [];

  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function parseAssumptionLine(line) {
  const body = line.replace(/^-\s*/, '').trim();
  const match = body.match(/^assumption:\s*(.+?)\s*\|\s*reason:\s*(.+)$/i);
  if (!match) return null;

  return {
    statement: match[1].trim(),
    reason: match[2].trim(),
  };
}

function parseAssumptionLines(section) {
  if (!section) return [];

  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map(parseAssumptionLine)
    .filter(Boolean);
}

function parseFactLine(line) {
  const body = line.replace(/^-\s*/, '').trim();
  const typeMatch = body.match(/^type:\s*(retrieved|computed)\s*\|\s*content:\s*(.+)$/i);
  if (!typeMatch) return null;

  const type = typeMatch[1].toLowerCase();
  let remainder = typeMatch[2].trim();

  if (type === 'retrieved') {
    const sourceMatch = remainder.match(/^(.+?)\s*\|\s*source:\s*(.+?)\s*\|\s*date:\s*(.+)$/i);
    if (!sourceMatch) return null;

    return {
      type: 'retrieved',
      content: sourceMatch[1].trim(),
      sourceUrl: sourceMatch[2].trim(),
      sourceDate: sourceMatch[3].trim(),
    };
  }

  return {
    type: 'computed',
    content: remainder,
    sourceUrl: undefined,
    sourceDate: undefined,
  };
}

function parseFactLines(section) {
  if (!section) return [];

  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map(parseFactLine)
    .filter(Boolean);
}

/**
 * Parse machine-readable blocks from a chatbot reply.
 * @param {string} text
 * @returns {{ memory: string[], assumptions: { statement: string, reason: string }[], facts: object[] }}
 */
export function parseReplyBlocks(text) {
  if (!text || typeof text !== 'string') {
    return { memory: [], assumptions: [], facts: [] };
  }

  const memorySection = extractSection(text, SECTION_MARKERS.memory, [
    SECTION_MARKERS.assumptions,
    SECTION_MARKERS.facts,
    SECTION_MARKERS.end,
  ]);

  const assumptionsSection = extractSection(text, SECTION_MARKERS.assumptions, [
    SECTION_MARKERS.facts,
    SECTION_MARKERS.end,
  ]);

  const factsSection = extractSection(text, SECTION_MARKERS.facts, [SECTION_MARKERS.end]);

  return {
    memory: parseMemoryLines(memorySection),
    assumptions: parseAssumptionLines(assumptionsSection),
    facts: parseFactLines(factsSection),
  };
}

export function hasStructuredBlocks(text) {
  return (
    text.includes(SECTION_MARKERS.memory) ||
    text.includes(SECTION_MARKERS.assumptions) ||
    text.includes(SECTION_MARKERS.facts)
  );
}
