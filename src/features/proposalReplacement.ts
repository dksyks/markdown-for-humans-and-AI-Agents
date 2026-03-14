export interface ProposalReplacementInput {
  original: string;
  replacement: string;
  context_before: string | null;
  context_after: string | null;
}

export interface ProposalMatch {
  index: number;
  matchedText: string;
}

export interface AppliedProposalReplacement extends ProposalMatch {
  newContent: string;
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
  const normalized = normalizeForMatching(serializedSelection);
  const collapsed = collapseParagraphBreaks(serializedSelection);
  const inlineCollapsed = collapseInlineParagraphBreaks(serializedSelection);

  return [...new Set([serializedSelection, normalized, collapsed, inlineCollapsed])].filter(
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

function mapNormalizedIndexToOriginal(markdown: string, normalizedIndex: number): number {
  if (normalizedIndex <= 0) {
    return 0;
  }

  let originalIndex = 0;
  let seenNormalizedChars = 0;

  while (originalIndex < markdown.length && seenNormalizedChars < normalizedIndex) {
    if (markdown[originalIndex] !== '\r') {
      seenNormalizedChars += 1;
    }
    originalIndex += 1;
  }

  return originalIndex;
}

export function findProposalMatch(
  fullMarkdown: string,
  proposal: ProposalReplacementInput
): ProposalMatch | null {
  const normalizedFullMarkdown = normalizeForMatching(fullMarkdown);
  const normalizedContextBefore = proposal.context_before
    ? normalizeForMatching(proposal.context_before)
    : null;
  const normalizedContextAfter = proposal.context_after
    ? normalizeForMatching(proposal.context_after)
    : null;

  let bestMatch: (ProposalMatch & { score: number }) | null = null;

  for (const candidate of buildCandidates(proposal.original)) {
    for (const searchContent of [fullMarkdown, normalizedFullMarkdown]) {
      const useNormalizedIndex = searchContent === normalizedFullMarkdown;
      let searchFrom = 0;

      while (true) {
        const index = searchContent.indexOf(candidate, searchFrom);
        if (index === -1) {
          break;
        }

        const matchStart = useNormalizedIndex
          ? mapNormalizedIndexToOriginal(fullMarkdown, index)
          : index;
        const matchEnd = useNormalizedIndex
          ? mapNormalizedIndexToOriginal(fullMarkdown, index + candidate.length)
          : index + candidate.length;
        const matchedText = fullMarkdown.slice(matchStart, matchEnd);
        let score = candidate.length;

        if (normalizedContextBefore) {
          const before = normalizeForMatching(
            fullMarkdown.slice(
              Math.max(0, matchStart - normalizedContextBefore.length),
              matchStart
            )
          );
          score += commonSuffixLength(before, normalizedContextBefore);
        }

        if (normalizedContextAfter) {
          const after = normalizeForMatching(
            fullMarkdown.slice(
              matchEnd,
              matchEnd + normalizedContextAfter.length + 8
            )
          );
          score += commonPrefixLength(after, normalizedContextAfter);
        }

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            index: matchStart,
            matchedText,
            score,
          };
        }

        searchFrom = index + 1;
      }
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    index: bestMatch.index,
    matchedText: bestMatch.matchedText,
  };
}

export function applyProposalReplacement(
  fullMarkdown: string,
  proposal: ProposalReplacementInput
): AppliedProposalReplacement | null {
  const match = findProposalMatch(fullMarkdown, proposal);
  if (!match) {
    return null;
  }

  return {
    ...match,
    newContent:
      fullMarkdown.slice(0, match.index) +
      proposal.replacement +
      fullMarkdown.slice(match.index + match.matchedText.length),
  };
}
