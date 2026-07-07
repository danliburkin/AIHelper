import {
  isValidStatus,
  isValidConfidence,
  isValidProvenance,
  isValidIntensity,
} from './records.js';

const SECTION_MARKERS = {
  memory: '===MEMORY===',
  assumptions: '===ASSUMPTIONS===',
  facts: '===FACTS===',
  ambient: '===AMBIENT===',
  propose: '===PROPOSE===',
  end: '===END===',
};

const ALL_END_MARKERS = [
  SECTION_MARKERS.assumptions,
  SECTION_MARKERS.facts,
  SECTION_MARKERS.ambient,
  SECTION_MARKERS.propose,
  SECTION_MARKERS.end,
];

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

/**
 * Pull optional trailing `| status: ... | confidence: ... | provenance: ... | tags: t1,t2`
 * fields off a body string. Returns { rest, meta } where `rest` has those segments removed
 * so legacy parsers can run against it unchanged.
 *
 * The trailing fields are matched non-greedily, in any order, but only when prefixed by ` | `
 * so URLs/content containing `:` are not mis-parsed.
 */
export function extractTrailingMeta(body) {
  const meta = {};
  let rest = body;
  const keys = ['status', 'confidence', 'provenance', 'tags'];
  // Iterate until no recognised trailing field is found.
  // Order-independent: each loop strips the rightmost match.
  // Anchored to the end with `$` so middle-of-content tokens are not stripped.
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of keys) {
      const re = new RegExp(`\\s*\\|\\s*${key}\\s*:\\s*([^|]+?)\\s*$`, 'i');
      const m = rest.match(re);
      if (m) {
        const raw = m[1].trim();
        if (key === 'tags') {
          meta.tags = raw
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        } else {
          const lower = raw.toLowerCase();
          if (key === 'status' && isValidStatus(lower)) meta.status = lower;
          else if (key === 'confidence' && isValidConfidence(lower)) meta.confidence = lower;
          else if (key === 'provenance' && isValidProvenance(lower)) meta.provenance = lower;
        }
        rest = rest.slice(0, m.index).trimEnd();
        changed = true;
      }
    }
  }
  return { rest, meta };
}

function parseMemoryLines(section) {
  if (!section) return [];

  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const body = line.slice(2).trim();
      const { rest, meta } = extractTrailingMeta(body);
      const text = rest.trim();
      if (!text) return null;
      return { text, meta };
    })
    .filter(Boolean);
}

function parseAssumptionLine(line) {
  const body = line.replace(/^-\s*/, '').trim();
  const { rest, meta } = extractTrailingMeta(body);
  const match = rest.match(/^assumption:\s*(.+?)\s*\|\s*reason:\s*(.+)$/i);
  if (!match) return null;

  return {
    statement: match[1].trim(),
    reason: match[2].trim(),
    meta,
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
  const { rest, meta } = extractTrailingMeta(body);

  const typeMatch = rest.match(/^type:\s*(retrieved|computed)\s*\|\s*content:\s*(.+)$/i);
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
      meta,
    };
  }

  return {
    type: 'computed',
    content: remainder,
    sourceUrl: undefined,
    sourceDate: undefined,
    meta,
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

function parseAmbientLine(line) {
  const body = line.replace(/^-\s*/, '').trim();
  const { rest, meta } = extractTrailingMeta(body);

  // Allow either `text: <...>` or a bare bullet; `intensity: <val>` is optional but recommended.
  let text = '';
  let intensity = 'medium';

  const explicit = rest.match(/^text:\s*(.+?)(?:\s*\|\s*intensity:\s*([a-z]+))?\s*$/i);
  if (explicit) {
    text = explicit[1].trim();
    if (explicit[2] && isValidIntensity(explicit[2].toLowerCase())) {
      intensity = explicit[2].toLowerCase();
    }
  } else {
    const intensityMatch = rest.match(/^(.+?)\s*\|\s*intensity:\s*([a-z]+)\s*$/i);
    if (intensityMatch) {
      text = intensityMatch[1].trim();
      const candidate = intensityMatch[2].toLowerCase();
      if (isValidIntensity(candidate)) intensity = candidate;
    } else {
      text = rest;
    }
  }

  if (!text) return null;
  return { text, intensity, tags: Array.isArray(meta.tags) ? meta.tags : [] };
}

function parseAmbientLines(section) {
  if (!section) return [];

  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map(parseAmbientLine)
    .filter(Boolean);
}

/**
 * Parse machine-readable blocks from a chatbot reply.
 * @param {string} text
 * @returns {{ memory: Array, assumptions: Array, facts: Array, ambient: Array }}
 */
export function parseReplyBlocks(text) {
  if (!text || typeof text !== 'string') {
    return { memory: [], assumptions: [], facts: [], ambient: [] };
  }

  const memorySection = extractSection(text, SECTION_MARKERS.memory, ALL_END_MARKERS);
  const assumptionsSection = extractSection(text, SECTION_MARKERS.assumptions, [
    SECTION_MARKERS.facts,
    SECTION_MARKERS.ambient,
    SECTION_MARKERS.propose,
    SECTION_MARKERS.end,
  ]);
  const factsSection = extractSection(text, SECTION_MARKERS.facts, [
    SECTION_MARKERS.ambient,
    SECTION_MARKERS.propose,
    SECTION_MARKERS.end,
  ]);
  const ambientSection = extractSection(text, SECTION_MARKERS.ambient, [
    SECTION_MARKERS.propose,
    SECTION_MARKERS.end,
  ]);

  return {
    memory: parseMemoryLines(memorySection),
    assumptions: parseAssumptionLines(assumptionsSection),
    facts: parseFactLines(factsSection),
    ambient: parseAmbientLines(ambientSection),
  };
}

export function hasStructuredBlocks(text) {
  return (
    text.includes(SECTION_MARKERS.memory) ||
    text.includes(SECTION_MARKERS.assumptions) ||
    text.includes(SECTION_MARKERS.facts) ||
    text.includes(SECTION_MARKERS.ambient)
  );
}
