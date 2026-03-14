/**
 * Utilities for reconciling serialized selection markdown with the exact
 * markdown text stored in the document.
 */

export interface ResolvedSelectionMatch {
  selected: string;
  index: number;
}

export interface SelectionMatchContext {
  contextBefore?: string | null;
  contextAfter?: string | null;
}

function normalizeForMatching(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
}

function collapseParagraphBreaks(markdown: string): string {
  return normalizeForMatching(markdown).replace(/([^\n])\n\n[ \t]*(?=\S)/g, '$1 ');
}

function collapseInlineParagraphBreaks(markdown: string): string {
  return normalizeForMatching(markdown)
    .replace(/\s*\n\n\s*/g, ' ')
    .replace(/\s+([:;,.!?])/g, '$1')
    .replace(/ {2,}/g, ' ');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLinkAwarePattern(candidate: string): RegExp | null {
  const normalizedCandidate = collapseInlineParagraphBreaks(candidate);
  const linkPattern = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  let lastIndex = 0;
  let hasLink = false;
  let source = '';

  for (const match of normalizedCandidate.matchAll(linkPattern)) {
    if (match.index === undefined) {
      continue;
    }

    hasLink = true;
    const [fullMatch, label, href] = match;
    source += escapeRegExp(normalizedCandidate.slice(lastIndex, match.index));
    source += `\\[${escapeRegExp(label)}[^\\]]*\\]\\(${escapeRegExp(href)}\\)`;
    lastIndex = match.index + fullMatch.length;
  }

  if (!hasLink) {
    return null;
  }

  source += escapeRegExp(normalizedCandidate.slice(lastIndex));
  return new RegExp(source);
}

function buildCandidates(serializedSelection: string): string[] {
  const normalizedSpaces = serializedSelection.replace(/\u00a0/g, ' ');
  const collapsed = collapseParagraphBreaks(normalizedSpaces);
  const inlineCollapsed = collapseInlineParagraphBreaks(normalizedSpaces);

  return [...new Set([serializedSelection, normalizedSpaces, collapsed, inlineCollapsed])].filter(
    candidate => candidate.length > 0
  );
}

function commonSuffixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) {
    i += 1;
  }
  return i;
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i += 1;
  }
  return i;
}

function scoreMatchContext(
  fullMarkdown: string,
  index: number,
  matchLength: number,
  context?: SelectionMatchContext
): number {
  const normalizedContextBefore = normalizeForMatching(context?.contextBefore ?? '');
  const normalizedContextAfter = normalizeForMatching(context?.contextAfter ?? '');
  let score = matchLength;

  if (normalizedContextBefore) {
    const before = normalizeForMatching(
      fullMarkdown.slice(Math.max(0, index - normalizedContextBefore.length), index)
    );
    score += commonSuffixLength(before, normalizedContextBefore);
  }

  if (normalizedContextAfter) {
    const after = normalizeForMatching(
      fullMarkdown.slice(index + matchLength, index + matchLength + normalizedContextAfter.length)
    );
    score += commonPrefixLength(after, normalizedContextAfter);
  }

  return score;
}

/**
 * Try to find the exact markdown substring in the full document that matches
 * the serialized selection. Falls back to normalized variants when the
 * serializer introduces layout differences, such as splitting inline content
 * into separate paragraphs.
 */
export function resolveSelectionMatch(
  fullMarkdown: string,
  serializedSelection: string | null,
  context?: SelectionMatchContext
): ResolvedSelectionMatch | null {
  if (!serializedSelection) {
    return null;
  }

  let bestMatch: ResolvedSelectionMatch | null = null;
  let bestScore = -1;

  for (const candidate of buildCandidates(serializedSelection)) {
    let searchIndex = 0;
    while (true) {
      const index = fullMarkdown.indexOf(candidate, searchIndex);
      if (index === -1) {
        break;
      }

      const score = scoreMatchContext(fullMarkdown, index, candidate.length, context);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          selected: fullMarkdown.slice(index, index + candidate.length),
          index,
        };
      }
      searchIndex = index + 1;
    }

    const normalizedFullMarkdown = normalizeForMatching(fullMarkdown);
    searchIndex = 0;
    while (true) {
      const normalizedIndex = normalizedFullMarkdown.indexOf(candidate, searchIndex);
      if (normalizedIndex === -1) {
        break;
      }

      const score = scoreMatchContext(fullMarkdown, normalizedIndex, candidate.length, context);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          selected: fullMarkdown.slice(normalizedIndex, normalizedIndex + candidate.length),
          index: normalizedIndex,
        };
      }
      searchIndex = normalizedIndex + 1;
    }

    const linkAwarePattern = buildLinkAwarePattern(candidate);
    if (linkAwarePattern) {
      for (const regexMatch of normalizedFullMarkdown.matchAll(
        new RegExp(linkAwarePattern.source, `${linkAwarePattern.flags}g`)
      )) {
        if (regexMatch.index === undefined) {
          continue;
        }
        const score = scoreMatchContext(fullMarkdown, regexMatch.index, regexMatch[0].length, context);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            selected: fullMarkdown.slice(regexMatch.index, regexMatch.index + regexMatch[0].length),
            index: regexMatch.index,
          };
        }
      }
    }
  }

  return bestMatch;
}
