import type { Attribution, ParsedFrontmatter } from '../types/wiki.ts';

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseMapBody(text: string): Record<string, string> {
  const trimmed = text.trim();
  const map: Record<string, string> = {};
  const isInline = trimmed.startsWith('{');
  const body = isInline ? trimmed.replace(/^\{/, '').replace(/\}$/, '') : trimmed;
  for (const part of isInline ? body.split(',') : [body]) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    map[part.slice(0, idx).trim()] = stripQuotes(part.slice(idx + 1));
  }
  return map;
}

export function toAttribution(map: Record<string, string> | null): Attribution | undefined {
  if (!map || !map.by) return undefined;
  const attribution: Attribution = { by: map.by, at: map.at ?? '' };
  if (map.commit) attribution.commit = map.commit;
  return attribution;
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  let normalized = markdown;
  if (normalized.startsWith('\uFEFF')) {
    normalized = normalized.slice(1);
  }
  normalized = normalized.replace(/\r\n/g, '\n');

  const lines = normalized.split('\n');
  if (lines.length === 0 || lines[0] !== '---') {
    return {
      fields: {},
      sources: [],
      verified: [],
      hasFrontmatter: false,
      bodyOffsetLine: 0,
      body: normalized,
    };
  }

  const end = lines.indexOf('---', 1);
  if (end === -1) {
    return {
      fields: {},
      sources: [],
      verified: [],
      hasFrontmatter: false,
      bodyOffsetLine: 0,
      body: normalized,
    };
  }

  const fields: Record<string, string> = {};
  const sources: string[] = [];
  const verifiedMaps: Record<string, string>[] = [];
  let generatedMap: Record<string, string> | null = null;
  let currentKey = '';

  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const itemMatch = line.match(/^\s*-\s+(.*)$/);
    if (itemMatch && currentKey === 'sources') {
      sources.push(stripQuotes(itemMatch[1].trim()));
      continue;
    }
    if (itemMatch && currentKey === 'verified') {
      verifiedMaps.push(parseMapBody(itemMatch[1]));
      continue;
    }
    const continuation = line.match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (continuation && currentKey === 'verified' && verifiedMaps.length > 0) {
      verifiedMaps[verifiedMaps.length - 1][continuation[1]] = stripQuotes(continuation[2]);
      continue;
    }

    const scalarMatch = line.match(/^([a-zA-Z0-9_-]+):(?:\s*(.*))?$/);
    if (scalarMatch) {
      const key = scalarMatch[1];
      const rawVal = (scalarMatch[2] || '').trim();
      currentKey = key;
      if (key === 'sources') continue;
      if (key === 'verified') {
        if (rawVal.startsWith('[')) {
          for (const flowMap of rawVal.match(/\{[^}]*\}/g) ?? []) verifiedMaps.push(parseMapBody(flowMap));
        } else if (rawVal.startsWith('{')) {
          verifiedMaps.push(parseMapBody(rawVal));
        }
      } else if (key === 'generated') {
        if (rawVal.startsWith('{')) generatedMap = parseMapBody(rawVal);
      } else {
        fields[key] = stripQuotes(rawVal);
      }
    }
  }

  const body = lines.slice(end + 1).join('\n');

  return {
    fields,
    sources,
    generated: toAttribution(generatedMap),
    verified: verifiedMaps.map(toAttribution).filter((a): a is Attribution => a !== undefined),
    hasFrontmatter: true,
    bodyOffsetLine: end + 1,
    body,
  };
}

export function updateFrontmatterFields(
  markdown: string,
  updates: Record<string, string>,
  newSources?: string[]
): string {
  const hasBom = markdown.startsWith('\uFEFF');
  let normalized = hasBom ? markdown.slice(1) : markdown;
  normalized = normalized.replace(/\r\n/g, '\n');

  const parsed = parseFrontmatter(normalized);

  if (!parsed.hasFrontmatter) {
    const headerLines: string[] = ['---'];
    for (const [k, v] of Object.entries(updates)) {
      headerLines.push(`${k}: ${v}`);
    }
    if (newSources && newSources.length > 0) {
      headerLines.push('sources:');
      for (const s of newSources) {
        headerLines.push(`  - ${s}`);
      }
    }
    headerLines.push('---');
    headerLines.push('');
    const result = headerLines.join('\n') + (normalized.startsWith('\n') ? normalized.slice(1) : normalized);
    return (hasBom ? '\uFEFF' : '') + result;
  }

  const lines = normalized.split('\n');
  const end = lines.indexOf('---', 1);

  const updatedFrontmatterLines: string[] = ['---'];
  const remainingUpdates = { ...updates };
  let hasSourcesKey = false;
  let skippingOldSources = false;

  for (let i = 1; i < end; i++) {
    const line = lines[i];

    if (skippingOldSources) {
      if (/^\s*-\s+/.test(line)) {
        continue;
      }
      skippingOldSources = false;
    }

    const scalarMatch = line.match(/^([a-zA-Z0-9_-]+):(?:\s*(.*))?$/);
    if (scalarMatch) {
      const key = scalarMatch[1];
      if (key === 'sources') {
        hasSourcesKey = true;
        if (newSources !== undefined) {
          updatedFrontmatterLines.push('sources:');
          for (const s of newSources) {
            updatedFrontmatterLines.push(`  - ${s}`);
          }
          skippingOldSources = true;
        } else {
          updatedFrontmatterLines.push(line);
        }
        continue;
      }

      if (key in remainingUpdates) {
        updatedFrontmatterLines.push(`${key}: ${remainingUpdates[key]}`);
        delete remainingUpdates[key];
        continue;
      }

      updatedFrontmatterLines.push(line);
      continue;
    }

    updatedFrontmatterLines.push(line);
  }

  if (newSources !== undefined && !hasSourcesKey) {
    updatedFrontmatterLines.push('sources:');
    for (const s of newSources) {
      updatedFrontmatterLines.push(`  - ${s}`);
    }
  }

  for (const [k, v] of Object.entries(remainingUpdates)) {
    updatedFrontmatterLines.push(`${k}: ${v}`);
  }

  updatedFrontmatterLines.push('---');

  const body = lines.slice(end + 1).join('\n');
  const result = updatedFrontmatterLines.join('\n') + '\n' + body;
  return (hasBom ? '\uFEFF' : '') + result;
}

function removeFencedCodeBlocks(lines: string[]): string[] {
  const result: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of lines) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (inFence) {
      if (match && match[1][0] === fenceChar && match[1].length >= fenceLen && !match[2].trim()) {
        inFence = false;
      }
      result.push('');
    } else if (match) {
      inFence = true;
      fenceChar = match[1][0];
      fenceLen = match[1].length;
      result.push('');
    } else {
      result.push(line);
    }
  }
  return result;
}

function cleanDestination(dest: string): string | null {
  let cleaned = dest.trim();
  if (cleaned.startsWith('<') && cleaned.endsWith('>')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  const hashIdx = cleaned.indexOf('#');
  if (hashIdx !== -1) {
    cleaned = cleaned.slice(0, hashIdx);
  }
  if (!cleaned) return null;
  // Ignore protocol-relative URLs and absolute URLs with schemes
  if (cleaned.startsWith('//')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned)) return null;
  return cleaned;
}

function extractInlineDestinations(line: string): string[] {
  const destinations: string[] = [];
  const linkRegex = /!?\[[^\]]*\]\(/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(line)) !== null) {
    let pos = linkRegex.lastIndex;
    while (pos < line.length && /\s/.test(line[pos])) {
      pos++;
    }
    const angle = pos < line.length && line[pos] === '<';
    if (angle) {
      pos++;
    }
    const value: string[] = [];
    let depth = 0;
    while (pos < line.length) {
      const char = line[pos];
      if (char === '\\' && pos + 1 < line.length) {
        value.push(line[pos + 1]);
        pos += 2;
        continue;
      }
      if (angle) {
        if (char === '>') break;
      } else if (/\s/.test(char) || (char === ')' && depth === 0)) {
        break;
      } else if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      }
      value.push(char);
      pos++;
    }

    if (pos >= line.length || depth !== 0 || (angle && line[pos] !== '>')) {
      continue;
    }
    if (angle) {
      pos++;
    }
    const end = pos;
    while (pos < line.length && /\s/.test(line[pos])) {
      pos++;
    }
    if (pos > end && pos < line.length && ['"', "'", '('].includes(line[pos])) {
      const closing = line[pos] === '(' ? ')' : line[pos];
      pos++;
      while (pos < line.length && line[pos] !== closing) {
        if (line[pos] === '\\' && pos + 1 < line.length) {
          pos += 2;
        } else {
          pos += 1;
        }
      }
      if (pos >= line.length) {
        continue;
      }
      pos++;
      while (pos < line.length && /\s/.test(line[pos])) {
        pos++;
      }
    }
    if (pos < line.length && line[pos] === ')') {
      destinations.push(value.join(''));
      linkRegex.lastIndex = pos + 1;
    }
  }

  return destinations;
}

export function extractMarkdownLinks(markdownBody: string): string[] {
  const lines = markdownBody.replace(/\r\n/g, '\n').split('\n');
  const unfencedLines = removeFencedCodeBlocks(lines);
  const links: string[] = [];

  for (let line of unfencedLines) {
    if (!line.trim()) continue;
    // Strip inline code spans
    line = line.replace(/(`+).*?\1/g, '');

    // Check reference link definition: e.g. [ref]: dest
    const refMatch = line.match(/^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/);
    if (refMatch) {
      const dest = cleanDestination(refMatch[1]);
      if (dest) {
        links.push(dest);
      }
      continue;
    }

    // Extract inline destinations
    const inlineDests = extractInlineDestinations(line);
    for (const rawDest of inlineDests) {
      const dest = cleanDestination(rawDest);
      if (dest) {
        links.push(dest);
      }
    }
  }

  return links;
}
