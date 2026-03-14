export interface TextRange {
  from: number;
  to: number;
}

export interface RangeDoc {
  nodesBetween: (from: number, to: number, cb: (node: any, pos: number) => void) => void;
}

export interface DomAtPosResult {
  node: Node;
  offset: number;
}

export interface BlockDomView {
  domAtPos: (pos: number) => DomAtPosResult;
}

export interface ProposalRevealMetrics {
  currentScrollTop: number;
  viewportHeight: number;
  firstTop: number;
  lastBottom: number;
  topOffset: number;
  bottomMargin: number;
}

export interface DomBlockMatch {
  element: HTMLElement;
  text: string;
}

export interface TextBlockMatch {
  text: string;
}

export interface BlockSequenceMatchOptions {
  selectedText?: string | null;
  contextBefore?: string | null;
  contextAfter?: string | null;
}

export interface ProposalRevealPaddingMetrics {
  desiredScrollTop: number;
  currentMaxScrollTop: number;
  extraMargin: number;
}

interface IndexedChar {
  char: string;
  pos: number;
}

export function getProposalRevealTopPadding(tagName: string): number {
  switch (tagName.toUpperCase()) {
    case 'H1':
      return 72;
    case 'H2':
      return 56;
    case 'H3':
      return 40;
    case 'H4':
      return 28;
    case 'H5':
    case 'H6':
      return 20;
    default:
      return 12;
  }
}

export function buildPinnedSelectionRanges(
  doc: RangeDoc,
  from: number,
  to: number
): TextRange[] {
  const ranges: TextRange[] = [];

  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) {
      return;
    }

    const nodeEnd = pos + node.nodeSize;
    const rangeFrom = Math.max(from, pos);
    const rangeTo = Math.min(to, nodeEnd);

    if (rangeFrom < rangeTo) {
      ranges.push({ from: rangeFrom, to: rangeTo });
    }
  });

  return ranges;
}

export function resolvePinnedTextRange(
  doc: RangeDoc,
  from: number,
  to: number
): TextRange | null {
  const ranges = buildPinnedSelectionRanges(doc, from, to);
  if (ranges.length === 0) {
    return null;
  }

  return {
    from: ranges[0].from,
    to: ranges[ranges.length - 1].to,
  };
}

export function buildPinnedBlockRanges(
  doc: RangeDoc,
  from: number,
  to: number
): TextRange[] {
  const ranges: TextRange[] = [];

  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) {
      return;
    }

    const nodeEnd = pos + node.nodeSize;
    if (nodeEnd <= from || pos >= to) {
      return;
    }

    ranges.push({ from: pos, to: nodeEnd });
  });

  return ranges;
}

function resolveHighlightBlock(node: Node | null): HTMLElement | null {
  let element =
    node instanceof HTMLElement ? node : node instanceof Text ? node.parentElement : null;

  while (element) {
    if (element.classList.contains('ProseMirror')) {
      return null;
    }

    if (
      element.matches(
        'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, hr, .github-alert, .mermaid-container'
      )
    ) {
      return element;
    }

    element = element.parentElement;
  }

  return null;
}

export function resolvePinnedBlockElementAtPos(
  view: BlockDomView,
  from: number,
  to = from
): HTMLElement | null {
  const candidatePositions = [Math.max(from + 1, from), Math.max(to - 1, from), from];

  for (const pos of candidatePositions) {
    const match = resolveHighlightBlock(view.domAtPos(pos).node);
    if (match) {
      return match;
    }
  }

  return null;
}

export function resolvePinnedBlockElements(
  view: BlockDomView,
  ranges: TextRange[]
): HTMLElement[] {
  const elements = new Set<HTMLElement>();

  for (const range of ranges) {
    const match = resolvePinnedBlockElementAtPos(view, range.from, range.to);
    if (match) {
      elements.add(match);
    }
  }

  return [...elements];
}

export function calculateProposalRevealScrollTop(metrics: ProposalRevealMetrics): number {
  const {
    currentScrollTop,
    viewportHeight,
    firstTop,
    lastBottom,
    topOffset,
    bottomMargin,
  } = metrics;

  const startAligned = Math.max(0, currentScrollTop + firstTop - topOffset);
  const endVisible = Math.max(0, currentScrollTop + lastBottom - (viewportHeight - bottomMargin));
  const availableHeight = Math.max(0, viewportHeight - topOffset - bottomMargin);
  const selectionHeight = Math.max(0, lastBottom - firstTop);

  if (selectionHeight > availableHeight) {
    return startAligned;
  }

  const centeredTop = topOffset + Math.max(0, (availableHeight - selectionHeight) / 2);
  const centeredScrollTop = Math.max(0, currentScrollTop + firstTop - centeredTop);

  return Math.max(centeredScrollTop, endVisible);
}

export function calculateProposalRevealBottomPadding(
  metrics: ProposalRevealPaddingMetrics
): number {
  const { desiredScrollTop, currentMaxScrollTop, extraMargin } = metrics;

  if (desiredScrollTop <= currentMaxScrollTop) {
    return 0;
  }

  return desiredScrollTop - currentMaxScrollTop + extraMargin;
}

function normalizeBlockMarkdown(markdown: string): string {
  return markdown
    .replace(/^>\s?/gm, '')
    .replace(/\[!([^\]]+)\]/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*\*|___)(.*?)\1/g, '$2')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isListItemStart(line: string): boolean {
  return /^([-*+]|\d+[.)])(?:\s+.*)?$/.test(line) || /^-\s+\[[ xX]\](?:\s+.*)?$/.test(line);
}

function stripListItemMarker(line: string): string {
  return line
    .replace(/^-\s+\[[ xX]\](?:\s+)?/, '')
    .replace(/^[-*+](?:\s+)?/, '')
    .replace(/^\d+[.)](?:\s+)?/, '');
}

function getSelectionBlockParts(markdown: string): string[] {
  const parts: string[] = [];
  const lines = markdown.split('\n');
  let currentParagraph: string[] = [];
  let currentListItem: string[] | null = null;

  const flushParagraph = () => {
    if (currentParagraph.length === 0) {
      return;
    }
    parts.push(currentParagraph.join('\n'));
    currentParagraph = [];
  };

  const flushListItem = () => {
    if (!currentListItem || currentListItem.length === 0) {
      currentListItem = null;
      return;
    }
    parts.push(currentListItem.join('\n'));
    currentListItem = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushListItem();
      flushParagraph();
      continue;
    }

    if (isListItemStart(trimmed)) {
      flushListItem();
      flushParagraph();
      currentListItem = [trimmed];
      continue;
    }

    if (currentListItem) {
      currentListItem.push(trimmed);
      continue;
    }

    currentParagraph.push(trimmed);
  }

  flushListItem();
  flushParagraph();

  return parts;
}

function normalizeContextText(text: string): string {
  return text.replace(/\s+/g, ' ');
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

function scoreSingleBlockSequence<T extends TextBlockMatch>(
  matchedBlocks: T[],
  selectedBlocks: string[],
  options?: BlockSequenceMatchOptions
): number {
  const selectedTextCandidates = [
    normalizeInlineText(options?.selectedText ?? ''),
    ...selectedBlocks.map(normalizeInlineText),
  ].filter((candidate, index, candidates) => candidate.length > 0 && candidates.indexOf(candidate) === index);
  const contextBefore = normalizeContextText(options?.contextBefore ?? '');
  const contextAfter = normalizeContextText(options?.contextAfter ?? '');

  if (selectedTextCandidates.length === 0 || matchedBlocks.length !== 1) {
    return 0;
  }

  const blockText = normalizeContextText(matchedBlocks[0].text);
  let bestScore = -1;
  for (const selectedText of selectedTextCandidates) {
    let searchFrom = 0;

    while (true) {
      const matchIndex = blockText.indexOf(selectedText, searchFrom);
      if (matchIndex === -1) {
        break;
      }

      let score = selectedText.length;

      if (contextBefore) {
        const before = blockText.slice(Math.max(0, matchIndex - contextBefore.length), matchIndex);
        score += commonSuffixLength(before, contextBefore);
      }

      if (contextAfter) {
        const after = blockText.slice(
          matchIndex + selectedText.length,
          matchIndex + selectedText.length + contextAfter.length
        );
        score += commonPrefixLength(after, contextAfter);
      }

      bestScore = Math.max(bestScore, score);
      searchFrom = matchIndex + 1;
    }
  }

  return Math.max(bestScore, 0);
}

export function resolveTextRangeWithinTextBlock(
  doc: RangeDoc,
  from: number,
  to: number,
  selectedText: string,
  options?: BlockSequenceMatchOptions
): TextRange | null {
  const normalizedSelectedTextCandidates = [
    normalizeInlineText(selectedText),
    ...getNormalizedSelectionBlocks(selectedText).map(normalizeInlineText),
  ].filter((candidate, index, candidates) => candidate.length > 0 && candidates.indexOf(candidate) === index);
  const contextBefore = normalizeContextText(options?.contextBefore ?? '');
  const contextAfter = normalizeContextText(options?.contextAfter ?? '');

  if (normalizedSelectedTextCandidates.length === 0) {
    return null;
  }

  const indexedChars: IndexedChar[] = [];

  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) {
      return;
    }

    for (let offset = 0; offset < node.text.length; offset += 1) {
      indexedChars.push({
        char: node.text[offset],
        pos: pos + offset,
      });
    }
  });

  if (indexedChars.length === 0) {
    return null;
  }

  let normalizedText = '';
  const normalizedPositions: number[] = [];

  for (const entry of indexedChars) {
    if (/\s/.test(entry.char)) {
      if (normalizedText.length === 0 || normalizedText[normalizedText.length - 1] === ' ') {
        continue;
      }
      normalizedText += ' ';
      normalizedPositions.push(entry.pos);
      continue;
    }

    normalizedText += entry.char;
    normalizedPositions.push(entry.pos);
  }

  if (!normalizedText) {
    return null;
  }

  let bestRange: TextRange | null = null;
  let bestScore = -1;

  for (const normalizedSelectedText of normalizedSelectedTextCandidates) {
    let searchFrom = 0;

    while (true) {
      const matchIndex = normalizedText.indexOf(normalizedSelectedText, searchFrom);
      if (matchIndex === -1) {
        break;
      }

      let score = normalizedSelectedText.length;

      if (contextBefore) {
        const before = normalizedText.slice(Math.max(0, matchIndex - contextBefore.length), matchIndex);
        score += commonSuffixLength(before, contextBefore);
      }

      if (contextAfter) {
        const after = normalizedText.slice(
          matchIndex + normalizedSelectedText.length,
          matchIndex + normalizedSelectedText.length + contextAfter.length
        );
        score += commonPrefixLength(after, contextAfter);
      }

      if (score > bestScore) {
        bestScore = score;
        bestRange = {
          from: normalizedPositions[matchIndex],
          to:
            normalizedPositions[matchIndex + normalizedSelectedText.length - 1] +
            1,
        };
      }

      searchFrom = matchIndex + 1;
    }
  }

  return bestRange;
}

export function getNormalizedSelectionBlocks(markdown: string): string[] {
  return getSelectionBlockParts(markdown)
    .map(part => {
      const [firstLine, ...rest] = part.split('\n');
      const normalizedFirstLine = isListItemStart(firstLine)
        ? stripListItemMarker(firstLine)
        : firstLine;
      const normalizedPart = [normalizedFirstLine, ...rest].join('\n');
      return normalizeBlockMarkdown(normalizedPart);
    })
    .filter(Boolean);
}

export function findTextBlockSequence<T extends TextBlockMatch>(
  renderedBlocks: T[],
  selectedBlocks: string[],
  options?: BlockSequenceMatchOptions
): T[] {
  if (selectedBlocks.length === 0) {
    return [];
  }

  const normalizedRendered = renderedBlocks.map(block => ({
    ...block,
    text: normalizeInlineText(block.text),
  }));

  const candidates: Array<{ blocks: T[]; score: number }> = [];
  const requireForwardContainment = selectedBlocks.length > 1;

  for (let start = 0; start <= normalizedRendered.length - selectedBlocks.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < selectedBlocks.length; offset += 1) {
      const expected = selectedBlocks[offset];
      const actual = normalizedRendered[start + offset].text;
      const blockMatches = requireForwardContainment
        ? actual.includes(expected)
        : actual.includes(expected) || expected.includes(actual);
      if (!blockMatches) {
        matched = false;
        break;
      }
    }
    if (matched) {
      const blocks = normalizedRendered.slice(start, start + selectedBlocks.length);
      candidates.push({
        blocks,
        score: scoreSingleBlockSequence(blocks, selectedBlocks, options),
      });
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].blocks;
}

export function findRenderedBlockSequence(
  renderedBlocks: DomBlockMatch[],
  selectedBlocks: string[],
  options?: BlockSequenceMatchOptions
): DomBlockMatch[] {
  return findTextBlockSequence(renderedBlocks, selectedBlocks, options);
}
