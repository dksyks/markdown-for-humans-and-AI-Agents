/**
 * Utilities for reconciling serialized selection markdown with the exact
 * markdown text stored in the document.
 */

export interface ResolvedSelectionMatch {
  selected: string;
  index: number;
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
    .replace(/ {2,}/g, ' ');
}

function buildCandidates(serializedSelection: string): string[] {
  const normalizedSpaces = serializedSelection.replace(/\u00a0/g, ' ');
  const collapsed = collapseParagraphBreaks(normalizedSpaces);
  const inlineCollapsed = collapseInlineParagraphBreaks(normalizedSpaces);

  return [...new Set([serializedSelection, normalizedSpaces, collapsed, inlineCollapsed])].filter(
    candidate => candidate.length > 0
  );
}

/**
 * Try to find the exact markdown substring in the full document that matches
 * the serialized selection. Falls back to normalized variants when the
 * serializer introduces layout differences, such as splitting inline content
 * into separate paragraphs.
 */
export function resolveSelectionMatch(
  fullMarkdown: string,
  serializedSelection: string | null
): ResolvedSelectionMatch | null {
  if (!serializedSelection) {
    return null;
  }

  for (const candidate of buildCandidates(serializedSelection)) {
    const index = fullMarkdown.indexOf(candidate);
    if (index !== -1) {
      return {
        selected: fullMarkdown.slice(index, index + candidate.length),
        index,
      };
    }

    const normalizedFullMarkdown = normalizeForMatching(fullMarkdown);
    const normalizedIndex = normalizedFullMarkdown.indexOf(candidate);
    if (normalizedIndex !== -1) {
      return {
        selected: fullMarkdown.slice(normalizedIndex, normalizedIndex + candidate.length),
        index: normalizedIndex,
      };
    }
  }

  return null;
}
